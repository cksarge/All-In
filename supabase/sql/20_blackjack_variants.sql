-- =============================================================================
-- All In · 20_blackjack_variants.sql
-- Stage 10, part 2: four blackjack variants on one solo engine, and four quick games.
--   Spanish 21 · Blackjack Switch · Free Bet Blackjack · Pontoon
--   Red Dog · Hi-Lo · Andar Bahar · Chuck-a-Luck
-- Run AFTER 01-19 (re-run 03_games_and_stakes.sql first: it lists these games).
-- Safe to re-run.
--
-- The blackjack variants are solo (the multiplayer tables in 06 are untouched):
-- bjv_deal(game, tier, bet), then bjv_act(game, action) until the state is final.
-- As in 19, `state.actions` lists what the player may do next and what it costs.
-- A hand has a `stake` (the player's own chips on it) and a `free` amount (Free Bet
-- Blackjack: chips the house put up). A win returns stake x 2 + free; a push, the stake.
-- =============================================================================

do $$
begin
  if (select count(*) from public.games where key in ('spanish_21', 'blackjack_switch', 'free_bet_blackjack', 'pontoon',
                                                      'red_dog', 'hi_lo', 'andar_bahar', 'chuck_a_luck')) < 8 then
    raise exception 'Run 03_games_and_stakes.sql again first: it adds these games to the catalogue.';
  end if;
end $$;

create or replace function private.s10_cfg(p_game text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select ($cfg$
{
  "spanish_21":         {"kind": "blackjack", "decks": 6, "no_tens": true, "h17": true, "bj": [3, 2], "surrender": true, "double_any": true,
                         "max_hands": 4, "player_21_wins": true, "bonuses": true},
  "blackjack_switch":   {"kind": "blackjack", "decks": 6, "h17": true, "bj": [1, 1], "push_22": true, "two_hands": true, "max_hands": 4},
  "free_bet_blackjack": {"kind": "blackjack", "decks": 6, "h17": true, "bj": [3, 2], "push_22": true, "free": true, "max_hands": 4},
  "pontoon":            {"kind": "blackjack", "decks": 6, "h17": true, "bj": [2, 1], "pontoon": true, "max_hands": 2, "min_stand": 15},
  "red_dog":      {"pays": {"1": 5, "2": 4, "3": 2, "4": 1}, "triple": 11},
  "hi_lo":        {"edge_pct": 3, "max_units": 100000},
  "andar_bahar":  {"spots": ["andar", "bahar"], "commission_pct": 10},
  "chuck_a_luck": {"pays": {"number": [1, 2, 10], "high": 1, "low": 1, "field": 1, "triple": 30}, "field": [5, 6, 7, 8, 13, 14, 15, 16]}
}
  $cfg$::jsonb) -> p_game
$fn$;

-- =============================================================================
-- BLACKJACK VARIANTS
-- =============================================================================
-- A card's blackjack value: ace 1 (or 11), 2 to 9 as marked, tens and faces 10.
create or replace function private.bjv_card(c integer)
returns integer language sql immutable set search_path = '' as $$
  select case when c % 13 = 0 then 1 when c % 13 >= 9 then 10 else c % 13 + 1 end
$$;

create or replace function private.bjv_value(p_cards smallint[], out total integer, out soft boolean)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sum integer := 0;
  v_aces integer := 0;
  c smallint;
begin
  foreach c in array coalesce(p_cards, '{}'::smallint[]) loop
    v_sum := v_sum + private.bjv_card(c);
    if c % 13 = 0 then v_aces := v_aces + 1; end if;
  end loop;
  soft := v_aces > 0 and v_sum + 10 <= 21;
  total := case when soft then v_sum + 10 else v_sum end;
end $$;

create or replace function private.bjv_cards(j jsonb)
returns smallint[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(e::smallint order by o), '{}') from jsonb_array_elements_text(j) with ordinality t(e, o)
$$;

-- Marks hands that can take no more cards as done, and points `active` at the next one to play (null = none).
create or replace function private.bjv_advance(c jsonb, s jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_hands jsonb := s -> 'hands';
  h jsonb;
  v record;
  v_active integer := null;
  n integer;
begin
  for i in 0..jsonb_array_length(v_hands) - 1 loop
    h := v_hands -> i;
    select * into v from private.bjv_value(private.bjv_cards(h -> 'cards'));
    n := jsonb_array_length(h -> 'cards');
    if not (h ->> 'done')::boolean and (v.total >= 21 or ((c ->> 'pontoon')::boolean and n >= 5)) then
      h := h || '{"done": true}'::jsonb;
      v_hands := jsonb_set(v_hands, array[i::text], h);
    end if;
    if v_active is null and not (h ->> 'done')::boolean then
      v_active := i;
    end if;
  end loop;
  return s || jsonb_build_object('hands', v_hands, 'active', v_active);
end $$;

-- What the player may do with the hand in play, and what each choice costs.
create or replace function private.bjv_actions(c jsonb, s jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bet bigint := (s ->> 'bet')::bigint;
  h jsonb;
  v_cards smallint[];
  v record;
  n integer;
  a jsonb := '[]'::jsonb;
  v_pair boolean;
  v_tens boolean;
begin
  if s -> 'active' is null or s -> 'active' = 'null'::jsonb then
    return a;
  end if;
  h := s -> 'hands' -> (s ->> 'active')::integer;
  v_cards := private.bjv_cards(h -> 'cards');
  n := cardinality(v_cards);
  select * into v from private.bjv_value(v_cards);
  a := a || jsonb_build_object('key', 'hit', 'cost', 0);
  if not coalesce((c ->> 'pontoon')::boolean, false) or v.total >= (c ->> 'min_stand')::integer then
    a := a || jsonb_build_object('key', 'stand', 'cost', 0);
  end if;
  if not coalesce((h ->> 'doubled')::boolean, false) and not coalesce((h ->> 'split_aces')::boolean, false)
     and (n = 2 or coalesce((c ->> 'double_any')::boolean, false) or coalesce((c ->> 'pontoon')::boolean, false)) then
    -- Free Bet: the house pays for a double on a hard 9, 10 or 11 with two cards.
    a := a || jsonb_build_object('key', 'double', 'cost',
      case when coalesce((c ->> 'free')::boolean, false) and n = 2 and not v.soft and v.total between 9 and 11 then 0 else v_bet end);
  end if;
  v_pair := n = 2 and private.bjv_card(v_cards[1]) = private.bjv_card(v_cards[2]);
  v_tens := v_pair and private.bjv_card(v_cards[1]) = 10;
  if v_pair and jsonb_array_length(s -> 'hands') < (c ->> 'max_hands')::integer and not coalesce((h ->> 'split_aces')::boolean, false) then
    -- Free Bet: the house pays for every split except ten-value cards.
    a := a || jsonb_build_object('key', 'split', 'cost', case when coalesce((c ->> 'free')::boolean, false) and not v_tens then 0 else v_bet end);
  end if;
  if coalesce((c ->> 'surrender')::boolean, false) and (s ->> 'first')::boolean and n = 2 and jsonb_array_length(s -> 'hands') = 1 then
    a := a || jsonb_build_object('key', 'surrender', 'cost', 0);
  end if;
  if coalesce((c ->> 'two_hands')::boolean, false) and (s ->> 'first')::boolean then
    a := a || jsonb_build_object('key', 'switch', 'cost', 0);
  end if;
  return a;
end $$;

-- Spanish 21: what a 21 pays, as {numerator, denominator}, or null for the plain 1 to 1.
create or replace function private.bjv_bonus(p_cards smallint[])
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer := cardinality(p_cards);
  v_ranks integer[];
  v_suited boolean;
begin
  if n >= 7 then return array[3, 1]; elsif n = 6 then return array[2, 1]; elsif n = 5 then return array[3, 2]; end if;
  if n = 3 then
    select array_agg(x % 13 + 1 order by x % 13) into v_ranks from unnest(p_cards) x;
    if v_ranks = array[6, 7, 8] or v_ranks = array[7, 7, 7] then
      v_suited := p_cards[1] / 13 = p_cards[2] / 13 and p_cards[2] / 13 = p_cards[3] / 13;
      return case when v_suited and p_cards[1] / 13 = 0 then array[3, 1] when v_suited then array[2, 1] else array[3, 2] end;
    end if;
  end if;
  return null;
end $$;

-- The dealer plays out and every hand is paid. Returns the final state.
create or replace function private.bjv_resolve(p_user uuid, p_round uuid, c jsonb, s jsonb, p_deck smallint[], p_dealer smallint[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game text := s ->> 'game';
  v_pontoon boolean := coalesce((c ->> 'pontoon')::boolean, false);
  v_dealer smallint[] := p_dealer;
  v_next integer := 1;
  d record;
  v_dealer_bj boolean;
  v_alive boolean;
  v_hands jsonb := '[]'::jsonb;
  h jsonb;
  v_cards smallint[];
  p record;
  n integer;
  v_stake bigint;
  v_free bigint;
  v_ret bigint;
  v_out text;
  v_bonus integer[];
  v_prank integer;
  v_drank integer;
  v_mult integer[];
  v_total bigint := 0;
  v_staked bigint;
  v_any_bonus boolean := false;
  v_five boolean := false;
  v_balance bigint;
begin
  select * into d from private.bjv_value(v_dealer);
  v_dealer_bj := d.total = 21;
  -- The dealer only draws if some hand is still standing (and hasn't already won outright).
  select bool_or(not coalesce((x ->> 'surrendered')::boolean, false)
                 and (select total from private.bjv_value(private.bjv_cards(x -> 'cards'))) <= 21) into v_alive
    from jsonb_array_elements(s -> 'hands') x;
  if v_alive and not v_dealer_bj then
    while d.total < 17 or (d.total = 17 and d.soft and (c ->> 'h17')::boolean) loop
      v_dealer := v_dealer || p_deck[v_next];
      v_next := v_next + 1;
      select * into d from private.bjv_value(v_dealer);
    end loop;
  end if;
  v_drank := case when d.total > 21 then 0 when v_dealer_bj then 3 when cardinality(v_dealer) >= 5 then 2 else 1 end;

  for h in select x from jsonb_array_elements(s -> 'hands') x loop
    v_cards := private.bjv_cards(h -> 'cards');
    n := cardinality(v_cards);
    select * into p from private.bjv_value(v_cards);
    v_stake := (h ->> 'stake')::bigint;
    v_free := coalesce((h ->> 'free')::bigint, 0);
    v_ret := 0;
    v_mult := array[1, 1];
    if coalesce((h ->> 'surrendered')::boolean, false) then
      v_out := 'surrender'; v_ret := v_stake / 2;
    elsif p.total > 21 then
      v_out := 'bust';
    elsif v_pontoon then
      -- Pontoon beats a five-card trick beats any other hand; the dealer wins ties.
      v_prank := case when (h ->> 'natural')::boolean then 3 when n >= 5 then 2 else 1 end;
      if v_prank > v_drank or (v_prank = 1 and v_drank = 1 and p.total > d.total) then
        v_out := case v_prank when 3 then 'blackjack' when 2 then 'five_card' else 'win' end;
        if v_prank >= 2 then v_mult := array[2, 1]; end if;
        if v_prank = 2 then v_five := true; end if;
        v_ret := v_stake + v_stake * v_mult[1] / v_mult[2];
      else
        v_out := 'lose';
      end if;
    elsif (h ->> 'natural')::boolean then
      if v_dealer_bj and not coalesce((c ->> 'player_21_wins')::boolean, false) then
        v_out := 'push'; v_ret := v_stake;
      else
        v_out := 'blackjack'; v_ret := v_stake + v_stake * (c -> 'bj' ->> 0)::integer / (c -> 'bj' ->> 1)::integer;
      end if;
    elsif v_dealer_bj then
      v_out := 'lose';
    elsif coalesce((c ->> 'player_21_wins')::boolean, false) and p.total = 21 then
      v_bonus := case when coalesce((h ->> 'doubled')::boolean, false) then null else private.bjv_bonus(v_cards) end;
      if v_bonus is not null then
        v_out := 'bonus'; v_any_bonus := true; v_ret := v_stake + v_stake * v_bonus[1] / v_bonus[2];
      else
        v_out := 'win'; v_ret := v_stake * 2 + v_free;
      end if;
    elsif d.total > 21 then
      if coalesce((c ->> 'push_22')::boolean, false) and d.total = 22 then
        v_out := 'push'; v_ret := v_stake;
      else
        v_out := 'win'; v_ret := v_stake * 2 + v_free;
      end if;
    elsif p.total > d.total then
      v_out := 'win'; v_ret := v_stake * 2 + v_free;
    elsif p.total = d.total then
      v_out := 'push'; v_ret := v_stake;
    else
      v_out := 'lose';
    end if;
    v_total := v_total + v_ret;
    v_hands := v_hands || (h || jsonb_build_object('outcome', v_out, 'returned', v_ret, 'total', p.total, 'done', true));
  end loop;

  select staked into v_staked from public.solo_rounds where id = p_round;
  delete from public.solo_rounds where id = p_round;
  v_balance := private.apply_chips(p_user, v_total, 'payout', v_game, p_round::text);
  perform private.record_round(p_user, v_game, null, p_round, v_staked, v_total,
    jsonb_strip_nulls(jsonb_build_object('dealer', d.total, 'hands', jsonb_array_length(v_hands),
      'outcomes', (select jsonb_agg(x ->> 'outcome') from jsonb_array_elements(v_hands) x),
      'bonus', case when v_any_bonus then true end, 'five_card', case when v_five then true end)));
  return s || jsonb_build_object(
    'round_id', p_round, 'final', true, 'hands', v_hands, 'active', null, 'actions', '[]'::jsonb,
    'dealer', to_jsonb(v_dealer), 'dealer_total', d.total, 'dealer_blackjack', v_dealer_bj,
    'staked', v_staked, 'win', v_total, 'balance', v_balance);
end $$;

create or replace function public.bjv_deal(p_game text, p_tier text, p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  c       jsonb := private.s10_cfg(p_game);
  v_two   boolean;
  v_staked bigint;
  d       smallint[];
  v_hands jsonb := '[]'::jsonb;
  v_dealer smallint[];
  v_up    integer;
  v_peek  boolean;
  n       integer;
  s       jsonb;
  v_id    uuid;
  v_balance bigint;
begin
  if c is null or c ->> 'kind' is distinct from 'blackjack' then
    raise exception 'unknown_game';
  end if;
  if exists (select 1 from public.solo_rounds where user_id = v_uid and game_key = p_game) then
    raise exception 'round_in_progress';
  end if;
  v_two := coalesce((c ->> 'two_hands')::boolean, false);
  v_staked := private.solo_spots(v_uid, p_game, p_tier, jsonb_build_object('bet', p_bet), '^bet$') * case when v_two then 2 else 1 end;
  if (select balance from public.wallets where user_id = v_uid) < v_staked then
    raise exception 'insufficient_chips';
  end if;

  d := private.shuffled_shoe((c ->> 'decks')::integer);
  -- Spanish 21 is played without the four 10-spot cards of each deck.
  if coalesce((c ->> 'no_tens')::boolean, false) then
    select array_agg(x order by o) into d from unnest(d) with ordinality t(x, o) where x % 13 <> 9;
  end if;
  n := case when v_two then 2 else 1 end;
  for i in 1..n loop
    v_hands := v_hands || jsonb_build_object(
      'cards', to_jsonb(array[d[i], d[n + 1 + i]]), 'stake', p_bet, 'free', 0, 'done', false, 'doubled', false,
      'natural', (select total = 21 from private.bjv_value(array[d[i], d[n + 1 + i]])));
  end loop;
  v_dealer := array[d[n + 1], d[2 * n + 2]];
  d := d[2 * n + 3:2 * n + 62];

  s := jsonb_build_object('game', p_game, 'bet', p_bet, 'hands', v_hands, 'first', true, 'switched', false,
                          -- Pontoon keeps both dealer cards face down.
                          'dealer', case when coalesce((c ->> 'pontoon')::boolean, false) then '[]'::jsonb else to_jsonb(v_dealer[1:1]) end);
  s := private.bjv_advance(c, s);
  v_id := private.solo_begin(v_uid, p_game, p_tier, v_staked, s, d, jsonb_build_object('dealer', to_jsonb(v_dealer)));
  v_balance := private.apply_chips(v_uid, -v_staked, 'bet', p_game, v_id::text);

  -- With an ace or a ten showing the dealer checks for blackjack, and the hand ends there if so.
  v_up := private.bjv_card(v_dealer[1]);
  v_peek := not coalesce((c ->> 'pontoon')::boolean, false) and v_up in (1, 10)
            and (select total = 21 from private.bjv_value(v_dealer));
  if v_peek or s -> 'active' = 'null'::jsonb then
    return private.bjv_resolve(v_uid, v_id, c, s, d, v_dealer);
  end if;
  s := s || jsonb_build_object('actions', private.bjv_actions(c, s));
  update public.solo_rounds set state = s where id = v_id;
  return s || jsonb_build_object('round_id', v_id, 'balance', v_balance);
end $$;

create or replace function public.bjv_act(p_game text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  c       jsonb := private.s10_cfg(p_game);
  r       public.solo_rounds;
  s       jsonb;
  v_deck  smallint[];
  v_dealer smallint[];
  v_cost  bigint;
  v_bet   bigint;
  i       integer;
  h       jsonb;
  h2      jsonb;
  v_cards smallint[];
  v_other smallint[];
  v_hands jsonb;
  v_free  boolean;
begin
  if c is null or c ->> 'kind' is distinct from 'blackjack' then
    raise exception 'unknown_game';
  end if;
  r := private.solo_open_round(v_uid, p_game);
  s := r.state;
  select (a ->> 'cost')::bigint into v_cost from jsonb_array_elements(s -> 'actions') a where a ->> 'key' = p_action;
  if v_cost is null then
    raise exception 'action_not_allowed' using hint = 'That isn''t one of your choices right now.';
  end if;
  select deck, private.bjv_cards(data -> 'dealer') into v_deck, v_dealer from public.solo_secrets where round_id = r.id;
  v_bet := (s ->> 'bet')::bigint;
  i := (s ->> 'active')::integer;
  v_hands := s -> 'hands';
  h := v_hands -> i;
  v_cards := private.bjv_cards(h -> 'cards');
  v_free := v_cost = 0 and p_action in ('double', 'split');

  if v_cost > 0 then
    perform private.apply_chips(v_uid, -v_cost, 'bet', p_game, r.id::text, jsonb_build_object('spot', p_action));
    update public.solo_rounds set staked = staked + v_cost where id = r.id;
  end if;

  if p_action = 'hit' then
    h := h || jsonb_build_object('cards', to_jsonb(v_cards || v_deck[1]));
    v_deck := v_deck[2:];
  elsif p_action = 'stand' then
    h := h || '{"done": true}'::jsonb;
  elsif p_action = 'double' then
    h := h || jsonb_build_object('cards', to_jsonb(v_cards || v_deck[1]), 'doubled', true,
                                 'stake', (h ->> 'stake')::bigint + case when v_free then 0 else v_bet end,
                                 'free', (h ->> 'free')::bigint + case when v_free then v_bet else 0 end,
                                 -- In Pontoon you may go on taking cards after buying one.
                                 'done', not coalesce((c ->> 'pontoon')::boolean, false));
    v_deck := v_deck[2:];
  elsif p_action = 'surrender' then
    h := h || '{"done": true, "surrendered": true}'::jsonb;
  elsif p_action = 'split' then
    -- Each card starts a hand of its own and gets a second card. Split aces get one card each and stand.
    h2 := jsonb_build_object('cards', to_jsonb(array[v_cards[2], v_deck[2]]), 'stake', case when v_free then 0 else v_bet end,
                             'free', case when v_free then v_bet else 0 end, 'doubled', false, 'natural', false,
                             'done', v_cards[1] % 13 = 0, 'split_aces', v_cards[1] % 13 = 0);
    h := h || jsonb_build_object('cards', to_jsonb(array[v_cards[1], v_deck[1]]), 'natural', false,
                                 'done', v_cards[1] % 13 = 0, 'split_aces', v_cards[1] % 13 = 0);
    -- In Pontoon a split ace with a ten is still a pontoon.
    if coalesce((c ->> 'pontoon')::boolean, false) then
      h := h || jsonb_build_object('natural', (select total = 21 from private.bjv_value(array[v_cards[1], v_deck[1]])));
      h2 := h2 || jsonb_build_object('natural', (select total = 21 from private.bjv_value(array[v_cards[2], v_deck[2]])));
    end if;
    v_deck := v_deck[3:];
    v_hands := jsonb_set(v_hands, array[i::text], h);
    select jsonb_agg(x order by o) into v_hands
      from (select x, o * 2 as o from jsonb_array_elements(v_hands) with ordinality t(x, o)
            union all select h2, (i + 1) * 2 + 1) q;
  elsif p_action = 'switch' then
    -- The second cards of the two hands change places. A blackjack made this way is an ordinary 21.
    v_other := private.bjv_cards(v_hands -> 1 -> 'cards');
    v_hands := jsonb_set(v_hands, '{0}', (v_hands -> 0) || jsonb_build_object('cards', to_jsonb(array[v_cards[1], v_other[2]]), 'natural', false));
    v_hands := jsonb_set(v_hands, '{1}', (v_hands -> 1) || jsonb_build_object('cards', to_jsonb(array[v_other[1], v_cards[2]]), 'natural', false));
    s := s || '{"switched": true}'::jsonb;
  end if;
  if p_action not in ('split', 'switch') then
    v_hands := jsonb_set(v_hands, array[i::text], h);
  end if;

  s := s || jsonb_build_object('hands', v_hands, 'first', false);
  s := private.bjv_advance(c, s);
  if s -> 'active' = 'null'::jsonb then
    update public.solo_secrets set deck = v_deck where round_id = r.id;
    return private.bjv_resolve(v_uid, r.id, c, s, v_deck, v_dealer);
  end if;
  s := s || jsonb_build_object('actions', private.bjv_actions(c, s));
  update public.solo_rounds set state = s where id = r.id;
  update public.solo_secrets set deck = v_deck where round_id = r.id;
  return s || jsonb_build_object('round_id', r.id, 'balance', (select balance from public.wallets where user_id = v_uid));
end $$;

-- =============================================================================
-- RED DOG. Two cards; will the third fall between them? Aces are high.
-- =============================================================================
create or replace function private.rd_final(p_user uuid, p_round uuid, p_cards smallint[], p_staked bigint, p_returned bigint, p_outcome text, p_spread integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  delete from public.solo_rounds where id = p_round;
  v_balance := private.apply_chips(p_user, p_returned, 'payout', 'red_dog', p_round::text);
  perform private.record_round(p_user, 'red_dog', null, p_round, p_staked, p_returned, jsonb_build_object('outcome', p_outcome, 'spread', p_spread));
  return jsonb_build_object('round_id', p_round, 'final', true, 'cards', to_jsonb(p_cards), 'spread', p_spread, 'outcome', p_outcome,
                            'staked', p_staked, 'win', p_returned, 'balance', v_balance);
end $$;

create or replace function public.reddog_deal(p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  c      jsonb := private.s10_cfg('red_dog');
  v_tier text;
  d      smallint[];
  r1     integer;
  r2     integer;
  v_spread integer;
  v_id   uuid;
  s      jsonb;
  v_balance bigint;
begin
  if exists (select 1 from public.solo_rounds where user_id = v_uid and game_key = 'red_dog') then
    raise exception 'round_in_progress';
  end if;
  v_tier := private.more_bet_tier(v_uid, 'red_dog', p_bet);
  d := (private.shuffled_shoe(1))[1:3];
  r1 := private.cg_r(d[1]);
  r2 := private.cg_r(d[2]);
  v_spread := abs(r1 - r2) - 1;
  s := jsonb_build_object('bet', p_bet, 'cards', to_jsonb(d[1:2]), 'spread', v_spread,
                          'pays', case when v_spread >= 1 then (c -> 'pays' ->> least(v_spread, 4)::text)::integer end,
                          'actions', jsonb_build_array(jsonb_build_object('key', 'stand', 'cost', 0), jsonb_build_object('key', 'raise', 'cost', p_bet)));
  v_id := private.solo_begin(v_uid, 'red_dog', v_tier, p_bet, s, d[3:3], null);
  v_balance := private.apply_chips(v_uid, -p_bet, 'bet', 'red_dog', v_id::text);
  if v_spread = 0 then
    -- Next to each other: nothing can fall between. The bet comes back.
    return private.rd_final(v_uid, v_id, d[1:2], p_bet, p_bet, 'push', 0);
  elsif v_spread = -1 then
    -- A pair: a third of the same rank pays 11 to 1, anything else is a push.
    if private.cg_r(d[3]) = r1 then
      return private.rd_final(v_uid, v_id, d, p_bet, p_bet * ((c ->> 'triple')::integer + 1), 'triple', -1);
    end if;
    return private.rd_final(v_uid, v_id, d, p_bet, p_bet, 'push', -1);
  end if;
  return s || jsonb_build_object('round_id', v_id, 'balance', v_balance);
end $$;

-- p_raise doubles the bet before the third card is turned.
create or replace function public.reddog_act(p_raise boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r     public.solo_rounds;
  d     smallint[];
  v_third smallint;
  v_bet bigint;
  v_staked bigint;
  lo    integer;
  hi    integer;
  t     integer;
  v_win boolean;
begin
  if p_raise is null then
    raise exception 'action_not_allowed';
  end if;
  r := private.solo_open_round(v_uid, 'red_dog');
  select deck[1] into v_third from public.solo_secrets where round_id = r.id;
  d := private.bjv_cards(r.state -> 'cards');
  v_bet := (r.state ->> 'bet')::bigint;
  v_staked := v_bet;
  if p_raise then
    perform private.apply_chips(v_uid, -v_bet, 'bet', 'red_dog', r.id::text, jsonb_build_object('spot', 'raise'));
    v_staked := v_bet * 2;
  end if;
  lo := least(private.cg_r(d[1]), private.cg_r(d[2]));
  hi := greatest(private.cg_r(d[1]), private.cg_r(d[2]));
  t := private.cg_r(v_third);
  v_win := t > lo and t < hi;
  return private.rd_final(v_uid, r.id, d || v_third, v_staked,
                          case when v_win then v_staked * ((r.state ->> 'pays')::integer + 1) else 0 end,
                          case when v_win then 'win' else 'lose' end, (r.state ->> 'spread')::integer);
end $$;

-- =============================================================================
-- HI-LO. Is the next card higher or lower? Each right answer multiplies the prize;
-- collect whenever you like. Aces are high, and a card of the same rank loses.
-- Multiples are in hundredths of the bet and always multiples of 10, so chips stay whole.
-- =============================================================================
-- What a right "higher" and a right "lower" guess are worth from this card, in hundredths (null = impossible).
create or replace function private.hilo_step(p_card integer, out hi integer, out lo integer)
language plpgsql
immutable
set search_path = ''
as $$
declare
  r integer := private.cg_r(p_card);
  n_hi integer := 4 * (14 - r);
  n_lo integer := 4 * (r - 2);
  v_fair integer := 100 * (100 - (private.s10_cfg('hi_lo') ->> 'edge_pct')::integer) * 51 / 100;
begin
  hi := case when n_hi > 0 then greatest(100, (v_fair / n_hi) / 10 * 10) end;
  lo := case when n_lo > 0 then greatest(100, (v_fair / n_lo) / 10 * 10) end;
end $$;

create or replace function private.hilo_state(r public.solo_rounds)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select r.state || jsonb_build_object('round_id', r.id, 'hi', h.hi, 'lo', h.lo,
                                       'collect', (r.state ->> 'bet')::bigint * (r.state ->> 'units')::bigint / 100)
    from private.hilo_step((r.state ->> 'card')::integer) h
$$;

create or replace function public.hilo_start(p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_tier text;
  v_card integer;
  v_id   uuid;
  r      public.solo_rounds;
begin
  if exists (select 1 from public.solo_rounds where user_id = v_uid and game_key = 'hi_lo') then
    raise exception 'round_in_progress';
  end if;
  v_tier := private.more_bet_tier(v_uid, 'hi_lo', p_bet);
  v_card := private.random_int(52);
  v_id := private.solo_begin(v_uid, 'hi_lo', v_tier, p_bet,
                             jsonb_build_object('bet', p_bet, 'card', v_card, 'units', 100, 'steps', 0, 'seen', jsonb_build_array(v_card)),
                             '{}'::smallint[], null);
  select * into r from public.solo_rounds where id = v_id;
  return private.hilo_state(r) || jsonb_build_object('balance', private.apply_chips(v_uid, -p_bet, 'bet', 'hi_lo', v_id::text));
end $$;

create or replace function private.hilo_finish(r public.solo_rounds, p_win bigint, p_outcome text, p_last integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bet bigint := (r.state ->> 'bet')::bigint;
  v_balance bigint;
begin
  delete from public.solo_rounds where id = r.id;
  v_balance := private.apply_chips(r.user_id, p_win, 'payout', 'hi_lo', r.id::text);
  perform private.record_round(r.user_id, 'hi_lo', null, r.id, v_bet, p_win,
                               jsonb_build_object('outcome', p_outcome, 'steps', (r.state ->> 'steps')::integer, 'units', (r.state ->> 'units')::integer));
  return r.state || jsonb_build_object('round_id', r.id, 'final', true, 'outcome', p_outcome, 'card', p_last,
                                       'staked', v_bet, 'win', p_win, 'balance', v_balance);
end $$;

-- p_dir: 'hi' or 'lo'.
create or replace function public.hilo_guess(p_dir text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  r      public.solo_rounds;
  v_card integer;
  v_next integer;
  st     record;
  v_step integer;
  v_right boolean;
  v_units bigint;
begin
  r := private.solo_open_round(v_uid, 'hi_lo');
  v_card := (r.state ->> 'card')::integer;
  select * into st from private.hilo_step(v_card);
  v_step := case p_dir when 'hi' then st.hi when 'lo' then st.lo end;
  if v_step is null then
    raise exception 'action_not_allowed' using hint = 'Nothing can be that way from this card.';
  end if;
  -- The next card is any of the other 51.
  v_next := private.random_int(51);
  if v_next >= v_card then
    v_next := v_next + 1;
  end if;
  v_right := case p_dir when 'hi' then private.cg_r(v_next) > private.cg_r(v_card) else private.cg_r(v_next) < private.cg_r(v_card) end;
  if not v_right then
    return private.hilo_finish(r, 0, 'lose', v_next);
  end if;
  v_units := least((private.s10_cfg('hi_lo') ->> 'max_units')::bigint, ((r.state ->> 'units')::bigint * v_step / 100) / 10 * 10);
  update public.solo_rounds
     set state = state || jsonb_build_object('card', v_next, 'units', v_units, 'steps', (state ->> 'steps')::integer + 1,
                                             'seen', (state -> 'seen') || to_jsonb(v_next))
   where id = r.id returning * into r;
  -- At the largest prize there is nothing more to play for.
  if v_units >= (private.s10_cfg('hi_lo') ->> 'max_units')::bigint then
    return private.hilo_finish(r, (r.state ->> 'bet')::bigint * v_units / 100, 'collect', v_next);
  end if;
  return private.hilo_state(r) || jsonb_build_object('balance', (select balance from public.wallets where user_id = v_uid));
end $$;

create or replace function public.hilo_collect()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r     public.solo_rounds;
begin
  r := private.solo_open_round(v_uid, 'hi_lo');
  if (r.state ->> 'steps')::integer < 1 then
    raise exception 'action_not_allowed' using hint = 'Make at least one guess first.';
  end if;
  return private.hilo_finish(r, (r.state ->> 'bet')::bigint * (r.state ->> 'units')::bigint / 100, 'collect', (r.state ->> 'card')::integer);
end $$;

-- =============================================================================
-- ANDAR BAHAR. One card is turned (the joker). Cards are then dealt in turn to
-- Andar and Bahar, Andar first, until one matches the joker's rank. Andar gets the
-- first card so it wins a little more often: it pays 1 to 1 less a commission.
-- =============================================================================
create or replace function public.andar_bahar_deal(p_tier text, p_bets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  c        jsonb := private.s10_cfg('andar_bahar');
  v_staked bigint := private.solo_spots(v_uid, 'andar_bahar', p_tier, p_bets, '^(andar|bahar)$');
  v_round  uuid := gen_random_uuid();
  d        smallint[] := private.shuffled_shoe(1);
  v_andar  smallint[] := '{}';
  v_bahar  smallint[] := '{}';
  v_winner text;
  i        integer := 2;
  v_ret    jsonb := '{}'::jsonb;
  v_total  bigint := 0;
  v_amount bigint;
begin
  loop
    if i % 2 = 0 then v_andar := v_andar || d[i]; else v_bahar := v_bahar || d[i]; end if;
    if d[i] % 13 = d[1] % 13 then
      v_winner := case when i % 2 = 0 then 'andar' else 'bahar' end;
      exit;
    end if;
    i := i + 1;
  end loop;
  v_amount := coalesce((p_bets ->> v_winner)::bigint, 0);
  if v_amount > 0 then
    v_total := v_amount * 2 - case when v_winner = 'andar' then private.commission(v_amount, (c ->> 'commission_pct')::integer) else 0 end;
    v_ret := jsonb_build_object(v_winner, v_total);
  end if;
  return jsonb_build_object(
    'round_id', v_round, 'joker', d[1], 'andar', to_jsonb(v_andar), 'bahar', to_jsonb(v_bahar), 'winner', v_winner,
    'bets', p_bets, 'returns', v_ret, 'staked', v_staked, 'win', v_total,
    'balance', private.solo_settle(v_uid, 'andar_bahar', v_round, v_staked, v_total,
                                   jsonb_build_object('winner', v_winner, 'cards', cardinality(v_andar) + cardinality(v_bahar))));
end $$;

-- =============================================================================
-- CHUCK-A-LUCK. Three dice.
--   n1..n6  a number: pays 1, 2 or 10 to 1 for one, two or three of it
--   high / low   total 11+ / 10 or less, 1 to 1; a triple loses
--   field   total 5 to 8 or 13 to 16, 1 to 1
--   triple  any three of a kind, 30 to 1
-- =============================================================================
create or replace function private.chuck_pays(p_spot text, d integer[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  c jsonb := private.s10_cfg('chuck_a_luck');
  v_total integer := d[1] + d[2] + d[3];
  v_triple boolean := d[1] = d[2] and d[2] = d[3];
  n integer;
begin
  if p_spot ~ '^n[1-6]$' then
    n := (select count(*) from unnest(d) x where x = substr(p_spot, 2)::integer);
    return case when n > 0 then (c -> 'pays' -> 'number' ->> (n - 1))::integer end;
  elsif p_spot = 'high' then
    return case when v_total >= 11 and not v_triple then 1 end;
  elsif p_spot = 'low' then
    return case when v_total <= 10 and not v_triple then 1 end;
  elsif p_spot = 'field' then
    return case when c -> 'field' @> to_jsonb(v_total) then 1 end;
  elsif p_spot = 'triple' then
    return case when v_triple then (c -> 'pays' ->> 'triple')::integer end;
  end if;
  return null;
end $$;

create or replace function public.chuck_roll(p_tier text, p_bets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_staked bigint := private.solo_spots(v_uid, 'chuck_a_luck', p_tier, p_bets, '^(n[1-6]|high|low|field|triple)$');
  v_round  uuid := gen_random_uuid();
  d        integer[] := array[private.random_int(6) + 1, private.random_int(6) + 1, private.random_int(6) + 1];
  b        record;
  m        integer;
  v_back   bigint;
  v_returns jsonb := '{}'::jsonb;
  v_total  bigint := 0;
begin
  for b in select key, (value #>> '{}')::bigint as amount from jsonb_each(p_bets) loop
    m := private.chuck_pays(b.key, d);
    v_back := case when m is null then 0 else b.amount * (m + 1) end;
    v_returns := v_returns || jsonb_build_object(b.key, v_back);
    v_total := v_total + v_back;
  end loop;
  return jsonb_build_object(
    'round_id', v_round, 'dice', to_jsonb(d), 'total', d[1] + d[2] + d[3], 'triple', d[1] = d[2] and d[2] = d[3],
    'bets', p_bets, 'returns', v_returns, 'staked', v_staked, 'win', v_total,
    'balance', private.solo_settle(v_uid, 'chuck_a_luck', v_round, v_staked, v_total, jsonb_build_object('dice', to_jsonb(d))));
end $$;

-- Rules, stake levels, bet steps and any round left open, for all eight games here.
create or replace function public.quick_info(p_game text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.s10_cfg(p_game);
  g public.games;
  r public.solo_rounds;
begin
  select * into g from public.games where key = p_game;
  if c is null or not found then
    raise exception 'unknown_game';
  end if;
  select * into r from public.solo_rounds where user_id = v_uid and game_key = p_game;
  return jsonb_build_object(
    'game', g.key, 'name', g.name, 'released', g.released, 'config', c,
    'bets', (select coalesce(jsonb_agg(b order by b), '[]'::jsonb) from unnest(private.slot_bets()) b
              where exists (select 1 from public.stake_tiers t where t.game_key = p_game and b between t.min_bet and t.max_bet)),
    'tiers', (select jsonb_agg(jsonb_build_object('tier', t.tier, 'label', t.label, 'min_bet', t.min_bet,
                                                  'max_bet', t.max_bet, 'min_bankroll', t.min_bankroll) order by t.tier_rank)
                from public.stake_tiers t where t.game_key = p_game),
    'round', case when r.id is null then null
                  when p_game = 'hi_lo' then private.hilo_state(r) || jsonb_build_object('tier', r.tier)
                  else r.state || jsonb_build_object('round_id', r.id, 'tier', r.tier) end);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.bjv_deal(text, text, bigint)', 'public.bjv_act(text, text)', 'public.reddog_deal(bigint)', 'public.reddog_act(boolean)',
    'public.hilo_start(bigint)', 'public.hilo_guess(text)', 'public.hilo_collect()', 'public.andar_bahar_deal(text, jsonb)',
    'public.chuck_roll(text, jsonb)', 'public.quick_info(text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

update public.games set released = true
 where key in ('spanish_21', 'blackjack_switch', 'free_bet_blackjack', 'pontoon', 'red_dog', 'hi_lo', 'andar_bahar', 'chuck_a_luck');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

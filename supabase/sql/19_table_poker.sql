-- =============================================================================
-- All In · 19_table_poker.sql
-- Stage 10, part 1: six card games against the dealer, on one small engine.
--   Caribbean Stud · Casino Hold'em · Let It Ride · Mississippi Stud ·
--   Four Card Poker · Teen Patti
-- Run AFTER 01-18 (re-run 03_games_and_stakes.sql first: it lists these games; and
-- 11_solo_games.sql, which gained three video poker paytables). Safe to re-run.
--
-- Every game is: tp_deal(game, tier, bets), then tp_act(game, action) one or more
-- times. The open round lives in solo_rounds (what the player may see) and
-- solo_secrets (the cards still face down), exactly like Three Card Poker.
-- `state.actions` lists what the player may do next and what each costs, so the
-- browser needs no rules of its own.
-- =============================================================================

do $$
begin
  if (select count(*) from public.games where key in ('caribbean_stud', 'casino_holdem', 'let_it_ride',
                                                      'mississippi_stud', 'four_card_poker', 'teen_patti')) < 6 then
    raise exception 'Run 03_games_and_stakes.sql again first: it adds these games to the catalogue.';
  end if;
end $$;

-- Paytables are "to 1". `spots` are the bets placed before the deal (the first is required).
create or replace function private.tp_cfg(p_game text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select ($cfg$
{
  "caribbean_stud": {
    "spots": ["ante"], "reserve": 2,
    "raise_pays": {"royal_flush": 100, "straight_flush": 50, "four_kind": 20, "full_house": 7, "flush": 5,
                   "straight": 4, "three_kind": 3, "two_pair": 2, "pair": 1, "high_card": 1},
    "paytables": [{"title": "Raise bet, when you beat a dealer who qualifies", "key": "raise_pays"}]
  },
  "casino_holdem": {
    "spots": ["ante"], "reserve": 2,
    "ante_pays": {"royal_flush": 100, "straight_flush": 20, "four_kind": 10, "full_house": 3, "flush": 2,
                  "straight": 1, "three_kind": 1, "two_pair": 1, "pair": 1, "high_card": 1},
    "paytables": [{"title": "Ante, when you win or the dealer doesn't qualify", "key": "ante_pays"}]
  },
  "let_it_ride": {
    "spots": ["bet"], "upfront": 3, "reserve": 0,
    "pays": {"royal_flush": 1000, "straight_flush": 200, "four_kind": 50, "full_house": 11, "flush": 8,
             "straight": 5, "three_kind": 3, "two_pair": 2, "tens_or_better": 1},
    "paytables": [{"title": "Every bet still riding", "key": "pays"}]
  },
  "mississippi_stud": {
    "spots": ["ante"], "reserve": 3,
    "pays": {"royal_flush": 500, "straight_flush": 100, "four_kind": 40, "full_house": 10, "flush": 6,
             "straight": 4, "three_kind": 3, "two_pair": 2, "jacks_or_better": 1, "mid_pair": 0},
    "paytables": [{"title": "All your bets (a pair of sixes to tens returns them)", "key": "pays"}]
  },
  "four_card_poker": {
    "spots": ["ante", "aces_up"], "reserve": 1,
    "ante_bonus": {"four_kind": 25, "straight_flush": 20, "three_kind": 2},
    "aces_up": {"four_kind": 50, "straight_flush": 40, "three_kind": 8, "flush": 5, "straight": 4, "two_pair": 3, "pair_aces": 1},
    "paytables": [{"title": "Ante bonus (paid even if the dealer wins)", "key": "ante_bonus"}, {"title": "Aces Up side bet", "key": "aces_up"}]
  },
  "teen_patti": {
    "spots": ["ante", "pair_plus"], "reserve": 1,
    "ante_bonus": {"trail": 5, "pure_sequence": 4, "sequence": 1},
    "pair_plus": {"pure_sequence": 40, "trail": 30, "sequence": 6, "colour": 4, "pair": 1},
    "paytables": [{"title": "Ante bonus (paid whenever you play)", "key": "ante_bonus"}, {"title": "Pair Plus side bet", "key": "pair_plus"}]
  }
}
  $cfg$::jsonb) -> p_game
$fn$;

-- -----------------------------------------------------------------------------
-- Hand values
-- -----------------------------------------------------------------------------
create or replace function private.tp_score5(p_cards smallint[])
returns bigint language sql immutable set search_path = '' as $$
  select private.cg_score5((select array_agg(private.cg_r(x)) from unnest(p_cards) x),
                           (select array_agg(private.cg_s(x)) from unnest(p_cards) x))
$$;

create or replace function private.tp_name5(p_score bigint)
returns text language sql immutable set search_path = '' as $$
  select case when p_score / 759375 = 8 and (p_score / 50625) % 15 = 14 then 'royal_flush' else private.cg_cat5_name(p_score) end
$$;

-- Four cards: four of a kind, straight flush, three of a kind, flush, straight, two pair, pair, high card.
create or replace function private.fc_score4(p_cards smallint[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_r integer[];
  v_n integer[];
  v_flush boolean;
  v_straight integer := 0;
  v_cat integer;
  v_tb integer[] := '{}';
  v integer;
begin
  select array_agg(g.r order by g.n desc, g.r desc), array_agg(g.n order by g.n desc, g.r desc) into v_r, v_n
    from (select private.cg_r(x) as r, count(*)::integer as n from unnest(p_cards) x group by 1) g;
  v_flush := (select count(distinct private.cg_s(x)) from unnest(p_cards) x) = 1;
  if cardinality(v_r) = 4 then
    if v_r[1] - v_r[4] = 3 then
      v_straight := v_r[1];
    elsif v_r[1] = 14 and v_r[2] = 4 and v_r[4] = 2 then
      v_straight := 4;  -- A-2-3-4
    end if;
  end if;
  v_cat := case
    when v_n[1] = 4 then 7
    when v_straight > 0 and v_flush then 6
    when v_n[1] = 3 then 5
    when cardinality(v_r) = 4 and v_flush then 4
    when v_straight > 0 then 3
    when v_n[1] = 2 and v_n[2] = 2 then 2
    when v_n[1] = 2 then 1
    else 0 end;
  if v_straight > 0 then
    v_tb := array[v_straight, 0, 0, 0];
  else
    for i in 1..cardinality(v_r) loop
      v_tb := v_tb || array_fill(v_r[i], array[v_n[i]]);
    end loop;
  end if;
  v := v_cat;
  for i in 1..4 loop
    v := v * 15 + v_tb[i];
  end loop;
  return v;
end $$;

-- The best four-card hand in five or six cards.
create or replace function private.fc_best(p_cards smallint[])
returns integer
language sql
immutable
set search_path = ''
as $$
  select max(private.fc_score4(array[p_cards[a], p_cards[b], p_cards[c], p_cards[d]]))
    from generate_series(1, cardinality(p_cards)) a, generate_series(1, cardinality(p_cards)) b,
         generate_series(1, cardinality(p_cards)) c, generate_series(1, cardinality(p_cards)) d
   where a < b and b < c and c < d
$$;

create or replace function private.fc_name(p_score integer)
returns text language sql immutable set search_path = '' as $$
  select (array['high_card', 'pair', 'two_pair', 'straight', 'flush', 'three_kind', 'straight_flush', 'four_kind'])[p_score / 50625 + 1]
$$;

-- Teen Patti, three cards: trail (three of a kind), pure sequence, sequence, colour, pair, high card.
-- A-K-Q is the best sequence and A-2-3 the second best.
create or replace function private.tpt_score(p_cards smallint[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  r integer[];
  v_flush boolean := p_cards[1] / 13 = p_cards[2] / 13 and p_cards[2] / 13 = p_cards[3] / 13;
  v_seq integer := 0;
  v_cat integer;
  t integer[];
begin
  select array_agg(private.cg_r(x) order by private.cg_r(x) desc) into r from unnest(p_cards) x;
  if r[1] <> r[2] and r[2] <> r[3] then
    if r[1] = 14 and r[2] = 13 and r[3] = 12 then
      v_seq := 15;
    elsif r[1] = 14 and r[2] = 3 and r[3] = 2 then
      v_seq := 14;
    elsif r[1] - r[3] = 2 then
      v_seq := r[1];
    end if;
  end if;
  if r[1] = r[3] then v_cat := 5; t := array[r[1], 0, 0];
  elsif v_seq > 0 and v_flush then v_cat := 4; t := array[v_seq, 0, 0];
  elsif v_seq > 0 then v_cat := 3; t := array[v_seq, 0, 0];
  elsif v_flush then v_cat := 2; t := r;
  elsif r[1] = r[2] then v_cat := 1; t := array[r[1], r[3], 0];
  elsif r[2] = r[3] then v_cat := 1; t := array[r[2], r[1], 0];
  else v_cat := 0; t := r;
  end if;
  return ((v_cat * 16 + t[1]) * 16 + t[2]) * 16 + t[3];
end $$;

create or replace function private.tpt_name(p_score integer)
returns text language sql immutable set search_path = '' as $$
  select (array['high_card', 'pair', 'colour', 'sequence', 'pure_sequence', 'trail'])[p_score / 4096 + 1]
$$;

-- What the player may do at a stage, and what each choice costs.
create or replace function private.tp_actions(p_game text, p_stage text, p_main bigint)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_game = 'caribbean_stud' then jsonb_build_array(jsonb_build_object('key', 'fold', 'cost', 0), jsonb_build_object('key', 'raise', 'cost', p_main * 2))
    when p_game = 'casino_holdem'  then jsonb_build_array(jsonb_build_object('key', 'fold', 'cost', 0), jsonb_build_object('key', 'call', 'cost', p_main * 2))
    when p_game = 'teen_patti'     then jsonb_build_array(jsonb_build_object('key', 'fold', 'cost', 0), jsonb_build_object('key', 'play', 'cost', p_main))
    when p_game = 'let_it_ride'    then jsonb_build_array(jsonb_build_object('key', 'pull', 'cost', 0), jsonb_build_object('key', 'ride', 'cost', 0))
    when p_game in ('mississippi_stud', 'four_card_poker') then jsonb_build_array(
      jsonb_build_object('key', 'fold', 'cost', 0), jsonb_build_object('key', 'bet1', 'cost', p_main),
      jsonb_build_object('key', 'bet2', 'cost', p_main * 2), jsonb_build_object('key', 'bet3', 'cost', p_main * 3))
  end
$$;

-- The name of the hand the player holds so far (null when it is too early to say).
create or replace function private.tp_made(p_game text, p_hand smallint[], p_board smallint[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_all smallint[] := p_hand || coalesce(p_board, '{}'::smallint[]);
  v bigint;
  v_pair integer;
begin
  if p_game = 'teen_patti' then
    return private.tpt_name(private.tpt_score(p_hand));
  elsif p_game = 'four_card_poker' then
    return private.fc_name(private.fc_best(p_hand));
  elsif p_game = 'casino_holdem' then
    return private.uth_made((private.pk_best(p_hand, p_board, false)).score);
  elsif cardinality(v_all) < 5 then
    return null;
  end if;
  v := private.tp_score5(v_all);
  v_pair := case when v / 759375 = 1 then ((v / 50625) % 15)::integer end;
  if p_game = 'let_it_ride' and v_pair is not null then
    return case when v_pair >= 10 then 'tens_or_better' else 'low_pair' end;
  elsif p_game = 'mississippi_stud' and v_pair is not null then
    return case when v_pair >= 11 then 'jacks_or_better' when v_pair >= 6 then 'mid_pair' else 'low_pair' end;
  end if;
  return private.tp_name5(v);
end $$;

-- -----------------------------------------------------------------------------
-- Deal
-- -----------------------------------------------------------------------------
-- p_bets: {"ante": 100} plus any side bets, e.g. {"ante": 100, "aces_up": 50}. Let It Ride takes {"bet": 100}
-- and puts down three of them.
create or replace function public.tp_deal(p_game text, p_tier text, p_bets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  c       jsonb := private.tp_cfg(p_game);
  v_main_key text;
  v_main  bigint;
  v_staked bigint;
  d       smallint[];
  v_hand  smallint[];
  v_board smallint[] := '{}';
  v_dealer smallint[] := '{}';
  v_secret smallint[];
  v_stage text := 'decide';
  v_bets  jsonb;
  v_state jsonb;
  v_id    uuid;
begin
  if c is null then
    raise exception 'unknown_game';
  end if;
  if exists (select 1 from public.solo_rounds where user_id = v_uid and game_key = p_game) then
    raise exception 'round_in_progress';
  end if;
  v_main_key := c -> 'spots' ->> 0;
  if p_bets is null or jsonb_typeof(p_bets) <> 'object' or not (p_bets ? v_main_key) then
    raise exception 'invalid_bet';
  end if;
  v_staked := private.solo_spots(v_uid, p_game, p_tier, p_bets,
                                 '^(' || (select string_agg(x, '|') from jsonb_array_elements_text(c -> 'spots') x) || ')$');
  v_main := (p_bets ->> v_main_key)::bigint;
  v_bets := p_bets;
  -- Let It Ride: three equal bets go down.
  if c ? 'upfront' then
    v_staked := v_staked + v_main * ((c ->> 'upfront')::integer - 1);
    v_bets := jsonb_build_object('bet', v_main * (c ->> 'upfront')::integer);
  end if;
  if (select balance from public.wallets where user_id = v_uid) < v_staked + v_main * (c ->> 'reserve')::integer then
    raise exception 'insufficient_chips' using hint = 'You need enough chips for the bets that come later in the hand too.';
  end if;

  d := private.shuffled_shoe(1);
  if p_game = 'caribbean_stud' then
    v_hand := d[1:5]; v_dealer := d[6:6]; v_secret := d[6:10];
  elsif p_game = 'casino_holdem' then
    v_hand := d[1:2]; v_board := d[5:7]; v_secret := d[3:4] || d[8:9];
  elsif p_game = 'let_it_ride' then
    v_hand := d[1:3]; v_secret := d[4:5]; v_stage := 'first';
  elsif p_game = 'mississippi_stud' then
    v_hand := d[1:2]; v_secret := d[3:5]; v_stage := 'third';
  elsif p_game = 'four_card_poker' then
    v_hand := d[1:5]; v_dealer := d[6:6]; v_secret := d[6:11];
  else  -- teen_patti
    v_hand := d[1:3]; v_secret := d[4:6];
  end if;

  v_state := jsonb_build_object(
    'game', p_game, 'stage', v_stage, 'hand', to_jsonb(v_hand), 'board', to_jsonb(v_board), 'dealer', to_jsonb(v_dealer),
    'main', v_main, 'bets', v_bets, 'made', private.tp_made(p_game, v_hand, v_board),
    'actions', private.tp_actions(p_game, v_stage, v_main));
  v_id := private.solo_begin(v_uid, p_game, p_tier, v_staked, v_state, v_secret, null);
  return v_state || jsonb_build_object(
    'round_id', v_id,
    'balance', private.apply_chips(v_uid, -v_staked, 'bet', p_game, v_id::text));
end $$;

-- -----------------------------------------------------------------------------
-- Act
-- -----------------------------------------------------------------------------
create or replace function public.tp_act(p_game text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  c       jsonb := private.tp_cfg(p_game);
  r       public.solo_rounds;
  s       jsonb;
  v_deck  smallint[];
  v_hand  smallint[];
  v_board smallint[];
  v_dealer smallint[];
  v_main  bigint;
  v_bets  jsonb;
  v_stage text;
  v_cost  bigint;
  v_staked bigint;
  v_done  boolean := false;
  v_outcome text;
  v_made  text;
  v_dealer_made text;
  v_qual  boolean;
  v_ret   jsonb := '{}'::jsonb;
  v_mult  integer;
  v_total bigint := 0;
  v_wagered bigint;
  ps      bigint;
  ds      bigint;
  pb      record;
  db      record;
  v_balance bigint;
  x       record;
begin
  if c is null then
    raise exception 'unknown_game';
  end if;
  r := private.solo_open_round(v_uid, p_game);
  s := r.state;
  select (a ->> 'cost')::bigint into v_cost from jsonb_array_elements(s -> 'actions') a where a ->> 'key' = p_action;
  if v_cost is null then
    raise exception 'action_not_allowed' using hint = 'That isn''t one of your choices right now.';
  end if;
  select deck into v_deck from public.solo_secrets where round_id = r.id;
  select coalesce(array_agg(e::smallint order by o), '{}') into v_hand from jsonb_array_elements_text(s -> 'hand') with ordinality t(e, o);
  select coalesce(array_agg(e::smallint order by o), '{}') into v_board from jsonb_array_elements_text(s -> 'board') with ordinality t(e, o);
  select coalesce(array_agg(e::smallint order by o), '{}') into v_dealer from jsonb_array_elements_text(s -> 'dealer') with ordinality t(e, o);
  v_main := (s ->> 'main')::bigint;
  v_bets := s -> 'bets';
  v_stage := s ->> 'stage';
  v_staked := r.staked;

  if v_cost > 0 then
    perform private.apply_chips(v_uid, -v_cost, 'bet', p_game, r.id::text, jsonb_build_object('spot', p_action));
    v_staked := v_staked + v_cost;
  end if;

  -- ---------------------------------------------------------------- Caribbean Stud
  if p_game = 'caribbean_stud' then
    v_done := true;
    v_dealer := v_deck[1:5];
    ps := private.tp_score5(v_hand);
    ds := private.tp_score5(v_dealer);
    v_made := private.tp_name5(ps);
    v_dealer_made := private.tp_name5(ds);
    -- The dealer plays with ace-king high or better.
    v_qual := ds >= private.cg_score5(array[14, 13, 4, 3, 2], array[0, 1, 2, 3, 0]);
    if p_action = 'fold' then
      v_outcome := 'fold';
    else
      v_bets := v_bets || jsonb_build_object('raise', v_cost);
      if not v_qual then
        v_outcome := 'no_qualify';
        v_ret := jsonb_build_object('ante', v_main * 2, 'raise', v_cost);
      elsif ps > ds then
        v_outcome := 'win';
        v_ret := jsonb_build_object('ante', v_main * 2, 'raise', v_cost * ((c -> 'raise_pays' ->> v_made)::integer + 1));
      elsif ps = ds then
        v_outcome := 'tie';
        v_ret := jsonb_build_object('ante', v_main, 'raise', v_cost);
      else
        v_outcome := 'lose';
      end if;
    end if;

  -- ---------------------------------------------------------------- Casino Hold'em
  elsif p_game = 'casino_holdem' then
    v_done := true;
    v_dealer := v_deck[1:2];
    v_board := v_board || v_deck[3:4];
    select * into pb from private.pk_best(v_hand, v_board, false);
    select * into db from private.pk_best(v_dealer, v_board, false);
    v_made := private.uth_made(pb.score);
    v_dealer_made := private.uth_made(db.score);
    -- The dealer plays with a pair of fours or better.
    v_qual := (db.score >> 20) > 1 or ((db.score >> 20) = 1 and ((db.score >> 16) & 15) >= 4);
    v_mult := (c -> 'ante_pays' ->> v_made)::integer;
    if p_action = 'fold' then
      v_outcome := 'fold';
    else
      v_bets := v_bets || jsonb_build_object('call', v_cost);
      if not v_qual then
        v_outcome := 'no_qualify';
        v_ret := jsonb_build_object('ante', v_main * (v_mult + 1), 'call', v_cost);
      elsif pb.score > db.score then
        v_outcome := 'win';
        v_ret := jsonb_build_object('ante', v_main * (v_mult + 1), 'call', v_cost * 2);
      elsif pb.score = db.score then
        v_outcome := 'tie';
        v_ret := jsonb_build_object('ante', v_main, 'call', v_cost);
      else
        v_outcome := 'lose';
      end if;
    end if;

  -- ---------------------------------------------------------------- Let It Ride
  elsif p_game = 'let_it_ride' then
    if p_action = 'pull' then
      -- One bet comes back now. It was never played, so it is neither wagered nor won.
      perform private.apply_chips(v_uid, v_main, 'refund', p_game, r.id::text);
      v_staked := v_staked - v_main;
      v_bets := jsonb_build_object('bet', (v_bets ->> 'bet')::bigint - v_main);
    end if;
    if v_stage = 'first' then
      v_board := v_deck[1:1];
      v_stage := 'second';
    else
      v_board := v_deck[1:2];
      v_done := true;
      v_made := private.tp_made(p_game, v_hand, v_board);
      v_mult := (c -> 'pays' ->> v_made)::integer;
      if v_mult is not null then
        v_outcome := 'win';
        v_ret := jsonb_build_object('bet', (v_bets ->> 'bet')::bigint * (v_mult + 1));
      else
        v_outcome := 'lose';
      end if;
    end if;

  -- ---------------------------------------------------------------- Mississippi Stud
  elsif p_game = 'mississippi_stud' then
    if p_action = 'fold' then
      v_done := true;
      v_outcome := 'fold';
      v_board := v_deck[1:cardinality(v_board)];
    else
      v_bets := v_bets || jsonb_build_object(v_stage, v_cost);
      v_board := v_deck[1:cardinality(v_board) + 1];
      if v_stage = 'third' then v_stage := 'fourth';
      elsif v_stage = 'fourth' then v_stage := 'fifth';
      else
        v_done := true;
        v_made := private.tp_made(p_game, v_hand, v_board);
        v_mult := (c -> 'pays' ->> v_made)::integer;
        if v_mult is null then
          v_outcome := 'lose';
        else
          v_outcome := case when v_mult = 0 then 'push' else 'win' end;
          for x in select key, value::bigint as amount from jsonb_each_text(v_bets) loop
            v_ret := v_ret || jsonb_build_object(x.key, x.amount * (v_mult + 1));
          end loop;
        end if;
      end if;
    end if;

  -- ---------------------------------------------------------------- Four Card Poker
  elsif p_game = 'four_card_poker' then
    v_done := true;
    v_dealer := v_deck[1:6];
    ps := private.fc_best(v_hand);
    ds := private.fc_best(v_dealer);
    v_made := private.fc_name(ps::integer);
    v_dealer_made := private.fc_name(ds::integer);
    -- Aces Up pays on your own hand, whatever happens next.
    if v_bets ? 'aces_up' then
      v_mult := (c -> 'aces_up' ->> case when v_made = 'pair' and (ps / 3375) % 15 = 14 then 'pair_aces' else v_made end)::integer;
      if v_mult is not null then
        v_ret := v_ret || jsonb_build_object('aces_up', (v_bets ->> 'aces_up')::bigint * (v_mult + 1));
      end if;
    end if;
    if p_action = 'fold' then
      v_outcome := 'fold';
    else
      v_bets := v_bets || jsonb_build_object('raise', v_cost);
      if c -> 'ante_bonus' ? v_made then
        v_ret := v_ret || jsonb_build_object('ante_bonus', v_main * (c -> 'ante_bonus' ->> v_made)::integer);
      end if;
      -- The player wins ties.
      if ps >= ds then
        v_outcome := 'win';
        v_ret := v_ret || jsonb_build_object('ante', v_main * 2, 'raise', v_cost * 2);
      else
        v_outcome := 'lose';
      end if;
    end if;

  -- ---------------------------------------------------------------- Teen Patti
  else
    v_done := true;
    v_dealer := v_deck[1:3];
    ps := private.tpt_score(v_hand);
    ds := private.tpt_score(v_dealer);
    v_made := private.tpt_name(ps::integer);
    v_dealer_made := private.tpt_name(ds::integer);
    -- The dealer plays with queen high or better.
    v_qual := ds >= 12 * 256;
    if v_bets ? 'pair_plus' and c -> 'pair_plus' ? v_made then
      v_ret := v_ret || jsonb_build_object('pair_plus', (v_bets ->> 'pair_plus')::bigint * ((c -> 'pair_plus' ->> v_made)::integer + 1));
    end if;
    if p_action = 'fold' then
      v_outcome := 'fold';
    else
      v_bets := v_bets || jsonb_build_object('play', v_cost);
      if c -> 'ante_bonus' ? v_made then
        v_ret := v_ret || jsonb_build_object('ante_bonus', v_main * (c -> 'ante_bonus' ->> v_made)::integer);
      end if;
      if not v_qual then
        v_outcome := 'no_qualify';
        v_ret := v_ret || jsonb_build_object('ante', v_main * 2, 'play', v_cost);
      elsif ps > ds then
        v_outcome := 'win';
        v_ret := v_ret || jsonb_build_object('ante', v_main * 2, 'play', v_cost * 2);
      elsif ps = ds then
        v_outcome := 'tie';
        v_ret := v_ret || jsonb_build_object('ante', v_main, 'play', v_cost);
      else
        v_outcome := 'lose';
      end if;
    end if;
  end if;

  s := s || jsonb_build_object('stage', v_stage, 'board', to_jsonb(v_board), 'dealer', to_jsonb(v_dealer), 'bets', v_bets,
                               'made', coalesce(v_made, private.tp_made(p_game, v_hand, v_board)),
                               'actions', case when v_done then '[]'::jsonb else private.tp_actions(p_game, v_stage, v_main) end);
  if not v_done then
    update public.solo_rounds set state = s, staked = v_staked where id = r.id;
    return s || jsonb_build_object('round_id', r.id, 'balance', (select balance from public.wallets where user_id = v_uid));
  end if;

  select coalesce(sum(value::bigint), 0) into v_total from jsonb_each_text(v_ret);
  v_wagered := v_staked;
  delete from public.solo_rounds where id = r.id;
  v_balance := private.apply_chips(v_uid, v_total, 'payout', p_game, r.id::text);
  perform private.record_round(v_uid, p_game, null, r.id, v_wagered, v_total,
                               jsonb_build_object('outcome', v_outcome, 'made', s ->> 'made', 'hand', to_jsonb(v_hand),
                                                  'main', v_main, 'bets', v_bets));
  return s || jsonb_build_object(
    'round_id', r.id, 'final', true, 'outcome', v_outcome, 'dealer_made', v_dealer_made, 'qualifies', v_qual,
    'returns', v_ret, 'staked', v_wagered, 'win', v_total, 'balance', v_balance);
end $$;

-- Rules, paytables, stake levels and any hand left open.
create or replace function public.game_info(p_game text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.tp_cfg(p_game);
  g public.games;
begin
  select * into g from public.games where key = p_game;
  if c is null or not found then
    raise exception 'unknown_game';
  end if;
  return jsonb_build_object(
    'game', g.key, 'name', g.name, 'released', g.released, 'config', c, 'bets', '[]'::jsonb,
    'tiers', (select jsonb_agg(jsonb_build_object('tier', t.tier, 'label', t.label, 'min_bet', t.min_bet,
                                                  'max_bet', t.max_bet, 'min_bankroll', t.min_bankroll) order by t.tier_rank)
                from public.stake_tiers t where t.game_key = p_game),
    'round', (select r.state || jsonb_build_object('round_id', r.id, 'tier', r.tier)
                from public.solo_rounds r where r.user_id = v_uid and r.game_key = p_game));
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['public.tp_deal(text, text, jsonb)', 'public.tp_act(text, text)', 'public.game_info(text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

update public.games set released = true
 where key in ('caribbean_stud', 'casino_holdem', 'let_it_ride', 'mississippi_stud', 'four_card_poker', 'teen_patti');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

-- =============================================================================
-- All In · 11_solo_games.sql
-- Eight solo games against the house. No tables, seats or timers.
--
--   baccarat            Player / Banker / Tie and pair bets, 8-deck shoe
--   video_poker_jacks   Jacks or Better (9/6)
--   video_poker_deuces  Deuces Wild
--   three_card_poker    Ante, Play and Pair Plus
--   pai_gow_poker       Seven cards set into a five-card and a two-card hand (53 cards, with the joker)
--   sic_bo              Three dice
--   keno                Pick 1 to 10 numbers, 20 of 80 are drawn
--   money_wheel         Big Six wheel, 54 segments
--
-- Two shapes of game:
--   * One call (baccarat, sic bo, keno, the wheel): the function takes the
--     bets, draws, pays and returns the result.
--   * Two calls (video poker, Three Card Poker, Pai Gow): the first call takes
--     the bet and deals; the player decides; the second call finishes. The
--     round in between lives in solo_rounds (what the player may see) and
--     solo_secrets (the rest of the deck and the dealer's cards: RLS on, no
--     policies, no privileges). A player has at most one open round per game,
--     it waits for them as long as it takes, and its chips count as in play.
--
-- Stake levels: games with several betting spots take the level as a parameter
-- and every spot must be inside that level's range. Games with one bet use the
-- lowest level whose range contains the bet, like the slots.
--
-- Cards are 0..51 (rank = c % 13, 0 = Ace … 12 = King; suit = c / 13); 52 is
-- the joker. Every draw comes from private.shuffled_shoe / private.random_int.
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rounds that wait for the player's decision.
-- -----------------------------------------------------------------------------
create table if not exists public.solo_rounds (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  game_key    text not null references public.games (key) on delete cascade,
  tier        text not null,
  -- Chips riding on the round right now.
  staked      bigint not null check (staked >= 0),
  -- Everything the player is allowed to see.
  state       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (user_id, game_key)
);

-- HIDDEN: the undealt deck and the dealer's cards.
create table if not exists public.solo_secrets (
  round_id  uuid primary key references public.solo_rounds (id) on delete cascade,
  deck      smallint[] not null,
  data      jsonb not null default '{}'::jsonb
);

create or replace function private.solo_in_play(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(staked), 0)::bigint from public.solo_rounds where user_id = p_user;
$$;

-- -----------------------------------------------------------------------------
-- Paytables and rules the browser shows. Multipliers are "to 1" (a winning
-- 10-chip bet at 8 pays back 90) unless a game's section says otherwise.
-- -----------------------------------------------------------------------------
create or replace function private.solo_cfg(p_game text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select ($cfg$
{
  "baccarat": {
    "spots": ["player", "banker", "tie", "player_pair", "banker_pair"],
    "pays": {"player": 1, "banker": 1, "tie": 8, "player_pair": 11, "banker_pair": 11},
    "commission_pct": 5
  },
  "video_poker_jacks": {
    "returns": {"royal_flush": 800, "straight_flush": 50, "four_kind": 25, "full_house": 9, "flush": 6,
                "straight": 4, "three_kind": 3, "two_pair": 2, "jacks_or_better": 1},
    "rtp": 99.5
  },
  "video_poker_deuces": {
    "returns": {"natural_royal": 800, "four_deuces": 200, "wild_royal": 25, "five_kind": 16, "straight_flush": 10,
                "four_kind": 4, "full_house": 4, "flush": 3, "straight": 2, "three_kind": 1},
    "rtp": 99.7
  },
  "three_card_poker": {
    "pair_plus": {"straight_flush": 40, "three_kind": 30, "straight": 6, "flush": 4, "pair": 1},
    "ante_bonus": {"straight_flush": 5, "three_kind": 4, "straight": 1}
  },
  "pai_gow_poker": {
    "commission_pct": 5
  },
  "sic_bo": {
    "pays": {"small": 1, "big": 1, "odd": 1, "even": 1, "single": [1, 2, 3], "double": 10, "triple": 180,
             "any_triple": 30, "combo": 5,
             "total": {"4": 60, "5": 30, "6": 17, "7": 12, "8": 8, "9": 6, "10": 6,
                       "11": 6, "12": 6, "13": 8, "14": 12, "15": 17, "16": 30, "17": 60}}
  },
  "keno": {
    "max_picks": 10, "numbers": 80, "drawn": 20,
    "returns": {
      "1": {"1": 380},
      "2": {"2": 1560},
      "3": {"2": 200, "3": 4800},
      "4": {"2": 200, "3": 500, "4": 10000},
      "5": {"3": 300, "4": 2500, "5": 60000},
      "6": {"3": 200, "4": 600, "5": 9000, "6": 180000},
      "7": {"3": 100, "4": 400, "5": 2100, "6": 35000, "7": 500000},
      "8": {"4": 200, "5": 1400, "6": 10000, "7": 150000, "8": 1000000},
      "9": {"4": 100, "5": 700, "6": 4500, "7": 33000, "8": 400000, "9": 2500000},
      "10": {"0": 200, "5": 350, "6": 2200, "7": 15000, "8": 100000, "9": 600000, "10": 2500000}
    }
  },
  "money_wheel": {
    "pays": {"x1": 1, "x2": 2, "x5": 5, "x10": 10, "x20": 20, "joker": 45, "logo": 45},
    "wheel": ["joker","x2","x1","x5","x1","x2","x10","x1","x2","x1","x1","x5","x2","x20","x1","x2","x1","x1",
              "x5","x2","x10","x1","x1","x2","x1","x1","x5","logo","x2","x1","x2","x1","x1","x10","x5","x2",
              "x1","x2","x1","x1","x20","x2","x5","x1","x2","x1","x1","x10","x2","x5","x1","x2","x1","x1"]
  }
}
  $cfg$::jsonb) -> p_game
$fn$;

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

-- Card rank with the ace high (2..14) and suit (0..3).
create or replace function private.cg_r(c integer)
returns integer language sql immutable set search_path = '' as $$
  select case when c % 13 = 0 then 14 else c % 13 + 1 end
$$;
create or replace function private.cg_s(c integer)
returns integer language sql immutable set search_path = '' as $$
  select c / 13
$$;

-- House commission on a win, rounded up to a whole chip.
create or replace function private.commission(p_amount bigint, p_pct integer)
returns bigint language sql immutable set search_path = '' as $$
  select (p_amount * p_pct + 99) / 100
$$;

-- Checks a set of bets like {"player": 100, "tie": 10} against a stake level and
-- returns the total. Every spot must be a known one and inside the level's range.
create or replace function private.solo_spots(p_user uuid, p_game text, p_tier text, p_bets jsonb, p_pattern text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.stake_tiers;
  b record;
  v_total bigint := 0;
begin
  if not exists (select 1 from public.games where key = p_game and released) then
    raise exception 'game_not_open';
  end if;
  t := private.assert_tier_access(p_user, p_game, p_tier);
  if p_bets is null or jsonb_typeof(p_bets) <> 'object' or p_bets = '{}'::jsonb then
    raise exception 'invalid_bet';
  end if;
  for b in select key, value from jsonb_each(p_bets) loop
    if b.key !~ p_pattern then
      raise exception 'invalid_bet';
    end if;
    if jsonb_typeof(b.value) <> 'number' or (b.value #>> '{}')::numeric <> trunc((b.value #>> '{}')::numeric) then
      raise exception 'invalid_amount';
    end if;
    if (b.value #>> '{}')::numeric < t.min_bet or (b.value #>> '{}')::numeric > t.max_bet then
      raise exception 'bet_out_of_range'
        using hint = format('Each spot takes %s to %s chips at %s stakes.', t.min_bet, t.max_bet, t.label);
    end if;
    v_total := v_total + (b.value #>> '{}')::bigint;
  end loop;
  return v_total;
end $$;

-- Takes the bets, pays what came back and writes the history row: the shared
-- ending of every one-call game. Returns the new balance.
create or replace function private.solo_settle(p_user uuid, p_game text, p_round uuid,
                                               p_staked bigint, p_returned bigint, p_summary jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  perform private.apply_chips(p_user, -p_staked, 'bet', p_game, p_round::text);
  v_balance := private.apply_chips(p_user, p_returned, 'payout', p_game, p_round::text);
  perform private.record_round(p_user, p_game, null, p_round, p_staked, p_returned, p_summary);
  return v_balance;
end $$;

-- The open round of a two-call game, locked for this transaction.
create or replace function private.solo_open_round(p_user uuid, p_game text)
returns public.solo_rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.solo_rounds;
begin
  select * into r from public.solo_rounds where user_id = p_user and game_key = p_game for update;
  if not found then
    raise exception 'no_round';
  end if;
  return r;
end $$;

-- Starts a two-call round. The bet has already been taken.
create or replace function private.solo_begin(p_user uuid, p_game text, p_tier text, p_staked bigint,
                                              p_state jsonb, p_deck smallint[], p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.solo_rounds (user_id, game_key, tier, staked, state)
  values (p_user, p_game, p_tier, p_staked, p_state)
  returning id into v_id;
  insert into public.solo_secrets (round_id, deck, data) values (v_id, p_deck, coalesce(p_data, '{}'::jsonb));
  return v_id;
exception when unique_violation then
  raise exception 'round_in_progress';
end $$;

-- -----------------------------------------------------------------------------
-- Poker hand values. Bigger is better; the category is value / 15^5.
--   0 high card, 1 pair, 2 two pair, 3 three of a kind, 4 straight, 5 flush,
--   6 full house, 7 four of a kind, 8 straight flush, 9 five aces (joker).
-- Takes ranks (2..14) and suits so a joker can stand in for any card.
-- -----------------------------------------------------------------------------
create or replace function private.cg_score5(p_ranks integer[], p_suits integer[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_r integer[];
  v_n integer[];
  v_distinct boolean;
  v_flush boolean;
  v_straight integer := 0;
  v_cat integer;
  v_tb integer[] := '{}';
  v bigint;
begin
  select array_agg(g.r order by g.n desc, g.r desc), array_agg(g.n order by g.n desc, g.r desc)
    into v_r, v_n
    from (select r, count(*)::integer as n from unnest(p_ranks) r group by r) g;
  v_distinct := cardinality(v_r) = 5;
  v_flush := v_distinct and (select count(distinct s) from unnest(p_suits) s) = 1;
  if v_distinct then
    if v_r[1] - v_r[5] = 4 then
      v_straight := v_r[1];
    elsif v_r[1] = 14 and v_r[2] = 5 and v_r[5] = 2 then
      v_straight := 5;  -- A-2-3-4-5
    end if;
  end if;
  v_cat := case
    when v_n[1] = 5 then 9
    when v_straight > 0 and v_flush then 8
    when v_n[1] = 4 then 7
    when v_n[1] = 3 and v_n[2] = 2 then 6
    when v_flush then 5
    when v_straight > 0 then 4
    when v_n[1] = 3 then 3
    when v_n[1] = 2 and v_n[2] = 2 then 2
    when v_n[1] = 2 then 1
    else 0 end;
  if v_straight > 0 then
    v_tb := array[v_straight, 0, 0, 0, 0];
  else
    for i in 1..cardinality(v_r) loop
      v_tb := v_tb || array_fill(v_r[i], array[v_n[i]]);
    end loop;
  end if;
  v := v_cat;
  for i in 1..5 loop
    v := v * 15 + v_tb[i];
  end loop;
  return v;
end $$;

create or replace function private.cg_cat5_name(p_score bigint)
returns text language sql immutable set search_path = '' as $$
  select (array['high_card', 'pair', 'two_pair', 'three_kind', 'straight', 'flush', 'full_house',
                'four_kind', 'straight_flush', 'five_aces'])[(p_score / 759375 + 1)::integer]
$$;

-- =============================================================================
-- BACCARAT
-- =============================================================================
create or replace function private.bac_value(c integer)
returns integer language sql immutable set search_path = '' as $$
  select case when c % 13 >= 9 then 0 else c % 13 + 1 end
$$;

-- Plays out a hand from the first six cards of a shoe by the fixed drawing rules.
create or replace function private.bac_play(p_cards smallint[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_player smallint[] := array[p_cards[1], p_cards[3]];
  v_banker smallint[] := array[p_cards[2], p_cards[4]];
  pt integer := (private.bac_value(p_cards[1]) + private.bac_value(p_cards[3])) % 10;
  bt integer := (private.bac_value(p_cards[2]) + private.bac_value(p_cards[4])) % 10;
  v_next integer := 5;
  v_third integer;  -- value of the player's third card, null if the player stood
  v_natural boolean := false;
begin
  if pt >= 8 or bt >= 8 then
    v_natural := true;
  else
    if pt <= 5 then
      v_third := private.bac_value(p_cards[v_next]);
      v_player := v_player || p_cards[v_next];
      pt := (pt + v_third) % 10;
      v_next := v_next + 1;
    end if;
    if (v_third is null and bt <= 5)
       or (v_third is not null and (
            bt <= 2
         or (bt = 3 and v_third <> 8)
         or (bt = 4 and v_third between 2 and 7)
         or (bt = 5 and v_third between 4 and 7)
         or (bt = 6 and v_third between 6 and 7))) then
      v_banker := v_banker || p_cards[v_next];
      bt := (bt + private.bac_value(p_cards[v_next])) % 10;
    end if;
  end if;
  return jsonb_build_object(
    'player', to_jsonb(v_player), 'banker', to_jsonb(v_banker),
    'player_total', pt, 'banker_total', bt, 'natural', v_natural,
    'outcome', case when pt > bt then 'player' when bt > pt then 'banker' else 'tie' end,
    'player_pair', p_cards[1] % 13 = p_cards[3] % 13,
    'banker_pair', p_cards[2] % 13 = p_cards[4] % 13);
end $$;

create or replace function public.baccarat_deal(p_tier text, p_bets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  c        jsonb := private.solo_cfg('baccarat');
  v_staked bigint := private.solo_spots(v_uid, 'baccarat', p_tier, p_bets, '^(player|banker|tie|player_pair|banker_pair)$');
  v_round  uuid := gen_random_uuid();
  r        jsonb := private.bac_play((private.shuffled_shoe(8))[1:6]);
  b        record;
  v_amt    bigint;
  v_back   bigint;
  v_returns jsonb := '{}'::jsonb;
  v_total  bigint := 0;
  v_commission bigint := 0;
begin
  for b in select key, (value #>> '{}')::bigint as amount from jsonb_each(p_bets) loop
    v_amt := b.amount;
    v_back := case
      when b.key in ('player', 'banker') and r ->> 'outcome' = 'tie' then v_amt
      when b.key = 'player' and r ->> 'outcome' = 'player' then v_amt * 2
      when b.key = 'banker' and r ->> 'outcome' = 'banker'
        then v_amt * 2 - private.commission(v_amt, (c ->> 'commission_pct')::integer)
      when b.key = 'tie' and r ->> 'outcome' = 'tie' then v_amt * ((c #>> '{pays,tie}')::integer + 1)
      when b.key = 'player_pair' and (r ->> 'player_pair')::boolean then v_amt * ((c #>> '{pays,player_pair}')::integer + 1)
      when b.key = 'banker_pair' and (r ->> 'banker_pair')::boolean then v_amt * ((c #>> '{pays,banker_pair}')::integer + 1)
      else 0 end;
    if b.key = 'banker' and r ->> 'outcome' = 'banker' then
      v_commission := private.commission(v_amt, (c ->> 'commission_pct')::integer);
    end if;
    v_returns := v_returns || jsonb_build_object(b.key, v_back);
    v_total := v_total + v_back;
  end loop;

  return r || jsonb_build_object(
    'round_id', v_round, 'bets', p_bets, 'returns', v_returns, 'commission', v_commission,
    'staked', v_staked, 'win', v_total,
    'balance', private.solo_settle(v_uid, 'baccarat', v_round, v_staked, v_total, jsonb_build_object(
      'outcome', r -> 'outcome', 'player_total', r -> 'player_total', 'banker_total', r -> 'banker_total')));
end $$;

-- =============================================================================
-- VIDEO POKER (Jacks or Better, Deuces Wild)
-- "returns" are what a 1-chip bet gets back (a pair of jacks returns the bet).
-- =============================================================================
create or replace function private.vp_eval(p_game text, p_hand smallint[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v bigint;
  v_cat integer;
  -- deuces wild
  w integer;
  v_ranks integer[];
  v_suits integer[];
  v_same_suit boolean;
  v_distinct boolean;
  v_max integer;
  v_pairs integer;
  v_run boolean;
begin
  if p_game = 'video_poker_jacks' then
    v := private.cg_score5((select array_agg(private.cg_r(x)) from unnest(p_hand) x),
                           (select array_agg(private.cg_s(x)) from unnest(p_hand) x));
    v_cat := v / 759375;
    return case
      when v_cat = 8 and (v / 50625) % 15 = 14 then 'royal_flush'
      when v_cat = 8 then 'straight_flush'
      when v_cat = 7 then 'four_kind'
      when v_cat = 6 then 'full_house'
      when v_cat = 5 then 'flush'
      when v_cat = 4 then 'straight'
      when v_cat = 3 then 'three_kind'
      when v_cat = 2 then 'two_pair'
      when v_cat = 1 and (v / 50625) % 15 >= 11 then 'jacks_or_better'
    end;
  end if;

  -- Deuces Wild: work from the cards that aren't deuces.
  select array_agg(private.cg_r(x)), array_agg(private.cg_s(x)) into v_ranks, v_suits
    from unnest(p_hand) x where x % 13 <> 1;
  w := 5 - coalesce(cardinality(v_ranks), 0);
  if w = 4 then
    return 'four_deuces';
  end if;
  v_same_suit := (select count(distinct s) from unnest(v_suits) s) = 1;
  v_distinct := (select count(distinct r) from unnest(v_ranks) r) = cardinality(v_ranks);
  select max(n), count(*) filter (where n = 2) into v_max, v_pairs
    from (select count(*) as n from unnest(v_ranks) r group by r) g;
  -- The other cards fit inside five ranks in a row (ace high or low).
  v_run := v_distinct and (
       (select max(r) - min(r) from unnest(v_ranks) r) <= 4
    or (select max(case when r = 14 then 1 else r end) - min(case when r = 14 then 1 else r end) from unnest(v_ranks) r) <= 4);

  return case
    when w = 0 and v_same_suit and v_distinct and (select min(r) from unnest(v_ranks) r) = 10 then 'natural_royal'
    when w > 0 and v_same_suit and v_distinct and (select min(r) from unnest(v_ranks) r) >= 10 then 'wild_royal'
    when w > 0 and v_max + w = 5 then 'five_kind'
    when v_same_suit and v_run then 'straight_flush'
    when v_max + w >= 4 then 'four_kind'
    when (w = 0 and v_max = 3 and v_pairs = 1) or (w = 1 and v_pairs = 2) then 'full_house'
    when v_same_suit then 'flush'
    when v_run then 'straight'
    when v_max + w >= 3 then 'three_kind'
  end;
end $$;

create or replace function public.vp_deal(p_game text, p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_tier text;
  v_deck smallint[];
  v_hand smallint[];
  v_state jsonb;
  v_id   uuid;
begin
  if p_game not in ('video_poker_jacks', 'video_poker_deuces') then
    raise exception 'unknown_game';
  end if;
  if not exists (select 1 from public.games where key = p_game and released) then
    raise exception 'game_not_open';
  end if;
  if p_bet is null or p_bet <= 0 then
    raise exception 'invalid_amount';
  end if;
  if exists (select 1 from public.solo_rounds where user_id = v_uid and game_key = p_game) then
    raise exception 'round_in_progress';
  end if;
  v_tier := private.slot_tier(p_game, p_bet);
  perform private.assert_tier_access(v_uid, p_game, v_tier);

  v_deck := private.shuffled_shoe(1);
  v_hand := v_deck[1:5];
  v_state := jsonb_build_object('hand', to_jsonb(v_hand), 'bet', p_bet, 'made', private.vp_eval(p_game, v_hand));
  v_id := private.solo_begin(v_uid, p_game, v_tier, p_bet, v_state, v_deck[6:10], null);
  return v_state || jsonb_build_object(
    'round_id', v_id,
    'balance', private.apply_chips(v_uid, -p_bet, 'bet', p_game, v_id::text));
end $$;

-- p_holds: five booleans, true = keep that card.
create or replace function public.vp_draw(p_game text, p_holds boolean[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  r      public.solo_rounds;
  v_deck smallint[];
  v_hand smallint[];
  v_next integer := 1;
  v_made text;
  v_bet  bigint;
  v_win  bigint;
  v_balance bigint;
begin
  if p_game not in ('video_poker_jacks', 'video_poker_deuces') then
    raise exception 'unknown_game';
  end if;
  if p_holds is null or cardinality(p_holds) <> 5 or array_position(p_holds, null) is not null then
    raise exception 'invalid_hand';
  end if;
  r := private.solo_open_round(v_uid, p_game);
  select deck into v_deck from public.solo_secrets where round_id = r.id;
  v_bet := (r.state ->> 'bet')::bigint;
  for i in 1..5 loop
    if p_holds[i] then
      v_hand := v_hand || (r.state -> 'hand' ->> (i - 1))::smallint;
    else
      v_hand := v_hand || v_deck[v_next];
      v_next := v_next + 1;
    end if;
  end loop;
  v_made := private.vp_eval(p_game, v_hand);
  v_win := v_bet * coalesce((private.solo_cfg(p_game) -> 'returns' ->> v_made)::bigint, 0);

  delete from public.solo_rounds where id = r.id;
  v_balance := private.apply_chips(v_uid, v_win, 'payout', p_game, r.id::text);
  perform private.record_round(v_uid, p_game, null, r.id, v_bet, v_win,
                               jsonb_build_object('hand', to_jsonb(v_hand), 'made', v_made));
  return jsonb_build_object('round_id', r.id, 'hand', to_jsonb(v_hand), 'holds', to_jsonb(p_holds),
                            'made', v_made, 'bet', v_bet, 'win', v_win, 'balance', v_balance);
end $$;

-- =============================================================================
-- THREE CARD POKER
-- Hand order: straight flush, three of a kind, straight, flush, pair, high card.
-- =============================================================================
create or replace function private.tcp_score(p_cards smallint[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  r integer[];
  v_flush boolean := p_cards[1] / 13 = p_cards[2] / 13 and p_cards[2] / 13 = p_cards[3] / 13;
  v_straight integer := 0;
  v_cat integer;
  t integer[];
begin
  select array_agg(private.cg_r(x) order by private.cg_r(x) desc) into r from unnest(p_cards) x;
  if r[1] <> r[2] and r[2] <> r[3] then
    if r[1] - r[3] = 2 then
      v_straight := r[1];
    elsif r[1] = 14 and r[2] = 3 and r[3] = 2 then
      v_straight := 3;  -- A-2-3
    end if;
  end if;
  if v_straight > 0 and v_flush then v_cat := 5; t := array[v_straight, 0, 0];
  elsif r[1] = r[3] then v_cat := 4; t := array[r[1], 0, 0];
  elsif v_straight > 0 then v_cat := 3; t := array[v_straight, 0, 0];
  elsif v_flush then v_cat := 2; t := r;
  elsif r[1] = r[2] then v_cat := 1; t := array[r[1], r[3], 0];
  elsif r[2] = r[3] then v_cat := 1; t := array[r[2], r[1], 0];
  else v_cat := 0; t := r;
  end if;
  return ((v_cat * 15 + t[1]) * 15 + t[2]) * 15 + t[3];
end $$;

create or replace function private.tcp_name(p_score integer)
returns text language sql immutable set search_path = '' as $$
  select (array['high_card', 'pair', 'flush', 'straight', 'three_kind', 'straight_flush'])[p_score / 3375 + 1]
$$;

-- p_pair_plus may be 0 (no side bet). The player must be able to cover the Play bet too.
create or replace function public.tcp_deal(p_tier text, p_ante bigint, p_pair_plus bigint default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_pp   bigint := coalesce(p_pair_plus, 0);
  v_bets jsonb := jsonb_build_object('ante', p_ante) || case when v_pp > 0 then jsonb_build_object('pair_plus', v_pp) else '{}'::jsonb end;
  v_staked bigint;
  v_deck smallint[];
  v_state jsonb;
  v_id   uuid;
begin
  if p_ante is null or v_pp < 0 then
    raise exception 'invalid_amount';
  end if;
  if exists (select 1 from public.solo_rounds where user_id = v_uid and game_key = 'three_card_poker') then
    raise exception 'round_in_progress';
  end if;
  v_staked := private.solo_spots(v_uid, 'three_card_poker', p_tier, v_bets, '^(ante|pair_plus)$');
  if (select balance from public.wallets where user_id = v_uid) < v_staked + p_ante then
    raise exception 'insufficient_chips'
      using hint = 'You need enough chips to cover the Play bet too.';
  end if;

  v_deck := private.shuffled_shoe(1);
  v_state := jsonb_build_object('hand', to_jsonb(v_deck[1:3]), 'ante', p_ante, 'pair_plus', v_pp,
                                'made', private.tcp_name(private.tcp_score(v_deck[1:3])));
  v_id := private.solo_begin(v_uid, 'three_card_poker', p_tier, v_staked, v_state, v_deck[4:6], null);
  return v_state || jsonb_build_object(
    'round_id', v_id,
    'balance', private.apply_chips(v_uid, -v_staked, 'bet', 'three_card_poker', v_id::text));
end $$;

-- p_play = true puts up a Play bet equal to the ante; false folds.
create or replace function public.tcp_act(p_play boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  c        jsonb := private.solo_cfg('three_card_poker');
  r        public.solo_rounds;
  v_hand   smallint[];
  v_dealer smallint[];
  v_ante   bigint;
  v_pp     bigint;
  ps       integer;
  ds       integer;
  v_made   text;
  v_qual   boolean;
  v_outcome text;
  v_staked bigint;
  v_ret_ante bigint := 0;
  v_ret_play bigint := 0;
  v_ret_bonus bigint := 0;
  v_ret_pp bigint := 0;
  v_total  bigint;
  v_balance bigint;
begin
  if p_play is null then
    raise exception 'action_not_allowed';
  end if;
  r := private.solo_open_round(v_uid, 'three_card_poker');
  select deck into v_dealer from public.solo_secrets where round_id = r.id;
  select array_agg(x::smallint order by o) into v_hand from jsonb_array_elements_text(r.state -> 'hand') with ordinality e(x, o);
  v_ante := (r.state ->> 'ante')::bigint;
  v_pp := (r.state ->> 'pair_plus')::bigint;
  v_staked := r.staked;
  ps := private.tcp_score(v_hand);
  ds := private.tcp_score(v_dealer);
  v_made := private.tcp_name(ps);
  -- The dealer needs queen high or better to play.
  v_qual := ds >= 12 * 225;

  -- Pair Plus pays on the player's own three cards, whatever else happens.
  if v_pp > 0 and c -> 'pair_plus' ? v_made then
    v_ret_pp := v_pp * ((c -> 'pair_plus' ->> v_made)::integer + 1);
  end if;

  if not p_play then
    v_outcome := 'fold';
  else
    perform private.apply_chips(v_uid, -v_ante, 'bet', 'three_card_poker', r.id::text, jsonb_build_object('spot', 'play'));
    v_staked := v_staked + v_ante;
    v_ret_bonus := v_ante * coalesce((c -> 'ante_bonus' ->> v_made)::integer, 0);
    if not v_qual then
      v_outcome := 'no_qualify';
      v_ret_ante := v_ante * 2;
      v_ret_play := v_ante;
    elsif ps > ds then
      v_outcome := 'win';
      v_ret_ante := v_ante * 2;
      v_ret_play := v_ante * 2;
    elsif ps = ds then
      v_outcome := 'tie';
      v_ret_ante := v_ante;
      v_ret_play := v_ante;
    else
      v_outcome := 'lose';
    end if;
  end if;
  v_total := v_ret_ante + v_ret_play + v_ret_bonus + v_ret_pp;

  delete from public.solo_rounds where id = r.id;
  v_balance := private.apply_chips(v_uid, v_total, 'payout', 'three_card_poker', r.id::text);
  perform private.record_round(v_uid, 'three_card_poker', null, r.id, v_staked, v_total,
                               jsonb_build_object('outcome', v_outcome, 'made', v_made, 'hand', to_jsonb(v_hand)));
  return jsonb_build_object(
    'round_id', r.id, 'hand', to_jsonb(v_hand), 'dealer', to_jsonb(v_dealer),
    'made', v_made, 'dealer_made', private.tcp_name(ds), 'qualifies', v_qual, 'outcome', v_outcome,
    'ante', v_ante, 'pair_plus', v_pp, 'played', p_play,
    'returns', jsonb_build_object('ante', v_ret_ante, 'play', v_ret_play, 'ante_bonus', v_ret_bonus, 'pair_plus', v_ret_pp),
    'staked', v_staked, 'win', v_total, 'balance', v_balance);
end $$;

-- =============================================================================
-- PAI GOW POKER
-- Seven cards each, set into a five-card "high" hand and a two-card "low" hand.
-- The low hand may not outrank the high hand. Win both to win (less 5%
-- commission), win one for a push, and the dealer takes exact ties.
-- The joker is an ace, or completes a straight, flush or straight flush.
-- =============================================================================
create or replace function private.pgw_high(p_cards smallint[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  rr integer[];
  ss integer[];
  v_suit integer;
  v bigint;
  v_best bigint := 0;
begin
  select array_agg(private.cg_r(x)), array_agg(private.cg_s(x)) into rr, ss from unnest(p_cards) x where x <> 52;
  if cardinality(rr) = 5 then
    return private.cg_score5(rr, ss);
  end if;
  -- A joker: try it as every rank. Off-suit unless the other four share a suit.
  v_suit := case when (select count(distinct s) from unnest(ss) s) = 1 then ss[1] else 9 end;
  for r in 2..14 loop
    v := private.cg_score5(rr || r, ss || v_suit);
    if r = 14 or v / 759375 in (4, 5, 8) then
      v_best := greatest(v_best, v);
    end if;
  end loop;
  return v_best;
end $$;

-- Two-card hand: a pair (1000 + rank) beats any two unpaired cards.
create or replace function private.pgw_low(p_cards smallint[])
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when max(r) = min(r) then 1000 + max(r) else max(r) * 15 + min(r) end
    from (select case when x = 52 then 14 else private.cg_r(x) end as r from unnest(p_cards) x) t
$$;

-- May this two-card hand sit in front of this five-card hand?
create or replace function private.pgw_valid(p_high bigint, p_low integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_high / 759375 >= 2 then true
    when p_low >= 1000 then p_high / 759375 = 1 and (p_high / 50625) % 15 >= p_low - 1000
    when p_high / 759375 = 1 then true
    else ((p_high / 50625) % 15) * 15 + (p_high / 3375) % 15 >= p_low
  end
$$;

-- How the dealer sets seven cards (and what the "House way" button does for the
-- player). Every legal split is scored by how often its two hands beat the
-- hands this same method produces: the tables are the 2%, 4%, … 100% points of
-- those hands, found by simulation. Returns the two low cards.
create or replace function private.pgw_house_way(p_seven smallint[])
returns smallint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  t_hi constant bigint[] := array[628922,679562,686777,730188,737163,740522,741017,744572,869045,869959,923479,976803,
    977720,1031238,1031976,1085285,1086215,1139479,1140392,1193478,1194242,1247237,1248138,1301027,1301526,1354562,
    1355270,1356218,1409012,1409507,1410467,1463027,1463511,1464243,1516997,1517268,1517525,1517975,1518437,1843237,
    1952195,2114679,2495178,2712064,2928919,3341250,3442500,3594375,4331312,4548272];
  t_lo constant integer[] := array[95,140,152,158,159,172,174,175,175,186,188,190,190,191,191,191,201,204,205,205,206,
    206,207,207,207,214,218,219,220,221,221,222,222,222,223,223,223,223,1002,1003,1004,1004,1005,1006,1007,1008,1009,
    1010,1012,1014];
  v_low  smallint[];
  v_high smallint[];
  h bigint;
  l integer;
  w bigint;
  v_best bigint := -1;
  v_pick smallint[];
begin
  for i in 1..6 loop
    for j in i + 1..7 loop
      v_low := array[p_seven[i], p_seven[j]];
      select array_agg(x order by o) into v_high from unnest(p_seven) with ordinality u(x, o) where o not in (i, j);
      h := private.pgw_high(v_high);
      l := private.pgw_low(v_low);
      continue when not private.pgw_valid(h, l);
      w := ((select count(*) from unnest(t_hi) x where x <= h) + (select count(*) from unnest(t_lo) x where x <= l)) * 10000 + l;
      if w > v_best then
        v_best := w;
        v_pick := v_low;
      end if;
    end loop;
  end loop;
  return v_pick;
end $$;

-- The deck with the joker (52) shuffled in.
create or replace function private.pgw_deck()
returns smallint[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  d smallint[] := private.shuffled_shoe(1);
  p integer := private.random_int(53);
begin
  return d[1:p] || 52::smallint || d[p + 1:52];
end $$;

create or replace function public.pgw_deal(p_tier text, p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_staked bigint;
  v_deck smallint[];
  v_state jsonb;
  v_id   uuid;
begin
  if exists (select 1 from public.solo_rounds where user_id = v_uid and game_key = 'pai_gow_poker') then
    raise exception 'round_in_progress';
  end if;
  v_staked := private.solo_spots(v_uid, 'pai_gow_poker', p_tier, jsonb_build_object('bet', p_bet), '^bet$');
  v_deck := private.pgw_deck();
  v_state := jsonb_build_object('hand', to_jsonb(v_deck[1:7]), 'bet', p_bet,
                                'house_way', to_jsonb(private.pgw_house_way(v_deck[1:7])));
  v_id := private.solo_begin(v_uid, 'pai_gow_poker', p_tier, v_staked, v_state, v_deck[8:14], null);
  return v_state || jsonb_build_object(
    'round_id', v_id,
    'balance', private.apply_chips(v_uid, -v_staked, 'bet', 'pai_gow_poker', v_id::text));
end $$;

-- p_low: the two cards for the low hand. Null sets the hand the house way.
create or replace function public.pgw_set(p_low smallint[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  r        public.solo_rounds;
  v_seven  smallint[];
  v_dealer smallint[];
  v_low    smallint[];
  v_high   smallint[];
  d_low    smallint[];
  d_high   smallint[];
  ph bigint; pl integer; dh bigint; dl integer;
  v_bet    bigint;
  v_wins   integer;
  v_outcome text;
  v_commission bigint := 0;
  v_total  bigint;
  v_balance bigint;
begin
  r := private.solo_open_round(v_uid, 'pai_gow_poker');
  select deck into v_dealer from public.solo_secrets where round_id = r.id;
  select array_agg(x::smallint order by o) into v_seven from jsonb_array_elements_text(r.state -> 'hand') with ordinality e(x, o);
  v_bet := (r.state ->> 'bet')::bigint;

  v_low := coalesce(p_low, private.pgw_house_way(v_seven));
  if cardinality(v_low) <> 2 or v_low[1] = v_low[2]
     or array_position(v_seven, v_low[1]) is null or array_position(v_seven, v_low[2]) is null then
    raise exception 'invalid_hand' using hint = 'Pick two of your seven cards for the low hand.';
  end if;
  select array_agg(x order by o) into v_high from unnest(v_seven) with ordinality u(x, o) where x <> all (v_low);
  ph := private.pgw_high(v_high);
  pl := private.pgw_low(v_low);
  if not private.pgw_valid(ph, pl) then
    raise exception 'invalid_hand' using hint = 'Your two-card hand can''t be stronger than your five-card hand.';
  end if;

  d_low := private.pgw_house_way(v_dealer);
  select array_agg(x order by o) into d_high from unnest(v_dealer) with ordinality u(x, o) where x <> all (d_low);
  dh := private.pgw_high(d_high);
  dl := private.pgw_low(d_low);

  -- The dealer wins exact ties ("copies").
  v_wins := (ph > dh)::integer + (pl > dl)::integer;
  if v_wins = 2 then
    v_outcome := 'win';
    v_commission := private.commission(v_bet, (private.solo_cfg('pai_gow_poker') ->> 'commission_pct')::integer);
    v_total := v_bet * 2 - v_commission;
  elsif v_wins = 1 then
    v_outcome := 'push';
    v_total := v_bet;
  else
    v_outcome := 'lose';
    v_total := 0;
  end if;

  delete from public.solo_rounds where id = r.id;
  v_balance := private.apply_chips(v_uid, v_total, 'payout', 'pai_gow_poker', r.id::text);
  perform private.record_round(v_uid, 'pai_gow_poker', null, r.id, v_bet, v_total, jsonb_build_object(
    'outcome', v_outcome, 'high', private.cg_cat5_name(ph), 'low', case when pl >= 1000 then 'pair' else 'high_card' end));
  return jsonb_build_object(
    'round_id', r.id, 'low', to_jsonb(v_low), 'high', to_jsonb(v_high),
    'dealer_low', to_jsonb(d_low), 'dealer_high', to_jsonb(d_high),
    'high_made', private.cg_cat5_name(ph), 'dealer_high_made', private.cg_cat5_name(dh),
    'low_made', case when pl >= 1000 then 'pair' else 'high_card' end,
    'dealer_low_made', case when dl >= 1000 then 'pair' else 'high_card' end,
    'high_wins', ph > dh, 'low_wins', pl > dl, 'outcome', v_outcome,
    'bet', v_bet, 'commission', v_commission, 'win', v_total, 'balance', v_balance);
end $$;

-- =============================================================================
-- SIC BO
-- Spots: small, big, odd, even, any_triple, total_4 … total_17, single_1 …
-- single_6, double_1 … double_6, triple_1 … triple_6, combo_1_2 … combo_5_6.
-- Small, big, odd and even lose to any triple.
-- =============================================================================
create or replace function private.sb_pays(p_spot text, d integer[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  c jsonb := private.solo_cfg('sic_bo') -> 'pays';
  v_sum integer := d[1] + d[2] + d[3];
  v_triple boolean := d[1] = d[2] and d[2] = d[3];
  v_kind text := split_part(p_spot, '_', 1);
  n integer;
  v_count integer;
begin
  if p_spot = 'any_triple' then
    return case when v_triple then (c ->> 'any_triple')::integer end;
  end if;
  n := nullif(split_part(p_spot, '_', 2), '')::integer;
  v_count := (d[1] = n)::integer + (d[2] = n)::integer + (d[3] = n)::integer;
  return case v_kind
    when 'small'  then case when not v_triple and v_sum between 4 and 10 then (c ->> 'small')::integer end
    when 'big'    then case when not v_triple and v_sum between 11 and 17 then (c ->> 'big')::integer end
    when 'odd'    then case when not v_triple and v_sum % 2 = 1 then (c ->> 'odd')::integer end
    when 'even'   then case when not v_triple and v_sum % 2 = 0 then (c ->> 'even')::integer end
    when 'total'  then case when v_sum = n then (c -> 'total' ->> n::text)::integer end
    when 'single' then case when v_count > 0 then (c -> 'single' ->> (v_count - 1))::integer end
    when 'double' then case when v_count >= 2 then (c ->> 'double')::integer end
    when 'triple' then case when v_count = 3 then (c ->> 'triple')::integer end
    when 'combo'  then case when n = any (d) and split_part(p_spot, '_', 3)::integer = any (d) then (c ->> 'combo')::integer end
  end;
end $$;

create or replace function public.sicbo_roll(p_tier text, p_bets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  v_staked bigint := private.solo_spots(v_uid, 'sic_bo', p_tier, p_bets,
    '^(small|big|odd|even|any_triple|total_([4-9]|1[0-7])|(single|double|triple)_[1-6]|combo_(1_[2-6]|2_[3-6]|3_[4-6]|4_[56]|5_6))$');
  v_round  uuid := gen_random_uuid();
  d        integer[] := array[private.random_int(6) + 1, private.random_int(6) + 1, private.random_int(6) + 1];
  b        record;
  m        integer;
  v_back   bigint;
  v_returns jsonb := '{}'::jsonb;
  v_total  bigint := 0;
begin
  for b in select key, (value #>> '{}')::bigint as amount from jsonb_each(p_bets) loop
    m := private.sb_pays(b.key, d);
    v_back := case when m is null then 0 else b.amount * (m + 1) end;
    v_returns := v_returns || jsonb_build_object(b.key, v_back);
    v_total := v_total + v_back;
  end loop;
  return jsonb_build_object(
    'round_id', v_round, 'dice', to_jsonb(d), 'total', d[1] + d[2] + d[3],
    'triple', d[1] = d[2] and d[2] = d[3],
    'bets', p_bets, 'returns', v_returns, 'staked', v_staked, 'win', v_total,
    'balance', private.solo_settle(v_uid, 'sic_bo', v_round, v_staked, v_total, jsonb_build_object('dice', to_jsonb(d))));
end $$;

-- =============================================================================
-- KENO
-- "returns" are in hundredths of the bet and every value is a multiple of 10;
-- bets are multiples of 10, so the win is always a whole number of chips.
-- =============================================================================
create or replace function public.keno_draw(p_bet bigint, p_picks integer[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  c       jsonb := private.solo_cfg('keno');
  v_tier  text;
  v_round uuid := gen_random_uuid();
  v_pool  integer[];
  v_drawn integer[];
  v_hits  integer[];
  j integer;
  t integer;
  n integer := coalesce(cardinality(p_picks), 0);
  v_units bigint;
  v_win   bigint;
begin
  if not exists (select 1 from public.games where key = 'keno' and released) then
    raise exception 'game_not_open';
  end if;
  if n < 1 or n > (c ->> 'max_picks')::integer
     or (select count(distinct x) from unnest(p_picks) x where x between 1 and (c ->> 'numbers')::integer) <> n then
    raise exception 'invalid_picks';
  end if;
  if p_bet is null or p_bet <= 0 or p_bet % 10 <> 0 then
    raise exception 'invalid_amount';
  end if;
  v_tier := private.slot_tier('keno', p_bet);
  perform private.assert_tier_access(v_uid, 'keno', v_tier);

  -- Draw 20 of the 80 balls: the first 20 steps of a Fisher-Yates shuffle.
  select array_agg(g order by g) into v_pool from generate_series(1, (c ->> 'numbers')::integer) g;
  for i in 1..(c ->> 'drawn')::integer loop
    j := i + private.random_int(cardinality(v_pool) - i + 1);
    t := v_pool[i]; v_pool[i] := v_pool[j]; v_pool[j] := t;
    v_drawn := v_drawn || v_pool[i];
  end loop;
  select coalesce(array_agg(x order by x), '{}') into v_hits from unnest(p_picks) x where x = any (v_drawn);

  v_units := coalesce((c -> 'returns' -> n::text ->> cardinality(v_hits)::text)::bigint, 0);
  v_win := p_bet * v_units / 100;
  return jsonb_build_object(
    'round_id', v_round, 'picks', to_jsonb(p_picks), 'drawn', to_jsonb(v_drawn), 'hits', to_jsonb(v_hits),
    'units', v_units, 'bet', p_bet, 'tier', v_tier, 'win', v_win,
    'balance', private.solo_settle(v_uid, 'keno', v_round, p_bet, v_win,
                                   jsonb_build_object('picks', n, 'hits', cardinality(v_hits))));
end $$;

-- =============================================================================
-- BIG SIX WHEEL
-- Spots: x1, x2, x5, x10, x20, joker, logo. The wheel's 54 segments are in
-- the config; the server picks one.
-- =============================================================================
create or replace function public.wheel_spin(p_tier text, p_bets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  c        jsonb := private.solo_cfg('money_wheel');
  v_staked bigint := private.solo_spots(v_uid, 'money_wheel', p_tier, p_bets, '^(x1|x2|x5|x10|x20|joker|logo)$');
  v_round  uuid := gen_random_uuid();
  v_stop   integer := private.random_int(jsonb_array_length(c -> 'wheel'));
  v_symbol text := c -> 'wheel' ->> v_stop;
  b        record;
  v_back   bigint;
  v_returns jsonb := '{}'::jsonb;
  v_total  bigint := 0;
begin
  for b in select key, (value #>> '{}')::bigint as amount from jsonb_each(p_bets) loop
    v_back := case when b.key = v_symbol then b.amount * ((c -> 'pays' ->> b.key)::integer + 1) else 0 end;
    v_returns := v_returns || jsonb_build_object(b.key, v_back);
    v_total := v_total + v_back;
  end loop;
  return jsonb_build_object(
    'round_id', v_round, 'stop', v_stop, 'symbol', v_symbol,
    'bets', p_bets, 'returns', v_returns, 'staked', v_staked, 'win', v_total,
    'balance', private.solo_settle(v_uid, 'money_wheel', v_round, v_staked, v_total, jsonb_build_object('symbol', v_symbol)));
end $$;

-- =============================================================================
-- What a game's screen needs: rules and paytable, stake levels, bet steps, and
-- the round waiting for a decision (if any).
-- =============================================================================
create or replace function public.solo_info(p_game text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.solo_cfg(p_game);
  g public.games;
begin
  select * into g from public.games where key = p_game;
  if c is null or not found then
    raise exception 'unknown_game';
  end if;
  return jsonb_build_object(
    'game', g.key,
    'name', g.name,
    'released', g.released,
    'config', c,
    'bets', (select coalesce(jsonb_agg(b order by b), '[]'::jsonb) from unnest(private.slot_bets()) b
              where exists (select 1 from public.stake_tiers t where t.game_key = p_game and b between t.min_bet and t.max_bet)),
    'tiers', (select jsonb_agg(jsonb_build_object('tier', t.tier, 'label', t.label, 'min_bet', t.min_bet,
                                                  'max_bet', t.max_bet, 'min_bankroll', t.min_bankroll) order by t.tier_rank)
                from public.stake_tiers t where t.game_key = p_game),
    'round', (select r.state || jsonb_build_object('round_id', r.id, 'tier', r.tier)
                from public.solo_rounds r where r.user_id = v_uid and r.game_key = p_game)
  );
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.solo_info(text)', 'public.baccarat_deal(text, jsonb)', 'public.vp_deal(text, bigint)',
    'public.vp_draw(text, boolean[])', 'public.tcp_deal(text, bigint, bigint)', 'public.tcp_act(boolean)',
    'public.pgw_deal(text, bigint)', 'public.pgw_set(smallint[])', 'public.sicbo_roll(text, jsonb)',
    'public.keno_draw(bigint, integer[])', 'public.wheel_spin(text, jsonb)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.solo_rounds  enable row level security;
alter table public.solo_secrets enable row level security;

drop policy if exists "solo_rounds: read own" on public.solo_rounds;
create policy "solo_rounds: read own"
  on public.solo_rounds for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.solo_secrets from anon, authenticated;
revoke insert, update, delete, truncate on public.solo_rounds from anon, authenticated;
revoke all on public.solo_rounds from anon;
grant select on public.solo_rounds to authenticated;

-- -----------------------------------------------------------------------------
-- Open the games.
-- -----------------------------------------------------------------------------
update public.games set released = true
 where key in ('baccarat', 'video_poker_jacks', 'video_poker_deuces', 'three_card_poker',
               'pai_gow_poker', 'sic_bo', 'keno', 'money_wheel');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

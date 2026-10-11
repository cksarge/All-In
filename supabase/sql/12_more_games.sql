-- =============================================================================
-- All In · 12_more_games.sql
-- Nine more games. Needs 03 (re-run it first: it lists these games), 05, 09 and 11.
--
--   Against the house, one call:
--     dragon_tiger     one card each, bet on the higher
--     plinko           a ball bounces down 8, 12 or 16 rows of pegs
--     scratch_cards    three cards (steady, medium, long shot); match three prizes
--     power_draw       pick 5 of 30 numbers and a power ball of 10
--   Against the house, with decisions (rounds wait in solo_rounds, see 11):
--     casino_war       high card; on a tie go to war or surrender
--     ultimate_holdem  Hold'em against the dealer: bet 4x/3x early, 2x on the flop, 1x at the end
--     mines            uncover safe tiles on a 5x5 grid; collect whenever you like
--   Live rooms shared by everyone (timers are deadlines, as at the tables):
--     crash            a multiplier climbs until it crashes; collect before it does
--     bingo            75-ball cards; the faster a line completes, the more it pays
--
-- Crash and Bingo keep their secret (the crash point, the balls still to come)
-- in tables with RLS on and no policies. Their prizes are paid by the house from
-- a paytable, not from a pot, so they play the same with one player or fifty.
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run.
-- =============================================================================

do $$
begin
  if (select count(*) from public.games where key in ('dragon_tiger', 'casino_war', 'ultimate_holdem', 'crash',
        'plinko', 'mines', 'scratch_cards', 'power_draw', 'bingo')) <> 9
     or (select count(distinct game_key) from public.stake_tiers where game_key in ('dragon_tiger', 'casino_war',
        'ultimate_holdem', 'crash', 'plinko', 'mines', 'scratch_cards', 'power_draw', 'bingo')) <> 9 then
    raise exception 'Run 03_games_and_stakes.sql again first: it adds these games to the catalogue.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Paytables and rules the browser shows.
-- "pays" are to 1. "returns" are hundredths of the bet (what comes back) in
-- multiples of 10; bets on those games are multiples of 10, so chips stay whole.
-- -----------------------------------------------------------------------------
create or replace function private.more_cfg(p_game text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select ($cfg$
{
  "dragon_tiger": {
    "pays": {"dragon": 1, "tiger": 1, "tie": 11, "suited_tie": 50}
  },
  "casino_war": {
    "tie_pays": 10
  },
  "ultimate_holdem": {
    "blind": {"royal_flush": 500, "straight_flush": 50, "four_kind": 10, "full_house": 3, "flush": 1.5, "straight": 1},
    "trips": {"royal_flush": 50, "straight_flush": 40, "four_kind": 30, "full_house": 8, "flush": 7, "straight": 4, "three_kind": 3}
  },
  "plinko": {
    "returns": {
      "8": {
        "low":    [560, 210, 110, 100, 50, 100, 110, 210, 560],
        "medium": [1300, 300, 130, 70, 40, 70, 130, 300, 1300],
        "high":   [2900, 400, 150, 30, 20, 30, 150, 400, 2900]
      },
      "12": {
        "low":    [1000, 300, 160, 140, 110, 100, 50, 100, 110, 140, 160, 300, 1000],
        "medium": [3300, 1100, 400, 200, 110, 60, 30, 60, 110, 200, 400, 1100, 3300],
        "high":   [17000, 2400, 810, 200, 70, 20, 20, 20, 70, 200, 810, 2400, 17000]
      },
      "16": {
        "low":    [1600, 900, 200, 140, 140, 120, 110, 100, 50, 100, 110, 120, 140, 140, 200, 900, 1600],
        "medium": [11000, 4100, 1000, 500, 300, 150, 100, 50, 30, 50, 100, 150, 300, 500, 1000, 4100, 11000],
        "high":   [100000, 13000, 2600, 900, 400, 200, 20, 20, 20, 20, 20, 200, 400, 900, 2600, 13000, 100000]
      }
    }
  },
  "mines": {
    "tiles": 25, "edge_pct": 3
  },
  "scratch_cards": {
    "cards": {
      "clover":  {"name": "Lucky Clover", "prizes": [[100, 14000], [200, 7000], [300, 3000], [500, 2000], [1000, 1000], [2000, 500], [5000, 200], [20000, 50], [100000, 7]]},
      "gold":    {"name": "Gold Rush",    "prizes": [[200, 10000], [400, 4250], [1000, 1500], [2500, 500], [10000, 120], [50000, 20], [250000, 3]]},
      "diamond": {"name": "Diamond Mine", "prizes": [[500, 6300], [1000, 1500], [5000, 300], [25000, 50], [100000, 10], [1000000, 1]]}
    },
    "out_of": 100000
  },
  "power_draw": {
    "numbers": 30, "picks": 5, "powers": 10,
    "returns": {"0p": 200, "1p": 300, "2p": 600, "3": 600, "3p": 4000, "4": 12000, "4p": 120000, "5": 1500000, "5p": 20000000}
  },
  "crash": {
    "bet_seconds": 8, "cooldown_seconds": 4, "growth": 0.07, "max": 1000, "edge_pct": 3
  },
  "bingo": {
    "sell_seconds": 20, "calls": 40, "interval_ms": 1000, "cooldown_seconds": 8, "max_cards": 4,
    "returns": [[12, 5000], [16, 1500], [20, 700], [25, 400], [30, 250], [35, 150], [40, 50]]
  }
}
  $cfg$::jsonb) -> p_game
$fn$;

-- The first p_take entries of a shuffled 1..p_n (the start of a Fisher-Yates shuffle).
create or replace function private.draw_numbers(p_n integer, p_take integer)
returns integer[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  v integer[];
  j integer;
  t integer;
begin
  select array_agg(g order by g) into v from generate_series(1, p_n) g;
  for i in 1..p_take loop
    j := i + private.random_int(p_n - i + 1);
    t := v[i]; v[i] := v[j]; v[j] := t;
  end loop;
  return v[1:p_take];
end $$;

-- Checks a single-bet game's bet (a multiple of 10 inside some stake level the player may use).
create or replace function private.more_bet_tier(p_user uuid, p_game text, p_bet bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tier text;
begin
  if not exists (select 1 from public.games where key = p_game and released) then
    raise exception 'game_not_open';
  end if;
  if p_bet is null or p_bet <= 0 or p_bet % 10 <> 0 then
    raise exception 'invalid_amount';
  end if;
  v_tier := private.slot_tier(p_game, p_bet);
  perform private.assert_tier_access(p_user, p_game, v_tier);
  return v_tier;
end $$;

-- =============================================================================
-- DRAGON TIGER
-- One card each from an eight-deck shoe; the ace is low. Dragon and Tiger pay
-- 1 to 1 and lose half on a tie. Spots: dragon, tiger, tie, suited_tie.
-- =============================================================================
create or replace function public.dragon_tiger_deal(p_tier text, p_bets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_uid();
  c        jsonb := private.more_cfg('dragon_tiger') -> 'pays';
  v_staked bigint := private.solo_spots(v_uid, 'dragon_tiger', p_tier, p_bets, '^(dragon|tiger|tie|suited_tie)$');
  v_round  uuid := gen_random_uuid();
  d        smallint[] := (private.shuffled_shoe(8))[1:2];
  v_outcome text := case when d[1] % 13 > d[2] % 13 then 'dragon' when d[2] % 13 > d[1] % 13 then 'tiger' else 'tie' end;
  v_suited boolean := d[1] % 13 = d[2] % 13 and d[1] / 13 = d[2] / 13;
  b        record;
  v_back   bigint;
  v_returns jsonb := '{}'::jsonb;
  v_total  bigint := 0;
begin
  for b in select key, (value #>> '{}')::bigint as amount from jsonb_each(p_bets) loop
    v_back := case
      when b.key in ('dragon', 'tiger') and v_outcome = b.key then b.amount * 2
      when b.key in ('dragon', 'tiger') and v_outcome = 'tie' then b.amount / 2
      when b.key = 'tie' and v_outcome = 'tie' then b.amount * ((c ->> 'tie')::integer + 1)
      when b.key = 'suited_tie' and v_suited then b.amount * ((c ->> 'suited_tie')::integer + 1)
      else 0 end;
    v_returns := v_returns || jsonb_build_object(b.key, v_back);
    v_total := v_total + v_back;
  end loop;
  return jsonb_build_object(
    'round_id', v_round, 'dragon', d[1], 'tiger', d[2], 'outcome', v_outcome, 'suited', v_suited,
    'bets', p_bets, 'returns', v_returns, 'staked', v_staked, 'win', v_total,
    'balance', private.solo_settle(v_uid, 'dragon_tiger', v_round, v_staked, v_total,
                                   jsonb_build_object('outcome', v_outcome, 'dragon', d[1], 'tiger', d[2])));
end $$;

-- =============================================================================
-- CASINO WAR
-- Your card against the dealer's, ace high. Higher wins 1 to 1. On a tie:
-- surrender (half the ante back) or go to war (a second bet equal to the ante,
-- three cards burned, one more card each). Win or tie the war and the second
-- bet pays 1 to 1 and the ante comes back; tie the war and a bonus ante is paid too.
-- =============================================================================
create or replace function public.war_deal(p_tier text, p_ante bigint, p_tie bigint default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  v_tb    bigint := coalesce(p_tie, 0);
  v_bets  jsonb := jsonb_build_object('ante', p_ante) || case when v_tb > 0 then jsonb_build_object('tie', v_tb) else '{}'::jsonb end;
  v_staked bigint;
  d       smallint[];
  pr      integer;
  dr      integer;
  v_state jsonb;
  v_id    uuid;
  v_total bigint;
  v_round uuid := gen_random_uuid();
begin
  if p_ante is null or v_tb < 0 then
    raise exception 'invalid_amount';
  end if;
  if exists (select 1 from public.solo_rounds where user_id = v_uid and game_key = 'casino_war') then
    raise exception 'round_in_progress';
  end if;
  v_staked := private.solo_spots(v_uid, 'casino_war', p_tier, v_bets, '^(ante|tie)$');
  d := (private.shuffled_shoe(6))[1:10];
  pr := private.cg_r(d[1]);
  dr := private.cg_r(d[2]);

  if pr <> dr then
    v_total := case when pr > dr then p_ante * 2 else 0 end;
    return jsonb_build_object(
      'round_id', v_round, 'player', d[1], 'dealer', d[2], 'tied', false,
      'outcome', case when pr > dr then 'win' else 'lose' end,
      'ante', p_ante, 'tie_bet', v_tb, 'staked', v_staked, 'win', v_total,
      'balance', private.solo_settle(v_uid, 'casino_war', v_round, v_staked, v_total,
                                     jsonb_build_object('outcome', case when pr > dr then 'win' else 'lose' end)));
  end if;

  -- A tie: the Tie bet has won; the ante waits for war or surrender.
  v_state := jsonb_build_object(
    'player', d[1], 'dealer', d[2], 'tied', true, 'ante', p_ante, 'tie_bet', v_tb,
    'tie_return', v_tb * ((private.more_cfg('casino_war') ->> 'tie_pays')::integer + 1));
  v_id := private.solo_begin(v_uid, 'casino_war', p_tier, v_staked, v_state, d[6:10], null);
  return v_state || jsonb_build_object(
    'round_id', v_id,
    'balance', private.apply_chips(v_uid, -v_staked, 'bet', 'casino_war', v_id::text));
end $$;

create or replace function public.war_act(p_war boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  r       public.solo_rounds;
  d       smallint[];
  v_ante  bigint;
  v_staked bigint;
  v_total bigint;
  v_outcome text;
  pr      integer;
  dr      integer;
  v_balance bigint;
begin
  if p_war is null then
    raise exception 'action_not_allowed';
  end if;
  r := private.solo_open_round(v_uid, 'casino_war');
  select deck into d from public.solo_secrets where round_id = r.id;
  v_ante := (r.state ->> 'ante')::bigint;
  v_staked := r.staked;
  v_total := (r.state ->> 'tie_return')::bigint;

  if not p_war then
    v_outcome := 'surrender';
    v_total := v_total + v_ante / 2;
  else
    perform private.apply_chips(v_uid, -v_ante, 'bet', 'casino_war', r.id::text, jsonb_build_object('spot', 'war'));
    v_staked := v_staked + v_ante;
    -- d holds the cards after the first two: three burned for each side, then one each.
    pr := private.cg_r(d[1]);
    dr := private.cg_r(d[5]);
    if pr > dr then
      v_outcome := 'war_win';
      v_total := v_total + v_ante * 3;
    elsif pr = dr then
      v_outcome := 'war_tie';
      v_total := v_total + v_ante * 4;
    else
      v_outcome := 'war_lose';
    end if;
  end if;

  delete from public.solo_rounds where id = r.id;
  v_balance := private.apply_chips(v_uid, v_total, 'payout', 'casino_war', r.id::text);
  perform private.record_round(v_uid, 'casino_war', null, r.id, v_staked, v_total, jsonb_build_object('outcome', v_outcome));
  return r.state || jsonb_build_object(
    'round_id', r.id, 'outcome', v_outcome, 'went_to_war', p_war,
    'war_player', case when p_war then d[1] end, 'war_dealer', case when p_war then d[5] end,
    'staked', v_staked, 'win', v_total, 'balance', v_balance);
end $$;

-- =============================================================================
-- ULTIMATE TEXAS HOLD'EM
-- Ante and Blind (equal) plus an optional Trips bet. One Play bet, sized by when
-- you make it: 4x or 3x the ante before the flop, 2x on the flop, 1x at the
-- river (or fold there). The dealer needs a pair to qualify.
-- =============================================================================
create or replace function private.uth_made(p_score integer)
returns text language sql immutable set search_path = '' as $$
  select case when p_score >> 20 = 8 and (p_score >> 16) & 15 = 14 then 'royal_flush'
              else (array['high_card', 'pair', 'two_pair', 'three_kind', 'straight', 'flush', 'full_house',
                          'four_kind', 'straight_flush'])[(p_score >> 20) + 1] end
$$;

create or replace function public.uth_deal(p_tier text, p_ante bigint, p_trips bigint default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  v_tr    bigint := coalesce(p_trips, 0);
  v_bets  jsonb := jsonb_build_object('ante', p_ante) || case when v_tr > 0 then jsonb_build_object('trips', v_tr) else '{}'::jsonb end;
  v_staked bigint;
  d       smallint[];
  v_state jsonb;
  v_id    uuid;
begin
  if p_ante is null or v_tr < 0 then
    raise exception 'invalid_amount';
  end if;
  if exists (select 1 from public.solo_rounds where user_id = v_uid and game_key = 'ultimate_holdem') then
    raise exception 'round_in_progress';
  end if;
  -- The Blind always equals the ante.
  v_staked := private.solo_spots(v_uid, 'ultimate_holdem', p_tier, v_bets, '^(ante|trips)$') + p_ante;
  if (select balance from public.wallets where user_id = v_uid) < v_staked + p_ante then
    raise exception 'insufficient_chips'
      using hint = 'You need enough chips for the Ante, the Blind and at least a 1x Play bet.';
  end if;

  d := (private.shuffled_shoe(1))[1:9];
  v_state := jsonb_build_object('hole', to_jsonb(d[1:2]), 'board', '[]'::jsonb, 'stage', 'preflop',
                                'ante', p_ante, 'trips', v_tr);
  -- Hidden: the dealer's two cards, then the five board cards.
  v_id := private.solo_begin(v_uid, 'ultimate_holdem', p_tier, v_staked, v_state, d[3:9], null);
  return v_state || jsonb_build_object(
    'round_id', v_id,
    'balance', private.apply_chips(v_uid, -v_staked, 'bet', 'ultimate_holdem', v_id::text));
end $$;

-- p_action: preflop 'bet4' | 'bet3' | 'check'; flop 'bet2' | 'check'; river 'bet1' | 'fold'.
create or replace function public.uth_act(p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  c       jsonb := private.more_cfg('ultimate_holdem');
  r       public.solo_rounds;
  d       smallint[];
  v_hole  smallint[];
  v_board smallint[];
  v_stage text;
  v_ante  bigint;
  v_trips bigint;
  v_mult  integer;
  v_play  bigint := 0;
  v_staked bigint;
  p       record;
  q       record;
  v_made  text;
  v_qual  boolean;
  v_outcome text;
  v_ret_ante bigint := 0;
  v_ret_blind bigint := 0;
  v_ret_play bigint := 0;
  v_ret_trips bigint := 0;
  v_total bigint;
  v_balance bigint;
begin
  r := private.solo_open_round(v_uid, 'ultimate_holdem');
  v_stage := r.state ->> 'stage';
  v_mult := case
    when v_stage = 'preflop' and p_action = 'bet4' then 4
    when v_stage = 'preflop' and p_action = 'bet3' then 3
    when v_stage = 'flop' and p_action = 'bet2' then 2
    when v_stage = 'river' and p_action = 'bet1' then 1
    when v_stage in ('preflop', 'flop') and p_action = 'check' then 0
    when v_stage = 'river' and p_action = 'fold' then -1
  end;
  if v_mult is null then
    raise exception 'action_not_allowed' using hint = 'That move isn''t available at this point in the hand.';
  end if;
  select deck into d from public.solo_secrets where round_id = r.id;

  if v_mult = 0 then
    -- Check: turn over the flop, or the turn and river.
    update public.solo_rounds
       set state = state || jsonb_build_object(
             'stage', case when v_stage = 'preflop' then 'flop' else 'river' end,
             'board', to_jsonb(case when v_stage = 'preflop' then d[3:5] else d[3:7] end))
     where id = r.id
     returning state into r.state;
    return r.state || jsonb_build_object('round_id', r.id, 'done', false);
  end if;

  select array_agg(x::smallint order by o) into v_hole from jsonb_array_elements_text(r.state -> 'hole') with ordinality e(x, o);
  v_board := d[3:7];
  v_ante := (r.state ->> 'ante')::bigint;
  v_trips := (r.state ->> 'trips')::bigint;
  v_staked := r.staked;
  if v_mult > 0 then
    v_play := v_ante * v_mult;
    perform private.apply_chips(v_uid, -v_play, 'bet', 'ultimate_holdem', r.id::text, jsonb_build_object('spot', 'play'));
    v_staked := v_staked + v_play;
  end if;

  select * into p from private.pk_best(v_hole, v_board, false);
  select * into q from private.pk_best(d[1:2], v_board, false);
  v_made := private.uth_made(p.score);
  v_qual := q.score >> 20 >= 1;

  -- Trips pays on the player's own hand, whatever else happens.
  if v_trips > 0 and c -> 'trips' ? v_made then
    v_ret_trips := v_trips * ((c -> 'trips' ->> v_made)::integer + 1);
  end if;

  if v_mult < 0 then
    v_outcome := 'fold';
  elsif p.score > q.score then
    v_outcome := 'win';
    v_ret_play := v_play * 2;
    v_ret_ante := case when v_qual then v_ante * 2 else v_ante end;
    v_ret_blind := v_ante + floor(v_ante * coalesce((c -> 'blind' ->> v_made)::numeric, 0))::bigint;
  elsif p.score = q.score then
    v_outcome := 'tie';
    v_ret_play := v_play;
    v_ret_ante := v_ante;
    v_ret_blind := v_ante;
  else
    v_outcome := 'lose';
    v_ret_ante := case when v_qual then 0 else v_ante end;
  end if;
  v_total := v_ret_ante + v_ret_blind + v_ret_play + v_ret_trips;

  delete from public.solo_rounds where id = r.id;
  v_balance := private.apply_chips(v_uid, v_total, 'payout', 'ultimate_holdem', r.id::text);
  perform private.record_round(v_uid, 'ultimate_holdem', null, r.id, v_staked, v_total,
                               jsonb_build_object('outcome', v_outcome, 'made', v_made));
  return jsonb_build_object(
    'round_id', r.id, 'done', true, 'stage', 'showdown', 'hole', to_jsonb(v_hole), 'board', to_jsonb(v_board),
    'dealer', to_jsonb(d[1:2]), 'made', v_made, 'dealer_made', private.uth_made(q.score),
    'best', to_jsonb(p.cards), 'dealer_best', to_jsonb(q.cards),
    'qualifies', v_qual, 'outcome', v_outcome, 'ante', v_ante, 'trips', v_trips, 'play', v_play,
    'returns', jsonb_build_object('ante', v_ret_ante, 'blind', v_ret_blind, 'play', v_ret_play, 'trips', v_ret_trips),
    'staked', v_staked, 'win', v_total, 'balance', v_balance);
end $$;

-- =============================================================================
-- PLINKO
-- The ball goes left or right at each of p_rows pegs; the slot it lands in is the
-- number of times it went right.
-- =============================================================================
create or replace function public.plinko_drop(p_bet bigint, p_rows integer, p_risk text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  v_table jsonb := private.more_cfg('plinko') -> 'returns' -> p_rows::text -> p_risk;
  v_tier  text;
  v_round uuid := gen_random_uuid();
  v_path  integer[];
  v_slot  integer := 0;
  v_units bigint;
  v_win   bigint;
  s       integer;
begin
  if v_table is null then
    raise exception 'invalid_bet';
  end if;
  v_tier := private.more_bet_tier(v_uid, 'plinko', p_bet);
  for i in 1..p_rows loop
    s := private.random_int(2);
    v_path := v_path || s;
    v_slot := v_slot + s;
  end loop;
  v_units := (v_table ->> v_slot)::bigint;
  v_win := p_bet * v_units / 100;
  return jsonb_build_object(
    'round_id', v_round, 'path', to_jsonb(v_path), 'slot', v_slot, 'units', v_units, 'bet', p_bet, 'win', v_win,
    'balance', private.solo_settle(v_uid, 'plinko', v_round, p_bet, v_win,
                                   jsonb_build_object('units', v_units, 'rows', p_rows, 'risk', p_risk)));
end $$;

-- =============================================================================
-- MINES
-- 25 tiles, p_mines of them mined. Each safe tile multiplies the prize by the
-- fair odds of having found it, less the house edge taken once at the start.
-- =============================================================================
-- Prize in hundredths of the bet after p_safe safe tiles (rounded down).
create or replace function private.mines_units(p_mines integer, p_safe integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  m numeric := (100 - (private.more_cfg('mines') ->> 'edge_pct')::numeric) / 100;
begin
  for i in 0..p_safe - 1 loop
    m := m * (25 - i) / (25 - p_mines - i);
  end loop;
  return floor(m * 100)::bigint;
end $$;

create or replace function private.mines_state(r public.solo_rounds)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select r.state || jsonb_build_object(
    'round_id', r.id,
    'units', private.mines_units((r.state ->> 'mines')::integer, jsonb_array_length(r.state -> 'picked')),
    'next_units', private.mines_units((r.state ->> 'mines')::integer, jsonb_array_length(r.state -> 'picked') + 1))
$$;

create or replace function public.mines_start(p_bet bigint, p_mines integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_uid();
  v_tier text;
  v_id   uuid;
  r      public.solo_rounds;
begin
  if p_mines is null or p_mines < 1 or p_mines > 24 then
    raise exception 'invalid_bet';
  end if;
  if exists (select 1 from public.solo_rounds where user_id = v_uid and game_key = 'mines') then
    raise exception 'round_in_progress';
  end if;
  v_tier := private.more_bet_tier(v_uid, 'mines', p_bet);
  -- Hidden: which tiles (0..24) are mined.
  v_id := private.solo_begin(v_uid, 'mines', v_tier, p_bet,
                             jsonb_build_object('bet', p_bet, 'mines', p_mines, 'picked', '[]'::jsonb),
                             (select array_agg((x - 1)::smallint) from unnest(private.draw_numbers(25, p_mines)) x), null);
  select * into r from public.solo_rounds where id = v_id;
  return private.mines_state(r) || jsonb_build_object(
    'balance', private.apply_chips(v_uid, -p_bet, 'bet', 'mines', v_id::text));
end $$;

-- Ends a mines round: pays p_win, records it and shows where the mines were.
create or replace function private.mines_finish(r public.solo_rounds, p_win bigint, p_outcome text, p_hit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mines smallint[];
  v_bet bigint := (r.state ->> 'bet')::bigint;
  v_balance bigint;
begin
  select deck into v_mines from public.solo_secrets where round_id = r.id;
  delete from public.solo_rounds where id = r.id;
  v_balance := private.apply_chips(r.user_id, p_win, 'payout', 'mines', r.id::text);
  perform private.record_round(r.user_id, 'mines', null, r.id, v_bet, p_win, jsonb_build_object(
    'outcome', p_outcome, 'mines', r.state -> 'mines', 'safe', jsonb_array_length(r.state -> 'picked')));
  return r.state || jsonb_build_object(
    'round_id', r.id, 'done', true, 'outcome', p_outcome, 'hit', p_hit, 'mine_tiles', to_jsonb(v_mines),
    'units', case when p_win > 0 then private.mines_units((r.state ->> 'mines')::integer, jsonb_array_length(r.state -> 'picked')) else 0 end,
    'win', p_win, 'balance', v_balance);
end $$;

create or replace function public.mines_pick(p_tile integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r     public.solo_rounds;
  v_mines smallint[];
  n     integer;
begin
  r := private.solo_open_round(v_uid, 'mines');
  if p_tile is null or p_tile < 0 or p_tile > 24 or r.state -> 'picked' @> to_jsonb(p_tile) then
    raise exception 'invalid_bet';
  end if;
  select deck into v_mines from public.solo_secrets where round_id = r.id;
  if p_tile = any (v_mines) then
    return private.mines_finish(r, 0, 'boom', p_tile);
  end if;
  update public.solo_rounds set state = jsonb_set(state, '{picked}', (state -> 'picked') || to_jsonb(p_tile))
   where id = r.id returning * into r;
  n := jsonb_array_length(r.state -> 'picked');
  if n = 25 - (r.state ->> 'mines')::integer then
    -- Every safe tile found: collect automatically.
    return private.mines_finish(r, (r.state ->> 'bet')::bigint * private.mines_units((r.state ->> 'mines')::integer, n) / 100, 'cleared', null);
  end if;
  return private.mines_state(r) || jsonb_build_object('done', false);
end $$;

create or replace function public.mines_collect()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r     public.solo_rounds;
  n     integer;
begin
  r := private.solo_open_round(v_uid, 'mines');
  n := jsonb_array_length(r.state -> 'picked');
  if n = 0 then
    raise exception 'action_not_allowed' using hint = 'Uncover at least one tile first.';
  end if;
  return private.mines_finish(r, (r.state ->> 'bet')::bigint * private.mines_units((r.state ->> 'mines')::integer, n) / 100, 'collected', null);
end $$;

-- =============================================================================
-- SCRATCH CARDS
-- The prize is drawn first from the card's prize table (weights out of 100,000).
-- Then nine panels are laid out to show it: three matching prizes on a winning
-- card, and never three of anything on a losing one.
-- =============================================================================
create or replace function public.scratch_play(p_card text, p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  c       jsonb := private.more_cfg('scratch_cards');
  v_prizes jsonb := c -> 'cards' -> p_card -> 'prizes';
  v_tier  text;
  v_round uuid := gen_random_uuid();
  v_roll  integer;
  v_acc   integer := 0;
  v_units bigint := 0;
  v_pool  bigint[];
  v_panels bigint[];
  n       integer;
  j       integer;
  t       bigint;
  p       jsonb;
  v_win   bigint;
begin
  if v_prizes is null then
    raise exception 'invalid_bet';
  end if;
  v_tier := private.more_bet_tier(v_uid, 'scratch_cards', p_bet);

  v_roll := private.random_int((c ->> 'out_of')::integer);
  for p in select value from jsonb_array_elements(v_prizes) loop
    v_acc := v_acc + (p ->> 1)::integer;
    if v_roll < v_acc then
      v_units := (p ->> 0)::bigint;
      exit;
    end if;
  end loop;

  -- Two of every other prize, shuffled; take what the card still needs.
  select array_agg(u) into v_pool
    from (select (x.v ->> 0)::bigint as u from jsonb_array_elements(v_prizes) x(v), generate_series(1, 2)) s
   where u <> v_units;
  n := cardinality(v_pool);
  for i in reverse n..2 loop
    j := private.random_int(i) + 1;
    t := v_pool[i]; v_pool[i] := v_pool[j]; v_pool[j] := t;
  end loop;
  v_panels := case when v_units > 0 then array[v_units, v_units, v_units] || v_pool[1:6] else v_pool[1:9] end;
  for i in reverse 9..2 loop
    j := private.random_int(i) + 1;
    t := v_panels[i]; v_panels[i] := v_panels[j]; v_panels[j] := t;
  end loop;

  v_win := p_bet * v_units / 100;
  return jsonb_build_object(
    'round_id', v_round, 'card', p_card, 'panels', to_jsonb(v_panels), 'units', v_units, 'bet', p_bet, 'win', v_win,
    'balance', private.solo_settle(v_uid, 'scratch_cards', v_round, p_bet, v_win,
                                   jsonb_build_object('card', p_card, 'units', v_units)));
end $$;

-- =============================================================================
-- POWER DRAW
-- Pick 5 different numbers from 1..30 and a power ball from 1..10. Five numbers
-- and a power ball are drawn. Prizes are keyed by matches: '3' = three numbers,
-- '3p' = three numbers and the power ball.
-- =============================================================================
create or replace function public.power_draw_play(p_bet bigint, p_picks integer[], p_power integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := private.require_uid();
  c       jsonb := private.more_cfg('power_draw');
  v_tier  text;
  v_round uuid := gen_random_uuid();
  v_drawn integer[];
  v_power integer;
  v_hits  integer[];
  v_key   text;
  v_units bigint;
  v_win   bigint;
begin
  if coalesce(cardinality(p_picks), 0) <> (c ->> 'picks')::integer
     or (select count(distinct x) from unnest(p_picks) x where x between 1 and (c ->> 'numbers')::integer) <> (c ->> 'picks')::integer
     or p_power is null or p_power < 1 or p_power > (c ->> 'powers')::integer then
    raise exception 'invalid_picks';
  end if;
  v_tier := private.more_bet_tier(v_uid, 'power_draw', p_bet);

  v_drawn := private.draw_numbers((c ->> 'numbers')::integer, (c ->> 'picks')::integer);
  v_power := private.random_int((c ->> 'powers')::integer) + 1;
  select coalesce(array_agg(x order by x), '{}') into v_hits from unnest(p_picks) x where x = any (v_drawn);
  v_key := cardinality(v_hits)::text || case when v_power = p_power then 'p' else '' end;
  v_units := coalesce((c -> 'returns' ->> v_key)::bigint, 0);
  v_win := p_bet * v_units / 100;
  return jsonb_build_object(
    'round_id', v_round, 'picks', to_jsonb(p_picks), 'power_pick', p_power, 'drawn', to_jsonb(v_drawn), 'power', v_power,
    'hits', to_jsonb(v_hits), 'power_hit', v_power = p_power, 'units', v_units, 'bet', p_bet, 'win', v_win,
    'balance', private.solo_settle(v_uid, 'power_draw', v_round, p_bet, v_win,
                                   jsonb_build_object('hits', cardinality(v_hits), 'power_hit', v_power = p_power)));
end $$;

-- =============================================================================
-- CRASH (one live room)
-- betting (8 s) -> flying (until the hidden crash point) -> crashed (4 s) -> ...
-- The multiplier is exp(growth * seconds flown), shown to two decimals. The
-- crash point is drawn when betting closes: P(point >= x) = 0.97 / x, so 3 in
-- 100 rounds crash at once at 1.00x. Rounds only move while someone is watching.
-- =============================================================================
create table if not exists public.crash_rounds (
  id               uuid primary key default gen_random_uuid(),
  round_no         bigint generated always as identity,
  phase            text not null check (phase in ('betting', 'flying', 'crashed')),
  betting_ends_at  timestamptz not null,
  started_at       timestamptz,
  crashed_at       timestamptz,
  -- Null until the round has crashed.
  crash_point      numeric(10, 2),
  created_at       timestamptz not null default now()
);
create index if not exists crash_rounds_no_idx on public.crash_rounds (round_no desc);

create table if not exists public.crash_bets (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid not null references public.crash_rounds (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  username      text not null,
  amount        bigint not null check (amount > 0),
  -- Collect automatically at this multiplier (optional).
  auto_at       numeric(10, 2),
  collected_at  numeric(10, 2),
  payout        bigint not null default 0,
  settled       boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (round_id, user_id)
);
create index if not exists crash_bets_open_idx on public.crash_bets (user_id) where not settled;

-- HIDDEN: where this round will crash.
create table if not exists public.crash_secrets (
  round_id     uuid primary key references public.crash_rounds (id) on delete cascade,
  crash_point  numeric(10, 2) not null,
  crash_at     timestamptz not null
);

-- The multiplier p_seconds into the flight, to two decimals (rounded down).
create or replace function private.crash_mult(p_seconds numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select trunc(exp(greatest(p_seconds, 0) * (private.more_cfg('crash') ->> 'growth')::numeric), 2)
$$;

-- Pays one crash bet at p_mult (0 = lost) and records it.
create or replace function private.crash_settle_bet(b public.crash_bets, p_mult numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay bigint := floor(b.amount * p_mult)::bigint;
begin
  update public.crash_bets
     set settled = true, payout = v_pay, collected_at = case when p_mult > 0 then p_mult end
   where id = b.id;
  perform private.apply_chips(b.user_id, v_pay, 'payout', 'crash', b.round_id::text, jsonb_build_object('at', p_mult));
  perform private.record_round(b.user_id, 'crash', null, b.round_id, b.amount, v_pay,
                               jsonb_build_object('collected_at', case when p_mult > 0 then p_mult end));
end $$;

-- Moves the room along to "now". p_open: also open a new betting round when the
-- last one is over (only when a player is actually there).
create or replace function private.crash_tick(p_open boolean)
returns public.crash_rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := private.more_cfg('crash');
  r public.crash_rounds;
  s public.crash_secrets;
  b public.crash_bets;
  v_point numeric;
  v_now numeric;
begin
  perform pg_advisory_xact_lock(hashtext('allin_crash'));
  for i in 1..4 loop
    select * into r from public.crash_rounds order by round_no desc limit 1;

    if not found or (r.phase = 'crashed' and now() >= r.crashed_at + make_interval(secs => (c ->> 'cooldown_seconds')::integer)) then
      exit when not p_open;
      insert into public.crash_rounds (phase, betting_ends_at)
      values ('betting', now() + make_interval(secs => (c ->> 'bet_seconds')::integer))
      returning * into r;
      exit;

    elsif r.phase = 'betting' and now() >= r.betting_ends_at then
      -- Draw the crash point: 0.97 / (1 - u), at least 1.00.
      v_point := least(greatest(trunc((100 - (c ->> 'edge_pct')::numeric) / (1 - private.random_int(1000000) / 1000000.0) / 100, 2), 1.00),
                       (c ->> 'max')::numeric);
      insert into public.crash_secrets (round_id, crash_point, crash_at)
      values (r.id, v_point, now() + make_interval(secs => (ln(v_point) / (c ->> 'growth')::numeric)::double precision));
      update public.crash_rounds set phase = 'flying', started_at = now() where id = r.id;

    elsif r.phase = 'flying' then
      select * into s from public.crash_secrets where round_id = r.id;
      if now() >= s.crash_at then
        -- Crashed: automatic collects that got there in time are paid, the rest lose.
        for b in select * from public.crash_bets where round_id = r.id and not settled loop
          perform private.crash_settle_bet(b, case when b.auto_at is not null and b.auto_at <= s.crash_point then b.auto_at else 0 end);
        end loop;
        update public.crash_rounds set phase = 'crashed', crashed_at = s.crash_at, crash_point = s.crash_point where id = r.id;
      else
        -- Still flying: pay automatic collects the multiplier has passed.
        v_now := private.crash_mult(extract(epoch from now() - r.started_at)::numeric);
        for b in select * from public.crash_bets where round_id = r.id and not settled and auto_at is not null and auto_at <= v_now loop
          perform private.crash_settle_bet(b, b.auto_at);
        end loop;
        exit;
      end if;

    else
      exit;
    end if;
  end loop;
  select * into r from public.crash_rounds order by round_no desc limit 1;
  return r;
end $$;

create or replace function private.crash_tick_stale()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.crash_bets where not settled) then
    perform private.crash_tick(false);
  end if;
end $$;

create or replace function private.crash_in_play(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0)::bigint from public.crash_bets where user_id = p_user and not settled;
$$;

create or replace function public.crash_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r     public.crash_rounds := private.crash_tick(true);
begin
  return jsonb_build_object(
    'server_now', now(),
    'round', to_jsonb(r),
    'bets', (select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', b.user_id, 'username', b.username, 'amount', b.amount, 'auto_at', b.auto_at,
               'collected_at', b.collected_at, 'payout', b.payout, 'settled', b.settled) order by b.created_at), '[]'::jsonb)
               from public.crash_bets b where b.round_id = r.id),
    'recent', (select coalesce(jsonb_agg(x.crash_point order by x.round_no desc), '[]'::jsonb)
                 from (select crash_point, round_no from public.crash_rounds
                        where phase = 'crashed' order by round_no desc limit 20) x)
  );
end $$;

-- p_auto: collect automatically at this multiplier (1.01 or more), or null.
create or replace function public.crash_bet(p_amount bigint, p_auto numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r     public.crash_rounds := private.crash_tick(true);
  v_tier text;
begin
  if r.phase <> 'betting' then
    raise exception 'betting_closed';
  end if;
  if p_auto is not null and (p_auto < 1.01 or p_auto > (private.more_cfg('crash') ->> 'max')::numeric) then
    raise exception 'invalid_amount';
  end if;
  if exists (select 1 from public.crash_bets where round_id = r.id and user_id = v_uid) then
    raise exception 'action_not_allowed' using hint = 'You already have a bet on this round.';
  end if;
  v_tier := private.more_bet_tier(v_uid, 'crash', p_amount);
  insert into public.crash_bets (round_id, user_id, username, amount, auto_at)
  values (r.id, v_uid, (select username from public.profiles where id = v_uid), p_amount, trunc(p_auto, 2));
  return jsonb_build_object(
    'round_id', r.id,
    'balance', private.apply_chips(v_uid, -p_amount, 'bet', 'crash', r.id::text));
end $$;

create or replace function public.crash_collect()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r     public.crash_rounds := private.crash_tick(true);
  b     public.crash_bets;
  m     numeric;
begin
  select * into b from public.crash_bets where round_id = r.id and user_id = v_uid for update;
  if r.phase <> 'flying' or not found or b.settled then
    raise exception 'action_not_allowed' using hint = 'Too late: that round is over.';
  end if;
  m := private.crash_mult(extract(epoch from now() - r.started_at)::numeric);
  perform private.crash_settle_bet(b, m);
  return jsonb_build_object(
    'collected_at', m, 'payout', floor(b.amount * m)::bigint,
    'balance', (select balance from public.wallets where user_id = v_uid));
end $$;

-- =============================================================================
-- BINGO (one live room)
-- selling (20 s from the first card) -> calling (40 balls, one a second) -> done.
-- Every card is five random numbers per column (B 1-15 … O 61-75) with a free
-- centre, stored column by column. A card's prize depends on how early its first
-- line (row, column or diagonal) is completed; later lines don't add to it.
-- =============================================================================
create table if not exists public.bingo_rounds (
  id               uuid primary key default gen_random_uuid(),
  round_no         bigint generated always as identity,
  phase            text not null check (phase in ('selling', 'calling', 'done')),
  selling_ends_at  timestamptz not null,
  started_at       timestamptz,
  ended_at         timestamptz,
  -- Filled in when the round is done.
  balls            smallint[],
  created_at       timestamptz not null default now()
);
create index if not exists bingo_rounds_no_idx on public.bingo_rounds (round_no desc);

create table if not exists public.bingo_cards (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.bingo_rounds (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  username    text not null,
  numbers     smallint[] not null,
  price       bigint not null check (price > 0),
  -- Set when the round is done: the call that completed the first line (null = none), and the prize.
  line_at     integer,
  payout      bigint not null default 0,
  settled     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists bingo_cards_round_idx on public.bingo_cards (round_id, user_id);
create index if not exists bingo_cards_open_idx on public.bingo_cards (user_id) where not settled;

-- HIDDEN: the balls of a round in the order they will be called.
create table if not exists public.bingo_secrets (
  round_id  uuid primary key references public.bingo_rounds (id) on delete cascade,
  balls     smallint[] not null
);

create or replace function private.bingo_card()
returns smallint[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  v smallint[] := '{}';
  col integer[];
begin
  for c in 0..4 loop
    col := private.draw_numbers(15, 5);
    for r in 1..5 loop
      v := v || (case when c = 2 and r = 3 then 0 else c * 15 + col[r] end)::smallint;
    end loop;
  end loop;
  return v;
end $$;

-- The call (1-based) on which a card first has a full line, or null.
create or replace function private.bingo_line_at(p_numbers smallint[], p_balls smallint[])
returns integer
language sql
immutable
set search_path = ''
as $$
  with pos as (
    select o - 1 as cell, case when n = 0 then 0 else array_position(p_balls, n) end as called
      from unnest(p_numbers) with ordinality u(n, o)
  ), lines(cells) as (
    select array[c * 5, c * 5 + 1, c * 5 + 2, c * 5 + 3, c * 5 + 4] from generate_series(0, 4) c
    union all select array[r, r + 5, r + 10, r + 15, r + 20] from generate_series(0, 4) r
    union all select array[0, 6, 12, 18, 24]
    union all select array[4, 8, 12, 16, 20]
  )
  select min(done) from (
    select case when count(p.called) = 5 then max(p.called) end as done
      from lines l join pos p on p.cell = any (l.cells) group by l.cells
  ) x
$$;

-- Prize in hundredths of the card price for a first line on call p_at.
create or replace function private.bingo_units(p_at integer)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select coalesce((select (x.v ->> 1)::bigint from jsonb_array_elements(private.more_cfg('bingo') -> 'returns') with ordinality x(v, o)
                    where p_at <= (x.v ->> 0)::integer order by x.o limit 1), 0)
$$;

create or replace function private.bingo_tick()
returns public.bingo_rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := private.more_cfg('bingo');
  r public.bingo_rounds;
  v_balls smallint[];
  u record;
begin
  perform pg_advisory_xact_lock(hashtext('allin_bingo'));
  for i in 1..3 loop
    select * into r from public.bingo_rounds order by round_no desc limit 1;
    exit when not found;

    if r.phase = 'selling' and now() >= r.selling_ends_at then
      insert into public.bingo_secrets (round_id, balls)
      values (r.id, (select array_agg(x::smallint order by o) from unnest(private.draw_numbers(75, (c ->> 'calls')::integer)) with ordinality t(x, o)));
      update public.bingo_rounds set phase = 'calling', started_at = now() where id = r.id;

    elsif r.phase = 'calling'
          and now() >= r.started_at + make_interval(secs => (c ->> 'calls')::integer * (c ->> 'interval_ms')::integer / 1000.0) then
      select balls into v_balls from public.bingo_secrets where round_id = r.id;
      update public.bingo_cards k2
         set line_at = private.bingo_line_at(k2.numbers, v_balls),
             payout = k2.price * private.bingo_units(private.bingo_line_at(k2.numbers, v_balls)) / 100,
             settled = true
       where k2.round_id = r.id;
      -- One payment and one history row per player.
      for u in select user_id, sum(price)::bigint as staked, sum(payout)::bigint as won, count(*) as cards, min(line_at) as best
                 from public.bingo_cards where round_id = r.id group by user_id loop
        perform private.apply_chips(u.user_id, u.won, 'payout', 'bingo', r.id::text);
        perform private.record_round(u.user_id, 'bingo', null, r.id, u.staked, u.won,
                                     jsonb_build_object('cards', u.cards, 'line_at', u.best));
      end loop;
      update public.bingo_rounds set phase = 'done', ended_at = now(), balls = v_balls where id = r.id;

    else
      exit;
    end if;
  end loop;
  select * into r from public.bingo_rounds order by round_no desc limit 1;
  return r;
end $$;

create or replace function private.bingo_tick_stale()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.bingo_cards where not settled) then
    perform private.bingo_tick();
  end if;
end $$;

create or replace function private.bingo_in_play(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(price), 0)::bigint from public.bingo_cards where user_id = p_user and not settled;
$$;

create or replace function public.bingo_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c     jsonb := private.more_cfg('bingo');
  r     public.bingo_rounds := private.bingo_tick();
  v_called integer := 0;
begin
  if r.id is null then
    return jsonb_build_object('server_now', now(), 'round', null, 'called', '[]'::jsonb, 'cards', '[]'::jsonb,
                              'players', '[]'::jsonb, 'winners', '[]'::jsonb);
  end if;
  if r.phase = 'calling' then
    v_called := least((c ->> 'calls')::integer,
                      floor(extract(epoch from now() - r.started_at) * 1000 / (c ->> 'interval_ms')::integer)::integer + 1);
  end if;
  return jsonb_build_object(
    'server_now', now(),
    'round', jsonb_build_object('id', r.id, 'phase', r.phase, 'selling_ends_at', r.selling_ends_at,
                                'started_at', r.started_at, 'ended_at', r.ended_at),
    -- Only the balls called so far ever leave the server.
    'called', case when r.phase = 'done' then to_jsonb(r.balls)
                   when r.phase = 'calling' then to_jsonb((select balls[1:v_called] from public.bingo_secrets where round_id = r.id))
                   else '[]'::jsonb end,
    'cards', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'numbers', k.numbers, 'price', k.price,
                                                           'line_at', k.line_at, 'payout', k.payout) order by k.created_at), '[]'::jsonb)
                from public.bingo_cards k where k.round_id = r.id and k.user_id = v_uid),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('username', x.username, 'cards', x.n) order by x.first), '[]'::jsonb)
                  from (select username, count(*) as n, min(created_at) as first from public.bingo_cards
                         where round_id = r.id group by username) x),
    'winners', case when r.phase = 'done' then
                 (select coalesce(jsonb_agg(jsonb_build_object('username', x.username, 'payout', x.won, 'line_at', x.best) order by x.best), '[]'::jsonb)
                    from (select username, sum(payout) as won, min(line_at) as best from public.bingo_cards
                           where round_id = r.id and payout > 0 group by username) x)
               else '[]'::jsonb end
  );
end $$;

-- Buys p_count cards at p_price each for the round that is selling (opening one if needed).
create or replace function public.bingo_buy(p_price bigint, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c     jsonb := private.more_cfg('bingo');
  r     public.bingo_rounds := private.bingo_tick();
  v_tier text;
  v_name text;
begin
  if p_count is null or p_count < 1 then
    raise exception 'invalid_amount';
  end if;
  if r.id is not null and r.phase = 'calling' then
    raise exception 'betting_closed';
  end if;
  v_tier := private.more_bet_tier(v_uid, 'bingo', p_price);
  if r.id is null or r.phase = 'done' then
    if r.id is not null and now() < r.ended_at + make_interval(secs => (c ->> 'cooldown_seconds')::integer) then
      raise exception 'next_round_pending';
    end if;
    insert into public.bingo_rounds (phase, selling_ends_at)
    values ('selling', now() + make_interval(secs => (c ->> 'sell_seconds')::integer))
    returning * into r;
  end if;
  if (select count(*) from public.bingo_cards where round_id = r.id and user_id = v_uid) + p_count > (c ->> 'max_cards')::integer then
    raise exception 'action_not_allowed' using hint = format('You can have up to %s cards in a round.', c ->> 'max_cards');
  end if;
  select username into v_name from public.profiles where id = v_uid;
  for i in 1..p_count loop
    insert into public.bingo_cards (round_id, user_id, username, numbers, price)
    values (r.id, v_uid, v_name, private.bingo_card(), p_price);
  end loop;
  return jsonb_build_object(
    'round_id', r.id,
    'balance', private.apply_chips(v_uid, -p_price * p_count, 'bet', 'bingo', r.id::text, jsonb_build_object('cards', p_count)));
end $$;

-- =============================================================================
-- What a game's screen needs (same shape as solo_info in 11).
-- =============================================================================
create or replace function public.more_info(p_game text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.more_cfg(p_game);
  g public.games;
  r public.solo_rounds;
begin
  select * into g from public.games where key = p_game;
  if c is null or not found then
    raise exception 'unknown_game';
  end if;
  select * into r from public.solo_rounds where user_id = v_uid and game_key = p_game;
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
    'round', case when r.id is null then null
                  when p_game = 'mines' then private.mines_state(r) || jsonb_build_object('tier', r.tier)
                  else r.state || jsonb_build_object('round_id', r.id, 'tier', r.tier) end
  );
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.more_info(text)', 'public.dragon_tiger_deal(text, jsonb)', 'public.war_deal(text, bigint, bigint)',
    'public.war_act(boolean)', 'public.uth_deal(text, bigint, bigint)', 'public.uth_act(text)',
    'public.plinko_drop(bigint, integer, text)', 'public.mines_start(bigint, integer)', 'public.mines_pick(integer)',
    'public.mines_collect()', 'public.scratch_play(text, bigint)', 'public.power_draw_play(bigint, integer[], integer)',
    'public.crash_state()', 'public.crash_bet(bigint, numeric)', 'public.crash_collect()',
    'public.bingo_state()', 'public.bingo_buy(bigint, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.crash_rounds  enable row level security;
alter table public.crash_bets    enable row level security;
alter table public.crash_secrets enable row level security;
alter table public.bingo_rounds  enable row level security;
alter table public.bingo_cards   enable row level security;
alter table public.bingo_secrets enable row level security;

-- Everyone in the room sees the round and who bet what, as at a table.
drop policy if exists "crash_rounds: signed-in players can read" on public.crash_rounds;
create policy "crash_rounds: signed-in players can read"
  on public.crash_rounds for select to authenticated using (true);

drop policy if exists "crash_bets: signed-in players can read" on public.crash_bets;
create policy "crash_bets: signed-in players can read"
  on public.crash_bets for select to authenticated using (true);

drop policy if exists "bingo_rounds: signed-in players can read" on public.bingo_rounds;
create policy "bingo_rounds: signed-in players can read"
  on public.bingo_rounds for select to authenticated using (true);

drop policy if exists "bingo_cards: read own" on public.bingo_cards;
create policy "bingo_cards: read own"
  on public.bingo_cards for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.crash_secrets, public.bingo_secrets from anon, authenticated;
revoke insert, update, delete, truncate on public.crash_rounds, public.crash_bets, public.bingo_rounds, public.bingo_cards
  from anon, authenticated;
revoke all on public.crash_rounds, public.crash_bets, public.bingo_rounds, public.bingo_cards from anon;
grant select on public.crash_rounds, public.crash_bets, public.bingo_rounds, public.bingo_cards to authenticated;

-- -----------------------------------------------------------------------------
-- Open the games. The two live rooms tell their watchers when something changes.
-- -----------------------------------------------------------------------------
update public.games set released = true
 where key in ('dragon_tiger', 'casino_war', 'ultimate_holdem', 'crash', 'plinko', 'mines',
               'scratch_cards', 'power_draw', 'bingo');

select private.add_to_realtime('crash_rounds');
select private.add_to_realtime('crash_bets');
select private.add_to_realtime('bingo_rounds');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

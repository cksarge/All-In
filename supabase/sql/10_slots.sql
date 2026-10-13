-- =============================================================================
-- All In · 10_slots.sql
-- Six solo slot machines and one shared progressive jackpot.
--
--   slots_classic      Lucky Sevens       3 reels, one centre payline
--   slots_paylines     Pharaoh's Fortune  5x3, 20 paylines, wilds, free spins (wins x2)
--   slots_cascade      Gem Cascade        6x5 cluster pays, cascades with a rising multiplier
--   slots_ways         Wild Frontier      243 to 3,125 ways, free spins on full-height reels
--   slots_holdwin      Dragon Pearls      5x3, 10 paylines, hold-and-win pearl respins
--   slots_progressive  Grand Jackpot      5x3, 10 paylines, feeds and can win the shared jackpot
--
-- How a spin works:
--   * slot_spin(game, bet) does everything in one transaction: takes the bet,
--     draws every symbol with private.random_int (crypto-random), plays out any
--     feature (free spins, respins, cascades) to the end, pays, and returns the
--     whole sequence for the browser to replay. Nothing is decided in the
--     browser and there is no half-finished feature to resume.
--   * Each visible cell is drawn independently from its reel's weighted bag.
--   * Paytables are in HUNDREDTHS of the total bet ("units") and every value is
--     a multiple of 10. Bets are multiples of 10, so bet * units / 100 is always
--     a whole number of chips.
--   * The stake level is the lowest one whose bet range contains the bet, and
--     the player needs that level's minimum bankroll, like at the tables.
--
-- Grand Jackpot: 2% of every Grand Jackpot bet feeds the pot. Each spin wins it
-- with probability bet / odds, so bigger bets have a proportionally better
-- chance. A win pays the whole pot and resets it to the seed.
--
-- The numbers below come from an offline model (exact for the classic machine,
-- millions of simulated spins for the rest). private.slot_simulate() re-checks
-- them against this file in supabase/tests/06_slots_test.sql.
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The shared jackpot. The pot is kept in hundredths of a chip so small bets
-- still feed it; `amount` is what players see and win.
-- -----------------------------------------------------------------------------
create table if not exists public.jackpots (
  key              text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  game_key         text not null references public.games (key) on delete cascade,
  seed             bigint not null check (seed > 0),
  pool_hundredths  bigint not null check (pool_hundredths >= 0),
  amount           bigint generated always as (pool_hundredths / 100) stored,
  last_winner      text,
  last_amount      bigint,
  last_won_at      timestamptz,
  updated_at       timestamptz not null default now()
);

comment on table public.jackpots is
  'Progressive jackpots (play chips). Read-only for clients; only slot_spin changes them.';

-- -----------------------------------------------------------------------------
-- Machine maths. `weights` are per reel (one bag for the cluster game).
-- -----------------------------------------------------------------------------
create or replace function private.slot_cfg(p_game text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select ($cfg$
  {
    "slots_classic": {
      "kind": "classic",
      "reels": 3,
      "rows": 3,
      "weights": [
        {"SEVEN": 2, "BAR3": 3, "BAR2": 5, "BAR1": 7, "BELL": 6, "CHERRY": 4, "BLANK": 13},
        {"SEVEN": 2, "BAR3": 3, "BAR2": 5, "BAR1": 7, "BELL": 6, "CHERRY": 4, "BLANK": 13},
        {"SEVEN": 2, "BAR3": 3, "BAR2": 5, "BAR1": 7, "BELL": 6, "CHERRY": 4, "BLANK": 13}
      ],
      "pays": {"SEVEN": 15000, "BAR3": 5000, "BAR2": 3000, "BELL": 2500, "BAR1": 2000, "ANYBAR": 600, "CHERRY3": 2000, "CHERRY2": 500, "CHERRY1": 100},
      "rtp": 95.8
    },
    "slots_paylines": {
      "kind": "lines",
      "reels": 5,
      "rows": 3,
      "lines": 20,
      "wild": "WILD",
      "scatter": "SCATTER",
      "weights": [
        {"EYE": 2, "COBRA": 3, "SCORPION": 4, "URN": 5, "A": 7, "K": 8, "Q": 9, "J": 10, "SCATTER": 2},
        {"EYE": 2, "COBRA": 3, "SCORPION": 4, "URN": 5, "A": 7, "K": 8, "Q": 9, "J": 10, "SCATTER": 2, "WILD": 3},
        {"EYE": 2, "COBRA": 3, "SCORPION": 4, "URN": 5, "A": 7, "K": 8, "Q": 9, "J": 10, "SCATTER": 2, "WILD": 3},
        {"EYE": 2, "COBRA": 3, "SCORPION": 4, "URN": 5, "A": 7, "K": 8, "Q": 9, "J": 10, "SCATTER": 2, "WILD": 3},
        {"EYE": 2, "COBRA": 3, "SCORPION": 4, "URN": 5, "A": 7, "K": 8, "Q": 9, "J": 10, "SCATTER": 2}
      ],
      "pays": {
        "EYE": {"2": 30, "3": 250, "4": 1250, "5": 7500},
        "COBRA": {"3": 150, "4": 500, "5": 2500},
        "SCORPION": {"3": 100, "4": 400, "5": 1500},
        "URN": {"3": 80, "4": 250, "5": 1000},
        "A": {"3": 50, "4": 150, "5": 500},
        "K": {"3": 50, "4": 150, "5": 400},
        "Q": {"3": 40, "4": 100, "5": 300},
        "J": {"3": 30, "4": 100, "5": 250}
      },
      "scatter_pays": {"3": 200, "4": 1000, "5": 5000},
      "free": {"trigger": 3, "spins": 10, "mult": 2, "max": 50},
      "rtp": 96.6
    },
    "slots_cascade": {
      "kind": "cluster",
      "cols": 6,
      "rows": 5,
      "min": 5,
      "weights": {"DIAMOND": 5, "RUBY": 7, "EMERALD": 9, "SAPPHIRE": 12, "AMETHYST": 16, "TOPAZ": 20, "QUARTZ": 24},
      "sizes": [5, 6, 7, 8, 9, 10, 12, 15],
      "pays": {
        "DIAMOND": [1000, 1500, 2500, 4000, 6000, 10000, 25000, 100000],
        "RUBY": [500, 800, 1200, 2000, 3000, 5000, 12000, 50000],
        "EMERALD": [300, 500, 800, 1200, 2000, 3000, 8000, 25000],
        "SAPPHIRE": [200, 300, 500, 800, 1200, 2000, 5000, 15000],
        "AMETHYST": [120, 200, 300, 500, 800, 1200, 3000, 10000],
        "TOPAZ": [100, 150, 200, 300, 500, 800, 2000, 6000],
        "QUARTZ": [50, 100, 150, 250, 400, 600, 1500, 4000]
      },
      "mults": [1, 2, 3, 5, 10],
      "rtp": 95.3
    },
    "slots_ways": {
      "kind": "ways",
      "reels": 5,
      "wild": "WILD",
      "scatter": "SCATTER",
      "heights": [[3, 50], [4, 35], [5, 15]],
      "weights": [
        {"BISON": 3, "EAGLE": 4, "WOLF": 5, "HORSE": 6, "CACTUS": 7, "A": 9, "K": 10, "Q": 11, "J": 12, "SCATTER": 2},
        {"BISON": 3, "EAGLE": 4, "WOLF": 5, "HORSE": 6, "CACTUS": 7, "A": 9, "K": 10, "Q": 11, "J": 12, "SCATTER": 2, "WILD": 3},
        {"BISON": 3, "EAGLE": 4, "WOLF": 5, "HORSE": 6, "CACTUS": 7, "A": 9, "K": 10, "Q": 11, "J": 12, "SCATTER": 2, "WILD": 3},
        {"BISON": 3, "EAGLE": 4, "WOLF": 5, "HORSE": 6, "CACTUS": 7, "A": 9, "K": 10, "Q": 11, "J": 12, "SCATTER": 2, "WILD": 3},
        {"BISON": 3, "EAGLE": 4, "WOLF": 5, "HORSE": 6, "CACTUS": 7, "A": 9, "K": 10, "Q": 11, "J": 12, "SCATTER": 2}
      ],
      "pays": {
        "BISON": {"3": 70, "4": 200, "5": 700},
        "EAGLE": {"3": 50, "4": 140, "5": 400},
        "WOLF": {"3": 40, "4": 110, "5": 280},
        "HORSE": {"3": 30, "4": 80, "5": 200},
        "CACTUS": {"3": 20, "4": 60, "5": 160},
        "A": {"3": 20, "4": 40, "5": 80},
        "K": {"3": 10, "4": 30, "5": 70},
        "Q": {"3": 10, "4": 20, "5": 60},
        "J": {"3": 10, "4": 20, "5": 50}
      },
      "free": {"trigger": 3, "spins": 8, "height": 5, "max": 40},
      "rtp": 96.6
    },
    "slots_holdwin": {
      "kind": "lines",
      "reels": 5,
      "rows": 3,
      "lines": 10,
      "wild": "WILD",
      "weights": [
        {"DRAGON": 2, "TIGER": 3, "KOI": 4, "LANTERN": 6, "A": 8, "K": 10, "Q": 12, "PEARL": 7},
        {"DRAGON": 2, "TIGER": 3, "KOI": 4, "LANTERN": 6, "A": 8, "K": 10, "Q": 12, "PEARL": 7, "WILD": 3},
        {"DRAGON": 2, "TIGER": 3, "KOI": 4, "LANTERN": 6, "A": 8, "K": 10, "Q": 12, "PEARL": 7, "WILD": 3},
        {"DRAGON": 2, "TIGER": 3, "KOI": 4, "LANTERN": 6, "A": 8, "K": 10, "Q": 12, "PEARL": 7, "WILD": 3},
        {"DRAGON": 2, "TIGER": 3, "KOI": 4, "LANTERN": 6, "A": 8, "K": 10, "Q": 12, "PEARL": 7}
      ],
      "pays": {
        "DRAGON": {"2": 50, "3": 500, "4": 2500, "5": 10000},
        "TIGER": {"3": 300, "4": 1200, "5": 5000},
        "KOI": {"3": 200, "4": 600, "5": 2500},
        "LANTERN": {"3": 120, "4": 400, "5": 1200},
        "A": {"3": 80, "4": 250, "5": 800},
        "K": {"3": 60, "4": 200, "5": 600},
        "Q": {"3": 50, "4": 150, "5": 500}
      },
      "hold": {"symbol": "PEARL", "trigger": 6, "respins": 3, "land_bp": 700, "grand": 100000, "values": [[100, 40], [200, 25], [300, 15], [500, 10], [1000, 6], [2500, 3], [10000, 1]]},
      "rtp": 95.3
    },
    "slots_haunted": {
      "kind": "lines",
      "reels": 5,
      "rows": 3,
      "lines": 20,
      "wild": "WILD",
      "scatter": "SCATTER",
      "weights": [
        {"VAMPIRE": 2, "WITCH": 3, "SKULL": 4, "BAT": 5, "A": 7, "K": 8, "Q": 9, "J": 10, "SCATTER": 2},
        {"VAMPIRE": 2, "WITCH": 3, "SKULL": 4, "BAT": 5, "A": 7, "K": 8, "Q": 9, "J": 10, "SCATTER": 2, "WILD": 2},
        {"VAMPIRE": 2, "WITCH": 3, "SKULL": 4, "BAT": 5, "A": 7, "K": 8, "Q": 9, "J": 10, "SCATTER": 2, "WILD": 2},
        {"VAMPIRE": 2, "WITCH": 3, "SKULL": 4, "BAT": 5, "A": 7, "K": 8, "Q": 9, "J": 10, "SCATTER": 2, "WILD": 2},
        {"VAMPIRE": 2, "WITCH": 3, "SKULL": 4, "BAT": 5, "A": 7, "K": 8, "Q": 9, "J": 10, "SCATTER": 2}
      ],
      "pays": {
        "VAMPIRE": {"2": 30, "3": 220, "4": 1100, "5": 7500},
        "WITCH": {"3": 130, "4": 450, "5": 2500},
        "SKULL": {"3": 90, "4": 320, "5": 1500},
        "BAT": {"3": 60, "4": 220, "5": 1000},
        "A": {"3": 50, "4": 130, "5": 400},
        "K": {"3": 40, "4": 110, "5": 300},
        "Q": {"3": 30, "4": 100, "5": 250},
        "J": {"3": 20, "4": 90, "5": 200}
      },
      "scatter_pays": {"3": 200, "4": 1000, "5": 5000},
      "free": {"trigger": 3, "spins": 8, "mult": 1, "mult_step": 1, "mult_max": 10, "max": 40},
      "haunt": {"odds": 15, "cells": [[2, 60], [3, 30], [4, 10]]},
      "rtp": 94.9
    },
    "slots_progressive": {
      "kind": "lines",
      "reels": 5,
      "rows": 3,
      "lines": 10,
      "wild": "WILD",
      "weights": [
        {"DIAMOND": 2, "SEVEN": 3, "BAR": 4, "BELL": 6, "CLOVER": 8, "CHERRY": 10},
        {"DIAMOND": 2, "SEVEN": 3, "BAR": 4, "BELL": 6, "CLOVER": 8, "CHERRY": 10, "WILD": 2},
        {"DIAMOND": 2, "SEVEN": 3, "BAR": 4, "BELL": 6, "CLOVER": 8, "CHERRY": 10, "WILD": 2},
        {"DIAMOND": 2, "SEVEN": 3, "BAR": 4, "BELL": 6, "CLOVER": 8, "CHERRY": 10, "WILD": 2},
        {"DIAMOND": 2, "SEVEN": 3, "BAR": 4, "BELL": 6, "CLOVER": 8, "CHERRY": 10}
      ],
      "pays": {
        "DIAMOND": {"2": 30, "3": 500, "4": 2500, "5": 20000},
        "SEVEN": {"3": 250, "4": 1000, "5": 5000},
        "BAR": {"3": 150, "4": 500, "5": 2000},
        "BELL": {"3": 80, "4": 250, "5": 1000},
        "CLOVER": {"3": 60, "4": 150, "5": 500},
        "CHERRY": {"3": 40, "4": 120, "5": 300}
      },
      "jackpot": {"symbol": "CROWN", "seed": 100000, "feed_bp": 200, "odds": 5000000},
      "rtp": 95.4
    }
  }
  
  $cfg$::jsonb) -> p_game
$fn$;

-- The 20 paylines of a 5x3 machine: one row index (0 = top) per reel.
-- Machines with fewer lines use the first N.
create or replace function private.slot_lines()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
           [0,0,1,0,0],[2,2,1,2,2],[1,2,2,2,1],[1,0,0,0,1],[1,0,1,0,1],
           [1,2,1,2,1],[0,1,0,1,0],[2,1,2,1,2],[1,1,0,1,1],[1,1,2,1,1],
           [0,1,1,1,0],[2,1,1,1,2],[0,1,2,2,2],[2,1,0,0,0],[0,2,0,2,0]]'::jsonb
$$;

-- Bets offered by the bet selector. Any multiple of 10 inside a stake level's
-- range is accepted by the server.
create or replace function private.slot_bets()
returns bigint[]
language sql
immutable
set search_path = ''
as $$
  select array[10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]::bigint[]
$$;

-- {"A": 2, "K": 1} -> ["A", "A", "K"]: one entry per unit of weight.
create or replace function private.slot_bag(p_weights jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(e.key order by e.ord, g.n), '[]'::jsonb)
    from jsonb_each_text(p_weights) with ordinality as e(key, value, ord)
   cross join lateral generate_series(1, e.value::integer) as g(n)
$$;

-- [[3, 50], [4, 35]] -> fifty 3s then thirty-five 4s.
create or replace function private.slot_pair_bag(p_pairs jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(p.v -> 0 order by p.ord, g.n), '[]'::jsonb)
    from jsonb_array_elements(p_pairs) with ordinality as p(v, ord)
   cross join lateral generate_series(1, (p.v ->> 1)::integer) as g(n)
$$;

-- The config plus everything a spin needs precomputed (bags, payline shapes).
create or replace function private.slot_ready(p_game text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  c jsonb := private.slot_cfg(p_game);
  v_bags jsonb;
begin
  if c is null then
    return null;
  end if;
  if c ->> 'kind' = 'cluster' then
    v_bags := jsonb_build_array(private.slot_bag(c -> 'weights'));
  else
    select jsonb_agg(private.slot_bag(x.w) order by x.ord) into v_bags
      from jsonb_array_elements(c -> 'weights') with ordinality as x(w, ord);
  end if;
  c := c || jsonb_build_object('game', p_game, 'bags', v_bags, 'line_defs', private.slot_lines());
  if c ? 'heights' then
    c := c || jsonb_build_object('height_bag', private.slot_pair_bag(c -> 'heights'));
  end if;
  if c ? 'hold' then
    c := c || jsonb_build_object('value_bag', private.slot_pair_bag(c #> '{hold,values}'));
  end if;
  if c ? 'haunt' then
    c := c || jsonb_build_object('haunt_bag', private.slot_pair_bag(c #> '{haunt,cells}'));
  end if;
  return c;
end $$;

-- -----------------------------------------------------------------------------
-- Drawing symbols. Order is always reel by reel, top to bottom.
-- -----------------------------------------------------------------------------
create or replace function private.slot_pick(p_bag jsonb)
returns text
language sql
volatile
set search_path = ''
as $$
  select p_bag ->> private.random_int(jsonb_array_length(p_bag))
$$;

create or replace function private.slot_draw_reel(p_bag jsonb, p_rows integer)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v jsonb := '[]'::jsonb;
begin
  for i in 1..p_rows loop
    v := v || to_jsonb(private.slot_pick(p_bag));
  end loop;
  return v;
end $$;

-- A grid is an array of reels, each an array of symbols from top to bottom.
create or replace function private.slot_draw_grid(p_cfg jsonb, p_rows integer)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v jsonb := '[]'::jsonb;
begin
  for r in 0..(p_cfg ->> 'reels')::integer - 1 loop
    v := v || jsonb_build_array(private.slot_draw_reel(p_cfg -> 'bags' -> r, p_rows));
  end loop;
  return v;
end $$;

create or replace function private.slot_count(p_grid jsonb, p_sym text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer
    from jsonb_array_elements(p_grid) as c(reel)
   cross join lateral jsonb_array_elements_text(c.reel) as s(sym)
   where s.sym = p_sym
$$;

-- -----------------------------------------------------------------------------
-- Lucky Sevens: three reels, the middle row is the payline.
-- -----------------------------------------------------------------------------
-- Name of the winning combination on a line (a key of the paytable), or null.
create or replace function private.slot_classic_win(p_pays jsonb, a text, b text, c text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cherries integer := (a = 'CHERRY')::integer + (b = 'CHERRY')::integer + (c = 'CHERRY')::integer;
begin
  if v_cherries = 3 then
    return 'CHERRY3';
  elsif a = b and b = c and p_pays ? a then
    return a;
  elsif a like 'BAR%' and b like 'BAR%' and c like 'BAR%' then
    return 'ANYBAR';
  elsif v_cherries = 2 then
    return 'CHERRY2';
  elsif v_cherries = 1 then
    return 'CHERRY1';
  end if;
  return null;
end $$;

create or replace function private.slot_play_classic(p_cfg jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  g jsonb := private.slot_draw_grid(p_cfg, 3);
  v_name text;
  v_units bigint := 0;
  v_wins jsonb := '[]'::jsonb;
begin
  v_name := private.slot_classic_win(p_cfg -> 'pays', g -> 0 ->> 1, g -> 1 ->> 1, g -> 2 ->> 1);
  if v_name is not null then
    v_units := (p_cfg -> 'pays' ->> v_name)::bigint;
    v_wins := jsonb_build_array(jsonb_build_object('name', v_name, 'units', v_units));
  end if;
  return jsonb_build_object('kind', 'classic', 'grid', g, 'wins', v_wins, 'units', v_units);
end $$;

-- -----------------------------------------------------------------------------
-- Payline machines (Pharaoh's Fortune, Dragon Pearls, Grand Jackpot).
-- A line pays left to right from reel 1; wilds stand in for the line's symbol.
-- -----------------------------------------------------------------------------
create or replace function private.slot_eval_lines(p_cfg jsonb, p_grid jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reels integer := (p_cfg ->> 'reels')::integer;
  v_wild  text := p_cfg ->> 'wild';
  v_wins  jsonb := '[]'::jsonb;
  v_units bigint := 0;
  v_line  jsonb;
  v_sym   text;
  v_pay   jsonb;
  n       integer;
  u       integer;
begin
  for i in 0..(p_cfg ->> 'lines')::integer - 1 loop
    v_line := p_cfg -> 'line_defs' -> i;
    v_sym  := p_grid -> 0 ->> (v_line ->> 0)::integer;
    v_pay  := p_cfg -> 'pays' -> v_sym;
    continue when v_pay is null;
    n := 1;
    while n < v_reels and (p_grid -> n ->> (v_line ->> n)::integer) in (v_sym, v_wild) loop
      n := n + 1;
    end loop;
    u := (v_pay ->> n::text)::integer;
    if u is not null then
      v_units := v_units + u;
      v_wins := v_wins || jsonb_build_object('line', i, 'sym', v_sym, 'n', n, 'units', u);
    end if;
  end loop;
  return jsonb_build_object('wins', v_wins, 'units', v_units);
end $$;

-- One spin of a payline machine: grid, line wins and (if the machine has one)
-- scatter pays. Scatters count anywhere on the grid.
-- Haunted Manor's haunting: on some spins, a few cells (never a scatter or a wild) turn wild
-- after the reels stop, and the lines are scored on the grid as it then stands. The spin
-- carries the grid as it landed (`before`) and which cells were taken (`haunted`: reel * 3 + row; reels 2 to 5 only).
create or replace function private.slot_spin_lines(p_cfg jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  g jsonb := private.slot_draw_grid(p_cfg, 3);
  e jsonb;
  v_units bigint;
  v_res jsonb := '{}'::jsonb;
  v_sc integer;
  v_su bigint;
  v_before jsonb;
  v_want integer;
  v_free integer[];
  v_cells integer[] := '{}';
  k integer;
begin
  if p_cfg ? 'haunt' and private.random_int((p_cfg #>> '{haunt,odds}')::integer) = 0 then
    v_before := g;
    v_want := private.slot_pick(p_cfg -> 'haunt_bag')::integer;
    -- Never the first reel: a line is read from its first symbol, so a wild there would pay nothing.
    select array_agg(c order by c) into v_free from generate_series(3, 14) c
     where (g -> (c / 3) ->> (c % 3)) not in (p_cfg ->> 'wild', coalesce(p_cfg ->> 'scatter', ''));
    while v_want > 0 and coalesce(cardinality(v_free), 0) > 0 loop
      k := v_free[private.random_int(cardinality(v_free)) + 1];
      v_free := array_remove(v_free, k);
      v_cells := v_cells || k;
      g := jsonb_set(g, array[(k / 3)::text, (k % 3)::text], to_jsonb(p_cfg ->> 'wild'));
      v_want := v_want - 1;
    end loop;
    v_res := jsonb_build_object('before', v_before, 'haunted', to_jsonb(v_cells));
  end if;
  e := private.slot_eval_lines(p_cfg, g);
  v_units := (e ->> 'units')::bigint;
  v_res := v_res || jsonb_build_object('grid', g, 'wins', e -> 'wins');
  if p_cfg ? 'scatter' then
    v_sc := private.slot_count(g, p_cfg ->> 'scatter');
    v_su := coalesce((p_cfg -> 'scatter_pays' ->> least(v_sc, 5)::text)::bigint, 0);
    v_units := v_units + v_su;
    v_res := v_res || jsonb_build_object('scatters', v_sc, 'scatter_units', v_su);
  end if;
  return v_res || jsonb_build_object('units', v_units);
end $$;

create or replace function private.slot_play_lines(p_cfg jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_base   jsonb := private.slot_spin_lines(p_cfg);
  v_total  bigint := (v_base ->> 'units')::bigint;
  v_res    jsonb;
  -- free spins
  v_free   jsonb := p_cfg -> 'free';
  v_spins  jsonb := '[]'::jsonb;
  v_left   integer;
  v_played integer := 0;
  v_more   integer;
  f        jsonb;
  fu       bigint;
  -- hold and win
  v_hold   jsonb := p_cfg -> 'hold';
  v_vals   integer[];
  v_steps  jsonb := '[]'::jsonb;
  v_landed jsonb;
  v_hu     bigint;
  v_grand  boolean;
  v_mult   integer;
begin
  -- Free spins: every win is multiplied; more scatters add more spins, up to a cap.
  -- With `mult_step` the multiplier climbs after every winning free spin (up to `mult_max`) and never drops.
  if v_free is not null and (v_base ->> 'scatters')::integer >= (v_free ->> 'trigger')::integer then
    v_left := (v_free ->> 'spins')::integer;
    v_mult := (v_free ->> 'mult')::integer;
    while v_left > 0 loop
      v_left := v_left - 1;
      v_played := v_played + 1;
      f := private.slot_spin_lines(p_cfg) || jsonb_build_object('mult', v_mult);
      fu := (f ->> 'units')::bigint * v_mult;
      if fu > 0 and v_free ? 'mult_step' then
        v_mult := least(v_mult + (v_free ->> 'mult_step')::integer, (v_free ->> 'mult_max')::integer);
      end if;
      v_more := 0;
      if (f ->> 'scatters')::integer >= (v_free ->> 'trigger')::integer then
        v_more := least(v_left + (v_free ->> 'spins')::integer, (v_free ->> 'max')::integer - v_played) - v_left;
        v_left := v_left + v_more;
      end if;
      v_total := v_total + fu;
      v_spins := v_spins || jsonb_build_array(f || jsonb_build_object('units', fu, 'awarded', v_more));
    end loop;
  end if;

  -- Hold and win: every pearl carries a prize. Six or more lock in place and the
  -- other cells respin; each new pearl resets the respin counter.
  if v_hold is not null then
    for r in 0..4 loop
      for w in 0..2 loop
        v_vals := v_vals || case when v_base -> 'grid' -> r ->> w = v_hold ->> 'symbol'
                                 then private.slot_pick(p_cfg -> 'value_bag')::integer else 0 end;
      end loop;
    end loop;
    v_base := v_base || jsonb_build_object('pearls', to_jsonb(v_vals));
    if (select count(*) from unnest(v_vals) v where v > 0) >= (v_hold ->> 'trigger')::integer then
      v_left := (v_hold ->> 'respins')::integer;
      while v_left > 0 and 0 = any (v_vals) loop
        v_left := v_left - 1;
        v_landed := '[]'::jsonb;
        for k in 1..15 loop
          if v_vals[k] = 0 and private.random_int(10000) < (v_hold ->> 'land_bp')::integer then
            v_vals[k] := private.slot_pick(p_cfg -> 'value_bag')::integer;
            v_landed := v_landed || jsonb_build_object('cell', k - 1, 'value', v_vals[k]);
          end if;
        end loop;
        if jsonb_array_length(v_landed) > 0 then
          v_left := (v_hold ->> 'respins')::integer;
        end if;
        v_steps := v_steps || jsonb_build_array(v_landed);
      end loop;
      v_grand := not (0 = any (v_vals));
      v_hu := (select sum(v) from unnest(v_vals) v) + case when v_grand then (v_hold ->> 'grand')::bigint else 0 end;
      v_total := v_total + v_hu;
    end if;
  end if;

  v_res := jsonb_build_object('kind', 'lines', 'base', v_base, 'units', v_total);
  if v_played > 0 then
    v_res := v_res || jsonb_build_object('free', v_spins);
  end if;
  if v_hu is not null then
    v_res := v_res || jsonb_build_object('hold', jsonb_build_object(
      'steps', v_steps, 'pearls', to_jsonb(v_vals), 'grand', v_grand, 'units', v_hu));
  end if;
  return v_res;
end $$;

-- -----------------------------------------------------------------------------
-- Wild Frontier: ways to win. A symbol pays when it appears on consecutive
-- reels from the left; ways = the product of how many times it shows per reel.
-- -----------------------------------------------------------------------------
create or replace function private.slot_spin_ways(p_cfg jsonb, p_full boolean)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_reels integer := (p_cfg ->> 'reels')::integer;
  v_wild  text := p_cfg ->> 'wild';
  g       jsonb := '[]'::jsonb;
  v_wins  jsonb := '[]'::jsonb;
  v_units bigint := 0;
  v_sym   text;
  v_ways  bigint;
  n       integer;
  k       integer;
  u       integer;
begin
  for r in 0..v_reels - 1 loop
    g := g || jsonb_build_array(private.slot_draw_reel(
      p_cfg -> 'bags' -> r,
      case when p_full then (p_cfg #>> '{free,height}')::integer
           else private.slot_pick(p_cfg -> 'height_bag')::integer end));
  end loop;

  for v_sym in select jsonb_object_keys(p_cfg -> 'pays') loop
    v_ways := 1;
    n := 0;
    for r in 0..v_reels - 1 loop
      select count(*) into k from jsonb_array_elements_text(g -> r) as x(s)
       where x.s = v_sym or (r > 0 and x.s = v_wild);
      exit when k = 0;
      v_ways := v_ways * k;
      n := n + 1;
    end loop;
    u := (p_cfg -> 'pays' -> v_sym ->> n::text)::integer;
    if u is not null then
      v_units := v_units + u * v_ways;
      v_wins := v_wins || jsonb_build_object('sym', v_sym, 'n', n, 'ways', v_ways, 'units', u * v_ways);
    end if;
  end loop;

  return jsonb_build_object('grid', g, 'wins', v_wins, 'units', v_units,
                            'scatters', private.slot_count(g, p_cfg ->> 'scatter'));
end $$;

create or replace function private.slot_play_ways(p_cfg jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_free   jsonb := p_cfg -> 'free';
  v_base   jsonb := private.slot_spin_ways(p_cfg, false);
  v_total  bigint := (v_base ->> 'units')::bigint;
  v_spins  jsonb := '[]'::jsonb;
  v_left   integer;
  v_played integer := 0;
  v_more   integer;
  f        jsonb;
  v_res    jsonb;
begin
  -- Free spins are played on full-height reels (the most ways).
  if (v_base ->> 'scatters')::integer >= (v_free ->> 'trigger')::integer then
    v_left := (v_free ->> 'spins')::integer;
    while v_left > 0 loop
      v_left := v_left - 1;
      v_played := v_played + 1;
      f := private.slot_spin_ways(p_cfg, true);
      v_more := 0;
      if (f ->> 'scatters')::integer >= (v_free ->> 'trigger')::integer then
        v_more := least(v_left + (v_free ->> 'spins')::integer, (v_free ->> 'max')::integer - v_played) - v_left;
        v_left := v_left + v_more;
      end if;
      v_total := v_total + (f ->> 'units')::bigint;
      v_spins := v_spins || jsonb_build_array(f || jsonb_build_object('awarded', v_more));
    end loop;
  end if;
  v_res := jsonb_build_object('kind', 'ways', 'base', v_base, 'units', v_total);
  if v_played > 0 then
    v_res := v_res || jsonb_build_object('free', v_spins);
  end if;
  return v_res;
end $$;

-- -----------------------------------------------------------------------------
-- Gem Cascade: groups of 5+ touching gems pay and vanish, the gems above fall,
-- new ones drop in, and each cascade in a row raises the multiplier.
-- Cells are numbered column by column: index = column * rows + row (row 0 = top).
-- -----------------------------------------------------------------------------
create or replace function private.slot_grid_json(p_cells text[], p_cols integer, p_rows integer)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_agg(x.col order by x.c)
    from (select c, jsonb_agg(p_cells[c * p_rows + r + 1] order by r) as col
            from generate_series(0, p_cols - 1) c, generate_series(0, p_rows - 1) r
           group by c) x
$$;

create or replace function private.slot_play_cluster(p_cfg jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_cols  integer := (p_cfg ->> 'cols')::integer;
  v_rows  integer := (p_cfg ->> 'rows')::integer;
  v_min   integer := (p_cfg ->> 'min')::integer;
  v_bag   jsonb := p_cfg -> 'bags' -> 0;
  n       integer := v_cols * v_rows;
  g       text[];
  v_seen  boolean[];
  v_gone  boolean[];
  v_stack integer[];
  v_cells integer[];
  v_keep  text[];
  cur     integer;
  nb      integer;
  c       integer;
  r       integer;
  v_step  integer := 0;
  v_mult  integer;
  v_pay   bigint;
  v_found jsonb;
  v_step_units bigint;
  v_steps jsonb := '[]'::jsonb;
  v_total bigint := 0;
begin
  for i in 1..n loop
    g[i] := private.slot_pick(v_bag);
  end loop;

  loop
    v_seen := array_fill(false, array[n]);
    v_gone := array_fill(false, array[n]);
    v_found := '[]'::jsonb;
    v_step_units := 0;
    v_mult := (p_cfg -> 'mults' ->> least(v_step, jsonb_array_length(p_cfg -> 'mults') - 1))::integer;

    for i in 1..n loop
      continue when v_seen[i];
      -- Flood fill from cell i over same-coloured neighbours (up, down, left, right).
      v_stack := array[i];
      v_cells := '{}';
      v_seen[i] := true;
      while cardinality(v_stack) > 0 loop
        cur := v_stack[cardinality(v_stack)];
        v_stack := v_stack[1:cardinality(v_stack) - 1];
        v_cells := v_cells || cur;
        c := (cur - 1) / v_rows;
        r := (cur - 1) % v_rows;
        foreach nb in array array[
          case when c < v_cols - 1 then cur + v_rows end,
          case when c > 0 then cur - v_rows end,
          case when r < v_rows - 1 then cur + 1 end,
          case when r > 0 then cur - 1 end
        ] loop
          if nb is not null and not v_seen[nb] and g[nb] = g[i] then
            v_seen[nb] := true;
            v_stack := v_stack || nb;
          end if;
        end loop;
      end loop;

      if cardinality(v_cells) >= v_min then
        v_pay := 0;
        for k in 0..jsonb_array_length(p_cfg -> 'sizes') - 1 loop
          if cardinality(v_cells) >= (p_cfg -> 'sizes' ->> k)::integer then
            v_pay := (p_cfg -> 'pays' -> g[i] ->> k)::bigint;
          end if;
        end loop;
        v_pay := v_pay * v_mult;
        v_step_units := v_step_units + v_pay;
        foreach cur in array v_cells loop
          v_gone[cur] := true;
        end loop;
        v_found := v_found || jsonb_build_object(
          'sym', g[i], 'units', v_pay,
          'cells', (select jsonb_agg(x - 1 order by x) from unnest(v_cells) x));
      end if;
    end loop;

    exit when jsonb_array_length(v_found) = 0;

    v_steps := v_steps || jsonb_build_object(
      'grid', private.slot_grid_json(g, v_cols, v_rows), 'clusters', v_found, 'mult', v_mult, 'units', v_step_units);
    v_total := v_total + v_step_units;

    -- Gravity: survivors keep their order at the bottom of each column and new
    -- gems fill the top.
    for cl in 0..v_cols - 1 loop
      v_keep := '{}';
      for rw in 0..v_rows - 1 loop
        if not v_gone[cl * v_rows + rw + 1] then
          v_keep := v_keep || g[cl * v_rows + rw + 1];
        end if;
      end loop;
      for rw in 0..v_rows - 1 loop
        if rw < v_rows - cardinality(v_keep) then
          g[cl * v_rows + rw + 1] := private.slot_pick(v_bag);
        else
          g[cl * v_rows + rw + 1] := v_keep[rw - (v_rows - cardinality(v_keep)) + 1];
        end if;
      end loop;
    end loop;
    v_step := v_step + 1;
  end loop;

  return jsonb_build_object('kind', 'cluster', 'steps', v_steps,
                            'grid', private.slot_grid_json(g, v_cols, v_rows), 'units', v_total);
end $$;

-- -----------------------------------------------------------------------------
-- One complete play of any machine. `units` is the total win in hundredths of
-- the bet. p_cfg comes from private.slot_ready().
-- -----------------------------------------------------------------------------
create or replace function private.slot_play(p_cfg jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
begin
  case p_cfg ->> 'kind'
    when 'classic' then return private.slot_play_classic(p_cfg);
    when 'lines'   then return private.slot_play_lines(p_cfg);
    when 'ways'    then return private.slot_play_ways(p_cfg);
    when 'cluster' then return private.slot_play_cluster(p_cfg);
    else raise exception 'unknown_game';
  end case;
end $$;

-- Plays p_spins rounds without touching any chips and reports the return to
-- player in percent (the jackpot's share is not included). For tests and tuning.
create or replace function private.slot_simulate(p_game text, p_spins integer)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  c jsonb := private.slot_ready(p_game);
  u bigint;
  v_total bigint := 0;
  v_hits  integer := 0;
  v_max   bigint := 0;
begin
  if c is null then
    raise exception 'unknown_game';
  end if;
  for i in 1..p_spins loop
    u := (private.slot_play(c) ->> 'units')::bigint;
    v_total := v_total + u;
    v_max := greatest(v_max, u);
    if u > 0 then
      v_hits := v_hits + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'spins', p_spins,
    'rtp', round(v_total::numeric / p_spins, 2),
    'hit_rate', round(100.0 * v_hits / p_spins, 2),
    'max_units', v_max);
end $$;

-- The lowest stake level whose range contains the bet.
create or replace function private.slot_tier(p_game text, p_bet bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_min bigint;
  v_max bigint;
begin
  select tier into v_tier from public.stake_tiers
   where game_key = p_game and p_bet between min_bet and max_bet
   order by tier_rank limit 1;
  if v_tier is null then
    select min(min_bet), max(max_bet) into v_min, v_max from public.stake_tiers where game_key = p_game;
    raise exception 'bet_out_of_range'
      using hint = format('Bets on this machine are %s to %s chips.', v_min, v_max);
  end if;
  return v_tier;
end $$;

-- Replaces one row of a grid with a symbol (the jackpot line of crowns).
create or replace function private.slot_fill_row(p_grid jsonb, p_row integer, p_sym text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_agg(jsonb_set(x.reel, array[p_row::text], to_jsonb(p_sym)) order by x.ord)
    from jsonb_array_elements(p_grid) with ordinality as x(reel, ord)
$$;

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------

-- Everything the machine's screen needs: paytable, features, bets, stake levels
-- and the live jackpot. Reel weights stay on the server.
create or replace function public.slot_info(p_game text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.slot_cfg(p_game);
  g public.games;
begin
  select * into g from public.games where key = p_game;
  if c is null or not found then
    raise exception 'unknown_game';
  end if;

  c := c - 'weights' - 'heights';
  -- (That the manor is haunted is on show; how often, and how many cells, is not.)
  if c ? 'haunt' then
    c := jsonb_set(c, '{haunt}', '{}'::jsonb);
  end if;
  if c ? 'lines' then
    c := c || jsonb_build_object('line_defs', (
      select jsonb_agg(x.v order by x.ord) from jsonb_array_elements(private.slot_lines()) with ordinality as x(v, ord)
       where x.ord <= (c ->> 'lines')::integer));
  end if;
  if c ? 'hold' then
    c := jsonb_set(c, '{hold}', ((c -> 'hold') - 'land_bp' - 'values') || jsonb_build_object('values', (
      select jsonb_agg(x.v -> 0 order by x.ord) from jsonb_array_elements(c #> '{hold,values}') with ordinality as x(v, ord))));
  end if;

  return jsonb_build_object(
    'game', g.key,
    'name', g.name,
    'released', g.released and private.game_in_season(g.key),
    'season', g.season,
    'config', c,
    'bets', (select coalesce(jsonb_agg(b order by b), '[]'::jsonb) from unnest(private.slot_bets()) b
              where exists (select 1 from public.stake_tiers t where t.game_key = p_game and b between t.min_bet and t.max_bet)),
    'tiers', (select jsonb_agg(jsonb_build_object('tier', t.tier, 'label', t.label, 'min_bet', t.min_bet,
                                                  'max_bet', t.max_bet, 'min_bankroll', t.min_bankroll) order by t.tier_rank)
                from public.stake_tiers t where t.game_key = p_game),
    'jackpot', (select jsonb_build_object('amount', j.amount, 'seed', j.seed, 'last_winner', j.last_winner,
                                          'last_amount', j.last_amount, 'last_won_at', j.last_won_at)
                  from public.jackpots j where j.game_key = p_game)
  );
end $$;

-- Spin. Takes the bet, plays the round to the end and pays, all at once.
create or replace function public.slot_spin(p_game text, p_bet bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_uid();
  c         jsonb := private.slot_ready(p_game);
  v_tier    text;
  v_round   uuid := gen_random_uuid();
  v_res     jsonb;
  v_units   bigint;
  v_win     bigint;
  v_balance bigint;
  v_feature text;
  -- jackpot
  jc        jsonb;
  j         public.jackpots;
  v_pool    bigint;
  v_jack    bigint := 0;
  e         jsonb;
  v_grid    jsonb;
begin
  if c is null then
    raise exception 'unknown_game';
  end if;
  if not exists (select 1 from public.games where key = p_game and released) then
    raise exception 'game_not_open';
  end if;
  if not private.game_in_season(p_game) then
    raise exception 'game_not_open' using hint = 'This game is only here during its season.';
  end if;
  if p_bet is null or p_bet <= 0 or p_bet % 10 <> 0 then
    raise exception 'invalid_amount';
  end if;
  v_tier := private.slot_tier(p_game, p_bet);
  perform private.assert_tier_access(v_uid, p_game, v_tier);

  perform private.apply_chips(v_uid, -p_bet, 'bet', p_game, v_round::text);
  v_res := private.slot_play(c);

  jc := c -> 'jackpot';
  if jc is not null then
    select * into j from public.jackpots where game_key = p_game for update;
    v_pool := j.pool_hundredths + p_bet * (jc ->> 'feed_bp')::integer / 100;
    if private.random_int((jc ->> 'odds')::integer) < p_bet then
      -- Jackpot: the middle row lands all crowns and the whole pot is paid.
      v_jack := v_pool / 100;
      v_grid := private.slot_fill_row(v_res #> '{base,grid}', 1, jc ->> 'symbol');
      e := private.slot_eval_lines(c, v_grid);
      v_res := jsonb_build_object('kind', 'lines', 'units', e -> 'units',
                                  'base', jsonb_build_object('grid', v_grid, 'wins', e -> 'wins', 'units', e -> 'units'));
      update public.jackpots
         set pool_hundredths = j.seed * 100,
             last_winner = (select username from public.profiles where id = v_uid),
             last_amount = v_jack,
             last_won_at = now(),
             updated_at = now()
       where key = j.key;
    else
      update public.jackpots set pool_hundredths = v_pool, updated_at = now() where key = j.key;
    end if;
  end if;

  v_units := (v_res ->> 'units')::bigint;
  v_win := p_bet * v_units / 100;
  v_balance := private.apply_chips(v_uid, v_win, 'payout', p_game, v_round::text,
                                   jsonb_build_object('units', v_units));
  if v_jack > 0 then
    v_balance := private.apply_chips(v_uid, v_jack, 'jackpot', p_game, v_round::text);
  end if;

  v_feature := case when v_jack > 0 then 'jackpot'
                    when v_res ? 'hold' then 'hold'
                    when v_res ? 'free' then 'free'
                    when jsonb_array_length(coalesce(v_res -> 'steps', '[]'::jsonb)) > 1 then 'cascade'
               end;
  perform private.record_round(v_uid, p_game, null, v_round, p_bet, v_win + v_jack,
                               jsonb_strip_nulls(jsonb_build_object('units', v_units, 'feature', v_feature, 'jackpot', nullif(v_jack, 0),
                                 -- Haunted Manor: was a spin haunted, and how high did the midnight multiplier climb?
                                 'haunted', case when v_res #> '{base,haunted}' is not null then true end,
                                 'top_mult', (select max((f ->> 'mult')::integer) from jsonb_array_elements(v_res -> 'free') f))));

  return jsonb_build_object(
    'round_id', v_round,
    'game', p_game,
    'bet', p_bet,
    'tier', v_tier,
    'win', v_win + v_jack,
    'jackpot_won', v_jack,
    'jackpot', (select amount from public.jackpots where game_key = p_game),
    'balance', v_balance,
    'result', v_res
  );
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['public.slot_info(text)', 'public.slot_spin(text, bigint)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.jackpots enable row level security;

drop policy if exists "jackpots: signed-in players can read" on public.jackpots;
create policy "jackpots: signed-in players can read"
  on public.jackpots for select to authenticated
  using (true);

revoke insert, update, delete, truncate on public.jackpots from anon, authenticated;
revoke all on public.jackpots from anon;
grant select on public.jackpots to authenticated;

-- -----------------------------------------------------------------------------
-- Open the machines and seed the jackpot (a re-run never resets the pot).
-- -----------------------------------------------------------------------------
update public.games set released = true where key like 'slots\_%';

insert into public.jackpots (key, game_key, seed, pool_hundredths)
select 'grand', 'slots_progressive', s.seed, s.seed * 100
  from (select (private.slot_cfg('slots_progressive') #>> '{jackpot,seed}')::bigint as seed) s
on conflict (key) do update set seed = excluded.seed;

-- The live jackpot ticker.
select private.add_to_realtime('jackpots');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

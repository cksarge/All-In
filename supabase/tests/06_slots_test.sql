-- Phase 5 tests: slot machines and the shared jackpot.
-- Random numbers come from the tests.dice queue (test database only), so a spin
-- can be stacked symbol by symbol: draws go reel by reel, top to bottom.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000005a1'''
\set B '''00000000-0000-0000-0000-0000000005b2'''

create table if not exists tests.dice (id serial primary key, v integer);
create or replace function private.random_int(p_n integer) returns integer language plpgsql volatile set search_path = '' as $$
declare r record;
begin
  select id, v into r from tests.dice order by id limit 1;
  if found then delete from tests.dice where id = r.id; return r.v; end if;
  return floor(random() * p_n)::int;
end $$;

-- Queue raw random numbers.
create or replace function tests.rig(variadic p_vals integer[]) returns void language sql security definer as $$
  insert into tests.dice (v) select x from unnest(p_vals) with ordinality u(x, o) order by o
$$;
-- Queue the draws that land these symbols on one reel (reel 0 for the cluster game).
create or replace function tests.rig_reel(p_game text, p_reel integer, variadic p_syms text[]) returns void language plpgsql security definer as $$
declare
  v_bag jsonb := private.slot_ready(p_game) -> 'bags' -> p_reel;
  s text;
  i integer;
begin
  foreach s in array p_syms loop
    select min(o)::integer - 1 into i from jsonb_array_elements_text(v_bag) with ordinality x(sym, o) where x.sym = s;
    if i is null then raise exception 'no % on reel % of %', s, p_reel, p_game; end if;
    insert into tests.dice (v) values (i);
  end loop;
end $$;
-- Exact return (in percent) of the paylines alone: cells are independent, so a
-- line's chance of paying is a product of per-reel symbol probabilities.
create or replace function tests.slot_line_rtp(p_game text) returns numeric language plpgsql as $$
declare
  c jsonb := private.slot_ready(p_game);
  s text;
  q numeric[];
  pr numeric;
  u numeric;
  total numeric := 0;
begin
  for s in select jsonb_object_keys(c -> 'pays') loop
    for i in 0..4 loop
      select count(*) filter (where x = s or (i > 0 and x = c ->> 'wild'))::numeric / count(*) into pr
        from jsonb_array_elements_text(c -> 'bags' -> i) x;
      q[i + 1] := pr;
    end loop;
    for n in 1..5 loop
      u := (c -> 'pays' -> s ->> n::text)::numeric;
      continue when u is null;
      pr := 1;
      for i in 1..n loop pr := pr * q[i]; end loop;
      if n < 5 then pr := pr * (1 - q[n + 1]); end if;
      total := total + pr * u;
    end loop;
  end loop;
  return round(total * (c ->> 'lines')::integer, 2);
end $$;
create or replace function tests.pot() returns bigint language sql security definer as $$
  select pool_hundredths from public.jackpots where key = 'grand'
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from tests.dice;
delete from auth.users where email like '%@sl.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@sl.test', '{"username":"SlAnn"}'), (:B, 'b@sl.test', '{"username":"SlBen"}');
update public.jackpots set pool_hundredths = seed * 100, last_winner = null, last_amount = null, last_won_at = null where key = 'grand';

-- ----------------------------------------------------------------------------
-- Setup and maths
-- ----------------------------------------------------------------------------
select tests.ok((select count(*) from public.games where key like 'slots\_%' and released) = 7, 'seven machines released (one of them seasonal)');
select tests.ok((select amount from public.jackpots where key = 'grand') = 100000, 'jackpot seeded');
select tests.ok(private.slot_cfg('blackjack') is null, 'no config for other games');
select tests.ok(not exists (
  select 1 from public.games g, jsonb_each(private.slot_cfg(g.key) -> 'pays') p, jsonb_each(case jsonb_typeof(p.value) when 'object' then p.value else jsonb_build_object('x', p.value) end) v,
         jsonb_array_elements(case jsonb_typeof(v.value) when 'array' then v.value else jsonb_build_array(v.value) end) u
   where g.key like 'slots\_%' and (u.value::text)::integer % 10 <> 0
), 'every pay is a multiple of 10 units, so chips are always whole numbers');

-- Lucky Sevens: every one of the 64,000 centre lines, exactly.
select tests.ok((
  select round(sum((c.c -> 'pays' ->> private.slot_classic_win(c.c -> 'pays', a.s, b.s, d.s))::numeric) / count(*), 2)
    from (select private.slot_ready('slots_classic') as c) c,
         jsonb_array_elements_text(c.c -> 'bags' -> 0) a(s),
         jsonb_array_elements_text(c.c -> 'bags' -> 1) b(s),
         jsonb_array_elements_text(c.c -> 'bags' -> 2) d(s)
) = 95.80, 'Lucky Sevens returns exactly 95.80%');
select tests.ok((private.slot_cfg('slots_classic') ->> 'rtp')::numeric = 95.8, 'and says so');
select tests.ok(private.slot_classic_win(private.slot_cfg('slots_classic') -> 'pays', 'BAR1', 'BAR3', 'BAR2') = 'ANYBAR', 'mixed bars');
select tests.ok(private.slot_classic_win(private.slot_cfg('slots_classic') -> 'pays', 'BLANK', 'CHERRY', 'BAR2') = 'CHERRY1', 'one cherry');
select tests.ok(private.slot_classic_win(private.slot_cfg('slots_classic') -> 'pays', 'BLANK', 'BLANK', 'BLANK') is null, 'blanks pay nothing');

-- Paylines, exactly (features come on top of this).
select tests.ok(tests.slot_line_rtp('slots_paylines') = 60.55, 'Pharaoh''s Fortune lines');
select tests.ok(tests.slot_line_rtp('slots_holdwin') = 52.74, 'Dragon Pearls lines');
select tests.ok(tests.slot_line_rtp('slots_progressive') = 91.44, 'Grand Jackpot lines');

-- Wilds substitute, scatters and unpaid symbols never start a line.
select tests.ok((private.slot_eval_lines(private.slot_ready('slots_paylines'),
  '[["A","K","Q"],["WILD","J","J"],["A","J","J"],["WILD","J","J"],["K","J","J"]]') -> 'wins') @>
  '[{"line": 1, "sym": "A", "n": 4, "units": 150}]', 'wild completes four aces on the top line');
select tests.ok((private.slot_eval_lines(private.slot_ready('slots_paylines'),
  '[["SCATTER","SCATTER","SCATTER"],["WILD","WILD","WILD"],["WILD","WILD","WILD"],["WILD","WILD","WILD"],["A","A","A"]]') ->> 'units')::int = 0,
  'a line cannot start on a scatter');

-- Simulation: the hit rate is tight, the return has a wide band (rare big wins).
select tests.ok((s.r ->> 'hit_rate')::numeric between x.hit - 2.5 and x.hit + 2.5
            and (s.r ->> 'rtp')::numeric between 60 and 140,
                format('%s simulation: %s', x.game, s.r))
  from (values ('slots_classic', 32.7), ('slots_paylines', 40.2), ('slots_cascade', 34.0),
               ('slots_ways', 51.0), ('slots_holdwin', 30.4), ('slots_progressive', 46.9)) x(game, hit),
       lateral (select private.slot_simulate(x.game, 20000) as r) s;

-- ----------------------------------------------------------------------------
-- What the browser can see
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select tests.ok(not (public.slot_info('slots_paylines') -> 'config' ? 'weights'), 'reel weights stay on the server');
select tests.ok(not (public.slot_info('slots_ways') -> 'config' ? 'heights'), 'reel height odds stay on the server');
select tests.ok(not (public.slot_info('slots_holdwin') #> '{config,hold}' ? 'land_bp'), 'pearl odds stay on the server');
select tests.ok(public.slot_info('slots_holdwin') #> '{config,hold,values}' = '[100, 200, 300, 500, 1000, 2500, 10000]', 'pearl prizes are public');
select tests.ok(jsonb_array_length(public.slot_info('slots_paylines') #> '{config,line_defs}') = 20, '20 payline shapes');
select tests.ok(jsonb_array_length(public.slot_info('slots_holdwin') #> '{config,line_defs}') = 10, '10 payline shapes');
select tests.ok(jsonb_array_length(public.slot_info('slots_classic') -> 'bets') = 12, 'bet steps');
select tests.ok((public.slot_info('slots_progressive') #>> '{jackpot,amount}')::int = 100000, 'jackpot shown on its machine');
select tests.ok(public.slot_info('slots_classic') -> 'jackpot' = 'null', 'no jackpot on the others');
select tests.throws($$select public.slot_info('blackjack')$$, 'unknown_game');
select tests.throws($$select private.slot_play(private.slot_ready('slots_classic'))$$, 'permission denied');
select tests.throws($$update public.jackpots set pool_hundredths = 0$$, 'permission denied');
select tests.ok((select amount from public.jackpots where key = 'grand') = 100000, 'players can read the jackpot');

-- Bet validation
select tests.throws($$select public.slot_spin('slots_classic', 15)$$, 'invalid_amount');
select tests.throws($$select public.slot_spin('slots_classic', 0)$$, 'invalid_amount');
select tests.throws($$select public.slot_spin('slots_classic', 60000)$$, 'bet_out_of_range');
select tests.throws($$select public.slot_spin('slots_classic', 2000)$$, 'tier_locked');
select tests.throws($$select public.slot_spin('blackjack', 10)$$, 'unknown_game');
select tests.ok(tests.bal(:A) = 10000, 'rejected spins cost nothing');
reset role;
set role anon;
select tests.throws($$select public.slot_spin('slots_classic', 10)$$, 'permission denied');
reset role;

-- ----------------------------------------------------------------------------
-- Lucky Sevens
-- ----------------------------------------------------------------------------
select tests.rig_reel('slots_classic', 0, 'BLANK', 'SEVEN', 'BLANK');
select tests.rig_reel('slots_classic', 1, 'BELL', 'SEVEN', 'BLANK');
select tests.rig_reel('slots_classic', 2, 'BLANK', 'SEVEN', 'CHERRY');
set role authenticated;
select tests.as_user(:A);
select tests.ok((public.slot_spin('slots_classic', 10) ->> 'win')::int = 1500, 'three sevens pay 150 times the bet');
select tests.ok(tests.bal(:A) = 10000 - 10 + 1500, 'bet taken and win paid');
reset role;
select tests.rig_reel('slots_classic', 0, 'SEVEN', 'BLANK', 'SEVEN');
select tests.rig_reel('slots_classic', 1, 'SEVEN', 'BAR1', 'SEVEN');
select tests.rig_reel('slots_classic', 2, 'SEVEN', 'BLANK', 'SEVEN');
set role authenticated;
select tests.ok((public.slot_spin('slots_classic', 200) ->> 'win')::int = 0, 'only the middle row pays (and 200 is a Mid bet)');
select tests.ok(tests.bal(:A) = 11490 - 200, 'losing spin');
reset role;

-- ----------------------------------------------------------------------------
-- Pharaoh's Fortune: three scatters, then ten free spins with wins doubled
-- ----------------------------------------------------------------------------
select tests.rig_reel('slots_paylines', 0, 'SCATTER', 'J', 'K');
select tests.rig_reel('slots_paylines', 1, 'SCATTER', 'Q', 'A');
select tests.rig_reel('slots_paylines', 2, 'SCATTER', 'J', 'K');
select tests.rig_reel('slots_paylines', 3, 'J', 'J', 'J');
select tests.rig_reel('slots_paylines', 4, 'J', 'J', 'J');
-- free spin 1: three eyes on the top line (250) and two on line 6 (30), doubled
select tests.rig_reel('slots_paylines', 0, 'EYE', 'K', 'J');
select tests.rig_reel('slots_paylines', 1, 'EYE', 'A', 'Q');
select tests.rig_reel('slots_paylines', 2, 'EYE', 'J', 'J');
select tests.rig_reel('slots_paylines', 3, 'J', 'J', 'J');
select tests.rig_reel('slots_paylines', 4, 'J', 'J', 'J');
-- free spins 2 to 10: nothing
select tests.rig_reel('slots_paylines', 0, 'J', 'K', 'J'), tests.rig_reel('slots_paylines', 1, 'Q', 'A', 'Q'),
       tests.rig_reel('slots_paylines', 2, 'J', 'J', 'J'), tests.rig_reel('slots_paylines', 3, 'J', 'J', 'J'),
       tests.rig_reel('slots_paylines', 4, 'J', 'J', 'J')
  from generate_series(1, 9);
set role authenticated;
create temp table sl_out as select public.slot_spin('slots_paylines', 100) as r;
select tests.ok((r #>> '{result,base,scatters}')::int = 3 and (r #>> '{result,base,scatter_units}')::int = 200, 'three scatters pay twice the bet') from sl_out;
select tests.ok(jsonb_array_length(r #> '{result,free}') = 10, 'ten free spins played') from sl_out;
select tests.ok((r #>> '{result,free,0,units}')::int = 560, 'free spin wins are doubled') from sl_out;
select tests.ok((r ->> 'win')::int = 760 and (r ->> 'balance')::int = tests.bal(:A), 'total paid in one go') from sl_out;
select tests.ok(tests.bal(:A) = 11290 - 100 + 760, 'free spins cost nothing');
select tests.ok((select count(*) from tests.dice) = 0, 'every stacked symbol was used');
drop table sl_out;
reset role;

-- ----------------------------------------------------------------------------
-- Dragon Pearls: six pearls start the hold-and-win respins
-- ----------------------------------------------------------------------------
select tests.rig_reel('slots_holdwin', 0, 'PEARL', 'PEARL', 'PEARL');
select tests.rig_reel('slots_holdwin', 1, 'PEARL', 'PEARL', 'PEARL');
select tests.rig_reel('slots_holdwin', 2, 'K', 'Q', 'K'), tests.rig_reel('slots_holdwin', 3, 'A', 'A', 'A'), tests.rig_reel('slots_holdwin', 4, 'Q', 'K', 'Q');
select tests.rig(0, 0, 0, 0, 0, 0);                              -- six pearls worth 1x each
select tests.rig(0, 99);                                         -- respin 1: a pearl lands on cell 6, worth 100x
select tests.rig(9999, 9999, 9999, 9999, 9999, 9999, 9999, 9999);  -- nothing on the other 8
select tests.rig(9999, 9999, 9999, 9999, 9999, 9999, 9999, 9999) from generate_series(1, 3);  -- three empty respins
set role authenticated;
create temp table sl_out as select public.slot_spin('slots_holdwin', 10) as r;
select tests.ok((r #>> '{result,base,units}')::int = 0, 'pearls on reel 1 mean no line wins') from sl_out;
select tests.ok(r #> '{result,base,pearls}' = '[100,100,100,100,100,100,0,0,0,0,0,0,0,0,0]', 'pearl prizes shown on the first spin') from sl_out;
select tests.ok(jsonb_array_length(r #> '{result,hold,steps}') = 4, 'a new pearl reset the respins to three') from sl_out;
select tests.ok(r #> '{result,hold,steps,0}' = '[{"cell": 6, "value": 10000}]', 'the new pearl') from sl_out;
select tests.ok((r #>> '{result,hold,units}')::int = 10600 and not (r #>> '{result,hold,grand}')::boolean, 'pearls added up') from sl_out;
select tests.ok((r ->> 'win')::int = 1060, 'hold and win paid') from sl_out;
select tests.ok((select count(*) from tests.dice) = 0, 'every stacked number was used');
drop table sl_out;
reset role;

-- ----------------------------------------------------------------------------
-- Wild Frontier: ways multiply
-- ----------------------------------------------------------------------------
select tests.rig(0), tests.rig_reel('slots_ways', 0, 'BISON', 'J', 'K');     -- each reel: height 3, then its symbols
select tests.rig(0), tests.rig_reel('slots_ways', 1, 'BISON', 'BISON', 'Q');
select tests.rig(0), tests.rig_reel('slots_ways', 2, 'WILD', 'A', 'A');
select tests.rig(0), tests.rig_reel('slots_ways', 3, 'K', 'K', 'K');
select tests.rig(0), tests.rig_reel('slots_ways', 4, 'J', 'J', 'J');
set role authenticated;
create temp table sl_out as select public.slot_spin('slots_ways', 10) as r;
select tests.ok(r #> '{result,base,wins}' = '[{"n": 3, "sym": "BISON", "ways": 2, "units": 140}]', 'bison on three reels, two ways (a wild counts)') from sl_out;
select tests.ok((r ->> 'win')::int = 14, 'ways paid') from sl_out;
drop table sl_out;
reset role;

-- ----------------------------------------------------------------------------
-- Gem Cascade: a column of five diamonds pays, vanishes and is refilled
-- ----------------------------------------------------------------------------
-- No two neighbours match in this pattern, apart from the stacked first column.
create temp table sl_gems as
select c, r, case when c = 0 then 'DIAMOND'
                  else (array['DIAMOND', 'RUBY', 'EMERALD', 'SAPPHIRE', 'AMETHYST', 'TOPAZ', 'QUARTZ'])[(c + 2 * r + 1) % 7 + 1] end as sym
  from generate_series(0, 5) c, generate_series(0, 4) r;
select tests.rig_reel('slots_cascade', 0, variadic array_agg(sym order by c, r)) from sl_gems;
select tests.rig_reel('slots_cascade', 0, 'RUBY', 'SAPPHIRE', 'TOPAZ', 'DIAMOND', 'EMERALD');  -- the refill
set role authenticated;
create temp table sl_out as select public.slot_spin('slots_cascade', 10) as r;
select tests.ok(jsonb_array_length(r #> '{result,steps}') = 1, 'one cascade') from sl_out;
select tests.ok(r #> '{result,steps,0,clusters}' = '[{"sym": "DIAMOND", "cells": [0, 1, 2, 3, 4], "units": 1000}]', 'five diamonds') from sl_out;
select tests.ok(r #> '{result,grid,0}' = '["RUBY", "SAPPHIRE", "TOPAZ", "DIAMOND", "EMERALD"]', 'new gems dropped in') from sl_out;
select tests.ok((r ->> 'win')::int = 100, 'cluster paid 10 times the bet') from sl_out;
select tests.ok((select count(*) from tests.dice) = 0, 'every stacked gem was used');
drop table sl_out;
reset role;
drop table sl_gems;

-- ----------------------------------------------------------------------------
-- Grand Jackpot
-- ----------------------------------------------------------------------------
select tests.rig_reel('slots_progressive', 0, 'BELL', 'BELL', 'BELL'), tests.rig_reel('slots_progressive', 1, 'BAR', 'BAR', 'BAR'),
       tests.rig_reel('slots_progressive', 2, 'BELL', 'BELL', 'BELL'), tests.rig_reel('slots_progressive', 3, 'BAR', 'BAR', 'BAR'),
       tests.rig_reel('slots_progressive', 4, 'BELL', 'BELL', 'BELL');
select tests.rig(4999999);  -- no jackpot
set role authenticated;
select tests.as_user(:B);
select tests.ok((public.slot_spin('slots_progressive', 100) ->> 'jackpot')::int = 100002, '2% of the bet feeds the pot');
select tests.ok(tests.bal(:B) = 9900, 'no win');
reset role;
select tests.rig_reel('slots_progressive', 0, 'BELL', 'BELL', 'BELL'), tests.rig_reel('slots_progressive', 1, 'BAR', 'BAR', 'BAR'),
       tests.rig_reel('slots_progressive', 2, 'BELL', 'BELL', 'BELL'), tests.rig_reel('slots_progressive', 3, 'BAR', 'BAR', 'BAR'),
       tests.rig_reel('slots_progressive', 4, 'BELL', 'BELL', 'BELL');
select tests.rig(10);       -- not below the 10-chip bet: no jackpot
set role authenticated;
select public.slot_spin('slots_progressive', 10);
select tests.ok(tests.pot() = 10000220, 'even a 10-chip bet feeds it (kept in hundredths)');
reset role;
select tests.rig_reel('slots_progressive', 0, 'BELL', 'BELL', 'BELL'), tests.rig_reel('slots_progressive', 1, 'BAR', 'BAR', 'BAR'),
       tests.rig_reel('slots_progressive', 2, 'BELL', 'BELL', 'BELL'), tests.rig_reel('slots_progressive', 3, 'BAR', 'BAR', 'BAR'),
       tests.rig_reel('slots_progressive', 4, 'BELL', 'BELL', 'BELL');
select tests.rig(99);       -- below the 100-chip bet: jackpot
set role authenticated;
create temp table sl_out as select public.slot_spin('slots_progressive', 100) as r;
select tests.ok((r ->> 'jackpot_won')::int = 100004 and (r ->> 'win')::int = 100004, 'the whole pot is paid') from sl_out;
select tests.ok(r #> '{result,base,grid,2}' = '["BELL", "CROWN", "BELL"]', 'crowns across the middle row') from sl_out;
select tests.ok((r ->> 'jackpot')::int = 100000, 'pot back to its seed') from sl_out;
select tests.ok(tests.bal(:B) = 9890 - 100 + 100004, 'jackpot in the wallet');
drop table sl_out;
select tests.ok((select last_winner = 'SlBen' and last_amount = 100004 from public.jackpots where key = 'grand'), 'winner on the board');
reset role;
select tests.ok((select count(*) from public.chip_ledger where user_id = :B and reason = 'jackpot' and delta = 100004) = 1, 'jackpot ledger row');
select tests.ok((select summary ->> 'feature' = 'jackpot' and returned = 100004 from public.game_history
                  where user_id = :B and game_key = 'slots_progressive' order by id desc limit 1), 'jackpot in the history');

-- Not enough chips
update public.wallets set balance = 15 where user_id = :A;
set role authenticated;
select tests.as_user(:A);
select tests.throws($$select public.slot_spin('slots_classic', 20)$$, 'insufficient_chips');
select tests.ok(tests.bal(:A) = 15, 'nothing taken');
reset role;
update public.wallets set balance = (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = :A) where user_id = :A;

-- ----------------------------------------------------------------------------
-- Books balance
-- ----------------------------------------------------------------------------
select tests.ok(private.chips_in_play(:A) = 0 and private.chips_in_play(:B) = 0, 'slots never leave chips in play');
select tests.ok(not exists (
  select 1 from public.wallets w
   where w.user_id in (:A, :B)
     and w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)
), 'ledger sums match balances');
select tests.ok((select rounds_played = 2 and rounds_won = 1 and biggest_win = 1490 from public.player_game_stats
                  where user_id = :A and game_key = 'slots_classic'), 'slot stats');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'jackpots') = 1, 'jackpot is live');
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every public table');

delete from tests.dice;
delete from auth.users where email like '%@sl.test';
update public.jackpots set pool_hundredths = seed * 100, last_winner = null, last_amount = null, last_won_at = null where key = 'grand';

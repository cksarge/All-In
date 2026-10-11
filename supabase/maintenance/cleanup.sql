-- =============================================================================
-- All In: housekeeping. Deletes data nobody will look at again, to save space.
-- Run it by hand in the Supabase SQL Editor whenever you like (monthly is plenty).
-- Safe to run at any time, including while people are playing, and safe to re-run.
--
-- NEVER touched: accounts, profiles, wallets (balances), player stats, XP and levels,
-- achievements, cosmetics and loadouts, friends, the jackpot, the game catalogue,
-- seats, and anything still being played (open rounds, hands in progress, chips on a table).
--
-- What goes (finished things only; every number is a setting below):
--   * old rounds at each table: the last few stay because the screens show them
--     (blackjack 15, roulette 100 for hot and cold numbers, craps 30 rolls, poker 50 hands)
--   * roulette and craps bets that were settled long ago
--   * old Crash and Bingo rounds
--   * closed tables (private tables and finished tournament tables) with everything on them
--   * finished tournaments older than 30 days
--   * each player's History beyond their newest 25 rounds per game
--   * each player's chip activity beyond their newest 100 entries
--   * weekly leaderboard rows older than 8 weeks
--
-- One thing to know: after this, a player's chip activity no longer adds up to their
-- balance from zero, because the oldest entries are gone. The balance itself is in
-- `wallets` and is not changed.
-- =============================================================================

drop table if exists pg_temp.cleanup_report;
create temp table cleanup_report (step integer generated always as identity, what text, rows_deleted bigint);

-- ---- Settings ---------------------------------------------------------------
drop table if exists pg_temp.cleanup_keep;
create temp table cleanup_keep as select
  15  as blackjack_rounds,      -- per table (the table shows the last 12)
  100 as roulette_rounds,       -- per table (hot and cold numbers use the last 100)
  15  as roulette_bet_rounds,   -- bets are kept only for this many recent rounds
  30  as craps_rolls,           -- per table (the table shows the last 20)
  50  as poker_hands,           -- per table (hand history goes back up to 50)
  30  as crash_rounds,          -- the room shows the last 20
  10  as bingo_rounds,
  25  as history_per_game,      -- per player, per game (the History popups show 20 to 25)
  100 as ledger_rows,           -- per player (Recent activity shows 25)
  interval '1 day'   as closed_table_age,
  interval '1 day'   as settled_bet_age,
  interval '30 days' as tournament_age,
  interval '8 weeks' as weekly_age;

-- ---- Closed tables (their rounds, hands and bets go with them) ---------------
with d as (
  delete from public.game_tables t
   where t.status = 'closed' and not t.persistent
     and t.last_activity_at < now() - (select closed_table_age from cleanup_keep)
     and not exists (select 1 from public.table_seats s where s.table_id = t.id)
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'closed tables', count(*) from d;

-- ---- Blackjack: old finished rounds (hands and dealer secrets go with them) ---
with ranked as (
  select id, phase, row_number() over (partition by table_id order by round_no desc) as n from public.bj_rounds),
d as (
  delete from public.bj_rounds r using ranked x
   where x.id = r.id and x.phase = 'settled' and x.n > (select blackjack_rounds from cleanup_keep)
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'blackjack rounds', count(*) from d;

-- ---- Roulette: bets on old rounds, then very old rounds ----------------------
with ranked as (
  select id, phase, row_number() over (partition by table_id order by round_no desc) as n from public.rl_rounds),
d as (
  delete from public.rl_bets b using ranked x
   where x.id = b.round_id and x.phase = 'settled' and x.n > (select roulette_bet_rounds from cleanup_keep)
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'roulette bets', count(*) from d;

with ranked as (
  select id, phase, row_number() over (partition by table_id order by round_no desc) as n from public.rl_rounds),
d as (
  delete from public.rl_rounds r using ranked x
   where x.id = r.id and x.phase = 'settled' and x.n > (select roulette_rounds from cleanup_keep)
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'roulette rounds', count(*) from d;

-- ---- Craps: old rolls, and bets that were settled a while ago -----------------
with ranked as (
  select id, row_number() over (partition by table_id order by roll_no desc) as n from public.cr_rolls),
d as (
  delete from public.cr_rolls r using ranked x
   where x.id = r.id and x.n > (select craps_rolls from cleanup_keep)
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'craps rolls', count(*) from d;

with d as (
  delete from public.cr_bets
   where status <> 'active' and resolved_at < now() - (select settled_bet_age from cleanup_keep)
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'craps bets', count(*) from d;

-- ---- Poker: old finished hands (players, hole cards and decks go with them) ---
with ranked as (
  select id, phase, row_number() over (partition by table_id order by hand_no desc) as n from public.pk_hands),
d as (
  delete from public.pk_hands h using ranked x
   where x.id = h.id and x.phase = 'settled' and x.n > (select poker_hands from cleanup_keep)
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'poker hands', count(*) from d;

-- ---- Crash and Bingo: old finished rounds (bets, cards and secrets go with them)
with ranked as (select id, phase, row_number() over (order by round_no desc) as n from public.crash_rounds),
d as (
  delete from public.crash_rounds r using ranked x
   where x.id = r.id and x.phase = 'crashed' and x.n > (select crash_rounds from cleanup_keep)
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'crash rounds', count(*) from d;

with ranked as (select id, phase, row_number() over (order by round_no desc) as n from public.bingo_rounds),
d as (
  delete from public.bingo_rounds r using ranked x
   where x.id = r.id and x.phase = 'done' and x.n > (select bingo_rounds from cleanup_keep)
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'bingo rounds', count(*) from d;

-- ---- Tournaments: rounds nobody entered, and old finished ones ---------------
with d as (
  delete from public.tournaments t
   where t.status in ('finished', 'void')
     and (coalesce(t.finished_at, t.ends_at, t.created_at) < now() - (select tournament_age from cleanup_keep)
          or (t.status = 'void' and coalesce(t.finished_at, t.ends_at, t.created_at) < now() - interval '1 day'
              and not exists (select 1 from public.tournament_entries e where e.tournament_id = t.id)))
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'tournaments', count(*) from d;

-- ---- History: each player's rounds beyond the newest few per game -------------
-- (Totals, biggest wins, XP and achievements live in other tables and are untouched.)
with ranked as (
  select id, row_number() over (partition by user_id, game_key order by created_at desc, id desc) as n from public.game_history),
d as (
  delete from public.game_history g using ranked x
   where x.id = g.id and x.n > (select history_per_game from cleanup_keep)
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'history rows', count(*) from d;

-- ---- Chip activity: each player's entries beyond the newest ones --------------
with ranked as (
  select id, row_number() over (partition by user_id order by created_at desc, id desc) as n from public.chip_ledger),
d as (
  delete from public.chip_ledger l using ranked x
   where x.id = l.id and x.n > (select ledger_rows from cleanup_keep)
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'chip activity rows', count(*) from d;

-- ---- Weekly leaderboard: weeks long gone --------------------------------------
with d as (
  delete from public.weekly_stats
   where week_start < (now() - (select weekly_age from cleanup_keep))::date
  returning 1)
insert into cleanup_report (what, rows_deleted) select 'weekly leaderboard rows', count(*) from d;

-- ---- Report --------------------------------------------------------------------
select what, rows_deleted from cleanup_report
union all
select 'database size now: ' || pg_size_pretty(pg_database_size(current_database())), null
order by 1;

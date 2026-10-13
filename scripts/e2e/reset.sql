-- Fresh test players (any password works with mini-supabase), no poker hand history, jackpot at its seed.
delete from public.pk_hands;
delete from auth.users where email like '%@allin.test';
insert into auth.users (email, raw_user_meta_data) values
  ('ann@allin.test', '{"username":"Ann"}'),
  ('ben@allin.test', '{"username":"Ben"}'),
  ('cat@allin.test', '{"username":"Cat"}');
update public.profiles set onboarded_at = now();
update public.jackpots set pool_hundredths = seed * 100, last_winner = null, last_amount = null, last_won_at = null;
delete from tests.dice;
delete from tests.decks;
delete from public.solo_rounds;
delete from public.crash_rounds;
delete from public.bingo_rounds;
delete from public.race_rounds;
delete from public.tpt_hands;
delete from public.tournaments;
delete from public.game_tables where play_money;
-- A craps table left with a point on would refuse the next run's Pass Line bet.
delete from public.cr_bets;
delete from public.cr_rolls;
delete from public.cr_state;
delete from public.cosmetics where season is not null;
delete from public.clubs;
delete from public.big_wins;
-- A run that died with maintenance on would lock every later run out.
update public.site_status set maintenance = false, message = null;
delete from public.chat_messages;
delete from public.player_reputation;
delete from public.reputation_log;
delete from public.player_notes;
delete from public.dm_reads;
update public.player_activity set game_key = null, game_at = null, watchable = true;
delete from public.game_tables where is_private;
-- The seasonal game is "this month's" whenever the suites run.
update public.games set season = to_char(now() at time zone 'utc', 'YYYY-MM') where season is not null;
delete from public.player_missions where period = 'season';

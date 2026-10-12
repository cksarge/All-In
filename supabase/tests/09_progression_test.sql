-- Stage 7 tests: XP and levels, achievements, rewards, cosmetics, leaderboards, profiles, friends.
-- Rounds are recorded directly with private.record_round, which is what every game calls.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000008a1'''
\set B '''00000000-0000-0000-0000-0000000008b2'''
\set C '''00000000-0000-0000-0000-0000000008c3'''
\set T '''00000000-0000-0000-0000-00000000eeee'''
\set U '''00000000-0000-0000-0000-00000000ffff'''

create or replace function tests.round(p_user uuid, p_game text, p_wagered bigint, p_returned bigint, p_summary jsonb default '{}')
returns void language sql security definer as $$
  select private.record_round(p_user, p_game, null, gen_random_uuid(), p_wagered, p_returned, p_summary)
$$;
create or replace function tests.prog(p_user uuid) returns public.player_progress language sql security definer as $$
  select * from public.player_progress where user_id = p_user
$$;
create or replace function tests.has(p_user uuid, p_key text) returns boolean language sql security definer as $$
  select exists (select 1 from public.player_achievements where user_id = p_user and achievement_key = p_key)
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from auth.users where email like '%@prog.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@prog.test', '{"username":"ProgAnn"}'), (:B, 'b@prog.test', '{"username":"ProgBen"}'), (:C, 'c@prog.test', '{"username":"ProgCat"}');

-- ----------------------------------------------------------------------------
-- Levels, XP and the catalogue
-- ----------------------------------------------------------------------------
select tests.ok(private.level_for_xp(0) = 1 and private.level_for_xp(99) = 1 and private.level_for_xp(100) = 2
            and private.level_for_xp(400) = 3 and private.level_for_xp(8100) = 10 and private.level_for_xp(99999999) = 100, 'levels from XP');
select tests.ok(private.xp_for_level(1) = 0 and private.xp_for_level(2) = 100 and private.xp_for_level(10) = 8100, 'XP needed per level');
select tests.ok((select bool_and(private.level_for_xp(private.xp_for_level(l)) = l and private.level_for_xp(private.xp_for_level(l) - 1) = l - 1)
                   from generate_series(2, 100) l), 'the two agree at every level');
select tests.ok(private.round_xp(0, 0) = 2 and private.round_xp(100, 0) = 12 and private.round_xp(100, 200) = 18
            and private.round_xp(10000, 0) = 102 and private.round_xp(900000000, 0) = 1002, 'XP per round: 2 + sqrt(wager), half again for a win, capped');
select tests.ok(private.round_xp(10, 0, 'plinko') = 0 and private.round_xp(10, 20, 'plinko') = 1 and private.round_xp(100, 0, 'plinko') = 2
            and private.round_xp(100, 500, 'plinko') = 3 and private.round_xp(10000, 0, 'plinko') = 25 and private.round_xp(100, 0, 'keno') = 12,
                'Plinko earns a quarter of the square root of the bet and no flat bonus; other games are unchanged');
select tests.ok(not exists (select 1 from public.cosmetics c where c.unlock_level is null and c.season is null
                              and not exists (select 1 from public.achievements a where a.cosmetic_key = c.key or c.key = any (a.extra_cosmetics))), 'every cosmetic can be earned');
select tests.ok((select extra_cosmetics = '{frame_grandmaster}' and cosmetic_key = 'title_grandmaster' and goal = 100 and metric = 'level' from public.achievements where key = 'level_100')
            and (select cardinality(extra_cosmetics) = 2 from public.achievements where key = 'completionist')
            and not exists (select 1 from public.achievements a, unnest(a.extra_cosmetics) x where not exists (select 1 from public.cosmetics c where c.key = x)),
                'Grandmaster and Completionist carry extra cosmetics, and they all exist');
select tests.ok((select count(*) from public.cosmetics where unlock_level = 1) = 5
            and (select count(distinct kind) from public.cosmetics where unlock_level = 1) = 5, 'one starting cosmetic of each kind');
select tests.ok(not exists (select 1 from public.achievements a where not (private.player_metrics(:A) ? a.metric)
                              and a.metric not in ('jackpots', 'royals', 'straight_flushes', 'slot_features', 'crash_10x', 'mines_cleared',
                                                   'bingo_fast', 'keno_perfect', 'best_streak', 'max_multiple',
                                                   'tourney_played', 'tourney_wins', 'sng_wins', 'showdown_wins', 'freeroll_podiums',
                                                   'missions_done', 'weeklies_done', 'daily_sweeps', 'season_tiers', 'seasons_done', 'invites_sent', 'big_wins', 'h2h_best', 'clubs_joined', 'clubs_founded', 'mtt_wins', 'trophies', 'cards_shown', 'joker_big', 'four_aces', 'trails', 'full_rides', 'five_card_tricks', 'spanish_bonuses', 'hilo_runs', 'red_dog_triples',
                                                   'razz_wheels', 'number_ones', 'badugis', 'race_winners', 'race_longshots', 'tpt_wins', 'tpt_blind_wins', 'tpt_trails', 'all_achievements')), 'every achievement measures something that exists');

-- ----------------------------------------------------------------------------
-- A new player
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
create temp table mp as select public.my_progress() as r;
select tests.ok(r @> '{"xp":0,"level":1,"level_xp":0,"next_level_xp":100,"unclaimed_chips":0,"friend_requests":0}', 'starts at level 1') from mp;
select tests.ok(r -> 'loadout' = '{"avatar":"avatar_initial","frame":"frame_none","title":"title_newcomer","card_back":"back_ruby","felt":"felt_classic"}', 'default look') from mp;
select tests.ok(jsonb_array_length(r -> 'owned') = 5 and r -> 'achievements' = '[]', 'owns the five starting cosmetics, no achievements') from mp;
drop table mp;
select tests.throws($$select public.claim_rewards()$$, 'nothing_to_claim');
select tests.throws($$select public.equip_cosmetic('avatar_top_hat')$$, 'cosmetic_locked');
select tests.throws($$select public.equip_cosmetic('avatar_unicorn')$$, 'unknown_cosmetic');
select tests.throws($$update public.player_progress set xp = 999999$$, 'permission denied');
select tests.throws($$insert into public.player_achievements (user_id, achievement_key) values (auth.uid(), 'jackpot')$$, 'permission denied');
select tests.throws($$select private.add_xp(auth.uid(), 5000)$$, 'permission denied');
reset role;

-- ----------------------------------------------------------------------------
-- Rounds give XP and unlock achievements; chips wait to be collected
-- ----------------------------------------------------------------------------
select tests.round(:A, 'keno', 100, 0);
select tests.ok((tests.prog(:A)).xp = 12 + 25 and tests.has(:A, 'first_round'), 'first round: 12 XP, plus 25 for the First Chip achievement');
select tests.ok(tests.bal(:A) = 10000, 'no chips arrive by themselves');
set role authenticated;
select tests.ok((public.my_progress() ->> 'unclaimed_chips')::int = 250, '250 chips waiting');
select tests.ok(public.claim_rewards() @> '{"amount":250,"achievements":250,"levels":0,"balance":10250}', 'collected');
select tests.throws($$select public.claim_rewards()$$, 'nothing_to_claim');
reset role;
select tests.ok((select count(*) from public.chip_ledger where user_id = :A and reason = 'achievement' and delta = 250) = 1, 'achievement ledger row');

-- A 150x win: two "multiple" achievements at once, one with a title as its prize.
select tests.round(:A, 'slots_classic', 10, 1500);
select tests.ok(tests.has(:A, 'multiple_10') and tests.has(:A, 'multiple_100') and tests.has(:A, 'win_1k') and not tests.has(:A, 'multiple_1000'), 'tenfold, hundredfold and a 1,000-chip win');
select tests.ok((select count(*) from public.player_cosmetics where user_id = :A and cosmetic_key = 'title_lucky') = 1, 'the Lucky title came with it');
-- The jackpot: no chips of its own, so nothing to collect for it.
select tests.round(:A, 'slots_progressive', 100, 100100, '{"feature":"jackpot","jackpot":100000}');
select tests.ok(tests.has(:A, 'jackpot') and tests.has(:A, 'win_100k') and tests.has(:A, 'multiple_1000'), 'jackpot achievements');
select tests.ok((select claimed_at is not null from public.player_achievements where user_id = :A and achievement_key = 'jackpot'), 'a prize with no chips needs no collecting');
-- Feats read from the round's summary
select tests.round(:A, 'video_poker_jacks', 10, 8000, '{"made":"royal_flush"}');
select tests.round(:A, 'mines', 10, 24250, '{"outcome":"cleared"}');
select tests.round(:A, 'crash', 10, 120, '{"collected_at":12.00}');
select tests.round(:A, 'bingo', 10, 70, '{"cards":1,"line_at":18}');
select tests.round(:A, 'keno', 10, 6000, '{"picks":5,"hits":5}');
select tests.round(:A, 'three_card_poker', 100, 500, '{"made":"straight_flush"}');
select tests.ok(tests.has(:A, 'royal_flush') and tests.has(:A, 'mines_cleared') and tests.has(:A, 'crash_10x') and tests.has(:A, 'bingo_fast')
            and tests.has(:A, 'keno_perfect') and tests.has(:A, 'straight_flush'), 'six feats');
select tests.round(:B, 'crash', 10, 50, '{"collected_at":5.00}');
select tests.round(:B, 'bingo', 10, 5, '{"cards":1,"line_at":38}');
select tests.round(:B, 'keno', 10, 20, '{"picks":10,"hits":0}');
select tests.ok(not tests.has(:B, 'crash_10x') and not tests.has(:B, 'bingo_fast') and not tests.has(:B, 'keno_perfect'), 'near misses don''t count');
-- Wins in a row: nine wins so far for Ann (the first round was a loss); one more makes ten, then a loss ends the run.
select tests.ok(((tests.prog(:A)).counters ->> 'streak')::int = 8 and tests.has(:A, 'streak_5') and not tests.has(:A, 'streak_10'), 'eight wins in a row');
select tests.round(:A, 'keno', 10, 10);
select tests.ok(((tests.prog(:A)).counters ->> 'streak')::int = 8, 'a push neither adds to the run nor ends it');
select tests.round(:A, 'keno', 10, 20), tests.round(:A, 'keno', 10, 20);
select tests.ok(tests.has(:A, 'streak_10'), 'ten in a row');
select tests.round(:A, 'keno', 10, 0);
select tests.ok(((tests.prog(:A)).counters ->> 'streak')::int = 0 and ((tests.prog(:A)).counters ->> 'best_streak')::int = 10, 'a loss resets the run but not the record');
select tests.ok(tests.has(:A, 'games_5') and not tests.has(:A, 'games_15'), 'five different games');
select tests.ok((select rounds = 13 and wagered = 400 from public.weekly_stats where user_id = :A), 'this week''s totals');

-- ----------------------------------------------------------------------------
-- Levels and their rewards
-- ----------------------------------------------------------------------------
select tests.ok((tests.prog(:A)).level = private.level_for_xp((tests.prog(:A)).xp) and (tests.prog(:A)).level >= 5, 'level follows XP');
select tests.ok(tests.has(:A, 'level_5'), 'reached level 5');
set role authenticated;
create temp table mp as select public.my_progress() as r;
select tests.ok((r ->> 'unclaimed_chips')::bigint = (select sum(200 * g) from generate_series(2, (tests.prog(:A)).level) g)
       + (select sum(a.reward_chips) from public.player_achievements pa join public.achievements a on a.key = pa.achievement_key
           where pa.user_id = :A and pa.claimed_at is null), 'waiting: 200 chips per level reached, plus achievements') from mp;
select tests.ok((r ->> 'level_xp')::bigint <= (r ->> 'xp')::bigint and (r ->> 'xp')::bigint < (r ->> 'next_level_xp')::bigint, 'XP sits between this level and the next') from mp;
create temp table cl as select public.claim_rewards() as r;
select tests.ok((cl.r ->> 'amount')::bigint = (mp.r ->> 'unclaimed_chips')::bigint and (cl.r ->> 'levels')::bigint > 0
            and (cl.r ->> 'balance')::bigint = tests.bal(:A), 'collected it all at once') from mp, cl;
-- Collecting can itself unlock something (holding more chips), whose XP can add a level: collect until it settles.
select case when (public.my_progress() ->> 'unclaimed_chips')::bigint > 0 then public.claim_rewards() end;
select case when (public.my_progress() ->> 'unclaimed_chips')::bigint > 0 then public.claim_rewards() end;
select tests.ok((public.my_progress() ->> 'unclaimed_chips')::bigint = 0, 'nothing left waiting');
drop table mp, cl;
reset role;
select tests.ok((select count(*) from public.chip_ledger where user_id = :A and reason = 'level_up') >= 1, 'level-up ledger row');
select tests.ok((tests.prog(:A)).claimed_level = (tests.prog(:A)).level, 'levels marked as collected');

-- ----------------------------------------------------------------------------
-- Cosmetics
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.ok(public.equip_cosmetic('avatar_top_hat') ->> 'avatar' = 'avatar_top_hat', 'level 2 avatar equipped');
select tests.ok(public.equip_cosmetic('frame_jackpot') ->> 'frame' = 'frame_jackpot', 'achievement frame equipped');
select tests.ok(public.equip_cosmetic('title_lucky') @> '{"title":"title_lucky","avatar":"avatar_top_hat"}', 'title equipped; the rest stays');
select tests.throws($$select public.equip_cosmetic('avatar_dragon')$$, 'cosmetic_locked');
select tests.throws($$select public.equip_cosmetic('title_millionaire')$$, 'cosmetic_locked');
select tests.ok(public.my_progress() -> 'owned' @> '["avatar_top_hat", "frame_jackpot", "title_lucky", "avatar_joker", "avatar_rocket"]', 'owned list');
select tests.ok(not (public.my_progress() -> 'owned' @> '["avatar_dragon"]'), 'and not what hasn''t been earned');
select tests.as_user(:C);
select tests.throws($$select public.equip_cosmetic('frame_jackpot')$$, 'cosmetic_locked');
select tests.ok(public.loadouts_for(array[:A, :C]::uuid[]) -> (:A)::text @> '{"avatar":"avatar_top_hat","frame":"frame_jackpot"}'
            and (public.loadouts_for(array[:A, :C]::uuid[]) -> (:C)::text ->> 'level')::int = 1, 'looks for a table''s players');
reset role;

-- ----------------------------------------------------------------------------
-- Friends
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select tests.throws($$select public.friend_request('ProgAnn')$$, 'action_not_allowed');
select tests.throws($$select public.friend_request('nobody_here')$$, 'player_not_found');
select tests.ok(public.friend_request('progben') ->> 'friendship' = 'pending_out', 'request sent (names are not case sensitive)');
select tests.ok(public.friend_request('ProgBen') ->> 'friendship' = 'pending_out', 'asking twice changes nothing');
select tests.ok(jsonb_array_length(public.friends_list() -> 'outgoing') = 1 and jsonb_array_length(public.friends_list() -> 'friends') = 0, 'waiting for an answer');
select tests.as_user(:B);
select tests.ok((public.my_progress() ->> 'friend_requests')::int = 1 and public.friends_list() #>> '{incoming,0,username}' = 'ProgAnn', 'Ben sees the request');
select tests.as_user(:C);
select tests.ok((select count(*) from public.friendships) = 0, 'nobody else can see it');
select tests.throws($$select public.friend_respond('00000000-0000-0000-0000-0000000008a1', true)$$, 'request_not_found');
select tests.as_user(:B);
select tests.ok(public.friend_respond(:A, true) ->> 'friendship' = 'friends', 'accepted');
select tests.ok(tests.has(:A, 'friend_1') and tests.has(:B, 'friend_1'), 'both get Friendly');
-- Cat asks Ann, and Ann asking back accepts it.
select tests.as_user(:C);
select public.friend_request('ProgAnn');
select tests.as_user(:A);
select tests.ok(public.friend_request('ProgCat') ->> 'friendship' = 'friends', 'asking someone who already asked you accepts');
select tests.ok(jsonb_array_length(public.friends_list() -> 'friends') = 2, 'two friends');
-- Where friends are sitting
reset role;
delete from public.game_tables where id in (:T, :U);
insert into public.game_tables (id, game_key, tier, name, max_seats, variant) values (:T, 'roulette', 'low', 'Friends Wheel', 8, 'european');
insert into public.game_tables (id, game_key, tier, name, max_seats, variant, is_private, invite_code) values (:U, 'roulette', 'low', 'Secret Wheel', 8, 'european', true, 'ZZZZ99');
set role authenticated;
select tests.as_user(:B);
select public.join_table(:T, 1);
select tests.as_user(:A);
select tests.ok((select f -> 'table' @> '{"game_key":"roulette","name":"Friends Wheel","private":false,"full":false}' and f #>> '{table,id}' = (:T)::text
                   from jsonb_array_elements(public.friends_list() -> 'friends') f where f ->> 'username' = 'ProgBen'), 'Ben is at a public table you can join');
select tests.ok((select f -> 'table' = 'null' from jsonb_array_elements(public.friends_list() -> 'friends') f where f ->> 'username' = 'ProgCat'), 'Cat isn''t at a table');
select tests.as_user(:B);
select public.join_by_code('ZZZZ99');
select tests.as_user(:A);
select tests.ok((select f -> 'table' @> '{"private":true,"id":null}' from jsonb_array_elements(public.friends_list() -> 'friends') f where f ->> 'username' = 'ProgBen'),
                'a private table is not given away');
select tests.as_user(:B);
select public.leave_table(:U);
-- Unfriending
select tests.ok(public.friend_remove(:A) ->> 'friendship' = 'none', 'unfriended');
select tests.as_user(:A);
select tests.ok(jsonb_array_length(public.friends_list() -> 'friends') = 1, 'one friend left');
select tests.ok(public.find_players('prog') @> '[{"username":"ProgBen","friendship":"none"},{"username":"ProgCat","friendship":"friends"}]'
            and jsonb_array_length(public.find_players('prog')) = 2, 'search finds the others, with where you stand');
select tests.ok(public.find_players('p') = '[]' and public.find_players('%') = '[]', 'search needs two real characters');
select tests.as_user(:B);
select tests.ok(public.friend_request('ProgAnn') ->> 'friendship' = 'pending_out', 'asked again');
select tests.as_user(:A);
select tests.ok(public.friend_respond(:B, false) ->> 'friendship' = 'none', 'declined');
reset role;

-- ----------------------------------------------------------------------------
-- Profiles and leaderboards
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:C);
create temp table pf as select public.get_profile('progann') as r;
select tests.ok(r @> '{"username":"ProgAnn","friendship":"friends"}' and (r ->> 'level')::int = (tests.prog(:A)).level, 'Ann''s profile') from pf;
select tests.ok(r -> 'totals' @> '{"rounds":13,"games":8,"biggest_win":100000}' and r -> 'loadout' @> '{"title":"title_lucky"}', 'totals and look') from pf;
select tests.ok(jsonb_array_length(r -> 'achievements') = (select count(*) from public.player_achievements where user_id = :A)
            and r #>> '{games,0,game_key}' = 'keno', 'achievements, and games most played first') from pf;
drop table pf;
select tests.throws($$select public.get_profile('nobody_here')$$, 'player_not_found');
select tests.as_user(:A);
select tests.ok(public.get_profile('ProgAnn') ->> 'friendship' = 'self', 'your own profile');
create temp table lb as select public.leaderboard('level', true) as r;
select tests.ok(jsonb_array_length(r -> 'rows') = 2 and r #>> '{rows,0,username}' = 'ProgAnn' and r #>> '{rows,1,username}' = 'ProgCat'
            and r -> 'me' @> '{"rank":1}', 'friends board: Ann, then Cat') from lb;
select tests.ok(r #> '{rows,0}' @> '{"rank":1}' and r #> '{rows,0,loadout}' @> '{"avatar":"avatar_top_hat"}' and (r #>> '{rows,0,value}')::bigint = (tests.prog(:A)).xp, 'rows carry rank, value and look') from lb;
drop table lb;
select tests.ok((public.leaderboard('chips', true) #>> '{rows,0,value}')::bigint = tests.bal(:A), 'chips board');
select tests.ok((public.leaderboard('biggest_win', true) #>> '{rows,0,value}')::bigint = 100000, 'biggest win board');
select tests.ok(jsonb_array_length(public.leaderboard('week', true) -> 'rows') = 1
            and (public.leaderboard('week', true) #>> '{rows,0,value}')::bigint = (select returned - wagered from public.weekly_stats where user_id = :A), 'weekly board lists only who played this week');
select tests.ok((public.leaderboard('level') -> 'me' ->> 'rank')::int >= 1 and jsonb_array_length(public.leaderboard('level') -> 'rows') <= 50, 'everyone board');
select tests.throws($$select public.leaderboard('luck')$$, 'unknown_board');
reset role;
set role anon;
select tests.throws($$select public.leaderboard('level')$$, 'permission denied');
select tests.throws($$select * from public.player_progress$$, 'permission denied');
reset role;

-- ----------------------------------------------------------------------------
-- Housekeeping
-- ----------------------------------------------------------------------------
select tests.ok(not exists (
  select 1 from public.wallets w
   where w.user_id in (:A, :B, :C)
     and w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)
), 'ledger sums match balances');
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every public table');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('player_achievements', 'player_progress', 'friendships')) = 3, 'realtime');

delete from public.game_tables where id in (:T, :U);
-- Grandmaster (level 100) and Completionist (every other achievement).
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000008d4', 'd@prog.test', '{"username":"ProgDan"}');
select tests.round('00000000-0000-0000-0000-0000000008d4', 'keno', 10, 0, '{"picks":3,"hits":0}');
select private.add_xp('00000000-0000-0000-0000-0000000008d4', 980100);
select private.check_achievements('00000000-0000-0000-0000-0000000008d4');
select tests.ok((tests.prog('00000000-0000-0000-0000-0000000008d4')).level = 100 and tests.has('00000000-0000-0000-0000-0000000008d4', 'level_100')
            and (select count(*) from public.player_cosmetics where user_id = '00000000-0000-0000-0000-0000000008d4' and cosmetic_key in ('title_grandmaster', 'frame_grandmaster')) = 2,
                'level 100: Grandmaster, with its title and frame');
select tests.ok(not tests.has('00000000-0000-0000-0000-0000000008d4', 'completionist')
            and (private.player_metrics('00000000-0000-0000-0000-0000000008d4') ->> 'all_achievements')::int = 0, 'Completionist is not handed out early');
insert into public.player_achievements (user_id, achievement_key, claimed_at)
select '00000000-0000-0000-0000-0000000008d4', a.key, now() from public.achievements a where a.key <> 'completionist' on conflict do nothing;
select private.check_achievements('00000000-0000-0000-0000-0000000008d4');
select tests.ok(tests.has('00000000-0000-0000-0000-0000000008d4', 'completionist')
            and (select count(*) from public.player_cosmetics where user_id = '00000000-0000-0000-0000-0000000008d4'
                  and cosmetic_key in ('title_completionist', 'avatar_infinity', 'frame_completionist')) = 3, 'every other achievement unlocked: Completionist, with three cosmetics');

delete from auth.users where email like '%@prog.test';
select tests.ok((select count(*) from public.player_progress where user_id in (:A, :B, :C)) = 0
            and (select count(*) from public.friendships where requester in (:A, :B, :C) or addressee in (:A, :B, :C)) = 0, 'deleting a player removes everything of theirs');

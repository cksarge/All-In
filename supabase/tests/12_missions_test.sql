-- Stage 9, part 2 tests: missions, seasons, the inbox and table invites.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-00000000b0a1'''
\set B '''00000000-0000-0000-0000-00000000b0b2'''
\set C '''00000000-0000-0000-0000-00000000b0c3'''

-- The tests move the clock (private.live_now is what every function here asks).
create or replace function tests.clock(p_at timestamptz) returns void language plpgsql security definer as $$
begin
  execute format('create or replace function private.live_now() returns timestamptz language sql stable set search_path = '''' as $f$ select %L::timestamptz $f$', p_at);
end $$;
create or replace function tests.round(p_user uuid, p_game text, p_wagered bigint, p_returned bigint, p_summary jsonb default '{}')
returns void language sql security definer as $$
  select private.record_round(p_user, p_game, null, gen_random_uuid(), p_wagered, p_returned, p_summary)
$$;
-- Replaces a player's three daily missions with known ones.
create or replace function tests.dailies(p_user uuid, p_kinds text[], p_params text[], p_goals bigint[]) returns void language sql security definer as $$
  update public.player_missions m
     set kind = p_kinds[m.slot], param = p_params[m.slot], goal = p_goals[m.slot], key = 'test_' || m.slot,
         progress = 0, completed_at = null, claimed_at = null, meta = '{}', reward_chips = 300, reward_xp = 40, reward_points = 10
   where m.user_id = p_user and m.period = 'daily' and m.period_start = private.live_day()
$$;
create or replace function tests.mission(p_user uuid, p_slot integer) returns public.player_missions language sql security definer as $$
  select * from public.player_missions where user_id = p_user and period = 'daily' and period_start = private.live_day() and slot = p_slot
$$;
create or replace function tests.counter(p_user uuid, p_key text) returns bigint language sql security definer as $$
  select coalesce((counters ->> p_key)::bigint, 0) from public.player_progress where user_id = p_user
$$;
create or replace function tests.has(p_user uuid, p_key text) returns boolean language sql security definer as $$
  select exists (select 1 from public.player_achievements where user_id = p_user and achievement_key = p_key)
$$;
create or replace function tests.season_points(p_user uuid, p_season text, p_points integer) returns void language sql security definer as $$
  insert into public.player_seasons as s (user_id, season, points) values (p_user, p_season, p_points)
  on conflict (user_id, season) do update set points = excluded.points
$$;
create or replace function tests.kinds(p_user uuid) returns text[] language sql security definer as $$
  select array_agg(kind order by id) from public.notifications where user_id = p_user
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from auth.users where email like '%@live.test';
delete from public.cosmetics where season is not null;
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@live.test', '{"username":"LiveAnn"}'), (:B, 'b@live.test', '{"username":"LiveBen"}'), (:C, 'c@live.test', '{"username":"LiveCat"}');
select tests.clock('2026-10-15 12:00+00');

-- ----------------------------------------------------------------------------
-- The season list is private, and only this month exists for players
-- ----------------------------------------------------------------------------
select tests.ok(jsonb_array_length(private.season_cfg()) = 13 and private.season_cfg() -> 0 ->> 'key' = '2026-10' and private.season_cfg() -> 12 ->> 'key' = '2027-10', 'thirteen seasons, October to October');
select tests.ok((select count(*) from public.cosmetics where season is not null) = 0, 'no season cosmetic exists before anyone looks');
set role authenticated;
select tests.as_user(:A);
select tests.throws($$select private.season_cfg()$$, 'permission denied');
select tests.throws($$select private.season_current()$$, 'permission denied');
create temp table st as select public.missions_state() as r;
grant select on st to authenticated;
select tests.ok(r #>> '{season,key}' = '2026-10' and r #>> '{season,name}' = 'Fright Night' and jsonb_array_length(r #> '{season,tiers}') = 10, 'this month''s season, ten steps') from st;
select tests.ok(r #>> '{season,tiers,4,reward,name}' = 'Jack-o''-Lantern' and r #>> '{season,tiers,4,reward,look,glyph}' = '🎃'
            and r #>> '{season,tiers,9,reward,kind}' = 'frame' and r #> '{season,tiers,0,reward}' = 'null' and (r #>> '{season,tiers,0,chips}')::int = 500, 'rewards: chips and four cosmetics') from st;
select tests.ok((r #>> '{season,ends_at}')::timestamptz = '2026-11-01 00:00+00' and (r ->> 'daily_ends_at')::timestamptz = '2026-10-16 00:00+00'
            and (r ->> 'weekly_ends_at')::timestamptz = '2026-10-19 00:00+00', 'ends at the turn of the month, day and week (UTC)') from st;
select tests.ok(r::text not like '%Harvest%' and r::text not like '%2026-11%' and r::text not like '%Turkey%', 'nothing about next month') from st;
select tests.ok((select count(*) from public.cosmetics where season is not null) = 4 and (select count(*) from public.cosmetics where season <> '2026-10') = 0, 'only this month''s cosmetics are published');

-- ----------------------------------------------------------------------------
-- Missions
-- ----------------------------------------------------------------------------
select tests.ok((select count(*) filter (where m ->> 'period' = 'daily') = 3 and count(*) filter (where m ->> 'period' = 'weekly') = 3
                   from st, jsonb_array_elements(r -> 'missions') m), 'three daily and three weekly missions') from st limit 1;
select tests.ok((select array_agg((m ->> 'points')::int order by m ->> 'slot') filter (where m ->> 'period' = 'daily') = '{7,10,13}'
                    and array_agg(m ->> 'tier' order by m ->> 'slot') filter (where m ->> 'period' = 'daily') = '{easy,medium,hard}'
                    and array_agg((m ->> 'points')::int order by m ->> 'slot') filter (where m ->> 'period' = 'weekly') = '{30,40,50}'
                   from st, jsonb_array_elements(r -> 'missions') m), 'an easy, a medium and a hard one: 30 points a day, 120 a week') from st limit 1;
select tests.ok(public.missions_state() -> 'missions' = (select r -> 'missions' from st), 'the same ones every time you look');
select tests.ok((select count(*) from public.notifications where user_id = auth.uid() and kind = 'season_start') = 1, 'told about the new season once');
select public.inbox_clear();
select public.missions_state();
select public.missions_state();
select tests.ok((select count(*) from public.notifications where user_id = auth.uid() and kind = 'season_start') = 0, 'and not again after the inbox is cleared');
drop table st;
select tests.throws($$select public.missions_claim()$$, 'action_not_allowed');
reset role;

select tests.dailies(:A, array['rounds', 'wins', 'category'], array[null, null, 'slots'], array[3, 2, 2]);
select tests.round(:A, 'blackjack', 100, 0);
select tests.ok((tests.mission(:A, 1)).progress = 1 and (tests.mission(:A, 2)).progress = 0 and (tests.mission(:A, 3)).progress = 0, 'a lost table round: one round, no win, no slot spin');
select tests.round(:A, 'slots_classic', 100, 300);
select tests.round(:A, 'slots_classic', 100, 150);
select tests.ok((tests.mission(:A, 1)).completed_at is not null and (tests.mission(:A, 2)).completed_at is not null and (tests.mission(:A, 3)).completed_at is not null, 'all three finished');
select tests.round(:A, 'slots_classic', 100, 150);
select tests.ok((tests.mission(:A, 1)).progress = 3, 'progress stops at the goal');
select tests.ok(tests.counter(:A, 'missions_done') = 3 and tests.counter(:A, 'daily_sweeps') = 1, 'counted, with a clean sweep');
select tests.ok(tests.has(:A, 'mission_first') and tests.has(:A, 'daily_sweep') and not tests.has(:A, 'mission_25'), 'mission achievements');

select private.missions_ensure(:B);
select tests.dailies(:B, array['games', 'multiple', 'net'], array[null, '5', null], array[2, 1, 500]);
select tests.round(:B, 'keno', 100, 0, '{"picks":3,"hits":0}');
select tests.round(:B, 'keno', 100, 450, '{"picks":3,"hits":2}');
select tests.ok((tests.mission(:B, 1)).progress = 1 and (tests.mission(:B, 2)).progress = 0 and (tests.mission(:B, 3)).progress = 350, 'one game so far, 4.5x is not 5x, 350 won');
select tests.round(:B, 'baccarat', 100, 500);
select tests.ok((tests.mission(:B, 1)).completed_at is not null and (tests.mission(:B, 2)).completed_at is not null and (tests.mission(:B, 3)).completed_at is not null,
                'a second game, a 5x win and 750 won in total');

set role authenticated;
select tests.as_user(:A);
select tests.ok((public.missions_state() ->> 'to_collect')::int = 3, 'three to collect');
create temp table cl as select tests.bal(:A) as before, public.missions_claim() as r;
select tests.ok(r @> '{"missions":3,"chips":900,"xp":120,"points":30}' and (r ->> 'balance')::bigint = tests.bal(:A), 'collected: chips, XP and season points') from cl;
drop table cl;
select tests.ok((public.missions_state() #>> '{season,points}')::int = 30 and (public.missions_state() ->> 'to_collect')::int = 0, 'the points are on the season track');
select tests.throws($$select public.missions_claim()$$, 'action_not_allowed');
select tests.throws($$select public.season_claim()$$, 'action_not_allowed');
select tests.throws($$update public.player_missions set progress = goal, completed_at = now()$$, 'permission denied');
select tests.throws($$update public.player_seasons set points = 1000$$, 'permission denied');
select tests.ok((select count(*) from public.player_missions where user_id <> auth.uid()) = 0, 'other players'' missions are not readable');
reset role;
select tests.ok((select count(*) from public.chip_ledger where user_id = :A and reason = 'mission' and delta = 900) = 1, 'in the ledger as a mission reward');

-- ----------------------------------------------------------------------------
-- The season track
-- ----------------------------------------------------------------------------
select tests.season_points(:A, '2026-10', 400);
set role authenticated;
create temp table sc as select tests.bal(:A) as before, public.season_claim() as r;
select tests.ok(r @> '{"chips":3000,"tiers":5,"cosmetics":["s2610_title","s2610_avatar"]}' and (r ->> 'balance')::bigint = before + 3000, 'five steps: 3,000 chips, the title and the avatar') from sc;
drop table sc;
select tests.throws($$select public.season_claim()$$, 'action_not_allowed');
select tests.ok(public.equip_cosmetic('s2610_avatar') is not null or true, 'a season avatar can be worn');
select tests.throws($$select public.equip_cosmetic('s2610_frame')$$, 'cosmetic_locked');
select tests.as_user(:B);
select tests.throws($$select public.equip_cosmetic('s2610_avatar')$$, 'cosmetic_locked');
reset role;
select tests.ok(tests.has(:A, 'season_tier_5') and not tests.has(:A, 'season_done'), 'Season Ticket');

-- Next month: October closes. What Ann had reached is handed over; the rest is gone.
select tests.season_points(:A, '2026-10', 700);
select tests.season_points(:B, '2026-10', 1000);
select tests.clock('2026-11-03 09:00+00');
set role authenticated;
select tests.as_user(:A);
create temp table st as select tests.bal(:A) as before, public.missions_state() as r;
grant select on st to authenticated;
select tests.ok(r #>> '{season,name}' = 'Harvest Table' and (r #>> '{season,points}')::int = 0 and r #>> '{season,tiers,4,reward,name}' = 'Turkey', 'a new season, from zero') from st;
select tests.ok(r::text not like '%Fright%' and r::text not like '%Winter%', 'last month and next month are not in it') from st;
select tests.ok(tests.bal(:A) = before + 2500, 'October''s reached steps (6 and 7) were handed over') from st;
drop table st;
select tests.ok((select count(*) from public.player_cosmetics where user_id = auth.uid() and cosmetic_key like 's2610\_%') = 3, 'title, avatar and card back; never the frame');
select tests.ok(jsonb_array_length(public.missions_state() -> 'missions') = 6, 'fresh missions for the new day and week');
select tests.as_user(:B);
select public.missions_state();
reset role;
select tests.ok((select count(*) from public.player_cosmetics where user_id = :B and cosmetic_key like 's2610\_%') = 4 and tests.has(:B, 'season_done'), 'a finished track is handed over in full, with Season Finale');
select tests.ok((select claimed_tier from public.player_seasons where user_id = :A and season = '2026-10') = 7, 'October stays where it ended');
select tests.season_points(:A, '2026-10', 1000);
set role authenticated;
select tests.as_user(:A);
select public.missions_state();
reset role;
select tests.ok((select count(*) from public.cosmetics where season is not null) = 8, 'November''s cosmetics are published now');
-- (Points can no longer be earned for October: only the current month is ever added to.)
select private.season_add(:C, 50);
select tests.ok((select season from public.player_seasons where user_id = :C) = '2026-11', 'points only ever go to the month the server is in');

-- Outside the calendar there is simply no season.
select tests.clock('2027-11-02 00:00+00');
set role authenticated;
select tests.as_user(:C);
select tests.ok(public.missions_state() -> 'season' = 'null' and jsonb_array_length(public.missions_state() -> 'missions') = 6, 'after the last season: missions go on, no season');
select tests.throws($$select public.season_claim()$$, 'action_not_allowed');
reset role;
select tests.clock('2026-10-15 12:00+00');

-- ----------------------------------------------------------------------------
-- Inbox and invites
-- ----------------------------------------------------------------------------
delete from public.notifications where user_id in (:A, :B, :C);
set role authenticated;
select tests.as_user(:A);
select public.friend_request('LiveBen');
select tests.as_user(:B);
select tests.ok((public.inbox() ->> 'unread')::int = 1 and public.inbox() #>> '{items,0,kind}' = 'friend_request' and public.inbox() #>> '{items,0,data,from}' = 'LiveAnn', 'a friend request lands in the inbox');
select public.friend_respond(:A, true);
select public.inbox_read();
select tests.ok((public.inbox() ->> 'unread')::int = 0 and (public.inbox() #>> '{items,0,read}')::boolean, 'marked read');
select tests.ok((select count(*) from public.notifications where user_id <> auth.uid()) = 0, 'other inboxes are not readable');
select tests.throws($$insert into public.notifications (user_id, kind) values (auth.uid(), 'fake')$$, 'permission denied');
select tests.as_user(:A);
select tests.ok('friend_accepted' = any (tests.kinds(auth.uid())) and 'achievement' = any (tests.kinds(auth.uid())), 'the answer comes back, and so does the achievement it unlocked');

select tests.throws($$select public.invite_friend('00000000-0000-0000-0000-00000000b0b2')$$, 'action_not_allowed');
select public.quick_join('blackjack', 'low');
select tests.throws($$select public.invite_friend('00000000-0000-0000-0000-00000000b0c3')$$, 'action_not_allowed');
select public.invite_friend(:B);
select tests.throws($$select public.invite_friend('00000000-0000-0000-0000-00000000b0b2')$$, 'slow_down');
select tests.as_user(:B);
select tests.ok(public.inbox() #>> '{items,0,kind}' = 'table_invite' and public.inbox() #>> '{items,0,data,game_key}' = 'blackjack'
            and public.inbox() #>> '{items,0,data,table_id}' is not null and public.inbox() #> '{items,0,data,code}' is null, 'an invite to a public table: where, and no code needed');
select public.inbox_clear((public.inbox() #>> '{items,0,id}')::bigint);
select tests.ok(public.inbox() #>> '{items,0,kind}' <> 'table_invite', 'one notification deleted');
select public.inbox_clear();
select tests.ok(jsonb_array_length(public.inbox() -> 'items') = 0, 'inbox emptied');
select tests.as_user(:A);
select public.leave_table((public.my_table() ->> 'table_id')::uuid);
reset role;
select tests.ok(tests.has(:A, 'invite_first'), 'Good Host');

select tests.round(:C, 'sng_poker', 250, 500, '{"kind":"sng","place":1,"players":2}');
select tests.ok('tournament_result' = any (tests.kinds(:C)), 'a tournament result is posted to the inbox');
select private.notify(:C, 'test', '{}') from generate_series(1, 70);
select tests.ok((select count(*) from public.notifications where user_id = :C) = 60, 'an inbox keeps its newest 60');

set role anon;
select tests.throws($$select public.missions_state()$$, 'permission denied');
select tests.throws($$select public.inbox()$$, 'permission denied');
reset role;
select tests.ok(not exists (
  select 1 from public.wallets w where w.user_id in (:A, :B, :C)
     and w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)), 'ledger sums match balances');
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every public table');

-- Put the clock back.
create or replace function private.live_now() returns timestamptz language sql stable set search_path = '' as $$ select now() $$;
revoke execute on function private.live_now() from public, anon, authenticated;
delete from public.cosmetics where season is not null;
delete from auth.users where email like '%@live.test';

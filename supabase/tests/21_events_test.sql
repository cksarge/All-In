-- Stage 12, part 3 tests: the seasonal slot, the season's missions, private tournaments and club events.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000e7a01'''
\set B '''00000000-0000-0000-0000-0000000e7b02'''
\set C '''00000000-0000-0000-0000-0000000e7c03'''
\set D '''00000000-0000-0000-0000-0000000e7d04'''

create or replace function tests.clock(p_at timestamptz) returns void language plpgsql security definer as $$
begin
  execute format('create or replace function private.live_now() returns timestamptz language sql stable set search_path = '''' as $f$ select %L::timestamptz $f$', p_at);
end $$;
create or replace function tests.rig(variadic p_vals integer[]) returns void language sql security definer as $$
  insert into tests.dice (v) select x from unnest(p_vals) with ordinality u(x, o) order by o
$$;
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
create or replace function tests.round(p_user uuid, p_game text, p_wagered bigint, p_returned bigint, p_summary jsonb default '{}')
returns void language sql security definer as $$
  select private.record_round(p_user, p_game, null, gen_random_uuid(), p_wagered, p_returned, p_summary)
$$;
create or replace function tests.smission(p_user uuid, p_slot integer) returns public.player_missions language sql security definer as $$
  select * from public.player_missions where user_id = p_user and period = 'season' and slot = p_slot order by period_start desc limit 1
$$;
create or replace function tests.cnt(p_user uuid, p_key text) returns integer language sql security definer as $$
  select coalesce((counters ->> p_key)::integer, 0) from public.player_progress where user_id = p_user
$$;
create or replace function tests.has(p_user uuid, p_key text) returns boolean language sql security definer as $$
  select exists (select 1 from public.player_achievements where user_id = p_user and achievement_key = p_key)
$$;
create or replace function tests.bal(p uuid) returns bigint language sql security definer as $$
  select balance from public.wallets where user_id = p
$$;
create or replace function tests.ev(p_host uuid) returns public.tournaments language sql security definer as $$
  select * from public.tournaments where host = p_host order by created_at desc limit 1
$$;
create or replace function tests.age_event(p_host uuid) returns void language sql security definer as $$
  update public.tournaments set created_at = created_at - interval '3 hours' where host = p_host and status = 'registering'
$$;
create or replace function tests.set_season(p_game text, p_season text) returns void language sql security definer as $$
  update public.games set season = p_season where key = p_game
$$;
create or replace function tests.points(p_user uuid) returns integer language sql security definer as $$
  select coalesce(sum(points), 0)::integer from public.player_seasons where user_id = p_user
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from tests.dice;
delete from tests.decks;
delete from public.tournaments;
delete from auth.users where email like '%@ev.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@ev.test', '{"username":"EvAnn"}'), (:B, 'b@ev.test', '{"username":"EvBen"}'),
  (:C, 'c@ev.test', '{"username":"EvCat"}'), (:D, 'd@ev.test', '{"username":"EvDan"}');

-- ----------------------------------------------------------------------------
-- The seasonal game: only open in its month
-- ----------------------------------------------------------------------------
select tests.ok((select season = '2026-10' and released and category = 'slots' from public.games where key = 'slots_haunted'), 'Haunted Manor is October 2026''s game');
select tests.ok((select count(*) from public.games where season is not null) = 1, 'the only seasonal game so far');
select tests.ok((private.slot_cfg('slots_haunted') ->> 'rtp')::numeric = 94.9, 'its measured return is written down');
select tests.ok(not exists (select 1 from jsonb_each(private.slot_cfg('slots_haunted') -> 'pays') p, jsonb_each(p.value) v where (v.value)::integer % 10 <> 0),
                'every pay is a multiple of 10 hundredths');

-- Out of season it cannot be played and says so.
select tests.set_season('slots_haunted', '2020-01');
set role authenticated;
select tests.as_user(:A);
select tests.throws($$select public.slot_spin('slots_haunted', 100)$$, 'game_not_open');
select tests.ok((public.slot_info('slots_haunted') ->> 'released')::boolean = false, 'and its page says it is shut');
reset role;
select tests.ok(not private.game_in_season('slots_haunted') and private.game_in_season('slots_classic') and not private.game_in_season('nope'), 'in season: only in its month');
-- For the rest of this file it is "this month" whenever the tests run.
select tests.set_season('slots_haunted', to_char(now() at time zone 'utc', 'YYYY-MM'));

set role authenticated;
select tests.as_user(:A);
create temp table inf as select public.slot_info('slots_haunted') as r;
select tests.ok((r ->> 'released')::boolean and r ->> 'season' is not null, 'open in its month') from inf;
select tests.ok(not (r -> 'config' ? 'weights') and not (r -> 'config' ? 'haunt_bag') and r #> '{config,haunt}' = '{}'::jsonb,
                'how often the manor haunts stays on the server') from inf;
select tests.ok(r #> '{config,free}' @> '{"spins": 8, "mult_step": 1, "mult_max": 10}', 'the midnight spins are in the rules') from inf;
drop table inf;

-- A haunting: the reels land, then two cells turn wild and the lines are scored afterwards.
select tests.rig_reel('slots_haunted', 0, 'VAMPIRE', 'BAT', 'K');
select tests.rig_reel('slots_haunted', 1, 'J', 'Q', 'K');
select tests.rig_reel('slots_haunted', 2, 'VAMPIRE', 'BAT', 'SKULL');
select tests.rig_reel('slots_haunted', 3, 'A', 'A', 'A');
select tests.rig_reel('slots_haunted', 4, 'A', 'A', 'A');
select tests.rig(0, 0, 0, 0);   -- haunted; two cells; the first free cell twice (cells 3 and 4: never the first reel)
create temp table sp as select public.slot_spin('slots_haunted', 100) as r;
select tests.ok(r #> '{result,base,haunted}' = '[3, 4]' and r #> '{result,base,before,1}' = '["J", "Q", "K"]'
            and r #> '{result,base,grid,1}' = '["WILD", "WILD", "K"]', 'two cells of the second reel are taken by ghosts') from sp;
-- Top line: vampire, wild, vampire = three vampires (220). Middle line: bat, wild, bat = three bats (60). More lines cross both.
select tests.ok((r ->> 'win')::bigint >= 280 and (r ->> 'balance')::bigint = 10000 - 100 + (r ->> 'win')::bigint, 'and the lines pay with them') from sp;
select tests.ok((select summary @> '{"haunted": true}' from public.game_history where user_id = :A and game_key = 'slots_haunted' order by id desc limit 1),
                'the round remembers it was haunted');
drop table sp;

-- Midnight spins: three scatters, then eight spins whose multiplier climbs after each win.
delete from tests.dice;
select tests.rig_reel('slots_haunted', 0, 'SCATTER', 'J', 'K');
select tests.rig_reel('slots_haunted', 1, 'SCATTER', 'Q', 'A');
select tests.rig_reel('slots_haunted', 2, 'SCATTER', 'J', 'K');
select tests.rig_reel('slots_haunted', 3, 'Q', 'Q', 'Q');
select tests.rig_reel('slots_haunted', 4, 'Q', 'Q', 'Q');
select tests.rig(1);            -- not haunted
-- free spins 1 and 2: three bats on the top line (60), nothing else
do $$
begin
  for i in 1..2 loop
    perform tests.rig_reel('slots_haunted', 0, 'BAT', 'K', 'J');
    perform tests.rig_reel('slots_haunted', 1, 'BAT', 'A', 'Q');
    perform tests.rig_reel('slots_haunted', 2, 'BAT', 'J', 'J');
    perform tests.rig_reel('slots_haunted', 3, 'Q', 'Q', 'Q');
    perform tests.rig_reel('slots_haunted', 4, 'Q', 'Q', 'Q');
    perform tests.rig(1);
  end loop;
  -- free spins 3 to 8: nothing
  for i in 3..8 loop
    perform tests.rig_reel('slots_haunted', 0, 'J', 'K', 'A');
    perform tests.rig_reel('slots_haunted', 1, 'Q', 'Q', 'Q');
    perform tests.rig_reel('slots_haunted', 2, 'J', 'K', 'A');
    perform tests.rig_reel('slots_haunted', 3, 'Q', 'Q', 'Q');
    perform tests.rig_reel('slots_haunted', 4, 'J', 'K', 'A');
    perform tests.rig(1);
  end loop;
end $$;
create temp table sp as select public.slot_spin('slots_haunted', 100) as r;
select tests.ok(jsonb_array_length(r #> '{result,free}') = 8, 'eight midnight spins') from sp;
select tests.ok((r #>> '{result,free,0,mult}')::integer = 1 and (r #>> '{result,free,1,mult}')::integer = 2
            and (r #>> '{result,free,2,mult}')::integer = 3 and (r #>> '{result,free,7,mult}')::integer = 3,
                'the multiplier climbs after each win and never drops') from sp;
select tests.ok((r #>> '{result,free,0,units}')::integer = 60 and (r #>> '{result,free,1,units}')::integer = 120, 'and multiplies the wins') from sp;
-- 3 scatters pay 200, then 60 and 120: 380 hundredths of 100 chips.
select tests.ok((r ->> 'win')::bigint = 380, 'paid in whole chips') from sp;
select tests.ok((select summary @> '{"feature": "free", "top_mult": 3}' from public.game_history where user_id = :A and game_key = 'slots_haunted' order by id desc limit 1),
                'the round remembers the feature and how high it climbed');
drop table sp;
select tests.ok((select count(*) from tests.dice) = 0, 'every rigged draw was used');
reset role;

-- It is not part of "play every game" (it will be gone next month).
select tests.ok((private.player_metrics(:A) ->> 'games')::integer = 0, 'a seasonal game is not counted among the games played');

-- ----------------------------------------------------------------------------
-- The season's own missions: 300 points, tied to the season's game
-- ----------------------------------------------------------------------------
select tests.clock('2026-10-15 12:00+00');
delete from public.player_missions where user_id in (:A, :B);
set role authenticated;
select tests.as_user(:B);
create temp table ms as select public.missions_state() as r;
select tests.ok((select count(*) = 3 and sum((m ->> 'points')::integer) = 300 from ms, jsonb_array_elements(r -> 'missions') m where m ->> 'period' = 'season'),
                'three season missions worth 300 points') from ms;
select tests.ok((select count(*) = 3 from ms, jsonb_array_elements(r -> 'missions') m where m ->> 'period' = 'season' and m ->> 'param' = 'slots_haunted'),
                'all about the season''s game') from ms;
select tests.ok(r -> 'season_game' @> '{"key": "slots_haunted", "name": "Haunted Manor"}', 'which the page can point to') from ms;
select tests.ok((select count(*) = 9 from ms, jsonb_array_elements(r -> 'missions') m), 'next to three daily and three weekly ones') from ms;
drop table ms;
reset role;

select tests.round(:B, 'slots_classic', 100, 300);
select tests.ok((tests.smission(:B, 1)).progress = 0 and (tests.smission(:B, 2)).progress = 0, 'other games do not count');
select tests.round(:B, 'slots_haunted', 100, 0);
select tests.round(:B, 'slots_haunted', 100, 250, '{"feature": "free"}');
select tests.ok((tests.smission(:B, 1)).progress = 2 and (tests.smission(:B, 2)).progress = 1 and (tests.smission(:B, 3)).progress = 1,
                'spins, wins and midnight spins on the season''s game do');
select tests.ok((tests.smission(:B, 1)).goal = 150 and (tests.smission(:B, 2)).goal = 60 and (tests.smission(:B, 3)).goal = 5, 'the goals');
-- Finish the last one (four more features).
select tests.round(:B, 'slots_haunted', 100, 250, '{"feature": "free"}') from generate_series(1, 4);
select tests.ok((tests.smission(:B, 3)).completed_at is not null, 'a season mission can be finished');
select tests.ok(tests.cnt(:B, 'daily_sweeps') = 0, 'finishing a season mission is not a daily sweep');
set role authenticated;
select tests.as_user(:B);
create temp table cl as select public.missions_claim() as r;
select tests.ok((r ->> 'points')::integer >= 140 and (r ->> 'chips')::bigint >= 8000, 'collected: 140 season points and its chips') from cl;
drop table cl;
reset role;
select tests.ok(tests.points(:B) >= 140, 'the points are on the season track');

-- When the month ends, an unfinished or uncollected season mission is gone with the season.
select tests.round(:B, 'slots_haunted', 100, 250) from generate_series(1, 59);
select tests.ok((tests.smission(:B, 2)).completed_at is not null and (tests.smission(:B, 2)).claimed_at is null, 'the second one is finished but not collected');
select tests.clock('2026-11-02 12:00+00');
set role authenticated;
select tests.as_user(:B);
create temp table ms as select public.missions_state() as r;
select tests.ok((select count(*) = 0 from ms, jsonb_array_elements(r -> 'missions') m where m ->> 'period' = 'season'), 'November has no season game: no season missions') from ms;
select tests.ok(r -> 'season_game' = 'null'::jsonb, 'and no game to point to') from ms;
select tests.ok((r ->> 'to_collect')::integer = 0, 'October''s finished mission can no longer be collected') from ms;
drop table ms;
select tests.throws($$select public.missions_claim()$$, 'action_not_allowed');
reset role;
create or replace function private.live_now() returns timestamptz language sql stable set search_path = '' as $$ select now() $$;
revoke execute on function private.live_now() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Private tournaments
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select tests.throws($$select public.sng_private_create(4, 0)$$, 'unknown_tournament');
select tests.throws($$select public.sng_private_create(2, 300)$$, 'unknown_tournament');
select tests.throws($$select public.sng_private_create(3, 0, 'standard', true)$$, 'action_not_allowed');   -- not in a club
create temp table pc as select public.sng_private_create(2, 0) as r;
select tests.ok(r @> '{"started": false}' and length(r ->> 'code') = 6, 'a free private tournament, with a code') from pc;
select tests.throws($$select public.sng_private_create(2, 0)$$, 'action_not_allowed');                     -- one at a time
select tests.throws($$select public.sng_unregister((select id from public.tournaments where status = 'registering'))$$, 'action_not_allowed');  -- the host cancels instead
select tests.throws($$select invite_code from public.tournaments$$, 'permission denied');
select tests.ok((select count(*) from public.tournaments where status = 'registering') = 1, 'the rest of the row can still be read');
create temp table es as select public.events_state() as r;
select tests.ok(jsonb_array_length(r -> 'events') = 1 and r #> '{events,0}' @> '{"mine": true, "registered": true, "club": false, "players": ["EvAnn"]}'
            and r #>> '{events,0,code}' = (select r ->> 'code' from pc), 'the host sees it and its code') from es;
drop table es;
select tests.ok(not exists (select 1 from jsonb_array_elements(public.tournaments_state() -> 'sng') s where s ->> 'id' is not null), 'it is not in the public list');
select tests.ok(tests.bal(:A) = (select balance from public.wallets where user_id = :A), 'free: no chips taken');

select tests.as_user(:D);
select tests.ok(jsonb_array_length(public.events_state() -> 'events') = 0, 'nobody else sees it');
select tests.throws($$select public.sng_private_join('ZZZZZZ')$$, 'unknown_tournament');
select tests.throws(format('select public.sng_private_join(null, %L)', (tests.ev(:A)).id), 'unknown_tournament');   -- by id is for club events
-- The public queue never drops a player into a private one.
select tests.ok(public.sng_register(2, 250) @> '{"started": false}', 'the public queue stays separate');
select public.sng_unregister((select t.id from public.tournaments t where t.host is null and t.status = 'registering' and t.size = 2 and t.entry_fee = 250));
create temp table pj as select public.sng_private_join(lower((select r ->> 'code' from pc))) as r;
select tests.ok(r @> '{"started": true}' and r ->> 'table_id' is not null, 'the second player joins by code (any capitals) and it starts') from pj;
drop table pj;
reset role;
select tests.ok((select name like 'Private tournament #%' and play_money from public.game_tables where id = (tests.ev(:A)).table_id), 'on a tournament table of its own');
select tests.ok(tests.cnt(:A, 'tournaments_hosted') = 1 and tests.has(:A, 'host_first'), 'the host''s achievement, once it is played');
set role authenticated;
select tests.as_user(:D);
select tests.ok(jsonb_array_length(public.tournaments_state() -> 'live') = 0, 'not listed to watch');
select tests.ok(public.tournaments_state() -> 'my_sng' @> '{"status": "running"}', 'but each player is taken to it');
select public.leave_table((tests.ev(:A)).table_id);
reset role;
select tests.ok((tests.ev(:A)).status = 'finished', 'it ends when one player is left');
select tests.ok((select summary @> '{"kind": "sng", "place": 1, "players": 2, "private": true}' and not summary ? 'club'
                   from public.game_history where user_id = :A and game_key = 'sng_poker' order by id desc limit 1), 'its history says it was private');
select tests.ok(tests.cnt(:A, 'tourney_wins') = 0 and tests.cnt(:A, 'sng_wins') = 0 and tests.cnt(:A, 'tourney_played') = 1,
                'played, but winning among friends is not a tournament win');
select tests.ok(not exists (select 1 from public.player_trophies where user_id = :A), 'and earns no trophy');
drop table pc;

-- One that never fills is called off and paid back. So is one the host cancels.
select tests.bal(:A) as a0 \gset
set role authenticated;
select tests.as_user(:A);
select public.sng_private_create(3, 1000);
select tests.ok(tests.bal(:A) = :a0 - 1000, 'an entry is taken up front');
select tests.as_user(:B);
select public.sng_private_join((tests.ev(:A)).invite_code);
select tests.as_user(:D);
select tests.throws(format('select public.sng_private_cancel(%L)', (tests.ev(:A)).id), 'action_not_allowed');
select tests.as_user(:B);
select public.sng_unregister((tests.ev(:A)).id);
select tests.ok(jsonb_array_length(public.events_state() -> 'events') = 0, 'a guest may step out again');
select public.sng_private_join((tests.ev(:A)).invite_code);
select tests.as_user(:A);
select public.sng_private_cancel((tests.ev(:A)).id);
reset role;
select tests.ok((tests.ev(:A)).status = 'void' and tests.bal(:A) = :a0
            and (select count(*) from public.tournament_entries where tournament_id = (tests.ev(:A)).id) = 0, 'cancelled: everyone is paid back');
set role authenticated;
select tests.as_user(:A);
select public.sng_private_create(3, 1000);
select tests.age_event(:A);
select tests.as_user(:B);
select tests.ok(jsonb_array_length(public.events_state() -> 'events') = 0, 'after two hours it is gone');
reset role;
select tests.ok((tests.ev(:A)).status = 'void' and tests.bal(:A) = :a0, 'and paid back');

-- ----------------------------------------------------------------------------
-- Club events
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select public.club_create('Event Horizon', 'EVH');
select tests.as_user(:B);
select public.club_join((select club_id from public.club_members where user_id = :A));
select tests.throws($$select public.sng_private_create(3, 100, 'standard', true)$$, 'action_not_allowed');   -- a member cannot
select tests.as_user(:C);
select public.club_join((select club_id from public.club_members where user_id = :A));
select tests.as_user(:A);
select tests.throws($$select public.sng_private_create(2, 100, 'standard', true)$$, 'action_not_allowed');   -- three or six
select public.sng_private_create(3, 100, 'turbo', true);
select tests.throws($$select public.sng_private_create(3, 100, 'turbo', true)$$, 'action_not_allowed');
reset role;
select tests.ok((select count(*) from public.notifications where kind = 'club_event' and user_id in (:B, :C)) = 2
            and not exists (select 1 from public.notifications where kind = 'club_event' and user_id = :A), 'the members are told');
set role authenticated;
select tests.as_user(:B);
create temp table es as select public.events_state() as r;
select tests.ok(r #> '{events,0}' @> '{"club": true, "registered": false, "mine": false, "host": "EvAnn", "variant": "turbo"}' and r #> '{events,0,code}' = 'null'::jsonb
            and r -> 'club' @> '{"name": "Event Horizon", "can_host": false}', 'a member sees the club''s event, with no code needed') from es;
drop table es;
select public.sng_private_join(null, (tests.ev(:A)).id);
select tests.as_user(:D);
select tests.throws(format('select public.sng_private_join(null, %L)', (tests.ev(:A)).id), 'unknown_tournament');
select tests.throws(format('select public.sng_private_join(%L)', (tests.ev(:A)).invite_code), 'action_not_allowed');   -- members only, even with the code
select tests.as_user(:C);
select tests.ok(public.sng_private_join(null, (tests.ev(:A)).id) @> '{"started": true}', 'the third member fills it');
reset role;
select tests.ok((select name like 'Club event #%' from public.game_tables where id = (tests.ev(:A)).table_id), 'a club event table');
set role authenticated;
select tests.as_user(:B);
select public.leave_table((tests.ev(:A)).table_id);
select tests.as_user(:C);
select public.leave_table((tests.ev(:A)).table_id);
reset role;
select tests.ok((tests.ev(:A)).status = 'finished' and tests.bal(:A) = :a0 - 100 + 300, 'the winner takes the pool');
select tests.ok(tests.cnt(:A, 'club_event_wins') = 1 and tests.has(:A, 'club_event_win'), 'and the Club Champion achievement');
select tests.ok(tests.cnt(:A, 'tourney_wins') = 0 and not exists (select 1 from public.player_trophies where user_id = :A), 'still no trophy or tournament win');
select tests.ok(tests.cnt(:A, 'tournaments_hosted') = 2, 'hosting is counted each time one is played');

-- ----------------------------------------------------------------------------
-- Tidy up
-- ----------------------------------------------------------------------------
select tests.set_season('slots_haunted', '2026-10');
delete from tests.dice;
delete from public.tournaments where host in (:A, :B, :C, :D);
delete from auth.users where email like '%@ev.test';
select 'events tests passed' as result;

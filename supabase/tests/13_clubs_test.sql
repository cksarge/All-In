-- Stage 9, part 3 tests: clubs, head-to-head, the big-win ticker, records, and bans on the leaderboard.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-00000000c0a1'''
\set B '''00000000-0000-0000-0000-00000000c0b2'''
\set C '''00000000-0000-0000-0000-00000000c0c3'''
\set D '''00000000-0000-0000-0000-00000000c0d4'''
\set H1 '''00000000-0000-0000-0000-0000000c0001'''
\set H2 '''00000000-0000-0000-0000-0000000c0002'''
\set T1 '''00000000-0000-0000-0000-0000000c0003'''

create or replace function tests.rec(p_user uuid, p_game text, p_table uuid, p_round uuid, p_wagered bigint, p_returned bigint, p_summary jsonb default '{}')
returns void language sql security definer as $$
  select private.record_round(p_user, p_game, p_table, p_round, p_wagered, p_returned, p_summary)
$$;
create or replace function tests.poker_table() returns uuid language sql security definer as $$
  select id from public.game_tables where game_key = 'poker_holdem' and persistent limit 1
$$;
create or replace function tests.has(p_user uuid, p_key text) returns boolean language sql security definer as $$
  select exists (select 1 from public.player_achievements where user_id = p_user and achievement_key = p_key)
$$;
create or replace function tests.club(p_name text) returns public.clubs language sql security definer as $$
  select * from public.clubs where name = p_name
$$;
create or replace function tests.role(p_user uuid) returns text language sql security definer as $$
  select role from public.club_members where user_id = p_user
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from auth.users where email like '%@club.test';
delete from public.big_wins;
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@club.test', '{"username":"ClubAnn"}'), (:B, 'b@club.test', '{"username":"ClubBen"}'),
  (:C, 'c@club.test', '{"username":"ClubCat"}'), (:D, 'd@club.test', '{"username":"ClubDan"}');
insert into public.admins (user_id) values (:D) on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Clubs
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.club_state() is null, 'no club yet');
select tests.throws($$select public.club_create('x', 'AB')$$, 'action_not_allowed');
select tests.throws($$select public.club_create('Bad!Name', 'AB')$$, 'action_not_allowed');
select tests.throws($$select public.club_create('Night Owls', 'toolong')$$, 'action_not_allowed');
select tests.throws($$select public.club_create('Night Owls', 'OWL', 'banana')$$, 'action_not_allowed');
select tests.throws($$select public.club_create('All In', 'ALLIN')$$, 'action_not_allowed');
select tests.throws($$select public.club_create('Night Owls', 'STAFF')$$, 'action_not_allowed');
select tests.ok(public.club_create('  Night   Owls ', 'owl', 'crown', true) ->> 'id' is not null, 'created (name tidied, tag upper-cased)');
select tests.ok(public.club_state() @> '{"name":"Night Owls","tag":"OWL","emblem":"crown","members":1,"my_role":"owner","is_open":true}'
            and public.club_state() ->> 'invite_code' ~ '^[A-Z0-9]{6}$', 'the owner sees the club and its code');
select tests.throws($$select public.club_create('Second Club', 'TWO')$$, 'action_not_allowed');
select tests.throws($$select invite_code from public.clubs$$, 'permission denied');
select tests.throws($$update public.clubs set name = 'Hacked'$$, 'permission denied');
select tests.throws($$insert into public.club_members (club_id, user_id) select id, auth.uid() from public.clubs$$, 'permission denied');

select tests.as_user(:B);
select tests.throws($$select public.club_create('night owls', 'NO')$$, 'action_not_allowed');
select tests.throws($$select public.club_create('Early Birds', 'OWL')$$, 'action_not_allowed');
select tests.ok(public.clubs_list('owl') -> 0 ->> 'name' = 'Night Owls' and jsonb_array_length(public.clubs_list('zzz')) = 0, 'search by name or tag');
select tests.ok(public.club_state((tests.club('Night Owls')).id) -> 'invite_code' = 'null' and public.club_state((tests.club('Night Owls')).id) -> 'my_role' = 'null', 'an outsider sees the club but not its code');
select public.club_join((tests.club('Night Owls')).id);
select tests.ok(public.club_state() @> '{"members":2,"my_role":"member"}' and jsonb_array_length(public.club_state() -> 'roster') = 2, 'joined an open club');
select tests.throws($$select public.club_join((tests.club('Night Owls')).id)$$, 'action_not_allowed');
select tests.throws($$select public.club_kick('00000000-0000-0000-0000-00000000c0a1')$$, 'action_not_allowed');
select tests.throws($$select public.club_update(false)$$, 'action_not_allowed');
select tests.throws($$select public.club_set_role('00000000-0000-0000-0000-00000000c0a1', 'member')$$, 'action_not_allowed');

select tests.as_user(:A);
select public.club_update(false, 'fire');
select tests.as_user(:C);
select tests.throws($$select public.club_join((tests.club('Night Owls')).id)$$, 'action_not_allowed');
select tests.throws($$select public.club_join(null, 'WRONG1')$$, 'club_not_found');
select tests.ok(public.club_join(null, (tests.club('Night Owls')).invite_code) ->> 'id' is not null, 'a closed club is joined with its code');

select tests.as_user(:A);
select public.club_set_role(:B, 'officer');
select tests.as_user(:B);
select tests.throws($$select public.club_kick('00000000-0000-0000-0000-00000000c0a1')$$, 'action_not_allowed');
select public.club_kick(:C);
select tests.ok(tests.role(:C) is null and tests.role(:B) = 'officer', 'an officer can remove a member');
select tests.as_user(:A);
select public.club_leave();
select tests.ok(tests.role(:B) = 'owner' and (tests.club('Night Owls')).owner = :B, 'the owner leaving hands the club to the officer');
select tests.as_user(:B);
select tests.throws($$select public.club_set_role('00000000-0000-0000-0000-00000000c0b2', 'member')$$, 'action_not_allowed');
select tests.throws($$select public.admin_club_rename((tests.club('Night Owls')).id, 'Nice Owls', 'NICE')$$, 'not_admin');
select tests.throws($$select public.admin_club_delete((tests.club('Night Owls')).id)$$, 'not_admin');
select tests.as_user(:D);
select public.club_create('All In', 'allin', 'spade', true);
select tests.ok(public.club_state() @> '{"name":"All In","tag":"ALLIN","my_role":"owner"}', 'the admin can use a reserved name and tag');
select public.club_leave();
select public.admin_club_rename((tests.club('Night Owls')).id, 'Nice Owls', 'nice');
select tests.ok(jsonb_array_length(public.admin_clubs('nice')) = 1 and public.admin_clubs('') -> 0 ->> 'owner' = 'ClubBen', 'the admin can list and rename clubs');
select tests.as_user(:B);
select public.club_leave();
reset role;
select tests.ok((select count(*) from public.clubs where name in ('Night Owls', 'Nice Owls')) = 0, 'the last member leaving closes the club');
select tests.ok(tests.has(:A, 'club_founder') and tests.has(:A, 'club_member') and tests.has(:B, 'club_member') and not tests.has(:B, 'club_founder'), 'club achievements');

-- ----------------------------------------------------------------------------
-- Head to head
-- ----------------------------------------------------------------------------
select tests.rec(:A, 'poker_holdem', tests.poker_table(), :H1, 200, 500);
select tests.rec(:B, 'poker_holdem', tests.poker_table(), :H1, 200, 0);
select tests.rec(:C, 'poker_holdem', tests.poker_table(), :H1, 100, 100);
select tests.rec(:B, 'poker_holdem', tests.poker_table(), :H2, 300, 600);
select tests.rec(:A, 'poker_holdem', tests.poker_table(), :H2, 300, 0);
select tests.rec(:A, 'sng_poker', null, :T1, 250, 500, '{"kind":"sng","place":1,"players":2}');
select tests.rec(:B, 'sng_poker', null, :T1, 250, 0, '{"kind":"sng","place":2,"players":2}');
-- A solo round with the same id as nothing else changes nothing.
select tests.rec(:A, 'blackjack', null, gen_random_uuid(), 100, 200);
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.profile_extras('ClubBen') -> 'versus' = '{"hands_me":1,"hands_them":1,"tourney_me":1,"tourney_them":0}', 'you against them: hands each way and a tournament');
select tests.ok(public.profile_extras('ClubCat') -> 'versus' = '{"hands_me":0,"hands_them":0,"tourney_me":0,"tourney_them":0}', 'breaking even is neither a win nor a loss');
select tests.ok(public.profile_extras('ClubBen') -> 'rivals' = 'null' and jsonb_array_length(public.profile_extras('ClubAnn') -> 'rivals') = 1
            and public.profile_extras('ClubAnn') #> '{rivals,0}' @> '{"username":"ClubBen","won":2,"lost":1}', 'your own profile lists your rivals');
select tests.ok(public.profile_extras('ClubAnn') -> 'versus' = 'null', 'no versus on your own profile');
select tests.throws($$select * from public.head_to_head$$, 'permission denied');
select tests.throws($$select public.profile_extras('Nobody_Here')$$, 'player_not_found');
reset role;

-- ----------------------------------------------------------------------------
-- The ticker and personal records
-- ----------------------------------------------------------------------------
delete from public.big_wins;
select tests.rec(:C, 'slots_classic', null, gen_random_uuid(), 100, 2000);
select tests.rec(:C, 'slots_classic', null, gen_random_uuid(), 10, 1500);
select tests.ok((select count(*) from public.big_wins) = 0, '20x is not enough, and neither is 150x of a tiny bet');
select tests.rec(:C, 'slots_classic', null, gen_random_uuid(), 100, 15000);
select tests.rec(:C, 'slot_showdown', null, gen_random_uuid(), 200, 1400, '{"kind":"showdown","place":1,"players":7}');
select tests.rec(:C, 'slot_showdown', null, gen_random_uuid(), 200, 600, '{"kind":"showdown","place":2,"players":7}');
set role authenticated;
select tests.as_user(:A);
select tests.ok(jsonb_array_length(public.big_wins_recent()) = 2 and public.big_wins_recent() -> 1 @> '{"username":"ClubCat","kind":"round","amount":15000,"multiple":150.0,"game":"Lucky Sevens"}'
            and public.big_wins_recent() -> 0 @> '{"kind":"tournament","amount":1400}', 'the ticker: a 150x win and a tournament win');
select tests.ok(public.profile_extras('ClubCat') -> 'records' @> '{"best_multiple":150,"tournaments":2,"tournament_wins":1}'
            and public.profile_extras('ClubCat') #>> '{records,favourite,name}' = 'Lucky Sevens'
            and (public.profile_extras('ClubCat') #>> '{records,best_games,0,biggest_win}')::bigint >= 14900, 'personal records');
reset role;
select tests.ok(tests.has(:C, 'headliner'), 'Headliner');
select private.record_round(:C, 'slots_classic', null, gen_random_uuid(), 100, 3000, '{}') from generate_series(1, 45);
select tests.ok((select count(*) from public.big_wins) = 40, 'the ticker keeps its newest 40');

-- A banned player is on neither the ticker nor the leaderboards.
set role authenticated;
select tests.as_user(:A);
select tests.ok(exists (select 1 from jsonb_array_elements(public.leaderboard('biggest_win') -> 'rows') r where r ->> 'username' = 'ClubCat'), 'on the leaderboard before the ban');
select tests.as_user(:D);
select public.admin_ban(:C, 'test');
select tests.as_user(:A);
select tests.ok(not exists (select 1 from jsonb_array_elements(public.leaderboard('biggest_win') -> 'rows') r where r ->> 'username' = 'ClubCat')
            and not exists (select 1 from jsonb_array_elements(public.leaderboard('level') -> 'rows') r where r ->> 'username' = 'ClubCat'), 'a banned player is off the leaderboards');
select tests.ok(jsonb_array_length(public.big_wins_recent()) = 0, 'and off the ticker');
reset role;

set role anon;
select tests.throws($$select public.clubs_list('')$$, 'permission denied');
reset role;
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every public table');

delete from public.big_wins;
delete from public.admin_log;
delete from auth.users where email like '%@club.test';

-- Stage 12, part 4 tests: scheduled notices and maintenance, site statistics, the chat log search, appeals.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000ad0a1'''
\set B '''00000000-0000-0000-0000-0000000ad0b2'''
\set C '''00000000-0000-0000-0000-0000000ad0c3'''

create or replace function tests.sched(p_kind text) returns public.site_schedule language sql security definer as $$
  select * from public.site_schedule where kind = p_kind order by id desc limit 1
$$;
-- Moves the newest schedule row of a kind so that it started (and maybe ended) some minutes ago.
create or replace function tests.shift_sched(p_kind text, p_start_min integer, p_end_min integer) returns void language sql security definer as $$
  update public.site_schedule
     set starts_at = now() + make_interval(mins => p_start_min),
         ends_at = case when p_end_min is null then null else now() + make_interval(mins => p_end_min) end
   where id = (select id from public.site_schedule where kind = p_kind order by id desc limit 1)
$$;
create or replace function tests.rnd(p_user uuid, p_game text, p_wagered bigint, p_returned bigint)
returns void language sql security definer as $$
  select private.record_round(p_user, p_game, null, gen_random_uuid(), p_wagered, p_returned, '{}')
$$;
create or replace function tests.appeal(p_user uuid) returns public.player_appeals language sql security definer as $$
  select * from public.player_appeals where user_id = p_user order by id desc limit 1
$$;
create or replace function tests.age_appeal(p_user uuid) returns void language sql security definer as $$
  update public.player_appeals set resolved_at = resolved_at - interval '4 days' where user_id = p_user
$$;
create or replace function tests.sanction(p_user uuid) returns public.player_sanctions language sql security definer as $$
  select * from public.player_sanctions where user_id = p_user
$$;
create or replace function tests.rep(p_user uuid) returns integer language sql security definer as $$
  select private.reputation_of(p_user)
$$;
create or replace function tests.logged(p_action text) returns bigint language sql security definer as $$
  select count(*) from public.admin_log where action = p_action
$$;
create or replace function tests.kinds(p_user uuid) returns text[] language sql security definer as $$
  select coalesce(array_agg(kind order by id), '{}') from public.notifications where user_id = p_user
$$;
-- Everyone waits 3 seconds between messages: step past that.
create or replace function tests.waited(p_user uuid) returns void language sql security definer as $$
  update public.player_reputation set last_message_at = now() - interval '10 seconds' where user_id = p_user
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from auth.users where email like '%@adm.test';
delete from public.admin_log;
delete from public.site_schedule;
delete from public.chat_messages;
update public.site_status set maintenance = false, message = null;
update public.site_notice set message = null;
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@adm.test', '{"username":"AdmBoss"}'), (:B, 'b@adm.test', '{"username":"AdmBen"}'), (:C, 'c@adm.test', '{"username":"AdmCat"}');
insert into public.admins (user_id) values (:A) on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Only the admin
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:B);
select tests.throws($$select public.admin_stats()$$, 'not_admin');
select tests.throws($$select public.admin_chat_search('x')$$, 'not_admin');
select tests.throws($$select public.admin_schedule()$$, 'not_admin');
select tests.throws($$select public.admin_schedule_add('notice', 'hi', now(), now() + interval '1 hour')$$, 'not_admin');
select tests.throws($$select public.admin_schedule_cancel(1)$$, 'not_admin');
select tests.throws($$select public.admin_appeals()$$, 'not_admin');
select tests.throws($$select public.admin_appeal_resolve(1, true)$$, 'not_admin');
select tests.throws($$select * from public.site_schedule$$, 'permission denied');
select tests.throws($$select * from public.player_appeals$$, 'permission denied');

-- ----------------------------------------------------------------------------
-- Scheduled notices
-- ----------------------------------------------------------------------------
select tests.as_user(:A);
select tests.throws($$select public.admin_schedule_add('party', 'hi', now(), now() + interval '1 hour')$$, 'action_not_allowed');
select tests.throws($$select public.admin_schedule_add('notice', 'hi', now() - interval '1 hour', now() + interval '1 hour')$$, 'action_not_allowed');
select tests.throws($$select public.admin_schedule_add('notice', 'hi', now() + interval '2 hours', now() + interval '1 hour')$$, 'action_not_allowed');
select tests.throws($$select public.admin_schedule_add('notice', 'hi', now() + interval '1 hour')$$, 'action_not_allowed');   -- a notice needs an end
select tests.throws($$select public.admin_schedule_add('notice', '', now(), now() + interval '1 hour')$$, 'action_not_allowed');
select public.admin_set_notice('Welcome to All In');
select public.admin_schedule_add('notice', 'Double XP at eight', now() + interval '30 minutes', now() + interval '90 minutes');
select tests.ok(public.my_account() ->> 'notice' = 'Welcome to All In', 'before it starts, the notice set by hand shows');
select tests.ok(public.admin_schedule() -> 0 @> '{"kind": "notice", "state": "waiting"}', 'listed as waiting');
select tests.shift_sched('notice', -5, 55);
select tests.as_user(:B);
select tests.ok(public.my_account() ->> 'notice' = 'Double XP at eight', 'once its time comes, every player sees the scheduled notice');
select tests.as_user(:A);
select tests.ok(public.admin_schedule() -> 0 @> '{"state": "running"}', 'listed as running');
select tests.shift_sched('notice', -65, -5);
select tests.ok(public.my_account() ->> 'notice' = 'Welcome to All In', 'and when it ends, the hand-set notice is back');
select tests.ok(public.admin_schedule() -> 0 @> '{"state": "over"}', 'listed as over');
select tests.throws(format('select public.admin_schedule_cancel(%s)', (tests.sched('notice')).id), 'action_not_allowed');
select public.admin_schedule_add('notice', 'Cancelled before anyone saw it', now() + interval '1 minute', now() + interval '1 hour');
select public.admin_schedule_cancel((tests.sched('notice')).id);
select tests.shift_sched('notice', -5, 55);
select tests.ok(public.my_account() ->> 'notice' = 'Welcome to All In', 'a cancelled notice never shows');
select public.admin_set_notice(null);

-- ----------------------------------------------------------------------------
-- Scheduled maintenance
-- ----------------------------------------------------------------------------
select public.admin_schedule_add('maintenance', 'Upgrading the tables', now() + interval '20 minutes', now() + interval '50 minutes');
reset role;
set role anon;
select tests.ok((public.site_status() ->> 'maintenance')::boolean = false and public.site_status() -> 'upcoming' @> '{"message": "Upgrading the tables"}'
            and not public.site_status() ? 'notice', 'signed out: the site is open, and a closure within a day is announced');
reset role;
set role authenticated;
select tests.as_user(:B);
select public.claim_daily_bonus();
select tests.shift_sched('maintenance', -1, 29);
select tests.ok((public.site_status() ->> 'maintenance')::boolean and public.site_status() ->> 'message' = 'Upgrading the tables'
            and public.site_status() ->> 'until' is not null and not (public.site_status() ->> 'admin')::boolean, 'at its start time the site closes by itself');
select tests.throws($$select public.slot_spin('slots_classic', 10)$$, 'site_maintenance');
select tests.throws($$select public.claim_refill()$$, 'site_maintenance');
select tests.as_user(:A);
select tests.ok((public.site_status() ->> 'admin')::boolean, 'the admin is told they are the admin');
select tests.ok((public.slot_spin('slots_classic', 10) ->> 'bet')::integer = 10, 'and can still play');
select tests.shift_sched('maintenance', -31, -1);
select tests.as_user(:B);
select tests.ok(not (public.site_status() ->> 'maintenance')::boolean, 'and it reopens by itself at the end time');
select tests.ok((public.slot_spin('slots_classic', 10) ->> 'bet')::integer = 10, 'players are back in');

-- One with no end lasts until maintenance is switched off; switching off ends a running one.
select tests.as_user(:A);
select public.admin_schedule_add('maintenance', null, now() + interval '5 minutes');
select tests.shift_sched('maintenance', -1, null);
select tests.as_user(:B);
select tests.throws($$select public.slot_spin('slots_classic', 10)$$, 'site_maintenance');
select tests.as_user(:A);
select public.admin_set_maintenance(false);
select tests.as_user(:B);
select tests.ok(not (public.site_status() ->> 'maintenance')::boolean and (public.slot_spin('slots_classic', 10) ->> 'bet')::integer = 10,
                'switching maintenance off ends a scheduled closure');
-- The switch set by hand still works on its own, and wins over the schedule's message.
select tests.as_user(:A);
select public.admin_set_maintenance(true, 'By hand');
select tests.ok(public.site_status() @> '{"maintenance": true, "message": "By hand"}' and public.site_status() -> 'until' = 'null'::jsonb, 'the hand switch is unchanged');
select public.admin_set_maintenance(false);
select tests.ok(tests.logged('schedule_add') = 4 and tests.logged('schedule_cancel') = 1, 'scheduling is in the admin log');

-- ----------------------------------------------------------------------------
-- Site statistics
-- ----------------------------------------------------------------------------
reset role;
select tests.rnd(:B, 'blackjack', 100, 200);
select tests.rnd(:B, 'blackjack', 100, 0);
select tests.rnd(:C, 'roulette', 50, 0);
set role authenticated;
select tests.as_user(:A);
create temp table st as select public.admin_stats(7) as r;
select tests.ok(jsonb_array_length(r -> 'days') = 7 and (r #>> '{days,6,day}')::date = (now() at time zone 'utc')::date, 'one row per day, today last') from st;
select tests.ok((r #>> '{days,6,rounds}')::integer >= 3 and (r #>> '{days,6,active}')::integer >= 2 and (r #>> '{days,6,new_players}')::integer >= 3
            and (r #>> '{days,6,wagered}')::bigint >= 250, 'today''s play and sign-ups are counted') from st;
select tests.ok((select (g ->> 'rounds')::integer = 2 and (g ->> 'players')::integer = 1 and (g ->> 'wagered')::bigint = 200 and (g ->> 'returned')::bigint = 200
                   from st, jsonb_array_elements(r -> 'games') g where g ->> 'game' = 'blackjack' and g ->> 'name' = 'Blackjack'), 'per game: rounds, players, bet and paid back') from st;
select tests.ok((select (l ->> 'chips')::bigint >= 30000 from st, jsonb_array_elements(r -> 'ledger') l where l ->> 'reason' = 'signup_bonus'), 'where chips came from') from st;
select tests.ok((r #>> '{totals,players}')::integer >= 3 and (r #>> '{totals,chips_total}')::bigint >= 30000 and (r #>> '{totals,active_7d}')::integer >= 2
            and r -> 'totals' ? 'online_now' and r -> 'totals' ? 'open_appeals' and jsonb_array_length(r -> 'richest') between 3 and 10, 'the totals') from st;
drop table st;
select tests.ok(jsonb_array_length(public.admin_stats(1000) -> 'days') = 60, 'at most 60 days');

-- ----------------------------------------------------------------------------
-- Chat log search
-- ----------------------------------------------------------------------------
select tests.as_user(:B);
select public.chat_send('room:crash', 'what a flight that was');
select tests.as_user(:C);
select public.chat_send('room:bingo', 'ONE away from a line, 100% true');
select tests.waited(:C);
select public.chat_send('room:crash', 'come and see www.example.com for tips');   -- advertising: stored, not delivered
select tests.as_user(:A);
create temp table cs as select public.admin_chat_search() as r;
select tests.ok(jsonb_array_length(r -> 'messages') = 3 and (r ->> 'kept_days')::integer = 3
            and r #>> '{messages,0,username}' = 'AdmCat' and (r #>> '{messages,0,hidden}')::boolean, 'everything kept, newest first, hidden messages too') from cs;
select tests.ok(r #>> '{messages,2,place}' = 'Crash' and r #>> '{messages,1,place}' = 'Bingo' and r #>> '{messages,2,kind}' = 'room', 'with where it was said') from cs;
drop table cs;
select tests.ok(jsonb_array_length(public.admin_chat_search('FLIGHT') -> 'messages') = 1, 'by words, any capitals');
select tests.ok(jsonb_array_length(public.admin_chat_search('100%') -> 'messages') = 1 and jsonb_array_length(public.admin_chat_search('%') -> 'messages') = 1,
                'a percent sign is just a character');
select tests.ok(jsonb_array_length(public.admin_chat_search('', 'admcat') -> 'messages') = 2, 'by player');
select tests.ok(jsonb_array_length(public.admin_chat_search('', '', 'hidden') -> 'messages') = 1
            and jsonb_array_length(public.admin_chat_search('', '', 'caught') -> 'messages') = 1
            and jsonb_array_length(public.admin_chat_search('', '', 'room') -> 'messages') = 3
            and jsonb_array_length(public.admin_chat_search('', '', 'dm') -> 'messages') = 0, 'by kind');
select tests.ok(jsonb_array_length(public.admin_chat_search('', '', 'all', (select (public.admin_chat_search() #>> '{messages,0,id}')::bigint)) -> 'messages') = 2, 'older pages');
select tests.throws($$select public.admin_chat_search('', '', 'everything')$$, 'action_not_allowed');
select tests.ok(tests.logged('chat_search') >= 8, 'every search is written to the admin log');

-- ----------------------------------------------------------------------------
-- Appeals
-- ----------------------------------------------------------------------------
select tests.as_user(:B);
select tests.ok(public.my_appeal() @> '{"can_appeal": false, "kind": null, "latest": null}', 'in good standing: nothing to appeal');
select tests.throws($$select public.appeal_submit('I would like to appeal something please')$$, 'action_not_allowed');
select tests.as_user(:A);
select public.admin_ban(:B, 'Chip dumping');
select tests.as_user(:B);
select tests.throws($$select public.slot_spin('slots_classic', 10)$$, 'account_banned');
select tests.ok(public.my_appeal() @> '{"can_appeal": true, "kind": "ban"}', 'a suspended player may appeal (and can still ask)');
select tests.throws($$select public.appeal_submit('too short')$$, 'action_not_allowed');
select tests.ok(public.appeal_submit('  I was playing with my brother on his birthday, it will not happen again.  ')
                -> 'latest' @> '{"kind": "ban", "status": "open"}', 'the appeal is sent');
select tests.ok(public.my_appeal() @> '{"can_appeal": false}', 'one at a time');
select tests.throws($$select public.appeal_submit('And another thing, I would like to add something.')$$, 'action_not_allowed');
reset role;
select tests.ok((tests.appeal(:B)).context @> '{"ban_reason": "Chip dumping", "reputation": 0}' and (tests.appeal(:B)).message like 'I was playing%again.',
                'it remembers what was appealed, and the words are trimmed');
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.admin_appeals() -> 0 @> '{"username": "AdmBen", "kind": "ban", "now": "ban", "earlier": 0, "status": "open"}', 'the moderator sees it');
select tests.ok((public.admin_stats(1) #>> '{totals,open_appeals}')::integer = 1, 'and it is counted');
-- Denied: nothing changes, the player is told, and must wait before writing again.
select public.admin_appeal_resolve((public.admin_appeals() #>> '{0,id}')::bigint, false, 'The hands speak for themselves.');
select tests.throws(format('select public.admin_appeal_resolve(%s, true)', (tests.appeal(:B)).id), 'action_not_allowed');
select tests.ok((tests.sanction(:B)).banned_at is not null and jsonb_array_length(public.admin_appeals()) = 0
            and public.admin_appeals('answered') -> 0 @> '{"status": "denied", "reply": "The hands speak for themselves."}', 'denied: still suspended');
select tests.as_user(:B);
select tests.ok(public.my_appeal() @> '{"can_appeal": false}' and public.my_appeal() ->> 'wait_until' is not null
            and public.my_appeal() -> 'latest' @> '{"status": "denied", "reply": "The hands speak for themselves."}', 'the player reads the answer, and waits');
select tests.throws($$select public.appeal_submit('Please look again, I really did not mean any of it.')$$, 'action_not_allowed');
reset role;
select tests.ok('appeal_answer' = any (tests.kinds(:B)), 'and is told in the inbox');
select tests.age_appeal(:B);
set role authenticated;
select tests.as_user(:B);
select public.appeal_submit('Please look again, I really did not mean any of it.');
-- Accepted: the ban is lifted and the reputation put back.
select tests.as_user(:A);
select tests.ok(public.admin_appeals() -> 0 @> '{"earlier": 1}', 'a second appeal says there was an earlier one');
select tests.throws(format('select public.admin_appeal_resolve(%s, true, null, true, 101)', (tests.appeal(:B)).id), 'action_not_allowed');
select public.admin_appeal_resolve((tests.appeal(:B)).id, true, 'Fair enough. Welcome back.', true, 50);
reset role;
select tests.ok((tests.sanction(:B)).banned_at is null and tests.rep(:B) = 50 and (tests.appeal(:B)).status = 'accepted', 'accepted: the suspension is lifted and the reputation set');
set role authenticated;
select tests.as_user(:B);
select tests.ok((public.slot_spin('slots_classic', 10) ->> 'bet')::integer = 10 and public.my_appeal() @> '{"can_appeal": false, "kind": null}', 'the player is back in');

-- A timeout, and a chat ban, can be appealed too. Accepting without "lift" changes nothing by itself.
select tests.as_user(:A);
select public.admin_timeout(:C, 600, 'Cooling off');
select tests.as_user(:C);
select tests.ok(public.appeal_submit('It was a joke between friends and nobody minded at all.') -> 'latest' @> '{"kind": "timeout"}', 'a timeout appeal');
select tests.as_user(:A);
select public.admin_appeal_resolve((tests.appeal(:C)).id, true, null, false);
reset role;
select tests.ok((tests.sanction(:C)).timeout_until > now() and (tests.appeal(:C)).status = 'accepted', 'accepted without lifting: the timeout stands');
set role authenticated;
select tests.as_user(:A);
select public.admin_timeout(:C, 0);
select public.admin_reputation(:C, 'set', 60);
select public.admin_chat_ban(:C, 'chat', null, 'Spamming');
select tests.as_user(:C);
select tests.ok(public.my_appeal() @> '{"can_appeal": true, "kind": "chat"}', 'barred from chat: that can be appealed');
select public.appeal_submit('I have read the rules again and will keep the chat friendly.');
select tests.as_user(:A);
select public.admin_appeal_resolve((tests.appeal(:C)).id, true);
select tests.as_user(:C);
select tests.ok((public.my_reputation() ->> 'can_chat')::boolean and public.my_appeal() @> '{"kind": null}', 'accepted: the chat ban is lifted');
select tests.ok(tests.logged('appeal') = 4, 'every answer is in the admin log');

-- ----------------------------------------------------------------------------
-- Tidy up
-- ----------------------------------------------------------------------------
reset role;
delete from public.site_schedule;
delete from public.chat_messages;
delete from public.admins where user_id = :A;
delete from auth.users where email like '%@adm.test';
select 'admin tools tests passed' as result;

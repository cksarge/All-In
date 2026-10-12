-- Stage 12, part 2 tests: waiting rooms, direct messages, and watching a friend.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000f4a01'''
\set B '''00000000-0000-0000-0000-0000000f4b02'''
\set C '''00000000-0000-0000-0000-0000000f4c03'''

create or replace function tests.tbl(p_user uuid) returns public.game_tables language sql security definer as $$
  select * from public.game_tables where created_by = p_user order by created_at desc limit 1
$$;
-- A player may open one table every 20 seconds: step past that.
create or replace function tests.age_tables(p_user uuid) returns void language sql security definer as $$
  update public.game_tables set created_at = created_at - interval '1 minute' where created_by = p_user
$$;
create or replace function tests.stale_activity(p_user uuid) returns void language sql security definer as $$
  update public.player_activity set game_at = now() - interval '5 minutes' where user_id = p_user
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from tests.dice;
delete from tests.decks;
delete from public.chat_messages;
delete from auth.users where email like '%@soc.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@soc.test', '{"username":"SocAnn"}'), (:B, 'b@soc.test', '{"username":"SocBen"}'), (:C, 'c@soc.test', '{"username":"SocCat"}');

-- ----------------------------------------------------------------------------
-- Waiting rooms
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select public.create_table('blackjack', 'low', true, null, true);
select tests.ok((tests.tbl(:A)).waiting and (tests.tbl(:A)).is_private, 'a private table can open with a waiting room');
select tests.throws(format('select public.bj_place_bet(%L, 100)', (tests.tbl(:A)).id), 'table_waiting');
select tests.as_user(:B);
select public.join_by_code((tests.tbl(:A)).invite_code);
select tests.throws(format('select public.bj_place_bet(%L, 100)', (tests.tbl(:A)).id), 'table_waiting');
select tests.throws(format('select public.table_start(%L)', (tests.tbl(:A)).id), 'action_not_allowed');
select tests.as_user(:C);
select tests.throws(format('select public.table_start(%L)', (tests.tbl(:A)).id), 'not_seated');
select tests.as_user(:A);
select public.table_start((tests.tbl(:A)).id);
select tests.ok(not (tests.tbl(:A)).waiting, 'the host starts it');
select public.bj_place_bet((tests.tbl(:A)).id, 100);
select tests.ok(tests.bal(:A) = 9900, 'and then bets are taken');
select public.bj_clear_bet((tests.tbl(:A)).id);
select public.leave_table((tests.tbl(:A)).id);
select tests.as_user(:B);
select public.leave_table((tests.tbl(:A)).id);

-- Poker: nothing is dealt until the host says so. If the host has gone, anyone seated may start.
select tests.age_tables(:A);
select tests.as_user(:A);
select public.create_table('poker_holdem', 'low', true, null, true);
select public.pk_bring_chips((tests.tbl(:A)).id, 1000);
select tests.as_user(:B);
select public.join_by_code((tests.tbl(:A)).invite_code);
select public.pk_bring_chips((tests.tbl(:A)).id, 1000);
select public.pk_advance((tests.tbl(:A)).id);
select tests.ok(public.pk_state((tests.tbl(:A)).id) -> 'hand' = 'null'::jsonb, 'two players with chips, but no hand in the waiting room');
select tests.as_user(:A);
select public.leave_table((tests.tbl(:A)).id);
select tests.as_user(:C);
select public.join_by_code((tests.tbl(:A)).invite_code);
select public.pk_bring_chips((tests.tbl(:A)).id, 1000);
select tests.as_user(:B);
select public.table_start((tests.tbl(:A)).id);
select tests.ok(public.pk_state((tests.tbl(:A)).id) #>> '{hand,phase}' = 'betting', 'with the host gone, a seated player starts it and the cards are dealt');
select public.leave_table((tests.tbl(:A)).id);
select tests.as_user(:C);
select public.leave_table((tests.tbl(:A)).id);
select tests.age_tables(:A);
select tests.as_user(:A);
select public.create_table('blackjack', 'low', false, null, true);
select tests.ok(not (tests.tbl(:A)).waiting, 'a public table never has a waiting room');
select public.leave_table((tests.tbl(:A)).id);

-- ----------------------------------------------------------------------------
-- Direct messages: friends only
-- ----------------------------------------------------------------------------
select tests.throws(format('select public.chat_send(%L, %L)', 'dm:' || :B::text, 'hi'), 'action_not_allowed');
select public.friend_request('SocBen');
select tests.throws(format('select public.chat_send(%L, %L)', 'dm:' || :B::text, 'hi'), 'action_not_allowed');
select tests.as_user(:B);
select public.friend_respond(:A, true);
select tests.as_user(:A);
select tests.ok(public.chat_send('dm:' || :B::text, 'hello Ben') #>> '{message,body}' = 'hello Ben', 'friends can message each other');
select tests.throws(format('select public.chat_send(%L, %L)', 'dm:' || :A::text, 'me'), 'action_not_allowed');
select tests.ok(public.dm_threads() @> '{"unread":0}' and public.dm_threads() #>> '{threads,0,username}' = 'SocBen' and (public.dm_threads() #>> '{threads,0,mine}')::boolean,
                'the sender sees the conversation, with nothing unread');
select tests.as_user(:B);
select tests.ok(public.dm_threads() @> '{"unread":1}' and public.dm_threads() #>> '{threads,0,last}' = 'hello Ben', 'the friend has one unread message');
select tests.ok(public.chat_fetch('dm:' || :A::text) #>> '{messages,0,body}' = 'hello Ben' and (public.chat_fetch('dm:' || :A::text) ->> 'can_write')::boolean, 'and reads it');
select tests.ok(public.dm_threads() @> '{"unread":0}', 'reading it clears the count');
reset role;
select tests.ok((select count(distinct channel) = 1 and bool_and(channel ~ '^dm:[0-9a-f]{32}$') from public.chat_messages where channel like 'dm:%'), 'both sides share one stored conversation');
update public.player_reputation set last_message_at = null;
set role authenticated;
select tests.as_user(:B);
select tests.ok(public.chat_send('dm:' || :A::text, 'oh shit, hi') @> '{"caught":"swear","warned":true}', 'the filter and reputation apply in direct messages too');
select tests.as_user(:C);
select tests.throws(format('select public.chat_fetch(%L)', 'dm:' || :A::text), 'action_not_allowed');
select tests.ok(public.dm_threads() @> '{"unread":0,"threads":[]}', 'nobody else can read or even see the conversation');
select tests.throws($$select public.chat_report((select max(id) from generate_series(1, 1) g, lateral (select 0 as id) z))$$, 'action_not_allowed');
select tests.as_user(:A);
select public.chat_report((select (m ->> 'id')::bigint from jsonb_array_elements(public.chat_fetch('dm:' || :B::text) -> 'messages') m where m ->> 'body' like 'oh ****%'));
reset role;
select tests.ok((select context @> '{"chat":true,"raw":"oh shit, hi"}' and context ->> 'channel' like 'dm:%' from public.player_reports where reporter = :A), 'a direct message can be reported');
-- Clean direct messages do not earn reputation.
do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000f4a01', false);
  for i in 1..30 loop
    update public.player_reputation set last_message_at = null where user_id = '00000000-0000-0000-0000-0000000f4a01';
    update public.chat_messages set created_at = created_at - interval '5 minutes' where user_id = '00000000-0000-0000-0000-0000000f4a01';
    perform public.chat_send('dm:00000000-0000-0000-0000-0000000f4b02', 'a clean direct message ' || i);
  end loop;
end $$;
select tests.ok(private.reputation_of(:A) = 50, 'direct messages do not earn reputation');
-- Blocking ends it (a block also ends the friendship).
set role authenticated;
select tests.as_user(:B);
select public.block_player(:A);
select tests.as_user(:A);
select tests.throws(format('select public.chat_send(%L, %L)', 'dm:' || :B::text, 'still there?'), 'action_not_allowed');
select tests.as_user(:B);
select public.unblock_player(:A);
select public.friend_request('SocAnn');
select tests.as_user(:A);
select public.friend_respond(:B, true);

-- ----------------------------------------------------------------------------
-- What friends are playing, and watching
-- ----------------------------------------------------------------------------
select tests.ok(public.friends_activity() @> '{"watchable":true,"playing":{}}', 'nobody is playing yet; watching is on by default');
select tests.as_user(:B);
select public.set_activity('slots_classic');
select public.set_activity('not_a_game');
select tests.ok(public.friends_activity() -> 'playing' = '{}'::jsonb, '(an unknown game is not recorded)');
select public.set_activity('slots_classic');
select tests.as_user(:A);
select tests.ok(public.friends_activity() #>> array['playing', :B::text, 'game'] = 'Lucky Sevens', 'a friend sees what you have open');
select tests.as_user(:C);
select tests.ok(public.friends_activity() -> 'playing' = '{}'::jsonb, 'someone who is not a friend does not');
select tests.throws(format('select public.friend_watch(%L)', :B::text), 'action_not_allowed');
reset role;
select private.record_round(:B, 'slots_classic', null, gen_random_uuid(), 100, 250, '{"units": 250}');
select private.record_round(:B, 'baccarat', null, gen_random_uuid(), 100, 0, '{}');
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.friend_watch(:B) @> '{"game_key":"slots_classic","game":"Lucky Sevens","username":"SocBen"}'
            and jsonb_array_length(public.friend_watch(:B) -> 'rounds') = 1 and (public.friend_watch(:B) #>> '{rounds,0,returned}')::int = 250
            and public.friend_watch(:B) -> 'table' = 'null'::jsonb, 'watching shows their rounds at that game only');
select tests.as_user(:B);
select public.join_table((select id from public.game_tables where game_key = 'blackjack' and tier = 'low' and persistent limit 1), null);
select tests.as_user(:A);
select tests.ok(public.friend_watch(:B) #>> '{table,game_key}' = 'blackjack' and public.friend_watch(:B) #>> '{table,id}' is not null, 'and a public table they are seated at, to go and watch or join');
select tests.as_user(:B);
select public.leave_table((select id from public.game_tables where game_key = 'blackjack' and tier = 'low' and persistent limit 1));
select public.set_watchable(false);
select tests.ok(public.friends_activity() @> '{"watchable":false}', 'watching can be switched off');
select tests.as_user(:A);
select tests.ok(public.friends_activity() -> 'playing' = '{}'::jsonb, 'then friends see nothing');
select tests.throws(format('select public.friend_watch(%L)', :B::text), 'action_not_allowed');
select tests.as_user(:B);
select public.set_watchable(true);
select tests.stale_activity(:B);
select tests.as_user(:A);
select tests.ok(public.friends_activity() -> 'playing' = '{}'::jsonb and public.friend_watch(:B) -> 'game_key' = 'null'::jsonb, 'a game left open and forgotten stops counting after a minute or two');
select tests.as_user(:B);
select public.set_activity('slots_classic');
select public.set_activity(null);
select tests.as_user(:A);
select tests.ok(public.friends_activity() -> 'playing' = '{}'::jsonb, 'closing the game clears it');
select tests.throws($$select * from public.player_activity$$, 'permission denied');
select tests.throws($$select * from public.dm_reads$$, 'permission denied');

reset role;
delete from public.chat_messages;
delete from public.game_tables where created_by in (:A, :B, :C);
delete from auth.users where email like '%@soc.test';

-- Phase 11 tests: reputation, the chat filter, typed chat and what the admin can do.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000f3a01'''
\set B '''00000000-0000-0000-0000-0000000f3b02'''
\set C '''00000000-0000-0000-0000-0000000f3c03'''
\set D '''00000000-0000-0000-0000-0000000f3d04'''

create or replace function tests.rep(p_user uuid) returns integer language sql security definer as $$
  select private.reputation_of(p_user)
$$;
-- Lets the next message through the 3-second gap and out of the spam windows.
create or replace function tests.ungap(p_user uuid) returns void language sql security definer as $$
  update public.player_reputation set last_message_at = null where user_id = p_user;
  update public.chat_messages set created_at = created_at - interval '5 minutes' where user_id = p_user and created_at > now() - interval '1 hour';
$$;
create or replace function tests.rep_set(p_user uuid, p_score integer) returns void language sql security definer as $$
  insert into public.player_reputation (user_id, score) values (p_user, p_score) on conflict (user_id) do update set score = p_score, recover_day = null;
$$;
create or replace function tests.said(p_user uuid) returns jsonb language sql security definer as $$
  select to_jsonb(m) from public.chat_messages m where user_id = p_user order by id desc limit 1
$$;
create or replace function tests.title(p_user uuid) returns text language sql security definer as $$
  select title from public.player_loadouts where user_id = p_user
$$;
create or replace function tests.has(p_user uuid, p_key text) returns boolean language sql security definer as $$
  select exists (select 1 from public.player_achievements where user_id = p_user and achievement_key = p_key)
$$;
create or replace function tests.bj_table() returns uuid language sql security definer as $$
  select id from public.game_tables where game_key = 'blackjack' and tier = 'low' and persistent limit 1
$$;
create or replace function tests.last_reason(p_user uuid) returns text language sql security definer as $$
  select reason from public.reputation_log where user_id = p_user order by id desc limit 1
$$;
create or replace function tests.report_of(p_user uuid) returns bigint language sql security definer as $$
  select id from public.player_reports where reporter = p_user order by id desc limit 1
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from auth.users where email like '%@rep.test';
delete from public.chat_messages;
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@rep.test', '{"username":"RepBoss"}'), (:B, 'b@rep.test', '{"username":"RepBen"}'),
  (:C, 'c@rep.test', '{"username":"RepCat"}'), (:D, 'd@rep.test', '{"username":"RepDee"}');
insert into public.admins (user_id) values (:A) on conflict do nothing;

-- ----------------------------------------------------------------------------
-- The filter
-- ----------------------------------------------------------------------------
select tests.ok((select body = 'what the ****' and reason = 'swear' from private.chat_filter('what the fuck')), 'a swear word is starred out');
select tests.ok((select body = 'no ******* way, ****' and reason = 'swear' from private.chat_filter('no fucking way, SHIT')), 'endings and capitals too');
select tests.ok((select body = '**** happens' and reason = 'swear' from private.chat_filter('sh1t happens')), 'numbers for letters do not get round it');
select tests.ok((select body = 'A class act from Scunthorpe, I assume' and reason is null from private.chat_filter('A class act from Scunthorpe, I assume')),
                'rude letters inside ordinary words are left alone');
select tests.ok((select reason is null from private.chat_filter('nice hand, well played! add me as a friend')), 'ordinary talk is clean');
select tests.ok((select reason = 'promo' from private.chat_filter('come to www.example.com')) and (select reason = 'promo' from private.chat_filter('best chips at chipz.gg'))
            and (select reason = 'promo' from private.chat_filter('follow me on twitch')) and (select reason = 'promo' from private.chat_filter('check my channel out'))
            and (select reason = 'promo' from private.chat_filter('mail me at someone@example.org')), 'links, addresses and plugs are advertising');

-- ----------------------------------------------------------------------------
-- Starting out, and who may talk where
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:B);
select tests.ok(public.my_reputation() @> '{"score":50,"can_chat":true,"can_quick":true,"clean_count":0}', 'everyone starts at 50 and may chat');
select tests.ok(public.chat_send('room:crash', '  hello   there  ') #>> '{message,body}' = 'hello there', 'a message is tidied and delivered');
select tests.throws($$select public.chat_send('room:crash', 'again')$$, 'slow_down');
select tests.ungap(:B);
select tests.throws($$select public.chat_send('room:crash', '   ')$$, 'action_not_allowed');
select tests.throws($$select public.chat_send('room:lounge', 'hi')$$, 'action_not_allowed');
select tests.throws(format('select public.chat_send(%L, %L)', 'table:' || tests.bj_table(), 'hi'), 'action_not_allowed');
select tests.throws($$select * from public.chat_messages$$, 'permission denied');
select tests.ok((select count(*) from public.player_reputation) = 1, 'you can read your own standing and nobody else''s');
select tests.as_user(:C);
select tests.ok(jsonb_array_length(public.chat_fetch('room:crash') -> 'messages') = 1 and public.chat_fetch('room:crash') #>> '{messages,0,username}' = 'RepBen', 'others in the room read it');
select tests.ok(jsonb_array_length(public.chat_fetch('room:crash', (public.chat_fetch('room:crash') #>> '{messages,0,id}')::bigint) -> 'messages') = 0, 'asking for what is new returns nothing twice');
select tests.ok(jsonb_array_length(public.chat_fetch('room:bingo') -> 'messages') = 0, 'each room has its own chat');

-- A table: only seated players write; a club: only members read or write.
select tests.as_user(:D);
select public.join_table(tests.bj_table(), null);
select tests.ok(public.chat_send('table:' || tests.bj_table(), 'good luck all') ? 'message', 'a seated player can chat at the table');
select tests.as_user(:C);
select tests.ok(jsonb_array_length(public.chat_fetch('table:' || tests.bj_table()) -> 'messages') = 1 and not (public.chat_fetch('table:' || tests.bj_table()) ->> 'can_write')::boolean,
                'a watcher can read the table but not write');
select tests.as_user(:D);
select public.leave_table(tests.bj_table());
select tests.ungap(:D);
select tests.throws(format('select public.chat_send(%L, %L)', 'table:' || tests.bj_table(), 'still here?'), 'action_not_allowed');
select public.club_create('Rep Testers', 'REPT');
select tests.ok(public.chat_send('club:' || (select club_id from public.club_members where user_id = auth.uid()), 'welcome to the club') ? 'message', 'a member chats in the club');
reset role;
select tests.ok(tests.said(:D) ->> 'channel' like 'club:%', '(stored under the club''s channel)');
set role authenticated;
select tests.as_user(:C);
select tests.throws(format('select public.chat_fetch(%L)', tests.said(:D) ->> 'channel'), 'action_not_allowed');

-- ----------------------------------------------------------------------------
-- The filter in use: one warning a day, then 25 points each time
-- ----------------------------------------------------------------------------
select tests.as_user(:B);
select tests.ok(public.chat_send('room:crash', 'well shit') @> '{"caught":"swear","warned":true,"reputation":50,"can_chat":true}'
            and tests.said(:B) ->> 'body' = 'well ****' and tests.said(:B) ->> 'raw' = 'well shit', 'the first catch of the day is only a warning; others see stars');
select tests.ok(tests.last_reason(:B) = 'chat_warning' and public.my_reputation() #>> '{log,0,note}' = 'swear', 'the warning is on your record');
select tests.ungap(:B);
select tests.ok(public.chat_send('room:crash', 'oh fuck off') @> '{"caught":"swear","penalty":25,"reputation":25,"can_chat":false}', 'the second costs 25, and at 30 or less typed chat is gone');
select tests.ungap(:B);
select tests.throws($$select public.chat_send('room:crash', 'sorry')$$, 'chat_banned');
select tests.ok(public.my_reputation() @> '{"score":25,"can_chat":false,"can_quick":true}', 'quick chat still works at 25');
reset role;
select tests.ok(exists (select 1 from public.notifications where user_id = :B and kind = 'reputation' and (data ->> 'delta')::int = -25), 'and the player is told');

-- Advertising and spam are not delivered at all.
set role authenticated;
select tests.as_user(:C);
select tests.ok(public.chat_send('room:crash', 'free chips at chipz.gg') @> '{"caught":"promo","warned":true}', 'advertising is stopped (a warning the first time)');
select tests.ok(not exists (select 1 from jsonb_array_elements(public.chat_fetch('room:crash') -> 'messages') m where m ->> 'body' like '%chipz%'), 'nobody is shown it');
reset role;
update public.player_reputation set last_message_at = null where user_id = :C;
set role authenticated;
select tests.ok(public.chat_send('room:bingo', 'hi all') ? 'message', 'an ordinary message afterwards is fine');
reset role;
update public.player_reputation set last_message_at = null where user_id = :C;
set role authenticated;
select tests.ok(public.chat_send('room:bingo', 'hi all') ? 'message', 'saying something twice is fine');
reset role;
update public.player_reputation set last_message_at = null where user_id = :C;
set role authenticated;
select tests.ok(public.chat_send('room:bingo', 'hi all') @> '{"caught":"spam","penalty":25,"reputation":25}' and (tests.said(:C) ->> 'hidden')::boolean, 'a third time in two minutes is spam');
reset role;
select tests.ok(tests.rep(:C) = 25, 'Cat is at 25 too');

-- ----------------------------------------------------------------------------
-- Getting it back: 2 a day for playing while under 50, 1 per 25 clean messages above
-- ----------------------------------------------------------------------------
select private.record_round(:B, 'blackjack', null, gen_random_uuid(), 100, 0, '{}');
select tests.ok(tests.rep(:B) = 27 and tests.last_reason(:B) = 'recovery', 'a round played brings 2 back');
select private.record_round(:B, 'blackjack', null, gen_random_uuid(), 100, 0, '{}');
select tests.ok(tests.rep(:B) = 27, 'once a day');
select tests.rep_set(:B, 49);
select private.record_round(:B, 'blackjack', null, gen_random_uuid(), 100, 0, '{}');
select tests.ok(tests.rep(:B) = 50, 'and never past 50');
select tests.rep_set(:B, 50);
select private.record_round(:B, 'blackjack', null, gen_random_uuid(), 100, 0, '{}');
select tests.ok(tests.rep(:B) = 50, 'at 50 or more, playing does not add any');

do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000f3d04', false);
  for i in 1..25 loop
    perform tests.ungap('00000000-0000-0000-0000-0000000f3d04');
    perform public.chat_send('room:horse_racing', 'clean message number ' || i);
  end loop;
end $$;
select tests.ok(tests.rep(:D) = 51 and tests.last_reason(:D) = 'chat_clean', '25 clean messages earn a point');
do $$
begin
  for i in 1..25 loop
    perform tests.ungap('00000000-0000-0000-0000-0000000f3d04');
    perform public.chat_send('room:horse_racing', 'ok');
  end loop;
end $$;
select tests.ok(tests.rep(:D) = 51, 'very short messages and repeats do not count');
do $$
begin
  for i in 1..100 loop
    perform tests.ungap('00000000-0000-0000-0000-0000000f3d04');
    perform public.chat_send('room:horse_racing', 'another clean message ' || i);
  end loop;
end $$;
select tests.ok(tests.rep(:D) = 53, 'at most 3 points a day');
select tests.ok(not exists (select 1 from public.notifications where user_id = :D and kind = 'reputation'), 'small gains are not announced');

-- ----------------------------------------------------------------------------
-- Blocking, reporting a message, old messages
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:C);
select tests.ok(jsonb_array_length(public.chat_fetch('room:horse_racing') -> 'messages') = 50, 'the newest 50 are shown');
select public.block_player(:D);
select tests.ok(jsonb_array_length(public.chat_fetch('room:horse_racing') -> 'messages') = 0, 'a blocked player''s messages are not shown to you');
select public.unblock_player(:D);
select tests.as_user(:D);
select public.chat_report((select (m ->> 'id')::bigint from jsonb_array_elements(public.chat_fetch('room:crash') -> 'messages') m where m ->> 'body' = 'oh **** off'));
select tests.throws($$select public.chat_report((select (m ->> 'id')::bigint from jsonb_array_elements(public.chat_fetch('room:crash') -> 'messages') m where m ->> 'body' = 'oh **** off'))$$, 'action_not_allowed');
select tests.throws($$select public.chat_report((select (m ->> 'id')::bigint from jsonb_array_elements(public.chat_fetch('room:horse_racing') -> 'messages') m limit 1))$$, 'action_not_allowed');
reset role;
select tests.ok((select reported = :B and reporter = :D and context @> '{"chat":true,"body":"oh **** off","raw":"oh fuck off","channel":"room:crash"}'
                   from public.player_reports where reporter = :D), 'the report carries the message as it was typed');
update public.chat_messages set created_at = now() - interval '4 days' where user_id = :B;
select tests.ungap(:D);
set role authenticated;
select public.chat_send('room:crash', 'anyone here?');
reset role;
select tests.ok(not exists (select 1 from public.chat_messages where user_id = :B), 'messages older than 3 days are deleted');
select tests.ok((select context ->> 'raw' = 'oh fuck off' from public.player_reports where reporter = :D), 'the reported one lives on in the report');

-- ----------------------------------------------------------------------------
-- The admin
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:B);
select tests.throws($$select public.admin_reputation('00000000-0000-0000-0000-0000000f3d04', 'set', 100)$$, 'not_admin');
select tests.throws($$select public.admin_chat_ban('00000000-0000-0000-0000-0000000f3d04', 'chat', 60)$$, 'not_admin');
select tests.throws($$select public.admin_warn('00000000-0000-0000-0000-0000000f3d04')$$, 'not_admin');
select tests.throws($$select public.admin_report_false(1)$$, 'not_admin');
select tests.throws($$select public.admin_reputation_view('00000000-0000-0000-0000-0000000f3d04')$$, 'not_admin');
select tests.as_user(:A);
select tests.ok(public.admin_reputation_view(:D) @> '{"score":53,"can_chat":true}' and jsonb_array_length(public.admin_reputation_view(:D) -> 'messages') = 40, 'the admin sees a player''s standing and what they typed');
-- A likely false report: the reporter loses 10.
select public.admin_report_false(tests.report_of(:D));
select tests.ok(tests.rep(:D) = 43 and tests.last_reason(:D) = 'false_report', 'a false report costs the reporter 10');
select tests.throws(format('select public.admin_report_false(%s)', tests.report_of(:D)), 'action_not_allowed');
-- A warning with nothing else: 25.
select tests.ok(public.admin_warn(:D, 'Keep it friendly') = 18 and tests.last_reason(:D) = 'warning', 'a warning costs 25');
select tests.as_user(:D);
select tests.ok(public.my_reputation() @> '{"score":18,"can_chat":false,"can_quick":false}', 'at 20 or less quick chat goes too');
select tests.ok((public.loadouts_for(array[:D]::uuid[]) -> (:D)::text ->> 'quick_muted')::boolean and not (public.loadouts_for(array[:B]::uuid[]) -> (:B)::text ->> 'quick_muted')::boolean,
                'other browsers are told to drop a muted player''s quick chat');

-- Changing it by hand, and the cosmetics that depend on it.
select tests.as_user(:A);
select tests.ok(public.admin_reputation(:D, 'set', 80, 'testing') = 80, 'the admin can set a reputation');
select tests.throws($$select public.admin_reputation('00000000-0000-0000-0000-0000000f3d04', 'set', 101)$$, 'action_not_allowed');
select tests.as_user(:D);
select tests.ok(public.my_progress() -> 'owned' @> '["title_well_mannered","frame_good_standing"]' and not public.my_progress() -> 'owned' @> '["title_pillar"]'
            and tests.has(:D, 'rep_75') and not tests.has(:D, 'rep_100'), 'at 75 or more: two cosmetics and In Good Standing');
select public.equip_cosmetic('title_well_mannered');
select tests.throws($$select public.equip_cosmetic('title_pillar')$$, 'cosmetic_locked');
select tests.as_user(:A);
select tests.ok(public.admin_reputation(:D, 'add', -10) = 70, 'the admin can take some away');
select tests.as_user(:D);
select tests.ok(tests.title(:D) = 'title_newcomer' and not public.my_progress() -> 'owned' @> '["title_well_mannered"]' and tests.has(:D, 'rep_75'),
                'below 75 the title is taken off and no longer owned; the achievement stays');
select tests.throws($$select public.equip_cosmetic('title_well_mannered')$$, 'cosmetic_locked');
select tests.as_user(:A);
select public.admin_reputation(:D, 'set', 100);
select tests.as_user(:D);
select tests.ok(public.my_progress() -> 'owned' @> '["title_pillar","avatar_dove","frame_exemplary","title_well_mannered"]' and tests.has(:D, 'rep_100'), 'at 100: everything, and Model Citizen');
select public.equip_cosmetic('title_pillar');
select public.equip_cosmetic('avatar_dove');
-- One granted by hand (as the special cosmetics script does) is kept whatever happens.
reset role;
insert into public.player_cosmetics (user_id, cosmetic_key) values (:D, 'title_pillar') on conflict do nothing;
set role authenticated;
select tests.as_user(:A);
select public.admin_reputation(:D, 'set', 60);
select tests.ok(tests.title(:D) = 'title_pillar' and (select avatar from public.player_loadouts where user_id = :D) = 'avatar_initial', 'a cosmetic given by hand stays on; the earned one comes off');

-- Chat bans whatever the reputation.
select public.admin_chat_ban(:D, 'chat', 60);
select tests.as_user(:D);
select tests.ok(public.my_reputation() @> '{"score":60,"can_chat":false,"can_quick":true}' and public.my_reputation() ->> 'chat_banned_until' is not null, 'a typed-chat ban for an hour');
select tests.throws($$select public.chat_send('room:crash', 'hello?')$$, 'chat_banned');
select tests.as_user(:A);
select public.admin_chat_ban(:D, 'chat', 0);
select public.admin_chat_ban(:D, 'quick');
select tests.as_user(:D);
select tests.ok(public.my_reputation() @> '{"can_chat":true,"can_quick":false}', 'lifted; and a quick-chat ban until further notice');
select tests.as_user(:A);
select public.admin_chat_ban(:D, 'quick', 0);

-- What a moderator's other actions cost.
select public.admin_reputation(:C, 'set', 100);
select public.admin_timeout(:C, 60, 'x');
select tests.ok(tests.rep(:C) = 50 and tests.last_reason(:C) = 'timeout_short', 'a timeout of an hour: 50');
select public.admin_reputation(:C, 'set', 100);
select public.admin_timeout(:C, 1440, 'x');
select tests.ok(tests.rep(:C) = 25 and tests.last_reason(:C) = 'timeout_day', 'a day: 75');
select public.admin_reputation(:C, 'set', 100);
select public.admin_timeout(:C, 10080, 'x');
select tests.ok(tests.rep(:C) = 0 and tests.last_reason(:C) = 'timeout_long', 'a week or more: all of it');
select public.admin_timeout(:C, 0);
select tests.ok(tests.rep(:C) = 0, 'ending a timeout gives nothing back');
select public.admin_reputation(:C, 'set', 100);
select public.admin_rename(:C);
select tests.ok(tests.rep(:C) = 50 and tests.last_reason(:C) = 'rename', 'a forced change of name: 50');
select public.admin_reputation(:C, 'set', 100);
select public.admin_ban(:C, 'x');
select tests.ok(tests.rep(:C) = 0 and tests.last_reason(:C) = 'ban', 'a ban: all of it');
select public.admin_unban(:C);
reset role;
select tests.ok((select count(*) from public.admin_log where action in ('reputation', 'warn', 'chat_ban', 'chat_unban', 'report_false')) >= 5, 'every decision is in the admin log');
select tests.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'player_reputation')
            and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('chat_messages', 'reputation_log')), 'realtime: your standing, never the messages');

delete from public.chat_messages;
delete from public.clubs where name = 'Rep Testers';
delete from auth.users where email like '%@rep.test';

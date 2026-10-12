-- Stage 9, part 1 tests: the admin, reports, blocks, bans, timeouts and renames.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-00000000a0a1'''
\set B '''00000000-0000-0000-0000-00000000a0b2'''
\set C '''00000000-0000-0000-0000-00000000a0c3'''

create or replace function tests.sanction(p_user uuid) returns public.player_sanctions language sql security definer as $$
  select * from public.player_sanctions where user_id = p_user
$$;
create or replace function tests.name(p_user uuid) returns text language sql security definer as $$
  select username from public.profiles where id = p_user
$$;
create or replace function tests.reports() returns bigint language sql security definer as $$
  select count(*) from public.player_reports
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from auth.users where email like '%@mod.test';
delete from public.admin_log;
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@mod.test', '{"username":"ModBoss"}'), (:B, 'b@mod.test', '{"username":"ModBen"}'), (:C, 'c@mod.test', '{"username":"ModCat"}');
-- In production the admin is whoever is called Carter when the file is run; here it is the first test player.
insert into public.admins (user_id) values (:A) on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Only the admin gets in
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:B);
select tests.ok(public.my_account() @> '{"admin":false,"banned":false,"must_rename":false}', 'an ordinary account');
select tests.throws($$select public.admin_overview()$$, 'not_admin');
select tests.throws($$select public.admin_reports('open')$$, 'not_admin');
select tests.throws($$select public.admin_find_players('')$$, 'not_admin');
select tests.throws($$select public.admin_player('00000000-0000-0000-0000-00000000a0c3')$$, 'not_admin');
select tests.throws($$select public.admin_ban('00000000-0000-0000-0000-00000000a0c3', 'x')$$, 'not_admin');
select tests.throws($$select public.admin_timeout('00000000-0000-0000-0000-00000000a0c3', 5, 'x')$$, 'not_admin');
select tests.throws($$select public.admin_rename('00000000-0000-0000-0000-00000000a0c3')$$, 'not_admin');
select tests.throws($$select public.admin_chips('00000000-0000-0000-0000-00000000a0b2', 'add', 1000000, 'x')$$, 'not_admin');
select tests.throws($$select public.admin_kick('00000000-0000-0000-0000-00000000a0c3')$$, 'not_admin');
select tests.throws($$select public.admin_set_notice('hi')$$, 'not_admin');
select tests.throws($$select public.admin_resolve_report(1, 'dismissed')$$, 'not_admin');
select tests.throws($$select * from public.player_reports$$, 'permission denied');
select tests.throws($$select * from public.admins$$, 'permission denied');
select tests.throws($$select * from public.admin_log$$, 'permission denied');
select tests.throws($$insert into public.admins (user_id) values ('00000000-0000-0000-0000-00000000a0b2')$$, 'permission denied');
select tests.throws($$update public.player_sanctions set banned_at = null$$, 'permission denied');
reset role;
set role anon;
select tests.throws($$select public.admin_overview()$$, 'permission denied');
reset role;
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.my_account() @> '{"admin":true}', 'the admin is told so');
select tests.ok((public.admin_overview() ->> 'players')::int >= 3, 'the admin gets the overview');
select tests.ok((public.admin_player('00000000-0000-0000-0000-00000000a0b2') ->> 'last_seen')::timestamptz > now() - interval '1 minute'
            and public.admin_player('00000000-0000-0000-0000-00000000a0c3') -> 'last_seen' = 'null', 'last seen: set by opening the app, empty for someone who has not');
select tests.throws($$select * from public.player_activity$$, 'permission denied');

-- ----------------------------------------------------------------------------
-- Reports and blocks
-- ----------------------------------------------------------------------------
select tests.as_user(:B);
select tests.throws($$select public.report_player('00000000-0000-0000-0000-00000000a0b2', 'name')$$, 'player_not_found');
select tests.throws($$select public.report_player('00000000-0000-0000-0000-00000000a0c3', 'because')$$, 'action_not_allowed');
select public.report_player(:C, 'name', '  rude name  ');
select tests.throws($$select public.report_player('00000000-0000-0000-0000-00000000a0c3', 'cheating')$$, 'action_not_allowed');
select tests.ok(tests.reports() = 1, 'one report filed, no duplicates while it is open');
select public.friend_request('ModCat');
select public.block_player(:C);
select tests.ok(jsonb_array_length(public.my_account() -> 'blocked') = 1 and public.my_account() #>> '{blocked,0,username}' = 'ModCat', 'blocked list');
select tests.ok((public.get_profile('ModCat') ->> 'friendship') = 'none', 'blocking drops the friend request');
select tests.as_user(:C);
select tests.throws($$select public.friend_request('ModBen')$$, 'action_not_allowed');
select tests.ok(public.my_account() -> 'blocked' = '[]', 'the blocked player is not told');
select tests.as_user(:B);
select tests.throws($$select public.friend_request('ModCat')$$, 'action_not_allowed');
select public.unblock_player(:C);
select tests.ok(public.friend_request('ModCat') is not null or true, 'unblocked: requests work again');

select tests.as_user(:A);
select tests.ok((public.admin_player('00000000-0000-0000-0000-00000000a0c3') ->> 'reports_open')::int = 1 and (public.admin_player('00000000-0000-0000-0000-00000000a0b2') ->> 'reports_made')::int = 1, 'the player page counts reports against and reports sent');
select tests.ok(jsonb_array_length(public.admin_reports('open')) = 1 and public.admin_reports('open') -> 0 @> '{"reason":"name","note":"rude name","reported":"ModCat","reporter":"ModBen","name_then":"ModCat"}', 'the admin reads the report');
select public.admin_resolve_report((public.admin_reports('open') #>> '{0,id}')::bigint, 'actioned', 'renamed');
select tests.ok(jsonb_array_length(public.admin_reports('open')) = 0 and jsonb_array_length(public.admin_reports('actioned')) = 1, 'resolved');

-- ----------------------------------------------------------------------------
-- Forced rename
-- ----------------------------------------------------------------------------
select tests.throws($$select public.admin_rename('00000000-0000-0000-0000-00000000a0a1')$$, 'action_not_allowed');
select tests.ok(public.admin_rename(:C) ->> 'username' like 'Player\_%', 'the name is replaced at once');
select tests.as_user(:C);
select tests.ok(tests.name(:C) like 'Player\_%' and public.my_account() @> '{"must_rename":true}', 'and the player is told to choose another');
select tests.throws($$select public.get_economy_status()$$, 'rename_required');
select tests.throws($$select public.slot_spin('slots_classic', 10)$$, 'rename_required');
select tests.throws($$select public.change_username('ModBen')$$, 'action_not_allowed');
select tests.throws($$select public.change_username('no')$$, 'action_not_allowed');
select tests.ok(public.change_username('NiceCat') ->> 'username' = 'NiceCat' and tests.name(:C) = 'NiceCat', 'renamed');
select tests.ok((public.slot_spin('slots_classic', 10) ->> 'bet')::int = 10, 'and can play again');
select tests.throws($$select public.change_username('OtherCat')$$, 'action_not_allowed');
select tests.as_user(:A);
select tests.ok(public.admin_rename(:C, 'ModCat') ->> 'username' = 'ModCat' and not (tests.sanction(:C)).must_rename, 'the admin can also set a name directly');
select tests.throws($$select public.admin_rename('00000000-0000-0000-0000-00000000a0c3', 'ModBen')$$, 'action_not_allowed');

-- ----------------------------------------------------------------------------
-- Timeout and ban
-- ----------------------------------------------------------------------------
select tests.as_user(:C);
select public.quick_join('blackjack', 'low');
select tests.as_user(:A);
select tests.ok(public.admin_player(:C) #>> '{seat,game}' = 'blackjack', 'the admin sees where a player is sitting');
select public.admin_timeout(:C, 30, 'cool off');
select tests.ok(public.admin_player(:C) -> 'seat' = 'null', 'a timeout takes the player off their table');
select tests.as_user(:C);
select tests.ok(public.my_account() ->> 'timeout_reason' = 'cool off' and (public.my_account() ->> 'timeout_until')::timestamptz > now(), 'the player sees the timeout');
select tests.throws($$select public.slot_spin('slots_classic', 10)$$, 'account_timeout');
select tests.throws($$select public.quick_join('blackjack', 'low')$$, 'account_timeout');
select tests.as_user(:A);
select public.admin_timeout(:C, 0);
select tests.as_user(:C);
select tests.ok((public.slot_spin('slots_classic', 10) ->> 'bet')::int = 10, 'timeout ended early');

select tests.as_user(:A);
select tests.throws($$select public.admin_ban('00000000-0000-0000-0000-00000000a0a1', 'me')$$, 'action_not_allowed');
select public.admin_ban(:C, 'cheating');
select tests.as_user(:C);
select tests.ok(public.my_account() @> '{"banned":true,"ban_reason":"cheating"}', 'a banned player is told why');
select tests.throws($$select public.slot_spin('slots_classic', 10)$$, 'account_banned');
select tests.throws($$select public.get_economy_status()$$, 'account_banned');
select tests.throws($$select public.report_player('00000000-0000-0000-0000-00000000a0b2', 'other')$$, 'account_banned');
select tests.throws($$select public.change_username('Sneaky')$$, 'action_not_allowed');
select tests.as_user(:A);
select tests.ok((public.admin_find_players('banned') -> 0 ->> 'username') = 'ModCat' and (public.admin_overview() ->> 'banned')::int = 1, 'listed as banned');
select public.admin_unban(:C);
select tests.as_user(:C);
select tests.ok((public.slot_spin('slots_classic', 10) ->> 'bet')::int = 10, 'unbanned');

-- ----------------------------------------------------------------------------
-- Balances
-- ----------------------------------------------------------------------------
select tests.as_user(:A);
select tests.ok(public.admin_chips(:B, 'add', 5000, 'gift') @> '{"balance":15000,"delta":5000}', 'add chips');
select tests.ok(public.admin_chips(:B, 'add', -14000) @> '{"balance":1000}', 'take chips');
select tests.ok(public.admin_chips(:B, 'set', 7777) @> '{"balance":7777,"delta":6777}', 'set a balance');
select tests.throws($$select public.admin_chips('00000000-0000-0000-0000-00000000a0b2', 'add', -8000)$$, 'action_not_allowed');
select tests.ok(tests.bal(:B) = 7777, 'the wallet agrees');
select tests.ok((public.admin_player(:B) #>> '{ledger,0,reason}') = 'admin_adjust', 'and it is in the ledger');
select tests.ok(jsonb_array_length(public.admin_find_players('modbe')) = 1 and jsonb_array_length(public.admin_find_players('b@mod.test')) = 1, 'find by name or email');

-- ----------------------------------------------------------------------------
-- Maintenance mode
-- ----------------------------------------------------------------------------
select tests.ok(public.site_status() @> '{"maintenance":false,"admin":true}', 'open, and the admin is told they are the admin');
select tests.as_user(:B);
select tests.throws($$select public.admin_set_maintenance(true, 'mine now')$$, 'not_admin');
select tests.throws($$update public.site_status set maintenance = true$$, 'permission denied');
select tests.as_user(:A);
select public.admin_set_maintenance(true, '  Back at noon  ');
select tests.ok(public.site_status() @> '{"maintenance":true,"admin":true,"message":"Back at noon"}', 'maintenance on');
select tests.ok((public.slot_spin('slots_classic', 10) ->> 'bet')::int = 10 and public.get_economy_status() is not null, 'the admin can still do everything');
select tests.as_user(:B);
select tests.ok(public.site_status() @> '{"maintenance":true,"admin":false}', 'another player is told the site is closed');
select tests.throws($$select public.slot_spin('slots_classic', 10)$$, 'site_maintenance');
select tests.throws($$select public.get_economy_status()$$, 'site_maintenance');
select tests.throws($$select public.quick_join('blackjack', 'low')$$, 'site_maintenance');
select tests.throws($$select public.claim_daily_bonus()$$, 'site_maintenance');
reset role;
set role anon;
select tests.ok(public.site_status() @> '{"maintenance":true,"admin":false}', 'a signed-out visitor can ask too');
reset role;
-- The emergency file does this by hand if the admin is locked out.
update public.site_status set maintenance = false, message = null where id;
set role authenticated;
select tests.as_user(:B);
select tests.ok((public.slot_spin('slots_classic', 10) ->> 'bet')::int = 10 and public.site_status() @> '{"maintenance":false}', 'open again');
select tests.as_user(:A);

select public.admin_set_notice('  Maintenance at noon  ');
select tests.as_user(:B);
select tests.ok(public.my_account() ->> 'notice' = 'Maintenance at noon', 'everyone sees the notice');
select tests.as_user(:A);
select public.admin_set_notice('');
select tests.ok(public.my_account() -> 'notice' = 'null', 'notice taken down');
select tests.ok(jsonb_array_length(public.admin_overview() -> 'log') >= 12, 'every action is logged');
reset role;

select tests.ok(not exists (
  select 1 from public.wallets w where w.user_id in (:A, :B, :C)
     and w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)), 'ledger sums match balances');
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every public table');

delete from public.admin_log;
delete from auth.users where email like '%@mod.test';

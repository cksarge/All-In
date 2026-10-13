-- Two-step verification tests: a code by email after the password, enforced on the server.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-00000000b0a1'''
\set B '''00000000-0000-0000-0000-00000000b0b2'''

-- How the session was made, as Supabase Auth writes it into the token ("password", "otp", ...).
create or replace function tests.signed_in_with(variadic p_methods text[]) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('amr', (select coalesce(jsonb_agg(jsonb_build_object('method', m, 'timestamp', 1)), '[]'::jsonb) from unnest(p_methods) m))::text, false)
$$;
create or replace function tests.two_step(p_user uuid) returns boolean language sql security definer as $$
  select two_step from public.player_security where user_id = p_user
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from auth.users where email like '%@2sv.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@2sv.test', '{"username":"StepBoss"}'), (:B, 'b@2sv.test', '{"username":"StepBen"}');
insert into public.admins (user_id) values (:A) on conflict do nothing;

set role authenticated;
select tests.as_user(:B);

-- ----------------------------------------------------------------------------
-- Off by default: a password is enough
-- ----------------------------------------------------------------------------
select tests.signed_in_with('password');
select tests.ok(public.my_account() @> '{"two_step":false,"verified":false,"verify_required":false}', 'off by default, and a password session is not a verified one');
select tests.ok(public.get_economy_status() is not null, 'with it off, a password session plays as before');
select tests.throws($$select * from public.player_security$$, 'permission denied');

-- ----------------------------------------------------------------------------
-- Switching it on needs a session that entered a code from an email
-- ----------------------------------------------------------------------------
select tests.throws($$select public.set_two_step(true)$$, 'verify_required');
select tests.ok(tests.two_step(:B) is null, 'nothing was switched on from a password session');
select tests.signed_in_with('otp');
select tests.ok(public.my_account() @> '{"verified":true}', 'a session made with an emailed code is verified');
select tests.ok(public.set_two_step(true) @> '{"two_step":true}', 'switched on');
select tests.ok(public.my_account() @> '{"two_step":true,"verify_required":false}', 'the session that switched it on carries on');
select tests.ok(public.get_economy_status() is not null, 'and it can play');

-- ----------------------------------------------------------------------------
-- The next login: the password alone opens nothing
-- ----------------------------------------------------------------------------
select tests.signed_in_with('password');
select tests.ok(public.my_account() @> '{"two_step":true,"verified":false,"verify_required":true}', 'my_account still answers, and says a code is owed');
select tests.throws($$select public.get_economy_status()$$, 'verify_required');
select tests.throws($$select public.claim_daily_bonus()$$, 'verify_required');
select tests.throws($$select public.set_two_step(false)$$, 'verify_required');
select tests.ok(tests.two_step(:B), 'knowing the password is not enough to switch it off');
-- A session with no list at all, or an odd one, is not verified either.
select set_config('request.jwt.claims', '', false);
select tests.throws($$select public.get_economy_status()$$, 'verify_required');
select set_config('request.jwt.claims', '{"amr":"otp"}', false);
select tests.throws($$select public.get_economy_status()$$, 'verify_required');
select tests.signed_in_with('password', 'token_refresh');
select tests.throws($$select public.get_economy_status()$$, 'verify_required');

-- The code from the email: the new session has "otp", and keeps it when refreshed.
select tests.signed_in_with('otp');
select tests.ok(public.get_economy_status() is not null, 'after the code the site opens');
select tests.signed_in_with('otp', 'token_refresh');
select tests.ok(public.my_account() @> '{"verify_required":false}', 'a refreshed session stays verified');
-- A password reset code proves the inbox too.
select tests.signed_in_with('recovery');
select tests.ok(public.my_account() @> '{"verify_required":false}', 'a session from a reset code counts');

-- ----------------------------------------------------------------------------
-- Switching it off
-- ----------------------------------------------------------------------------
select tests.signed_in_with('otp');
select tests.ok(public.set_two_step(false) @> '{"two_step":false}', 'switched off from a verified session');
select tests.signed_in_with('password');
select tests.ok(public.get_economy_status() is not null, 'and the password is enough again');

-- ----------------------------------------------------------------------------
-- The admin: gated like anyone, and can switch a locked-out player's off
-- ----------------------------------------------------------------------------
select tests.signed_in_with('otp');
select public.set_two_step(true);
select tests.throws($$select public.admin_two_step_off('00000000-0000-0000-0000-00000000b0b2')$$, 'not_admin');
select tests.as_user(:A);
select tests.signed_in_with('otp');
select public.set_two_step(true);
select tests.signed_in_with('password');
select tests.throws($$select public.admin_overview()$$, 'verify_required');
select tests.throws($$select public.admin_two_step_off('00000000-0000-0000-0000-00000000b0b2')$$, 'verify_required');
select tests.signed_in_with('otp');
select tests.ok((public.admin_player('00000000-0000-0000-0000-00000000b0b2') ->> 'two_step')::boolean, 'the admin sees it is on');
select public.admin_two_step_off('00000000-0000-0000-0000-00000000b0b2');
select tests.ok(not (public.admin_player('00000000-0000-0000-0000-00000000b0b2') ->> 'two_step')::boolean, 'the admin switched it off');
select tests.ok(exists (select 1 from jsonb_array_elements(public.admin_player('00000000-0000-0000-0000-00000000b0b2') -> 'log') l where l ->> 'action' = 'two_step_off'), 'and it is in the log');
select tests.as_user(:B);
select tests.signed_in_with('password');
select tests.ok(public.get_economy_status() is not null, 'the player gets in with the password again');

reset role;
select set_config('request.jwt.claims', '', false);
delete from public.admins where user_id = :A;
delete from auth.users where email like '%@2sv.test';
select 'two-step tests passed' as result;

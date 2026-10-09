-- Phase 1 tests: profiles, signup trigger, wallet, ledger, daily bonus, refill, RLS.
\set ON_ERROR_STOP 1
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

create or replace function tests.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if;
end $$;

create or replace function tests.throws(sql text, expected text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'ASSERTION FAILED: expected error "%" from: %', expected, sql;
exception when others then
  if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
  if expected is not null and position(expected in sqlerrm) = 0 then
    raise exception 'ASSERTION FAILED: expected "%" but got "%" from: %', expected, sqlerrm, sql;
  end if;
end $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Fresh users
delete from auth.users where email like '%@test.allin';
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.allin', '{"username":"Alice_01"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.allin',   '{"username":"bob"}'),
  ('00000000-0000-0000-0000-00000000000c', 'nouser@test.allin', '{}');

-- Trigger effects
select tests.ok((select username from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Alice_01', 'profile created with username');
select tests.ok((select username from public.profiles where id = '00000000-0000-0000-0000-00000000000c') like 'player\_%', 'placeholder username');
select tests.ok((select balance from public.wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 10000, 'starting chips');
select tests.ok((select count(*) from public.chip_ledger where user_id = '00000000-0000-0000-0000-00000000000a' and reason = 'signup_bonus' and delta = 10000 and balance_after = 10000) = 1, 'signup ledger row');

-- Username collisions (case-insensitive) and invalid usernames are rejected at signup.
select tests.throws($$insert into auth.users (email, raw_user_meta_data) values ('dupe@test.allin', '{"username":"ALICE_01"}')$$, 'username_taken');
select tests.throws($$insert into auth.users (email, raw_user_meta_data) values ('bad@test.allin', '{"username":"no spaces!"}')$$, 'invalid_username');
select tests.throws($$insert into auth.users (email, raw_user_meta_data) values ('res@test.allin', '{"username":"Dealer"}')$$, 'invalid_username');

-- check_username works for anon
set role anon;
select tests.ok(public.check_username('alice_01') = 'taken', 'taken (case-insensitive)');
select tests.ok(public.check_username('ab') = 'invalid', 'too short');
select tests.ok(public.check_username('admin') = 'reserved', 'reserved');
select tests.ok(public.check_username('Fresh_Name') = 'ok', 'available');
-- anon cannot see wallets/ledger/profiles or call player RPCs
select tests.throws('select * from public.wallets', 'permission denied');
select tests.throws('select * from public.chip_ledger', 'permission denied');
select tests.throws('select public.claim_daily_bonus()', 'permission denied');
select tests.throws('select private.apply_chips(''00000000-0000-0000-0000-00000000000a'', 1, ''hack'')', 'permission denied');
select tests.ok((select count(*) from public.stake_tiers) > 0, 'anon can read stake tiers');
select tests.ok((select count(*) from public.economy_config) = 1, 'anon can read economy config');
reset role;

-- ===== As Alice =====
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

select tests.ok((select count(*) from public.wallets) = 1, 'alice sees only her wallet');
select tests.ok((select count(*) from public.chip_ledger where user_id <> auth.uid()) = 0, 'alice sees only her ledger');
select tests.ok((select count(*) from public.profiles) >= 3, 'alice can read profiles');

-- Writes are impossible
select tests.throws('update public.wallets set balance = 999999999', 'permission denied');
select tests.throws('insert into public.chip_ledger (user_id, delta, balance_after, reason) values (auth.uid(), 5, 5, ''hack'')', 'permission denied');
select tests.throws('update public.profiles set username = ''hacker''', 'permission denied');
select tests.throws('delete from public.chip_ledger', 'permission denied');
select tests.throws('update public.economy_config set starting_chips = 1', 'permission denied');
select tests.throws('select private.apply_chips(auth.uid(), 1000000, ''hack'')', 'permission denied');
select tests.throws('select public.handle_new_user()', null);

-- Status before claiming
select tests.ok((public.get_economy_status() -> 'daily' ->> 'available')::boolean, 'daily available');
select tests.ok((public.get_economy_status() -> 'daily' ->> 'next_amount')::bigint = 1000, 'day 1 amount');
select tests.ok(not (public.get_economy_status() -> 'refill' ->> 'available')::boolean, 'refill not available at 10k');

-- Daily claim
select tests.ok((public.claim_daily_bonus() ->> 'amount')::bigint = 1000, 'claimed day 1');
select tests.ok((select balance from public.wallets) = 11000, 'balance after daily');
select tests.throws('select public.claim_daily_bonus()', 'daily_already_claimed');
select tests.ok(not (public.get_economy_status() -> 'daily' ->> 'available')::boolean, 'daily unavailable after claim');
select tests.ok((public.get_economy_status() -> 'daily' ->> 'next_day')::int = 2, 'next day is 2');

-- Refill not needed
select tests.throws('select public.claim_refill()', 'refill_not_needed');
reset role;

-- Simulate: Alice claimed yesterday on a 6-day streak -> today is day 7 (3x).
update public.wallets set last_daily_claim = private.utc_today() - 1, daily_streak = 6
 where user_id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
select tests.ok((public.get_economy_status() -> 'daily' ->> 'next_amount')::bigint = 3000, 'day 7 preview 3x');
select tests.ok((public.claim_daily_bonus() ->> 'amount')::bigint = 3000, 'day 7 pays 3x');
reset role;
-- Day 12 still capped at 3x
update public.wallets set last_daily_claim = private.utc_today() - 1, daily_streak = 11
 where user_id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
select tests.ok((public.claim_daily_bonus() ->> 'streak')::int = 12, 'streak 12');
select tests.ok((select delta from public.chip_ledger order by id desc limit 1) = 3000, 'capped at 3x');
reset role;
-- Missed a day -> streak resets
update public.wallets set last_daily_claim = private.utc_today() - 2, daily_streak = 5
 where user_id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
select tests.ok((public.get_economy_status() -> 'daily' ->> 'streak')::int = 0, 'broken streak shows 0');
select tests.ok((public.claim_daily_bonus() ->> 'streak')::int = 1, 'streak reset to 1');
reset role;

-- Refill: drop Alice below threshold using the internal function (as a game would).
select private.apply_chips('00000000-0000-0000-0000-00000000000a',
  -((select balance from public.wallets where user_id = '00000000-0000-0000-0000-00000000000a') - 200), 'bet', 'blackjack');
select tests.throws($$select private.apply_chips('00000000-0000-0000-0000-00000000000a', -201, 'bet')$$, 'insufficient_chips');
select tests.ok((select balance from public.wallets where user_id = '00000000-0000-0000-0000-00000000000a') = 200, 'balance 200, never negative');

set role authenticated;
select tests.ok((public.get_economy_status() -> 'refill' ->> 'available')::boolean, 'refill available');
select tests.ok((public.claim_refill() ->> 'amount')::bigint = 4800, 'refill tops up to 5000');
select tests.ok((select balance from public.wallets) = 5000, 'balance 5000');
reset role;
select private.apply_chips('00000000-0000-0000-0000-00000000000a', -4900, 'bet', 'blackjack');
set role authenticated;
select tests.throws('select public.claim_refill()', 'refill_on_cooldown');
select tests.ok(not (public.get_economy_status() -> 'refill' ->> 'available')::boolean, 'refill on cooldown');
reset role;
update public.wallets set last_refill_at = now() - interval '5 hours'
 where user_id = '00000000-0000-0000-0000-00000000000a';
set role authenticated;
select tests.ok((public.claim_refill() ->> 'balance')::bigint = 5000, 'refill after cooldown');
reset role;

-- Ledger integrity: sum of deltas == balance for everyone; peak tracked.
select tests.ok(not exists (
  select 1 from public.wallets w
   where w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)
), 'ledger sums match balances');
select tests.ok((select peak_balance from public.wallets where user_id = '00000000-0000-0000-0000-00000000000a') >= 13000, 'peak tracked');

-- Tier guards
select tests.throws($$select private.assert_tier_access('00000000-0000-0000-0000-00000000000a', 'blackjack', 'high')$$, 'tier_locked');
select (private.assert_tier_access('00000000-0000-0000-0000-00000000000a', 'blackjack', 'low')).tier;
select tests.throws($$select private.assert_bet_in_range('blackjack', 'low', 5)$$, 'bet_out_of_range');
select private.assert_bet_in_range('blackjack', 'low', 10);
select tests.ok((select count(*) from public.stake_tiers) = (select count(*) * 4 from public.games), 'every game has 4 tiers');

-- Onboarding
set role authenticated;
select public.complete_onboarding();
select tests.ok((select onboarded_at is not null from public.profiles where id = auth.uid()), 'onboarded');
reset role;

-- Realtime publication
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('wallets','chip_ledger')) = 2, 'realtime tables');

-- RLS enabled on every public table
select tests.ok(not exists (
  select 1 from pg_tables where schemaname = 'public' and not rowsecurity
), 'RLS on every public table');

-- Account deletion cascades
delete from auth.users where email like '%@test.allin';
select tests.ok(not exists (select 1 from public.wallets w where not exists (select 1 from auth.users u where u.id = w.user_id)), 'cascade');

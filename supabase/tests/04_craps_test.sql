-- Phase 3 tests: craps. Dice come from a queue (test database only).
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000000a1'''
\set B '''00000000-0000-0000-0000-0000000000b2'''
\set T '''00000000-0000-0000-0000-00000000dddd'''

create table if not exists tests.dice (id serial primary key, v integer);
create or replace function private.random_int(p_n integer) returns integer language plpgsql volatile set search_path = '' as $$
declare r record;
begin
  select id, v into r from tests.dice order by id limit 1;
  if found then delete from tests.dice where id = r.id; return r.v; end if;
  return floor(random() * p_n)::int;
end $$;
-- Queue a roll (face values 1..6) and allow the shooter to throw again right away.
create or replace function tests.roll_next(d1 int, d2 int) returns void language sql security definer as $$
  insert into tests.dice (v) values (d1 - 1), (d2 - 1);
  update public.cr_state set last_roll_at = now() - interval '10 seconds';
$$;
create or replace function tests.cr_point(p_table uuid) returns int language sql security definer as $$
  select point from public.cr_state where table_id = p_table
$$;
create or replace function tests.my_bet(p_table uuid, p_type text) returns uuid language sql security definer as $$
  select id from public.cr_bets where table_id = p_table and user_id = auth.uid() and bet_type = p_type and status = 'active' limit 1
$$;
grant execute on all functions in schema tests to anon, authenticated;
grant usage on schema tests to authenticated;
grant all on tests.dice to authenticated;
grant usage, select on all sequences in schema tests to authenticated;

delete from auth.users where email like '%@cr.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@cr.test', '{"username":"CrAnn"}'), (:B, 'b@cr.test', '{"username":"CrBen"}');
delete from public.game_tables where id = :T;
insert into public.game_tables (id, game_key, tier, name, max_seats) values (:T, 'craps', 'low', 'Test Craps', 8);

select tests.ok((select released from public.games where key = 'craps'), 'craps released');
set role authenticated;
select tests.as_user(:A);
select public.join_table(:T, 1);
select tests.as_user(:B);
select public.join_table(:T, 2);

-- ===== Come-out: natural 7 =====
select tests.as_user(:A);
select public.cr_place_bet(:T, 'pass', null, 100);
select public.cr_place_bet(:T, 'field', null, 50);
select tests.throws($$select public.cr_place_bet('00000000-0000-0000-0000-00000000dddd', 'come', null, 100)$$, 'bet_not_allowed');
select tests.throws($$select public.cr_place_bet('00000000-0000-0000-0000-00000000dddd', 'place', 7, 100)$$, 'invalid_bet');
select tests.as_user(:B);
select public.cr_place_bet(:T, 'dont_pass', null, 100);
select tests.ok((public.cr_state(:T) -> 'state' ->> 'shooter_user')::uuid = :A, 'first seat shoots');
select tests.ok((public.cr_state(:T) -> 'state' ->> 'phase') = 'betting', 'roll timer running');
select tests.throws($$select public.cr_roll('00000000-0000-0000-0000-00000000dddd')$$, 'not_shooter');
select tests.as_user(:A);
select tests.roll_next(3, 4);
select public.cr_roll(:T);
select tests.ok(tests.bal(:A) = 10000 - 150 + 200, 'pass wins on a come-out 7; field loses');
select tests.ok(tests.bal(:B) = 9900, 'don''t pass loses on a come-out 7');
select tests.ok((public.cr_state(:T) -> 'recent' -> 0 ->> 'outcome') = 'natural', 'natural');
select tests.throws($$select public.cr_roll('00000000-0000-0000-0000-00000000dddd')$$, 'no_bets_down');

-- ===== Point 4, odds, place, hard, come =====
select public.cr_place_bet(:T, 'pass', null, 100);
select tests.as_user(:B);
select public.cr_place_bet(:T, 'dont_pass', null, 100);
select tests.as_user(:A);
select tests.throws($$select public.cr_roll('00000000-0000-0000-0000-00000000dddd')$$, 'roll_too_soon');
select tests.roll_next(2, 2);
select public.cr_roll(:T);
select tests.ok(tests.cr_point(:T) = 4, 'point set to 4');
select tests.throws($$select public.cr_place_bet('00000000-0000-0000-0000-00000000dddd', 'pass', null, 100)$$, 'bet_not_allowed');
select tests.throws($$select public.cr_add_odds('00000000-0000-0000-0000-00000000dddd', tests.my_bet('00000000-0000-0000-0000-00000000dddd', 'pass'), 301)$$, 'bet_out_of_range');
select public.cr_add_odds(:T, tests.my_bet(:T, 'pass'), 300);
select public.cr_place_bet(:T, 'place', 6, 60);
select public.cr_place_bet(:T, 'hard', 8, 10);
select tests.ok(tests.bal(:A) = 10050 - 100 - 300 - 60 - 10, 'odds, place 6 and hard 8 down');
select tests.ok((public.get_economy_status() ->> 'chips_in_play')::int = 470, 'craps bets count as chips in play');
select tests.as_user(:B);
select public.cr_place_bet(:T, 'come', null, 100);
select public.cr_place_bet(:T, 'field', null, 10);
select public.cr_remove_bet(:T, tests.my_bet(:T, 'field'));
select tests.throws($$select public.cr_remove_bet('00000000-0000-0000-0000-00000000dddd', tests.my_bet('00000000-0000-0000-0000-00000000dddd', 'dont_pass'))$$, 'bet_not_allowed');
select tests.ok(tests.bal(:B) = 9900 - 100 - 100, 'field taken down and refunded');

-- Hard 6: place 6 pays 7:6 and stays up; Ben's come bet travels to 6.
select tests.as_user(:A);
select tests.roll_next(3, 3);
select public.cr_roll(:T);
select tests.ok(tests.bal(:A) = 9580 + 70, 'place 6 paid 7:6');
select tests.ok((select count(*) from public.cr_bets where table_id = :T and bet_type = 'place' and status = 'active') = 1, 'place bet stays up');
select tests.ok((select number from public.cr_bets where table_id = :T and bet_type = 'come' and status = 'active') = 6, 'come bet moved to 6');

-- Point made: pass + true odds (2:1 on 4).
select tests.roll_next(2, 2);
select public.cr_roll(:T);
select tests.ok(tests.bal(:A) = 9650 + 200 + 300 + 600, 'pass and 2:1 odds paid');
select tests.ok(tests.bal(:B) = 9700, 'don''t pass lost to the point');
select tests.ok(tests.cr_point(:T) is null, 'point off after it is made');

-- Come-out 7: Ben's come bet on 6 loses; place and hard are off on the come-out.
select tests.roll_next(6, 1);
select public.cr_roll(:T);
select tests.ok(tests.bal(:B) = 9700, 'come bet on 6 lost to the 7');
select tests.ok((select count(*) from public.cr_bets where table_id = :T and user_id = :A and status = 'active') = 2, 'place and hard still up');

-- Point 10, then seven-out: place and hard lose; dice pass to Ben.
select tests.roll_next(5, 5);
select public.cr_roll(:T);
select tests.roll_next(6, 1);
select public.cr_roll(:T);
select tests.ok(tests.bal(:A) = 10750, 'place and hard lost on the seven-out');
select tests.ok((public.cr_state(:T) -> 'state' ->> 'shooter_user')::uuid = :B, 'dice pass to the next player');
select tests.ok((public.cr_state(:T) -> 'recent' -> 0 ->> 'outcome') = 'seven_out', 'seven-out recorded');

-- ===== Props and field payouts; don't pass bar 12 =====
select tests.as_user(:B);
select public.cr_place_bet(:T, 'dont_pass', null, 100);
select public.cr_place_bet(:T, 'any_craps', null, 10);
select public.cr_place_bet(:T, 'field', null, 10);
select tests.roll_next(6, 6);
select public.cr_roll(:T);
select tests.ok(tests.bal(:B) = 9700 - 120 + 100 + 80 + 40, 'bar 12 pushes don''t pass; any craps 7:1; field 12 pays 3:1');

-- ===== Leaving returns optional bets on the next roll =====
select tests.as_user(:A);
select public.cr_place_bet(:T, 'place', 8, 60);
select public.leave_table(:T);
select tests.as_user(:B);
select public.cr_place_bet(:T, 'field', null, 10);
select tests.roll_next(1, 2);
select public.cr_roll(:T);
select tests.ok(tests.bal(:A) = 10750, 'a player who left gets their place bet back');

-- ===== The table keeps rolling on its own =====
select public.cr_place_bet(:T, 'field', null, 10);
reset role;
update public.cr_state set phase_ends_at = now() - interval '1 minute' where table_id = :T;
set role authenticated;
select tests.as_user(:A);
select public.list_tables('craps');
reset role;
select tests.ok(not exists (select 1 from public.cr_bets where table_id = :T and status = 'active'), 'expired roll timer rolled from the lobby');

select tests.ok(private.chips_in_play(:A) = 0 and private.chips_in_play(:B) = 0, 'nothing left in play');
select tests.ok(not exists (
  select 1 from public.wallets w
   where w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)
), 'ledger sums match balances');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('cr_state', 'cr_rolls', 'cr_bets')) = 3, 'realtime');
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every public table');

delete from public.game_tables where id = :T;
delete from auth.users where email like '%@cr.test';

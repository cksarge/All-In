-- Phase 2 tests: tables, seats, lobby RPCs and the blackjack engine.
\set ON_ERROR_STOP 1

-- Helpers (superuser only) ----------------------------------------------------
create or replace function tests.c(r text) returns smallint language sql immutable as $$
  select (array_position(array['A','2','3','4','5','6','7','8','9','10','J','Q','K'], r) - 1)::smallint
$$;
-- Stack the shoe: given cards come first, the rest are 2s.
create or replace function tests.stack(p_table uuid, p_cards text[]) returns void language plpgsql as $$
declare v smallint[];
begin
  select array_agg(tests.c(x) order by o) into v from unnest(p_cards) with ordinality u(x, o);
  v := v || array_fill(1::smallint, array[312 - cardinality(v)]);
  insert into public.bj_shoes (table_id, cards, pos) values (p_table, v, 0)
  on conflict (table_id) do update set cards = excluded.cards, pos = 0;
end $$;
create or replace function tests.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
end $$;
create or replace function tests.bal(p uuid) returns bigint language sql security definer as $$
  select balance from public.wallets where user_id = p
$$;
-- Expire the current phase deadline so bj_advance acts.
create or replace function tests.expire(p_table uuid) returns void language sql as $$
  update public.bj_rounds set phase_ends_at = now() - interval '1 minute'
   where table_id = p_table and phase <> 'settled'
$$;
create or replace function tests.expire_rl(p_table uuid) returns void language sql as $$
  update public.rl_rounds set phase_ends_at = now() - interval '1 minute'
   where table_id = p_table and phase <> 'settled'
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from auth.users where email like '%@bj.test';
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@bj.test', '{"username":"Ann"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@bj.test', '{"username":"Ben"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'c@bj.test', '{"username":"Cat"}');

\set A '''00000000-0000-0000-0000-0000000000a1'''
\set B '''00000000-0000-0000-0000-0000000000b2'''
\set C '''00000000-0000-0000-0000-0000000000c3'''

select tests.ok((select released from public.games where key = 'blackjack'), 'blackjack released');
select tests.ok((select count(*) from public.game_tables where game_key = 'blackjack' and persistent) = 4, 'house tables seeded');

-- Fresh table for the tests (low stakes: bets 10..500).
delete from public.game_tables where name = 'Test Table';
insert into public.game_tables (id, game_key, tier, name, max_seats)
values ('00000000-0000-0000-0000-00000000aaaa', 'blackjack', 'low', 'Test Table', 5);
\set T '''00000000-0000-0000-0000-00000000aaaa'''

-- ===== Seats =====
set role authenticated;
select tests.as_user(:A);
select tests.ok((public.join_table(:T, 1) ->> 'seat_no')::int = 1, 'Ann sits in seat 1');
select tests.as_user(:B);
select tests.throws($$select public.join_table('00000000-0000-0000-0000-00000000aaaa', 1)$$, 'seat_taken');
select tests.ok((public.join_table(:T, 2) ->> 'seat_no')::int = 2, 'Ben sits in seat 2');
select tests.throws($$select public.join_table((select id from public.game_tables where game_key='blackjack' and tier='vip' and persistent), null)$$, 'tier_locked');
select tests.ok((public.my_table() ->> 'table_id')::uuid = :T, 'my_table');
select tests.ok(jsonb_array_length(public.list_tables('blackjack')) >= 5, 'lobby lists tables');
select tests.ok((select (x ->> 'seats_filled')::int from jsonb_array_elements(public.list_tables('blackjack')) x where x ->> 'id' = '00000000-0000-0000-0000-00000000aaaa') = 2, 'lobby seat count');

-- Private table + invite code
select tests.as_user(:C);
select public.create_table('blackjack', 'low', true) as priv \gset
select tests.ok(length(:'priv'::jsonb ->> 'invite_code') = 6, 'invite code');
reset role;
select ((:'priv')::jsonb ->> 'table_id') as priv_id, ((:'priv')::jsonb ->> 'invite_code') as priv_code \gset
set role authenticated;
select tests.as_user(:A);
select tests.ok(not exists (select 1 from public.game_tables where id = :'priv_id'), 'private table hidden from others');
select tests.ok(not exists (select 1 from jsonb_array_elements(public.list_tables('blackjack')) x where x ->> 'id' = :'priv_id'), 'private table not in lobby');
select tests.as_user(:C);
select public.leave_table(:'priv_id'::uuid);

-- Writes are impossible
select tests.as_user(:A);
select tests.throws($$update public.table_seats set stack = 999$$, 'permission denied');
select tests.throws($$insert into public.bj_hands (round_id, table_id, user_id, seat_no, bet) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000aaaa', auth.uid(), 1, 10)$$, 'permission denied');
reset role;

-- ===== Round 1: push and a winning double =====
select tests.stack(:T, array['10','5','9','7','6','8','10']);
set role authenticated;
select tests.as_user(:A);
select tests.throws($$select public.bj_place_bet('00000000-0000-0000-0000-00000000aaaa', 5)$$, 'bet_out_of_range');
select tests.throws($$select public.bj_place_bet('00000000-0000-0000-0000-00000000aaaa', 501)$$, 'bet_out_of_range');
select public.bj_place_bet(:T, 50);
select public.bj_place_bet(:T, 100); -- change bet
select tests.ok(tests.bal(:A) = 9900, 'Ann bet changed to 100');
select tests.ok((public.bj_state(:T) -> 'round' ->> 'phase') = 'betting', 'still betting (Ben has not bet)');
-- Refills see chips in play
select tests.ok((public.get_economy_status() ->> 'chips_in_play')::int = 100, 'chips in play counted');
select tests.as_user(:B);
select public.bj_place_bet(:T, 100);
select tests.ok((public.bj_state(:T) -> 'round' ->> 'phase') = 'playing', 'dealt early once everyone bet');
-- Hidden information
select tests.ok(jsonb_array_length(public.bj_state(:T) -> 'round' -> 'dealer_cards') = 1, 'only the up card is visible');
select tests.ok((public.bj_state(:T) -> 'round' ->> 'hole_hidden')::boolean, 'hole hidden flag');
select tests.throws('select * from public.bj_shoes', 'permission denied');
select tests.throws('select * from public.bj_secrets', 'permission denied');
select tests.ok(public.bj_state(:T)::text not like '%hole_card%', 'state never includes the hole card');
-- Turn order
select tests.throws($$select public.bj_action('00000000-0000-0000-0000-00000000aaaa', 'hit')$$, 'not_your_turn');
select tests.throws($$select public.bj_place_bet('00000000-0000-0000-0000-00000000aaaa', 100)$$, 'betting_closed');
select tests.as_user(:A);
select tests.throws($$select public.bj_action('00000000-0000-0000-0000-00000000aaaa', 'split')$$, 'action_not_allowed');
select public.bj_action(:T, 'stand');
select tests.as_user(:B);
select public.bj_action(:T, 'double');
select tests.ok((public.bj_state(:T) -> 'round' ->> 'phase') = 'settled', 'round settled');
select tests.ok((public.bj_state(:T) -> 'round' ->> 'dealer_total')::int = 17, 'dealer stood on 17');
select tests.ok(tests.bal(:A) = 10000, 'Ann pushed');
select tests.ok(tests.bal(:B) = 10200, 'Ben won a doubled bet');
select tests.ok((select result from public.bj_hands where user_id = :B order by created_at desc limit 1) = 'win', 'Ben result win');
-- Next round waits for the results pause
select tests.throws($$select public.bj_place_bet('00000000-0000-0000-0000-00000000aaaa', 100)$$, 'next_round_pending');
reset role;
update public.bj_rounds set phase_ends_at = now() - interval '1 second' where table_id = :T;

-- ===== Round 2: dealer Ace, insurance, dealer blackjack =====
select tests.stack(:T, array['K','9','A','Q','9','K']);
set role authenticated;
select tests.as_user(:A);
select public.bj_place_bet(:T, 100);
select tests.as_user(:B);
select public.bj_place_bet(:T, 100);
select tests.ok((public.bj_state(:T) -> 'round' ->> 'phase') = 'insurance', 'insurance offered on an Ace');
select tests.as_user(:A);
select public.bj_insurance(:T, true);
select tests.as_user(:B);
select public.bj_insurance(:T, false);
select tests.ok((public.bj_state(:T) -> 'round' ->> 'dealer_result') = 'blackjack', 'dealer blackjack');
select tests.ok(tests.bal(:A) = 10000, 'insurance paid 2:1 (Ann breaks even)');
select tests.ok(tests.bal(:B) = 10100, 'Ben lost 100');
reset role;
update public.bj_rounds set phase_ends_at = now() - interval '1 second' where table_id = :T;

-- ===== Round 3: Ann alone (Ben sits out). Split, double, timeout, dealer busts =====
set role authenticated;
select tests.as_user(:B);
select public.set_sitting_out(:T, true);
reset role;
select tests.stack(:T, array['8','6','8','10','3','2','10','K']);
set role authenticated;
select tests.as_user(:A);
select public.bj_place_bet(:T, 100);
select tests.ok((public.bj_state(:T) -> 'round' ->> 'phase') = 'playing', 'dealt (sitting-out players are not waited for)');
select public.bj_action(:T, 'split');
select tests.ok(jsonb_array_length(public.bj_state(:T) -> 'hands') = 2, 'split into two hands');
select public.bj_action(:T, 'double'); -- hand 0: 8+2=10, draws 10 -> 20
reset role;
select tests.expire(:T);       -- hand 1 (8+3=11) times out
set role authenticated;
select tests.as_user(:B);      -- any player at the table can advance the clock
select public.bj_advance(:T);
select tests.ok((public.bj_state(:T) -> 'round' ->> 'dealer_result') = 'bust', 'dealer bust');
select tests.ok(tests.bal(:A) = 10300, 'split + double both won (+300)');
reset role;
update public.bj_rounds set phase_ends_at = now() - interval '1 second' where table_id = :T;

-- ===== Round 4: blackjack pays 3:2 =====
select tests.stack(:T, array['A','9','K','7']);
set role authenticated;
select tests.as_user(:A);
select public.bj_place_bet(:T, 100);
select tests.ok((public.bj_state(:T) -> 'round' ->> 'phase') = 'settled', 'natural settles without decisions');
select tests.ok(tests.bal(:A) = 10450, 'blackjack paid 3:2');
select tests.ok(jsonb_array_length(public.bj_state(:T) -> 'round' -> 'dealer_cards') = 2, 'dealer did not draw (nobody to beat)');
reset role;
update public.bj_rounds set phase_ends_at = now() - interval '1 second' where table_id = :T;

-- ===== Round 5: surrender =====
select tests.stack(:T, array['10','10','6','6']);
set role authenticated;
select tests.as_user(:A);
select public.bj_place_bet(:T, 100);
select public.bj_action(:T, 'surrender');
select tests.ok(tests.bal(:A) = 10400, 'surrender returns half');
reset role;
update public.bj_rounds set phase_ends_at = now() - interval '1 second' where table_id = :T;

-- ===== Round 6: player disconnects mid-hand; the table keeps moving =====
select tests.stack(:T, array['10','9','7','8','5','10']);
set role authenticated;
select tests.as_user(:B);
select public.set_sitting_out(:T, false);
select public.bj_place_bet(:T, 100);
select tests.as_user(:A);
select public.bj_place_bet(:T, 100);
reset role;
-- Ann's connection drops: last heartbeat 60 s ago.
update public.table_seats set last_seen_at = now() - interval '60 seconds' where user_id = :A;
select tests.expire(:T);
set role authenticated;
select tests.as_user(:B);
select public.bj_advance(:T);
select tests.ok((public.bj_state(:T) -> 'round' ->> 'phase') = 'playing', 'turn moved on');
select tests.ok((select status from public.bj_hands h where h.user_id = :A order by created_at desc limit 1) = 'stood', 'disconnected player auto-stood');
select tests.ok((select user_id from public.bj_hands where id = (public.bj_state(:T) -> 'round' ->> 'turn_hand_id')::uuid) = :B, 'Ben to act');
select public.bj_action(:T, 'stand');
select tests.ok((public.bj_state(:T) -> 'round' ->> 'phase') = 'settled', 'round finished without Ann');
-- Ann reconnects within the hold: seat still hers.
select tests.as_user(:A);
select tests.ok((public.table_heartbeat(:T) ->> 'seated')::boolean, 'seat held for reconnect');
reset role;
update public.bj_rounds set phase_ends_at = now() - interval '1 second' where table_id = :T;

-- ===== Leaving during betting refunds the bet; seats are released after the hold =====
set role authenticated;
select tests.as_user(:A);
select public.bj_place_bet(:T, 100);
select tests.as_user(:B);
select public.leave_table(:T);
select tests.as_user(:A);
select public.leave_table(:T);
reset role;
select tests.expire(:T);
set role authenticated;
select tests.as_user(:C);
select public.join_table(:T, 3);
select public.bj_advance(:T);
reset role;
select tests.ok((select reason from public.chip_ledger where user_id = :A order by id desc limit 1) = 'refund', 'bet refunded to a player who left');
update public.table_seats set last_seen_at = now() - interval '5 minutes' where user_id = :C;
set role authenticated;
select tests.as_user(:C);
select public.list_tables('blackjack');
reset role;
select tests.ok(not exists (select 1 from public.table_seats where user_id = :C), 'seat released after the reconnect hold');

-- ===== Stale rounds finish from the lobby =====
select tests.stack(:T, array['10','9','7','8']);
set role authenticated;
select tests.as_user(:C);
select public.join_table(:T, 3);
select public.bj_place_bet(:T, 100);
reset role;
update public.table_seats set last_seen_at = now() - interval '60 seconds' where user_id = :C;
select tests.expire(:T);
set role authenticated;
select tests.as_user(:A);
select public.list_tables('blackjack');
reset role;
select tests.ok((select phase from public.bj_rounds where table_id = :T order by round_no desc limit 1) = 'settled', 'lobby finished the abandoned round');
select tests.ok(private.chips_in_play(:C) = 0, 'no chips stuck in play');

-- ===== There is always a public table with a free seat at every stake level =====
reset role;
delete from auth.users where email like '%@fill.test';
insert into auth.users (id, email, raw_user_meta_data)
select ('00000000-0000-0000-0000-0000000f00' || lpad(g::text, 2, '0'))::uuid, 'u' || g || '@fill.test',
       jsonb_build_object('username', 'filler' || g)
  from generate_series(1, 30) g;
-- Fill every open public low-stakes table completely.
insert into public.table_seats (table_id, seat_no, user_id)
select t.table_id, t.seat_no, u.id
  from (select gt.id as table_id, s as seat_no, row_number() over (order by gt.id, s) as rn
          from public.game_tables gt, generate_series(1, 5) s
         where gt.game_key = 'blackjack' and gt.tier = 'low' and gt.status = 'open' and not gt.is_private
           and not exists (select 1 from public.table_seats x where x.table_id = gt.id and x.seat_no = s)) t
  join (select id, row_number() over (order by id) as rn from auth.users where email like '%@fill.test') u on u.rn = t.rn;
select tests.ok(not private.tier_has_free_table('blackjack', 'low'), 'all low tables are full');
set role authenticated;
select tests.as_user(:A);
select public.list_tables('blackjack');
reset role;
select tests.ok(private.tier_has_free_table('blackjack', 'low'), 'a new low table opened automatically');
select tests.ok((select count(*) from public.game_tables where game_key = 'blackjack' and tier = 'low' and status = 'open' and not is_private
                 and (select count(*) from public.table_seats s where s.table_id = game_tables.id) = 0) = 1, 'exactly one new empty table');
set role authenticated;
select tests.as_user(:B);
select public.quick_join('blackjack', 'low') as qj \gset
select tests.ok((select count(*) from public.table_seats where table_id = (:'qj'::jsonb ->> 'table_id')::uuid) = 1, 'quick join seats you at the new table');
-- Rate limit on opening tables
reset role;
update public.game_tables set created_at = now() - interval '1 minute' where created_by = :C;
set role authenticated;
select tests.as_user(:C);
select public.create_table('blackjack', 'low', false);
select tests.throws($$select public.create_table('blackjack', 'low', false)$$, 'slow_down');
reset role;
delete from auth.users where email like '%@fill.test';

-- ===== Integrity =====
select tests.ok(not exists (
  select 1 from public.wallets w
   where w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)
), 'ledger sums match balances');
select tests.ok((select count(*) from public.game_history where user_id = :A) >= 6, 'history recorded');
select tests.ok((select rounds_played from public.player_game_stats where user_id = :A and game_key = 'blackjack') >= 6, 'stats recorded');
select tests.ok((select biggest_win from public.player_game_stats where user_id = :A and game_key = 'blackjack') = 300, 'biggest win tracked');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
                 and tablename in ('game_tables','table_seats','bj_rounds','bj_hands')) = 4, 'realtime tables');
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every public table');

-- Clean up
delete from public.game_tables where name in ('Test Table') or created_by in (:A, :B, :C);
delete from auth.users where email like '%@bj.test';

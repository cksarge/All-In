-- Phase 3 tests: roulette.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000000a1'''
\set B '''00000000-0000-0000-0000-0000000000b2'''
\set T '''00000000-0000-0000-0000-00000000bbbb'''
\set U '''00000000-0000-0000-0000-00000000cccc'''

-- Bet validation
select tests.ok(private.rl_numbers('european', 'straight', '17') = '{17}', 'straight');
select tests.throws($$select private.rl_numbers('european', 'straight', '00')$$, 'invalid_bet');
select tests.ok(private.rl_numbers('american', 'straight', '00') = '{37}', '00 on american');
select tests.ok(private.rl_numbers('european', 'split', '1-4') = '{1,4}', 'split across');
select tests.ok(private.rl_numbers('european', 'split', '2-1') = '{1,2}', 'split up (order-free)');
select tests.throws($$select private.rl_numbers('european', 'split', '3-4')$$, 'invalid_bet');
select tests.ok(private.rl_numbers('european', 'split', '0-3') = '{0,3}', 'zero split');
select tests.ok(private.rl_numbers('american', 'split', '00-3') = '{3,37}', 'double-zero split');
select tests.throws($$select private.rl_numbers('american', 'split', '0-3')$$, 'invalid_bet');
select tests.ok(private.rl_numbers('european', 'street', '4') = '{4,5,6}', 'street');
select tests.throws($$select private.rl_numbers('european', 'street', '5')$$, 'invalid_bet');
select tests.ok(private.rl_numbers('european', 'corner', '1') = '{1,2,4,5}', 'corner');
select tests.throws($$select private.rl_numbers('european', 'corner', '3')$$, 'invalid_bet');
select tests.ok(private.rl_numbers('european', 'line', '31') = '{31,32,33,34,35,36}', 'line');
select tests.ok(cardinality(private.rl_numbers('european', 'dozen', '3')) = 12, 'dozen');
select tests.ok(private.rl_numbers('european', 'column', '1') @> '{1,4,34}', 'column 1');
select tests.ok(cardinality(private.rl_numbers('european', 'red', '')) = 18 and not (private.rl_numbers('european', 'red', '') @> '{0}'), 'red');
select tests.throws($$select private.rl_numbers('european', 'banana', '')$$, 'invalid_bet');

select tests.ok((select released from public.games where key = 'roulette'), 'roulette released');
select tests.ok((select count(*) from public.game_tables where game_key = 'roulette' and persistent) = 8, 'house wheels seeded');

delete from auth.users where email like '%@rl.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@rl.test', '{"username":"RlAnn"}'), (:B, 'b@rl.test', '{"username":"RlBen"}');
delete from public.game_tables where id in (:T, :U);
insert into public.game_tables (id, game_key, tier, name, max_seats, variant)
values (:T, 'roulette', 'low', 'Test Wheel', 8, 'european'), (:U, 'roulette', 'low', 'Test US Wheel', 8, 'american');

set role authenticated;
select tests.as_user(:A);
select public.join_table(:T, 1);
select tests.as_user(:B);
select public.join_table(:T, 2);

-- Betting
select tests.as_user(:A);
select tests.throws($$select public.rl_place_bet('00000000-0000-0000-0000-00000000bbbb', 'straight', '17', 5)$$, 'bet_out_of_range');
select tests.throws($$select public.rl_place_bet('00000000-0000-0000-0000-00000000bbbb', 'straight', '00', 10)$$, 'invalid_bet');
select public.rl_place_bet(:T, 'straight', '17', 100);
select public.rl_place_bet(:T, 'black', '', 100);  -- 17 is black
select tests.throws($$select public.rl_place_bet('00000000-0000-0000-0000-00000000bbbb', 'straight', '17', 401)$$, 'bet_out_of_range');
select public.rl_place_bet(:T, 'red', '', 10);
select public.rl_undo_bet(:T);
select tests.ok(tests.bal(:A) = 9800, 'undo returned the last chip');
select tests.ok((public.get_economy_status() ->> 'chips_in_play')::int = 200, 'roulette bets count as chips in play');
select tests.as_user(:B);
select public.rl_place_bet(:T, 'split', '20-17', 50);
select tests.ok((public.rl_state(:T) -> 'round' ->> 'phase') = 'betting', 'betting');
select tests.ok(jsonb_array_length(public.rl_state(:T) -> 'bets') = 3, 'everyone sees the chips on the layout');
reset role;
select tests.expire_rl(:T);
set role authenticated;
select public.rl_advance(:T);
select tests.ok((public.rl_state(:T) -> 'round' ->> 'phase') = 'spinning', 'spinning');
select tests.ok((public.rl_state(:T) -> 'round' ->> 'result') is null, 'result hidden while the wheel spins');
select tests.throws('select * from public.rl_secrets', 'permission denied');
select tests.throws($$select public.rl_place_bet('00000000-0000-0000-0000-00000000bbbb', 'red', '', 10)$$, 'betting_closed');
reset role;
update public.rl_secrets set result = 17 where round_id = (select id from public.rl_rounds where table_id = :T and phase = 'spinning');
select tests.expire_rl(:T);
set role authenticated;
select public.rl_advance(:T);
select tests.ok((public.rl_state(:T) -> 'round' ->> 'result')::int = 17, '17 revealed');
select tests.ok(tests.bal(:A) = 9800 + 3600 + 200, 'straight pays 35:1 and black pays 1:1 (stake back each time)');
select tests.ok(tests.bal(:B) = 9950 + 900, 'split pays 17:1');
select tests.ok((public.rl_state(:T) -> 'recent' ->> 0)::int = 17, 'recent numbers');
select tests.ok((public.rl_state(:T) -> 'stats' -> 'hot' -> 0 ->> 'n')::int = 17, 'hot number');

-- Rebet and a zero
reset role;
update public.rl_rounds set phase_ends_at = now() - interval '1 second' where table_id = :T;
set role authenticated;
select tests.as_user(:A);
select public.rl_rebet(:T);
select tests.ok((select sum(amount) from public.rl_bets b join public.rl_rounds r on r.id = b.round_id
                 where r.table_id = :T and r.phase = 'betting' and b.user_id = :A) = 200, 'rebet repeated the last bets');
reset role;
select tests.expire_rl(:T);
set role authenticated;
select public.rl_advance(:T);
reset role;
update public.rl_secrets set result = 0 where round_id = (select id from public.rl_rounds where table_id = :T and phase = 'spinning');
select tests.expire_rl(:T);
set role authenticated;
select public.rl_advance(:T);
select tests.ok(tests.bal(:A) = 13600 - 200, 'zero: black and 17 both lose');

-- American wheel: 00 straight
reset role;
set role authenticated;
select tests.as_user(:A);
select public.join_table(:U, 1);
select public.rl_place_bet(:U, 'straight', '00', 10);
reset role;
select tests.expire_rl(:U);
set role authenticated;
select public.rl_advance(:U);
reset role;
update public.rl_secrets set result = 37 where round_id = (select id from public.rl_rounds where table_id = :U and phase = 'spinning');
select tests.expire_rl(:U);
set role authenticated;
select public.rl_advance(:U);
select tests.ok(tests.bal(:A) = 13400 - 10 + 360, '00 pays 35:1 on the American wheel');

-- Leaving before the spin returns the bet
select public.join_table(:T, 1);
reset role;
update public.rl_rounds set phase_ends_at = now() - interval '1 second' where table_id = :T;
set role authenticated;
select public.rl_place_bet(:T, 'odd', '', 50);
select public.leave_table(:T);
reset role;
select tests.expire_rl(:T);
set role authenticated;
select tests.as_user(:B);
select public.rl_advance(:T);
select tests.ok(tests.bal(:A) = 13750, 'bet returned to a player who left before the spin');
reset role;

select tests.ok(private.chips_in_play(:A) = 0 and private.chips_in_play(:B) = 0, 'nothing left in play');
select tests.ok(not exists (
  select 1 from public.wallets w
   where w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)
), 'ledger sums match balances');
select tests.ok((select rounds_played from public.player_game_stats where user_id = :A and game_key = 'roulette') = 3, 'roulette stats');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('rl_rounds', 'rl_bets')) = 2, 'realtime');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'rl_secrets') = 0, 'secrets never published');

delete from public.game_tables where id in (:T, :U);
delete from auth.users where email like '%@rl.test';

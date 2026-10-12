-- Phase 4 tests: poker. Decks can be stacked from a queue (test database only).
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000000a1'''
\set B '''00000000-0000-0000-0000-0000000000b2'''
\set C '''00000000-0000-0000-0000-0000000000c3'''
\set T1 '''00000000-0000-0000-0000-0000000e0001'''
\set T2 '''00000000-0000-0000-0000-0000000e0002'''
\set T3 '''00000000-0000-0000-0000-0000000e0003'''
\set T4 '''00000000-0000-0000-0000-0000000e0004'''
\set T5 '''00000000-0000-0000-0000-0000000e0005'''
\set T6 '''00000000-0000-0000-0000-0000000e0006'''

-- Helpers ---------------------------------------------------------------------
-- 'As' -> 0, 'Kh' -> 25, 'Td' -> 35, '2c' -> 40 (rank = c % 13 with A = 0, suit = c / 13 in s h d c order).
create or replace function tests.k(c text) returns smallint language sql immutable as $$
  select ((position(right(c, 1) in 'shdc') - 1) * 13 + position(left(c, length(c) - 1) in 'A23456789TJQK') - 1)::smallint
$$;
create or replace function tests.cards(p text) returns smallint[] language sql immutable as $$
  select array_agg(tests.k(x) order by o) from unnest(string_to_array(p, ' ')) with ordinality u(x, o)
$$;
create table if not exists tests.decks (id serial primary key, cards smallint[]);
-- Queue a deck: these cards come off the top, then the rest of the deck in order.
create or replace function tests.deck(p text) returns void language plpgsql security definer as $$
declare v smallint[] := tests.cards(p);
begin
  v := v || array(select g::smallint from generate_series(0, 51) g where not (g::smallint = any (v)) order by g);
  insert into tests.decks (cards) values (v);
end $$;
create or replace function private.shuffled_shoe(p_decks integer) returns smallint[] language plpgsql volatile set search_path = '' as $$
declare
  r record;
  v smallint[];
  n integer;
  j integer;
  t smallint;
begin
  if p_decks = 1 then
    select id, cards into r from tests.decks order by id limit 1;
    if found then
      delete from tests.decks where id = r.id;
      return r.cards;
    end if;
  end if;
  select array_agg((g % 52)::smallint) into v from generate_series(0, p_decks * 52 - 1) g;
  n := cardinality(v);
  for i in reverse n..2 loop
    j := private.random_int(i) + 1;
    t := v[i]; v[i] := v[j]; v[j] := t;
  end loop;
  return v;
end $$;
create or replace function tests.hand(p_table uuid) returns jsonb language sql security definer as $$
  select to_jsonb(h) from public.pk_hands h where table_id = p_table order by hand_no desc limit 1
$$;
create or replace function tests.pl(p_table uuid, p_seat int) returns jsonb language sql security definer as $$
  select to_jsonb(p) from public.pk_players p
   where p.hand_id = (select id from public.pk_hands where table_id = p_table order by hand_no desc limit 1) and p.seat_no = p_seat
$$;
create or replace function tests.pk_stack(p_table uuid, p_user uuid) returns bigint language sql security definer as $$
  select stack from public.table_seats where table_id = p_table and user_id = p_user
$$;
create or replace function tests.pk_expire(p_table uuid) returns void language sql security definer as $$
  update public.pk_hands set phase_ends_at = now() - interval '1 minute'
   where id = (select id from public.pk_hands where table_id = p_table order by hand_no desc limit 1)
$$;
-- Every chip belonging to these players: wallets + stacks + live pots + waiting top-ups.
create or replace function tests.total_chips(p_users uuid[]) returns bigint language sql security definer as $$
  select (select coalesce(sum(balance), 0) from public.wallets where user_id = any (p_users))
       + (select coalesce(sum(stack), 0) from public.table_seats where user_id = any (p_users))
       + (select coalesce(sum(private.pk_in_play(u)), 0) from unnest(p_users) u)
$$;
grant execute on all functions in schema tests to anon, authenticated;
grant usage on schema tests to authenticated;

delete from auth.users where email like '%@pk.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@pk.test', '{"username":"PkAnn"}'), (:B, 'b@pk.test', '{"username":"PkBen"}'), (:C, 'c@pk.test', '{"username":"PkCat"}');
delete from public.game_tables where id in (:T1, :T2, :T3, :T4, :T5, :T6);
insert into public.game_tables (id, game_key, tier, name, max_seats) values
  (:T1, 'poker_holdem', 'low', 'Test Holdem', 9),
  (:T2, 'poker_holdem', 'low', 'Test Side Pots', 9),
  (:T3, 'poker_omaha_hilo', 'low', 'Test Hi-Lo', 9),
  (:T4, 'poker_stud', 'low', 'Test Stud', 8),
  (:T5, 'poker_draw', 'low', 'Test Draw', 6),
  (:T6, 'poker_holdem', 'low', 'Test Short All-in', 9);

-- ===== Catalogue =====
select tests.ok((select count(*) from public.games where key like 'poker\_%' and released) = 9, 'all nine poker games released');
select tests.ok((select count(*) from public.game_tables where game_key like 'poker\_%' and persistent) = 36, 'house tables seeded');

-- ===== Hand evaluator =====
select tests.ok(private.pk_hand_name(private.pk_eval(tests.cards('As Ks Qs Js Ts'))) = 'Royal flush', 'royal flush');
select tests.ok(private.pk_hand_name(private.pk_eval(tests.cards('9h 8h 7h 6h 5h'))) = 'Straight flush, Nine high', 'straight flush');
select tests.ok(private.pk_hand_name(private.pk_eval(tests.cards('7s 7h 7d 7c 2s'))) = 'Four of a kind, Sevens', 'quads');
select tests.ok(private.pk_hand_name(private.pk_eval(tests.cards('Ks Kh Kd 4c 4s'))) = 'Full house, Kings over Fours', 'full house');
select tests.ok(private.pk_hand_name(private.pk_eval(tests.cards('As 9s 7s 4s 2s'))) = 'Flush, Ace high', 'flush');
select tests.ok(private.pk_hand_name(private.pk_eval(tests.cards('As 2d 3c 4h 5s'))) = 'Straight, Five high', 'wheel');
select tests.ok(private.pk_hand_name(private.pk_eval(tests.cards('Qs Qh 9d 9c 2s'))) = 'Two pair, Queens and Nines', 'two pair');
select tests.ok(private.pk_hand_name(private.pk_eval(tests.cards('Js Jh 9d 4c 2s'))) = 'Pair of Jacks', 'pair');
select tests.ok(private.pk_hand_name(private.pk_eval(tests.cards('Ks Jh 9d 4c 2s'))) = 'King high', 'high card');
select tests.ok(private.pk_eval(tests.cards('6s 2d 3c 4h 5s')) > private.pk_eval(tests.cards('As 2d 3c 4h 5s')), 'six-high straight beats the wheel');
select tests.ok(private.pk_eval(tests.cards('As Ad Kc 4h 3s')) > private.pk_eval(tests.cards('Ah Ac Qc Jh Ts')), 'kicker decides');
select tests.ok(private.pk_eval(tests.cards('As Ad Kc 4h 3s')) = private.pk_eval(tests.cards('Ah Ac Kd 4s 3c')), 'equal hands tie');
select tests.ok(private.pk_eval(tests.cards('2s 2d 2c 3h 3s')) > private.pk_eval(tests.cards('As Ks Qs Js 9s')), 'full house beats flush');
select tests.ok((private.pk_best(tests.cards('Ah Kh'), tests.cards('Qh Jh Th 2c 3d'), false)).score
              = private.pk_eval(tests.cards('Ah Kh Qh Jh Th')), 'best 5 of 7');
select tests.ok(private.pk_hand_name((private.pk_best(tests.cards('Ah Kc Qd Js'), tests.cards('2h 5h 8h 9h Tc'), true)).score)
              = 'Straight, Queen high', 'Omaha must use exactly two hole cards (no flush with one heart)');
select tests.ok(private.pk_hand_name((private.pk_best(tests.cards('Ah Kc Qd Js'), tests.cards('2h 5h 8h 9h Tc'), false)).score)
              = 'Flush, Ace high', 'Hold''em may use one hole card');
select tests.ok(private.pk_low_name((private.pk_best(tests.cards('Ah 2c Kd Ks'), tests.cards('3d 5s 8c Jh Qh'), true, true)).score)
              = '8-5-3-2-A low', 'Omaha low');
select tests.ok((private.pk_best(tests.cards('Kh Kc Qd Js'), tests.cards('3d 5s 8c Jh Qh'), true, true)).score is null, 'no qualifying low');
select tests.ok(private.pk_low_name(private.pk_low5(tests.cards('As 2d 3c 4h 5s'))) = 'Wheel (5-4-3-2-A)', 'wheel low');
select tests.ok(private.pk_low5(tests.cards('As 2d 3c 4h 9s')) is null, 'a 9 does not qualify');
select tests.ok(private.pk_low5(tests.cards('7s 5d 4c 3h 2s')) < private.pk_low5(tests.cards('8s 4d 3c 2h As')), '7-low beats 8-low');
select tests.ok(private.pk_eval(tests.cards('Kc 9h 9d')) > private.pk_eval(tests.cards('As Kd Qc')), 'stud showing: a pair beats ace-high');

-- ===== Bringing chips =====
set role authenticated;
select tests.as_user(:A);
select public.join_table(:T1, 1);
select tests.throws($$select public.pk_bring_chips('00000000-0000-0000-0000-0000000e0001', 100)$$, 'below_min_stack');
select tests.throws($$select public.pk_bring_chips('00000000-0000-0000-0000-0000000e0001', 1001)$$, 'above_max_stack');
select public.pk_bring_chips(:T1, 1000);
select tests.ok(tests.bal(:A) = 9000 and tests.pk_stack(:T1, :A) = 1000, 'chips moved from wallet to the table');
select tests.ok((select reason from public.chip_ledger where user_id = :A order by id desc limit 1) = 'table_chips_in', 'ledger records it');
select tests.ok(public.pk_state(:T1) -> 'hand' = 'null'::jsonb, 'no hand with one player');
select tests.throws($$select public.pk_action('00000000-0000-0000-0000-0000000e0001', 'check')$$, 'not_your_turn');

-- ===== Heads-up Hold'em to showdown =====
-- Ann: As Ah, Ben: Kc Kd. Board Ad 7s 3h | 9c | 4d (burns 2c 2d 2s).
select tests.deck('As Ah Kc Kd 2c Ad 7s 3h 2d 9c 2s 4d');
select tests.as_user(:B);
select public.join_table(:T1, 2);
select public.pk_bring_chips(:T1, 1000);
select tests.ok((tests.hand(:T1) ->> 'hand_no')::int = 1, 'hand starts when a second player has chips');
select tests.ok((tests.hand(:T1) ->> 'button_seat')::int = 1 and (tests.hand(:T1) ->> 'sb_seat')::int = 1
            and (tests.hand(:T1) ->> 'bb_seat')::int = 2, 'heads-up: button posts the small blind');
select tests.ok(tests.pk_stack(:T1, :A) = 995 and tests.pk_stack(:T1, :B) = 990, 'blinds posted');
select tests.ok((tests.hand(:T1) ->> 'turn_seat')::int = 1, 'small blind acts first before the flop');

-- Hidden information
select tests.ok(public.pk_state(:T1) -> 'me' -> 'hole' = to_jsonb(tests.cards('Kc Kd')), 'Ben sees his own cards');
select tests.ok((select count(*) from public.pk_hole) = 1, 'Ben can read only his own hole cards');
select tests.ok(not exists (select 1 from public.pk_hole where user_id = :A), 'Ann''s cards are hidden from Ben');
select tests.ok((select x -> 'shown_cards' from jsonb_array_elements(public.pk_state(:T1) -> 'players') x where (x ->> 'seat_no')::int = 1) = 'null'::jsonb,
                'state does not show other players'' cards');
select tests.ok(public.pk_state(:T1)::text not like '%"hole": [0, 13]%', 'Ann''s hole cards appear nowhere in Ben''s state');
select tests.throws($$select * from public.pk_decks$$, 'permission denied');
select tests.throws($$select * from public.pk_topups$$, 'permission denied');
select tests.throws($$update public.table_seats set stack = 99999$$, 'permission denied');
select tests.throws($$select public.pk_action('00000000-0000-0000-0000-0000000e0001', 'check')$$, 'not_your_turn');

select tests.as_user(:A);
select tests.ok((public.pk_state(:T1) -> 'me' -> 'options' ->> 'to_call')::int = 5, 'Ann has 5 to call');
select tests.throws($$select public.pk_action('00000000-0000-0000-0000-0000000e0001', 'check')$$, 'action_not_allowed');
select public.pk_action(:T1, 'call');
select tests.as_user(:B);
select tests.ok((public.pk_state(:T1) -> 'me' -> 'options' ->> 'can_raise')::boolean, 'big blind gets the option');
select public.pk_action(:T1, 'check');
select tests.ok((tests.hand(:T1) ->> 'street')::int = 1 and jsonb_array_length(tests.hand(:T1) -> 'board') = 3, 'flop dealt');
select tests.ok((tests.hand(:T1) ->> 'turn_seat')::int = 2, 'big blind acts first after the flop heads-up');
select tests.ok(public.pk_state(:T1) -> 'me' ->> 'hand_name' = 'Pair of Kings', 'live hand name');
select public.pk_action(:T1, 'bet', 20);
select tests.as_user(:A);
select tests.ok(public.pk_state(:T1) -> 'me' ->> 'hand_name' = 'Three of a kind, Aces', 'Ann has trips');
select tests.throws($$select public.pk_action('00000000-0000-0000-0000-0000000e0001', 'raise', 30)$$, 'bet_out_of_range');
select tests.ok((public.pk_state(:T1) -> 'me' -> 'options' ->> 'min_to')::int = 40, 'min raise is the size of the last bet');
select public.pk_action(:T1, 'raise', 60);
select tests.as_user(:B);
select public.pk_action(:T1, 'call');
select tests.ok((tests.hand(:T1) ->> 'street')::int = 2, 'turn dealt');
select public.pk_action(:T1, 'check');
select tests.as_user(:A);
-- Top up during a hand waits until the hand ends.
select public.pk_bring_chips(:T1, 50);
select tests.ok(tests.pk_stack(:T1, :A) = 930 and (public.pk_state(:T1) -> 'me' ->> 'pending_topup')::int = 50, 'top-up waits for the hand to end');
select tests.ok(tests.total_chips(array[:A, :B]::uuid[]) = 20000, 'no chips created or lost mid-hand');
select public.pk_action(:T1, 'check');
select tests.as_user(:B);
select public.pk_action(:T1, 'check');
select tests.as_user(:A);
select public.pk_action(:T1, 'bet', 100);
select tests.as_user(:B);
select public.pk_action(:T1, 'call');
select tests.ok(tests.hand(:T1) ->> 'phase' = 'settled' and (tests.hand(:T1) ->> 'showdown')::boolean, 'showdown');
select tests.ok(tests.pk_stack(:T1, :A) = 830 + 340 + 50 and tests.pk_stack(:T1, :B) = 830, 'Ann wins the 340 pot; top-up applied');
select tests.ok(tests.pl(:T1, 1) ->> 'hand_name' = 'Three of a kind, Aces' and tests.pl(:T1, 2) ->> 'hand_name' = 'Pair of Kings', 'hand names');
select tests.ok((select x -> 'shown_cards' from jsonb_array_elements(public.pk_state(:T1) -> 'players') x where (x ->> 'seat_no')::int = 1)
                = to_jsonb(tests.cards('As Ah')), 'cards shown at showdown');
select tests.ok(tests.total_chips(array[:A, :B]::uuid[]) = 20000, 'chips conserved');
select tests.ok((select net from public.game_history where user_id = :B and game_key = 'poker_holdem' order by id desc limit 1) = -170, 'history: Ben -170');
select tests.ok(jsonb_array_length(public.pk_hand_history(:T1)) = 1, 'hand history');
select tests.ok(public.pk_hand_history(:T1) -> 0 -> 'my_cards' = to_jsonb(tests.cards('Kc Kd')), 'history has your own cards');

-- ===== Hand 2: button moves, everyone folds to the big blind =====
select tests.pk_expire(:T1);
select public.pk_advance(:T1);
select tests.ok((tests.hand(:T1) ->> 'hand_no')::int = 2 and (tests.hand(:T1) ->> 'button_seat')::int = 2, 'button moves');
select tests.as_user(:B);
select public.pk_action(:T1, 'fold');
select tests.ok(tests.hand(:T1) ->> 'phase' = 'settled' and not (tests.hand(:T1) ->> 'showdown')::boolean, 'uncontested');
select tests.ok(tests.pk_stack(:T1, :A) = 1225 and tests.pk_stack(:T1, :B) = 825, 'blinds won');
select tests.ok(tests.pl(:T1, 1) -> 'shown_cards' = 'null'::jsonb, 'no cards shown without a showdown');

-- ===== Hand 3: timeout folds and sits out =====
select tests.pk_expire(:T1);
select public.pk_advance(:T1);
select tests.ok((tests.hand(:T1) ->> 'turn_seat')::int = 1, 'Ann to act');
select tests.pk_expire(:T1);
select public.pk_advance(:T1);
select tests.ok(tests.pl(:T1, 1) ->> 'status' = 'folded', 'timed out with a bet to call: fold');
select tests.ok((select status from public.table_seats where user_id = :A) = 'sitting_out', 'and sat out');
select tests.pk_expire(:T1);
select public.pk_advance(:T1);
select tests.ok((tests.hand(:T1) ->> 'hand_no')::int = 3, 'no new hand while only one player is in');
select tests.as_user(:A);
select public.set_sitting_out(:T1, false);
select public.pk_advance(:T1);
select tests.ok((tests.hand(:T1) ->> 'hand_no')::int = 4, 'back in: next hand deals');

-- ===== Leaving mid-hand folds and returns your stack =====
select tests.pk_stack(:T1, :A) as a_stack \gset
select tests.bal(:A) as a_bal \gset
select public.leave_table(:T1);
select tests.ok(tests.bal(:A) = :a_bal + :a_stack, 'stack returned to the wallet on leaving');
select tests.ok((select reason from public.chip_ledger where user_id = :A order by id desc limit 1) = 'table_chips_out', 'ledger: chips out');
select tests.ok(tests.hand(:T1) ->> 'phase' = 'settled', 'leaving folds the hand; the other player wins');
select tests.ok(tests.total_chips(array[:A, :B]::uuid[]) = 20000, 'chips conserved after leaving');
select tests.as_user(:B);
select public.leave_table(:T1);
select tests.ok(tests.bal(:A) + tests.bal(:B) = 20000, 'everything back in wallets');

-- ===== Side pots: three all-ins of different sizes =====
-- Ann 1000 (button), Ben 200 (SB), Cat 500 (BB). Ben has aces, Cat kings, Ann nothing.
select tests.as_user(:A);
select public.join_table(:T2, 1);
select public.set_sitting_out(:T2, true);
select public.pk_bring_chips(:T2, 1000);
select tests.as_user(:B);
select public.join_table(:T2, 2);
select public.set_sitting_out(:T2, true);
select public.pk_bring_chips(:T2, 200);
select tests.as_user(:C);
select public.join_table(:T2, 3);
select public.pk_bring_chips(:T2, 500);
select tests.ok(public.pk_state(:T2) -> 'hand' = 'null'::jsonb, 'sitting-out players are not dealt in');
select tests.deck('7c 2d Ah As Kh Ks 5c Qd 9s 4c 6c 3h 6d 8d');
select tests.as_user(:A);
select public.set_sitting_out(:T2, false);
select tests.as_user(:B);
select public.set_sitting_out(:T2, false);
select public.pk_advance(:T2);
select tests.ok((tests.hand(:T2) ->> 'button_seat')::int = 1 and (tests.hand(:T2) ->> 'turn_seat')::int = 1, 'three-handed: under the gun is the button');
select tests.as_user(:A);
select public.pk_action(:T2, 'allin');
select tests.as_user(:B);
select public.pk_action(:T2, 'call');
select tests.as_user(:C);
select public.pk_action(:T2, 'allin');
select tests.ok(tests.hand(:T2) ->> 'phase' = 'settled' and jsonb_array_length(tests.hand(:T2) -> 'board') = 5, 'board runs out');
select tests.ok(tests.pk_stack(:T2, :A) = 500 and tests.pk_stack(:T2, :B) = 600 and tests.pk_stack(:T2, :C) = 600,
                'main pot 600 to Ben, side pot 600 to Cat, 500 uncalled back to Ann');
select tests.ok(jsonb_array_length(tests.hand(:T2) -> 'pots') = 2, 'two pots');
select tests.ok(tests.total_chips(array[:A, :B, :C]::uuid[]) = 30000, 'chips conserved with side pots');
select tests.as_user(:A);
select public.leave_table(:T2);
select tests.as_user(:B);
select public.leave_table(:T2);
select tests.as_user(:C);
select public.leave_table(:T2);

-- ===== A short all-in does not reopen the betting =====
reset role;
select tests.as_user(:A);
set role authenticated;
select public.join_table(:T6, 1);
select public.set_sitting_out(:T6, true);
select public.pk_bring_chips(:T6, 1000);
select tests.as_user(:B);
select public.join_table(:T6, 2);
select public.set_sitting_out(:T6, true);
select public.pk_bring_chips(:T6, 1000);
select tests.as_user(:C);
select public.join_table(:T6, 3);
select public.set_sitting_out(:T6, true);
select public.pk_bring_chips(:T6, 200);
reset role;
-- Cat only has 40 chips left (and the other 160 back in her wallet).
update public.table_seats set stack = 40 where table_id = :T6 and user_id = :C;
update public.wallets set balance = balance + 160 where user_id = :C;
set role authenticated;
select public.set_sitting_out(:T6, false);
select tests.as_user(:A);
select public.set_sitting_out(:T6, false);
select tests.as_user(:B);
select public.set_sitting_out(:T6, false);
select public.pk_advance(:T6);
select tests.as_user(:A);
select public.pk_action(:T6, 'raise', 30);
select tests.as_user(:B);
select public.pk_action(:T6, 'call');
select tests.as_user(:C);
select public.pk_action(:T6, 'allin');
select tests.ok((tests.hand(:T6) ->> 'current_bet')::int = 40, 'short all-in to 40');
select tests.as_user(:A);
select tests.ok(not (public.pk_state(:T6) -> 'me' -> 'options' ->> 'can_raise')::boolean, 'the raiser can only call a short all-in');
select tests.throws($$select public.pk_action('00000000-0000-0000-0000-0000000e0006', 'raise', 100)$$, 'action_not_allowed');
select public.pk_action(:T6, 'call');
select tests.as_user(:B);
select public.pk_action(:T6, 'call');
select tests.ok((tests.hand(:T6) ->> 'street')::int = 1, 'flop');
select public.pk_action(:T6, 'check');
select tests.as_user(:A);
select public.pk_action(:T6, 'check');
select tests.as_user(:B);
select public.pk_action(:T6, 'check');
select tests.as_user(:A);
select public.pk_action(:T6, 'check');
select tests.as_user(:B);
select public.pk_action(:T6, 'check');
select tests.as_user(:A);
select public.pk_action(:T6, 'check');
select tests.ok(tests.hand(:T6) ->> 'phase' = 'settled', 'checked down');
select tests.ok(tests.pk_stack(:T6, :A) + tests.pk_stack(:T6, :B) + tests.pk_stack(:T6, :C) = 2040, 'chips conserved');
select tests.ok(tests.total_chips(array[:A, :B, :C]::uuid[]) = 30000, 'all chips accounted for');
select tests.as_user(:A);
select public.leave_table(:T6);
select tests.as_user(:B);
select public.leave_table(:T6);
select tests.as_user(:C);
select public.leave_table(:T6);

-- ===== Pot-limit Omaha Hi-Lo: pot-size raises and a split pot =====
-- Ann: Ah 2c 9d 9s (wins the low), Ben: Kd Ks 4c 4d (trip kings). Board 3d 5s 8c | Kh | Qh.
select tests.deck('Ah 2c 9d 9s Kd Ks 4c 4d 7c 3d 5s 8c 7d Kh 7h Qh');
select tests.as_user(:A);
select public.join_table(:T3, 1);
select public.pk_bring_chips(:T3, 1000);
select tests.as_user(:B);
select public.join_table(:T3, 2);
select public.pk_bring_chips(:T3, 1000);
select tests.as_user(:A);
select tests.ok(jsonb_array_length(public.pk_state(:T3) -> 'me' -> 'hole') = 4, 'four hole cards');
select tests.ok((public.pk_state(:T3) -> 'me' -> 'options' ->> 'max_to')::int = 30, 'pot-limit: max raise to 30 (5/10 blinds)');
select tests.throws($$select public.pk_action('00000000-0000-0000-0000-0000000e0003', 'raise', 31)$$, 'bet_out_of_range');
select public.pk_action(:T3, 'raise', 30);
select tests.as_user(:B);
select tests.ok((public.pk_state(:T3) -> 'me' -> 'options' ->> 'max_to')::int = 90, 'pot-limit re-raise to 90');
select public.pk_action(:T3, 'call');
select public.pk_action(:T3, 'check');
select tests.as_user(:A);
select public.pk_action(:T3, 'check');
select tests.as_user(:B);
select public.pk_action(:T3, 'check');
select tests.as_user(:A);
select public.pk_action(:T3, 'check');
select tests.as_user(:B);
select public.pk_action(:T3, 'check');
select tests.as_user(:A);
select public.pk_action(:T3, 'check');
select tests.ok(tests.pl(:T3, 1) ->> 'low_name' = '8-5-3-2-A low' and tests.pl(:T3, 2) ->> 'hand_name' = 'Three of a kind, Kings', 'high and low hands');
select tests.ok((tests.pl(:T3, 1) ->> 'won')::int = 30 and (tests.pl(:T3, 2) ->> 'won')::int = 30, 'pot split high/low');
select tests.ok(tests.pk_stack(:T3, :A) = 1000 and tests.pk_stack(:T3, :B) = 1000, 'each gets their half');
select public.leave_table(:T3);
select tests.as_user(:B);
select public.leave_table(:T3);

-- ===== Seven-Card Stud: bring-in, completion, fixed limits, best showing hand acts first =====
-- Ante 2, bring-in 5, small bet 10, big bet 20.
select tests.deck('As Ks 2c Ah Ad Kc 3d 9h 4h 9d 9c Qc Js 8s');
select tests.as_user(:A);
select public.join_table(:T4, 1);
select public.pk_bring_chips(:T4, 1000);
select tests.as_user(:B);
select public.join_table(:T4, 2);
select public.pk_bring_chips(:T4, 1000);
select tests.ok((tests.hand(:T4) ->> 'bring_in_seat')::int = 1, 'lowest up card brings it in');
select tests.ok(tests.pl(:T4, 2) -> 'up_cards' = to_jsonb(tests.cards('Kc')), 'up cards are public');
select tests.ok(tests.pk_stack(:T4, :A) = 1000 - 2 - 5 and tests.pk_stack(:T4, :B) = 998, 'antes and bring-in');
select tests.as_user(:B);
select tests.ok(jsonb_array_length(public.pk_state(:T4) -> 'me' -> 'hole') = 3, 'three cards on third street');
select tests.ok((public.pk_state(:T4) -> 'me' -> 'options' ->> 'min_to')::int = 10, 'complete to the small bet');
select public.pk_action(:T4, 'raise', 10);
select tests.ok(tests.pl(:T4, 2) ->> 'last_action' = 'Complete', 'completion');
select tests.as_user(:A);
select tests.ok((public.pk_state(:T4) -> 'me' -> 'options' ->> 'max_to')::int = 20, 'fixed limit: raise exactly one small bet');
select public.pk_action(:T4, 'call');
select tests.ok((tests.hand(:T4) ->> 'turn_seat')::int = 2, 'fourth street: best showing hand (king high) acts first');
select tests.as_user(:B);
select tests.throws($$select public.pk_action('00000000-0000-0000-0000-0000000e0004', 'bet', 15)$$, 'bet_out_of_range');
select public.pk_action(:T4, 'bet', 10);
select tests.as_user(:A);
select public.pk_action(:T4, 'call');
select tests.as_user(:B);
select tests.ok((public.pk_state(:T4) -> 'me' -> 'options' ->> 'min_to')::int = 20, 'big bet from fifth street');
select public.pk_action(:T4, 'check');
select tests.as_user(:A);
select public.pk_action(:T4, 'check');
select tests.as_user(:B);
select public.pk_action(:T4, 'check');
select tests.as_user(:A);
select public.pk_action(:T4, 'check');
select tests.ok(jsonb_array_length(public.pk_state(:T4) -> 'me' -> 'hole') = 7, 'seven cards');
select tests.ok(jsonb_array_length(tests.pl(:T4, 1) -> 'up_cards') = 4, 'last card is dealt face down');
select tests.as_user(:B);
select public.pk_action(:T4, 'check');
select tests.as_user(:A);
select public.pk_action(:T4, 'check');
select tests.ok(tests.pl(:T4, 2) ->> 'hand_name' = 'Two pair, Aces and Nines' and (tests.pl(:T4, 2) ->> 'won')::int = 44, 'stud showdown');
select tests.ok(tests.pk_stack(:T4, :A) = 978 and tests.pk_stack(:T4, :B) = 1022, 'stud stacks');
select public.leave_table(:T4);
select tests.as_user(:B);
select public.leave_table(:T4);

-- ===== Five-Card Draw =====
-- Ann: As Ad 7c 4h 2s, draws three (Ah 9s 8d). Ben: Kc Kd Qh Jh 3c, draws one (2h).
select tests.deck('As Ad 7c 4h 2s Kc Kd Qh Jh 3c Ah 9s 8d 2h');
select tests.as_user(:A);
select public.join_table(:T5, 1);
select public.pk_bring_chips(:T5, 1000);
select tests.as_user(:B);
select public.join_table(:T5, 2);
select public.pk_bring_chips(:T5, 1000);
select tests.as_user(:A);
select public.pk_action(:T5, 'call');
select tests.as_user(:B);
select public.pk_action(:T5, 'check');
select tests.ok(tests.hand(:T5) ->> 'phase' = 'drawing', 'draw phase');
select tests.throws($$select public.pk_draw('00000000-0000-0000-0000-0000000e0005', array[0]::smallint[])$$, 'invalid_discard');
select tests.as_user(:A);
select public.pk_draw(:T5, tests.cards('7c 4h 2s'));
select tests.ok(public.pk_state(:T5) -> 'me' -> 'hole' = to_jsonb(tests.cards('As Ad Ah 9s 8d')), 'discards replaced');
select tests.ok(tests.pl(:T5, 1) ->> 'last_action' = 'Draws 3', 'everyone sees how many you drew');
select tests.throws($$select public.pk_draw('00000000-0000-0000-0000-0000000e0005', '{}'::smallint[])$$, 'action_not_allowed');
select tests.as_user(:B);
select public.pk_draw(:T5, tests.cards('3c'));
select tests.ok(tests.hand(:T5) ->> 'phase' = 'betting' and (tests.hand(:T5) ->> 'street')::int = 1, 'second betting round');
select public.pk_action(:T5, 'check');
select tests.as_user(:A);
select public.pk_action(:T5, 'bet', 10);
select tests.as_user(:B);
select public.pk_action(:T5, 'call');
select tests.ok(tests.pl(:T5, 1) ->> 'hand_name' = 'Three of a kind, Aces' and tests.pk_stack(:T5, :A) = 1020, 'draw showdown');

select public.leave_table(:T5);
select tests.as_user(:A);
select public.leave_table(:T5);
select tests.ok(tests.bal(:A) + tests.bal(:B) + tests.bal(:C) = 30000, 'every chip back in a wallet');

-- ===== Stale hands are finished from the lobby =====
reset role;
select tests.ok(not exists (select 1 from public.pk_hands where phase <> 'settled' and table_id in (:T1, :T2, :T3, :T4, :T5, :T6)), 'no hands left open');

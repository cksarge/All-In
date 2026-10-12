-- Stage 10, part 3 tests: Short Deck, Razz, 2-7 Triple Draw and Badugi.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000f1a01'''
\set B '''00000000-0000-0000-0000-0000000f1b02'''
\set S1 '''00000000-0000-0000-0000-0000000f1001'''
\set S2 '''00000000-0000-0000-0000-0000000f1002'''
\set S3 '''00000000-0000-0000-0000-0000000f1003'''
\set S4 '''00000000-0000-0000-0000-0000000f1004'''

-- The best hand a game makes of some cards: its name, and its score (higher wins in every game).
create or replace function tests.nm(p_game text, p_hole text, p_board text default '') returns text language sql as $$
  select name from private.pk_show(p_game, tests.cards(p_hole), case when p_board = '' then '{}'::smallint[] else tests.cards(p_board) end)
$$;
create or replace function tests.sc(p_game text, p_hole text, p_board text default '') returns integer language sql as $$
  select score from private.pk_show(p_game, tests.cards(p_hole), case when p_board = '' then '{}'::smallint[] else tests.cards(p_board) end)
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from tests.dice;
delete from tests.decks;
delete from auth.users where email like '%@pv.test';
insert into auth.users (id, email, raw_user_meta_data) values (:A, 'a@pv.test', '{"username":"PvAnn"}'), (:B, 'b@pv.test', '{"username":"PvBen"}');
delete from public.game_tables where id in (:S1, :S2, :S3, :S4);
insert into public.game_tables (id, game_key, tier, name, max_seats) values
  (:S1, 'poker_shortdeck', 'low', 'Test Short Deck', 9), (:S2, 'poker_razz', 'low', 'Test Razz', 8),
  (:S3, 'poker_27', 'low', 'Test Triple Draw', 6), (:S4, 'poker_badugi', 'low', 'Test Badugi', 6);

-- ----------------------------------------------------------------------------
-- Hand rankings
-- ----------------------------------------------------------------------------
-- Short Deck
select tests.ok(tests.sc('poker_shortdeck', 'Ah 7h', '9h 8h Kh Ks 6s') > tests.sc('poker_shortdeck', '9d 9c', '9h 8h Kh Ks 6s'), 'Short Deck: a flush beats a full house');
select tests.ok(tests.sc('poker_holdem', 'Ah 7h', '9h 8h Kh Ks 6s') < tests.sc('poker_holdem', '9d 9c', '9h 8h Kh Ks 6s'), '(and still loses to one in ordinary Hold''em)');
select tests.ok(tests.nm('poker_shortdeck', 'As 6d', '7c 8h 9s Kd Qd') = 'Straight, Nine high'
            and tests.sc('poker_shortdeck', 'As 6d', '7c 8h 9s Kd Qd') > tests.sc('poker_shortdeck', 'Ks Kc', '7c 8h 9s Kd Qd'), 'A-6-7-8-9 is a straight, and it beats three of a kind');
select tests.ok(tests.nm('poker_shortdeck', 'Ah 7h', '9h 8h Kh Ks 6s') = 'Flush, Ace high' and tests.nm('poker_shortdeck', '9d 9c', '9h 8h Kh Ks 6s') = 'Full house, Nines over Kings', 'hands keep their ordinary names');
select tests.ok(tests.sc('poker_shortdeck', 'As Ks', 'Qs Js Ts 9d 6c') > tests.sc('poker_shortdeck', '9s 9h', '9d 9c Ks Qd 6c'), 'a straight flush still beats four of a kind');
-- Razz
select tests.ok(tests.nm('poker_razz', 'As 2h 3d 4c 5s Kd Kh') = '5-4-3-2-A low' and tests.nm('poker_razz', 'Qs Jd Ks Td 9d 8c 7c') = 'J-10-9-8-7 low', 'Razz: the lowest five of seven, straights not counted');
select tests.ok(tests.sc('poker_razz', 'As 2h 3d 4c 5s Kd Kh') > tests.sc('poker_razz', 'As 2h 3d 4c 6s Kd Kh')
            and tests.sc('poker_razz', '8s 7h 6d 5c 4s Kd Kh') > tests.sc('poker_razz', '9s 4h 3d 2c As Kd Kh'), 'compared from the highest card down: an 8 low beats a 9 low');
select tests.ok(tests.sc('poker_razz', 'Ks Qh Jd Tc 9s 8d 7h') > tests.sc('poker_razz', 'As Ah 2d 2c 3s 3d Kh')
            and tests.nm('poker_razz', 'As Ah 2d 2c 3s 3d Kh') = 'Pair of Aces', 'any hand without a pair beats any hand with one');
select tests.ok(tests.sc('poker_razz', 'As 2s 3s 4s 5s Kd Kh') = tests.sc('poker_razz', 'Ad 2h 3c 4d 5h Qd Qh'), 'a flush is no worse than any other wheel');
-- 2-7
select tests.ok(tests.nm('poker_27', '7c 5d 4h 3s 2c') = '7-5-4-3-2 low' and tests.sc('poker_27', '7c 5d 4h 3s 2c') > tests.sc('poker_27', '7c 6d 4h 3s 2c'), '2-7: 7-5-4-3-2 is the best hand');
select tests.ok(tests.nm('poker_27', 'Ac 2d 3h 4s 5c') = 'A-5-4-3-2 low' and tests.sc('poker_27', 'Ac 2d 3h 4s 5c') < tests.sc('poker_27', 'Kc Qd Jh 9s 8c')
            and tests.sc('poker_27', 'Ac 2d 3h 4s 5c') > tests.sc('poker_27', '2c 2d 3h 4s 5c'), 'aces are high: A-2-3-4-5 is ace high, not a straight, and beats any pair');
select tests.ok(tests.sc('poker_27', '7c 6d 5h 4s 3c') < tests.sc('poker_27', 'Kc Kd 5h 4s 3c') and tests.nm('poker_27', '7c 6d 5h 4s 3c') = 'Straight, Seven high'
            and tests.sc('poker_27', '7c 5c 4c 3c 2c') < tests.sc('poker_27', '7c 6d 5h 4s 3c'), 'straights and flushes count against you');
-- Badugi
select tests.ok(tests.nm('poker_badugi', 'As 2h 3d 4c') = 'Badugi, 4-3-2-A' and tests.sc('poker_badugi', 'As 2h 3d 4c') > tests.sc('poker_badugi', 'As 2h 3d 5c'), 'Badugi: A-2-3-4 of four suits is the best hand');
select tests.ok(tests.nm('poker_badugi', 'As 2s 3d 4c') = '3-card hand, 4-3-A' and tests.sc('poker_badugi', 'Ks Qh Jd Tc') > tests.sc('poker_badugi', 'As 2s 3d 4c'), 'any four-card badugi beats any three-card hand');
select tests.ok(tests.nm('poker_badugi', 'As Ah 2d 2c') = '2-card hand, 2-A' and tests.nm('poker_badugi', '5s 5h 5d 5c') = '1-card hand, 5'
            and tests.nm('poker_badugi', 'Ks Kh 5d 6d') = '2-card hand, K-5', 'pairs and matching suits shrink the hand; the lowest cards are kept');

-- ----------------------------------------------------------------------------
-- Catalogue
-- ----------------------------------------------------------------------------
select tests.ok((select count(*) from public.games where key in ('poker_shortdeck', 'poker_razz', 'poker_27', 'poker_badugi') and released and multiplayer) = 4, 'four more poker games at the tables');
select tests.ok(private.pk_config('poker_badugi') @> '{"hole":4,"max_draw":4,"draws":3,"limit":"fl","turn_seconds":20}' and private.pk_config('poker_draw') @> '{"draws":1,"max_draw":5,"rank":"high"}', 'configs keep the shared settings');
select tests.ok(private.pk_bet_unit('poker_27', '{"small_blind":5,"big_blind":10}', 1) = 10 and private.pk_bet_unit('poker_27', '{"small_blind":5,"big_blind":10}', 2) = 20
            and private.pk_bet_unit('poker_stud', '{"small_bet":10,"big_bet":20}', 3) = 20, 'fixed-limit games with blinds bet the big blind, then double it');

-- ----------------------------------------------------------------------------
-- Short Deck, played: flush against full house
-- ----------------------------------------------------------------------------
select tests.deck('Ah 7h 9d 9c Js 9h 8h Kh Jd Ks Jc 6s');
set role authenticated;
select tests.as_user(:A);
select public.join_table(:S1, 1);
select public.pk_bring_chips(:S1, 1000);
select tests.as_user(:B);
select public.join_table(:S1, 2);
select public.pk_bring_chips(:S1, 1000);
reset role;
select tests.ok((select cardinality(cards) = 36 and not exists (select 1 from unnest(cards) x where x % 13 between 1 and 4)
                   from public.pk_decks where hand_id = (tests.hand(:S1) ->> 'id')::uuid), 'the deck has 36 cards: no twos to fives');
set role authenticated;
select tests.as_user(:A);
select public.pk_action(:S1, 'call');
select tests.as_user(:B);
select public.pk_action(:S1, 'check');
select public.pk_action(:S1, 'check');
select tests.as_user(:A);
select tests.ok(public.pk_state(:S1) #>> '{me,hand_name}' = 'Flush, Ace high', 'you are told what you hold');
select public.pk_action(:S1, 'check');
select tests.as_user(:B);
select public.pk_action(:S1, 'check');
select tests.as_user(:A);
select public.pk_action(:S1, 'check');
select tests.as_user(:B);
select public.pk_action(:S1, 'check');
select tests.as_user(:A);
select public.pk_action(:S1, 'check');
select tests.ok(tests.pl(:S1, 1) ->> 'hand_name' = 'Flush, Ace high' and tests.pl(:S1, 2) ->> 'hand_name' = 'Full house, Nines over Kings'
            and (tests.pl(:S1, 1) ->> 'won')::int = 20 and (tests.pl(:S1, 2) ->> 'won')::int = 0, 'the flush takes the pot');
select public.leave_table(:S1);
select tests.as_user(:B);
select public.leave_table(:S1);

-- ----------------------------------------------------------------------------
-- Razz, played. Ann: (Qs Jd) Ks, then Td 9d 8c, (7c). Ben: (As 3d) 2h, then 4c 5d 9s, (Kd).
-- ----------------------------------------------------------------------------
select tests.deck('Qs Jd Ks As 3d 2h Td 4c 9d 5d 8c 9s 7c Kd');
select tests.as_user(:A);
select public.join_table(:S2, 1);
select public.pk_bring_chips(:S2, 1000);
select tests.as_user(:B);
select public.join_table(:S2, 2);
select public.pk_bring_chips(:S2, 1000);
select tests.ok((tests.hand(:S2) ->> 'bring_in_seat')::int = 1 and tests.pl(:S2, 1) -> 'up_cards' = to_jsonb(tests.cards('Ks')), 'Razz: the highest up card (a king) brings it in');
select public.pk_action(:S2, 'call');
select tests.ok((tests.hand(:S2) ->> 'street')::int = 1 and (tests.hand(:S2) ->> 'turn_seat')::int = 2, 'fourth street: the lowest showing hand acts first');
select tests.ok(public.pk_state(:S2) #>> '{me,hand_name}' = '4-3-2-A', 'four cards to a wheel');
select public.pk_action(:S2, 'check');
select tests.as_user(:A);
select public.pk_action(:S2, 'check');
select tests.as_user(:B);
select public.pk_action(:S2, 'check');
select tests.as_user(:A);
select public.pk_action(:S2, 'check');
select tests.as_user(:B);
select public.pk_action(:S2, 'check');
select tests.as_user(:A);
select public.pk_action(:S2, 'check');
select tests.as_user(:B);
select public.pk_action(:S2, 'check');
select tests.as_user(:A);
select public.pk_action(:S2, 'check');
select tests.ok(tests.pl(:S2, 2) ->> 'hand_name' = '5-4-3-2-A low' and tests.pl(:S2, 1) ->> 'hand_name' = 'J-10-9-8-7 low'
            and (tests.pl(:S2, 2) ->> 'won')::int = 14 and (tests.pl(:S2, 1) ->> 'won')::int = 0, 'the wheel wins the pot: the low hand takes it all');
select public.leave_table(:S2);
select tests.as_user(:B);
select public.leave_table(:S2);

-- ----------------------------------------------------------------------------
-- 2-7 Triple Draw, played. Ann: 7c 5d 4h 3s 2c (stands pat three times). Ben: Ks Kd 9h 8c 3d.
-- Ben draws two (Qh Jh), then one (the queen, for 6s), then none.
-- ----------------------------------------------------------------------------
select tests.deck('7c 5d 4h 3s 2c Ks Kd 9h 8c 3d Qh Jh 6s');
select tests.as_user(:A);
select public.join_table(:S3, 1);
select public.pk_bring_chips(:S3, 1000);
select tests.as_user(:B);
select public.join_table(:S3, 2);
select public.pk_bring_chips(:S3, 1000);
select tests.as_user(:A);
select tests.ok((public.pk_state(:S3) #>> '{me,options,max_to}')::int = 20 and public.pk_state(:S3) #>> '{me,hand_name}' = '7-5-4-3-2 low', 'fixed limit: a raise is exactly one bet; dealt the best hand there is');
select public.pk_action(:S3, 'call');
select tests.as_user(:B);
select public.pk_action(:S3, 'check');
select tests.ok(tests.hand(:S3) ->> 'phase' = 'drawing' and (tests.hand(:S3) ->> 'street')::int = 0, 'first draw');
select public.pk_draw(:S3, tests.cards('Ks Kd'));
select tests.as_user(:A);
select public.pk_draw(:S3, '{}'::smallint[]);
select tests.ok(tests.hand(:S3) ->> 'phase' = 'betting' and (tests.hand(:S3) ->> 'street')::int = 1 and tests.hand(:S3) ->> 'current_bet' = '0', 'betting after the first draw');
select tests.as_user(:B);
select tests.ok(public.pk_state(:S3) #>> '{me,hand_name}' = 'Q-J-9-8-3 low', 'the hand after drawing two');
select public.pk_action(:S3, 'check');
select tests.as_user(:A);
select public.pk_action(:S3, 'bet', 10);
select tests.as_user(:B);
select public.pk_action(:S3, 'call');
select tests.ok(tests.hand(:S3) ->> 'phase' = 'drawing' and (tests.hand(:S3) ->> 'street')::int = 1 and tests.pl(:S3, 1) -> 'drew' = 'null', 'second draw: everyone may draw again');
select public.pk_draw(:S3, tests.cards('Qh'));
select tests.as_user(:A);
select public.pk_draw(:S3, '{}'::smallint[]);
select tests.as_user(:B);
select tests.ok((public.pk_state(:S3) #>> '{me,options,min_to}')::int = 20, 'the bet doubles from the second draw on');
select public.pk_action(:S3, 'check');
select tests.as_user(:A);
select public.pk_action(:S3, 'check');
select tests.ok(tests.hand(:S3) ->> 'phase' = 'drawing' and (tests.hand(:S3) ->> 'street')::int = 2, 'third draw');
select public.pk_draw(:S3, '{}'::smallint[]);
select tests.as_user(:B);
select public.pk_draw(:S3, '{}'::smallint[]);
select tests.ok(tests.hand(:S3) ->> 'phase' = 'betting' and (tests.hand(:S3) ->> 'street')::int = 3, 'last betting round');
select public.pk_action(:S3, 'check');
select tests.as_user(:A);
select public.pk_action(:S3, 'check');
select tests.ok(tests.hand(:S3) ->> 'phase' = 'settled' and tests.pl(:S3, 1) ->> 'hand_name' = '7-5-4-3-2 low' and tests.pl(:S3, 2) ->> 'hand_name' = 'J-9-8-6-3 low'
            and (tests.pl(:S3, 1) ->> 'won')::int = 40, 'no fourth draw: showdown, and the seven low wins');
select public.leave_table(:S3);
select tests.as_user(:B);
select public.leave_table(:S3);

-- ----------------------------------------------------------------------------
-- Badugi, played. Ann: As 2h 3d 4c. Ben: Ks Kh 5d 6d, draws two (7c 8h) for 8-7-5 with the 6d dead.
-- ----------------------------------------------------------------------------
select tests.deck('As 2h 3d 4c Ks Kh 5d 6d 7c 8h');
select tests.as_user(:A);
select public.join_table(:S4, 1);
select public.pk_bring_chips(:S4, 1000);
select tests.as_user(:B);
select public.join_table(:S4, 2);
select public.pk_bring_chips(:S4, 1000);
select tests.as_user(:A);
select tests.ok(jsonb_array_length(public.pk_state(:S4) #> '{me,hole}') = 4 and public.pk_state(:S4) #>> '{me,hand_name}' = 'Badugi, 4-3-2-A', 'four cards each');
select public.pk_action(:S4, 'call');
select tests.as_user(:B);
select public.pk_action(:S4, 'check');
select tests.throws($$select public.pk_draw('00000000-0000-0000-0000-0000000f1004', array[38, 39, 43, 44, 0]::smallint[])$$, 'invalid_discard');
select public.pk_draw(:S4, tests.cards('Ks Kh'));
select tests.ok(public.pk_state(:S4) #>> '{me,hand_name}' = '3-card hand, 8-7-5', 'two diamonds: only one of them counts');
select tests.as_user(:A);
select public.pk_draw(:S4, '{}'::smallint[]);
select tests.as_user(:B);
select public.pk_action(:S4, 'check');
select tests.as_user(:A);
select public.pk_action(:S4, 'check');
select public.pk_draw(:S4, '{}'::smallint[]);
select tests.as_user(:B);
select public.pk_draw(:S4, '{}'::smallint[]);
select public.pk_action(:S4, 'check');
select tests.as_user(:A);
select public.pk_action(:S4, 'check');
select public.pk_draw(:S4, '{}'::smallint[]);
select tests.as_user(:B);
select public.pk_draw(:S4, '{}'::smallint[]);
select public.pk_action(:S4, 'check');
select tests.as_user(:A);
select public.pk_action(:S4, 'check');
select tests.ok(tests.hand(:S4) ->> 'phase' = 'settled' and tests.pl(:S4, 1) ->> 'hand_name' = 'Badugi, 4-3-2-A' and (tests.pl(:S4, 1) ->> 'won')::int = 20, 'the badugi wins');
select public.leave_table(:S4);
select tests.as_user(:B);
select public.leave_table(:S4);
reset role;

select tests.ok(tests.bal(:A) + tests.bal(:B) = 20000, 'every chip back in a wallet');
select tests.ok(not exists (select 1 from public.pk_hands where phase <> 'settled' and table_id in (:S1, :S2, :S3, :S4)), 'no hands left open');

delete from tests.decks;
delete from public.game_tables where id in (:S1, :S2, :S3, :S4);
delete from auth.users where email like '%@pv.test';

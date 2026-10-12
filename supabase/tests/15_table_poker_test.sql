-- Stage 10, part 1 tests: three video poker paytables and six card games against the dealer.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-00000000e0a1'''

create or replace function tests.f4(p text) returns text language sql as $$ select private.fc_name(private.fc_best(tests.c7(p))) $$;
create or replace function tests.t3(p text) returns integer language sql as $$ select private.tpt_score(tests.c7(p)) $$;
grant execute on all functions in schema tests to anon, authenticated;

delete from tests.dice;
delete from tests.decks;
delete from auth.users where email like '%@tp.test';
insert into auth.users (id, email, raw_user_meta_data) values (:A, 'a@tp.test', '{"username":"TpAnn"}');
select private.apply_chips(:A, 990000, 'refund');

-- ----------------------------------------------------------------------------
-- Video poker: Bonus, Double Bonus, Joker
-- ----------------------------------------------------------------------------
select tests.ok(tests.vp('video_poker_bonus', 'As Ah Ad Ac 5s') = 'four_aces' and tests.vp('video_poker_bonus', '3s 3h 3d 3c Ks') = 'four_low'
            and tests.vp('video_poker_bonus', '9s 9h 9d 9c Ks') = 'four_kind' and tests.vp('video_poker_jacks', 'As Ah Ad Ac 5s') = 'four_kind', 'bonus games pay four of a kind by rank; Jacks or Better is unchanged');
select tests.ok(tests.vp('video_poker_double', 'Ts Js Qs Ks As') = 'royal_flush' and tests.vp('video_poker_double', 'Js Jh 4d 7c 9s') = 'jacks_or_better'
            and tests.vp('video_poker_double', 'Ts Th 4d 7c 9s') = 'nothing', 'the rest of the paytable is Jacks or Better''s');
select tests.ok(private.vp_eval('video_poker_joker', tests.c7('As Ks Qs Js') || 52::smallint) = 'wild_royal'
            and private.vp_eval('video_poker_joker', tests.c7('As Ks Qs Js Ts')) = 'natural_royal'
            and private.vp_eval('video_poker_joker', tests.c7('9s 9h 9d 9c') || 52::smallint) = 'five_kind'
            and private.vp_eval('video_poker_joker', tests.c7('5h 6h 7h 9h') || 52::smallint) = 'straight_flush'
            and private.vp_eval('video_poker_joker', tests.c7('Ks 4h 7d 9c') || 52::smallint) = 'kings_or_better'
            and private.vp_eval('video_poker_joker', tests.c7('Qs 4h 7d 9c') || 52::smallint) is null
            and private.vp_eval('video_poker_joker', tests.c7('Qs Qh 7d 9c 2s')) is null
            and private.vp_eval('video_poker_joker', tests.c7('Ks Kh 7d 7c') || 52::smallint) = 'full_house', 'Joker Poker: the joker is whatever helps most; kings or better pays');
select tests.ok((select bool_and((private.solo_cfg(g) -> 'returns') ? (private.vp_eval(g, tests.c7('2s 2h 2d 2c 9s'))))
                   from unnest(array['video_poker_bonus', 'video_poker_double', 'video_poker_joker']) g), 'every hand name has a line in its paytable');

set role authenticated;
select tests.as_user(:A);
select tests.deck('As Ah Ad Ac 5s 2c 3c 4c 5c 6c');
create temp table vp as select public.vp_deal('video_poker_double', 100) as d, public.vp_draw('video_poker_double', '{t,t,t,t,f}') as r;
select tests.ok(d ->> 'made' = 'four_aces' and r @> '{"made":"four_aces","win":16000}', 'Double Bonus: four aces pays 160') from vp;
drop table vp;
select tests.rig(0);
select tests.deck('As Ks Qs Js 2d 3d 4d 5d 6d');
create temp table vp as select public.vp_deal('video_poker_joker', 10) as d;
select tests.ok(d -> 'hand' = '[52,0,12,11,10]' and d ->> 'made' = 'wild_royal', 'Joker Poker is dealt from 53 cards') from vp;
select tests.ok((public.vp_draw('video_poker_joker', '{t,t,t,t,t}') ->> 'win')::int = 1000, 'a wild royal pays 100');
drop table vp;
select tests.ok((public.solo_info('video_poker_joker') #>> '{config,returns,five_kind}')::int = 200 and public.solo_info('video_poker_bonus') ->> 'released' = 'true', 'the new machines are open');
reset role;

-- ----------------------------------------------------------------------------
-- Hand rankings for the new games
-- ----------------------------------------------------------------------------
select tests.ok(tests.f4('As Ah Ad Ac 5s') = 'four_kind' and tests.f4('5s 6s 7s 8s Kd') = 'straight_flush' and tests.f4('9s 9h 9d 2c 5s') = 'three_kind'
            and tests.f4('2s 6s 9s Ks 5d') = 'flush' and tests.f4('As 2h 3d 4c 9s') = 'straight' and tests.f4('9s 9h 4d 4c Ks') = 'two_pair'
            and tests.f4('9s 9h 4d 5c Ks') = 'pair' and tests.f4('2s 9h 4d 5c Ks Jd') = 'high_card', 'four-card hands');
select tests.ok(private.fc_best(tests.c7('9s 9h 9d 2c 5s')) > private.fc_best(tests.c7('2s 6s 9s Ks 5d'))
            and private.fc_best(tests.c7('2s 6s 9s Ks 5d')) > private.fc_best(tests.c7('As 2h 3d 4c 9s')), 'three of a kind beats a flush, which beats a straight');
select tests.ok(tests.t3('7s 7h 7d') > tests.t3('As Ks Qs') and tests.t3('As Ks Qs') > tests.t3('As 2s 3s') and tests.t3('As 2s 3s') > tests.t3('Ks Qs Js')
            and tests.t3('2s 3s 4s') > tests.t3('As Kh Qd') and tests.t3('As Kh Qd') > tests.t3('Ah 2s 3d') and tests.t3('Ah 2s 3d') > tests.t3('Kh Qs Jd')
            and tests.t3('2h 3s 4d') > tests.t3('As Ks 9s') and tests.t3('2s 5s 9s') > tests.t3('As Ah Kd') and tests.t3('2s 2h 3d') > tests.t3('As Kh Jd'),
                'Teen Patti: trail, pure sequence, sequence, colour, pair, high card; A-K-Q then A-2-3 lead the sequences');
select tests.ok(private.tpt_name(tests.t3('7s 7h 7d')) = 'trail' and private.tpt_name(tests.t3('2s 5s 9s')) = 'colour', 'and their names');

-- ----------------------------------------------------------------------------
-- Caribbean Stud  (deck: player 5, dealer 5)
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.throws($$select public.tp_deal('roulette', 'low', '{"ante":100}')$$, 'unknown_game');
select tests.throws($$select public.tp_deal('caribbean_stud', 'low', '{"raise":100}')$$, 'invalid_bet');
select tests.throws($$select public.tp_deal('caribbean_stud', 'low', '{"ante":100,"aces_up":10}')$$, 'invalid_bet');
select tests.throws($$select public.tp_act('caribbean_stud', 'raise')$$, 'no_round');
select tests.deck('Ks Kh Kd 4c 9s As Qh 7d 4s 2c');
create temp table b0 as select tests.bal(:A) as b;
grant select on b0 to authenticated;
create temp table t as select public.tp_deal('caribbean_stud', 'low', '{"ante":100}') as r;
select tests.ok(r @> '{"stage":"decide","made":"three_kind","main":100}' and jsonb_array_length(r -> 'dealer') = 1 and r #>> '{actions,1,key}' = 'raise'
            and (r #>> '{actions,1,cost}')::int = 200 and tests.bal(:A) = (select b from b0) - 100, 'dealt: five cards, one dealer card showing, raise costs twice the ante') from t;
drop table t;
select tests.throws($$select public.tp_deal('caribbean_stud', 'low', '{"ante":100}')$$, 'round_in_progress');
select tests.throws($$select public.tp_act('caribbean_stud', 'bet3')$$, 'action_not_allowed');
select tests.ok((public.game_info('caribbean_stud') #>> '{round,made}') = 'three_kind', 'a hand left open is returned by game_info');
select tests.ok((public.get_economy_status() ->> 'chips_in_play')::int = 100, 'and counted as in play');
create temp table t as select public.tp_act('caribbean_stud', 'raise') as r;
select tests.ok(r @> '{"final":true,"outcome":"no_qualify","qualifies":false,"returns":{"ante":200,"raise":200},"win":400,"staked":300}'
            and jsonb_array_length(r -> 'dealer') = 5, 'dealer has ace-queen: no qualify, ante pays and the raise comes back') from t;
drop table t;
select tests.ok(tests.bal(:A) = (select b from b0) + 100, 'net +100');
select tests.deck('Ks Kh Kd 4c 9s As Kc 7d 4s 2c');
select public.tp_deal('caribbean_stud', 'low', '{"ante":100}');
select tests.ok(public.tp_act('caribbean_stud', 'raise') @> '{"outcome":"win","qualifies":true,"returns":{"ante":200,"raise":800},"win":1000}', 'dealer qualifies with ace-king: trips pay 3 to 1 on the raise');
select tests.deck('2s 5h 9d Jc Ks 7s 7h 7d 4s 2c');
select public.tp_deal('caribbean_stud', 'low', '{"ante":100}');
select tests.ok(public.tp_act('caribbean_stud', 'fold') @> '{"outcome":"fold","win":0,"staked":100}', 'folding loses the ante only');

-- ----------------------------------------------------------------------------
-- Casino Hold'em  (deck: player 2, dealer 2, flop 3, turn, river)
-- ----------------------------------------------------------------------------
select tests.deck('As Ah Kd Qc 2s 7h 9d 3c 4h');
create temp table t as select public.tp_deal('casino_holdem', 'low', '{"ante":100}') as r;
select tests.ok(jsonb_array_length(r -> 'board') = 3 and r -> 'dealer' = '[]' and r ->> 'made' = 'pair' and (r #>> '{actions,1,cost}')::int = 200, 'the flop is showing; calling costs twice the ante') from t;
drop table t;
select tests.ok(public.tp_act('casino_holdem', 'call') @> '{"outcome":"no_qualify","returns":{"ante":200,"call":200}}', 'dealer has king high: ante paid, call returned');
select tests.deck('As Ah Kd Kc 2s 7h 9d 3c 4h');
select public.tp_deal('casino_holdem', 'low', '{"ante":100}');
select tests.ok(public.tp_act('casino_holdem', 'call') @> '{"outcome":"win","qualifies":true,"returns":{"ante":200,"call":400},"dealer_made":"pair"}'
            , 'dealer qualifies with kings and loses to aces');
select tests.deck('As Ks 9c 9h Qs Js Ts 2d 3d');
select public.tp_deal('casino_holdem', 'low', '{"ante":100}');
select tests.ok(public.tp_act('casino_holdem', 'call') @> '{"outcome":"win","made":"royal_flush","returns":{"ante":10100,"call":400}}', 'a royal flush pays 100 to 1 on the ante');
select tests.deck('2s 3h Kd Kc 7s 8h 9d Tc Jh');
select public.tp_deal('casino_holdem', 'low', '{"ante":100}');
select tests.ok(public.tp_act('casino_holdem', 'call') @> '{"outcome":"tie","returns":{"ante":100,"call":200}}', 'the board plays for both: push');

-- ----------------------------------------------------------------------------
-- Let It Ride  (deck: player 3, community 2)
-- ----------------------------------------------------------------------------
select tests.deck('Ts Th 4d Tc 9s');
create temp table b1 as select tests.bal(:A) as b;
grant select on b1 to authenticated;
create temp table t as select public.tp_deal('let_it_ride', 'low', '{"bet":100}') as r;
select tests.ok(r @> '{"stage":"first","bets":{"bet":300}}' and r -> 'board' = '[]' and tests.bal(:A) = (select b from b1) - 300, 'three bets go down') from t;
drop table t;
create temp table t as select public.tp_act('let_it_ride', 'pull') as r;
select tests.ok(r @> '{"stage":"second","bets":{"bet":200}}' and jsonb_array_length(r -> 'board') = 1 and tests.bal(:A) = (select b from b1) - 200, 'one bet pulled back at once; the first community card turns') from t;
drop table t;
select tests.ok(public.tp_act('let_it_ride', 'ride') @> '{"final":true,"outcome":"win","made":"three_kind","returns":{"bet":800},"staked":200,"win":800}', 'two bets ride: three tens pays 3 to 1 on each');
select tests.ok(tests.bal(:A) = (select b from b1) + 600, 'net +600');
select tests.deck('9s 9h 4d 2c Ks');
select public.tp_deal('let_it_ride', 'low', '{"bet":100}');
select public.tp_act('let_it_ride', 'pull');
select tests.ok(public.tp_act('let_it_ride', 'pull') @> '{"outcome":"lose","made":"low_pair","staked":100,"win":0}', 'a pair of nines doesn''t pay; only the last bet was lost');

-- ----------------------------------------------------------------------------
-- Mississippi Stud  (deck: player 2, community 3)
-- ----------------------------------------------------------------------------
select tests.deck('Js Jh 4d 7c 2s');
create temp table t as select public.tp_deal('mississippi_stud', 'low', '{"ante":100}') as r;
select tests.ok(r @> '{"stage":"third"}' and jsonb_array_length(r -> 'actions') = 4 and r -> 'board' = '[]', 'two cards, three to come') from t;
drop table t;
select tests.ok(public.tp_act('mississippi_stud', 'bet3') @> '{"stage":"fourth","bets":{"ante":100,"third":300}}', 'a 3x bet turns the first card');
select public.tp_act('mississippi_stud', 'bet1');
select tests.ok(public.tp_act('mississippi_stud', 'bet2') @> '{"final":true,"outcome":"win","made":"jacks_or_better","staked":700,"win":1400}', 'jacks pay even money on every bet');
select tests.deck('8s 8h 4d 7c 2s');
select public.tp_deal('mississippi_stud', 'low', '{"ante":100}');
select public.tp_act('mississippi_stud', 'bet1');
select public.tp_act('mississippi_stud', 'bet1');
select tests.ok(public.tp_act('mississippi_stud', 'bet1') @> '{"outcome":"push","made":"mid_pair","staked":400,"win":400}', 'a pair of eights returns the bets');
select tests.deck('2s 7h 4d 9c Ks');
select public.tp_deal('mississippi_stud', 'low', '{"ante":100}');
select public.tp_act('mississippi_stud', 'bet1');
select tests.ok(public.tp_act('mississippi_stud', 'fold') @> '{"outcome":"fold","staked":200,"win":0}', 'folding gives up what is in');

-- ----------------------------------------------------------------------------
-- Four Card Poker  (deck: player 5, dealer 6)
-- ----------------------------------------------------------------------------
select tests.deck('As Ah 4d 7c 9s Ks Kh 2d 5c 8s Jd');
create temp table t as select public.tp_deal('four_card_poker', 'low', '{"ante":100,"aces_up":50}') as r;
select tests.ok(r ->> 'made' = 'pair' and jsonb_array_length(r -> 'dealer') = 1 and jsonb_array_length(r -> 'actions') = 4, 'five cards; one of the dealer''s six is showing') from t;
drop table t;
select tests.ok(public.tp_act('four_card_poker', 'bet3') @> '{"outcome":"win","returns":{"aces_up":100,"ante":200,"raise":600},"staked":450,"win":900}'
            , 'aces beat kings: ante and raise pay even money, Aces Up pays 1 to 1');
select tests.deck('9s 9h 9d 7c 2s As Ah Ad Ac 8s Jd');
select public.tp_deal('four_card_poker', 'low', '{"ante":100}');
select tests.ok(public.tp_act('four_card_poker', 'bet1') @> '{"outcome":"lose","made":"three_kind","dealer_made":"four_kind","returns":{"ante_bonus":200}}', 'the ante bonus is paid even when the dealer wins');
select tests.deck('2s 4h 6d 8c Ts 2h 4d 6c 8s Th 3c');
select public.tp_deal('four_card_poker', 'low', '{"ante":100}');
select tests.ok(public.tp_act('four_card_poker', 'bet1') @> '{"outcome":"win"}', 'the player wins ties');

-- ----------------------------------------------------------------------------
-- Teen Patti  (deck: player 3, dealer 3)
-- ----------------------------------------------------------------------------
select tests.deck('7s 7h 7d As Ks Qs');
create temp table t as select public.tp_deal('teen_patti', 'low', '{"ante":100,"pair_plus":50}') as r;
select tests.ok(r ->> 'made' = 'trail' and r -> 'dealer' = '[]' and (r #>> '{actions,1,key}') = 'play', 'three cards each, the dealer''s face down') from t;
drop table t;
select tests.ok(public.tp_act('teen_patti', 'play') @> '{"outcome":"win","dealer_made":"pure_sequence","returns":{"pair_plus":1550,"ante_bonus":500,"ante":200,"play":200}}'
            , 'a trail beats even A-K-Q suited: bonus 5 to 1, Pair Plus 30 to 1');
select tests.deck('Ks 4h 9d Js 8h 2d');
select public.tp_deal('teen_patti', 'low', '{"ante":100}');
select tests.ok(public.tp_act('teen_patti', 'play') @> '{"outcome":"no_qualify","returns":{"ante":200,"play":100}}', 'dealer has jack high: ante paid, play returned');
select tests.deck('2s 2h 9d As Ah 3d');
select public.tp_deal('teen_patti', 'low', '{"ante":100,"pair_plus":50}');
select tests.ok(public.tp_act('teen_patti', 'fold') @> '{"outcome":"fold","returns":{"pair_plus":100},"win":100,"staked":150}', 'Pair Plus is paid on your cards even if you fold');

-- ----------------------------------------------------------------------------
-- Money and housekeeping
-- ----------------------------------------------------------------------------
select tests.throws($$select public.tp_deal('caribbean_stud', 'low', '{"ante":5}')$$, 'bet_out_of_range');
reset role;
update public.wallets set balance = 250 where user_id = :A;
insert into public.chip_ledger (user_id, delta, balance_after, reason) select :A, 250 - (select sum(delta) from public.chip_ledger where user_id = :A), 250, 'refund';
set role authenticated;
select tests.throws($$select public.tp_deal('caribbean_stud', 'low', '{"ante":100}')$$, 'insufficient_chips');
select tests.throws($$select public.tp_deal('mississippi_stud', 'low', '{"ante":100}')$$, 'insufficient_chips');
select tests.ok(public.tp_deal('let_it_ride', 'low', '{"bet":50}') ->> 'stage' = 'first', 'Let It Ride only needs its three bets');
select public.tp_act('let_it_ride', 'pull');
select public.tp_act('let_it_ride', 'pull');
reset role;
select tests.ok((select count(*) from public.solo_rounds where user_id = :A) = 0 and private.chips_in_play(:A) = 0, 'no round left open');
select tests.ok((select balance from public.wallets where user_id = :A) = (select sum(delta) from public.chip_ledger where user_id = :A), 'ledger sums match the balance');
select tests.ok((select count(*) from public.game_history where user_id = :A and game_key in ('caribbean_stud', 'casino_holdem', 'let_it_ride', 'mississippi_stud', 'four_card_poker', 'teen_patti')) = 19,
                'one history row per hand');
set role anon;
select tests.throws($$select public.game_info('teen_patti')$$, 'permission denied');
reset role;

delete from tests.dice;
delete from tests.decks;
delete from auth.users where email like '%@tp.test';

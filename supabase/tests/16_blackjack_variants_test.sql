-- Stage 10, part 2 tests: four blackjack variants and four quick games.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-00000000f0a1'''

delete from tests.dice;
delete from tests.decks;
delete from auth.users where email like '%@bjv.test';
insert into auth.users (id, email, raw_user_meta_data) values (:A, 'a@bjv.test', '{"username":"BjvAnn"}');
select private.apply_chips(:A, 990000, 'refund');

select tests.ok((select total = 21 and soft from private.bjv_value(tests.cards('As Ks'))) and (select total = 12 and not soft from private.bjv_value(tests.cards('As Ks Ad')))
            and (select total = 17 and soft from private.bjv_value(tests.cards('As 6d'))) and (select total = 26 from private.bjv_value(tests.cards('Ks Qd 6h'))), 'hand totals, soft and hard');
select tests.ok(private.bjv_bonus(tests.cards('6s 7s 8s')) = '{3,1}' and private.bjv_bonus(tests.cards('6h 7h 8h')) = '{2,1}' and private.bjv_bonus(tests.cards('6s 7h 8d')) = '{3,2}'
            and private.bjv_bonus(tests.cards('7s 7h 7d')) = '{3,2}' and private.bjv_bonus(tests.cards('2s 3h 4d 5c 7s')) = '{3,2}'
            and private.bjv_bonus(tests.cards('2s 3h 4d 5c 2h 5s')) = '{2,1}' and private.bjv_bonus(tests.cards('Ks 5h 6d')) is null, 'Spanish 21 bonus 21s');

set role authenticated;
select tests.as_user(:A);
select tests.throws($$select public.bjv_deal('blackjack', 'low', 100)$$, 'unknown_game');
select tests.throws($$select public.bjv_deal('red_dog', 'low', 100)$$, 'unknown_game');
select tests.throws($$select public.bjv_act('spanish_21', 'hit')$$, 'no_round');

-- ----------------------------------------------------------------------------
-- Spanish 21
-- ----------------------------------------------------------------------------
select tests.deck('Ts 9s Th 9h 9d 9c');
create temp table t as select public.bjv_deal('spanish_21', 'low', 100) as r;
select tests.ok(r #> '{hands,0,cards}' = '[8,34]' and r -> 'dealer' = '[21]', 'the 10-spot cards are not in the deck') from t;
select tests.ok((select array_agg(a ->> 'key' order by a ->> 'key') from t, jsonb_array_elements(r -> 'actions') a) = '{double,hit,split,stand,surrender}', 'first choices') from t limit 1;
drop table t;
select tests.throws($$select public.bjv_deal('spanish_21', 'low', 100)$$, 'round_in_progress');
select tests.throws($$select public.bjv_act('spanish_21', 'switch')$$, 'action_not_allowed');
select tests.ok((public.quick_info('spanish_21') #>> '{round,bet}')::int = 100 and (public.get_economy_status() ->> 'chips_in_play')::int = 100, 'an open hand is returned and counted as in play');
create temp table t as select public.bjv_act('spanish_21', 'split') as r;
select tests.ok(jsonb_array_length(r -> 'hands') = 2 and r #> '{hands,0,cards}' = '[8,0]' and r #> '{hands,1,cards}' = '[34,1]' and (r ->> 'active')::int = 0, 'a split makes two hands, each with a new card') from t;
drop table t;
select public.bjv_act('spanish_21', 'stand');
create temp table t as select public.bjv_act('spanish_21', 'double') as r;
select tests.ok(r @> '{"final":true,"dealer_total":18,"staked":300,"win":200}' and r #>> '{hands,0,outcome}' = 'win' and r #>> '{hands,1,outcome}' = 'lose', 'soft 20 beats 18; the doubled 14 loses') from t;
drop table t;

select tests.deck('6s Kd 7h 9c 8d');
select public.bjv_deal('spanish_21', 'low', 100);
select tests.ok(public.bjv_act('spanish_21', 'hit') @> '{"final":true,"win":250}' , '6-7-8 pays 3 to 2');
select tests.deck('Ks 7d 5h 4c 6d Kh');
select public.bjv_deal('spanish_21', 'low', 100);
select tests.ok(public.bjv_act('spanish_21', 'hit') @> '{"dealer_total":21,"win":200}', 'a player 21 beats a dealer 21');
select tests.deck('9s Kd 7h 9c');
select public.bjv_deal('spanish_21', 'low', 100);
select tests.ok(public.bjv_act('spanish_21', 'surrender') @> '{"win":50}' , 'surrender returns half');
select tests.deck('As Ad Ks Kd');
select tests.ok(public.bjv_deal('spanish_21', 'low', 100) @> '{"final":true,"dealer_blackjack":true,"win":250}', 'a player blackjack beats a dealer blackjack and pays 3 to 2');

-- ----------------------------------------------------------------------------
-- Blackjack Switch
-- ----------------------------------------------------------------------------
select tests.deck('Ts 5h 6d 5s Td 9c Kh');
create temp table b0 as select tests.bal(:A) as b;
grant select on b0 to authenticated;
create temp table t as select public.bjv_deal('blackjack_switch', 'low', 100) as r;
select tests.ok(jsonb_array_length(r -> 'hands') = 2 and tests.bal(:A) = (select b from b0) - 200 and r -> 'actions' @> '[{"key":"switch"}]', 'two hands, two bets, and you may switch') from t;
drop table t;
create temp table t as select public.bjv_act('blackjack_switch', 'switch') as r;
select tests.ok(r #> '{hands,0,cards}' = '[9,35]' and r #> '{hands,1,cards}' = '[17,4]' and not r -> 'actions' @> '[{"key":"switch"}]', 'the second cards change places: 15 and 15 become 20 and 10') from t;
drop table t;
select public.bjv_act('blackjack_switch', 'stand');
select tests.ok(public.bjv_act('blackjack_switch', 'double') @> '{"final":true,"dealer_total":18,"staked":300,"win":600}', 'both hands win');
select tests.deck('Ts 9h 6d 8s 9d 9c 7h');
select public.bjv_deal('blackjack_switch', 'low', 100);
select public.bjv_act('blackjack_switch', 'stand');
select tests.ok(public.bjv_act('blackjack_switch', 'stand') @> '{"dealer_total":22,"win":200}', 'a dealer 22 is a push, not a bust');
select tests.deck('As 9h 6d Ks 9d 9c 7h');
select public.bjv_deal('blackjack_switch', 'low', 100);
select tests.ok(public.bjv_act('blackjack_switch', 'stand') @> '{"win":300}', 'blackjack pays even money (and still beats a dealer 22)');

-- ----------------------------------------------------------------------------
-- Free Bet Blackjack
-- ----------------------------------------------------------------------------
select tests.deck('5s Td 6h 7c 9d');
create temp table t as select public.bjv_deal('free_bet_blackjack', 'low', 100) as r;
select tests.ok(r -> 'actions' @> '[{"key":"double","cost":0}]', 'a hard 11: the double is free') from t;
drop table t;
select tests.ok(public.bjv_act('free_bet_blackjack', 'double') @> '{"staked":100,"win":300}', 'a free double that wins is paid on both bets');
select tests.deck('8s Td 8h 5c 3d 2c 7h');
create temp table t as select public.bjv_deal('free_bet_blackjack', 'low', 100) as r;
select tests.ok(r -> 'actions' @> '[{"key":"split","cost":0}]', 'a pair of eights: the split is free') from t;
drop table t;
create temp table t as select public.bjv_act('free_bet_blackjack', 'split') as r;
select tests.ok(r #> '{hands,1}' @> '{"stake":0,"free":100}' and (public.get_economy_status() ->> 'chips_in_play')::int = 100, 'the second hand plays on the house''s chips') from t;
drop table t;
select public.bjv_act('free_bet_blackjack', 'double');
select tests.ok(public.bjv_act('free_bet_blackjack', 'stand') @> '{"dealer_total":18,"staked":100,"win":100}', 'push on the first hand; the free hand loses nothing of yours');
select tests.deck('Ks Td Qh 7c');
select tests.ok(public.bjv_deal('free_bet_blackjack', 'low', 100) -> 'actions' @> '[{"key":"split","cost":100}]', 'ten-value cards can be split, but not for free');
select public.bjv_act('free_bet_blackjack', 'stand');

-- ----------------------------------------------------------------------------
-- Pontoon
-- ----------------------------------------------------------------------------
select tests.deck('6s Td 6h 7c');
create temp table t as select public.bjv_deal('pontoon', 'low', 100) as r;
select tests.ok(r -> 'dealer' = '[]' and not r -> 'actions' @> '[{"key":"stand"}]' and r -> 'actions' @> '[{"key":"hit"}]', 'both dealer cards are face down, and you can''t stick on 12') from t;
drop table t;
select public.bjv_act('pontoon', 'hit');
select tests.ok(public.bjv_act('pontoon', 'hit') -> 'actions' @> '[{"key":"stand"}]', 'at 15 you may stick');
select tests.ok(public.bjv_act('pontoon', 'hit') @> '{"final":true,"win":300}' , 'a five-card trick pays 2 to 1');
select tests.deck('Ts Td 9h 9c');
select public.bjv_deal('pontoon', 'low', 100);
select tests.ok(public.bjv_act('pontoon', 'stand') @> '{"dealer_total":19,"win":0}', 'the dealer wins ties');
select tests.deck('As 5d Ks 9c');
select tests.ok(public.bjv_deal('pontoon', 'low', 100) @> '{"final":true,"win":300}', 'a pontoon pays 2 to 1');
select tests.deck('Ks Ad 5h Kd 6c');
select public.bjv_deal('pontoon', 'low', 100);
select tests.ok(public.bjv_act('pontoon', 'hit') @> '{"dealer_blackjack":true,"win":0}', 'a dealer pontoon beats 21');
select tests.deck('5s Td 6h 7c 2d 3d');
select public.bjv_deal('pontoon', 'low', 100);
create temp table t as select public.bjv_act('pontoon', 'double') as r;
select tests.ok(not coalesce((r ->> 'final')::boolean, false) and r #> '{hands,0}' @> '{"stake":200,"doubled":true}' and r -> 'actions' @> '[{"key":"hit"}]'
            and not r -> 'actions' @> '[{"key":"double"}]', 'after buying a card you may still twist') from t;
drop table t;
select public.bjv_act('pontoon', 'hit');
select tests.ok((select count(*) from public.solo_rounds where user_id = auth.uid() and game_key = 'pontoon') = 1, 'still in the hand');
select public.bjv_act('pontoon', 'stand');

-- ----------------------------------------------------------------------------
-- Red Dog
-- ----------------------------------------------------------------------------
select tests.deck('5s 9h 7d');
create temp table t as select public.reddog_deal(100) as r;
select tests.ok(r @> '{"spread":3,"pays":2}' and jsonb_array_length(r -> 'cards') = 2, 'a spread of three pays 2 to 1') from t;
drop table t;
select tests.ok(public.reddog_act(true) @> '{"outcome":"win","staked":200,"win":600}', 'raised, and the seven falls between');
select tests.deck('5s 6h 7d');
select tests.ok(public.reddog_deal(100) @> '{"final":true,"outcome":"push","win":100}', 'consecutive cards: push');
select tests.deck('5s 5h 5d');
select tests.ok(public.reddog_deal(100) @> '{"final":true,"outcome":"triple","win":1200}', 'three of a kind pays 11 to 1');
select tests.deck('5s 5h 9d');
select tests.ok(public.reddog_deal(100) @> '{"outcome":"push","win":100}', 'a pair that doesn''t make three: push');
select tests.deck('5s 9h Kd');
select public.reddog_deal(100);
select tests.ok(public.reddog_act(false) @> '{"outcome":"lose","staked":100,"win":0}', 'outside the spread loses');
select tests.deck('5s 9h 9d');
select public.reddog_deal(100);
select tests.ok(public.reddog_act(false) @> '{"outcome":"lose"}', 'matching an end card loses too');

-- ----------------------------------------------------------------------------
-- Hi-Lo
-- ----------------------------------------------------------------------------
reset role;
select tests.ok((select hi = 170 and lo = 240 from private.hilo_step(6)) and (select hi is null and lo = 100 from private.hilo_step(0))
            and (select hi = 100 and lo is null from private.hilo_step(1)), 'what a right guess is worth; nothing is higher than an ace');
set role authenticated;
select tests.rig(6);
create temp table t as select public.hilo_start(100) as r;
select tests.ok(r @> '{"card":6,"units":100,"steps":0,"hi":170,"lo":240}', 'a seven to start') from t;
drop table t;
select tests.throws($$select public.hilo_collect()$$, 'action_not_allowed');
select tests.rig(11);
select tests.ok(public.hilo_guess('hi') @> '{"card":12,"units":170,"steps":1,"collect":170}', 'a king is higher: 1.7 times the bet so far');
select tests.throws($$select public.hilo_guess('sideways')$$, 'action_not_allowed');
select tests.ok(public.hilo_collect() @> '{"final":true,"outcome":"collect","win":170}', 'collected');
select tests.rig(6, 0);
select public.hilo_start(100);
select tests.ok(public.hilo_guess('lo') @> '{"final":true,"outcome":"lose","card":0,"win":0}', 'an ace is not lower: lost');
select tests.rig(6, 18);
select public.hilo_start(100);
select tests.ok(public.hilo_guess('hi') @> '{"outcome":"lose","card":19}', 'another seven loses either way');
select tests.rig(0);
select public.hilo_start(100);
select tests.throws($$select public.hilo_guess('hi')$$, 'action_not_allowed');
select tests.rig(5);
select tests.ok(public.hilo_guess('lo') @> '{"units":100,"steps":1}', 'a sure thing pays nothing extra');
select public.hilo_collect();

-- ----------------------------------------------------------------------------
-- Andar Bahar
-- ----------------------------------------------------------------------------
select tests.deck('7s 2h 3d 7h');
select tests.ok(public.andar_bahar_deal('low', '{"andar":100,"bahar":50}') @> '{"joker":6,"winner":"andar","andar":[14,19],"bahar":[28],"returns":{"andar":190},"staked":150,"win":190}',
                'Andar wins on its second card: 1 to 1 less 10 percent');
select tests.deck('7s 2h 7d');
select tests.ok(public.andar_bahar_deal('low', '{"bahar":100}') @> '{"winner":"bahar","win":200}', 'Bahar pays 1 to 1');
select tests.throws($$select public.andar_bahar_deal('low', '{"joker":100}')$$, 'invalid_bet');

-- ----------------------------------------------------------------------------
-- Chuck-a-Luck
-- ----------------------------------------------------------------------------
select tests.rig(2, 2, 2);
select tests.ok(public.chuck_roll('low', '{"n3":10,"triple":10,"low":10,"field":10,"n4":10}') @> '{"dice":[3,3,3],"triple":true,"returns":{"n3":110,"triple":310,"low":0,"field":0,"n4":0},"win":420}',
                'three threes: 10 to 1 on the number, 30 to 1 on the triple, and low loses to a triple');
select tests.rig(0, 1, 3);
select tests.ok(public.chuck_roll('low', '{"n1":10,"high":10,"low":10,"field":10}') @> '{"total":7,"returns":{"n1":20,"high":0,"low":20,"field":20}}', 'a total of seven: low and the field win');
select tests.rig(5, 5, 0);
select tests.ok(public.chuck_roll('low', '{"n6":10,"high":10,"field":10}') @> '{"total":13,"returns":{"n6":30,"high":20,"field":20}}', 'two sixes pay 2 to 1');
select tests.throws($$select public.chuck_roll('low', '{"n7":10}')$$, 'invalid_bet');
reset role;

select tests.ok((select count(*) from public.solo_rounds where user_id = :A) = 0 and private.chips_in_play(:A) = 0, 'no round left open');
select tests.ok((select balance from public.wallets where user_id = :A) = (select sum(delta) from public.chip_ledger where user_id = :A), 'ledger sums match the balance');
select tests.ok((select count(distinct game_key) from public.game_history where user_id = :A) = 8, 'all eight games recorded rounds');
set role anon;
select tests.throws($$select public.quick_info('hi_lo')$$, 'permission denied');
reset role;

delete from tests.dice;
delete from tests.decks;
delete from auth.users where email like '%@bjv.test';

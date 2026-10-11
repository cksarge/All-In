-- Stage 6.5 tests: Dragon Tiger, Casino War, Ultimate Texas Hold'em, Plinko, Mines, scratch cards,
-- Power Draw, Crash and Bingo. Decks come from tests.decks and random numbers from tests.dice.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000007a1'''
\set B '''00000000-0000-0000-0000-0000000007b2'''

create or replace function tests.rig(variadic p_vals integer[]) returns void language sql security definer as $$
  insert into tests.dice (v) select x from unnest(p_vals) with ordinality u(x, o) order by o
$$;
create or replace function tests.choose(n integer, k integer) returns numeric language sql immutable as $$
  select case when k < 0 or k > n then 0 else coalesce(exp(sum(ln((n - k + i)::numeric / i))), 1) end from generate_series(1, k) i
$$;
-- Moves the crash room's clock forward (by moving its timestamps back).
create or replace function tests.crash_skip(p_seconds numeric) returns void language sql security definer as $$
  update public.crash_rounds set betting_ends_at = betting_ends_at - make_interval(secs => p_seconds::double precision),
         started_at = started_at - make_interval(secs => p_seconds::double precision),
         crashed_at = crashed_at - make_interval(secs => p_seconds::double precision)
   where round_no = (select max(round_no) from public.crash_rounds);
  update public.crash_secrets set crash_at = crash_at - make_interval(secs => p_seconds::double precision)
   where round_id = (select id from public.crash_rounds order by round_no desc limit 1);
$$;
create or replace function tests.bingo_skip(p_seconds numeric) returns void language sql security definer as $$
  update public.bingo_rounds set selling_ends_at = selling_ends_at - make_interval(secs => p_seconds::double precision),
         started_at = started_at - make_interval(secs => p_seconds::double precision),
         ended_at = ended_at - make_interval(secs => p_seconds::double precision)
   where round_no = (select max(round_no) from public.bingo_rounds);
$$;
create or replace function tests.open_rounds(p uuid) returns integer language sql security definer as $$
  select count(*)::integer from public.solo_rounds where user_id = p
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from tests.dice;
delete from tests.decks;
delete from public.crash_rounds;
delete from public.bingo_rounds;
delete from auth.users where email like '%@more.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@more.test', '{"username":"MoreAnn"}'), (:B, 'b@more.test', '{"username":"MoreBen"}');

-- ----------------------------------------------------------------------------
-- Catalogue and maths
-- ----------------------------------------------------------------------------
select tests.ok((select count(*) from public.games where released) = (select count(*) from public.games), 'every game in the catalogue is open');
select tests.ok((select jsonb_object_agg(category, n) from (select category, count(*) n from public.games group by category) x)
                = '{"table": 8, "poker": 8, "slots": 6, "specialty": 9}', 'games per section');
select tests.ok((select count(*) from public.stake_tiers) = (select count(*) * 4 from public.games), 'four stake levels for every game');

-- Plinko: the slot is binomial, so each table's return is exact.
select tests.ok((
  select bool_and(rtp between 98.8 and 99.2) from (
    select r.key, k.key, sum((u.v #>> '{}')::numeric * tests.choose(r.key::int, (u.o - 1)::int) / power(2::numeric, r.key::int)) as rtp
      from jsonb_each(private.more_cfg('plinko') -> 'returns') r, jsonb_each(r.value) k,
           jsonb_array_elements(k.value) with ordinality u(v, o)
     group by r.key, k.key) x
), 'every Plinko table returns about 99%');
select tests.ok((
  select bool_and(jsonb_array_length(k.value) = r.key::int + 1) from jsonb_each(private.more_cfg('plinko') -> 'returns') r, jsonb_each(r.value) k
), 'one slot more than rows');
-- Scratch cards and Power Draw: exact.
select tests.ok((
  select bool_and(rtp = 94.00) from (
    select c.key, sum((p.v ->> 0)::numeric * (p.v ->> 1)::numeric) / 100000 as rtp
      from jsonb_each(private.more_cfg('scratch_cards') -> 'cards') c, jsonb_array_elements(c.value -> 'prizes') p(v) group by c.key) x
), 'each scratch card returns exactly 94%');
select tests.ok((
  select sum((r.value #>> '{}')::numeric
             * tests.choose(5, left(r.key, 1)::int) * tests.choose(25, 5 - left(r.key, 1)::int) / tests.choose(30, 5)
             * case when r.key like '%p' then 0.1 else 0.9 end)
    from jsonb_each(private.more_cfg('power_draw') -> 'returns') r
) between 93 and 94.5, 'Power Draw returns about 94%');
-- Mines: fair odds less 3%, rounded down.
select tests.ok(private.mines_units(1, 0) = 97 and private.mines_units(1, 1) = 101 and private.mines_units(3, 1) = 110
            and private.mines_units(24, 1) = 2425 and private.mines_units(3, 22) = 223100, 'mines multipliers');
-- Crash: the multiplier curve.
select tests.ok(private.crash_mult(0) = 1.00 and private.crash_mult(10) = 2.01 and private.crash_mult(-3) = 1.00, 'crash multiplier');
-- Bingo: lines and prizes. Cards are stored column by column; 0 is the free centre.
select tests.ok(private.bingo_line_at('{1,2,3,4,5, 16,17,18,19,20, 31,32,0,34,35, 46,47,48,49,50, 61,62,63,64,65}',
                                      '{9,5,4,3,2,1,70}') = 6, 'first column done on the sixth call');
select tests.ok(private.bingo_line_at('{1,2,3,4,5, 16,17,18,19,20, 31,32,0,34,35, 46,47,48,49,50, 61,62,63,64,65}',
                                      '{3,18,48,63}') = 4, 'the middle row needs only four (free centre)');
select tests.ok(private.bingo_line_at('{1,2,3,4,5, 16,17,18,19,20, 31,32,0,34,35, 46,47,48,49,50, 61,62,63,64,65}',
                                      '{1,17,49,65,70}') = 4, 'a diagonal through the centre');
select tests.ok(private.bingo_line_at('{1,2,3,4,5, 16,17,18,19,20, 31,32,0,34,35, 46,47,48,49,50, 61,62,63,64,65}',
                                      '{1,2,3,4,16,17,18,19}') is null, 'no line yet');
select tests.ok(private.bingo_units(5) = 5000 and private.bingo_units(12) = 5000 and private.bingo_units(13) = 1500
            and private.bingo_units(40) = 50 and private.bingo_units(41) = 0 and private.bingo_units(null) = 0, 'bingo prizes by speed');
select tests.ok(count(*) filter (where at is not null) between 0.38 * count(*) and 0.51 * count(*)
            and avg(private.bingo_units(at)) between 65 and 125,
                format('bingo over 2000 cards: %s%% win, return %s', round(100.0 * count(*) filter (where at is not null) / count(*), 1), round(avg(private.bingo_units(at)), 1)))
  -- (40 + 0 * g: a fresh draw for every card, not one draw shared by all of them)
  from (select private.bingo_line_at(private.bingo_card(), d.balls) as at
          from generate_series(1, 2000) g,
               lateral (select array_agg(x::smallint) as balls from unnest(private.draw_numbers(75, 40 + 0 * g)) x) d) s;
select tests.ok((select bool_and(n[13] = 0 and cardinality(n) = 25
                                 and (select count(distinct x) from unnest(n) x) = 25
                                 and (select bool_and(x = 0 or (x - 1) / 15 = (o - 1) / 5) from unnest(n) with ordinality u(x, o)))
                   from (select private.bingo_card() as n from generate_series(1, 50)) c), 'bingo cards: right columns, no repeats, free centre');

-- ----------------------------------------------------------------------------
-- What the browser can and can't do
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.more_info('plinko') #>> '{config,returns,8,low,0}' = '560', 'paytable');
select tests.ok(public.more_info('mines') -> 'round' = 'null', 'no round waiting');
select tests.throws($$select public.more_info('keno')$$, 'unknown_game');
select tests.throws($$select * from public.crash_secrets$$, 'permission denied');
select tests.throws($$select * from public.bingo_secrets$$, 'permission denied');
select tests.throws($$select private.crash_tick(true)$$, 'permission denied');
select tests.throws($$update public.crash_bets set payout = 1$$, 'permission denied');
select tests.throws($$select public.dragon_tiger_deal('low', '{"lion": 10}')$$, 'invalid_bet');
select tests.throws($$select public.plinko_drop(10, 9, 'low')$$, 'invalid_bet');
select tests.throws($$select public.plinko_drop(10, 8, 'wild')$$, 'invalid_bet');
select tests.throws($$select public.plinko_drop(15, 8, 'low')$$, 'invalid_amount');
select tests.throws($$select public.mines_start(10, 0)$$, 'invalid_bet');
select tests.throws($$select public.mines_start(10, 25)$$, 'invalid_bet');
select tests.throws($$select public.mines_pick(3)$$, 'no_round');
select tests.throws($$select public.mines_collect()$$, 'no_round');
select tests.throws($$select public.scratch_play('platinum', 10)$$, 'invalid_bet');
select tests.throws($$select public.scratch_play('clover', 2000)$$, 'tier_locked');
select tests.throws($$select public.power_draw_play(10, '{1,2,3,4}', 1)$$, 'invalid_picks');
select tests.throws($$select public.power_draw_play(10, '{1,2,3,4,4}', 1)$$, 'invalid_picks');
select tests.throws($$select public.power_draw_play(10, '{1,2,3,4,31}', 1)$$, 'invalid_picks');
select tests.throws($$select public.power_draw_play(10, '{1,2,3,4,5}', 11)$$, 'invalid_picks');
select tests.throws($$select public.war_act(true)$$, 'no_round');
select tests.throws($$select public.uth_act('check')$$, 'no_round');
select tests.throws($$select public.bingo_buy(10, 0)$$, 'invalid_amount');
select tests.throws($$select public.bingo_buy(10, 5)$$, 'action_not_allowed');
select tests.ok(tests.bal(:A) = 10000, 'rejected bets cost nothing');
reset role;
delete from public.bingo_rounds;
delete from public.crash_rounds;

-- ----------------------------------------------------------------------------
-- Dragon Tiger
-- ----------------------------------------------------------------------------
select tests.deck('Ks 2h');
set role authenticated;
select tests.ok(public.dragon_tiger_deal('low', '{"dragon": 100, "tiger": 50, "tie": 10}') @> '{"outcome":"dragon","win":200,"staked":160}', 'dragon wins 1 to 1');
reset role;
select tests.deck('As Kh');
set role authenticated;
select tests.ok(public.dragon_tiger_deal('low', '{"dragon": 100}') @> '{"outcome":"tiger","win":0}', 'the ace is low');
reset role;
select tests.deck('Ks Kh');
set role authenticated;
select tests.ok((public.dragon_tiger_deal('low', '{"dragon": 100, "tie": 10, "suited_tie": 10}') -> 'returns')
                = '{"dragon":50,"tie":120,"suited_tie":0}', 'tie: half back, tie pays 11 to 1');
reset role;
select tests.deck('Ks Ks');
set role authenticated;
select tests.ok((public.dragon_tiger_deal('low', '{"tiger": 25, "suited_tie": 10}') -> 'returns') = '{"tiger":12,"suited_tie":510}', 'suited tie pays 50 to 1; half is rounded down');
select tests.ok(tests.bal(:A) = 10000 + 40 - 100 + 50 + 487, 'dragon tiger sums');
reset role;

-- ----------------------------------------------------------------------------
-- Casino War
-- ----------------------------------------------------------------------------
select tests.deck('Ks 2h');
set role authenticated;
select tests.ok(public.war_deal('low', 100, 10) @> '{"outcome":"win","tied":false,"win":200,"staked":110}', 'higher card wins 1 to 1, tie bet loses');
select tests.ok(tests.open_rounds(:A) = 0, 'no round left open after a plain win');
reset role;
select tests.deck('Ks Kh 3d 4d 5d As 6c 7c 8c 2d');
set role authenticated;
create temp table so as select public.war_deal('low', 100, 10) as r;
select tests.ok(r @> '{"tied":true,"tie_return":110}' and not (r ? 'outcome'), 'a tie waits for a decision') from so;
select tests.ok((public.more_info('casino_war') #>> '{round,tied}')::boolean and (public.get_economy_status() ->> 'chips_in_play')::int = 110, 'the round waits and its chips are in play');
select tests.throws($$select public.war_deal('low', 100)$$, 'round_in_progress');
drop table so;
select tests.ok(public.war_act(true) @> '{"outcome":"war_win","staked":210,"win":410}', 'won the war: raise pays 1 to 1, ante returned, tie bet paid 10 to 1');
reset role;
select tests.deck('Ks Kh 3d 4d 5d 2s 6c 7c 8c Ad');
set role authenticated;
select public.war_deal('low', 100);
select tests.ok(public.war_act(true) @> '{"outcome":"war_lose","staked":200,"win":0}', 'lost the war: both bets lose');
reset role;
select tests.deck('Ks Kh 3d 4d 5d 9s 6c 7c 8c 9d');
set role authenticated;
select public.war_deal('low', 100);
select tests.ok(public.war_act(true) @> '{"outcome":"war_tie","win":400}', 'a tie in the war pays a bonus ante');
reset role;
select tests.deck('Ks Kh');
set role authenticated;
select public.war_deal('low', 25);
select tests.ok(public.war_act(false) @> '{"outcome":"surrender","win":12,"staked":25}', 'surrender: half the ante back, rounded down');
select tests.ok(tests.bal(:A) = 10477 + 90 + 200 - 200 + 200 - 13, 'casino war sums');
reset role;

-- ----------------------------------------------------------------------------
-- Ultimate Texas Hold'em: cards go hole (2), dealer (2), board (5)
-- ----------------------------------------------------------------------------
select tests.deck('As Ah Kd Qc 2s 7d 9c Jh 3s');
set role authenticated;
create temp table so as select public.uth_deal('low', 100, 10) as r;
select tests.ok(r -> 'hole' = to_jsonb(tests.cards('As Ah')) and r -> 'board' = '[]' and r ->> 'stage' = 'preflop' and not (r ? 'dealer'), 'two cards, nothing else shown') from so;
select tests.ok(tests.bal(:A) = 10754 - 210, 'ante, blind and trips taken');
drop table so;
select tests.throws($$select public.uth_act('bet2')$$, 'action_not_allowed');
select tests.throws($$select public.uth_act('fold')$$, 'action_not_allowed');
create temp table so as select public.uth_act('bet4') as r;
select tests.ok(r @> '{"done":true,"outcome":"win","made":"pair","dealer_made":"high_card","qualifies":false,"play":400,"staked":610,"win":1000}', 'pair of aces beats king high') from so;
select tests.ok(r -> 'returns' = '{"ante":100,"blind":100,"play":800,"trips":0}', 'dealer does not qualify: ante pushes; a pair pushes the blind') from so;
drop table so;
reset role;
select tests.deck('As Ks 2d 3c Qs Js 4s 9d 9h');
set role authenticated;
select public.uth_deal('low', 100, 50);
create temp table so as select public.uth_act('check') as r;
select tests.ok(r @> '{"done":false,"stage":"flop"}' and r -> 'board' = to_jsonb(tests.cards('Qs Js 4s')), 'check: the flop') from so;
drop table so;
select tests.throws($$select public.uth_act('bet4')$$, 'action_not_allowed');
select tests.ok(public.uth_act('check') -> 'board' = to_jsonb(tests.cards('Qs Js 4s 9d 9h')), 'check again: turn and river');
select tests.throws($$select public.uth_act('check')$$, 'action_not_allowed');
create temp table so as select public.uth_act('bet1') as r;
select tests.ok(r @> '{"outcome":"win","made":"flush","dealer_made":"pair","qualifies":true,"play":100,"staked":350,"win":1050}', 'ace-high flush beats a pair of nines') from so;
select tests.ok(r -> 'returns' = '{"ante":200,"blind":250,"play":200,"trips":400}', 'flush: blind 3 to 2, trips 7 to 1') from so;
drop table so;
reset role;
select tests.deck('7s 2h Kd Qc As 9d 9c Jh 3s');
set role authenticated;
select public.uth_deal('low', 100);
select public.uth_act('check');
select public.uth_act('check');
select tests.ok(public.uth_act('fold') @> '{"outcome":"fold","win":0,"staked":200}', 'fold: ante and blind lost');
reset role;
select tests.deck('7s 2h Kd Kc As 9d 4c Jh 3s');
set role authenticated;
select public.uth_deal('low', 100);
select tests.ok(public.uth_act('bet3') @> '{"outcome":"lose","qualifies":true,"win":0,"staked":500}', 'dealer qualifies and wins: everything loses');
select tests.ok(tests.bal(:A) = 10754 - 610 + 1000 - 350 + 1050 - 200 - 500, 'ultimate hold''em sums');
reset role;

-- ----------------------------------------------------------------------------
-- Plinko, scratch cards, Power Draw
-- ----------------------------------------------------------------------------
select tests.rig(0, 0, 0, 0, 0, 0, 0, 0);
set role authenticated;
select tests.as_user(:B);
select tests.ok(public.plinko_drop(10, 8, 'high') @> '{"slot":0,"units":2900,"win":290,"path":[0,0,0,0,0,0,0,0]}', 'all the way left: 29 times the bet');
reset role;
select tests.rig(1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0);
set role authenticated;
select tests.ok(public.plinko_drop(100, 12, 'medium') @> '{"slot":6,"units":30,"win":30}', 'the middle slot pays least');
select tests.ok(tests.bal(:B) = 10000 + 280 - 70, 'plinko sums');
reset role;

select tests.rig(0);
set role authenticated;
create temp table so as select public.scratch_play('clover', 10) as r;
select tests.ok(r @> '{"units":100,"win":10}' and jsonb_array_length(r -> 'panels') = 9, 'smallest prize: the price back') from so;
select tests.ok((select max(n) = 3 and count(*) filter (where n = 3) = 1 and bool_or(v = '100' and n = 3)
                   from (select x::text as v, count(*) as n from so, jsonb_array_elements(r -> 'panels') x group by 1) c),
                'a winning card shows its prize exactly three times and nothing else three times');
drop table so;
reset role;
select tests.rig(99999);
set role authenticated;
create temp table so as select public.scratch_play('diamond', 10) as r;
select tests.ok(r @> '{"units":0,"win":0}', 'no prize') from so;
select tests.ok((select max(n) <= 2 from (select x::text as v, count(*) as n from so, jsonb_array_elements(r -> 'panels') x group by 1) c),
                'a losing card never shows three of a kind');
drop table so;
reset role;
select tests.rig(99999 - 1);
set role authenticated;
select tests.ok(public.scratch_play('diamond', 10) @> '{"units":0}', 'still nothing just below the top of the range');
reset role;
select tests.rig(8160);
set role authenticated;
select tests.ok(public.scratch_play('diamond', 10) @> '{"units":1000000,"win":100000}', 'the one-in-100,000 diamond');
reset role;
update public.wallets set balance = 10000 where user_id = :B;

select tests.rig(0, 0, 0, 0, 0, 0);                -- balls 1 to 5, power ball 1
set role authenticated;
select tests.ok(public.power_draw_play(10, '{1,2,3,29,30}', 2) @> '{"drawn":[1,2,3,4,5],"power":1,"hits":[1,2,3],"power_hit":false,"units":600,"win":60}', 'three numbers');
reset role;
select tests.rig(0, 0, 0, 0, 0, 0);
set role authenticated;
select tests.ok(public.power_draw_play(10, '{26,27,28,29,30}', 1) @> '{"units":200,"win":20}', 'just the power ball');
reset role;
select tests.rig(0, 0, 0, 0, 0, 0);
set role authenticated;
select tests.ok(public.power_draw_play(10, '{5,4,3,2,1}', 1) @> '{"units":20000000,"win":2000000}', 'all five and the power ball');
reset role;
update public.wallets set balance = 10000 where user_id = :B;

-- ----------------------------------------------------------------------------
-- Mines
-- ----------------------------------------------------------------------------
select tests.rig(0, 0, 0);                         -- mines under tiles 0, 1 and 2
set role authenticated;
create temp table so as select public.mines_start(100, 3) as r;
select tests.ok(r @> '{"mines":3,"picked":[],"units":97,"next_units":110}' and not (r ? 'mine_tiles'), 'mines hidden') from so;
drop table so;
select tests.throws($$select public.mines_collect()$$, 'action_not_allowed');
select tests.throws($$select public.mines_start(100, 3)$$, 'round_in_progress');
select tests.ok(public.mines_pick(5) @> '{"done":false,"picked":[5],"units":110,"next_units":125}', 'a safe tile');
select tests.throws($$select public.mines_pick(5)$$, 'invalid_bet');
select tests.throws($$select public.mines_pick(25)$$, 'invalid_bet');
select tests.ok(public.more_info('mines') #> '{round,picked}' = '[5]' and (public.get_economy_status() ->> 'chips_in_play')::int = 100, 'the round waits');
select tests.ok(public.mines_pick(24) @> '{"units":125}', 'another');
select tests.ok(public.mines_collect() @> '{"done":true,"outcome":"collected","units":125,"win":125,"mine_tiles":[0,1,2]}', 'collect shows the mines');
reset role;
select tests.rig(0, 0, 0);
set role authenticated;
select public.mines_start(100, 3);
select public.mines_pick(7);
select tests.ok(public.mines_pick(1) @> '{"done":true,"outcome":"boom","hit":1,"win":0}', 'a mine ends it');
reset role;
select tests.rig(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);   -- 24 mines: only tile 24 is safe
set role authenticated;
select public.mines_start(10, 24);
select tests.ok(public.mines_pick(24) @> '{"done":true,"outcome":"cleared","units":2425,"win":242}', 'last safe tile collects by itself');
select tests.ok(tests.bal(:B) = 10000 + 25 - 100 + 232 and tests.open_rounds(:B) = 0, 'mines sums');
reset role;

-- ----------------------------------------------------------------------------
-- Crash
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.crash_state() #>> '{round,phase}' = 'betting', 'opening the room starts a betting round');
select tests.throws($$select public.crash_bet(100, 1.00)$$, 'invalid_amount');
select tests.throws($$select public.crash_collect()$$, 'action_not_allowed');
select public.crash_bet(100, 1.5);
select tests.throws($$select public.crash_bet(100)$$, 'action_not_allowed');
select tests.as_user(:B);
select public.crash_bet(200);
select tests.ok(jsonb_array_length(public.crash_state() -> 'bets') = 2 and (public.get_economy_status() ->> 'chips_in_play')::int = 200, 'both bets shown; chips in play');
reset role;
select tests.crash_skip(8);
select tests.rig(500000);                          -- 0.97 / 0.5 = 1.94
set role authenticated;
select tests.ok(public.crash_state() #>> '{round,phase}' = 'flying' and public.crash_state() #>> '{round,crash_point}' is null, 'flying, crash point hidden');
select tests.throws($$select public.crash_bet(100)$$, 'betting_closed');
reset role;
select tests.crash_skip(5);                        -- e^0.35 = 1.41
set role authenticated;
select tests.ok(public.crash_collect() @> '{"collected_at":1.41,"payout":282}', 'collected at 1.41x');
select tests.throws($$select public.crash_collect()$$, 'action_not_allowed');
select tests.ok(tests.bal(:B) = 10157 - 200 + 282, 'crash paid');
reset role;
select tests.crash_skip(2);                        -- e^0.49 = 1.63: past Ann's 1.50
set role authenticated;
select tests.ok((select b ->> 'collected_at' = '1.50' and b ->> 'payout' = '150' from jsonb_array_elements(public.crash_state() -> 'bets') b where b ->> 'username' = 'MoreAnn'),
                'the automatic collect was paid at its own multiplier');
reset role;
select tests.crash_skip(5);
set role authenticated;
select tests.ok(public.crash_state() -> 'round' @> '{"phase":"crashed","crash_point":1.94}', 'crashed, and now the point is shown');
select tests.ok(public.crash_state() -> 'recent' = '[1.94]', 'recent crashes');
reset role;
-- an instant crash
select tests.crash_skip(5);
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.crash_state() #>> '{round,phase}' = 'betting', 'next round opens after the pause');
select public.crash_bet(100, 1.01);
reset role;
select tests.crash_skip(8);
select tests.rig(0);
set role authenticated;
select tests.ok(public.crash_state() -> 'round' @> '{"phase":"crashed","crash_point":1.00}', 'three rounds in a hundred crash at once');
select tests.ok(tests.bal(:A) = 11144 - 100 + 150 - 100 and private_bal.v = 0, 'even 1.01x automatic collect loses to an instant crash')
  from (select (public.get_economy_status() ->> 'chips_in_play')::int as v) private_bal;
reset role;

-- ----------------------------------------------------------------------------
-- Bingo
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.ok(public.bingo_state() -> 'round' = 'null', 'no round until someone takes a card');
select public.bingo_buy(10, 2);
select tests.throws($$select public.bingo_buy(10, 3)$$, 'action_not_allowed');
select tests.as_user(:B);
select public.bingo_buy(100, 1);
select tests.ok(public.bingo_state() #>> '{round,phase}' = 'selling' and jsonb_array_length(public.bingo_state() -> 'cards') = 1
            and public.bingo_state() -> 'players' = '[{"cards": 2, "username": "MoreAnn"}, {"cards": 1, "username": "MoreBen"}]',
                'you see your own cards and who else is in');
select tests.ok((select count(*) from public.bingo_cards) = 1, 'other players'' cards are private');
reset role;
-- Ben's card gets a first column of 1 to 5; the balls will be 1 to 40 in order.
update public.bingo_cards set numbers = '{1,2,3,4,5, 16,17,18,19,20, 31,32,0,34,35, 46,47,48,49,50, 61,62,63,64,65}' where user_id = :B;
-- Ann's cards (not real ones) have nothing below 41, so they can't win.
update public.bingo_cards set numbers = '{41,42,43,44,45, 46,47,48,49,50, 51,52,0,54,55, 56,57,58,59,60, 71,72,73,74,75}' where user_id = :A;
select tests.bingo_skip(20);
select tests.rig(variadic array_fill(0, array[40]));
set role authenticated;
select tests.ok(public.bingo_state() #>> '{round,phase}' = 'calling' and public.bingo_state() -> 'called' = '[1]', 'calling starts with the first ball');
select tests.throws($$select public.bingo_buy(10, 1)$$, 'betting_closed');
reset role;
select tests.bingo_skip(4.5);
set role authenticated;
select tests.ok(public.bingo_state() -> 'called' = '[1, 2, 3, 4, 5]', 'one ball a second, and never one early');
select tests.ok(public.bingo_state() #> '{cards,0,line_at}' = 'null' and tests.bal(:B) = 10239 - 100, 'not paid until the round ends');
reset role;
select tests.bingo_skip(40);
set role authenticated;
create temp table so as select public.bingo_state() as r;
select tests.ok(r #>> '{round,phase}' = 'done' and jsonb_array_length(r -> 'called') = 40, 'all 40 balls called') from so;
select tests.ok(r #> '{cards,0}' @> '{"line_at":5,"payout":5000}', 'a line in five calls pays 50 times the card') from so;
select tests.ok(r -> 'winners' = '[{"payout": 5000, "line_at": 5, "username": "MoreBen"}]', 'winners') from so;
drop table so;
select tests.ok(tests.bal(:B) = 10139 + 5000, 'bingo paid');
select tests.throws($$select public.bingo_buy(10, 1)$$, 'next_round_pending');
reset role;
select tests.bingo_skip(8);
set role authenticated;
select public.bingo_buy(10, 1);
select tests.ok(public.bingo_state() #>> '{round,phase}' = 'selling' and jsonb_array_length(public.bingo_state() -> 'cards') = 1, 'a new round after the pause');
reset role;
select tests.bingo_skip(100);
select private.tick_stale_tables();   -- selling -> calling
select tests.bingo_skip(100);
select private.tick_stale_tables();   -- calling -> done
select tests.ok((select phase = 'done' from public.bingo_rounds order by round_no desc limit 1), 'a round nobody is watching is finished from the lobby');

-- ----------------------------------------------------------------------------
-- Books balance
-- ----------------------------------------------------------------------------
select tests.ok(private.chips_in_play(:A) = 0 and private.chips_in_play(:B) = 0, 'nothing left in play');
select tests.ok(not exists (
  select 1 from public.wallets w
   where w.user_id = :A
     and w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)
), 'ledger sums match the balance');
select tests.ok((select rounds_played from public.player_game_stats where user_id = :A and game_key = 'ultimate_holdem') = 4, 'stats');
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every public table');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('crash_rounds', 'crash_bets', 'bingo_rounds')) = 3, 'live rooms are broadcast');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('crash_secrets', 'bingo_secrets', 'bingo_cards')) = 0, 'secrets and cards are not');

delete from tests.dice;
delete from tests.decks;
delete from public.crash_rounds;
delete from public.bingo_rounds;
delete from auth.users where email like '%@more.test';

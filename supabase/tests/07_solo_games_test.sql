-- Phase 6 tests: baccarat, video poker, Three Card Poker, Pai Gow Poker, Sic Bo, keno and the Big Six wheel.
-- Decks come from tests.decks and random numbers from tests.dice (test database only).
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000006a1'''
\set B '''00000000-0000-0000-0000-0000000006b2'''

create table if not exists tests.dice (id serial primary key, v integer);
create or replace function private.random_int(p_n integer) returns integer language plpgsql volatile set search_path = '' as $$
declare r record;
begin
  select id, v into r from tests.dice order by id limit 1;
  if found then delete from tests.dice where id = r.id; return r.v; end if;
  return floor(random() * p_n)::int;
end $$;
-- The next shoe of any size is the next stacked deck, if there is one.
create table if not exists tests.decks (id serial primary key, cards smallint[]);
create or replace function private.shuffled_shoe(p_decks integer) returns smallint[] language plpgsql volatile set search_path = '' as $$
declare
  r record;
  v smallint[];
  n integer;
  j integer;
  t smallint;
begin
  select id, cards into r from tests.decks order by id limit 1;
  if found then
    delete from tests.decks where id = r.id;
    return r.cards;
  end if;
  select array_agg((g % 52)::smallint) into v from generate_series(0, p_decks * 52 - 1) g;
  n := cardinality(v);
  for i in reverse n..2 loop
    j := private.random_int(i) + 1;
    t := v[i]; v[i] := v[j]; v[j] := t;
  end loop;
  return v;
end $$;
create or replace function tests.rig(variadic p_vals integer[]) returns void language sql security definer as $$
  insert into tests.dice (v) select x from unnest(p_vals) with ordinality u(x, o) order by o
$$;
-- 'As Kh' -> five-card (or joker) hand values.
create or replace function tests.h5(p text) returns bigint language sql as $$
  select private.pgw_high(array(select case when x = 'Jk' then 52::smallint else tests.k(x) end
                                  from unnest(string_to_array(p, ' ')) with ordinality u(x, o) order by o))
$$;
create or replace function tests.c7(p text) returns smallint[] language sql as $$
  select array(select case when x = 'Jk' then 52::smallint else tests.k(x) end
                 from unnest(string_to_array(p, ' ')) with ordinality u(x, o) order by o)
$$;
create or replace function tests.vp(p_game text, p text) returns text language sql as $$
  select coalesce(private.vp_eval(p_game, tests.cards(p)), 'nothing')
$$;
create or replace function tests.open_rounds(p uuid) returns integer language sql security definer as $$
  select count(*)::integer from public.solo_rounds where user_id = p
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from tests.dice;
delete from tests.decks;
delete from auth.users where email like '%@solo.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@solo.test', '{"username":"SoloAnn"}'), (:B, 'b@solo.test', '{"username":"SoloBen"}');

select tests.ok((select count(*) from public.games where released and key in
  ('baccarat', 'video_poker_jacks', 'video_poker_deuces', 'three_card_poker', 'pai_gow_poker', 'sic_bo', 'keno', 'money_wheel')) = 8,
  'eight games released');

-- ----------------------------------------------------------------------------
-- Hand values
-- ----------------------------------------------------------------------------
select tests.ok(tests.h5('As Ks Qs Js Ts') > tests.h5('9h 9d 9c 9s 2d'), 'straight flush beats four of a kind');
select tests.ok(tests.h5('9h 9d 9c 9s 2d') > tests.h5('Kh Kd Kc 2s 2d'), 'four of a kind beats a full house');
select tests.ok(tests.h5('Kh Kd Kc 2s 2d') > tests.h5('Ah 9h 7h 4h 2h'), 'full house beats a flush');
select tests.ok(tests.h5('Ah 9h 7h 4h 2h') > tests.h5('9h 8d 7c 6s 5d'), 'flush beats a straight');
select tests.ok(tests.h5('6h 5d 4c 3s 2d') > tests.h5('Ah 5d 4c 3s 2d'), 'the wheel is the lowest straight');
select tests.ok(tests.h5('Ah 5d 4c 3s 2d') > tests.h5('Ah Ad Ac 3s 2d'), 'straight beats three of a kind');
select tests.ok(tests.h5('Ah Ad 4c 4s 2d') > tests.h5('Kh Kd Qc Qs Ad'), 'aces up beat kings up');
select tests.ok(tests.h5('Kh Kd Qc 4s 2d') > tests.h5('Kc Ks Jc 4h 2h'), 'kicker decides equal pairs');
-- the joker
select tests.ok(private.cg_cat5_name(tests.h5('Jk As Ah Ad Ac')) = 'five_aces', 'joker makes five aces');
select tests.ok(private.cg_cat5_name(tests.h5('Jk Kh Qd Jc Ts')) = 'straight' and tests.h5('Jk Kh Qd Jc Ts') = tests.h5('As Kh Qd Jc Ts'),
                'joker completes the ace-high straight');
select tests.ok(private.cg_cat5_name(tests.h5('Jk Kh 9h 5h 2h')) = 'flush' and tests.h5('Jk Kh 9h 5h 2h') = tests.h5('Ah Kh 9h 5h 2h'),
                'joker completes a flush as its ace');
select tests.ok(tests.h5('Jk Ah 9h 5h 2h') = tests.h5('Kh Ah 9h 5h 2h'), 'with the ace already there it is the next card up');
select tests.ok(private.cg_cat5_name(tests.h5('Jk 9s 8s 7s 6s')) = 'straight_flush', 'joker completes a straight flush');
select tests.ok(private.cg_cat5_name(tests.h5('Jk Kh Kd 7c 2s')) = 'pair' and tests.h5('Jk Kh Kd 7c 2s') = tests.h5('Ac Kh Kd 7c 2s'),
                'otherwise the joker is just an ace (it never pairs a king)');
select tests.ok(private.pgw_low(array[52, 0]::smallint[]) = 1014, 'joker and an ace: pair of aces in front');
select tests.ok(private.pgw_low(tests.cards('Kh 4d')) = 13 * 15 + 4, 'king-four');
-- the two-card hand may not outrank the five-card hand
select tests.ok(not private.pgw_valid(tests.h5('Kh Kd 7c 4s 2d'), private.pgw_low(tests.cards('As Ah'))), 'aces in front of kings is a foul');
select tests.ok(private.pgw_valid(tests.h5('As Ah 7c 4s 2d'), private.pgw_low(tests.cards('Kh Kd'))), 'kings in front of aces is fine');
select tests.ok(not private.pgw_valid(tests.h5('Qh Jd 9c 4s 2d'), private.pgw_low(tests.cards('As Kh'))), 'ace-king in front of queen high is a foul');
select tests.ok(private.pgw_valid(tests.h5('Ah Jd 9c 4s 2d'), private.pgw_low(tests.cards('Ks Qh'))), 'king-queen in front of ace high is fine');
-- the house way
select tests.ok(private.pgw_house_way(tests.c7('Ks Kh 8d 8c 7s 4h 2d')) = tests.cards('8d 8c'), 'two pair: split');
select tests.ok(private.pgw_house_way(tests.c7('As Kh Qd Jc Ts 9h 2d')) = tests.cards('As 2d'), 'keep the straight that leaves the best front');
select tests.ok(private.pgw_house_way(tests.c7('As Kh Jd 9c 7s 4h 2d')) = tests.cards('Kh Jd'), 'no pair: second and third highest in front');
select tests.ok(private.pgw_house_way(tests.c7('9s 9h 9d 4c 4s Ah 2d')) = tests.cards('4c 4s'), 'full house: split');
select tests.ok(private.pgw_house_way(tests.c7('Ks Kh 8d 8c 5s 5h 2d')) = tests.cards('Ks Kh'), 'three pair: highest in front');
select tests.ok(private.pgw_house_way(tests.c7('2s 2h 3d 3c As 9h 8d')) = tests.cards('As 9h'), 'small two pair with an ace: keep together');

-- Three Card Poker
select tests.ok(private.tcp_score(tests.cards('4s 3s 2s')) > private.tcp_score(tests.cards('Ah Ad Ac')), 'straight flush beats three of a kind');
select tests.ok(private.tcp_score(tests.cards('2h 2d 2c')) > private.tcp_score(tests.cards('Ah Kd Qc')), 'three of a kind beats a straight');
select tests.ok(private.tcp_score(tests.cards('4h 3d 2c')) > private.tcp_score(tests.cards('Ah Kh 9h')), 'a straight beats a flush (three cards)');
select tests.ok(private.tcp_score(tests.cards('7h 4h 2h')) > private.tcp_score(tests.cards('Ah Ad Kc')), 'a flush beats a pair');
select tests.ok(private.tcp_score(tests.cards('4h 3d 2c')) > private.tcp_score(tests.cards('Ah 2d 3c')), 'A-2-3 is the lowest straight');
select tests.ok(private.tcp_name(private.tcp_score(tests.cards('Ah 2d 3c'))) = 'straight', 'A-2-3 is a straight');
select tests.ok(private.tcp_score(tests.cards('Qh 3d 2c')) >= 2700 and private.tcp_score(tests.cards('Jh Td 8c')) < 2700, 'queen high is where the dealer qualifies');

-- Jacks or Better
select tests.ok(tests.vp('video_poker_jacks', 'As Ks Qs Js Ts') = 'royal_flush', 'royal flush');
select tests.ok(tests.vp('video_poker_jacks', '9s Ks Qs Js Ts') = 'straight_flush', 'straight flush');
select tests.ok(tests.vp('video_poker_jacks', '9s 9h 9d 9c Ts') = 'four_kind', 'four of a kind');
select tests.ok(tests.vp('video_poker_jacks', '9s 9h 9d Tc Ts') = 'full_house', 'full house');
select tests.ok(tests.vp('video_poker_jacks', '2s 9s 4s Js Ts') = 'flush', 'flush');
select tests.ok(tests.vp('video_poker_jacks', 'As 2h 3d 4c 5s') = 'straight', 'wheel straight');
select tests.ok(tests.vp('video_poker_jacks', '9s 9h 9d 4c 5s') = 'three_kind', 'three of a kind');
select tests.ok(tests.vp('video_poker_jacks', '9s 9h 4d 4c 5s') = 'two_pair', 'two pair');
select tests.ok(tests.vp('video_poker_jacks', 'Js Jh 4d 7c 5s') = 'jacks_or_better', 'pair of jacks');
select tests.ok(tests.vp('video_poker_jacks', 'As Ah 4d 7c 5s') = 'jacks_or_better', 'pair of aces');
select tests.ok(tests.vp('video_poker_jacks', 'Ts Th 4d 7c 5s') = 'nothing', 'tens are not enough');
select tests.ok(tests.vp('video_poker_jacks', 'As Kh 4d 7c 5s') = 'nothing', 'no pair');
-- Deuces Wild
select tests.ok(tests.vp('video_poker_deuces', 'As Ks Qs Js Ts') = 'natural_royal', 'natural royal');
select tests.ok(tests.vp('video_poker_deuces', '2s 2h 2d 2c Ts') = 'four_deuces', 'four deuces');
select tests.ok(tests.vp('video_poker_deuces', '2h Ks Qs Js Ts') = 'wild_royal', 'wild royal');
select tests.ok(tests.vp('video_poker_deuces', '2h 2d As Ah Ad') = 'five_kind', 'five of a kind');
select tests.ok(tests.vp('video_poker_deuces', '2h 5s 6s 7s 8s') = 'straight_flush', 'straight flush with a deuce');
select tests.ok(tests.vp('video_poker_deuces', '2h 2d 4s 9s Kd') = 'three_kind', 'two deuces and no help: three of a kind');
select tests.ok(tests.vp('video_poker_deuces', '2h 2d 4s 4h Ad') = 'four_kind', 'two deuces and a pair');
select tests.ok(tests.vp('video_poker_deuces', '2h 7d 7s 4h 4d') = 'full_house', 'deuce and two pair');
select tests.ok(tests.vp('video_poker_deuces', '2h 7s 9s 4s Ks') = 'flush', 'flush with a deuce');
select tests.ok(tests.vp('video_poker_deuces', '2h 3d 4s 5h 7c') = 'straight', 'deuce fills the gap');
select tests.ok(tests.vp('video_poker_deuces', '2h As 3d 4s 5h') = 'straight', 'ace plays low');
select tests.ok(tests.vp('video_poker_deuces', '2h 9d 9s 5h Kc') = 'three_kind', 'deuce and a pair');
select tests.ok(tests.vp('video_poker_deuces', '2h 9d Ts 5h Kc') = 'nothing', 'one deuce alone pays nothing');
select tests.ok(tests.vp('video_poker_deuces', 'Kh Kd Ts 5h 5c') = 'nothing', 'two pair pays nothing');

-- Baccarat drawing rules: cards go player, banker, player, banker, then thirds.
select tests.ok(private.bac_play(tests.cards('4s Ks 5h Qd 9c 9d')) @> '{"outcome":"player","natural":true,"player_total":9,"banker_total":0}', 'natural nine stands');
select tests.ok(jsonb_array_length(private.bac_play(tests.cards('4s Ks 5h Qd 9c 9d')) -> 'player') = 2, 'no third cards after a natural');
-- player 5 draws an 8 (total 3); banker 3 stands against an 8
select tests.ok(private.bac_play(tests.cards('2s Ks 3h 3d 8c 9d')) @> '{"player_total":3,"banker_total":3,"outcome":"tie"}', 'banker on 3 stands when the player draws an 8');
select tests.ok(jsonb_array_length(private.bac_play(tests.cards('2s Ks 3h 3d 8c 9d')) -> 'banker') = 2, 'banker took no card');
-- player 5 draws a 4 (total 9); banker 5 draws
select tests.ok(private.bac_play(tests.cards('2s 2h 3h 3d 4c 4d')) @> '{"player_total":9,"banker_total":9,"outcome":"tie"}', 'banker on 5 draws against a 4');
-- player stands on 6; banker 5 draws
select tests.ok(private.bac_play(tests.cards('2s 2h 4h 3d 9c 9d')) @> '{"player_total":6,"banker_total":4,"outcome":"player"}', 'banker draws when the player stands and it has 5');
-- player stands on 7; banker 6 stands
select tests.ok(private.bac_play(tests.cards('3s 2h 4h 4d 9c 9d')) @> '{"player_total":7,"banker_total":6,"outcome":"player"}', 'banker on 6 stands when the player stands');
select tests.ok(private.bac_play(tests.cards('7s 2h 7h 4d 9c 9d')) @> '{"player_pair":true,"banker_pair":false}', 'player pair');

-- Sic Bo: every one of the 216 rolls
create temp table sb_all as
select array[a, b, c] as d from generate_series(1, 6) a, generate_series(1, 6) b, generate_series(1, 6) c;
create or replace function tests.sb_return(p_spot text) returns numeric language sql as $$
  select round(100.0 * sum(coalesce(private.sb_pays(p_spot, d) + 1, 0)) / 216, 2) from sb_all
$$;
select tests.ok(tests.sb_return('small') = 97.22 and tests.sb_return('big') = 97.22, 'small and big return 97.22%');
select tests.ok(tests.sb_return('odd') = 97.22 and tests.sb_return('even') = 97.22, 'odd and even too');
select tests.ok(tests.sb_return('single_3') = 92.13, 'a single number returns 92.13%');
select tests.ok(tests.sb_return('double_2') = 81.48, 'a double');
select tests.ok(tests.sb_return('triple_6') = 83.80, 'a named triple');
select tests.ok(tests.sb_return('any_triple') = 86.11, 'any triple');
select tests.ok(tests.sb_return('combo_2_5') = 83.33, 'two-dice combination');
select tests.ok(tests.sb_return('total_4') = 84.72 and tests.sb_return('total_17') = 84.72, 'totals of 4 and 17');
select tests.ok(tests.sb_return('total_10') = 87.50 and tests.sb_return('total_11') = 87.50, 'totals of 10 and 11');
select tests.ok((select bool_and(tests.sb_return('total_' || n) between 80 and 91) from generate_series(4, 17) n), 'every total is in a sane range');
drop table sb_all;

-- Keno: exact return for each number of picks (hypergeometric).
create or replace function tests.choose(n integer, k integer) returns numeric language sql immutable as $$
  select case when k < 0 or k > n then 0 else coalesce(exp(sum(ln((n - k + i)::numeric / i))), 1) end from generate_series(1, k) i
$$;
select tests.ok((
  select bool_and(rtp between 93.5 and 95.1) from (
    select p.key, sum((h.value #>> '{}')::numeric * tests.choose(p.key::int, h.key::int) * tests.choose(80 - p.key::int, 20 - h.key::int)
                      / tests.choose(80, 20)) as rtp
      from jsonb_each(private.solo_cfg('keno') -> 'returns') p, jsonb_each(p.value) h group by p.key) x
), 'keno returns 93.5 to 95.1% whatever you pick');
select tests.ok(not exists (
  select 1 from jsonb_each(private.solo_cfg('keno') -> 'returns') p, jsonb_each(p.value) h where (h.value #>> '{}')::int % 10 <> 0
), 'keno prizes are multiples of 10 units: whole chips');

-- The wheel
select tests.ok(jsonb_array_length(private.solo_cfg('money_wheel') -> 'wheel') = 54, '54 segments');
select tests.ok((select jsonb_object_agg(s, n) from (select s, count(*) n from jsonb_array_elements_text(private.solo_cfg('money_wheel') -> 'wheel') s group by s) x)
                = '{"x1":24,"x2":15,"x5":7,"x10":4,"x20":2,"joker":1,"logo":1}', 'the right number of each segment');

-- Baccarat over many shoes, and Pai Gow played the house way on both sides.
select tests.ok(count(*) filter (where o = 'banker') between 0.42 * count(*) and 0.50 * count(*)
            and count(*) filter (where o = 'player') between 0.41 * count(*) and 0.49 * count(*)
            and count(*) filter (where o = 'tie') between 0.07 * count(*) and 0.125 * count(*),
                format('baccarat outcomes: banker %s, player %s, tie %s', count(*) filter (where o = 'banker'),
                       count(*) filter (where o = 'player'), count(*) filter (where o = 'tie')))
  from (select private.bac_play((private.shuffled_shoe(8))[1:6]) ->> 'outcome' as o from generate_series(1, 3000)) s;
select tests.ok(count(*) filter (where low is null) = 0 and count(*) filter (where low is not null) = 300,
                'the house way always finds a legal hand')
  from (select private.pgw_house_way((private.pgw_deck())[1:7]) as low from generate_series(1, 300)) s;

-- ----------------------------------------------------------------------------
-- What the browser can and can't do
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.solo_info('baccarat') #>> '{config,pays,tie}' = '8', 'paytable');
select tests.ok(jsonb_array_length(public.solo_info('baccarat') -> 'tiers') = 4, 'stake levels');
select tests.ok(public.solo_info('keno') -> 'round' = 'null', 'no round waiting');
select tests.throws($$select public.solo_info('blackjack')$$, 'unknown_game');
select tests.throws($$select * from public.solo_secrets$$, 'permission denied');
select tests.throws($$insert into public.solo_rounds (user_id, game_key, tier, staked) values (auth.uid(), 'keno', 'low', 0)$$, 'permission denied');
select tests.throws($$select private.pgw_house_way('{0,1,2,3,4,5,6}')$$, 'permission denied');
-- bet checks
select tests.throws($$select public.baccarat_deal('low', '{}')$$, 'invalid_bet');
select tests.throws($$select public.baccarat_deal('low', '{"dragon": 10}')$$, 'invalid_bet');
select tests.throws($$select public.baccarat_deal('low', '{"player": 5}')$$, 'bet_out_of_range');
select tests.throws($$select public.baccarat_deal('low', '{"player": 501}')$$, 'bet_out_of_range');
select tests.throws($$select public.baccarat_deal('low', '{"player": 10.5}')$$, 'invalid_amount');
select tests.throws($$select public.baccarat_deal('low', '{"player": "10"}')$$, 'invalid_amount');
select tests.throws($$select public.baccarat_deal('high', '{"player": 1000}')$$, 'tier_locked');
select tests.throws($$select public.baccarat_deal('huge', '{"player": 10}')$$, 'unknown_stake_tier');
select tests.throws($$select public.sicbo_roll('low', '{"total_3": 10}')$$, 'invalid_bet');
select tests.throws($$select public.sicbo_roll('low', '{"combo_2_2": 10}')$$, 'invalid_bet');
select tests.throws($$select public.sicbo_roll('low', '{"combo_3_2": 10}')$$, 'invalid_bet');
select tests.throws($$select public.wheel_spin('low', '{"x3": 10}')$$, 'invalid_bet');
select tests.throws($$select public.keno_draw(10, '{}')$$, 'invalid_picks');
select tests.throws($$select public.keno_draw(10, '{1,2,3,4,5,6,7,8,9,10,11}')$$, 'invalid_picks');
select tests.throws($$select public.keno_draw(10, '{1,1}')$$, 'invalid_picks');
select tests.throws($$select public.keno_draw(10, '{0,5}')$$, 'invalid_picks');
select tests.throws($$select public.keno_draw(10, '{81}')$$, 'invalid_picks');
select tests.throws($$select public.keno_draw(15, '{1}')$$, 'invalid_amount');
select tests.throws($$select public.keno_draw(60000, '{1}')$$, 'bet_out_of_range');
select tests.throws($$select public.vp_deal('keno', 10)$$, 'unknown_game');
select tests.throws($$select public.vp_draw('video_poker_jacks', '{t,t,t,t,t}')$$, 'no_round');
select tests.throws($$select public.tcp_act(true)$$, 'no_round');
select tests.throws($$select public.pgw_set(null)$$, 'no_round');
select tests.ok(tests.bal(:A) = 10000, 'rejected bets cost nothing');
reset role;
set role anon;
select tests.throws($$select public.keno_draw(10, '{1}')$$, 'permission denied');
reset role;

-- ----------------------------------------------------------------------------
-- Baccarat
-- ----------------------------------------------------------------------------
select tests.deck('4s Ks 5h Qd');                 -- player 9, banker 0
set role authenticated;
select tests.as_user(:A);
create temp table so as select public.baccarat_deal('low', '{"player": 100, "banker": 50, "tie": 10}') as r;
select tests.ok(r @> '{"outcome":"player","win":200,"staked":160}' and r -> 'returns' = '{"player":200,"banker":0,"tie":0}', 'player bet pays 1 to 1') from so;
select tests.ok(tests.bal(:A) = 10000 - 160 + 200, 'baccarat paid');
drop table so;
reset role;
select tests.deck('Ks 4s Qd 5h');                 -- banker 9
set role authenticated;
create temp table so as select public.baccarat_deal('low', '{"banker": 100}') as r;
select tests.ok(r @> '{"outcome":"banker","win":195,"commission":5}', 'banker pays 1 to 1 less 5%') from so;
drop table so;
reset role;
select tests.deck('Ks 4s Qd 5h');
set role authenticated;
select tests.ok(public.baccarat_deal('low', '{"banker": 10}') @> '{"win":19,"commission":1}', 'commission is rounded up to a whole chip');
reset role;
select tests.deck('4s 9h 5h Kd');                 -- 9 against 9
set role authenticated;
create temp table so as select public.baccarat_deal('low', '{"player": 100, "tie": 10, "banker": 20}') as r;
select tests.ok(r @> '{"outcome":"tie","win":210}' and r -> 'returns' = '{"player":100,"banker":20,"tie":90}', 'a tie pays 8 to 1 and returns player and banker bets') from so;
drop table so;
reset role;
select tests.deck('7s Kh 7h 2d 9c');              -- player 7-7 (4, draws 9 = 3); banker 2 draws
set role authenticated;
select tests.ok((public.baccarat_deal('low', '{"player_pair": 10, "banker_pair": 10}') -> 'returns') = '{"player_pair":120,"banker_pair":0}', 'a pair pays 11 to 1');
select tests.ok(tests.bal(:A) = 10040 - 100 + 195 - 10 + 19 - 130 + 210 - 20 + 120, 'baccarat sums');
reset role;

-- ----------------------------------------------------------------------------
-- Video poker
-- ----------------------------------------------------------------------------
select tests.deck('As Ks Qs Js 2d Ts 9h');
set role authenticated;
create temp table so as select public.vp_deal('video_poker_jacks', 10) as r;
select tests.ok(r -> 'hand' = to_jsonb(tests.cards('As Ks Qs Js 2d')) and r ->> 'made' is null, 'five cards dealt') from so;
select tests.ok(tests.bal(:A) = 10324 - 10 and (public.get_economy_status() ->> 'chips_in_play')::int = 10, 'the bet is in play until the draw');
select tests.ok(public.solo_info('video_poker_jacks') -> 'round' -> 'hand' = to_jsonb(tests.cards('As Ks Qs Js 2d')), 'the hand waits if you leave');
select tests.ok(not (public.solo_info('video_poker_jacks') -> 'round' ? 'deck'), 'the deck is not in what the browser sees');
select tests.throws($$select public.vp_deal('video_poker_jacks', 10)$$, 'round_in_progress');
select tests.throws($$select public.vp_draw('video_poker_jacks', '{t,t,t,t}')$$, 'invalid_hand');
select tests.throws($$select public.vp_draw('video_poker_deuces', '{t,t,t,t,t}')$$, 'no_round');
drop table so;
create temp table so as select public.vp_draw('video_poker_jacks', '{t,t,t,t,f}') as r;
select tests.ok(r -> 'hand' = to_jsonb(tests.cards('As Ks Qs Js Ts')) and r @> '{"made":"royal_flush","win":8000}', 'drew the ten: royal flush pays 800 for 1') from so;
select tests.ok(tests.bal(:A) = 10314 + 8000 and tests.open_rounds(:A) = 0, 'royal paid and the round is closed');
drop table so;
reset role;
select tests.deck('2h 9d 9s 5h Kc 9c 2d');
set role authenticated;
select public.vp_deal('video_poker_deuces', 100);
select tests.ok(public.solo_info('video_poker_deuces') #>> '{round,made}' = 'three_kind', 'made hand shown before the draw');
select tests.ok(public.vp_draw('video_poker_deuces', '{t,t,t,f,f}') @> '{"made":"five_kind","win":1600}', 'two more: five of a kind pays 16 for 1');
select tests.ok(tests.bal(:A) = 18314 - 100 + 1600, 'deuces paid');
reset role;

-- ----------------------------------------------------------------------------
-- Three Card Poker
-- ----------------------------------------------------------------------------
select tests.deck('As Ks Qs 2d 3h 5c');           -- straight flush against five high
set role authenticated;
create temp table so as select public.tcp_deal('low', 100, 50) as r;
select tests.ok(r -> 'hand' = to_jsonb(tests.cards('As Ks Qs')) and r ->> 'made' = 'straight_flush' and not (r ? 'dealer'), 'three cards, dealer hidden') from so;
select tests.ok(tests.bal(:A) = 19814 - 150, 'ante and pair plus taken');
drop table so;
create temp table so as select public.tcp_act(true) as r;
select tests.ok(r @> '{"outcome":"no_qualify","qualifies":false,"staked":250,"win":2850}', 'dealer does not qualify') from so;
select tests.ok(r -> 'returns' = '{"ante":200,"play":100,"ante_bonus":500,"pair_plus":2050}', 'ante 1 to 1, play back, bonus 5 to 1, pair plus 40 to 1') from so;
select tests.ok(r -> 'dealer' = to_jsonb(tests.cards('2d 3h 5c')), 'dealer shown at the end') from so;
select tests.ok(tests.bal(:A) = 19814 - 250 + 2850, 'three card poker paid');
drop table so;
reset role;
select tests.deck('Kh 9d 4s Ah Qd 7c');           -- king high against ace high
set role authenticated;
select public.tcp_deal('low', 100);
select tests.ok(public.tcp_act(true) @> '{"outcome":"lose","qualifies":true,"win":0,"staked":200}', 'dealer qualifies and wins: ante and play lose');
reset role;
select tests.deck('9h 9d 4s Ah Qd 7c');
set role authenticated;
select public.tcp_deal('low', 100, 10);
select tests.ok(public.tcp_act(true) @> '{"outcome":"win","win":420}', 'a pair wins ante and play 1 to 1, pair plus 1 to 1');
reset role;
select tests.deck('Jh 8d 4s Ah Qd 7c');
set role authenticated;
select public.tcp_deal('low', 100);
select tests.ok(public.tcp_act(false) @> '{"outcome":"fold","win":0,"staked":100}', 'folding loses only the ante');
select tests.ok(tests.bal(:A) = 22414 - 200 - 210 + 420 - 100, 'three card poker sums');
reset role;
update public.wallets set balance = 150 where user_id = :B;
set role authenticated;
select tests.as_user(:B);
select tests.throws($$select public.tcp_deal('low', 100)$$, 'insufficient_chips');
select tests.as_user(:A);
reset role;
update public.wallets set balance = 10000 where user_id = :B;

-- ----------------------------------------------------------------------------
-- Pai Gow Poker
-- ----------------------------------------------------------------------------
select tests.deck('As Ah Kd Kc 7s 4h 2d Qs Jh 9d 8c 6s 4d 3h');
select tests.rig(52);                              -- joker at the bottom of the deck
set role authenticated;
create temp table so as select public.pgw_deal('low', 100) as r;
select tests.ok(r -> 'house_way' = to_jsonb(tests.cards('Kd Kc')), 'the house way is offered') from so;
drop table so;
select tests.throws($$select public.pgw_set('{0, 13}')$$, 'invalid_hand');      -- aces in front of kings
select tests.throws($$select public.pgw_set('{0, 0}')$$, 'invalid_hand');
select tests.throws($$select public.pgw_set('{0, 50}')$$, 'invalid_hand');      -- not in the hand
select tests.throws($$select public.pgw_set('{0}')$$, 'invalid_hand');
create temp table so as select public.pgw_set(null) as r;
select tests.ok(r @> '{"outcome":"win","high_wins":true,"low_wins":true,"commission":5,"win":195}', 'won both hands: 1 to 1 less 5%') from so;
select tests.ok(r @> '{"high_made":"pair","low_made":"pair","dealer_high_made":"high_card","dealer_low_made":"high_card"}', 'hand names') from so;
select tests.ok(r -> 'dealer_low' = to_jsonb(tests.cards('Jh 9d')), 'dealer set the house way') from so;
drop table so;
reset role;
select tests.deck('As Ah Kd Kc 7s 4h 2d Qs Jh 9d 8c 6s 4d 3h');
select tests.rig(52);
set role authenticated;
select public.pgw_deal('low', 100);
-- 7-4 in front: wins the high hand (two pair), loses the low hand (7-4 against J-9)
select tests.ok(public.pgw_set(tests.cards('7s 4h')) @> '{"outcome":"push","high_wins":true,"low_wins":false,"win":100}', 'one hand each is a push');
reset role;
select tests.deck('Qs Jh 9d 8c 6s 4d 3h As Ah Kd Kc 7s 4h 2d');
select tests.rig(52);
set role authenticated;
select public.pgw_deal('low', 100);
select tests.ok(public.pgw_set() @> '{"outcome":"lose","win":0}', 'lost both');
reset role;
select tests.deck('Qs Jh 9d 8c 6s 4d 3h Qh Jd 9c 8s 6h 4c 3d');   -- identical hands
select tests.rig(52);
set role authenticated;
select public.pgw_deal('low', 100);
select tests.ok(public.pgw_set() @> '{"outcome":"lose","high_wins":false,"low_wins":false}', 'the dealer wins exact ties');
reset role;
select tests.deck('Ks Qh Jd Tc 4s 3h 9d 8c 6s 4d 3d 2c 7h 7d');
select tests.rig(0);                               -- joker is the player's first card
set role authenticated;
create temp table so as select public.pgw_deal('low', 10) as r;
select tests.ok((r -> 'hand' ->> 0)::int = 52, 'joker dealt') from so;
drop table so;
select tests.ok(public.pgw_set() @> '{"high_made":"straight"}', 'the joker made the straight');
select tests.ok(tests.bal(:A) = 22324 - 100 + 195 - 100 + 100 - 100 - 100 - 10 + (select returned from public.game_history
                                    where user_id = :A and game_key = 'pai_gow_poker' order by id desc limit 1), 'pai gow sums');
reset role;

-- ----------------------------------------------------------------------------
-- Sic Bo, keno, the wheel
-- ----------------------------------------------------------------------------
select tests.rig(0, 1, 2);                         -- 1, 2, 3
set role authenticated;
select tests.as_user(:B);
create temp table so as select public.sicbo_roll('low', '{"small": 100, "big": 100, "total_6": 10, "single_1": 10, "combo_1_2": 10, "double_1": 10}') as r;
select tests.ok(r @> '{"dice":[1,2,3],"total":6,"triple":false,"staked":240,"win":460}', 'rolled 1-2-3') from so;
select tests.ok(r -> 'returns' = '{"small":200,"big":0,"total_6":180,"single_1":20,"combo_1_2":60,"double_1":0}', 'sic bo payouts') from so;
drop table so;
reset role;
select tests.rig(4, 4, 4);                         -- 5, 5, 5
set role authenticated;
select tests.ok((public.sicbo_roll('low', '{"small": 10, "big": 10, "odd": 10, "any_triple": 10, "triple_5": 10, "double_5": 10, "single_5": 10, "total_15": 10}') -> 'returns')
                = '{"small":0,"big":0,"odd":0,"any_triple":310,"triple_5":1810,"double_5":110,"single_5":40,"total_15":180}', 'a triple beats small, big and odd');
select tests.ok(tests.bal(:B) = 10000 - 240 + 460 - 80 + 2450, 'sic bo sums');
reset role;

select tests.rig(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);   -- balls 1 to 20
set role authenticated;
create temp table so as select public.keno_draw(10, '{1,2,3,4,5}') as r;
select tests.ok(r -> 'drawn' = to_jsonb(array(select generate_series(1, 20))) and r -> 'hits' = '[1,2,3,4,5]', '20 balls, five hits') from so;
select tests.ok(r @> '{"units":60000,"win":6000}', 'five out of five pays 600 times the bet') from so;
drop table so;
reset role;
select tests.rig(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
set role authenticated;
select tests.ok(public.keno_draw(100, '{21,22,23,24,25,26,27,28,29,30}') @> '{"units":200,"win":200}', 'ten picks, none drawn: double your bet back');
select tests.ok(jsonb_array_length(public.keno_draw(10, '{7}') -> 'drawn') = 20 , 'an unstacked draw has 20 different balls');
select tests.ok((select count(distinct x) from jsonb_array_elements(public.keno_draw(10, '{7}') -> 'drawn') x) = 20, 'all different');
reset role;

select tests.rig(0);
set role authenticated;
select tests.ok(public.wheel_spin('low', '{"joker": 10, "x1": 100}') @> '{"stop":0,"symbol":"joker","win":460}', 'joker pays 45 to 1');
reset role;
select tests.rig(2);
set role authenticated;
select tests.ok(public.wheel_spin('low', '{"joker": 10, "x1": 100}') @> '{"stop":2,"symbol":"x1","win":200}', 'x1 pays even chips');
reset role;

-- ----------------------------------------------------------------------------
-- Books balance
-- ----------------------------------------------------------------------------
select tests.ok(private.chips_in_play(:A) = 0 and private.chips_in_play(:B) = 0, 'nothing left in play');
select tests.ok(tests.open_rounds(:A) = 0 and (select count(*) from public.solo_secrets) = 0, 'no rounds or secrets left behind');
select tests.ok(not exists (
  select 1 from public.wallets w
   where w.user_id = :A
     and w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)
), 'ledger sums match the balance');
select tests.ok((select count(*) from public.game_history where user_id = :A and game_key = 'baccarat') = 5, 'history rows');
select tests.ok((select rounds_played = 4 and rounds_won = 2 and rounds_lost = 2 from public.player_game_stats
                  where user_id = :A and game_key = 'three_card_poker'), 'stats');
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every public table');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'solo%') = 0, 'solo rounds are not broadcast');

delete from tests.dice;
delete from tests.decks;
delete from auth.users where email like '%@solo.test';

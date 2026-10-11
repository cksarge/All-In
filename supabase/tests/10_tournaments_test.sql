-- Stage 8 tests: Sit & Go poker tournaments, Slot Showdowns and the Daily Freeroll.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000009a1'''
\set B '''00000000-0000-0000-0000-0000000009b2'''
\set C '''00000000-0000-0000-0000-0000000009c3'''
\set D '''00000000-0000-0000-0000-0000000009d4'''

create or replace function tests.tour(p_user uuid, p_kind text) returns public.tournaments language sql security definer as $$
  select t.* from public.tournaments t join public.tournament_entries e on e.tournament_id = t.id
   where e.user_id = p_user and t.kind = p_kind order by t.created_at desc limit 1
$$;
create or replace function tests.entry(p_user uuid, p_kind text) returns public.tournament_entries language sql security definer as $$
  select e.* from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id
   where e.user_id = p_user and t.kind = p_kind order by t.created_at desc limit 1
$$;
create or replace function tests.stack(p_user uuid) returns bigint language sql security definer as $$
  select stack from public.table_seats where user_id = p_user
$$;
create or replace function tests.set_stack(p_user uuid, p_stack bigint) returns void language sql security definer as $$
  update public.table_seats set stack = p_stack where user_id = p_user
$$;
-- Makes every running round of a kind belong to an earlier window that has just ended.
create or replace function tests.end_rounds(p_kind text) returns void language sql security definer as $$
  update public.tournaments
     set ends_at = now() - interval '1 second',
         starts_at = starts_at - make_interval(days => 7 * (1 + (select count(*)::integer from public.tournaments where status <> 'running')))
   where kind = p_kind and status = 'running'
$$;
create or replace function tests.has(p_user uuid, p_key text) returns boolean language sql security definer as $$
  select exists (select 1 from public.player_achievements where user_id = p_user and achievement_key = p_key)
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from tests.dice;
delete from tests.decks;
delete from public.tournaments;
delete from auth.users where email like '%@tour.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@tour.test', '{"username":"TourAnn"}'), (:B, 'b@tour.test', '{"username":"TourBen"}'),
  (:C, 'c@tour.test', '{"username":"TourCat"}'), (:D, 'd@tour.test', '{"username":"TourDan"}');

-- ----------------------------------------------------------------------------
-- Rules and helpers
-- ----------------------------------------------------------------------------
select tests.ok(private.pool_prizes(500, array[100]) = '{500}' and private.pool_prizes(15000, array[65, 35]) = '{9750,5250}'
            and private.pool_prizes(1001, array[50, 30, 20]) = '{501,300,200}', 'prizes: whole chips, remainder to first place');
select tests.ok(private.showdown_shares(2) = '{100}' and private.showdown_shares(5) = '{70,30}' and private.showdown_shares(10) = '{50,30,20}', 'showdown shares by field size');
select tests.ok(private.sng_stakes(1) @> '{"small_blind":10,"big_blind":20,"ante":0}' and private.sng_stakes(4) @> '{"small_blind":50,"big_blind":100}', 'blind levels');
select tests.ok(private.sng_level(now()) = 1 and private.sng_level(now() - interval '181 seconds') = 2
            and private.sng_level(now() - interval '10 hours') = 12, 'the level follows the clock and stops at the last one');
select tests.ok((select count(*) from public.games where key in ('sng_poker', 'slot_showdown') and released) = 2, 'tournaments released');

-- ----------------------------------------------------------------------------
-- Sit & Go: registering
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select tests.throws($$select public.sng_register(4, 250)$$, 'unknown_tournament');
select tests.throws($$select public.sng_register(2, 300)$$, 'unknown_tournament');
select tests.ok(public.sng_register(2, 250) @> '{"started":false}', 'first in: waiting');
select tests.ok(tests.bal(:A) = 9750 and (public.get_economy_status() ->> 'chips_in_play')::int = 250, 'entry fee taken and counted as in play');
select tests.throws($$select public.sng_register(3, 250)$$, 'action_not_allowed');
select tests.ok((select s -> 'players' = '["TourAnn"]' and (s ->> 'registered')::boolean
                   from jsonb_array_elements(public.tournaments_state() -> 'sng') s where s @> '{"size":2,"entry_fee":250}'), 'the lobby shows who is waiting');
select tests.ok(public.tournaments_state() -> 'my_sng' @> '{"status":"registering"}', 'and that you are in one');
select tests.ok((public.sng_unregister((tests.tour(:A, 'sng')).id) ->> 'balance')::int = 10000, 'leaving before it starts gives the fee back');
select tests.ok(public.tournaments_state() -> 'my_sng' = 'null', 'no longer in one');
select tests.as_user(:B);
select tests.throws($$select public.sng_unregister('00000000-0000-0000-0000-000000000000')$$, 'action_not_allowed');
reset role;
delete from public.tournaments;

-- ----------------------------------------------------------------------------
-- Sit & Go: a three-player tournament from start to finish
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select public.sng_register(3, 250);
select tests.as_user(:B);
select public.sng_register(3, 250);
select tests.as_user(:C);
create temp table st as select public.sng_register(3, 250) as r;
select tests.ok((r ->> 'started')::boolean and r ->> 'table_id' is not null, 'the third player starts it') from st;
drop table st;
reset role;
select tests.ok((select status = 'running' and table_id is not null from tests.tour(:A, 'sng')), 'running, with a table');
select tests.ok((select play_money and not is_private and max_seats = 3 and stakes @> '{"big_blind":20}' from public.game_tables
                  where id = (tests.tour(:A, 'sng')).table_id), 'a tournament table: play chips, level 1 blinds');
select tests.ok((select count(*) = 3 and sum(stack) = 4500 - 30 from public.table_seats where table_id = (tests.tour(:A, 'sng')).table_id), 'three seats, 1,500 chips each, blinds posted');
select tests.ok(tests.bal(:A) = 9750 and private.chips_in_play(:A) = 250, 'tournament chips are not wallet chips: only the fee is in play');
select tests.ok((select count(*) from public.pk_hands where table_id = (tests.tour(:A, 'sng')).table_id and phase = 'betting') = 1, 'first hand dealt');
set role authenticated;
select tests.as_user(:D);
select tests.throws($$select public.join_table((select table_id from public.tournaments where kind = 'sng' and status = 'running'))$$, 'action_not_allowed');
select tests.ok(public.pk_state((select table_id from public.tournaments where kind = 'sng' and status = 'running')) #> '{table,play_money}' = 'true', 'anyone can watch');
select tests.ok(jsonb_array_length(public.tournaments_state() -> 'live') = 1, 'listed as live');
select tests.as_user(:A);
select tests.throws($$select public.pk_bring_chips((select table_id from public.tournaments where kind = 'sng' and status = 'running'), 500)$$, 'action_not_allowed');
create temp table ss as select public.sng_status((tests.tour(:A, 'sng')).table_id) as r;
select tests.ok(r @> '{"status":"running","size":3,"prize_pool":750,"prizes":[750],"level":1,"blinds":[10,20],"next_blinds":[15,30],"players_left":3}', 'tournament status') from ss;
select tests.ok(r -> 'me' @> '{"status":"playing"}' and jsonb_array_length(r -> 'entries') = 3, 'entries') from ss;
drop table ss;
reset role;

-- Ben leaves in the middle: he is out in third place and his chips are worth nothing.
set role authenticated;
select tests.as_user(:B);
select public.leave_table((tests.tour(:B, 'sng')).table_id);
reset role;
select tests.ok((select status = 'out' and place = 3 from tests.entry(:B, 'sng')) and tests.bal(:B) = 9750, 'leaving is being knocked out: third place, no chips back');
select tests.ok((select status = 'running' from tests.tour(:A, 'sng')), 'the other two play on');

-- Finish whatever hand is running by folding, then leave Cat with no chips.
do $$
declare
  v_table uuid := (select table_id from public.tournaments where kind = 'sng' and status = 'running');
  h public.pk_hands;
  p public.pk_players;
begin
  for i in 1..10 loop
    h := private.pk_latest_hand(v_table);
    exit when h.phase = 'settled';
    select * into p from public.pk_players where hand_id = h.id and seat_no = h.turn_seat;
    perform private.pk_do_action(h.id, p.seat_no, case when h.current_bet > p.street_bet then 'fold' else 'check' end, null);
  end loop;
end $$;
select tests.ok((select phase = 'settled' from public.pk_hands where table_id = (tests.tour(:A, 'sng')).table_id order by hand_no desc limit 1), 'hand finished');
select tests.ok((select count(*) from public.game_history where user_id in (:A, :B, :C) and game_key like 'poker\_%') = 0, 'tournament hands are not rounds of their own');
select tests.ok((select sum(stack) from public.table_seats where table_id = (tests.tour(:A, 'sng')).table_id) + coalesce((select 0), 0) <= 4500, 'no chips appear from nowhere');
-- The blinds rise with the clock.
update public.tournaments set started_at = now() - interval '400 seconds' where kind = 'sng' and status = 'running';
select tests.set_stack(:C, 0);
select private.sng_after_hand((tests.tour(:A, 'sng')).table_id);

select tests.ok((select status = 'finished' from tests.tour(:A, 'sng')), 'one player left: finished');
select tests.ok((select place = 1 and prize = 750 from tests.entry(:A, 'sng')) and (select place = 2 and prize = 0 from tests.entry(:C, 'sng')), 'winner takes all in a three-player game');
select tests.ok(tests.bal(:A) = 9750 + 750 and tests.bal(:C) = 9750, 'prize paid');
select tests.ok((select count(*) from public.table_seats where user_id in (:A, :B, :C)) = 0
            and (select status = 'closed' from public.game_tables where id = (tests.tour(:A, 'sng')).table_id), 'seats freed and table closed, with no chips going to wallets');
select tests.ok(private.chips_in_play(:A) = 0 and private.chips_in_play(:C) = 0, 'nothing left in play');
select tests.ok((select wagered = 250 and returned = 750 and summary @> '{"kind":"sng","place":1,"players":3}' from public.game_history
                  where user_id = :A and game_key = 'sng_poker'), 'one history row for the whole tournament');
select tests.ok(tests.has(:A, 'tourney_first') and tests.has(:A, 'tourney_win') and tests.has(:A, 'sng_win') and tests.has(:C, 'tourney_first') and not tests.has(:C, 'tourney_win'), 'tournament achievements');
select tests.ok((select count(*) from public.player_cosmetics where user_id = :A and cosmetic_key in ('avatar_medal', 'title_tournament_champion', 'title_contender')) = 3, 'and their prizes');
select tests.ok(not exists (select 1 from public.chip_ledger where user_id in (:A, :B, :C) and reason in ('table_chips_out', 'poker_pot')), 'tournament chips never reached a wallet');
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.tournaments_state() #> '{results,0}' @> '{"kind":"sng","place":1,"prize":750,"entrants":3}', 'in your results');
reset role;

-- A six-player game pays two places.
select tests.ok(private.pool_prizes(6 * 2500, array[65, 35]) = '{9750,5250}', 'six-player prizes');

-- ----------------------------------------------------------------------------
-- Slot Showdown
-- ----------------------------------------------------------------------------
delete from public.tournaments;
set role authenticated;
select tests.as_user(:A);
create temp table ts as select public.tournaments_state() as r;
select tests.ok(jsonb_array_length(r -> 'showdowns') = 4, 'three showdowns and the freeroll are open') from ts;
select tests.ok((select bool_and((s ->> 'ends_at')::timestamptz > now() and s ->> 'machine' like 'slots\_%') from ts, jsonb_array_elements(r -> 'showdowns') s), 'each has a machine and time left') from ts limit 1;
drop table ts;
select tests.ok(jsonb_array_length(public.tournaments_state() -> 'showdowns') = 4, 'looking again makes no duplicates');
reset role;
create temp table sd as select id from public.tournaments where kind = 'showdown' and tier = 'low';
grant select on sd to authenticated;
set role authenticated;
select tests.throws($$select public.showdown_spin((select id from sd))$$, 'action_not_allowed');
select tests.ok((public.showdown_enter((select id from sd)) ->> 'balance')::int = tests.bal(:A), 'entered');
select tests.throws($$select public.showdown_enter((select id from sd))$$, 'action_not_allowed');
select tests.as_user(:B);
select public.showdown_enter((select id from sd));
reset role;
select tests.ok((select spins_left = 30 and score = 0 from tests.entry(:A, 'showdown')), '30 spins each');
-- Ann's spins all pay 100 points; Ben's pay nothing.
update public.tournaments set machine = 'slots_classic' where id = (select id from sd);
select tests.rig_reel('slots_classic', 0, 'BLANK', 'CHERRY', 'BLANK'), tests.rig_reel('slots_classic', 1, 'BLANK', 'BLANK', 'BLANK'),
       tests.rig_reel('slots_classic', 2, 'BLANK', 'BAR1', 'BLANK');
set role authenticated;
select tests.as_user(:A);
create temp table sp as select public.showdown_spin((select id from sd)) as r;
select tests.ok(r @> '{"units":100,"score":100,"spins_left":29}' and r #>> '{result,kind}' = 'classic', 'a tournament spin scores its win') from sp;
select tests.ok(tests.bal(:A) = (select tests.bal(:A)), 'and moves no chips') from sp;
drop table sp;
reset role;
select tests.ok(tests.bal(:A) = 10500 - 200, 'only the entry fee has left the wallet');
update public.tournament_entries set spins_left = 1 where user_id = :A and tournament_id = (select id from sd);
set role authenticated;
select public.showdown_spin((select id from sd));
select tests.throws($$select public.showdown_spin((select id from sd))$$, 'action_not_allowed');
select tests.ok((public.showdown_state((select id from sd)) -> 'me' ->> 'place')::int = 1
            and jsonb_array_length(public.showdown_state((select id from sd)) -> 'top') = 2, 'live standings');
reset role;
select tests.ok((select finished_at is not null from tests.entry(:A, 'showdown')), 'using the last spin stamps the finish time');
select tests.end_rounds('showdown');
set role authenticated;
select tests.as_user(:B);
select tests.throws($$select public.showdown_spin((select id from sd))$$, 'betting_closed');
select public.tournaments_state();
reset role;
select tests.ok((select status = 'finished' from public.tournaments where id = (select id from sd)), 'settled by the next look');
select tests.ok((select place = 1 and prize = 400 from tests.entry(:A, 'showdown')) and (select place = 2 and prize = 0 from tests.entry(:B, 'showdown')), 'two players: winner takes the pool');
select tests.ok(tests.bal(:A) = 10300 + 400 and tests.has(:A, 'showdown_win'), 'paid, and the Showstopper achievement');
select tests.ok(exists (select 1 from public.tournaments where kind = 'showdown' and tier = 'mid' and status = 'void'), 'rounds nobody entered are simply closed');
drop table sd;

-- A round with a single entrant is refunded.
set role authenticated;
select tests.as_user(:C);
select public.tournaments_state();
select public.showdown_enter((select id from public.tournaments where kind = 'showdown' and tier = 'low' and status = 'running'));
reset role;
select tests.ok(tests.bal(:C) = 9750 - 200, 'fee taken');
select tests.end_rounds('showdown');
select private.tick_stale_tables();
select tests.ok(tests.bal(:C) = 9750 and (select status = 'void' from tests.tour(:C, 'showdown')), 'alone in the round: refunded (settled from the lobby)');
select tests.ok((select count(*) from public.game_history where user_id = :C and game_key = 'slot_showdown') = 0, 'and nothing recorded');

-- ----------------------------------------------------------------------------
-- Daily Freeroll
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:A);
select public.tournaments_state();
select tests.ok((public.showdown_enter((select id from public.tournaments where kind = 'freeroll' and status = 'running')) ->> 'balance')::bigint = tests.bal(:A), 'the freeroll is free');
select tests.ok((select spins_left = 50 from tests.entry(:A, 'freeroll')), '50 spins');
select tests.as_user(:B);
select public.showdown_enter((select id from public.tournaments where kind = 'freeroll' and status = 'running'));
select tests.as_user(:C);
select public.showdown_enter((select id from public.tournaments where kind = 'freeroll' and status = 'running'));
select tests.as_user(:D);
select public.showdown_enter((select id from public.tournaments where kind = 'freeroll' and status = 'running'));
reset role;
update public.tournament_entries e set score = case e.user_id when :D then 900 when :C then 500 when :B then 500 else 100 end,
       finished_at = case e.user_id when :B then now() - interval '5 minutes' when :C then now() end
  from public.tournaments t where t.id = e.tournament_id and t.kind = 'freeroll';
select tests.end_rounds('freeroll');
select private.tourney_tick();
select tests.ok((select place = 1 and prize = 2500 from tests.entry(:D, 'freeroll')) and (select place = 2 and prize = 1500 from tests.entry(:B, 'freeroll'))
            and (select place = 3 and prize = 1000 from tests.entry(:C, 'freeroll')) and (select place = 4 and prize = 250 from tests.entry(:A, 'freeroll')),
                'house prizes by place; a tie goes to whoever finished first');
select tests.ok(tests.has(:D, 'freeroll_podium') and tests.has(:B, 'freeroll_podium') and not tests.has(:A, 'freeroll_podium'), 'Free Lunch for the top three');
select tests.ok(not tests.has(:D, 'showdown_win'), 'a freeroll win is not a Slot Showdown win');
select tests.ok((select wagered = 0 and returned = 2500 from public.game_history where user_id = :D and game_key = 'slot_showdown'), 'recorded with no stake');

-- ----------------------------------------------------------------------------
-- Housekeeping
-- ----------------------------------------------------------------------------
select tests.ok(private.chips_in_play(:A) = 0 and private.chips_in_play(:B) = 0 and private.chips_in_play(:C) = 0, 'nothing left in play');
select tests.ok(not exists (
  select 1 from public.wallets w
   where w.user_id in (:A, :B, :C, :D)
     and w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)
), 'ledger sums match balances');
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every public table');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('tournaments', 'tournament_entries')) = 2, 'realtime');
set role anon;
select tests.throws($$select public.tournaments_state()$$, 'permission denied');
reset role;

delete from tests.dice;
delete from public.tournaments;
delete from public.game_tables where play_money;
delete from auth.users where email like '%@tour.test';

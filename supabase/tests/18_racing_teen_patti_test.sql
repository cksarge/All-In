-- Stage 10, part 4 tests: horse racing (a live room) and Teen Patti tables.
\set ON_ERROR_STOP 1
\set A '''00000000-0000-0000-0000-0000000f2a01'''
\set B '''00000000-0000-0000-0000-0000000f2b02'''
\set C '''00000000-0000-0000-0000-0000000f2c03'''
\set T '''00000000-0000-0000-0000-0000000f2001'''

-- Moves the race room's clock forward (by moving its timestamps back).
create or replace function tests.race_skip(p_seconds numeric) returns void language sql security definer as $$
  update public.race_rounds set betting_ends_at = betting_ends_at - make_interval(secs => p_seconds::double precision),
         started_at = started_at - make_interval(secs => p_seconds::double precision),
         ends_at = ends_at - make_interval(secs => p_seconds::double precision)
   where round_no = (select max(round_no) from public.race_rounds);
$$;
create or replace function tests.tp_hand(p_table uuid) returns jsonb language sql security definer as $$
  select to_jsonb(h) from public.tpt_hands h where table_id = p_table order by hand_no desc limit 1
$$;
create or replace function tests.tp_pl(p_table uuid, p_seat int) returns jsonb language sql security definer as $$
  select to_jsonb(p) from public.tpt_players p
   where p.hand_id = (select id from public.tpt_hands where table_id = p_table order by hand_no desc limit 1) and p.seat_no = p_seat
$$;
create or replace function tests.tp_expire(p_table uuid) returns void language sql security definer as $$
  update public.tpt_hands set phase_ends_at = now() - interval '1 minute'
   where id = (select id from public.tpt_hands where table_id = p_table order by hand_no desc limit 1)
$$;
create or replace function tests.tp_set_stack(p_table uuid, p_user uuid, p_stack bigint) returns void language sql security definer as $$
  update public.table_seats set stack = p_stack where table_id = p_table and user_id = p_user
$$;
create or replace function tests.cnt(p_user uuid, p_key text) returns integer language sql security definer as $$
  select coalesce((counters ->> p_key)::integer, 0) from public.player_progress where user_id = p_user
$$;
create or replace function tests.has(p_user uuid, p_key text) returns boolean language sql security definer as $$
  select exists (select 1 from public.player_achievements where user_id = p_user and achievement_key = p_key)
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from tests.dice;
delete from tests.decks;
delete from public.race_rounds;
delete from auth.users where email like '%@p4.test';
insert into auth.users (id, email, raw_user_meta_data) values
  (:A, 'a@p4.test', '{"username":"P4Ann"}'), (:B, 'b@p4.test', '{"username":"P4Ben"}'), (:C, 'c@p4.test', '{"username":"P4Cat"}');
delete from public.game_tables where id = :T;
insert into public.game_tables (id, game_key, tier, name, max_seats) values (:T, 'teen_patti_live', 'low', 'Test Teen Patti', 6);

-- ----------------------------------------------------------------------------
-- Catalogue
-- ----------------------------------------------------------------------------
select tests.ok((select count(*) from public.games where key in ('horse_racing', 'teen_patti_live') and released) = 2, 'both games are open');
select tests.ok((select multiplayer and max_seats = 6 and category = 'poker' from public.games where key = 'teen_patti_live')
            and (select not multiplayer and category = 'specialty' from public.games where key = 'horse_racing'), 'one at tables, one a room');
select tests.ok((select count(*) from public.game_tables where game_key = 'teen_patti_live' and persistent) = 4, 'a house table at every stake level');
select tests.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
                  and tablename in ('race_rounds', 'race_bets', 'tpt_hands', 'tpt_players')) = 4
            and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tpt_cards'), 'realtime: everything but the cards');

-- ----------------------------------------------------------------------------
-- Horse racing. Field 0 handed out in order: chances 30, 22, 18, 13, 10, 7.
-- ----------------------------------------------------------------------------
select tests.rig(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.race_state() #>> '{round,phase}' = 'betting' and public.race_state() #> '{round,result}' = 'null'::jsonb, 'a race opens for betting, with no result yet');
select tests.ok((public.race_state() #>> '{round,horses,0,win}')::int = 300 and (public.race_state() #>> '{round,horses,5,win}')::int = 1310
            and public.race_state() #>> '{round,horses,0,name}' = 'Midnight Ace', 'odds come from the chances: 92 / 30% = 3.00, 92 / 7% = 13.10');
select tests.ok((public.race_state() #>> '{round,horses,0,place}')::int = 160 and (public.race_state() #>> '{round,horses,5,place}')::int between 590 and 600,
                'a place bet pays less than a win bet on the same horse');
select tests.ok((select bool_and((h ->> 'win')::int % 10 = 0 and (h ->> 'place')::int % 10 = 0 and (h ->> 'place')::int < (h ->> 'win')::int and (h ->> 'place')::int > 100)
                   from jsonb_array_elements(public.race_state() #> '{round,horses}') h), 'every price is a multiple of 10 and worth taking');
select tests.ok((public.race_info() #>> '{config,bet_seconds}')::int = 25 and public.race_info() -> 'config' -> 'fields' is null, 'the info call has the timings, not the fields');
select public.race_bet(6, 'win', 100);
select public.race_bet(1, 'place', 100);
select public.race_bet(2, 'win', 50);
select tests.throws($$select public.race_bet(6, 'win', 100)$$, 'action_not_allowed');
select tests.throws($$select public.race_bet(7, 'win', 100)$$, 'invalid_bet');
select tests.throws($$select public.race_bet(3, 'show', 100)$$, 'invalid_bet');
select tests.throws($$select public.race_bet(3, 'win', 15)$$, 'invalid_amount');
select tests.ok(tests.bal(:A) = 9750 and jsonb_array_length(public.race_state() -> 'mine') = 3, 'three bets taken');
select tests.as_user(:B);
select public.race_bet(1, 'win', 100);
select tests.ok(jsonb_array_length(public.race_state() -> 'mine') = 1 and (public.race_state() ->> 'players')::int = 2
            and (public.race_state() #>> '{pool,0,amount}')::int = 200, 'you see your own bets and what is riding on each horse');
reset role;
select tests.ok(private.race_in_play(:A) = 250 and private.chips_in_play(:A) = 250, 'open bets count as chips in play');

-- Betting closes: the order is drawn now. 95 of 100 lands on horse 6; then the rest in order.
select tests.rig(95, 0, 0, 0, 0, 0);
select tests.race_skip(26);
set role authenticated;
select tests.as_user(:A);
select tests.ok(public.race_state() #>> '{round,phase}' = 'racing' and public.race_state() #> '{round,result}' = '[6, 1, 2, 3, 4, 5]'::jsonb, 'they are off: 6 wins from 1');
select tests.ok(tests.bal(:A) = 9750, 'nothing is paid while the race is being run');
select tests.throws($$select public.race_bet(3, 'win', 100)$$, 'betting_closed');
reset role;
select tests.race_skip(13);
set role authenticated;
select tests.ok(public.race_state() #>> '{round,phase}' = 'done', 'the race is over');
select tests.ok(tests.bal(:A) = 9750 + 1310 + 160, 'the winner at 13.10 and the place at 1.60 are paid');
select tests.ok(tests.bal(:B) = 9900, 'second place is not a win');
select tests.ok(public.race_state() #>> '{recent,0,name}' = 'Easy Eight' or public.race_state() #>> '{recent,0,no}' = '6', 'the winner joins the recent list');
reset role;
select tests.ok((select wagered = 250 and returned = 1470 and (summary ->> 'picked_winner')::boolean and (summary ->> 'win_units')::int = 1310
                   from public.game_history where user_id = :A and game_key = 'horse_racing'), 'one history row for the whole race');
select tests.ok(tests.cnt(:A, 'race_winners') = 1 and tests.cnt(:A, 'race_longshots') = 1 and tests.cnt(:B, 'race_winners') = 0, 'feats counted');
select tests.ok(tests.has(:A, 'race_winner') and tests.has(:A, 'race_longshot') and not tests.has(:B, 'race_winner')
            and exists (select 1 from public.player_cosmetics where user_id = :A and cosmetic_key = 'avatar_horse'), 'First Past the Post and Long Shot, with the Racehorse avatar');
select tests.ok(private.race_in_play(:A) = 0, 'nothing left in play');
select tests.race_skip(8);
select tests.rig(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
set role authenticated;
select tests.ok(public.race_state() #>> '{round,phase}' = 'betting' and jsonb_array_length(public.race_state() -> 'mine') = 0, 'and the next race opens');
reset role;
-- A race nobody is watching still finishes for those who bet.
set role authenticated;
select tests.as_user(:B);
select public.race_bet(1, 'win', 100);
reset role;
select tests.rig(0, 0, 0, 0, 0, 0);
select tests.race_skip(26);
select private.tick_stale_tables();
select tests.race_skip(13);
select private.tick_stale_tables();
select tests.ok((select phase = 'done' from public.race_rounds order by round_no desc limit 1) and private.race_in_play(:B) = 0, 'unwatched races are settled by the lobby');
select tests.ok(tests.bal(:B) = 9900 - 100 + 300, 'and paid: the favourite at 3.00');

-- ----------------------------------------------------------------------------
-- Teen Patti: hand ranking (from file 19) with the names the tables show
-- ----------------------------------------------------------------------------
select tests.ok(private.tpt_label(private.tpt_score(tests.cards('7s 7h 7d'))) = 'Trail'
            and private.tpt_label(private.tpt_score(tests.cards('Ah Kh Qh'))) = 'Pure sequence'
            and private.tpt_label(private.tpt_score(tests.cards('4s 5d 6c'))) = 'Sequence'
            and private.tpt_label(private.tpt_score(tests.cards('2h 9h Kh'))) = 'Colour'
            and private.tpt_label(private.tpt_score(tests.cards('Ks Kh 2d'))) = 'Pair'
            and private.tpt_label(private.tpt_score(tests.cards('As Qd 9c'))) = 'High card', 'six kinds of hand');

-- ----------------------------------------------------------------------------
-- Hand 1, heads-up. Button seat 1 (Ann); Ben is dealt first and acts first.
-- Ben: Ks Kh 2d (pair). Ann: As Qd 9c.
-- ----------------------------------------------------------------------------
select tests.deck('Ks Kh 2d As Qd 9c');
set role authenticated;
select tests.as_user(:A);
select public.join_table(:T, 1);
select tests.throws(format('select public.tpt_bring_chips(%L, 50)', :T), 'below_min_stack');
select tests.throws(format('select public.tpt_bring_chips(%L, 5000)', :T), 'above_max_stack');
select public.tpt_bring_chips(:T, 500);
select tests.ok(public.tpt_state(:T) -> 'hand' = 'null'::jsonb, 'one player: no hand');
select tests.as_user(:B);
select public.join_table(:T, 2);
select public.tpt_bring_chips(:T, 500);
select tests.ok(public.tpt_state(:T) #>> '{hand,phase}' = 'betting' and (public.tpt_state(:T) #>> '{hand,pot}')::int = 20
            and (public.tpt_state(:T) #>> '{hand,stake}')::int = 10 and (public.tpt_state(:T) #>> '{hand,turn_seat}')::int = 2, 'both post the boot of 10; the player left of the button acts');
select tests.ok(public.tpt_state(:T) #> '{me,hole}' = 'null'::jsonb and (public.tpt_state(:T) #>> '{me,can_see}')::boolean
            and (public.tpt_state(:T) #>> '{me,options,bet}')::int = 10 and (public.tpt_state(:T) #>> '{me,options,raise}')::int = 20
            and (public.tpt_state(:T) #>> '{me,options,can_show}')::boolean, 'blind: no cards, bet 10 or 20, and a show is possible heads-up');
select tests.throws(format('select * from public.tpt_cards'), 'permission denied');
select tests.as_user(:A);
select tests.throws(format('select public.tpt_action(%L, ''bet'')', :T), 'not_your_turn');
select tests.throws(format('select public.tpt_bring_chips(%L, 100)', :T), 'action_not_allowed');
select public.tpt_action(:T, 'see');
select tests.ok(public.tpt_state(:T) #> '{me,hole}' = to_jsonb(tests.cards('As Qd 9c')) and public.tpt_state(:T) #>> '{me,hand_name}' = 'High card'
            and (public.tpt_state(:T) #>> '{me,seen}')::boolean, 'you may look at any time, and then you are told what you hold');
select tests.as_user(:B);
select tests.ok(public.tpt_state(:T) #> '{me,hole}' = 'null'::jsonb and (public.tpt_state(:T) #>> '{players,0,seen}')::boolean
            and public.tpt_state(:T) #> '{players,0,shown_cards}' = 'null'::jsonb, 'the other player sees that you looked, not what you saw');
select public.tpt_action(:T, 'bet');
select tests.as_user(:A);
select tests.ok((public.tpt_state(:T) #>> '{me,options,bet}')::int = 20 and (public.tpt_state(:T) #>> '{me,options,raise}')::int = 40, 'seen: twice the stake, or four times');
select public.tpt_action(:T, 'raise');
select tests.as_user(:B);
select tests.ok((public.tpt_state(:T) #>> '{hand,stake}')::int = 20 and (public.tpt_state(:T) #>> '{hand,pot}')::int = 70
            and (public.tpt_state(:T) #>> '{me,options,bet}')::int = 20 and (public.tpt_state(:T) #>> '{me,options,show_cost}')::int = 20, 'a seen raise of 40 makes the stake 20');
select public.tpt_action(:T, 'show');
select tests.ok(public.tpt_state(:T) #>> '{hand,phase}' = 'settled' and (public.tpt_state(:T) #>> '{hand,showdown}')::boolean
            and (tests.tp_pl(:T, 2) ->> 'won')::int = 90 and tests.tp_pl(:T, 2) ->> 'hand_name' = 'Pair' and tests.tp_pl(:T, 1) ->> 'hand_name' = 'High card'
            and tests.tp_pl(:T, 1) -> 'shown_cards' = to_jsonb(tests.cards('As Qd 9c')), 'the show: the pair takes 90 and both hands are turned over');
select tests.ok((public.tpt_state(:T) #>> '{seats,0,stack}')::int = 450 and (public.tpt_state(:T) #>> '{seats,1,stack}')::int = 550, 'stacks moved');
reset role;
select tests.ok(tests.cnt(:B, 'tpt_wins') = 1 and tests.cnt(:B, 'tpt_blind_wins') = 1 and tests.has(:B, 'tpt_blind'), 'Ben never looked: Blind Faith');
select tests.ok((select wagered = 50 and returned = 0 and summary ->> 'made' = 'high_card' from public.game_history where user_id = :A and game_key = 'teen_patti_live'), 'the loser has a history row too');

-- ----------------------------------------------------------------------------
-- Hand 2, three players. Button seat 2; dealt Cat (3), Ann (1), Ben (2); Cat acts first.
-- Cat: 7s 7h 7d (trail). Ann: Ah Kh Qh (pure sequence). Ben: 2c 5d 9h.
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:C);
select public.join_table(:T, 3);
select public.tpt_bring_chips(:T, 500);
select tests.ok(public.tpt_state(:T) #>> '{hand,phase}' = 'settled', 'the next hand waits for the results pause');
reset role;
select tests.deck('7s 7h 7d Ah Kh Qh 2c 5d 9h');
select tests.tp_expire(:T);
set role authenticated;
select public.tpt_advance(:T);
select tests.ok((public.tpt_state(:T) #>> '{hand,hand_no}')::int = 2 and (public.tpt_state(:T) #>> '{hand,button_seat}')::int = 2
            and (public.tpt_state(:T) #>> '{hand,turn_seat}')::int = 3 and (public.tpt_state(:T) #>> '{hand,pot}')::int = 30, 'three in, the button has moved on');
select tests.ok(not (public.tpt_state(:T) #>> '{me,options,can_show}')::boolean, 'no show with three players in');
select tests.throws(format('select public.tpt_action(%L, ''show'')', :T), 'action_not_allowed');
select public.tpt_action(:T, 'see');
select public.tpt_action(:T, 'raise');
select tests.as_user(:A);
select public.tpt_action(:T, 'bet');
select tests.as_user(:B);
select public.tpt_action(:T, 'pack');
select tests.as_user(:C);
select tests.ok((public.tpt_state(:T) #>> '{hand,turn_seat}')::int = 3 and (public.tpt_state(:T) #>> '{me,options,can_show}')::boolean, 'two left: the turn comes back round');
select public.tpt_action(:T, 'bet');
select tests.as_user(:A);
select public.tpt_action(:T, 'see');
select public.tpt_action(:T, 'show');
select tests.ok((tests.tp_pl(:T, 3) ->> 'won')::int = 170 and tests.tp_pl(:T, 3) ->> 'hand_name' = 'Trail' and tests.tp_pl(:T, 1) ->> 'hand_name' = 'Pure sequence'
            and tests.tp_pl(:T, 2) -> 'shown_cards' = 'null'::jsonb, 'a trail beats a pure sequence; the packed hand stays hidden');
reset role;
select tests.ok(tests.has(:C, 'tpt_trail') and tests.cnt(:C, 'tpt_blind_wins') = 0
            and exists (select 1 from public.player_cosmetics where user_id = :C and cosmetic_key = 'frame_trail'), 'Three of a Kind, with its frame');
set role authenticated;
select tests.as_user(:B);
select tests.ok(jsonb_array_length(public.tpt_hand_history(:T)) = 2 and public.tpt_hand_history(:T) #> '{0,my_cards}' = 'null'::jsonb
            and public.tpt_hand_history(:T) #> '{1,my_cards}' = to_jsonb(tests.cards('Ks Kh 2d')), 'history: cards you never looked at stay unknown, even to you');

-- ----------------------------------------------------------------------------
-- Hand 3: equal hands. Button seat 3; dealt Ann, Ben, Cat. The one who asks for the show loses a tie.
-- ----------------------------------------------------------------------------
reset role;
select tests.deck('As Ks 4d Ad Kd 4c 2s 3d 9c');
select tests.tp_expire(:T);
set role authenticated;
select tests.as_user(:A);
select public.tpt_advance(:T);
select public.tpt_action(:T, 'bet');
select tests.as_user(:B);
select public.tpt_action(:T, 'bet');
select tests.as_user(:C);
select public.tpt_action(:T, 'pack');
select tests.as_user(:A);
select public.tpt_action(:T, 'show');
select tests.ok((tests.tp_pl(:T, 2) ->> 'won')::int = 60 and (tests.tp_pl(:T, 1) ->> 'won')::int = 0, 'Ann asked for the show and the hands were equal: Ben takes it all');

-- ----------------------------------------------------------------------------
-- Hand 4: a player runs out of time, and another leaves.
-- Button seat 1; Ben acts first.
-- ----------------------------------------------------------------------------
reset role;
select tests.tp_expire(:T);
set role authenticated;
select public.tpt_advance(:T);
select tests.ok((public.tpt_state(:T) #>> '{hand,turn_seat}')::int = 2 and (public.tpt_state(:T) #>> '{hand,hand_no}')::int = 4, 'hand 4');
reset role;
select tests.tp_expire(:T);
set role authenticated;
select tests.as_user(:A);
select public.tpt_advance(:T);
select tests.ok(tests.tp_pl(:T, 2) ->> 'status' = 'folded' and public.tpt_state(:T) #>> '{seats,1,status}' = 'sitting_out'
            and (public.tpt_state(:T) #>> '{hand,turn_seat}')::int = 3, 'out of time: packed and sat out, and the turn moves on');
select tests.as_user(:C);
select public.leave_table(:T);
select tests.ok(public.tpt_state(:T) #>> '{hand,phase}' = 'settled' and not (public.tpt_state(:T) #>> '{hand,showdown}')::boolean
            and (tests.tp_pl(:T, 1) ->> 'won')::int = 30 and tests.tp_pl(:T, 1) -> 'shown_cards' = 'null'::jsonb, 'everyone else is gone: Ann wins without showing');
reset role;
select tests.ok(tests.bal(:A) + tests.bal(:B) + tests.bal(:C) + (select sum(stack) from public.table_seats where table_id = :T)
              = 30000 + 1220 + 100, 'no chip was made or lost at the table (the rest is the racing)');
select tests.ok(private.tpt_in_play(:A) = 0, 'no pot left open');

-- ----------------------------------------------------------------------------
-- Hand 5: too few chips to cover a bet. Button seat 2; Ann is dealt first and acts first.
-- ----------------------------------------------------------------------------
select tests.tp_set_stack(:T, :A, 15);
select tests.deck('Ac Ad 3s 4h 8d Jc');
select tests.tp_expire(:T);
set role authenticated;
select tests.as_user(:B);
select public.set_sitting_out(:T, false);
select public.tpt_advance(:T);
select tests.as_user(:A);
select tests.ok((public.tpt_state(:T) #>> '{hand,hand_no}')::int = 5 and (public.tpt_state(:T) #>> '{me,stack}')::int = 5
            and (public.tpt_state(:T) #>> '{me,options,short}')::boolean and not (public.tpt_state(:T) #>> '{me,options,can_bet}')::boolean
            and (public.tpt_state(:T) #>> '{me,options,show_cost}')::int = 5, 'five chips left: only a show or a pack');
select tests.throws(format('select public.tpt_action(%L, ''bet'')', :T), 'not_enough_chips');
select public.tpt_action(:T, 'show');
select tests.ok((tests.tp_pl(:T, 1) ->> 'won')::int = 25 and tests.tp_pl(:T, 1) ->> 'hand_name' = 'Pair', 'the last chips go in and the pair wins');

-- ----------------------------------------------------------------------------
-- The pot limit: when the pot reaches 200 boots everyone shows.
-- ----------------------------------------------------------------------------
reset role;
select tests.tp_set_stack(:T, :A, 5000);
select tests.tp_set_stack(:T, :B, 5000);
select tests.deck('2c 7d 9h Ks Kh 2d');
select tests.tp_expire(:T);
set role authenticated;
select public.tpt_advance(:T);
-- Button seat 1; Ben first. Three raises take the stake to its cap of 80.
select tests.as_user(:B);
select public.tpt_action(:T, 'raise');
select tests.as_user(:A);
select public.tpt_action(:T, 'raise');
select tests.as_user(:B);
select public.tpt_action(:T, 'raise');
select tests.as_user(:A);
select tests.ok((public.tpt_state(:T) #>> '{hand,stake}')::int = 80 and public.tpt_state(:T) #> '{me,options,raise}' = 'null'::jsonb, 'the stake stops at 8 boots');
select tests.throws(format('select public.tpt_action(%L, ''raise'')', :T), 'action_not_allowed');
do $$
declare
  t uuid := '00000000-0000-0000-0000-0000000f2001';
  s jsonb;
begin
  for i in 1..40 loop
    s := public.tpt_state(t);
    exit when s #>> '{hand,phase}' = 'settled';
    perform set_config('request.jwt.claim.sub', (select user_id::text from public.table_seats where table_id = t and seat_no = (s #>> '{hand,turn_seat}')::int), false);
    perform public.tpt_action(t, 'bet');
  end loop;
end $$;
select tests.ok(public.tpt_state(:T) #>> '{hand,phase}' = 'settled' and (public.tpt_state(:T) #>> '{hand,showdown}')::boolean
            and (select sum((p ->> 'committed')::int) from jsonb_array_elements(public.tpt_state(:T) -> 'players') p) >= 2000
            and (tests.tp_pl(:T, 1) ->> 'won')::int > 0 and (tests.tp_pl(:T, 2) ->> 'won')::int = 0, 'at 2,000 in the pot the cards go over, and the pair wins');

select tests.as_user(:A);
select public.leave_table(:T);
select tests.as_user(:B);
select public.leave_table(:T);
reset role;
select tests.ok(not exists (select 1 from public.tpt_hands where phase <> 'settled' and table_id = :T), 'no hands left open');
select tests.ok(exists (select 1 from public.head_to_head), 'head-to-head records count Teen Patti hands');

delete from tests.decks;
delete from tests.dice;
delete from public.game_tables where id = :T;
delete from public.race_rounds;
delete from auth.users where email like '%@p4.test';

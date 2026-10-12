-- Stage 9, part 4 tests: Sit & Go formats, trophies, the tournament leaderboard,
-- multi-table tournaments and showing cards.
\set ON_ERROR_STOP 1
\set U1 '''00000000-0000-0000-0000-00000000d001'''
\set U2 '''00000000-0000-0000-0000-00000000d002'''
\set U3 '''00000000-0000-0000-0000-00000000d003'''

create or replace function tests.u(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-00000000d' || lpad(n::text, 3, '0'))::uuid
$$;
create or replace function tests.mtt() returns public.tournaments language sql security definer as $$
  select * from public.tournaments where kind = 'mtt' order by started_at desc nulls last, created_at desc limit 1
$$;
-- The event that is taking registrations (looking at the page while one runs opens the next).
create or replace function tests.mtt_next() returns public.tournaments language sql security definer as $$
  select * from public.tournaments where kind = 'mtt' and status = 'registering' order by starts_at limit 1
$$;
create or replace function tests.entry_of(p_user uuid) returns public.tournament_entries language sql security definer as $$
  select e.* from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id
   where e.user_id = p_user and t.kind = 'mtt' order by t.created_at desc limit 1
$$;
create or replace function tests.seat_table(p_user uuid) returns uuid language sql security definer as $$
  select table_id from public.table_seats where user_id = p_user
$$;
create or replace function tests.seats(p_table uuid) returns bigint language sql security definer as $$
  select count(*) from public.table_seats where table_id = p_table
$$;
-- Ends whatever hand a table is on (as if it had been played out) and, optionally, busts players.
create or replace function tests.end_hand(p_table uuid, variadic p_bust uuid[] default '{}') returns void language plpgsql security definer as $$
begin
  update public.pk_hands set phase = 'settled', phase_ends_at = now() where table_id = p_table and phase <> 'settled';
  update public.table_seats set stack = 0 where user_id = any (p_bust);
  perform private.mtt_after_hand(p_table);
end $$;
create or replace function tests.trophy(p_user uuid, p_kind text, p_place integer) returns integer language sql security definer as $$
  select coalesce((select count from public.player_trophies where user_id = p_user and kind = p_kind and place = p_place), 0)
$$;
create or replace function tests.has(p_user uuid, p_key text) returns boolean language sql security definer as $$
  select exists (select 1 from public.player_achievements where user_id = p_user and achievement_key = p_key)
$$;
grant execute on all functions in schema tests to anon, authenticated;

delete from public.tournaments;
delete from public.game_tables where play_money;
delete from auth.users where email like '%@plus.test';
insert into auth.users (id, email, raw_user_meta_data)
select tests.u(n), 'p' || n || '@plus.test', jsonb_build_object('username', 'Plus' || n) from generate_series(1, 10) n;

-- ----------------------------------------------------------------------------
-- Sit & Go formats
-- ----------------------------------------------------------------------------
select tests.ok(private.sng_seconds('turbo') = 60 and private.sng_seconds('standard') = 180 and private.sng_seconds('nope') = 180, 'turbo levels last a minute');
select tests.ok(private.sng_level(now() - interval '130 seconds', 60) = 3 and private.sng_level(now() - interval '130 seconds') = 1, 'the level follows the format''s clock');
set role authenticated;
select tests.as_user(:U1);
select tests.ok(jsonb_array_length(public.tournaments_state() -> 'sng') = 27, 'three formats of nine games each');
select tests.throws($$select public.sng_register(2, 250, 'razz')$$, 'unknown_tournament');
select public.sng_register(2, 250, 'omaha');
select tests.as_user(:U2);
select tests.ok(not (public.sng_register(2, 250, 'turbo') ->> 'started')::boolean, 'a turbo game does not fill an Omaha one');
select public.sng_unregister((select id from public.tournaments where kind = 'sng' and variant = 'turbo'));
select tests.ok((public.sng_register(2, 250, 'omaha') ->> 'started')::boolean, 'the same format does');
reset role;
select tests.ok((select game_key = 'poker_omaha' and name like 'Omaha Sit & Go #%' and play_money from public.game_tables
                  where id = (select table_id from public.tournaments where kind = 'sng' and status = 'running')), 'an Omaha Sit & Go is played at an Omaha table');
set role authenticated;
select tests.ok(public.tourney_status((select table_id from public.tournaments where kind = 'sng' and status = 'running')) @> '{"kind":"sng","variant":"omaha","players_left":2}', 'one status call covers Sit & Gos too');
select public.leave_table((select table_id from public.tournaments where kind = 'sng' and status = 'running'));
reset role;
select tests.ok(tests.trophy(:U1, 'sng', 1) = 1 and tests.trophy(:U2, 'sng', 2) = 0, 'a heads-up win is a gold trophy; second of two is no trophy');
delete from public.tournaments;

-- ----------------------------------------------------------------------------
-- A multi-table tournament: nine players, two tables
-- ----------------------------------------------------------------------------
set role authenticated;
select tests.as_user(:U1);
create temp table ms as select public.mtt_state() as r;
select tests.ok((r #>> '{next,starts_at}')::timestamptz > now() and (r #>> '{next,starts_at}')::timestamptz <= now() + interval '30 minutes'
            and (r #>> '{next,entry_fee}')::int = 1000 and r #> '{next,players}' = '[]', 'the next event is open for registration') from ms;
drop table ms;
select tests.ok((select count(*) from public.tournaments where kind = 'mtt') = 1 and public.mtt_state() is not null
            and (select count(*) from public.tournaments where kind = 'mtt') = 1, 'looking again makes no second event');
reset role;
do $$
begin
  for n in 1..9 loop
    perform set_config('request.jwt.claim.sub', tests.u(n)::text, false);
    perform public.mtt_register((tests.mtt()).id);
  end loop;
end $$;
set role authenticated;
select tests.as_user(:U1);
select tests.throws($$select public.mtt_register((tests.mtt()).id)$$, 'action_not_allowed');
select tests.throws($$select public.sng_register(2, 250)$$, 'action_not_allowed');
select tests.ok(tests.bal(:U1) = 9750 + 500 - 1000 and tests.bal(:U3) = 9000 and (public.get_economy_status() ->> 'chips_in_play')::int = 1000, 'entry taken and counted as in play');
select tests.ok(jsonb_array_length(public.mtt_state() #> '{next,players}') = 9 and (public.mtt_state() #>> '{next,registered}')::boolean, 'nine registered');
reset role;
select private.mtt_tick();
select tests.ok((tests.mtt()).status = 'registering', 'nothing starts before its time');
update public.tournaments set starts_at = now() - interval '1 second' where kind = 'mtt';
select private.mtt_tick();
select tests.ok((tests.mtt()).status = 'running' and (tests.mtt()).size = 9, 'started on time');
select tests.ok((select count(*) = 2 and bool_and(g.play_money) and array_agg(tests.seats(g.id) order by tests.seats(g.id)) = '{4,5}'
                   from public.tournament_tables tt join public.game_tables g on g.id = tt.table_id where tt.tournament_id = (tests.mtt()).id), 'two tables: five and four');
select tests.ok((select sum(stack) from public.table_seats where table_id in (select table_id from public.tournament_tables)) + 60 = 18000, '2,000 tournament chips each (blinds are in)');
select tests.ok((select count(*) from public.pk_hands where table_id in (select table_id from public.tournament_tables) and phase = 'betting') = 2, 'a hand is dealt at each');
select tests.ok(tests.bal(:U1) = 9250 and tests.bal(:U3) = 9000, 'tournament chips are not wallet chips');

-- t1 is the table of five, t2 the table of four; a and b are who started at each.
create temp table tb as
  select (array_agg(table_id order by tests.seats(table_id) desc))[1] as t1, (array_agg(table_id order by tests.seats(table_id) desc))[2] as t2 from public.tournament_tables;
create temp table who as
  select array_agg(user_id order by seat_no) filter (where table_id = (select t1 from tb)) as a,
         array_agg(user_id order by seat_no) filter (where table_id = (select t2 from tb)) as b from public.table_seats;
grant select on tb, who to authenticated;

set role authenticated;
select tests.as_user((select a[1] from who));
select tests.ok(public.tourney_status((select t1 from tb)) @> '{"kind":"mtt","status":"running","size":9,"prize_pool":9000,"prizes":[4500,2700,1800],"players_left":9,"tables_left":2,"level":1}'
            and (public.tourney_status((select t1 from tb)) ->> 'my_table')::uuid = (select t1 from tb), 'the table strip: field, prizes for three, where you sit');
select tests.ok(jsonb_array_length(public.mtt_state() #> '{running,0,tables}') = 2 and (public.mtt_state() ->> 'my_table')::uuid = (select t1 from tb), 'listed as running, with your table');
select tests.throws($$select public.pk_bring_chips((select t1 from tb), 500)$$, 'action_not_allowed');
select public.mtt_poke((select t1 from tb));
reset role;

-- Two go out at the table of four: 5 and 2. Seven don't fit one table, so the short one waits.
select tests.end_hand((select t2 from tb), (select b[1] from who), (select b[2] from who));
select tests.ok((select array_agg(place order by place) from public.tournament_entries where user_id in ((select b[1] from who), (select b[2] from who))) = '{8,9}'
            and tests.seats((select t1 from tb)) = 5 and tests.seats((select t2 from tb)) = 2, 'eighth and ninth place; the short table waits');
-- The bigger table sends one player over at its next break.
select tests.end_hand((select t1 from tb));
select tests.ok(tests.seats((select t1 from tb)) = 4 and tests.seats((select t2 from tb)) = 3, 'balanced: one player moved across');
select tests.ok((select count(*) = 7 and sum(stack) <= 18000 and min(stack) > 0 from public.table_seats where table_id in (select t1 from tb union select t2 from tb)), 'with their chips; nobody lost on the way');
-- One more out leaves six, who fit one table: the table that just finished its hand closes and joins the other.
select tests.end_hand((select t1 from tb), (select user_id from public.table_seats where table_id = (select t1 from tb) order by seat_no limit 1));
select tests.ok(tests.seats((select t1 from tb)) = 0 and tests.seats((select t2 from tb)) = 6
            and (select status = 'closed' from public.game_tables where id = (select t1 from tb)), 'the final table: six players, the other table closed');
create temp table mv as select user_id from public.table_seats where user_id = any ((select a from who)::uuid[]) order by seat_no limit 1;
grant select on mv to authenticated;
set role authenticated;
select tests.as_user((select user_id from mv));
select tests.ok((public.tourney_status((select t1 from tb)) ->> 'my_table')::uuid = (select t2 from tb) and (public.tourney_status((select t1 from tb)) ->> 'tables_left')::int = 1, 'a moved player is told where their seat is now');
-- Leaving is being knocked out.
select public.leave_table((select t2 from tb));
reset role;
select tests.ok((tests.entry_of((select user_id from mv))).place = 6 and tests.seats((select t2 from tb)) = 5, 'leaving the final table: sixth');

-- Showing cards after a hand nobody had to show.
update public.pk_hands set phase = 'settled', phase_ends_at = now() where table_id = (select t2 from tb);
set role authenticated;
select tests.as_user((select b[3] from who));
select public.pk_show((select t2 from tb));
reset role;
select tests.ok((select p.shown_cards is not null and p.shown_cards = h.cards from public.pk_players p join public.pk_hole h on h.hand_id = p.hand_id and h.user_id = p.user_id
                  where p.user_id = (select b[3] from who) and h.table_id = (select t2 from tb) limit 1)
            and tests.has((select b[3] from who), 'show_off'), 'a player may show their cards after the hand (Show-off)');
set role authenticated;
select tests.as_user(tests.u(10));
select tests.throws($$select public.pk_show((select t2 from tb))$$, 'action_not_allowed');
reset role;

-- Bust all but one.
do $$
declare
  v_t2 uuid := (select t2 from tb);
  r record;
begin
  for r in select user_id from public.table_seats where table_id = v_t2 order by seat_no offset 1 loop
    perform tests.end_hand(v_t2, r.user_id);
  end loop;
end $$;
select tests.ok((tests.mtt()).status = 'finished', 'one player left: finished');
select tests.ok((select array_agg(prize order by place) from public.tournament_entries where tournament_id = (tests.mtt()).id and place <= 4) = '{4500,2700,1800,0}', 'three places paid: 50, 30 and 20 percent');
select tests.ok((select count(*) from public.table_seats where table_id in (select table_id from public.tournament_tables)) = 0
            and (select bool_and(status = 'closed') from public.game_tables where id in (select table_id from public.tournament_tables)), 'all seats freed, all tables closed');
select tests.ok((select tests.trophy(user_id, 'mtt', 1) = 1 and tests.has(user_id, 'mtt_win') and private.chips_in_play(user_id) = 0 and tests.bal(user_id) in (9000 + 4500, 9250 + 4500, 8750 + 4500)
                   from public.tournament_entries where tournament_id = (tests.mtt()).id and place = 1), 'the winner: gold trophy, Field Marshal, prize in the wallet');
select tests.ok((select tests.trophy(user_id, 'mtt', 3) = 1 from public.tournament_entries where tournament_id = (tests.mtt()).id and place = 3)
            and (select count(*) from public.game_history where game_key = 'sng_poker' and round_id = (tests.mtt()).id and summary ->> 'kind' = 'mtt') = 9, 'bronze for third; one history row each');
select tests.ok(not exists (select 1 from public.chip_ledger where reason in ('table_chips_out', 'poker_pot')
                             and user_id in (select user_id from public.tournament_entries where tournament_id = (tests.mtt()).id)
                             and created_at > (tests.mtt()).started_at), 'tournament chips never reached a wallet');

-- The tournament leaderboard.
set role authenticated;
select tests.as_user(:U1);
select tests.ok((public.leaderboard('tournaments') #>> '{rows,0,value}')::int >= 1
            and (select count(*) from jsonb_array_elements(public.leaderboard('tournaments') -> 'rows') r where r ->> 'username' = 'Plus10') = 0, 'ranked by tournaments won; only people who have played one');
select tests.ok(jsonb_array_length(public.trophies_for('Plus1')) >= 1, 'a trophy shelf');

-- Too few players: called off and refunded.
select tests.as_user(tests.u(10));
select public.mtt_state();
select public.mtt_register((tests.mtt_next()).id);
reset role;
select tests.ok(tests.bal(tests.u(10)) = 9000, 'entered the next one');
update public.tournaments set starts_at = now() - interval '1 second' where kind = 'mtt' and status = 'registering';
select private.tick_stale_tables();
select tests.ok(exists (select 1 from public.tournaments where kind = 'mtt' and status = 'void') and tests.bal(tests.u(10)) = 10000, 'one entrant: called off from the lobby tick, entry returned');
set role authenticated;
select tests.ok((select count(*) from public.notifications where user_id = auth.uid() and kind = 'tournament_off') = 1, 'and told so in the inbox');
select tests.ok(public.sng_register(2, 250) is not null, 'a called-off event does not block the next tournament');
select public.sng_unregister((select id from public.tournaments where kind = 'sng' and status = 'registering'));
reset role;

select tests.ok(not exists (
  select 1 from public.wallets w where w.user_id in (select tests.u(n) from generate_series(1, 10) n)
     and w.balance <> (select coalesce(sum(delta), 0) from public.chip_ledger l where l.user_id = w.user_id)), 'ledger sums match balances');
select tests.ok(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every public table');

delete from public.tournaments;
delete from public.game_tables where play_money;
delete from public.big_wins;
delete from auth.users where email like '%@plus.test';

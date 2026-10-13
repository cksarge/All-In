-- =============================================================================
-- All In · 18_tournaments_plus.sql
-- Stage 9, part 4: multi-table tournaments, trophies, and showing your cards.
-- Run AFTER 01-17 (re-run 13_progression.sql and 14_tournaments.sql first: the
-- Sit & Go formats, the tournament leaderboard and the achievements are there).
-- Safe to re-run.
--
-- MULTI-TABLE TOURNAMENTS reuse everything a Sit & Go has (play-money poker
-- tables, rising blinds, knockouts), on several tables at once:
--   * one event every half hour; anyone may register until it starts;
--   * at the start time it needs 3 players, else it is called off and refunded;
--   * up to 18 players on tables of 6, rebalanced and merged as players go out.
-- A table only ever changes ITSELF (its own blinds, moving its own players away,
-- closing itself), and only between hands, so tables never wait on each other.
-- =============================================================================

alter table public.tournaments drop constraint if exists tournaments_kind_check;
alter table public.tournaments add constraint tournaments_kind_check check (kind in ('sng', 'showdown', 'freeroll', 'mtt'));

-- Which poker tables belong to a multi-table tournament.
create table if not exists public.tournament_tables (
  table_id       uuid primary key references public.game_tables (id) on delete cascade,
  tournament_id  uuid not null references public.tournaments (id) on delete cascade
);
create index if not exists tournament_tables_tournament_idx on public.tournament_tables (tournament_id);

-- Trophies: gold, silver and bronze finishes, kept for good (tournaments themselves are tidied away).
create table if not exists public.player_trophies (
  user_id  uuid not null references auth.users (id) on delete cascade,
  kind     text not null check (kind in ('sng', 'mtt', 'showdown', 'freeroll')),
  place    integer not null check (place between 1 and 3),
  count    integer not null default 0,
  primary key (user_id, kind, place)
);

create or replace function private.mtt_cfg()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"entry_fee": 1000, "stack": 2000, "seats": 6, "max_players": 18, "min_players": 3,
           "every_seconds": 1800, "level_seconds": 180,
           "payouts": {"6": [65, 35], "12": [50, 30, 20], "18": [45, 27, 18, 10]}}'::jsonb
$$;

-- Percent of the pool per place, by how many entered.
create or replace function private.mtt_shares(p_entrants integer)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  select array_agg(x::integer order by o)
    from jsonb_array_elements_text(private.mtt_cfg() -> 'payouts' -> case when p_entrants <= 6 then '6' when p_entrants <= 12 then '12' else '18' end)
         with ordinality p(x, o)
$$;

-- -----------------------------------------------------------------------------
-- Trophies (a fourth trigger on game_history: one row per player per tournament)
-- -----------------------------------------------------------------------------
create or replace function private.on_round_trophies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_place integer;
  v_players integer;
  v_kind text;
begin
  -- No trophies for private tournaments and club events: they are played among friends.
  if new.game_key not in ('sng_poker', 'slot_showdown') or (new.summary ->> 'private')::boolean then
    return new;
  end if;
  v_place := (new.summary ->> 'place')::integer;
  v_players := (new.summary ->> 'players')::integer;
  v_kind := new.summary ->> 'kind';
  -- Gold needs an opponent, silver a field of three, bronze a field of four: last place is never a trophy.
  if v_kind in ('sng', 'mtt', 'showdown', 'freeroll') and v_place between 1 and 3 and v_players > v_place then
    insert into public.player_trophies as t (user_id, kind, place, count) values (new.user_id, v_kind, v_place, 1)
    on conflict (user_id, kind, place) do update set count = t.count + 1;
    perform private.bump(new.user_id, 'trophies');
  end if;
  return new;
end $$;

drop trigger if exists game_history_trophies on public.game_history;
create trigger game_history_trophies after insert on public.game_history
  for each row execute function private.on_round_trophies();

-- A player's trophy shelf.
create or replace function public.trophies_for(p_username text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', t.kind, 'place', t.place, 'count', t.count) order by t.place, t.kind), '[]'::jsonb)
    from public.player_trophies t join public.profiles p on p.id = t.user_id
   where auth.uid() is not null and lower(p.username) = lower(btrim(p_username))
$$;

-- -----------------------------------------------------------------------------
-- Multi-table tournaments
-- -----------------------------------------------------------------------------
-- Makes sure the next event exists (registration is open until its start time).
create or replace function private.mtt_ensure()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := private.mtt_cfg();
  v_secs integer := (c ->> 'every_seconds')::integer;
  v_start timestamptz := to_timestamp((floor(extract(epoch from now()) / v_secs) + 1) * v_secs);
begin
  insert into public.tournaments (kind, status, tier, size, entry_fee, starts_at)
  values ('mtt', 'registering', 'main', (c ->> 'max_players')::integer, (c ->> 'entry_fee')::bigint, v_start)
  on conflict (kind, tier, starts_at) where kind <> 'sng' do nothing;
end $$;

create or replace function private.mtt_free_seat(p_table uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select g from generate_series(1, (private.mtt_cfg() ->> 'seats')::integer) g
   where not exists (select 1 from public.table_seats s where s.table_id = p_table and s.seat_no = g)
   order by g limit 1
$$;

-- Start time has come: seat everyone, or call it off if too few entered.
create or replace function private.mtt_start(p_tournament uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := private.mtt_cfg();
  t public.tournaments;
  e record;
  n integer;
  v_tables integer;
  v_ids uuid[] := '{}';
  v_table uuid;
  i integer;
begin
  select * into t from public.tournaments where id = p_tournament and kind = 'mtt' for update;
  if not found or t.status <> 'registering' or t.starts_at > now() then
    return;
  end if;
  select count(*) into n from public.tournament_entries where tournament_id = t.id;
  if n < (c ->> 'min_players')::integer then
    for e in select user_id from public.tournament_entries where tournament_id = t.id loop
      perform private.apply_chips(e.user_id, t.entry_fee, 'refund', 'sng_poker', t.id::text);
      perform private.notify(e.user_id, 'tournament_off', jsonb_build_object('kind', 'mtt'));
    end loop;
    update public.tournaments set status = 'void', finished_at = now() where id = t.id;
    return;
  end if;

  -- Anyone sitting somewhere else is moved (their chips there go back to their wallet).
  delete from public.table_seats where user_id in (select user_id from public.tournament_entries where tournament_id = t.id);
  v_tables := ceil(n::numeric / (c ->> 'seats')::integer)::integer;
  for i in 1..v_tables loop
    insert into public.game_tables (game_key, tier, name, max_seats, play_money, stakes)
    values ('poker_holdem', 'low', 'Main Event #' || t.seq || ' · Table ' || i, (c ->> 'seats')::integer, true, private.sng_stakes(1))
    returning id into v_table;
    insert into public.tournament_tables (table_id, tournament_id) values (v_table, t.id);
    v_ids := array_append(v_ids, v_table);
  end loop;
  -- Dealt round the tables in random order, so they start as even as can be.
  i := 0;
  for e in select user_id from public.tournament_entries where tournament_id = t.id order by random() loop
    v_table := v_ids[(i % v_tables) + 1];
    insert into public.table_seats (table_id, seat_no, user_id, stack)
    values (v_table, private.mtt_free_seat(v_table), e.user_id, (c ->> 'stack')::bigint);
    i := i + 1;
  end loop;
  update public.tournament_entries set status = 'playing' where tournament_id = t.id;
  update public.tournaments set status = 'running', started_at = now(), size = n where id = t.id;
  foreach v_table in array v_ids loop
    perform private.pk_lock_table(v_table);
    perform private.pk_tick(v_table);
  end loop;
end $$;

-- Pays the prizes and closes every table.
create or replace function private.mtt_finish(p_tournament uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tournaments;
  e public.tournament_entries;
  n integer;
  v_prizes bigint[];
begin
  select * into t from public.tournaments where id = p_tournament for update;
  if t.status <> 'running' then
    return;
  end if;
  update public.tournament_entries set status = 'out', place = 1, finished_at = now() where tournament_id = t.id and status = 'playing';
  update public.tournaments set status = 'finished', finished_at = now() where id = t.id;
  select count(*) into n from public.tournament_entries where tournament_id = t.id;
  v_prizes := private.pool_prizes(t.entry_fee * n, private.mtt_shares(n));
  for e in select * from public.tournament_entries where tournament_id = t.id order by place loop
    update public.tournament_entries set prize = coalesce(v_prizes[e.place], 0) where tournament_id = t.id and user_id = e.user_id;
    if coalesce(v_prizes[e.place], 0) > 0 then
      perform private.apply_chips(e.user_id, v_prizes[e.place], 'tournament_prize', 'sng_poker', t.id::text, jsonb_build_object('place', e.place, 'players', n));
    end if;
    perform private.record_round(e.user_id, 'sng_poker', null, t.id, t.entry_fee, coalesce(v_prizes[e.place], 0),
                                 jsonb_build_object('kind', 'mtt', 'place', e.place, 'players', n));
  end loop;
  delete from public.table_seats where table_id in (select table_id from public.tournament_tables where tournament_id = t.id);
  update public.game_tables set status = 'closed' where id in (select table_id from public.tournament_tables where tournament_id = t.id);
end $$;

-- Brings a running event up to date from the point of view of ONE table (the one
-- whose lock the caller holds). Safe to call at any moment, any number of times.
create or replace function private.mtt_sync(p_tournament uuid, p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := private.mtt_cfg();
  v_seats integer := (c ->> 'seats')::integer;
  t public.tournaments;
  v_user uuid;
  v_left integer;
  v_idle boolean;
  v_mine integer;
  v_live integer;
  v_min integer;
  v_dest uuid;
  s record;
begin
  -- One table at a time per event. Every caller takes its own table's lock first and this
  -- second, and nobody takes a second table's lock, so they queue and cannot deadlock.
  perform pg_advisory_xact_lock(hashtext('allin_mtt_' || p_tournament::text));
  select * into t from public.tournaments where id = p_tournament;
  if not found or t.status <> 'running' then
    return;
  end if;
  select not exists (select 1 from public.pk_hands h where h.table_id = p_table and h.phase <> 'settled') into v_idle;

  -- 1. Knock-outs: a seat that has gone (the player left), or no chips once this table's hand is over.
  loop
    select count(*) into v_left from public.tournament_entries where tournament_id = t.id and status = 'playing';
    exit when v_left <= 1;
    select e.user_id into v_user from public.tournament_entries e
     where e.tournament_id = t.id and e.status = 'playing'
       and not exists (select 1 from public.table_seats ts join public.tournament_tables tt on tt.table_id = ts.table_id
                        where tt.tournament_id = t.id and ts.user_id = e.user_id)
     order by e.entered_at desc limit 1;
    if v_user is null and v_idle then
      select ts.user_id into v_user from public.table_seats ts
        join public.tournament_entries e on e.tournament_id = t.id and e.user_id = ts.user_id and e.status = 'playing'
       where ts.table_id = p_table and ts.stack = 0
       order by coalesce((select p.stack_start from public.pk_players p join public.pk_hands h on h.id = p.hand_id
                           where h.table_id = p_table and p.user_id = ts.user_id order by h.hand_no desc limit 1), 0), ts.seat_no
       limit 1;
    end if;
    exit when v_user is null;
    -- Marked out first, so that freeing the seat (which calls back in here) finds nothing to do.
    update public.tournament_entries set status = 'out', place = v_left, finished_at = now() where tournament_id = t.id and user_id = v_user;
    delete from public.table_seats where user_id = v_user
       and table_id in (select table_id from public.tournament_tables where tournament_id = t.id);
    select * into t from public.tournaments where id = p_tournament;
    exit when t.status <> 'running';
  end loop;
  select * into t from public.tournaments where id = p_tournament;
  if t.status <> 'running' then
    return;
  end if;
  select count(*) into v_left from public.tournament_entries where tournament_id = t.id and status = 'playing';
  if v_left <= 1 then
    perform private.mtt_finish(t.id);
    return;
  end if;

  -- 2. This table's blinds follow the clock.
  update public.game_tables set stakes = private.sng_stakes(private.sng_level(t.started_at, (c ->> 'level_seconds')::integer)), last_activity_at = now()
   where id = p_table and status = 'open';

  -- 3. Between hands, this table may send players away: all of them if the others have room
  --    (it closes), or one if it is two or more ahead of the smallest.
  if not v_idle then
    return;
  end if;
  select count(*) into v_mine from public.table_seats where table_id = p_table;
  if v_mine = 0 then
    update public.game_tables set status = 'closed' where id = p_table;
    return;
  end if;
  select count(*), min(x.n) into v_live, v_min
    from (select tt.table_id, (select count(*) from public.table_seats ts where ts.table_id = tt.table_id) as n
            from public.tournament_tables tt join public.game_tables g on g.id = tt.table_id
           where tt.tournament_id = t.id and g.status = 'open' and tt.table_id <> p_table) x
   where x.n > 0;
  if coalesce(v_live, 0) = 0 then
    return;
  end if;

  if v_left <= v_seats * v_live and v_mine <= v_min then
    for s in select user_id from public.table_seats where table_id = p_table order by seat_no loop
      select tt.table_id into v_dest
        from public.tournament_tables tt join public.game_tables g on g.id = tt.table_id
       where tt.tournament_id = t.id and g.status = 'open' and tt.table_id <> p_table
         and (select count(*) from public.table_seats ts where ts.table_id = tt.table_id) between 1 and v_seats - 1
       order by (select count(*) from public.table_seats ts where ts.table_id = tt.table_id), tt.table_id limit 1;
      exit when v_dest is null;
      update public.table_seats set table_id = v_dest, seat_no = private.mtt_free_seat(v_dest), status = 'active' where user_id = s.user_id;
    end loop;
    if not exists (select 1 from public.table_seats where table_id = p_table) then
      update public.game_tables set status = 'closed' where id = p_table;
    end if;
  elsif v_mine - v_min >= 2 then
    select tt.table_id into v_dest
      from public.tournament_tables tt join public.game_tables g on g.id = tt.table_id
     where tt.tournament_id = t.id and g.status = 'open' and tt.table_id <> p_table
       and (select count(*) from public.table_seats ts where ts.table_id = tt.table_id) = v_min
     order by tt.table_id limit 1;
    select user_id into v_user from public.table_seats where table_id = p_table order by random() limit 1;
    update public.table_seats set table_id = v_dest, seat_no = private.mtt_free_seat(v_dest), status = 'active' where user_id = v_user;
  end if;
end $$;

-- Called by the poker engine after every hand at a tournament table that is not a Sit & Go (14).
create or replace function private.mtt_after_hand(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select tt.tournament_id into v_id from public.tournament_tables tt join public.tournaments t on t.id = tt.tournament_id
   where tt.table_id = p_table and t.status = 'running';
  if v_id is not null then
    perform private.mtt_sync(v_id, p_table);
  end if;
end $$;

-- Starts events whose time has come (from the tournaments page, and from the lobby when nobody is there).
create or replace function private.mtt_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select id from public.tournaments where kind = 'mtt' and status = 'registering' and starts_at <= now() loop
    perform private.mtt_start(r.id);
  end loop;
end $$;

create or replace function private.mtt_tick_stale()
returns void
language sql
security definer
set search_path = ''
as $$ select private.mtt_tick() $$;

create or replace function public.mtt_register(p_tournament uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.tournaments;
begin
  select * into t from public.tournaments where id = p_tournament and kind = 'mtt' for update;
  if not found then
    raise exception 'unknown_tournament';
  end if;
  if t.status <> 'registering' or t.starts_at <= now() then
    raise exception 'betting_closed' using hint = 'Registration has closed.';
  end if;
  if exists (select 1 from public.tournament_entries e join public.tournaments x on x.id = e.tournament_id
              where e.user_id = v_uid and x.kind in ('sng', 'mtt') and e.status in ('registered', 'playing') and x.status in ('registering', 'running')) then
    raise exception 'action_not_allowed' using hint = 'You are already in a poker tournament. One at a time.';
  end if;
  if (select count(*) from public.tournament_entries where tournament_id = t.id) >= (private.mtt_cfg() ->> 'max_players')::integer then
    raise exception 'action_not_allowed' using hint = 'This event is full.';
  end if;
  perform private.apply_chips(v_uid, -t.entry_fee, 'tournament_entry', 'sng_poker', t.id::text);
  insert into public.tournament_entries (tournament_id, user_id, username, status)
  values (t.id, v_uid, (select username from public.profiles where id = v_uid), 'registered');
  return jsonb_build_object('tournament_id', t.id, 'starts_at', t.starts_at);
end $$;

create or replace function public.mtt_unregister(p_tournament uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.tournaments;
begin
  select * into t from public.tournaments where id = p_tournament and kind = 'mtt' for update;
  if not found or t.status <> 'registering' then
    raise exception 'action_not_allowed' using hint = 'It has already started.';
  end if;
  delete from public.tournament_entries where tournament_id = t.id and user_id = v_uid and status = 'registered';
  if not found then
    raise exception 'action_not_allowed' using hint = 'You are not in that one.';
  end if;
  return jsonb_build_object('balance', private.apply_chips(v_uid, t.entry_fee, 'refund', 'sng_poker', t.id::text));
end $$;

-- The next event, events being played, and where you are sitting if you are in one.
create or replace function public.mtt_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.mtt_cfg();
begin
  perform private.mtt_tick();
  perform private.mtt_ensure();
  return jsonb_build_object(
    'server_now', now(),
    'config', c,
    'next', (select jsonb_build_object(
               'id', t.id, 'starts_at', t.starts_at, 'entry_fee', t.entry_fee,
               'players', coalesce((select jsonb_agg(e.username order by e.entered_at) from public.tournament_entries e where e.tournament_id = t.id), '[]'::jsonb),
               'registered', exists (select 1 from public.tournament_entries e where e.tournament_id = t.id and e.user_id = v_uid))
               from public.tournaments t where t.kind = 'mtt' and t.status = 'registering' order by t.starts_at limit 1),
    'running', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', t.id, 'entrants', t.size, 'prize_pool', t.entry_fee * t.size,
                  'players_left', (select count(*) from public.tournament_entries e where e.tournament_id = t.id and e.status = 'playing'),
                  'tables', (select coalesce(jsonb_agg(jsonb_build_object('table_id', g.id, 'name', g.name,
                                         'players', (select count(*) from public.table_seats ts where ts.table_id = g.id)) order by g.name), '[]'::jsonb)
                               from public.tournament_tables tt join public.game_tables g on g.id = tt.table_id
                              where tt.tournament_id = t.id and g.status = 'open')) order by t.started_at desc), '[]'::jsonb)
                  from public.tournaments t where t.kind = 'mtt' and t.status = 'running'),
    'my_table', (select ts.table_id from public.table_seats ts join public.tournament_tables tt on tt.table_id = ts.table_id
                   join public.tournaments t on t.id = tt.tournament_id where ts.user_id = v_uid and t.status = 'running' limit 1));
end $$;

-- The strip above any tournament table: a Sit & Go's status (14), or a multi-table event's.
create or replace function public.tourney_status(p_table uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.mtt_cfg();
  lv jsonb := private.tourney_cfg() #> '{sng,levels}';
  t public.tournaments;
  v_level integer;
  n integer;
  v_sng jsonb := public.sng_status(p_table);
begin
  if v_sng is not null then
    return v_sng;
  end if;
  select x.* into t from public.tournament_tables tt join public.tournaments x on x.id = tt.tournament_id where tt.table_id = p_table;
  if not found then
    return null;
  end if;
  select count(*) into n from public.tournament_entries where tournament_id = t.id;
  v_level := case when t.status = 'running' then private.sng_level(t.started_at, (c ->> 'level_seconds')::integer) end;
  return jsonb_build_object(
    'tournament_id', t.id, 'kind', 'mtt', 'variant', 'standard', 'status', t.status, 'size', n, 'entry_fee', t.entry_fee, 'prize_pool', t.entry_fee * n,
    'prizes', to_jsonb(private.pool_prizes(t.entry_fee * n, private.mtt_shares(n))),
    'level', v_level,
    'blinds', case when v_level is not null then lv -> (v_level - 1) end,
    'next_blinds', case when v_level is not null and v_level < jsonb_array_length(lv) then lv -> v_level end,
    'next_level_at', case when v_level is not null and v_level < jsonb_array_length(lv)
                          then t.started_at + make_interval(secs => v_level * (c ->> 'level_seconds')::integer) end,
    'players_left', (select count(*) from public.tournament_entries where tournament_id = t.id and status = 'playing'),
    'tables_left', (select count(*) from public.tournament_tables tt join public.game_tables g on g.id = tt.table_id where tt.tournament_id = t.id and g.status = 'open'),
    -- Where you are sitting now: tables are rebalanced, so it may not be this one.
    'my_table', (select ts.table_id from public.table_seats ts join public.tournament_tables tt on tt.table_id = ts.table_id
                  where tt.tournament_id = t.id and ts.user_id = v_uid),
    'entries', (select jsonb_agg(jsonb_build_object('user_id', e.user_id, 'username', e.username, 'status', e.status, 'place', e.place, 'prize', e.prize)
                                 order by e.place nulls first, e.username) from public.tournament_entries e where e.tournament_id = t.id),
    'me', (select jsonb_build_object('status', e.status, 'place', e.place, 'prize', e.prize)
             from public.tournament_entries e where e.tournament_id = t.id and e.user_id = v_uid));
end $$;

-- Asked by a browser sitting at (or watching) an event table every few seconds while it is
-- between hands: deals the next hand when it is due and lets the table rebalance.
create or replace function public.mtt_poke(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_uid();
  if not exists (select 1 from public.tournament_tables tt join public.tournaments t on t.id = tt.tournament_id
                  where tt.table_id = p_table and t.status = 'running') then
    return;
  end if;
  perform private.pk_lock_table(p_table);
  perform private.mtt_after_hand(p_table);
  perform private.pk_tick(p_table);
end $$;

-- -----------------------------------------------------------------------------
-- Poker: show your cards when you didn't have to (everyone else folded, or you folded)
-- -----------------------------------------------------------------------------
create or replace function public.pk_show(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  h public.pk_hands;
  v_cards smallint[];
begin
  perform private.pk_lock_table(p_table);
  h := private.pk_latest_hand(p_table);
  if h.id is null or h.phase <> 'settled' or h.phase_ends_at < now() - interval '5 seconds' then
    raise exception 'action_not_allowed' using hint = 'Cards can be shown just after a hand ends.';
  end if;
  select cards into v_cards from public.pk_hole where hand_id = h.id and user_id = v_uid;
  if v_cards is null or coalesce(array_length(v_cards, 1), 0) = 0 then
    raise exception 'action_not_allowed' using hint = 'You have no cards to show.';
  end if;
  update public.pk_players set shown_cards = v_cards where hand_id = h.id and user_id = v_uid and shown_cards is null;
  if found then
    perform private.bump(v_uid, 'cards_shown');
    perform private.check_achievements(v_uid);
  end if;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.trophies_for(text)', 'public.mtt_register(uuid)', 'public.mtt_unregister(uuid)', 'public.mtt_state()',
    'public.tourney_status(uuid)', 'public.mtt_poke(uuid)', 'public.pk_show(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

alter table public.tournament_tables enable row level security;
alter table public.player_trophies   enable row level security;
drop policy if exists "tournament_tables: signed-in players can read" on public.tournament_tables;
create policy "tournament_tables: signed-in players can read" on public.tournament_tables for select to authenticated using (true);
drop policy if exists "player_trophies: signed-in players can read" on public.player_trophies;
create policy "player_trophies: signed-in players can read" on public.player_trophies for select to authenticated using (true);
revoke all on public.tournament_tables, public.player_trophies from anon, authenticated;
grant select on public.tournament_tables, public.player_trophies to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

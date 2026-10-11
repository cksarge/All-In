-- =============================================================================
-- All In · 14_tournaments.sql
-- Tournaments. Needs 02, 03 (re-run: it lists the two tournament "games"),
-- 05 and 09 (re-run both: tournament tables), 10 and 13.
--
--   Sit & Go poker   No-limit Hold'em for 2, 3 or 6 players. It starts the moment
--                    the last seat is taken. Everyone gets the same tournament
--                    chips, the blinds rise every 3 minutes, and you play until
--                    one player has all the chips. It runs on a normal poker
--                    table marked play_money (see 05 and 09), so the chips on the
--                    table are never wallet chips.
--   Slot Showdown    A 15-minute round on one slot machine. Every entrant gets the
--                    same number of spins at the same bet; the biggest total wins.
--                    The entry fees are the prize pool (nothing is held back). A
--                    round with only one entrant is refunded.
--   Daily Freeroll   One free showdown a day (UTC) with prizes from the house.
--
-- Nothing runs on a timer: rounds are rows with start and end times, created the
-- first time someone looks, and settled the first time someone looks after they
-- end (or from the lobby's stale tick).
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run.
-- =============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'game_tables' and column_name = 'play_money') then
    raise exception 'Run 05_tables.sql and 09_poker.sql again first: tournament tables need their latest versions.';
  end if;
  if (select count(*) from public.games where key in ('sng_poker', 'slot_showdown')) <> 2
     or (select count(distinct game_key) from public.stake_tiers where game_key in ('sng_poker', 'slot_showdown')) <> 2 then
    raise exception 'Run 03_games_and_stakes.sql again first: it adds the tournaments to the catalogue.';
  end if;
end $$;

create table if not exists public.tournaments (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity,
  kind         text not null check (kind in ('sng', 'showdown', 'freeroll')),
  status       text not null check (status in ('registering', 'running', 'finished', 'void')),
  -- Sit & Go: seats, and the poker table it is played on.
  size         integer,
  table_id     uuid references public.game_tables (id) on delete set null,
  -- Entry fee per player (0 for the freeroll).
  entry_fee       bigint not null default 0 check (entry_fee >= 0),
  -- Showdowns: which stake level and which machine, and the round's window.
  tier         text,
  machine      text references public.games (key) on delete set null,
  starts_at    timestamptz,
  ends_at      timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists tournaments_round_key on public.tournaments (kind, tier, starts_at) where kind <> 'sng';
create index if not exists tournaments_open_idx on public.tournaments (kind, status);
create index if not exists tournaments_table_idx on public.tournaments (table_id);

create table if not exists public.tournament_entries (
  tournament_id  uuid not null references public.tournaments (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  username       text not null,
  -- registered: waiting for a Sit & Go to fill. playing: in it. out: knocked out or finished.
  status         text not null default 'playing' check (status in ('registered', 'playing', 'out')),
  -- Showdowns: points so far (hundredths of the spin bet won) and spins still to use.
  score          bigint not null default 0,
  spins_left     integer not null default 0,
  place          integer,
  prize          bigint not null default 0,
  entered_at     timestamptz not null default now(),
  finished_at    timestamptz,
  primary key (tournament_id, user_id)
);
create index if not exists tournament_entries_user_idx on public.tournament_entries (user_id, entered_at desc);

-- -----------------------------------------------------------------------------
-- The rules, in one place (the app shows them).
-- -----------------------------------------------------------------------------
create or replace function private.tourney_cfg()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{
    "sng": {
      "sizes": [2, 3, 6], "entry_fees": [250, 2500, 25000], "stack": 1500, "level_seconds": 180,
      "levels": [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400],
                 [300, 600], [500, 1000], [750, 1500], [1000, 2000]],
      "payouts": {"2": [100], "3": [100], "6": [65, 35]}
    },
    "showdown": {
      "round_seconds": 900, "spins": 30, "min_players": 2,
      "tiers": {"low": 200, "mid": 2000, "high": 20000},
      "machines": ["slots_classic", "slots_paylines", "slots_cascade", "slots_ways", "slots_holdwin"]
    },
    "freeroll": {
      "spins": 50, "prizes": [2500, 1500, 1000, 250, 250, 250, 250, 250, 250, 250]
    }
  }'::jsonb
$$;

-- How a showdown's pool is shared, in percent, by number of entrants.
create or replace function private.showdown_shares(p_entrants integer)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  select case when p_entrants >= 10 then array[50, 30, 20] when p_entrants >= 5 then array[70, 30] else array[100] end
$$;

-- Prize for each place: shares of a pool, whole chips, any remainder to first place.
create or replace function private.pool_prizes(p_pool bigint, p_shares integer[])
returns bigint[]
language sql
immutable
set search_path = ''
as $$
  select array_agg(case when o = 1 then p_pool - (select coalesce(sum(p_pool * x / 100), 0) from unnest(p_shares[2:]) x)
                        else p_pool * s / 100 end order by o)
    from unnest(p_shares) with ordinality u(s, o)
$$;

-- -----------------------------------------------------------------------------
-- Sit & Go poker
-- -----------------------------------------------------------------------------
-- Blind level (1-based) for a tournament that started at p_started.
create or replace function private.sng_level(p_started timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select least(jsonb_array_length(private.tourney_cfg() #> '{sng,levels}'),
               floor(extract(epoch from now() - p_started) / (private.tourney_cfg() #>> '{sng,level_seconds}')::numeric)::integer + 1)
$$;

-- A table's stakes at a blind level, in the shape the poker engine reads.
create or replace function private.sng_stakes(p_level integer)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'small_blind', (l ->> 0)::bigint, 'big_blind', (l ->> 1)::bigint, 'ante', 0,
    'min_stack', 1, 'max_stack', 1000000000, 'level', p_level)
    from (select private.tourney_cfg() #> '{sng,levels}' -> (p_level - 1) as l) x
$$;

-- Pays the prizes and closes the table.
create or replace function private.sng_finish(p_tournament uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tournaments;
  e public.tournament_entries;
  v_prizes bigint[];
begin
  select * into t from public.tournaments where id = p_tournament for update;
  if t.status <> 'running' then
    return;
  end if;
  update public.tournament_entries set status = 'out', place = 1, finished_at = now()
   where tournament_id = t.id and status = 'playing';
  update public.tournaments set status = 'finished', finished_at = now() where id = t.id;

  select private.pool_prizes(t.entry_fee * t.size, (select array_agg(x::integer order by o)
           from jsonb_array_elements_text(private.tourney_cfg() #> array['sng', 'payouts', t.size::text]) with ordinality p(x, o)))
    into v_prizes;
  for e in select * from public.tournament_entries where tournament_id = t.id order by place loop
    update public.tournament_entries set prize = coalesce(v_prizes[e.place], 0) where tournament_id = t.id and user_id = e.user_id;
    if coalesce(v_prizes[e.place], 0) > 0 then
      perform private.apply_chips(e.user_id, v_prizes[e.place], 'tournament_prize', 'sng_poker', t.id::text,
                                  jsonb_build_object('place', e.place, 'players', t.size));
    end if;
    perform private.record_round(e.user_id, 'sng_poker', null, t.id, t.entry_fee, coalesce(v_prizes[e.place], 0),
                                 jsonb_build_object('kind', 'sng', 'place', e.place, 'players', t.size));
  end loop;

  -- The tournament is already marked finished, so freeing the seats sets nothing else off.
  delete from public.table_seats where table_id = t.table_id;
  update public.game_tables set status = 'closed' where id = t.table_id;
end $$;

-- Brings a running Sit & Go up to date: players whose seat has gone are out,
-- players with no chips are out (once the hand is over), the blinds follow the
-- clock, and the last player left wins. Safe to call at any moment, any number of times.
create or replace function private.sng_sync(p_tournament uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tournaments;
  v_user uuid;
  v_left integer;
  v_hand_over boolean;
begin
  select * into t from public.tournaments where id = p_tournament for update;
  if not found or t.status <> 'running' then
    return;
  end if;

  loop
    select count(*) into v_left from public.tournament_entries where tournament_id = t.id and status = 'playing';
    exit when v_left <= 1;
    -- Someone whose seat is gone (they left)…
    select e.user_id into v_user from public.tournament_entries e
     where e.tournament_id = t.id and e.status = 'playing'
       and not exists (select 1 from public.table_seats s where s.table_id = t.table_id and s.user_id = e.user_id)
     order by e.entered_at desc limit 1;
    if v_user is null then
      -- …or someone with no chips after a finished hand. If two go out on the same
      -- hand, whoever started it with fewer chips finishes lower.
      select not exists (select 1 from public.pk_hands h where h.table_id = t.table_id and h.phase <> 'settled') into v_hand_over;
      exit when not v_hand_over;
      select s.user_id into v_user from public.table_seats s
        join public.tournament_entries e on e.tournament_id = t.id and e.user_id = s.user_id and e.status = 'playing'
       where s.table_id = t.table_id and s.stack = 0
       order by coalesce((select p.stack_start from public.pk_players p join public.pk_hands h on h.id = p.hand_id
                           where h.table_id = t.table_id and p.user_id = s.user_id order by h.hand_no desc limit 1), 0), s.seat_no
       limit 1;
    end if;
    exit when v_user is null;
    -- Marked out first, so that freeing the seat (which calls back in here) finds nothing to do.
    update public.tournament_entries set status = 'out', place = v_left, finished_at = now()
     where tournament_id = t.id and user_id = v_user;
    delete from public.table_seats where table_id = t.table_id and user_id = v_user;
    select * into t from public.tournaments where id = p_tournament;
    exit when t.status <> 'running';
  end loop;

  select * into t from public.tournaments where id = p_tournament;
  if t.status <> 'running' then
    return;
  end if;
  if (select count(*) from public.tournament_entries where tournament_id = t.id and status = 'playing') <= 1 then
    perform private.sng_finish(t.id);
  else
    update public.game_tables set stakes = private.sng_stakes(private.sng_level(t.started_at)), last_activity_at = now()
     where id = t.table_id;
  end if;
end $$;

-- Called by the poker engine after every hand at a tournament table (09_poker.sql).
create or replace function private.sng_after_hand(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.tournaments where table_id = p_table and status = 'running';
  if v_id is not null then
    perform private.sng_sync(v_id);
  end if;
end $$;

-- Called whenever any seat is freed (the hook convention in 05_tables.sql).
create or replace function private.sng_seat_left(p_table uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sng_after_hand(p_table);
end $$;

-- Seats everyone at a new table and deals the first hand.
create or replace function private.sng_start(p_tournament uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tournaments;
  v_table uuid;
  e record;
begin
  select * into t from public.tournaments where id = p_tournament for update;
  -- Anyone sitting somewhere else is moved (their chips there go back to their wallet).
  delete from public.table_seats where user_id in (select user_id from public.tournament_entries where tournament_id = t.id);

  insert into public.game_tables (game_key, tier, name, max_seats, play_money, stakes)
  values ('poker_holdem', 'low', 'Sit & Go #' || t.seq, t.size, true, private.sng_stakes(1))
  returning id into v_table;
  for e in select user_id, row_number() over (order by random()) as seat from public.tournament_entries where tournament_id = t.id loop
    insert into public.table_seats (table_id, seat_no, user_id, stack)
    values (v_table, e.seat, e.user_id, (private.tourney_cfg() #>> '{sng,stack}')::bigint);
  end loop;
  update public.tournament_entries set status = 'playing' where tournament_id = t.id;
  update public.tournaments set status = 'running', started_at = now(), table_id = v_table where id = t.id;

  perform private.pk_lock_table(v_table);
  perform private.pk_tick(v_table);
  return v_table;
end $$;

-- Take a seat in the Sit & Go of this size and price that is filling up.
create or replace function public.sng_register(p_size integer, p_entry_fee bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.tourney_cfg() -> 'sng';
  t public.tournaments;
  v_table uuid;
begin
  if not (c -> 'sizes' @> to_jsonb(p_size)) or not (c -> 'entry_fees' @> to_jsonb(p_entry_fee)) then
    raise exception 'unknown_tournament';
  end if;
  if not exists (select 1 from public.games where key = 'sng_poker' and released) then
    raise exception 'game_not_open';
  end if;
  if exists (select 1 from public.tournament_entries e join public.tournaments x on x.id = e.tournament_id
              where e.user_id = v_uid and x.kind = 'sng' and e.status in ('registered', 'playing')) then
    raise exception 'action_not_allowed' using hint = 'You are already in a Sit & Go. One at a time.';
  end if;

  perform pg_advisory_xact_lock(hashtext('allin_sng'));
  select * into t from public.tournaments
   where kind = 'sng' and status = 'registering' and size = p_size and entry_fee = p_entry_fee
   order by created_at limit 1 for update;
  if not found then
    insert into public.tournaments (kind, status, size, entry_fee) values ('sng', 'registering', p_size, p_entry_fee) returning * into t;
  end if;

  perform private.apply_chips(v_uid, -p_entry_fee, 'tournament_entry', 'sng_poker', t.id::text);
  insert into public.tournament_entries (tournament_id, user_id, username, status)
  values (t.id, v_uid, (select username from public.profiles where id = v_uid), 'registered');

  if (select count(*) from public.tournament_entries where tournament_id = t.id) >= t.size then
    v_table := private.sng_start(t.id);
  end if;
  return jsonb_build_object('tournament_id', t.id, 'started', v_table is not null, 'table_id', v_table);
end $$;

-- Give up your seat in a Sit & Go that hasn't started. The entry fee comes back.
create or replace function public.sng_unregister(p_tournament uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.tournaments;
begin
  perform pg_advisory_xact_lock(hashtext('allin_sng'));
  select * into t from public.tournaments where id = p_tournament and kind = 'sng' for update;
  if not found or t.status <> 'registering' then
    raise exception 'action_not_allowed' using hint = 'It has already started.';
  end if;
  delete from public.tournament_entries where tournament_id = t.id and user_id = v_uid and status = 'registered';
  if not found then
    raise exception 'action_not_allowed' using hint = 'You are not in that one.';
  end if;
  return jsonb_build_object('balance', private.apply_chips(v_uid, t.entry_fee, 'refund', 'sng_poker', t.id::text));
end $$;

-- The tournament a poker table belongs to: blinds, who is left, the prizes.
create or replace function public.sng_status(p_table uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.tourney_cfg() -> 'sng';
  t public.tournaments;
  v_level integer;
  v_count integer := jsonb_array_length(c -> 'levels');
begin
  select * into t from public.tournaments where table_id = p_table and kind = 'sng' order by created_at desc limit 1;
  if not found then
    return null;
  end if;
  v_level := case when t.status = 'running' then private.sng_level(t.started_at) end;
  return jsonb_build_object(
    'tournament_id', t.id, 'status', t.status, 'size', t.size, 'entry_fee', t.entry_fee, 'prize_pool', t.entry_fee * t.size,
    'prizes', to_jsonb(private.pool_prizes(t.entry_fee * t.size, (select array_agg(x::integer order by o)
                 from jsonb_array_elements_text(c #> array['payouts', t.size::text]) with ordinality p(x, o)))),
    'level', v_level,
    'blinds', case when v_level is not null then c -> 'levels' -> (v_level - 1) end,
    'next_blinds', case when v_level is not null and v_level < v_count then c -> 'levels' -> v_level end,
    'next_level_at', case when v_level is not null and v_level < v_count
                          then t.started_at + make_interval(secs => v_level * (c ->> 'level_seconds')::integer) end,
    'players_left', (select count(*) from public.tournament_entries where tournament_id = t.id and status = 'playing'),
    'entries', (select jsonb_agg(jsonb_build_object('user_id', e.user_id, 'username', e.username, 'status', e.status,
                                                    'place', e.place, 'prize', e.prize) order by e.place nulls first, e.username)
                  from public.tournament_entries e where e.tournament_id = t.id),
    'me', (select jsonb_build_object('status', e.status, 'place', e.place, 'prize', e.prize)
             from public.tournament_entries e where e.tournament_id = t.id and e.user_id = v_uid)
  );
end $$;

-- -----------------------------------------------------------------------------
-- Slot Showdowns and the Daily Freeroll
-- -----------------------------------------------------------------------------
-- Makes sure the rounds that are open right now exist: one showdown per stake
-- level for this 15-minute window, and today's freeroll. The machine rotates.
create or replace function private.showdown_ensure()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := private.tourney_cfg();
  v_secs integer := (c #>> '{showdown,round_seconds}')::integer;
  v_round bigint := floor(extract(epoch from now()) / v_secs)::bigint;
  v_start timestamptz := to_timestamp(v_round * v_secs);
  v_day date := (now() at time zone 'utc')::date;
  v_n integer := jsonb_array_length(c #> '{showdown,machines}');
  k record;
begin
  for k in select key, value from jsonb_each_text(c #> '{showdown,tiers}') loop
    insert into public.tournaments (kind, status, tier, entry_fee, machine, starts_at, ends_at, started_at)
    values ('showdown', 'running', k.key, k.value::bigint, c #> '{showdown,machines}' ->> (v_round % v_n)::integer,
            v_start, v_start + make_interval(secs => v_secs), v_start)
    on conflict (kind, tier, starts_at) where kind <> 'sng' do nothing;
  end loop;
  insert into public.tournaments (kind, status, tier, entry_fee, machine, starts_at, ends_at, started_at)
  values ('freeroll', 'running', 'free', 0, c #> '{showdown,machines}' ->> ((v_day - date '2026-01-01') % v_n),
          v_day::timestamp at time zone 'utc', (v_day + 1)::timestamp at time zone 'utc', v_day::timestamp at time zone 'utc')
  on conflict (kind, tier, starts_at) where kind <> 'sng' do nothing;
end $$;

-- Ranks and pays one finished round. Ties go to whoever finished their spins first.
create or replace function private.showdown_settle(p_tournament uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := private.tourney_cfg();
  t public.tournaments;
  e record;
  n integer;
  v_prizes bigint[];
begin
  select * into t from public.tournaments where id = p_tournament for update;
  if t.status <> 'running' or t.ends_at > now() then
    return;
  end if;
  select count(*) into n from public.tournament_entries where tournament_id = t.id;

  if t.kind = 'showdown' and n < (c #>> '{showdown,min_players}')::integer then
    -- Nobody to play against: the fee goes back and nothing is recorded.
    for e in select * from public.tournament_entries where tournament_id = t.id loop
      perform private.apply_chips(e.user_id, t.entry_fee, 'refund', 'slot_showdown', t.id::text);
    end loop;
    update public.tournament_entries set status = 'out', finished_at = coalesce(finished_at, now()) where tournament_id = t.id;
    update public.tournaments set status = 'void', finished_at = now() where id = t.id;
    return;
  end if;

  v_prizes := case when t.kind = 'freeroll'
                   then (select array_agg(x::bigint order by o) from jsonb_array_elements_text(c #> '{freeroll,prizes}') with ordinality p(x, o))
                   else private.pool_prizes(t.entry_fee * n, private.showdown_shares(n)) end;
  for e in
    select x.user_id, row_number() over (order by x.score desc, x.finished_at nulls last, x.entered_at) as rnk
      from public.tournament_entries x where x.tournament_id = t.id
  loop
    update public.tournament_entries
       set status = 'out', place = e.rnk, prize = coalesce(v_prizes[e.rnk], 0), finished_at = coalesce(finished_at, now())
     where tournament_id = t.id and user_id = e.user_id;
    if coalesce(v_prizes[e.rnk], 0) > 0 then
      perform private.apply_chips(e.user_id, v_prizes[e.rnk], 'tournament_prize', 'slot_showdown', t.id::text,
                                  jsonb_build_object('place', e.rnk, 'players', n));
    end if;
    perform private.record_round(e.user_id, 'slot_showdown', null, t.id, t.entry_fee, coalesce(v_prizes[e.rnk], 0),
                                 jsonb_build_object('kind', t.kind, 'place', e.rnk, 'players', n));
  end loop;
  update public.tournaments set status = 'finished', finished_at = now() where id = t.id;
end $$;

-- Settles every round whose time is up.
create or replace function private.tourney_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in select id from public.tournaments where kind <> 'sng' and status = 'running' and ends_at <= now() order by ends_at loop
    perform private.showdown_settle(v_id);
  end loop;
end $$;

create or replace function private.tourney_tick_stale()
returns void
language sql
security definer
set search_path = ''
as $$
  select private.tourney_tick();
$$;

-- Entry fees riding on tournaments that haven't finished.
create or replace function private.tourney_in_play(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(t.entry_fee), 0)::bigint
    from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id
   where e.user_id = p_user and t.status in ('registering', 'running') and (t.kind <> 'sng' or e.status <> 'out');
$$;

create or replace function public.showdown_enter(p_tournament uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.tourney_cfg();
  t public.tournaments;
  v_balance bigint;
begin
  select * into t from public.tournaments where id = p_tournament and kind <> 'sng' for update;
  if not found then
    raise exception 'unknown_tournament';
  end if;
  if t.status <> 'running' or t.ends_at <= now() then
    raise exception 'betting_closed' using hint = 'This round is over.';
  end if;
  if exists (select 1 from public.tournament_entries where tournament_id = t.id and user_id = v_uid) then
    raise exception 'action_not_allowed' using hint = 'You are already in this one.';
  end if;
  v_balance := private.apply_chips(v_uid, -t.entry_fee, 'tournament_entry', 'slot_showdown', t.id::text);
  insert into public.tournament_entries (tournament_id, user_id, username, spins_left)
  values (t.id, v_uid, (select username from public.profiles where id = v_uid),
          (c #>> array[case when t.kind = 'freeroll' then 'freeroll' else 'showdown' end, 'spins'])::integer);
  return jsonb_build_object('tournament_id', t.id, 'balance', v_balance);
end $$;

-- One tournament spin: no chips move, the win is added to your score.
create or replace function public.showdown_spin(p_tournament uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.tournaments;
  e public.tournament_entries;
  v_res jsonb;
  v_units bigint;
begin
  select * into t from public.tournaments where id = p_tournament and kind <> 'sng';
  if not found then
    raise exception 'unknown_tournament';
  end if;
  select * into e from public.tournament_entries where tournament_id = t.id and user_id = v_uid for update;
  if not found then
    raise exception 'action_not_allowed' using hint = 'Enter the round first.';
  end if;
  if t.status <> 'running' or t.ends_at <= now() then
    raise exception 'betting_closed' using hint = 'This round is over.';
  end if;
  if e.spins_left <= 0 then
    raise exception 'action_not_allowed' using hint = 'You have used all your spins.';
  end if;

  v_res := private.slot_play(private.slot_ready(t.machine));
  v_units := (v_res ->> 'units')::bigint;
  update public.tournament_entries
     set score = score + v_units, spins_left = spins_left - 1,
         finished_at = case when spins_left = 1 then now() end
   where tournament_id = t.id and user_id = v_uid
   returning * into e;
  return jsonb_build_object('round_id', gen_random_uuid(), 'game', t.machine, 'result', v_res, 'units', v_units,
                            'score', e.score, 'spins_left', e.spins_left);
end $$;

-- One round as its players see it: the standings and your own entry.
create or replace function private.showdown_json(t public.tournaments, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'status', t.status, 'tier', t.tier, 'entry_fee', t.entry_fee, 'machine', t.machine,
    'machine_name', (select name from public.games where key = t.machine),
    'starts_at', t.starts_at, 'ends_at', t.ends_at,
    'entrants', (select count(*) from public.tournament_entries e where e.tournament_id = t.id),
    'prize_pool', case when t.kind = 'freeroll'
                       then (select sum(x::bigint) from jsonb_array_elements_text(private.tourney_cfg() #> '{freeroll,prizes}') x)
                       else t.entry_fee * (select count(*) from public.tournament_entries e where e.tournament_id = t.id) end,
    'top', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'username', x.username, 'score', x.score,
                                                         'spins_left', x.spins_left, 'place', x.rnk, 'prize', x.prize) order by x.rnk), '[]'::jsonb)
              from (select e.*, row_number() over (order by e.score desc, e.finished_at nulls last, e.entered_at) as rnk
                      from public.tournament_entries e where e.tournament_id = t.id) x where x.rnk <= 10),
    'me', (select jsonb_build_object('score', x.score, 'spins_left', x.spins_left, 'place', x.rnk, 'prize', x.prize)
             from (select e.*, row_number() over (order by e.score desc, e.finished_at nulls last, e.entered_at) as rnk
                     from public.tournament_entries e where e.tournament_id = t.id) x where x.user_id = p_user))
$$;

create or replace function public.showdown_state(p_tournament uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.tournaments;
begin
  perform private.tourney_tick();
  select * into t from public.tournaments where id = p_tournament and kind <> 'sng';
  if not found then
    raise exception 'unknown_tournament';
  end if;
  return private.showdown_json(t, v_uid) || jsonb_build_object('server_now', now());
end $$;

-- Everything the Tournaments page shows.
create or replace function public.tournaments_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.tourney_cfg();
begin
  perform private.tourney_tick();
  perform private.showdown_ensure();
  return jsonb_build_object(
    'server_now', now(),
    'config', c,
    -- One row per size and price: who is waiting in the one that is filling.
    'sng', (select jsonb_agg(jsonb_build_object(
              'size', s.size, 'entry_fee', b.entry_fee, 'prize_pool', s.size * b.entry_fee, 'id', t.id,
              'players', coalesce((select jsonb_agg(e.username order by e.entered_at) from public.tournament_entries e where e.tournament_id = t.id), '[]'::jsonb),
              'registered', exists (select 1 from public.tournament_entries e where e.tournament_id = t.id and e.user_id = v_uid)
            ) order by b.entry_fee, s.size)
              from (select x::integer as size from jsonb_array_elements_text(c #> '{sng,sizes}') x) s
             cross join (select x::bigint as entry_fee from jsonb_array_elements_text(c #> '{sng,entry_fees}') x) b
              left join lateral (select * from public.tournaments t0
                                  where t0.kind = 'sng' and t0.status = 'registering' and t0.size = s.size and t0.entry_fee = b.entry_fee
                                  order by t0.created_at limit 1) t on true),
    -- The Sit & Go you are in the middle of, if any.
    'my_sng', (select jsonb_build_object('id', t.id, 'status', t.status, 'table_id', t.table_id, 'size', t.size, 'entry_fee', t.entry_fee)
                 from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id
                where e.user_id = v_uid and t.kind = 'sng' and e.status in ('registered', 'playing') limit 1),
    -- Sit & Gos being played right now, to watch.
    'live', (select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'table_id', t.table_id, 'size', t.size, 'entry_fee', t.entry_fee,
               'players_left', (select count(*) from public.tournament_entries e where e.tournament_id = t.id and e.status = 'playing')) order by t.started_at desc), '[]'::jsonb)
               from public.tournaments t where t.kind = 'sng' and t.status = 'running'),
    'showdowns', (select coalesce(jsonb_agg(private.showdown_json(t, v_uid) order by t.entry_fee), '[]'::jsonb)
                    from public.tournaments t where t.kind in ('showdown', 'freeroll') and t.status = 'running'),
    'results', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', x.id, 'kind', x.kind, 'status', x.status, 'entry_fee', x.entry_fee, 'size', x.size, 'tier', x.tier,
                  'machine_name', (select name from public.games where key = x.machine),
                  'place', x.place, 'prize', x.prize, 'score', x.score, 'at', x.finished_at,
                  'entrants', (select count(*) from public.tournament_entries e2 where e2.tournament_id = x.id)) order by x.finished_at desc), '[]'::jsonb)
                  from (select t.*, e.place, e.prize, e.score
                          from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id
                         where e.user_id = v_uid and t.status in ('finished', 'void')
                         order by t.finished_at desc limit 12) x)
  );
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.tournaments_state()', 'public.sng_register(integer, bigint)', 'public.sng_unregister(uuid)',
    'public.sng_status(uuid)', 'public.showdown_enter(uuid)', 'public.showdown_spin(uuid)', 'public.showdown_state(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security: tournaments and their standings are public to signed-in players.
-- -----------------------------------------------------------------------------
alter table public.tournaments        enable row level security;
alter table public.tournament_entries enable row level security;

drop policy if exists "tournaments: signed-in players can read" on public.tournaments;
create policy "tournaments: signed-in players can read" on public.tournaments for select to authenticated using (true);
drop policy if exists "tournament_entries: signed-in players can read" on public.tournament_entries;
create policy "tournament_entries: signed-in players can read" on public.tournament_entries for select to authenticated using (true);

revoke insert, update, delete, truncate on public.tournaments, public.tournament_entries from anon, authenticated;
revoke all on public.tournaments, public.tournament_entries from anon;
grant select on public.tournaments, public.tournament_entries to authenticated;

update public.games set released = true where key in ('sng_poker', 'slot_showdown');

select private.add_to_realtime('tournaments');
select private.add_to_realtime('tournament_entries');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

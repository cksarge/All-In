-- =============================================================================
-- All In · 05_tables.sql
-- Multiplayer tables (rooms) and seats, shared by every table game.
--   * Public tables listed in the lobby, private tables joined by invite code.
--   * One seat per player at a time.
--   * Reconnect hold: a seat is kept for 2 minutes after a player's last
--     heartbeat, so a dropped connection or closed tab can come back.
--   * Server-side randomness helpers (crypto-random, never the browser).
--   * Round history and per-game stats, written when rounds settle.
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Randomness (server only). Uses pgcrypto's CSPRNG with rejection sampling so
-- every outcome is equally likely.
-- -----------------------------------------------------------------------------
create or replace function private.random_int(p_n integer)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_limit bigint;
  v bigint;
begin
  if p_n is null or p_n < 1 then
    raise exception 'random_int: n must be >= 1';
  end if;
  v_limit := (4294967296 / p_n) * p_n;
  loop
    v := ('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint;
    if v < 0 then v := v + 4294967296; end if;
    exit when v < v_limit;
  end loop;
  return (v % p_n)::integer;
end $$;

-- Fisher-Yates shuffle of `p_decks` standard 52-card decks.
-- Cards are smallints 0..51: rank = c % 13 (0 = Ace … 12 = King), suit = c / 13.
create or replace function private.shuffled_shoe(p_decks integer)
returns smallint[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  v smallint[];
  n integer;
  j integer;
  t smallint;
begin
  select array_agg((g % 52)::smallint) into v from generate_series(0, p_decks * 52 - 1) g;
  n := cardinality(v);
  for i in reverse n..2 loop
    j := private.random_int(i) + 1;
    t := v[i]; v[i] := v[j]; v[j] := t;
  end loop;
  return v;
end $$;

create or replace function private.random_code(p_len integer)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O, 1/I
  v text := '';
begin
  for i in 1..p_len loop
    v := v || substr(alphabet, private.random_int(length(alphabet)) + 1, 1);
  end loop;
  return v;
end $$;

revoke all on function private.random_int(integer) from public;
revoke all on function private.shuffled_shoe(integer) from public;
revoke all on function private.random_code(integer) from public;

-- -----------------------------------------------------------------------------
-- Tables and seats
-- -----------------------------------------------------------------------------
create table if not exists public.game_tables (
  id                uuid primary key default gen_random_uuid(),
  game_key          text not null references public.games (key) on delete cascade,
  tier              text not null,
  name              text not null,
  is_private        boolean not null default false,
  invite_code       text unique,
  max_seats         integer not null check (max_seats between 1 and 9),
  persistent        boolean not null default false,
  created_by        uuid references auth.users (id) on delete set null,
  status            text not null default 'open' check (status in ('open', 'closed')),
  created_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now(),
  foreign key (game_key, tier) references public.stake_tiers (game_key, tier),
  constraint game_tables_private_code check (not is_private or invite_code is not null)
);

create index if not exists game_tables_lobby_idx on public.game_tables (game_key, status, is_private);

-- Game-specific table style, e.g. roulette 'european' / 'american'. Null for most games.
alter table public.game_tables add column if not exists variant text;

create or replace function private.default_variant(p_game text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_game when 'roulette' then 'european' end;
$$;

create or replace function private.valid_variant(p_game text, p_variant text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_game = 'roulette' then
    if coalesce(p_variant, 'european') not in ('european', 'american') then
      raise exception 'invalid_variant';
    end if;
    return coalesce(p_variant, 'european');
  end if;
  return null;
end $$;

create table if not exists public.table_seats (
  table_id      uuid not null references public.game_tables (id) on delete cascade,
  seat_no       integer not null check (seat_no between 1 and 9),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- Chips brought to the table (used by poker in a later phase; 0 for house games).
  stack         bigint not null default 0 check (stack >= 0),
  status        text not null default 'active' check (status in ('active', 'sitting_out')),
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (table_id, seat_no),
  constraint table_seats_one_seat_per_player unique (user_id)
);

create index if not exists table_seats_table_idx on public.table_seats (table_id);

-- Seconds without a heartbeat before a player shows as disconnected, and before
-- their seat is released.
create or replace function private.seat_timeouts()
returns table (disconnected interval, release interval)
language sql
immutable
set search_path = ''
as $$
  select interval '45 seconds', interval '2 minutes';
$$;

-- Can the current user see this table? Public tables: anyone signed in.
-- Private tables: players seated there and the creator.
create or replace function private.can_view_table(p_table uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.game_tables t
     where t.id = p_table
       and (
         not t.is_private
         or t.created_by = auth.uid()
         or exists (select 1 from public.table_seats s where s.table_id = t.id and s.user_id = auth.uid())
       )
  );
$$;

revoke all on function private.can_view_table(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

-- Release seats whose players have been gone longer than the reconnect hold,
-- and close empty, idle, non-persistent tables.
create or replace function private.cleanup_tables()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.table_seats s
   where s.last_seen_at < now() - (select release from private.seat_timeouts());

  update public.game_tables t
     set status = 'closed'
   where t.status = 'open'
     and not t.persistent
     and t.last_activity_at < now() - case when t.is_private then interval '30 minutes' else interval '10 minutes' end
     and not exists (select 1 from public.table_seats s where s.table_id = t.id)
     -- Never close the only public table at this stake level that still has a free seat.
     and (t.is_private or exists (
           select 1 from public.game_tables o
            where o.id <> t.id and o.game_key = t.game_key and o.tier = t.tier
              and o.status = 'open' and not o.is_private
              and (select count(*) from public.table_seats s where s.table_id = o.id) < o.max_seats));
end $$;

create or replace function private.public_table_name()
returns text
language sql
volatile
set search_path = ''
as $$
  select (array['Velvet', 'Monarch', 'Starlight', 'Gilded', 'Midnight', 'Crown', 'Marquee', 'Lucky'])[private.random_int(8) + 1]
         || ' ' || (array['Lounge', 'Room', 'Salon', 'Parlor'])[private.random_int(4) + 1]
         || ' ' || (100 + private.random_int(900))::text;
$$;

create or replace function private.tier_has_free_table(p_game text, p_tier text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.game_tables t
     where t.game_key = p_game and t.tier = p_tier and t.status = 'open' and not t.is_private
       and (select count(*) from public.table_seats s where s.table_id = t.id) < t.max_seats
  );
$$;

-- Guarantee there is always at least one public table with a free seat at every
-- stake level of an open multiplayer game. When the last one fills up, a new
-- table opens automatically (advisory lock: only one is created even if many
-- players look at the lobby at the same moment).
create or replace function private.ensure_open_tables(p_game text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seats integer;
  v_tier text;
begin
  select max_seats into v_seats from public.games where key = p_game and multiplayer and released;
  if v_seats is null then
    return;
  end if;
  for v_tier in select tier from public.stake_tiers where game_key = p_game order by tier_rank loop
    if not private.tier_has_free_table(p_game, v_tier) then
      perform pg_advisory_xact_lock(hashtext('allin-open-table:' || p_game || ':' || v_tier));
      if not private.tier_has_free_table(p_game, v_tier) then
        insert into public.game_tables (game_key, tier, name, max_seats)
        values (p_game, v_tier, private.public_table_name(), v_seats);
        update public.game_tables set variant = private.default_variant(p_game)
         where game_key = p_game and tier = v_tier and variant is null and private.default_variant(p_game) is not null;
      end if;
    end if;
  end loop;
end $$;

revoke all on function private.cleanup_tables() from public;

-- Each game file plugs into these two by defining functions that follow a
-- naming convention, so adding a game never means editing shared code:
--   private.<game>_tick_stale()      finishes that game's rounds whose timers ran
--                                    out while nobody was watching
--   private.<game>_in_play(uuid)     chips that player has riding on that game

-- Finishes rounds whose timers ran out while nobody was watching (e.g. every
-- player closed their tab mid-hand), for every game.
create or replace function private.tick_stale_tables()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f text;
begin
  for f in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname like '%\_tick\_stale' and p.pronargs = 0
     order by p.proname
  loop
    execute format('select private.%I()', f);
  end loop;
end $$;

-- Chips a player has committed at tables: seated stacks plus every game's
-- unresolved bets. Used by refills and stake-level checks.
create or replace function private.chips_in_play(p_user uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total bigint := coalesce((select sum(stack) from public.table_seats where user_id = p_user), 0);
  v bigint;
  f text;
begin
  for f in
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname like '%\_in\_play' and p.proname <> 'chips_in_play' and p.pronargs = 1
     order by p.proname
  loop
    execute format('select private.%I($1)', f) into v using p_user;
    v_total := v_total + coalesce(v, 0);
  end loop;
  return v_total;
end $$;

-- Seat the current user. Leaves any other table first (one seat at a time).
create or replace function private.take_seat(p_user uuid, p_table uuid, p_seat integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.game_tables;
  v_seat integer;
begin
  select * into t from public.game_tables where id = p_table for update;
  if not found or t.status <> 'open' then
    raise exception 'table_not_found';
  end if;

  -- Already here? Just refresh the heartbeat.
  select seat_no into v_seat from public.table_seats where table_id = p_table and user_id = p_user;
  if found then
    update public.table_seats set last_seen_at = now(), status = 'active'
     where table_id = p_table and user_id = p_user;
    return v_seat;
  end if;

  perform private.assert_tier_access(p_user, t.game_key, t.tier);

  -- One table at a time: free the old seat (any unfinished hands play out on their own).
  delete from public.table_seats where user_id = p_user;

  if p_seat is not null then
    if p_seat < 1 or p_seat > t.max_seats then
      raise exception 'seat_invalid';
    end if;
    if exists (select 1 from public.table_seats where table_id = p_table and seat_no = p_seat) then
      raise exception 'seat_taken';
    end if;
    v_seat := p_seat;
  else
    select min(g) into v_seat
      from generate_series(1, t.max_seats) g
     where not exists (select 1 from public.table_seats s where s.table_id = p_table and s.seat_no = g);
    if v_seat is null then
      raise exception 'table_full';
    end if;
  end if;

  insert into public.table_seats (table_id, seat_no, user_id) values (p_table, v_seat, p_user);
  update public.game_tables set last_activity_at = now() where id = p_table;
  return v_seat;
end $$;

revoke all on function private.take_seat(uuid, uuid, integer) from public;

create or replace function private.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return auth.uid();
end $$;

-- -----------------------------------------------------------------------------
-- Public RPCs: lobby and seats
-- -----------------------------------------------------------------------------

-- Live tables for a game: public open tables, plus private tables you're at.
create or replace function public.list_tables(p_game text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_disc interval := (select disconnected from private.seat_timeouts());
begin
  perform private.cleanup_tables();
  perform private.tick_stale_tables();
  perform private.ensure_open_tables(p_game);
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.tier_rank, x.persistent desc, x.seats_filled desc, x.created_at)
      from (
        select t.id, t.name, t.tier, t.variant, st.tier_rank, st.label as tier_label, st.min_bet, st.max_bet, st.min_bankroll,
               t.is_private, t.max_seats, t.persistent, t.created_at,
               (select count(*) from public.table_seats s where s.table_id = t.id)::int as seats_filled,
               exists (select 1 from public.table_seats s where s.table_id = t.id and s.user_id = v_uid) as is_mine,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'seat_no', s.seat_no,
                          'username', p.username,
                          'connected', s.last_seen_at > now() - v_disc) order by s.seat_no)
                   from public.table_seats s join public.profiles p on p.id = s.user_id
                  where s.table_id = t.id), '[]'::jsonb) as players
          from public.game_tables t
          join public.stake_tiers st on st.game_key = t.game_key and st.tier = t.tier
         where t.game_key = p_game
           and t.status = 'open'
           and (not t.is_private
                or exists (select 1 from public.table_seats s where s.table_id = t.id and s.user_id = v_uid))
      ) x
  ), '[]'::jsonb);
end $$;

-- Create a table and sit down at it. Private tables get a 6-character invite code.
drop function if exists public.create_table(text, text, boolean);
create or replace function public.create_table(p_game text, p_tier text, p_private boolean default false, p_variant text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  g public.games;
  v_name text;
  v_code text;
  v_id uuid;
  v_seat integer;
begin
  select * into g from public.games where key = p_game;
  if not found or not g.multiplayer then
    raise exception 'unknown_game';
  end if;
  if not g.released then
    raise exception 'game_not_open';
  end if;
  perform private.assert_tier_access(v_uid, p_game, p_tier);
  if exists (select 1 from public.game_tables where created_by = v_uid and created_at > now() - interval '20 seconds') then
    raise exception 'slow_down' using hint = 'Please wait a few seconds before opening another table.';
  end if;

  if p_private then
    loop
      v_code := private.random_code(6);
      exit when not exists (select 1 from public.game_tables where invite_code = v_code);
    end loop;
    select username || '''s table' into v_name from public.profiles where id = v_uid;
  else
    v_name := private.public_table_name();
  end if;

  insert into public.game_tables (game_key, tier, name, is_private, invite_code, max_seats, created_by, variant)
  values (p_game, p_tier, v_name, coalesce(p_private, false), v_code, g.max_seats, v_uid, private.valid_variant(p_game, p_variant))
  returning id into v_id;

  v_seat := private.take_seat(v_uid, v_id, null);
  return jsonb_build_object('table_id', v_id, 'invite_code', v_code, 'seat_no', v_seat);
end $$;

-- Quick join: the busiest public table at this stake with a free seat, or a new one.
create or replace function public.quick_join(p_game text, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_table uuid;
  v_seat integer;
begin
  perform private.cleanup_tables();
  perform private.assert_tier_access(v_uid, p_game, p_tier);

  select t.id into v_table
    from public.game_tables t
   where t.game_key = p_game and t.tier = p_tier and t.status = 'open' and not t.is_private
     and (select count(*) from public.table_seats s where s.table_id = t.id) < t.max_seats
   order by exists (select 1 from public.table_seats s where s.table_id = t.id and s.user_id = v_uid) desc,
            (select count(*) from public.table_seats s where s.table_id = t.id) desc,
            t.persistent desc, t.created_at
   limit 1;

  if v_table is null then
    -- Every table at this level is full: open a new one and sit there.
    perform private.ensure_open_tables(p_game);
    select t.id into v_table
      from public.game_tables t
     where t.game_key = p_game and t.tier = p_tier and t.status = 'open' and not t.is_private
       and (select count(*) from public.table_seats s where s.table_id = t.id) < t.max_seats
     order by t.created_at
     limit 1;
    if v_table is null then
      raise exception 'game_not_open';
    end if;
  end if;

  v_seat := private.take_seat(v_uid, v_table, null);
  return jsonb_build_object('table_id', v_table, 'seat_no', v_seat);
end $$;

-- Sit at a specific table (optionally a specific seat).
create or replace function public.join_table(p_table uuid, p_seat integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_seat integer;
begin
  perform private.cleanup_tables();
  if not private.can_view_table(p_table) then
    raise exception 'table_not_found';
  end if;
  v_seat := private.take_seat(v_uid, p_table, p_seat);
  return jsonb_build_object('table_id', p_table, 'seat_no', v_seat);
end $$;

-- Join a private table by its invite code.
create or replace function public.join_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_table uuid;
  v_seat integer;
begin
  perform private.cleanup_tables();
  select id into v_table from public.game_tables
   where invite_code = upper(btrim(p_code)) and status = 'open';
  if v_table is null then
    raise exception 'invite_not_found';
  end if;
  v_seat := private.take_seat(v_uid, v_table, null);
  return jsonb_build_object('table_id', v_table, 'seat_no', v_seat);
end $$;

create or replace function public.leave_table(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  delete from public.table_seats where table_id = p_table and user_id = v_uid;
  update public.game_tables set last_activity_at = now() where id = p_table;
end $$;

-- Called by the client every ~15 seconds while at a table. Keeps the seat.
create or replace function public.table_heartbeat(p_table uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_seat integer;
begin
  update public.table_seats set last_seen_at = now()
   where table_id = p_table and user_id = v_uid
  returning seat_no into v_seat;
  return jsonb_build_object('seated', v_seat is not null, 'seat_no', v_seat, 'server_now', now());
end $$;

create or replace function public.set_sitting_out(p_table uuid, p_sitting_out boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  update public.table_seats
     set status = case when p_sitting_out then 'sitting_out' else 'active' end,
         last_seen_at = now()
   where table_id = p_table and user_id = v_uid;
  if not found then
    raise exception 'not_seated';
  end if;
end $$;

-- Where am I sitting? Used to offer "return to your table" after a reconnect.
create or replace function public.my_table()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('table_id', t.id, 'game_key', t.game_key, 'name', t.name, 'seat_no', s.seat_no)
    from public.table_seats s
    join public.game_tables t on t.id = s.table_id
   where s.user_id = auth.uid()
     and s.last_seen_at > now() - (select release from private.seat_timeouts())
   limit 1;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.list_tables(text)', 'public.create_table(text, text, boolean, text)', 'public.quick_join(text, text)',
    'public.join_table(uuid, integer)', 'public.join_by_code(text)', 'public.leave_table(uuid)',
    'public.table_heartbeat(uuid)', 'public.set_sitting_out(uuid, boolean)', 'public.my_table()'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Round history and per-game stats (written by each game's settle function)
-- -----------------------------------------------------------------------------
create table if not exists public.game_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  game_key    text not null references public.games (key) on delete cascade,
  table_id    uuid references public.game_tables (id) on delete set null,
  round_id    uuid,
  wagered     bigint not null default 0 check (wagered >= 0),
  returned    bigint not null default 0 check (returned >= 0),
  net         bigint generated always as (returned - wagered) stored,
  outcome     text not null check (outcome in ('win', 'loss', 'push')),
  summary     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists game_history_user_idx on public.game_history (user_id, created_at desc);
create index if not exists game_history_game_idx on public.game_history (game_key, created_at desc);

create table if not exists public.player_game_stats (
  user_id         uuid not null references auth.users (id) on delete cascade,
  game_key        text not null references public.games (key) on delete cascade,
  rounds_played   bigint not null default 0,
  rounds_won      bigint not null default 0,
  rounds_lost     bigint not null default 0,
  rounds_pushed   bigint not null default 0,
  total_wagered   bigint not null default 0,
  total_returned  bigint not null default 0,
  biggest_win     bigint not null default 0,
  last_played_at  timestamptz,
  primary key (user_id, game_key)
);

create or replace function private.record_round(
  p_user uuid, p_game text, p_table uuid, p_round uuid,
  p_wagered bigint, p_returned bigint, p_summary jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text := case when p_returned > p_wagered then 'win'
                         when p_returned < p_wagered then 'loss'
                         else 'push' end;
begin
  insert into public.game_history (user_id, game_key, table_id, round_id, wagered, returned, outcome, summary)
  values (p_user, p_game, p_table, p_round, p_wagered, p_returned, v_outcome, coalesce(p_summary, '{}'::jsonb));

  insert into public.player_game_stats as s
         (user_id, game_key, rounds_played, rounds_won, rounds_lost, rounds_pushed,
          total_wagered, total_returned, biggest_win, last_played_at)
  values (p_user, p_game, 1,
          (v_outcome = 'win')::int, (v_outcome = 'loss')::int, (v_outcome = 'push')::int,
          p_wagered, p_returned, greatest(p_returned - p_wagered, 0), now())
  on conflict (user_id, game_key) do update set
    rounds_played  = s.rounds_played + 1,
    rounds_won     = s.rounds_won + excluded.rounds_won,
    rounds_lost    = s.rounds_lost + excluded.rounds_lost,
    rounds_pushed  = s.rounds_pushed + excluded.rounds_pushed,
    total_wagered  = s.total_wagered + excluded.total_wagered,
    total_returned = s.total_returned + excluded.total_returned,
    biggest_win    = greatest(s.biggest_win, excluded.biggest_win),
    last_played_at = now();
end $$;

revoke all on function private.record_round(uuid, text, uuid, uuid, bigint, bigint, jsonb) from public;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.game_tables       enable row level security;
alter table public.table_seats       enable row level security;
alter table public.game_history      enable row level security;
alter table public.player_game_stats enable row level security;

drop policy if exists "game_tables: visible tables" on public.game_tables;
create policy "game_tables: visible tables"
  on public.game_tables for select
  to authenticated
  using (private.can_view_table(id));

drop policy if exists "table_seats: seats at visible tables" on public.table_seats;
create policy "table_seats: seats at visible tables"
  on public.table_seats for select
  to authenticated
  using (private.can_view_table(table_id));

drop policy if exists "game_history: read own" on public.game_history;
create policy "game_history: read own"
  on public.game_history for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "player_game_stats: signed-in players can read" on public.player_game_stats;
create policy "player_game_stats: signed-in players can read"
  on public.player_game_stats for select
  to authenticated
  using (true);

revoke insert, update, delete, truncate on public.game_tables, public.table_seats,
  public.game_history, public.player_game_stats from anon, authenticated;
revoke all on public.game_tables, public.table_seats, public.game_history, public.player_game_stats from anon;
grant select on public.game_tables, public.table_seats, public.game_history, public.player_game_stats to authenticated;

-- Live updates for the lobby and tables.
select private.add_to_realtime('game_tables');
select private.add_to_realtime('table_seats');

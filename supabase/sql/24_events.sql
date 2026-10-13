-- =============================================================================
-- All In · 24_events.sql
-- Stage 12, part 3: private tournaments and club events.
-- Run AFTER 01-23. Safe to re-run.
--
-- A private tournament is a Sit & Go (14_tournaments.sql) that one player sets
-- up and others join with a code, instead of from the public list. A club event
-- is the same thing set up by a club's owner or an officer: the club's members
-- join it from the Tournaments page without a code.
--
-- Once it is full it is an ordinary Sit & Go: the same table, blinds, payouts
-- and history. What is different:
--   * the entry may be free (0 chips), or one of a few fixed amounts;
--   * it is not in the public list and cannot be watched from it;
--   * winning one is not a tournament win: no trophy, no place on the
--     tournament leaderboard (13 and 18 check the round's summary). It has its
--     own two achievements: hosting one, and winning a club event.
--   * one that has not filled in two hours is called off and everyone is paid back.
--
-- The other pieces of part 3 live where their tables are: the seasonal game in
-- 03 and 10, the season's missions in 16.
--
-- All In is a free game. No real money is ever used.
-- =============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tournaments' and column_name = 'invite_code') then
    raise exception 'Run 14_tournaments.sql again first: private tournaments need its latest version.';
  end if;
  if to_regclass('public.club_members') is null then
    raise exception 'Run 17_clubs_records.sql first: club events need the clubs.';
  end if;
end $$;

create or replace function private.events_cfg()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"entry_fees": [0, 100, 250, 1000, 2500, 10000, 25000], "wait_minutes": 120}'::jsonb
$$;

-- Calls off one that never filled: everyone gets their entry back.
create or replace function private.event_void(p_tournament uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tournaments;
  e record;
begin
  select * into t from public.tournaments where id = p_tournament for update;
  if not found or t.status <> 'registering' or t.invite_code is null then
    return;
  end if;
  for e in select user_id from public.tournament_entries where tournament_id = t.id loop
    if t.entry_fee > 0 then
      perform private.apply_chips(e.user_id, t.entry_fee, 'refund', 'sng_poker', t.id::text);
    end if;
  end loop;
  delete from public.tournament_entries where tournament_id = t.id;
  update public.tournaments set status = 'void', finished_at = now() where id = t.id;
end $$;

create or replace function private.events_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select id from public.tournaments
            where kind = 'sng' and status = 'registering' and invite_code is not null
              and created_at < now() - make_interval(mins => (private.events_cfg() ->> 'wait_minutes')::integer) loop
    perform private.event_void(r.id);
  end loop;
end $$;

-- Puts a player into one (the caller holds the Sit & Go lock). Starts it when it is full.
create or replace function private.event_enter(p_tournament uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tournaments;
  v_table uuid;
begin
  select * into t from public.tournaments where id = p_tournament for update;
  if exists (select 1 from public.tournament_entries e join public.tournaments x on x.id = e.tournament_id
              where e.user_id = p_user and x.kind in ('sng', 'mtt') and e.status in ('registered', 'playing')
                and x.status in ('registering', 'running')) then
    raise exception 'action_not_allowed' using hint = 'You are already in a poker tournament. One at a time.';
  end if;
  if t.entry_fee > 0 then
    perform private.apply_chips(p_user, -t.entry_fee, 'tournament_entry', 'sng_poker', t.id::text);
  end if;
  insert into public.tournament_entries (tournament_id, user_id, username, status)
  values (t.id, p_user, (select username from public.profiles where id = p_user), 'registered');

  if (select count(*) from public.tournament_entries where tournament_id = t.id) >= t.size then
    v_table := private.sng_start(t.id);
    if t.host is not null then
      perform private.bump(t.host, 'tournaments_hosted');
      perform private.check_achievements(t.host);
    end if;
  end if;
  return jsonb_build_object('tournament_id', t.id, 'started', v_table is not null, 'table_id', v_table);
end $$;

-- Sets one up and takes the first seat. p_club: make it an event for your club (owner or officer).
create or replace function public.sng_private_create(p_size integer, p_entry_fee bigint, p_variant text default 'standard', p_club boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.tourney_cfg() -> 'sng';
  m public.club_members;
  t public.tournaments;
  v_code text;
  r jsonb;
begin
  if not (c -> 'sizes' @> to_jsonb(p_size)) or not (private.events_cfg() -> 'entry_fees' @> to_jsonb(p_entry_fee))
     or not (c -> 'variants' ? coalesce(p_variant, '')) then
    raise exception 'unknown_tournament';
  end if;
  if not exists (select 1 from public.games where key = 'sng_poker' and released) then
    raise exception 'game_not_open';
  end if;
  if coalesce(p_club, false) then
    select * into m from public.club_members where user_id = v_uid;
    if not found or m.role not in ('owner', 'officer') then
      raise exception 'action_not_allowed' using hint = 'Only a club''s owner and officers can set up a club event.';
    end if;
    if p_size < 3 then
      raise exception 'action_not_allowed' using hint = 'A club event needs three or six players.';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('allin_sng'));
  perform private.events_sweep();
  if exists (select 1 from public.tournaments where host = v_uid and status = 'registering' and invite_code is not null) then
    raise exception 'action_not_allowed' using hint = 'You already have one waiting for players.';
  end if;
  if m.club_id is not null and exists (select 1 from public.tournaments where club_id = m.club_id and status = 'registering') then
    raise exception 'action_not_allowed' using hint = 'Your club already has an event waiting for players.';
  end if;
  loop
    v_code := private.random_code(6);
    exit when not exists (select 1 from public.tournaments where invite_code = v_code);
  end loop;
  insert into public.tournaments (kind, status, size, entry_fee, variant, host, invite_code, club_id)
  values ('sng', 'registering', p_size, p_entry_fee, p_variant, v_uid, v_code, m.club_id) returning * into t;
  r := private.event_enter(t.id, v_uid);

  if t.club_id is not null then
    perform private.notify(cm.user_id, 'club_event', jsonb_build_object(
              'from', (select username from public.profiles where id = v_uid),
              'club', (select name from public.clubs where id = t.club_id),
              'size', t.size, 'entry_fee', t.entry_fee))
       from public.club_members cm where cm.club_id = t.club_id and cm.user_id <> v_uid;
  end if;
  return r || jsonb_build_object('code', v_code);
end $$;

-- Joins by code, or (a club event of your own club) by its id.
create or replace function public.sng_private_join(p_code text default null, p_tournament uuid default null)
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
  perform private.events_sweep();
  if p_tournament is not null then
    select * into t from public.tournaments
     where id = p_tournament and kind = 'sng' and invite_code is not null
       and club_id is not null and club_id = (select club_id from public.club_members where user_id = v_uid)
     for update;
  else
    select * into t from public.tournaments
     where kind = 'sng' and invite_code = upper(btrim(coalesce(p_code, ''))) for update;
  end if;
  if not found then
    raise exception 'unknown_tournament' using hint = 'No tournament has that code.';
  end if;
  if t.status <> 'registering' then
    raise exception 'action_not_allowed' using hint = 'It has already started, or was called off.';
  end if;
  -- A club event is for the club, even with the code.
  if t.club_id is not null and not exists (select 1 from public.club_members where user_id = v_uid and club_id = t.club_id) then
    raise exception 'action_not_allowed' using hint = 'That event is for members of the club.';
  end if;
  if exists (select 1 from public.tournament_entries where tournament_id = t.id and user_id = v_uid) then
    raise exception 'action_not_allowed' using hint = 'You are already in it.';
  end if;
  if t.host is not null and exists (select 1 from public.player_blocks b
              where (b.blocker = t.host and b.blocked = v_uid) or (b.blocker = v_uid and b.blocked = t.host)) then
    raise exception 'unknown_tournament' using hint = 'No tournament has that code.';
  end if;
  return private.event_enter(t.id, v_uid);
end $$;

-- The host calls it off before it starts.
create or replace function public.sng_private_cancel(p_tournament uuid)
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
  select * into t from public.tournaments where id = p_tournament and kind = 'sng' and invite_code is not null for update;
  if not found or t.host is distinct from v_uid then
    raise exception 'action_not_allowed' using hint = 'Only the host can call it off.';
  end if;
  if t.status <> 'registering' then
    raise exception 'action_not_allowed' using hint = 'It has already started.';
  end if;
  perform private.event_void(t.id);
  return jsonb_build_object('balance', (select balance from public.wallets where user_id = v_uid));
end $$;

-- What the Tournaments page shows about them: the ones you are waiting in, and your club's.
create or replace function public.events_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_club uuid := (select club_id from public.club_members where user_id = v_uid);
  v_role text := (select role from public.club_members where user_id = v_uid);
begin
  if exists (select 1 from public.tournaments
              where kind = 'sng' and status = 'registering' and invite_code is not null
                and created_at < now() - make_interval(mins => (private.events_cfg() ->> 'wait_minutes')::integer)) then
    perform pg_advisory_xact_lock(hashtext('allin_sng'));
    perform private.events_sweep();
  end if;
  return jsonb_build_object(
    'entry_fees', private.events_cfg() -> 'entry_fees',
    'wait_minutes', private.events_cfg() -> 'wait_minutes',
    'club', (select jsonb_build_object('id', c.id, 'name', c.name, 'can_host', v_role in ('owner', 'officer')) from public.clubs c where c.id = v_club),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', t.id, 'size', t.size, 'entry_fee', t.entry_fee, 'variant', t.variant, 'prize_pool', t.size * t.entry_fee,
                 'club', t.club_id is not null,
                 'host', (select username from public.profiles where id = t.host),
                 'mine', t.host = v_uid,
                 'registered', x.inside,
                 -- The code goes to the people already in it (so they can pass it on), never to anyone else.
                 'code', case when x.inside and t.club_id is null then t.invite_code end,
                 'players', (select coalesce(jsonb_agg(e.username order by e.entered_at), '[]'::jsonb)
                               from public.tournament_entries e where e.tournament_id = t.id),
                 'closes_at', t.created_at + make_interval(mins => (private.events_cfg() ->> 'wait_minutes')::integer)
               ) order by t.created_at), '[]'::jsonb)
                 from public.tournaments t
                cross join lateral (select exists (select 1 from public.tournament_entries e
                                                    where e.tournament_id = t.id and e.user_id = v_uid) as inside) x
                where t.kind = 'sng' and t.status = 'registering' and t.invite_code is not null
                  and (x.inside or (t.club_id is not null and t.club_id = v_club))));
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.sng_private_create(integer, bigint, text, boolean)', 'public.sng_private_join(text, uuid)',
    'public.sng_private_cancel(uuid)', 'public.events_state()'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

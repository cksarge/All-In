-- =============================================================================
-- All In · 15_moderation.sql
-- Stage 9, part 1: the admin, reports, blocks, bans, timeouts and forced renames.
-- Run AFTER 01-14 (re-run 05_tables.sql first: its require_uid() calls the check here).
-- Safe to re-run.
--
--   * admins            who may use the admin RPCs (hidden). Seeded with the player
--                       whose username is "Carter". Being an admin is a row here,
--                       tied to the account id, never to whatever a name says.
--   * player_sanctions  ban / timeout / must-rename per player (own row readable).
--   * player_blocks     who has blocked whom (own rows readable).
--   * player_reports    reports sent by players (hidden: only the admin RPCs read them).
--   * admin_log         every admin action (hidden).
--   * site_notice       one optional announcement shown to everyone.
--
-- Enforcement: private.require_uid() (05) starts every game RPC and calls
-- private.sanction_check(), so a banned or timed-out player can do nothing,
-- whatever their browser sends.
-- =============================================================================

create table if not exists public.admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  added_at  timestamptz not null default now()
);

create table if not exists public.player_sanctions (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  banned_at       timestamptz,
  ban_reason      text,
  timeout_until   timestamptz,
  timeout_reason  text,
  must_rename     boolean not null default false,
  updated_at      timestamptz not null default now()
);

-- The name a moderator took away, so the player cannot simply choose it again.
alter table public.player_sanctions add column if not exists removed_name text;

-- HIDDEN: the admin's own notes on a player's file. The player never sees them.
create table if not exists public.player_notes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  admin_id    uuid references auth.users (id) on delete set null,
  note        text not null check (char_length(note) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists player_notes_user_idx on public.player_notes (user_id, id desc);

-- When each player was last on the site with a working session (hidden; the admin page shows it).
-- auth.users.last_sign_in_at only moves on a password sign-in, not when a saved session is reused.
create table if not exists public.player_activity (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  last_seen_at  timestamptz not null default now()
);

create table if not exists public.player_blocks (
  blocker     uuid not null references auth.users (id) on delete cascade,
  blocked     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

create table if not exists public.player_reports (
  id           bigint generated always as identity primary key,
  reporter     uuid references auth.users (id) on delete set null,
  reported     uuid not null references auth.users (id) on delete cascade,
  reason       text not null check (reason in ('name', 'cheating', 'harassment', 'other')),
  note         text check (char_length(note) <= 300),
  context      jsonb not null default '{}'::jsonb,
  status       text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolution   text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists player_reports_status_idx on public.player_reports (status, created_at desc);
create index if not exists player_reports_reported_idx on public.player_reports (reported);

create table if not exists public.admin_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid references auth.users (id) on delete set null,
  action      text not null,
  target      uuid,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_log_target_idx on public.admin_log (target, created_at desc);

create table if not exists public.site_notice (
  id          boolean primary key default true check (id),
  message     text check (char_length(message) <= 200),
  updated_at  timestamptz not null default now()
);
insert into public.site_notice (id, message) values (true, null) on conflict (id) do nothing;

-- Maintenance mode: one row. While it is on, only the admin can use the site
-- (see private.sanction_check, and site_status() which every browser asks first).
create table if not exists public.site_status (
  id           boolean primary key default true check (id),
  maintenance  boolean not null default false,
  message      text check (char_length(message) <= 300),
  updated_at   timestamptz not null default now()
);
insert into public.site_status (id) values (true) on conflict (id) do nothing;

-- The admin: the account whose username is Carter (matched once, stored by id).
insert into public.admins (user_id)
select id from public.profiles where lower(username) = 'carter'
on conflict (user_id) do nothing;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function private.is_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = p_user);
$$;

-- Called by private.require_uid() at the start of every game RPC.
create or replace function private.sanction_check(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.player_sanctions;
begin
  -- Maintenance: every game call from anyone but the admin stops here, whatever their browser shows.
  if (select maintenance from public.site_status where id) and not private.is_admin(p_user) then
    raise exception 'site_maintenance' using hint = 'The site is closed for maintenance. Please come back soon.';
  end if;
  select * into s from public.player_sanctions where user_id = p_user;
  if not found then
    return;
  end if;
  if s.banned_at is not null then
    raise exception 'account_banned' using hint = 'This account has been suspended.';
  end if;
  if s.timeout_until is not null and s.timeout_until > now() then
    raise exception 'account_timeout' using hint = 'This account is in a timeout. Try again later.';
  end if;
  if s.must_rename then
    raise exception 'rename_required' using hint = 'Choose a new username to keep playing.';
  end if;
end $$;

-- The caller's id, if they are the admin. Deliberately not require_uid(): the admin RPCs
-- answer "not_admin" to everyone else, signed in or not.
create or replace function private.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function private.admin_note(p_action text, p_target uuid, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_log (admin_id, action, target, details) values (auth.uid(), p_action, p_target, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function private.sanction_row(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.player_sanctions (user_id) values (p_user) on conflict (user_id) do nothing;
$$;

-- A player the admin may act on: exists, and is not an admin.
create or replace function private.admin_target(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'player_not_found';
  end if;
  if private.is_admin(p_user) then
    raise exception 'action_not_allowed' using hint = 'That account is an admin.';
  end if;
end $$;

-- Takes a player out of whatever they are in: seats (chips go back to the wallet;
-- a tournament seat counts as being knocked out) and Sit & Gos that have not started.
create or replace function private.remove_from_play(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  delete from public.table_seats where user_id = p_user;
  if to_regclass('public.tournament_entries') is not null then
    for t in select e.tournament_id, x.entry_fee
               from public.tournament_entries e join public.tournaments x on x.id = e.tournament_id
              where e.user_id = p_user and x.kind = 'sng' and x.status = 'registering' loop
      delete from public.tournament_entries where tournament_id = t.tournament_id and user_id = p_user;
      perform private.apply_chips(p_user, t.entry_fee, 'refund', 'sng_poker', t.tournament_id::text);
    end loop;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- For every player
-- -----------------------------------------------------------------------------
-- What the app needs to know about your own account. Works for banned players too
-- (it is how they find out), so it does not go through require_uid().
create or replace function public.my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  s public.player_sanctions;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- The app calls this when it opens and about once a minute: that is "last seen".
  insert into public.player_activity as a (user_id, last_seen_at) values (v_uid, now())
  on conflict (user_id) do update set last_seen_at = now() where a.last_seen_at < now() - interval '30 seconds';
  select * into s from public.player_sanctions where user_id = v_uid;
  return jsonb_build_object(
    'server_now', now(),
    'admin', private.is_admin(v_uid),
    'banned', s.banned_at is not null,
    'ban_reason', s.ban_reason,
    'timeout_until', case when s.timeout_until > now() then s.timeout_until end,
    'timeout_reason', case when s.timeout_until > now() then s.timeout_reason end,
    'must_rename', coalesce(s.must_rename, false),
    'blocked', (select coalesce(jsonb_agg(jsonb_build_object('user_id', b.blocked, 'username', p.username) order by b.created_at desc), '[]'::jsonb)
                  from public.player_blocks b join public.profiles p on p.id = b.blocked where b.blocker = v_uid),
    'notice', (select message from public.site_notice where id)
  );
end $$;

-- Asked by every browser before it shows anything, signed in or not.
create or replace function public.site_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('maintenance', s.maintenance, 'message', s.message, 'admin', coalesce(private.is_admin(auth.uid()), false))
    from public.site_status s where s.id
$$;

-- Change your own username. Only open to players who were told to (must_rename).
create or replace function public.change_username(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  s public.player_sanctions;
  v_check text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into s from public.player_sanctions where user_id = v_uid for update;
  if not found or not s.must_rename or s.banned_at is not null then
    raise exception 'action_not_allowed' using hint = 'Usernames can only be changed when a moderator asks for it.';
  end if;
  -- Not the name that was just taken away (in any mix of capitals).
  if lower(btrim(coalesce(p_username, ''))) = lower(s.removed_name) then
    raise exception 'action_not_allowed' using hint = 'That is the name a moderator removed. Choose a different one.';
  end if;
  v_check := public.check_username(p_username);
  if v_check <> 'ok' then
    raise exception 'action_not_allowed' using hint = case v_check
      when 'taken' then 'That username is taken.'
      when 'reserved' then 'That username is not available.'
      else 'Use 3 to 16 letters, numbers or underscores.' end;
  end if;
  update public.profiles set username = p_username where id = v_uid;
  update public.player_sanctions set must_rename = false, updated_at = now() where user_id = v_uid;
  return jsonb_build_object('username', p_username);
end $$;

create or replace function public.report_player(p_user uuid, p_reason text, p_note text default null, p_table uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  if p_user = v_uid or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'player_not_found';
  end if;
  if p_reason is null or p_reason not in ('name', 'cheating', 'harassment', 'other') then
    raise exception 'action_not_allowed' using hint = 'Pick a reason for the report.';
  end if;
  -- One open report per player about the same person, and at most ten a day in total.
  if exists (select 1 from public.player_reports where reporter = v_uid and reported = p_user and status = 'open') then
    raise exception 'action_not_allowed' using hint = 'You have already reported this player. A moderator will look at it.';
  end if;
  if (select count(*) from public.player_reports where reporter = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'slow_down' using hint = 'That is a lot of reports for one day. Try again tomorrow.';
  end if;
  insert into public.player_reports (reporter, reported, reason, note, context)
  values (v_uid, p_user, p_reason, nullif(left(btrim(coalesce(p_note, '')), 300), ''),
          jsonb_strip_nulls(jsonb_build_object('table_id', p_table, 'username', (select username from public.profiles where id = p_user))));
end $$;

-- Blocking ends a friendship and stops new requests either way.
create or replace function public.block_player(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  if p_user = v_uid or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'player_not_found';
  end if;
  if (select count(*) from public.player_blocks where blocker = v_uid) >= 200 then
    raise exception 'action_not_allowed' using hint = 'Your block list is full.';
  end if;
  insert into public.player_blocks (blocker, blocked) values (v_uid, p_user) on conflict do nothing;
  if to_regclass('public.friendships') is not null then
    delete from public.friendships
     where (requester = v_uid and addressee = p_user) or (requester = p_user and addressee = v_uid);
  end if;
end $$;

create or replace function public.unblock_player(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  delete from public.player_blocks where blocker = v_uid and blocked = p_user;
end $$;

-- No friend requests between two players when either has blocked the other.
create or replace function private.friendship_block_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.player_blocks b
              where (b.blocker = new.requester and b.blocked = new.addressee)
                 or (b.blocker = new.addressee and b.blocked = new.requester)) then
    raise exception 'action_not_allowed' using hint = 'You can''t add this player.';
  end if;
  return new;
end $$;

do $$
begin
  if to_regclass('public.friendships') is not null then
    drop trigger if exists friendships_block_check on public.friendships;
    create trigger friendships_block_check before insert on public.friendships
      for each row execute function private.friendship_block_check();
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Admin
-- -----------------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'players', (select count(*) from public.profiles),
    'new_today', (select count(*) from public.profiles where created_at > now() - interval '1 day'),
    'active_today', (select count(distinct user_id) from public.game_history where created_at > now() - interval '1 day'),
    'rounds_today', (select count(*) from public.game_history where created_at > now() - interval '1 day'),
    'seated_now', (select count(*) from public.table_seats),
    'chips_total', (select coalesce(sum(balance), 0) from public.wallets),
    'open_reports', (select count(*) from public.player_reports where status = 'open'),
    'banned', (select count(*) from public.player_sanctions where banned_at is not null),
    'timed_out', (select count(*) from public.player_sanctions where timeout_until > now()),
    'notice', (select message from public.site_notice where id),
    'maintenance', (select maintenance from public.site_status where id),
    'maintenance_message', (select message from public.site_status where id),
    'log', (select coalesce(jsonb_agg(x.j order by x.id desc), '[]'::jsonb)
              from (select l.id, jsonb_build_object('id', l.id, 'action', l.action, 'at', l.created_at, 'details', l.details,
                             'target', (select username from public.profiles where id = l.target)) as j
                      from public.admin_log l order by l.id desc limit 50) x)
  );
end $$;

create or replace function public.admin_reports(p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb)
            from (select r.created_at, jsonb_build_object(
                           'id', r.id, 'reason', r.reason, 'note', r.note, 'status', r.status, 'resolution', r.resolution,
                           'at', r.created_at, 'resolved_at', r.resolved_at,
                           'name_then', r.context ->> 'username',
                           -- A reported chat message (22_reputation_chat.sql) travels in the context.
                           'context', r.context,
                           'reported_id', r.reported, 'reported', (select username from public.profiles where id = r.reported),
                           'reporter_id', r.reporter, 'reporter', (select username from public.profiles where id = r.reporter),
                           'reports_against', (select count(*) from public.player_reports r2 where r2.reported = r.reported),
                           'reporters', (select count(distinct r2.reporter) from public.player_reports r2 where r2.reported = r.reported)) as j
                    from public.player_reports r
                   where p_status = 'all' or r.status = p_status
                   order by r.created_at desc limit 200) x);
end $$;

create or replace function public.admin_resolve_report(p_report bigint, p_status text, p_resolution text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.player_reports;
begin
  perform private.require_admin();
  if p_status not in ('open', 'actioned', 'dismissed') then
    raise exception 'action_not_allowed' using hint = 'Unknown status.';
  end if;
  update public.player_reports
     set status = p_status, resolution = nullif(left(btrim(coalesce(p_resolution, '')), 300), ''),
         resolved_at = case when p_status = 'open' then null else now() end
   where id = p_report returning * into r;
  if not found then
    raise exception 'action_not_allowed' using hint = 'That report no longer exists.';
  end if;
  perform private.admin_note('report_' || p_status, r.reported, jsonb_build_object('report', p_report));
end $$;

-- Search by username or email (empty = the newest accounts).
create or replace function public.admin_find_players(p_query text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(btrim(coalesce(p_query, '')));
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb)
            from (select p.created_at, jsonb_build_object(
                           'user_id', p.id, 'username', p.username, 'email', u.email, 'joined', p.created_at,
                           'last_seen', (select last_seen_at from public.player_activity a where a.user_id = p.id),
                           'balance', w.balance, 'level', coalesce(pp.level, 1),
                           'banned', s.banned_at is not null, 'timeout_until', case when s.timeout_until > now() then s.timeout_until end,
                           'must_rename', coalesce(s.must_rename, false), 'admin', private.is_admin(p.id),
                           'open_reports', (select count(*) from public.player_reports r where r.reported = p.id and r.status = 'open')) as j
                    from public.profiles p
                    join auth.users u on u.id = p.id
                    left join public.wallets w on w.user_id = p.id
                    left join public.player_progress pp on pp.user_id = p.id
                    left join public.player_sanctions s on s.user_id = p.id
                   where v_q = '' or lower(p.username) like '%' || replace(replace(v_q, '%', ''), '_', '\_') || '%'
                      or lower(u.email) like '%' || replace(v_q, '%', '') || '%'
                      or (v_q = 'banned' and s.banned_at is not null)
                   order by p.created_at desc limit 50) x);
end $$;

create or replace function public.admin_player(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  s public.player_sanctions;
begin
  perform private.require_admin();
  select * into p from public.profiles where id = p_user;
  if not found then
    raise exception 'player_not_found';
  end if;
  select * into s from public.player_sanctions where user_id = p_user;
  return jsonb_build_object(
    'user_id', p.id, 'username', p.username, 'joined', p.created_at, 'admin', private.is_admin(p.id),
    'email', (select email from auth.users where id = p.id),
    'last_sign_in', (select last_sign_in_at from auth.users where id = p.id),
    'last_seen', (select last_seen_at from public.player_activity where user_id = p.id),
    'reports_open', (select count(*) from public.player_reports r where r.reported = p.id and r.status = 'open'),
    'balance', (select balance from public.wallets where user_id = p.id),
    'peak_balance', (select peak_balance from public.wallets where user_id = p.id),
    'in_play', private.chips_in_play(p.id),
    'level', coalesce((select level from public.player_progress where user_id = p.id), 1),
    'xp', coalesce((select xp from public.player_progress where user_id = p.id), 0),
    'banned', s.banned_at is not null, 'banned_at', s.banned_at, 'ban_reason', s.ban_reason,
    'timeout_until', case when s.timeout_until > now() then s.timeout_until end, 'timeout_reason', s.timeout_reason,
    'must_rename', coalesce(s.must_rename, false),
    'seat', (select jsonb_build_object('table_id', t.id, 'name', t.name, 'game', t.game_key, 'stack', ts.stack)
               from public.table_seats ts join public.game_tables t on t.id = ts.table_id where ts.user_id = p.id limit 1),
    'totals', (select jsonb_build_object('rounds', coalesce(sum(rounds_played), 0), 'wagered', coalesce(sum(total_wagered), 0),
                                         'returned', coalesce(sum(total_returned), 0), 'biggest_win', coalesce(max(biggest_win), 0))
                 from public.player_game_stats where user_id = p.id),
    'games', (select coalesce(jsonb_agg(jsonb_build_object('game', g.game_key, 'rounds', g.rounds_played, 'net', g.total_returned - g.total_wagered)
                                        order by g.rounds_played desc), '[]'::jsonb)
                from public.player_game_stats g where g.user_id = p.id and g.rounds_played > 0),
    'ledger', (select coalesce(jsonb_agg(x.j order by x.id desc), '[]'::jsonb)
                 from (select l.id, jsonb_build_object('at', l.created_at, 'delta', l.delta, 'balance', l.balance_after, 'reason', l.reason, 'game', l.game) as j
                         from public.chip_ledger l where l.user_id = p.id order by l.id desc limit 40) x),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'note', r.note, 'status', r.status, 'at', r.created_at,
                                                             'reporter', (select username from public.profiles where id = r.reporter)) order by r.created_at desc), '[]'::jsonb)
                  from public.player_reports r where r.reported = p.id),
    'reports_made', (select count(*) from public.player_reports r where r.reporter = p.id),
    'log', (select coalesce(jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at, 'details', l.details) order by l.id desc), '[]'::jsonb)
              from public.admin_log l where l.target = p.id),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'note', n.note, 'at', n.created_at) order by n.id desc), '[]'::jsonb)
                from public.player_notes n where n.user_id = p.id)
  );
end $$;

-- The admin's notes on a player's file: add one, or delete one. Only the admin ever sees them.
create or replace function public.admin_file_note_add(p_user uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := left(btrim(coalesce(p_note, '')), 1000);
begin
  perform private.require_admin();
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'player_not_found';
  end if;
  if v_note = '' then
    raise exception 'action_not_allowed' using hint = 'Write the note first.';
  end if;
  insert into public.player_notes (user_id, admin_id, note) values (p_user, auth.uid(), v_note);
end $$;

create or replace function public.admin_file_note_delete(p_note bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  delete from public.player_notes where id = p_note;
end $$;

create or replace function public.admin_ban(p_user uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  perform private.admin_target(p_user);
  perform private.sanction_row(p_user);
  update public.player_sanctions
     set banned_at = now(), ban_reason = nullif(left(btrim(coalesce(p_reason, '')), 200), ''), updated_at = now()
   where user_id = p_user;
  perform private.remove_from_play(p_user);
  perform private.admin_note('ban', p_user, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.admin_unban(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.player_sanctions set banned_at = null, ban_reason = null, updated_at = now() where user_id = p_user;
  perform private.admin_note('unban', p_user);
end $$;

-- p_minutes = 0 ends a timeout early.
create or replace function public.admin_timeout(p_user uuid, p_minutes integer, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  perform private.admin_target(p_user);
  if p_minutes is null or p_minutes < 0 or p_minutes > 60 * 24 * 365 then
    raise exception 'action_not_allowed' using hint = 'A timeout lasts between a minute and a year.';
  end if;
  perform private.sanction_row(p_user);
  update public.player_sanctions
     set timeout_until = case when p_minutes = 0 then null else now() + make_interval(mins => p_minutes) end,
         timeout_reason = case when p_minutes = 0 then null else nullif(left(btrim(coalesce(p_reason, '')), 200), '') end,
         updated_at = now()
   where user_id = p_user;
  if p_minutes > 0 then
    perform private.remove_from_play(p_user);
  end if;
  perform private.admin_note(case when p_minutes = 0 then 'timeout_end' else 'timeout' end, p_user,
                             jsonb_build_object('minutes', p_minutes, 'reason', p_reason));
end $$;

-- Takes the name away at once (it becomes Player_ plus six characters) and makes the
-- player choose a new one before they can play again. p_username sets a name directly instead.
create or replace function public.admin_rename(p_user uuid, p_username text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_new text := nullif(btrim(coalesce(p_username, '')), '');
  v_check text;
begin
  perform private.require_admin();
  perform private.admin_target(p_user);
  select username into v_old from public.profiles where id = p_user;
  if v_new is null then
    loop
      v_new := 'Player_' || private.random_code(6);
      exit when not exists (select 1 from public.profiles where lower(username) = lower(v_new));
    end loop;
    perform private.sanction_row(p_user);
    update public.player_sanctions set must_rename = true, removed_name = v_old, updated_at = now() where user_id = p_user;
  else
    v_check := public.check_username(v_new);
    if v_check <> 'ok' then
      raise exception 'action_not_allowed' using hint = 'That username is ' || v_check || '.';
    end if;
  end if;
  update public.profiles set username = v_new where id = p_user;
  perform private.admin_note('rename', p_user, jsonb_build_object('from', v_old, 'to', v_new, 'forced', p_username is null));
  return jsonb_build_object('username', v_new);
end $$;

-- p_mode 'add': change the balance by p_amount (may be negative). 'set': make it exactly p_amount.
-- Goes through apply_chips like every other chip change, so it is in the player's ledger.
create or replace function public.admin_chips(p_user uuid, p_mode text, p_amount bigint, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_delta bigint;
begin
  perform private.require_admin();
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'player_not_found';
  end if;
  select balance into v_balance from public.wallets where user_id = p_user for update;
  if p_mode = 'set' then
    v_delta := p_amount - v_balance;
  elsif p_mode = 'add' then
    v_delta := p_amount;
  else
    raise exception 'action_not_allowed' using hint = 'Unknown mode.';
  end if;
  if p_amount is null or v_balance + v_delta < 0 or v_balance + v_delta > 1000000000000 then
    raise exception 'action_not_allowed' using hint = 'The balance must stay between 0 and 1,000,000,000,000.';
  end if;
  if v_delta <> 0 then
    v_balance := private.apply_chips(p_user, v_delta, 'admin_adjust', null, null,
                                     jsonb_strip_nulls(jsonb_build_object('note', nullif(left(btrim(coalesce(p_note, '')), 200), ''))));
  end if;
  if v_delta <> 0 and to_regprocedure('private.notify(uuid,text,jsonb)') is not null then
    execute 'select private.notify($1, $2, $3)' using p_user, 'chips_adjusted', jsonb_build_object('delta', v_delta);
  end if;
  perform private.admin_note('chips', p_user, jsonb_build_object('mode', p_mode, 'amount', p_amount, 'delta', v_delta, 'note', p_note));
  return jsonb_build_object('balance', v_balance, 'delta', v_delta);
end $$;

-- Takes a player off their table (their chips there go back to their wallet).
create or replace function public.admin_kick(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  perform private.remove_from_play(p_user);
  perform private.admin_note('kick', p_user);
end $$;

-- Closes the site to everyone but the admin, or opens it again. Players at tables keep their
-- seats and chips; their browsers show the maintenance page within moments.
create or replace function public.admin_set_maintenance(p_on boolean, p_message text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.site_status
     set maintenance = coalesce(p_on, false), message = nullif(left(btrim(coalesce(p_message, '')), 300), ''), updated_at = now()
   where id;
  perform private.admin_note(case when p_on then 'maintenance_on' else 'maintenance_off' end, null, jsonb_build_object('message', p_message));
end $$;

-- The announcement strip everyone sees (null or empty takes it down).
create or replace function public.admin_set_notice(p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.site_notice set message = nullif(left(btrim(coalesce(p_message, '')), 200), ''), updated_at = now() where id;
  perform private.admin_note('notice', null, jsonb_build_object('message', p_message));
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.my_account()', 'public.change_username(text)', 'public.report_player(uuid, text, text, uuid)',
    'public.block_player(uuid)', 'public.unblock_player(uuid)',
    'public.admin_overview()', 'public.admin_reports(text)', 'public.admin_resolve_report(bigint, text, text)',
    'public.admin_find_players(text)', 'public.admin_player(uuid)', 'public.admin_ban(uuid, text)', 'public.admin_unban(uuid)',
    'public.admin_timeout(uuid, integer, text)', 'public.admin_rename(uuid, text)', 'public.admin_chips(uuid, text, bigint, text)',
    'public.admin_kick(uuid)', 'public.admin_set_notice(text)', 'public.admin_file_note_add(uuid, text)', 'public.admin_file_note_delete(bigint)', 'public.admin_set_maintenance(boolean, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security. Nothing here is written by clients; reports, the admin list
-- and the log are not readable by clients at all.
-- -----------------------------------------------------------------------------
alter table public.admins            enable row level security;
alter table public.site_status       enable row level security;
alter table public.player_activity   enable row level security;
alter table public.player_sanctions  enable row level security;
alter table public.player_blocks     enable row level security;
alter table public.player_reports    enable row level security;
alter table public.admin_log         enable row level security;
alter table public.player_notes      enable row level security;
alter table public.site_notice       enable row level security;

drop policy if exists "player_sanctions: own row" on public.player_sanctions;
create policy "player_sanctions: own row" on public.player_sanctions for select to authenticated using (user_id = auth.uid());
drop policy if exists "player_blocks: own rows" on public.player_blocks;
create policy "player_blocks: own rows" on public.player_blocks for select to authenticated using (blocker = auth.uid());
drop policy if exists "site_notice: signed-in players can read" on public.site_notice;
create policy "site_notice: signed-in players can read" on public.site_notice for select to authenticated using (true);

revoke all on public.admins, public.player_reports, public.admin_log, public.player_activity, public.player_notes from anon, authenticated;

-- Players asked to rename before the removed name was remembered: take it from the admin log.
update public.player_sanctions s
   set removed_name = (select l.details ->> 'from' from public.admin_log l
                        where l.target = s.user_id and l.action = 'rename' and (l.details ->> 'forced')::boolean
                        order by l.id desc limit 1)
 where s.must_rename and s.removed_name is null;
revoke all on public.player_sanctions, public.player_blocks, public.site_notice from anon;
revoke insert, update, delete, truncate on public.player_sanctions, public.player_blocks, public.site_notice from authenticated;
grant select on public.player_sanctions, public.player_blocks, public.site_notice to authenticated;

-- Everyone, signed in or not, may know whether the site is open: it is the first thing a browser asks.
drop policy if exists "site_status: anyone can read" on public.site_status;
create policy "site_status: anyone can read" on public.site_status for select to anon, authenticated using (true);
revoke all on public.site_status from anon, authenticated;
grant select on public.site_status to anon, authenticated;
revoke all on function public.site_status() from public;
grant execute on function public.site_status() to anon, authenticated;
select private.add_to_realtime('site_status');

-- A sanction reaches the player's browser at once.
select private.add_to_realtime('player_sanctions');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

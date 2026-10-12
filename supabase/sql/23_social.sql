-- =============================================================================
-- All In · 23_social.sql
-- Stage 12, part 2: what your friends are playing, and watching them play.
-- Run AFTER 01-22. Safe to re-run.
--
-- (The other two halves of part 2 live where their tables are: waiting rooms
--  for private tables in 05_tables.sql, direct messages in 22_reputation_chat.sql.)
--
-- A browser tells the server which game it has open (set_activity). Friends can
-- then see "playing Lucky Sevens" and open a small live view of that friend's
-- recent rounds there (friend_watch). Tables need none of this: a seat is
-- already known, and anyone who can see a table can watch it.
--
-- Each player can switch this off (set_watchable): friends then see nothing
-- about games played alone. Only friends ever see it.
--
-- All In is a free game. No real money is ever used.
-- =============================================================================

do $$
begin
  if to_regclass('public.player_activity') is null then
    raise exception 'Run 15_moderation.sql first: it has the activity table this file adds to.';
  end if;
end $$;

-- player_activity is hidden from clients (15). These columns say what a player has open right now.
alter table public.player_activity add column if not exists game_key text references public.games (key) on delete set null;
alter table public.player_activity add column if not exists game_at timestamptz;
alter table public.player_activity add column if not exists watchable boolean not null default true;

-- How long after the last report a game still counts as "playing now".
create or replace function private.activity_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '100 seconds'
$$;

create or replace function private.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.friendships f
                  where f.status = 'accepted' and p_a in (f.requester, f.addressee) and p_b in (f.requester, f.addressee) and p_a <> p_b)
$$;

-- The game this browser has open (a game played away from the tables), or null when it is closed.
-- Called when the game opens, about once a minute while it stays open, and when it closes.
create or replace function public.set_activity(p_game text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_game is not null and not exists (select 1 from public.games where key = p_game and released) then
    p_game := null;
  end if;
  insert into public.player_activity as a (user_id, last_seen_at, game_key, game_at)
  values (v_uid, now(), p_game, case when p_game is not null then now() end)
  on conflict (user_id) do update set game_key = excluded.game_key, game_at = excluded.game_at;
end $$;

-- Let friends see what you are playing and watch it, or not.
create or replace function public.set_watchable(p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  insert into public.player_activity as a (user_id, watchable) values (v_uid, coalesce(p_on, true))
  on conflict (user_id) do update set watchable = excluded.watchable;
  return coalesce(p_on, true);
end $$;

-- What each of your friends has open right now (games away from the tables only: friends_list has the tables),
-- and your own setting.
create or replace function public.friends_activity()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'watchable', coalesce((select watchable from public.player_activity where user_id = v_uid), true),
    'playing', (select coalesce(jsonb_object_agg(a.user_id::text, jsonb_build_object('game_key', g.key, 'game', g.name)), '{}'::jsonb)
                  from public.player_activity a join public.games g on g.key = a.game_key
                 where a.watchable and a.game_at > now() - private.activity_window()
                   and private.are_friends(v_uid, a.user_id)
                   and not private.is_banned(a.user_id)));
end $$;

-- Watching one friend: where they are, and how their last rounds there went.
-- At a public table the browser is simply sent to the table. Away from the tables it shows this feed.
create or replace function public.friend_watch(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  a public.player_activity;
  v_game text;
begin
  if not private.are_friends(v_uid, p_user) then
    raise exception 'action_not_allowed' using hint = 'You can only watch your friends.';
  end if;
  select * into a from public.player_activity where user_id = p_user;
  if found and not a.watchable then
    raise exception 'action_not_allowed' using hint = 'This friend has switched off watching.';
  end if;
  v_game := case when a.game_at > now() - private.activity_window() then a.game_key end;
  return jsonb_build_object(
    'user_id', p_user,
    'username', (select username from public.profiles where id = p_user),
    'game_key', v_game,
    'game', (select name from public.games where key = v_game),
    'balance', (select balance from public.wallets where user_id = p_user),
    -- A public table they are seated at (a private one is never given away).
    'table', (select jsonb_build_object('id', t.id, 'name', t.name, 'game_key', t.game_key, 'game', g.name,
                                        'full', (select count(*) from public.table_seats s2 where s2.table_id = t.id) >= t.max_seats)
                from public.table_seats s join public.game_tables t on t.id = s.table_id join public.games g on g.key = t.game_key
               where s.user_id = p_user and not t.is_private and not t.play_money limit 1),
    -- Their rounds at the game they have open, from the last quarter of an hour.
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', h.id, 'wagered', h.wagered, 'returned', h.returned, 'outcome', h.outcome, 'summary', h.summary, 'at', h.created_at)
                 order by h.created_at desc), '[]'::jsonb)
                 from (select * from public.game_history
                        where user_id = p_user and game_key = v_game and created_at > now() - interval '15 minutes'
                        order by created_at desc limit 15) h));
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.set_activity(text)', 'public.set_watchable(boolean)', 'public.friends_activity()', 'public.friend_watch(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

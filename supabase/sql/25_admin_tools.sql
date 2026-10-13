-- =============================================================================
-- All In · 25_admin_tools.sql
-- Stage 12, part 4: the moderator's tools, and appeals.
-- Run AFTER 01-24. Safe to re-run.
--
--   * admin_stats()        the numbers behind the site: players, play, chips, games
--   * admin_chat_search()  search the chat that is still kept (3 days), for moderation
--   * appeals              a player who is suspended, in a timeout or barred from chat
--                          can write to the moderator once, and is told the answer
--
-- (The fourth piece, scheduled notices and maintenance, is in 15_moderation.sql,
--  next to the switches it sets.)
--
-- Every admin_* function here starts with private.require_admin(), like all the
-- others: anyone else is answered "not_admin".
--
-- All In is a free game. No real money is ever used.
-- =============================================================================

do $$
begin
  if to_regprocedure('private.site_now()') is null then
    raise exception 'Run 15_moderation.sql again first: this file needs its latest version.';
  end if;
  if to_regclass('public.chat_messages') is null then
    raise exception 'Run 22_reputation_chat.sql first: the chat search reads its messages.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Site statistics
-- -----------------------------------------------------------------------------
create or replace function public.admin_stats(p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 60);
  v_today date := (now() at time zone 'utc')::date;
begin
  perform private.require_admin();
  return jsonb_build_object(
    'server_now', now(),
    'totals', jsonb_build_object(
      'players', (select count(*) from public.profiles),
      'online_now', (select count(*) from public.player_activity where last_seen_at > now() - interval '2 minutes'),
      'seated_now', (select count(*) from public.table_seats),
      'active_1d', (select count(distinct user_id) from public.game_history where created_at > now() - interval '1 day'),
      'active_7d', (select count(distinct user_id) from public.game_history where created_at > now() - interval '7 days'),
      'active_30d', (select count(distinct user_id) from public.game_history where created_at > now() - interval '30 days'),
      'chips_total', (select coalesce(sum(balance), 0) from public.wallets),
      'chips_median', (select coalesce(percentile_cont(0.5) within group (order by balance), 0)::bigint from public.wallets),
      'average_level', (select coalesce(round(avg(level), 1), 1) from public.player_progress),
      'average_reputation', (select coalesce(round(avg(score), 1), 50) from public.player_reputation),
      'chat_limited', (select count(*) from public.player_reputation
                        where score <= 30 or chat_banned_until > now() or quick_banned_until > now()),
      'clubs', (select count(*) from public.clubs),
      'club_members', (select count(*) from public.club_members),
      'friendships', (select count(*) from public.friendships where status = 'accepted'),
      'tournaments_7d', (select count(*) from public.tournaments where status = 'finished' and finished_at > now() - interval '7 days'),
      'messages_kept', (select count(*) from public.chat_messages),
      'messages_caught', (select count(*) from public.chat_messages where flagged is not null),
      'open_reports', (select count(*) from public.player_reports where status = 'open'),
      'open_appeals', (select count(*) from public.player_appeals where status = 'open'),
      'banned', (select count(*) from public.player_sanctions where banned_at is not null)),
    -- One row per UTC day, oldest first.
    'days', (select jsonb_agg(jsonb_build_object(
               'day', d.day, 'new_players', coalesce(n.n, 0), 'active', coalesce(h.active, 0), 'rounds', coalesce(h.rounds, 0),
               'wagered', coalesce(h.wagered, 0), 'returned', coalesce(h.returned, 0)) order by d.day)
               from (select generate_series(v_today - (v_days - 1), v_today, interval '1 day')::date as day) d
               left join (select (created_at at time zone 'utc')::date as day, count(distinct user_id) as active, count(*) as rounds,
                                 sum(wagered) as wagered, sum(returned) as returned
                            from public.game_history where created_at >= (v_today - (v_days - 1))::timestamp at time zone 'utc'
                           group by 1) h on h.day = d.day
               left join (select (created_at at time zone 'utc')::date as day, count(*) as n
                            from public.profiles where created_at >= (v_today - (v_days - 1))::timestamp at time zone 'utc'
                           group by 1) n on n.day = d.day),
    -- Every game played in the last 7 days, busiest first, with what it actually paid back.
    'games', (select coalesce(jsonb_agg(jsonb_build_object(
                'game', x.game_key, 'name', x.name, 'rounds', x.rounds, 'players', x.players, 'wagered', x.wagered, 'returned', x.returned)
                order by x.rounds desc), '[]'::jsonb)
                from (select h.game_key, g.name, count(*) as rounds, count(distinct h.user_id) as players,
                             sum(h.wagered) as wagered, sum(h.returned) as returned
                        from public.game_history h join public.games g on g.key = h.game_key
                       where h.created_at > now() - interval '7 days'
                       group by h.game_key, g.name) x),
    -- Where chips came from and went in the last 7 days, by the ledger's reason.
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('reason', x.reason, 'entries', x.n, 'chips', x.chips) order by x.chips desc), '[]'::jsonb)
                 from (select reason, count(*) as n, sum(delta) as chips from public.chip_ledger
                        where created_at > now() - interval '7 days' group by reason) x),
    'richest', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'username', x.username, 'balance', x.balance) order by x.balance desc), '[]'::jsonb)
                  from (select w.user_id, p.username, w.balance from public.wallets w join public.profiles p on p.id = w.user_id
                         order by w.balance desc limit 10) x));
end $$;

-- -----------------------------------------------------------------------------
-- Chat log search
-- -----------------------------------------------------------------------------
-- p_kind: all | table | club | room | dm | caught (anything the filter flagged) | hidden (not delivered).
-- p_query matches the words as delivered or as typed; p_player a username (then or now). Newest first,
-- 100 at a time; p_before pages back. Only what is still kept can be found (3 days: see 22).
-- Each search is written to the admin log.
create or replace function public.admin_chat_search(p_query text default '', p_player text default '', p_kind text default 'all', p_before bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_p text := btrim(coalesce(p_player, ''));
  -- so that % and _ typed into the box are just characters
  v_like text := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_plike text := '%' || replace(replace(replace(v_p, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  r jsonb;
begin
  perform private.require_admin();
  if coalesce(p_kind, '') not in ('all', 'table', 'club', 'room', 'dm', 'caught', 'hidden') then
    raise exception 'action_not_allowed' using hint = 'Unknown kind of chat.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'channel', m.channel, 'kind', split_part(m.channel, ':', 1),
           'place', case split_part(m.channel, ':', 1)
                      when 'table' then coalesce((select t.name from public.game_tables t where t.id::text = split_part(m.channel, ':', 2)), 'A closed table')
                      when 'club' then coalesce((select c.name from public.clubs c where c.id::text = split_part(m.channel, ':', 2)), 'A deleted club')
                      when 'room' then initcap(replace(split_part(m.channel, ':', 2), '_', ' '))
                      else (select 'Direct: ' || string_agg(distinct m2.username, ' and ') from public.chat_messages m2 where m2.channel = m.channel) end,
           'user_id', m.user_id, 'username', coalesce(p.username, m.username),
           'body', m.body, 'raw', m.raw, 'flagged', m.flagged, 'hidden', m.hidden, 'at', m.created_at) order by m.id desc), '[]'::jsonb)
    into r
    from (select m0.* from public.chat_messages m0 left join public.profiles p0 on p0.id = m0.user_id
           where (p_before is null or m0.id < p_before)
             and (v_q = '' or m0.body ilike v_like or m0.raw ilike v_like)
             and (v_p = '' or m0.username ilike v_plike or p0.username ilike v_plike)
             and case p_kind when 'all' then true when 'caught' then m0.flagged is not null when 'hidden' then m0.hidden
                             else m0.channel like p_kind || ':%' end
           order by m0.id desc limit 100) m
    left join public.profiles p on p.id = m.user_id;
  perform private.admin_note('chat_search', null, jsonb_strip_nulls(jsonb_build_object(
            'query', nullif(v_q, ''), 'player', nullif(v_p, ''), 'kind', p_kind, 'found', jsonb_array_length(r))));
  return jsonb_build_object('messages', r, 'kept_days', (private.rep_cfg() ->> 'keep_days')::integer);
end $$;

-- -----------------------------------------------------------------------------
-- Appeals
-- -----------------------------------------------------------------------------
create table if not exists public.player_appeals (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- What was appealed, as it stood when the appeal was written.
  kind         text not null check (kind in ('ban', 'timeout', 'chat')),
  message      text not null check (char_length(message) between 20 and 1000),
  context      jsonb not null default '{}'::jsonb,
  status       text not null default 'open' check (status in ('open', 'accepted', 'denied')),
  reply        text check (char_length(reply) <= 500),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists player_appeals_user_idx on public.player_appeals (user_id, id desc);
create unique index if not exists player_appeals_open_idx on public.player_appeals (user_id) where status = 'open';

-- How long after an answer before the same player may appeal again.
create or replace function private.appeal_wait()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '3 days'
$$;

-- What this player could appeal right now: 'ban', 'timeout', 'chat', or null when in good standing.
create or replace function private.appeal_kind(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.player_sanctions s where s.user_id = p_user and s.banned_at is not null) then 'ban'
    when exists (select 1 from public.player_sanctions s where s.user_id = p_user and s.timeout_until > now()) then 'timeout'
    when not private.rep_can(p_user, 'chat') or not private.rep_can(p_user, 'quick') then 'chat'
  end
$$;

-- The player's side: their latest appeal, and whether they may write one now.
-- (No sanction check here or in appeal_submit: these are for players who are locked out.)
create or replace function public.my_appeal()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a public.player_appeals;
  v_kind text;
  v_wait timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into a from public.player_appeals where user_id = v_uid order by id desc limit 1;
  v_kind := private.appeal_kind(v_uid);
  v_wait := case when a.status = 'denied' and a.resolved_at + private.appeal_wait() > now() then a.resolved_at + private.appeal_wait() end;
  return jsonb_build_object(
    'kind', v_kind,
    'can_appeal', v_kind is not null and coalesce(a.status, '') <> 'open' and v_wait is null,
    'wait_until', v_wait,
    'latest', case when a.id is not null then jsonb_build_object(
                'id', a.id, 'kind', a.kind, 'status', a.status, 'message', a.message, 'reply', a.reply,
                'at', a.created_at, 'resolved_at', a.resolved_at) end);
end $$;

create or replace function public.appeal_submit(p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_text text := btrim(coalesce(p_message, ''));
  v_kind text;
  a public.player_appeals;
  s public.player_sanctions;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  v_kind := private.appeal_kind(v_uid);
  if v_kind is null then
    raise exception 'action_not_allowed' using hint = 'There is nothing to appeal: your account is in good standing.';
  end if;
  if char_length(v_text) < 20 or char_length(v_text) > 1000 then
    raise exception 'action_not_allowed' using hint = 'Write between 20 and 1,000 characters.';
  end if;
  select * into a from public.player_appeals where user_id = v_uid order by id desc limit 1;
  if a.status = 'open' then
    raise exception 'action_not_allowed' using hint = 'Your appeal is waiting for an answer.';
  end if;
  if a.status = 'denied' and a.resolved_at + private.appeal_wait() > now() then
    raise exception 'action_not_allowed' using hint = 'Your last appeal was answered a short while ago. You can write again in a few days.';
  end if;
  select * into s from public.player_sanctions where user_id = v_uid;
  insert into public.player_appeals (user_id, kind, message, context)
  values (v_uid, v_kind, v_text, jsonb_strip_nulls(jsonb_build_object(
            'ban_reason', case when v_kind = 'ban' then s.ban_reason end,
            'timeout_until', case when v_kind = 'timeout' then s.timeout_until end,
            'timeout_reason', case when v_kind = 'timeout' then s.timeout_reason end,
            'reputation', private.reputation_of(v_uid))));
  return public.my_appeal();
end $$;

create or replace function public.admin_appeals(p_status text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', x.id, 'user_id', x.user_id, 'username', x.username, 'kind', x.kind, 'message', x.message, 'context', x.context,
                   'status', x.status, 'reply', x.reply, 'at', x.created_at, 'resolved_at', x.resolved_at,
                   -- how things stand today, which may no longer be what was appealed
                   'now', private.appeal_kind(x.user_id), 'reputation', private.reputation_of(x.user_id),
                   'earlier', (select count(*) from public.player_appeals e where e.user_id = x.user_id and e.id < x.id))
                   order by case when p_status = 'open' then x.id end, x.id desc), '[]'::jsonb)
            from (select a.*, p.username from public.player_appeals a join public.profiles p on p.id = a.user_id
                   where case when p_status = 'open' then a.status = 'open' else a.status <> 'open' end
                   order by a.id desc limit 100) x);
end $$;

-- Answers an appeal. Accepting with p_lift undoes what was appealed (the ban, the timeout, or both chat
-- bans); p_reputation, if given, also sets the player's reputation (a ban or long timeout took it to 0,
-- and at 30 or less they still could not chat). The player is told, with the reply.
create or replace function public.admin_appeal_resolve(p_appeal bigint, p_accept boolean, p_reply text default null,
                                                       p_lift boolean default true, p_reputation integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.player_appeals;
  v_reply text := nullif(left(btrim(coalesce(p_reply, '')), 500), '');
begin
  perform private.require_admin();
  select * into a from public.player_appeals where id = p_appeal for update;
  if not found or a.status <> 'open' then
    raise exception 'action_not_allowed' using hint = 'That appeal has already been answered.';
  end if;
  if p_reputation is not null and p_reputation not between 0 and 100 then
    raise exception 'action_not_allowed' using hint = 'Reputation is between 0 and 100.';
  end if;
  if coalesce(p_accept, false) then
    if coalesce(p_lift, true) then
      if a.kind = 'ban' then
        perform public.admin_unban(a.user_id);
      elsif a.kind = 'timeout' then
        perform public.admin_timeout(a.user_id, 0);
      else
        perform public.admin_chat_ban(a.user_id, 'chat', 0);
        perform public.admin_chat_ban(a.user_id, 'quick', 0);
      end if;
    end if;
    if p_reputation is not null then
      perform public.admin_reputation(a.user_id, 'set', p_reputation, 'Appeal accepted');
    end if;
  end if;
  update public.player_appeals
     set status = case when coalesce(p_accept, false) then 'accepted' else 'denied' end, reply = v_reply, resolved_at = now()
   where id = a.id;
  perform private.notify(a.user_id, 'appeal_answer', jsonb_strip_nulls(jsonb_build_object(
            'accepted', coalesce(p_accept, false), 'kind', a.kind, 'reply', v_reply)));
  perform private.admin_note('appeal', a.user_id, jsonb_strip_nulls(jsonb_build_object(
            'accepted', coalesce(p_accept, false), 'kind', a.kind, 'lifted', coalesce(p_accept, false) and coalesce(p_lift, true),
            'reputation', p_reputation, 'reply', v_reply)));
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_stats(integer)', 'public.admin_chat_search(text, text, text, bigint)',
    'public.my_appeal()', 'public.appeal_submit(text)', 'public.admin_appeals(text)',
    'public.admin_appeal_resolve(bigint, boolean, text, boolean, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Appeals are read and written only through the functions above.
alter table public.player_appeals enable row level security;
revoke all on public.player_appeals from anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

-- =============================================================================
-- All In · 22_reputation_chat.sql
-- Phase 11: reputation, and typed chat at tables, in live rooms and in clubs.
-- Run AFTER 01-21 (re-run 13_progression.sql first: it has the reputation
-- cosmetics, the two achievements and the hooks this file fills in).
-- Safe to re-run.
--
-- REPUTATION is a number from 0 to 100. Everyone starts at 50.
--   up     +1 for every 25 clean typed messages, at most 3 a day.
--          Below 50 only: +2 for each day you play a round, back up to 50.
--   down   The chat filter (swear words, spam, advertising): the first hit of a
--          day is a warning, every later hit that day costs 25.
--          A moderator's warning 25 · a forced change of name 50 ·
--          a timeout under a day 50 · under a week 75 · a week or more, or a
--          ban: everything · a report judged false: 10 from the reporter.
--   30 or less   no typed chat (quick chat still works)
--   20 or less   no quick chat either
--   75 and 100   cosmetics that are owned only WHILE the reputation is that
--                high: dropping below takes them off the player at once.
-- Only the player and the admin can see the number.
--
-- CHAT goes through chat_send / chat_fetch. Clients have no access to the
-- chat_messages table at all: what a player may read is decided per channel
-- ("table:<id>", "club:<id>", "room:crash|bingo|horse_racing") inside
-- chat_fetch, and players they blocked are left out. Messages are kept 3 days.
-- Realtime only carries a content-free "something new" ping between browsers.
--
-- All In is a free game. No real money is ever used.
-- =============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'cosmetics' and column_name = 'min_reputation') then
    raise exception 'Run 13_progression.sql again first: it adds what this file needs.';
  end if;
  if to_regclass('public.player_reports') is null or to_regclass('public.notifications') is null or to_regclass('public.club_members') is null then
    raise exception 'Run files 15, 16 and 17 first.';
  end if;
end $$;

create or replace function private.rep_cfg()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"start": 50, "chat_off": 30, "quick_off": 20,
           "gain_every": 25, "gain_cap": 3, "recover": 2, "recover_to": 50,
           "filter_penalty": 25, "warning": 25, "rename": 50, "timeout_short": 50, "timeout_day": 75, "false_report": 10,
           "gap_seconds": 3, "max_length": 200, "keep_days": 3, "tiers": [75, 100]}'::jsonb
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.player_reputation (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  score               integer not null default 50 check (score between 0 and 100),
  best                integer not null default 50,
  -- Clean messages since the last point earned.
  clean_count         integer not null default 0,
  gain_day            date,
  gain_today          integer not null default 0,
  -- The day the filter last let this player off with a warning.
  warned_day          date,
  recover_day         date,
  -- Set by a moderator. 'infinity' = until lifted.
  chat_banned_until   timestamptz,
  quick_banned_until  timestamptz,
  last_message_at     timestamptz,
  updated_at          timestamptz not null default now()
);
-- Why a moderator switched chat off (the player is shown this).
alter table public.player_reputation add column if not exists chat_ban_reason text;
alter table public.player_reputation add column if not exists quick_ban_reason text;

-- What changed a player's reputation (their own rows are readable).
create table if not exists public.reputation_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  delta       integer not null,
  score       integer not null,
  reason      text not null check (reason ~ '^[a-z][a-z0-9_]{1,40}$'),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists reputation_log_user_idx on public.reputation_log (user_id, id desc);

-- HIDDEN from clients: every typed message. `body` is what others are shown (swear
-- words starred out); `raw` is what was typed, kept for the moderator when it differs.
-- `hidden` messages were stopped by the filter and are shown to nobody but the moderator.
create table if not exists public.chat_messages (
  id          bigint generated always as identity primary key,
  channel     text not null check (channel ~ '^(table|club|room):[a-z0-9_-]{1,40}$'),
  user_id     uuid not null references auth.users (id) on delete cascade,
  username    text not null,
  body        text not null,
  raw         text,
  flagged     text,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists chat_messages_channel_idx on public.chat_messages (channel, id desc);
create index if not exists chat_messages_user_idx on public.chat_messages (user_id, id desc);
create index if not exists chat_messages_age_idx on public.chat_messages (created_at);

-- -----------------------------------------------------------------------------
-- Reputation
-- -----------------------------------------------------------------------------
create or replace function private.rep_row(p_user uuid)
returns public.player_reputation
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.player_reputation;
begin
  insert into public.player_reputation (user_id) values (p_user) on conflict do nothing;
  select * into r from public.player_reputation where user_id = p_user for update;
  return r;
end $$;

-- Replaces the placeholders in 13: a player's reputation, and whether quick chat is off for them.
create or replace function private.reputation_of(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select score from public.player_reputation where user_id = p_user), (private.rep_cfg() ->> 'start')::integer)
$$;

-- kind: 'chat' (typed) or 'quick' (preset phrases and emotes).
create or replace function private.rep_can(p_user uuid, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_kind
    when 'chat' then coalesce(r.score, 50) > (private.rep_cfg() ->> 'chat_off')::integer
                     and (r.chat_banned_until is null or r.chat_banned_until <= now())
    else coalesce(r.score, 50) > (private.rep_cfg() ->> 'quick_off')::integer
         and (r.quick_banned_until is null or r.quick_banned_until <= now()) end
    from (select p_user as id) u left join public.player_reputation r on r.user_id = u.id
$$;

create or replace function private.quick_muted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.rep_can(p_user, 'quick')
$$;

-- Takes off anything a player is wearing that their reputation no longer earns.
-- (A cosmetic granted by hand in player_cosmetics stays whatever the reputation.)
create or replace function private.rep_strip(p_user uuid, p_score integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.player_loadouts;
  lost text[];
begin
  select * into l from public.player_loadouts where user_id = p_user;
  if not found then
    return;
  end if;
  select array_agg(c.key) into lost
    from public.cosmetics c
   where c.min_reputation > p_score
     and c.key in (l.avatar, l.frame, l.title, l.card_back, l.felt)
     and not exists (select 1 from public.player_cosmetics pc where pc.user_id = p_user and pc.cosmetic_key = c.key);
  if lost is null then
    return;
  end if;
  update public.player_loadouts
     set avatar    = case when avatar = any (lost) then 'avatar_initial' else avatar end,
         frame     = case when frame = any (lost) then 'frame_none' else frame end,
         title     = case when title = any (lost) then 'title_newcomer' else title end,
         card_back = case when card_back = any (lost) then 'back_ruby' else card_back end,
         felt      = case when felt = any (lost) then 'felt_classic' else felt end,
         updated_at = now()
   where user_id = p_user;
end $$;

-- The one way reputation changes. p_set (0 to 100) sets it outright instead of adding p_delta.
-- Logs the change, takes off cosmetics that are no longer earned, counts the best score
-- towards the achievements, and tells the player about anything but the small daily gains.
create or replace function private.rep_change(p_user uuid, p_delta integer, p_reason text, p_note text default null, p_set integer default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.player_reputation := private.rep_row(p_user);
  v_new integer := least(100, greatest(0, coalesce(p_set, r.score + coalesce(p_delta, 0))));
begin
  if v_new = r.score and p_reason <> 'chat_warning' then
    return v_new;
  end if;
  update public.player_reputation
     set score = v_new, best = greatest(best, v_new), updated_at = now(),
         clean_count = case when v_new < r.score then 0 else clean_count end
   where user_id = p_user;
  insert into public.reputation_log (user_id, delta, score, reason, note)
  values (p_user, v_new - r.score, v_new, p_reason, nullif(left(btrim(coalesce(p_note, '')), 200), ''));
  delete from public.reputation_log l
   where l.user_id = p_user
     and l.id < (select min(x.id) from (select id from public.reputation_log where user_id = p_user order by id desc limit 50) x);

  if v_new < r.score then
    perform private.rep_strip(p_user, v_new);
  elsif v_new > r.best then
    insert into public.player_progress (user_id) values (p_user) on conflict do nothing;
    update public.player_progress
       set counters = counters || jsonb_build_object('reputation_best', greatest(coalesce((counters ->> 'reputation_best')::integer, 0), v_new))
     where user_id = p_user;
    perform private.check_achievements(p_user);
  end if;
  if p_reason not in ('chat_clean', 'recovery') then
    -- (A moderator's note is passed on only for a warning: it is the reason the player should read.)
    perform private.notify(p_user, 'reputation', jsonb_strip_nulls(jsonb_build_object(
      'delta', v_new - r.score, 'score', v_new, 'reason', p_reason,
      'note', case when p_reason = 'warning' then nullif(left(btrim(coalesce(p_note, '')), 200), '') end)));
  end if;
  return v_new;
end $$;

-- Below 50, a day with a round played brings a little back.
create or replace function private.on_round_reputation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := private.rep_cfg();
  v_today date := (now() at time zone 'utc')::date;
  r public.player_reputation;
begin
  select * into r from public.player_reputation where user_id = new.user_id;
  if found and r.score < (c ->> 'recover_to')::integer and r.recover_day is distinct from v_today then
    update public.player_reputation set recover_day = v_today where user_id = new.user_id;
    perform private.rep_change(new.user_id, null, 'recovery', null,
                               least((c ->> 'recover_to')::integer, r.score + (c ->> 'recover')::integer));
  end if;
  return new;
end $$;

drop trigger if exists game_history_reputation on public.game_history;
create trigger game_history_reputation
  after insert on public.game_history
  for each row execute function private.on_round_reputation();

-- A moderator's action costs reputation. It hangs off the admin log, so file 15 needs no changes.
create or replace function private.on_admin_log_reputation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := private.rep_cfg();
  v_min integer := (new.details ->> 'minutes')::integer;
begin
  if new.target is null then
    return new;
  end if;
  if new.action = 'ban' then
    perform private.rep_change(new.target, null, 'ban', null, 0);
  elsif new.action = 'timeout' and v_min >= 60 * 24 * 7 then
    perform private.rep_change(new.target, null, 'timeout_long', null, 0);
  elsif new.action = 'timeout' and v_min >= 60 * 24 then
    perform private.rep_change(new.target, -(c ->> 'timeout_day')::integer, 'timeout_day');
  elsif new.action = 'timeout' then
    perform private.rep_change(new.target, -(c ->> 'timeout_short')::integer, 'timeout_short');
  elsif new.action = 'rename' then
    perform private.rep_change(new.target, -(c ->> 'rename')::integer, 'rename');
  end if;
  return new;
end $$;

drop trigger if exists admin_log_reputation on public.admin_log;
create trigger admin_log_reputation
  after insert on public.admin_log
  for each row execute function private.on_admin_log_reputation();

-- -----------------------------------------------------------------------------
-- The chat filter
-- -----------------------------------------------------------------------------

-- Words that are starred out. Matched as whole words (with common endings), after
-- undoing the usual number-for-letter swaps, so "class" and "Scunthorpe" are left alone.
create or replace function private.chat_words()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'fuck|fucker|fucking|motherfucker|fuk|fck|shit|shitty|bullshit|bitch|bitches|bastard|asshole|arsehole|dick|dickhead|cock|cocksucker|pussy|cunt|twat|wanker|prick|slut|whore|douche|douchebag|jackass|dumbass|retard|retarded|nigger|nigga|faggot|fag|dyke|tranny|kike|spic|chink|gook|coon|wetback|paki|rape|rapist|kys|stfu|gtfo|milf|porn|porno|nudes|boobs|tits|penis|vagina|dildo|blowjob|handjob|jizz|horny|hentai'
$$;

-- Returns the text others should see and why the message was caught (null = clean):
--   swear   delivered with the words starred out
--   promo   advertising or a link: not delivered
create or replace function private.chat_filter(p_text text, out body text, out reason text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_norm text := translate(lower(p_text), '0134578@$!', 'oieastbasi');
  v_pat text := '\m(' || private.chat_words() || ')(s|es|ed|er|ers|ing|in)?\M';
  v_from integer := 1;
  v_start integer;
  v_end integer;
begin
  body := p_text;
  -- Advertising: links, addresses, invitations to follow or join something elsewhere.
  if lower(p_text) ~ '(https?://|www\.)\S'
     or lower(p_text) ~ '\m[a-z0-9-]{2,}\.(com|net|org|gg|tv|io|co|me|xyz|ly|app|live|shop|store|link|club|bet|casino)\M'
     or lower(p_text) ~ '\m[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}\M'
     or lower(p_text) ~ '\m(follow|subscribe)\s+(to\s+)?(me|my)\M'
     or lower(p_text) ~ '\mmy\s+(channel|stream|twitch|youtube|tiktok|insta|instagram|snapchat|onlyfans|discord|website)\M'
     or lower(p_text) ~ '\m(promo|referral|invite)\s+code\M|\muse\s+code\M|\mdiscord\.gg\M' then
    reason := 'promo';
    return;
  end if;
  loop
    v_start := regexp_instr(v_norm, v_pat, v_from, 1, 0);
    exit when v_start = 0;
    v_end := regexp_instr(v_norm, v_pat, v_from, 1, 1);
    body := overlay(body placing repeat('*', v_end - v_start) from v_start for v_end - v_start);
    reason := 'swear';
    v_from := v_end;
    exit when v_from > length(v_norm);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Channels
-- -----------------------------------------------------------------------------

-- May this player read ('read') or write ('write') in this channel?
--   table:<uuid>   read: anyone who can see the table. write: players seated at it.
--   club:<uuid>    members only.
--   room:<game>    the three live rooms: any signed-in player.
create or replace function private.chat_allowed(p_user uuid, p_channel text, p_mode text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := split_part(coalesce(p_channel, ''), ':', 1);
  v_id text := split_part(coalesce(p_channel, ''), ':', 2);
begin
  if v_kind = 'room' then
    return v_id in ('crash', 'bingo', 'horse_racing');
  elsif v_kind = 'club' then
    return exists (select 1 from public.club_members m where m.club_id::text = v_id and m.user_id = p_user);
  elsif v_kind = 'table' then
    if p_mode = 'write' then
      return exists (select 1 from public.table_seats s where s.table_id::text = v_id and s.user_id = p_user);
    end if;
    return exists (select 1 from public.game_tables t where t.id::text = v_id and private.can_view_table(t.id));
  end if;
  return false;
end $$;

-- Sends one typed message. Returns what happened:
--   {message}                        delivered
--   {message, caught: 'swear', …}    delivered with words starred out
--   {caught: 'spam' | 'promo', …}    not delivered
-- with `warned` (the day's one warning) or `penalty` (points lost), and the player's standing.
create or replace function public.chat_send(p_channel text, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c jsonb := private.rep_cfg();
  r public.player_reputation;
  v_today date := (now() at time zone 'utc')::date;
  v_text text := btrim(regexp_replace(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
  v_body text;
  v_reason text;
  v_prev text;
  v_warned boolean := false;
  v_penalty integer := 0;
  v_msg public.chat_messages;
  v_hidden boolean;
begin
  if not private.chat_allowed(v_uid, p_channel, 'write') then
    raise exception 'action_not_allowed' using hint = 'You can''t chat here. At a table you need a seat.';
  end if;
  r := private.rep_row(v_uid);
  if not private.rep_can(v_uid, 'chat') then
    raise exception 'chat_banned' using hint = 'Typed chat is switched off for you at the moment. See your profile for why.';
  end if;
  if r.last_message_at > now() - make_interval(secs => (c ->> 'gap_seconds')::integer) then
    raise exception 'slow_down' using hint = 'Wait a moment between messages.';
  end if;
  v_text := left(v_text, (c ->> 'max_length')::integer);
  if v_text = '' then
    raise exception 'action_not_allowed' using hint = 'Type a message first.';
  end if;

  select lower(coalesce(m.raw, m.body)) into v_prev from public.chat_messages m where m.user_id = v_uid order by m.id desc limit 1;
  -- Spam: the same message a third time within two minutes, or seven messages in half a minute.
  if (select count(*) from public.chat_messages m
       where m.user_id = v_uid and m.created_at > now() - interval '2 minutes' and lower(coalesce(m.raw, m.body)) = lower(v_text)) >= 2
     or (select count(*) from public.chat_messages m where m.user_id = v_uid and m.created_at > now() - interval '30 seconds') >= 7
     or v_text ~ '(.)\1{11,}' then
    v_body := v_text;
    v_reason := 'spam';
  else
    select f.body, f.reason into v_body, v_reason from private.chat_filter(v_text) f;
  end if;
  v_hidden := v_reason in ('spam', 'promo');

  insert into public.chat_messages (channel, user_id, username, body, raw, flagged, hidden)
  values (p_channel, v_uid, (select username from public.profiles where id = v_uid), v_body,
          case when v_body <> v_text or v_reason is not null then v_text end, v_reason, coalesce(v_hidden, false))
  returning * into v_msg;
  update public.player_reputation set last_message_at = now() where user_id = v_uid;

  if v_reason is not null then
    -- The first catch of a day is a warning; after that each one costs points.
    if r.warned_day is distinct from v_today then
      update public.player_reputation set warned_day = v_today, clean_count = 0 where user_id = v_uid;
      perform private.rep_change(v_uid, 0, 'chat_warning', v_reason);
      v_warned := true;
    else
      v_penalty := (c ->> 'filter_penalty')::integer;
      perform private.rep_change(v_uid, -v_penalty, 'chat_' || v_reason);
    end if;
  elsif length(v_text) >= 3 and lower(v_text) is distinct from v_prev then
    -- A clean message that isn't a repeat counts towards the next point.
    if r.clean_count + 1 >= (c ->> 'gain_every')::integer then
      update public.player_reputation
         set clean_count = 0, gain_day = v_today,
             gain_today = case when gain_day is distinct from v_today then 1 else gain_today + 1 end
       where user_id = v_uid
         and (gain_day is distinct from v_today or gain_today < (c ->> 'gain_cap')::integer);
      if found then
        perform private.rep_change(v_uid, 1, 'chat_clean');
      else
        update public.player_reputation set clean_count = 0 where user_id = v_uid;
      end if;
    else
      update public.player_reputation set clean_count = clean_count + 1 where user_id = v_uid;
    end if;
  end if;

  -- Housekeeping: messages are only kept a few days.
  delete from public.chat_messages where created_at < now() - make_interval(days => (c ->> 'keep_days')::integer);

  return jsonb_strip_nulls(jsonb_build_object(
    'message', case when not v_msg.hidden then jsonb_build_object(
      'id', v_msg.id, 'user_id', v_msg.user_id, 'username', v_msg.username, 'body', v_msg.body, 'at', v_msg.created_at) end,
    'caught', v_reason, 'warned', case when v_warned then true end, 'penalty', nullif(v_penalty, 0),
    'reputation', private.reputation_of(v_uid), 'can_chat', private.rep_can(v_uid, 'chat')));
end $$;

-- The newest messages in a channel (after p_after, if given), oldest first.
-- Tables and rooms show the last two hours; clubs everything that is kept.
create or replace function public.chat_fetch(p_channel text, p_after bigint default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  if not private.chat_allowed(v_uid, p_channel, 'read') then
    raise exception 'action_not_allowed' using hint = 'You can''t read this chat.';
  end if;
  return jsonb_build_object(
    'can_write', private.chat_allowed(v_uid, p_channel, 'write'),
    'can_chat', private.rep_can(v_uid, 'chat'),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', x.id, 'user_id', x.user_id, 'username', x.username, 'body', x.body, 'at', x.created_at) order by x.id), '[]'::jsonb)
                   from (select m.* from public.chat_messages m
                          where m.channel = p_channel and m.id > coalesce(p_after, 0) and not m.hidden
                            and m.created_at > now() - case when p_channel like 'club:%'
                                                            then make_interval(days => (private.rep_cfg() ->> 'keep_days')::integer)
                                                            else interval '2 hours' end
                            and not exists (select 1 from public.player_blocks b where b.blocker = v_uid and b.blocked = m.user_id)
                          order by m.id desc limit 50) x));
end $$;

-- Report a message. What was written is copied into the report, so it outlives the 3 days.
create or replace function public.chat_report(p_message bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  m public.chat_messages;
begin
  select * into m from public.chat_messages where id = p_message and not hidden;
  if not found or m.user_id = v_uid or not private.chat_allowed(v_uid, m.channel, 'read') then
    raise exception 'action_not_allowed' using hint = 'That message can no longer be reported.';
  end if;
  if exists (select 1 from public.player_reports where reporter = v_uid and (context ->> 'message_id')::bigint = p_message) then
    raise exception 'action_not_allowed' using hint = 'You have already reported that message. A moderator will look at it.';
  end if;
  if (select count(*) from public.player_reports where reporter = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'slow_down' using hint = 'That is a lot of reports for one day. Try again tomorrow.';
  end if;
  insert into public.player_reports (reporter, reported, reason, context)
  values (v_uid, m.user_id, 'harassment',
          jsonb_strip_nulls(jsonb_build_object('chat', true, 'message_id', m.id, 'channel', m.channel, 'username', m.username,
                                               'body', m.body, 'raw', m.raw, 'said_at', m.created_at)));
end $$;

-- Your own standing: the number, what you may do, and what changed it lately.
create or replace function public.my_reputation()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  c jsonb := private.rep_cfg();
  r public.player_reputation;
  v_today date := (now() at time zone 'utc')::date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into r from public.player_reputation where user_id = v_uid;
  return jsonb_build_object(
    'score', coalesce(r.score, (c ->> 'start')::integer),
    'can_chat', private.rep_can(v_uid, 'chat'), 'can_quick', private.rep_can(v_uid, 'quick'),
    'chat_banned_until', case when r.chat_banned_until > now() then r.chat_banned_until end,
    'quick_banned_until', case when r.quick_banned_until > now() then r.quick_banned_until end,
    'chat_ban_reason', case when r.chat_banned_until > now() then r.chat_ban_reason end,
    'quick_ban_reason', case when r.quick_banned_until > now() then r.quick_ban_reason end,
    'clean_count', coalesce(r.clean_count, 0),
    'gained_today', case when r.gain_day = v_today then r.gain_today else 0 end,
    'config', c,
    -- A note is shown to the player only where it is meant for them: a moderator's warning, and what the filter caught.
    'log', (select coalesce(jsonb_agg(jsonb_build_object('delta', l.delta, 'score', l.score, 'reason', l.reason,
                                                         'note', case when l.reason in ('warning', 'chat_warning') then l.note end, 'at', l.created_at)
                                      order by l.id desc), '[]'::jsonb)
              from (select * from public.reputation_log where user_id = v_uid order by id desc limit 20) l));
end $$;

-- -----------------------------------------------------------------------------
-- The admin
-- -----------------------------------------------------------------------------

-- A player's standing, its history and what they typed lately (as typed, including what the filter stopped).
create or replace function public.admin_reputation_view(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.player_reputation;
begin
  perform private.require_admin();
  select * into r from public.player_reputation where user_id = p_user;
  return jsonb_build_object(
    'score', private.reputation_of(p_user), 'best', coalesce(r.best, 50),
    'can_chat', private.rep_can(p_user, 'chat'), 'can_quick', private.rep_can(p_user, 'quick'),
    'chat_banned_until', case when r.chat_banned_until > now() then r.chat_banned_until end,
    'quick_banned_until', case when r.quick_banned_until > now() then r.quick_banned_until end,
    'chat_ban_reason', case when r.chat_banned_until > now() then r.chat_ban_reason end,
    'quick_ban_reason', case when r.quick_banned_until > now() then r.quick_ban_reason end,
    'log', (select coalesce(jsonb_agg(jsonb_build_object('delta', l.delta, 'score', l.score, 'reason', l.reason, 'note', l.note, 'at', l.created_at)
                                      order by l.id desc), '[]'::jsonb)
              from (select * from public.reputation_log where user_id = p_user order by id desc limit 30) l),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'channel', m.channel, 'text', coalesce(m.raw, m.body),
                                                              'flagged', m.flagged, 'hidden', m.hidden, 'at', m.created_at) order by m.id desc), '[]'::jsonb)
                   from (select * from public.chat_messages where user_id = p_user order by id desc limit 40) m));
end $$;

-- Change a reputation like chips: 'add' (may be negative) or 'set'.
create or replace function public.admin_reputation(p_user uuid, p_mode text, p_amount integer, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  perform private.require_admin();
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'player_not_found';
  end if;
  if p_mode not in ('add', 'set') or p_amount is null or p_amount < -100 or p_amount > 100 or (p_mode = 'set' and p_amount < 0) then
    raise exception 'action_not_allowed' using hint = 'Reputation runs from 0 to 100.';
  end if;
  v := case when p_mode = 'set' then private.rep_change(p_user, null, 'admin_adjust', p_note, p_amount)
            else private.rep_change(p_user, p_amount, 'admin_adjust', p_note) end;
  perform private.admin_note('reputation', p_user, jsonb_build_object('mode', p_mode, 'amount', p_amount, 'score', v, 'note', p_note));
  return v;
end $$;

-- Switch typed chat ('chat') or quick chat ('quick') off for a player, whatever their reputation.
-- p_minutes: how long; null = until lifted; 0 = lift it now. p_reason is shown to the player.
drop function if exists public.admin_chat_ban(uuid, text, integer);
create or replace function public.admin_chat_ban(p_user uuid, p_kind text, p_minutes integer default null, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_until timestamptz := case when p_minutes is null then 'infinity'::timestamptz when p_minutes = 0 then null
                              else now() + make_interval(mins => p_minutes) end;
  v_reason text := case when p_minutes is distinct from 0 then nullif(left(btrim(coalesce(p_reason, '')), 200), '') end;
begin
  perform private.require_admin();
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'player_not_found';
  end if;
  if p_kind not in ('chat', 'quick') or p_minutes < 0 or p_minutes > 60 * 24 * 365 then
    raise exception 'action_not_allowed' using hint = 'Pick typed chat or quick chat, and a time up to a year.';
  end if;
  perform private.rep_row(p_user);
  if p_kind = 'chat' then
    update public.player_reputation set chat_banned_until = v_until, chat_ban_reason = v_reason, updated_at = now() where user_id = p_user;
  else
    update public.player_reputation set quick_banned_until = v_until, quick_ban_reason = v_reason, updated_at = now() where user_id = p_user;
  end if;
  perform private.admin_note(case when p_minutes = 0 then 'chat_unban' else 'chat_ban' end, p_user,
                             jsonb_build_object('kind', p_kind, 'ban_minutes', p_minutes, 'reason', v_reason));
  if p_minutes is distinct from 0 then
    perform private.notify(p_user, 'chat_ban', jsonb_strip_nulls(jsonb_build_object(
      'kind', p_kind, 'until', case when p_minutes is not null then v_until end, 'reason', v_reason)));
  end if;
end $$;

-- A warning with no other action. p_report: also mark that report as dealt with.
create or replace function public.admin_warn(p_user uuid, p_reason text default null, p_report bigint default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  perform private.require_admin();
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'player_not_found';
  end if;
  v := private.rep_change(p_user, -(private.rep_cfg() ->> 'warning')::integer, 'warning', p_reason);
  if p_report is not null then
    update public.player_reports set status = 'actioned', resolution = 'Warning', resolved_at = now() where id = p_report and reported = p_user;
  end if;
  perform private.admin_note('warn', p_user, jsonb_build_object('reason', p_reason, 'report', p_report, 'score', v));
  return v;
end $$;

-- Dismiss a report as likely false: the reporter loses a little reputation.
create or replace function public.admin_report_false(p_report bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.player_reports;
begin
  perform private.require_admin();
  update public.player_reports set status = 'dismissed', resolution = 'Judged a false report', resolved_at = now()
   where id = p_report and status = 'open' returning * into r;
  if not found then
    raise exception 'action_not_allowed' using hint = 'That report is no longer open.';
  end if;
  if r.reporter is not null then
    perform private.rep_change(r.reporter, -(private.rep_cfg() ->> 'false_report')::integer, 'false_report');
  end if;
  perform private.admin_note('report_false', r.reporter, jsonb_build_object('report', p_report));
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.chat_send(text, text)', 'public.chat_fetch(text, bigint)', 'public.chat_report(bigint)', 'public.my_reputation()',
    'public.admin_reputation_view(uuid)', 'public.admin_reputation(uuid, text, integer, text)',
    'public.admin_chat_ban(uuid, text, integer, text)', 'public.admin_warn(uuid, text, bigint)', 'public.admin_report_false(bigint)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.player_reputation enable row level security;
alter table public.reputation_log    enable row level security;
alter table public.chat_messages     enable row level security;

drop policy if exists "player_reputation: own row" on public.player_reputation;
create policy "player_reputation: own row" on public.player_reputation for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "reputation_log: own rows" on public.reputation_log;
create policy "reputation_log: own rows" on public.reputation_log for select to authenticated using (user_id = (select auth.uid()));

-- chat_messages: RLS on, NO policies, NO privileges. Clients read chat only through chat_fetch.
revoke all on public.chat_messages from anon, authenticated;
revoke insert, update, delete, truncate on public.player_reputation, public.reputation_log from anon, authenticated;
revoke all on public.player_reputation, public.reputation_log from anon;
grant select on public.player_reputation, public.reputation_log to authenticated;

-- A player's own standing changes live (a penalty, a moderator's decision).
select private.add_to_realtime('player_reputation');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

-- =============================================================================
-- All In · 16_missions_seasons.sql
-- Stage 9, part 2: daily and weekly missions, monthly seasons, the notification
-- inbox and inviting a friend to your table.
-- Run AFTER 01-15 (re-run 13_progression.sql first: the mission achievements are there).
-- Safe to re-run.
--
--   * player_missions   three daily and three weekly missions per player, dealt
--                       lazily from private.mission_pool(). Progress is counted by a
--                       trigger on game_history, so every game counts with no changes.
--   * player_seasons    season points per player and month. Points come from missions.
--   * notifications     each player's inbox (own rows, in realtime).
--
-- SEASONS AND SECRECY. private.season_cfg() lists every season up to October 2027.
-- It is a private function: no client can call it. A season's cosmetics are written
-- to the public `cosmetics` table only once its month has begun (private.season_sync),
-- and season_state / season_claim only ever look at the month the SERVER's clock is in.
-- So a future season can be neither seen nor earned through the app. When a month
-- ends its track closes for good; tiers a player had already reached are handed over.
-- =============================================================================

alter table public.cosmetics add column if not exists season text;
-- How a cosmetic looks, for ones the app does not have built in (season rewards).
alter table public.cosmetics add column if not exists look jsonb;

create table if not exists public.player_missions (
  user_id        uuid not null references auth.users (id) on delete cascade,
  period         text not null check (period in ('daily', 'weekly')),
  period_start   date not null,
  slot           integer not null,
  key            text not null,
  kind           text not null,
  param          text,
  goal           bigint not null check (goal > 0),
  progress       bigint not null default 0,
  reward_chips   bigint not null default 0,
  reward_xp      integer not null default 0,
  reward_points  integer not null default 0,
  -- e.g. which games have been played, for "play N different games"
  meta           jsonb not null default '{}'::jsonb,
  completed_at   timestamptz,
  claimed_at     timestamptz,
  primary key (user_id, period, period_start, slot)
);
create index if not exists player_missions_open_idx on public.player_missions (user_id, period_start) where claimed_at is null;

create table if not exists public.player_seasons (
  user_id       uuid not null references auth.users (id) on delete cascade,
  season        text not null check (season ~ '^[0-9]{4}-[0-9]{2}$'),
  points        integer not null default 0 check (points >= 0),
  claimed_tier  integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (user_id, season)
);

create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, id desc);

-- -----------------------------------------------------------------------------
-- The clock. Everything here asks this function what time it is, so the tests can
-- move it. In production it is simply now().
-- -----------------------------------------------------------------------------
create or replace function private.live_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now() $$;

create or replace function private.live_day()
returns date
language sql
stable
set search_path = ''
as $$ select (private.live_now() at time zone 'utc')::date $$;

create or replace function private.live_week()
returns date
language sql
stable
set search_path = ''
as $$ select date_trunc('week', private.live_now() at time zone 'utc')::date $$;

-- Adds to one of the counters that achievements read (player_progress.counters).
create or replace function private.bump(p_user uuid, p_key text, p_by bigint default 1)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.player_progress (user_id) values (p_user) on conflict (user_id) do nothing;
  update public.player_progress
     set counters = jsonb_set(counters, array[p_key], to_jsonb(coalesce((counters ->> p_key)::bigint, 0) + p_by))
   where user_id = p_user;
end $$;

-- -----------------------------------------------------------------------------
-- Inbox
-- -----------------------------------------------------------------------------
-- Adds a notification. Each inbox keeps its newest 60.
create or replace function private.notify(p_user uuid, p_kind text, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, data) values (p_user, p_kind, coalesce(p_data, '{}'::jsonb));
  delete from public.notifications n
   where n.user_id = p_user
     and n.id < (select min(x.id) from (select id from public.notifications where user_id = p_user order by id desc limit 60) x);
end $$;

create or replace function public.inbox()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications where user_id = v_uid and read_at is null),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'data', n.data, 'at', n.created_at, 'read', n.read_at is not null)
                                        order by n.id desc), '[]'::jsonb)
                from public.notifications n where n.user_id = v_uid));
end $$;

-- Marks notifications read (all of them when p_ids is null).
create or replace function public.inbox_read(p_ids bigint[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  update public.notifications set read_at = now()
   where user_id = v_uid and read_at is null and (p_ids is null or id = any (p_ids));
end $$;

-- Deletes one notification, or all of them when p_id is null.
create or replace function public.inbox_clear(p_id bigint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  delete from public.notifications where user_id = v_uid and (p_id is null or id = p_id);
end $$;

-- Friend requests and answers.
create or replace function private.friendship_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform private.notify(new.addressee, 'friend_request',
      jsonb_build_object('from', (select username from public.profiles where id = new.requester), 'from_id', new.requester));
  elsif new.status = 'accepted' and (tg_op = 'INSERT' or old.status <> 'accepted') then
    perform private.notify(new.requester, 'friend_accepted',
      jsonb_build_object('from', (select username from public.profiles where id = new.addressee), 'from_id', new.addressee));
  end if;
  return new;
end $$;

drop trigger if exists friendships_notify on public.friendships;
create trigger friendships_notify after insert or update of status on public.friendships
  for each row execute function private.friendship_notify();

create or replace function private.achievement_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify(new.user_id, 'achievement', jsonb_build_object(
    'key', new.achievement_key, 'name', (select name from public.achievements where key = new.achievement_key)));
  return new;
end $$;

drop trigger if exists player_achievements_notify on public.player_achievements;
create trigger player_achievements_notify after insert on public.player_achievements
  for each row execute function private.achievement_notify();

-- Ask a friend to come and sit at the table you are at.
create or replace function public.invite_friend(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.game_tables;
begin
  select g.* into t from public.table_seats s join public.game_tables g on g.id = s.table_id where s.user_id = v_uid;
  if not found then
    raise exception 'action_not_allowed' using hint = 'Take a seat at a table first.';
  end if;
  if t.play_money then
    raise exception 'action_not_allowed' using hint = 'Tournament tables can''t take guests.';
  end if;
  if private.friend_state(v_uid, p_user) <> 'friends' then
    raise exception 'action_not_allowed' using hint = 'You can only invite friends.';
  end if;
  if (select count(*) from public.table_seats where table_id = t.id) >= t.max_seats then
    raise exception 'action_not_allowed' using hint = 'Your table is full.';
  end if;
  if exists (select 1 from public.table_seats where table_id = t.id and user_id = p_user) then
    raise exception 'action_not_allowed' using hint = 'They are already at your table.';
  end if;
  if exists (select 1 from public.notifications n
              where n.user_id = p_user and n.kind = 'table_invite' and n.data ->> 'from_id' = v_uid::text
                and n.created_at > now() - interval '60 seconds') then
    raise exception 'slow_down' using hint = 'You invited them a moment ago.';
  end if;
  perform private.notify(p_user, 'table_invite', jsonb_strip_nulls(jsonb_build_object(
    'from', (select username from public.profiles where id = v_uid), 'from_id', v_uid,
    'table_id', t.id, 'table_name', t.name, 'game_key', t.game_key,
    'game_name', (select name from public.games where key = t.game_key),
    -- A private table can only be entered with its code; a friend you invite gets it.
    'code', case when t.is_private then t.invite_code end)));
  perform private.bump(v_uid, 'invites_sent');
  perform private.check_achievements(v_uid);
end $$;

-- -----------------------------------------------------------------------------
-- Seasons
-- -----------------------------------------------------------------------------
-- Every season. PRIVATE: clients cannot call this (see the note at the top).
-- Each has a title, an avatar (an emoji), a card back or a felt, and a frame.
create or replace function private.season_cfg()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_agg(jsonb_build_object(
    'key', s.key, 'name', s.name, 'blurb', s.blurb, 'accent', s.accent,
    'title', s.title, 'avatar_name', s.avatar_name, 'glyph', s.glyph,
    'extra_kind', s.extra_kind, 'extra_name', s.extra_name, 'extra_look', s.extra_look::jsonb,
    'frame_name', s.frame_name, 'frame_look', s.frame_look::jsonb) order by s.key)
  from (values
    ('2026-10', 'Fright Night', 'A month of tricks, treats and things that go bump at the tables.', '#f08a24',
     'Night Owl', 'Jack-o''-Lantern', '🎃', 'card_back', 'Cobweb', '{"base":"#2a1038","line":"240,138,36"}',
     'Witching Hour', '{"color":"#f08a24","gradient":"conic-gradient(#f08a24, #6b2fa0, #1a0b24, #6b2fa0, #f08a24)","glow":"rgba(240,138,36,0.55)"}'),
    ('2026-11', 'Harvest Table', 'Pull up a chair: the long autumn evenings are for cards.', '#d98a2b',
     'Thankful', 'Turkey', '🦃', 'felt', 'Autumn Leaves', '{"base":"#4a2208","glow":"217 138 43"}',
     'Cornucopia', '{"color":"#d98a2b","gradient":"conic-gradient(#d98a2b, #8a3a12, #f0d688, #8a3a12, #d98a2b)","glow":"rgba(217,138,43,0.5)"}'),
    ('2026-12', 'Winter Lights', 'Snow outside, a warm lounge inside.', '#8fd3ff',
     'Snowed In', 'Snowman', '⛄', 'card_back', 'Frost', '{"base":"#123a5c","line":"220,244,255"}',
     'Northern Lights', '{"color":"#8fd3ff","gradient":"conic-gradient(#8fd3ff, #5cc392, #b48cf2, #5cc392, #8fd3ff)","glow":"rgba(143,211,255,0.55)"}'),
    ('2027-01', 'Fresh Deck', 'A new year and a clean score sheet.', '#f0d688',
     'Resolute', 'Party Popper', '🎉', 'felt', 'Midnight Toast', '{"base":"#0b1026","glow":"240 214 136"}',
     'Countdown', '{"color":"#f0d688","gradient":"conic-gradient(#f0d688, #ffffff, #b8902a, #ffffff, #f0d688)","glow":"rgba(240,214,136,0.6)"}'),
    ('2027-02', 'Queen of Hearts', 'A month for the red suits.', '#f0668a',
     'Heartbreaker', 'Cupid''s Arrow', '💘', 'card_back', 'Sweetheart', '{"base":"#7a1238","line":"255,205,220"}',
     'Love Letter', '{"color":"#f0668a","gradient":"conic-gradient(#f0668a, #ffd0dc, #a81c4a, #ffd0dc, #f0668a)","glow":"rgba(240,102,138,0.55)"}'),
    ('2027-03', 'Lucky Streak', 'Clovers, rainbows and a pot at the end.', '#4fc36a',
     'Lucky Charm', 'Four-Leaf Clover', '🍀', 'felt', 'Shamrock', '{"base":"#0b4a22","glow":"79 195 106"}',
     'Pot of Gold', '{"color":"#4fc36a","gradient":"conic-gradient(#4fc36a, #f0d688, #1f7a3a, #f0d688, #4fc36a)","glow":"rgba(79,195,106,0.55)"}'),
    ('2027-04', 'Spring Fling', 'Everything is in bloom, including your stack.', '#f2a6d0',
     'In Full Bloom', 'Cherry Blossom', '🌸', 'card_back', 'Petals', '{"base":"#8a3a6a","line":"255,225,240"}',
     'Garden Party', '{"color":"#f2a6d0","gradient":"conic-gradient(#f2a6d0, #b8e6a0, #f7e08a, #b8e6a0, #f2a6d0)","glow":"rgba(242,166,208,0.5)"}'),
    ('2027-05', 'High Noon', 'Dust, spurs and a showdown at the saloon.', '#d9a35a',
     'Gunslinger', 'Cowboy', '🤠', 'felt', 'Saloon', '{"base":"#3d2412","glow":"217 163 90"}',
     'Sheriff''s Star', '{"color":"#d9a35a","gradient":"conic-gradient(#d9a35a, #fff2c8, #7a4a1c, #fff2c8, #d9a35a)","glow":"rgba(217,163,90,0.55)"}'),
    ('2027-06', 'Summer Nights', 'Long evenings and warm felt.', '#ffb347',
     'Sun Chaser', 'Sunglasses', '😎', 'card_back', 'Sunset', '{"base":"#a8421c","line":"255,226,160"}',
     'Golden Hour', '{"color":"#ffb347","gradient":"conic-gradient(#ffb347, #ff6f61, #ffe29a, #ff6f61, #ffb347)","glow":"rgba(255,179,71,0.55)"}'),
    ('2027-07', 'Fireworks', 'Big bangs, bright skies, bigger pots.', '#6fa8ff',
     'Showstopper', 'Fireworks', '🎆', 'felt', 'Night Sky', '{"base":"#0a1440","glow":"111 168 255"}',
     'Grand Finale', '{"color":"#6fa8ff","gradient":"conic-gradient(#6fa8ff, #ff5a6a, #ffffff, #ff5a6a, #6fa8ff)","glow":"rgba(111,168,255,0.6)"}'),
    ('2027-08', 'Tropic Heat', 'Palm trees, parrots and a breeze off the water.', '#2fd0c0',
     'Castaway', 'Palm Tree', '🌴', 'card_back', 'Lagoon', '{"base":"#0c5a66","line":"190,255,240"}',
     'Tidal', '{"color":"#2fd0c0","gradient":"conic-gradient(#2fd0c0, #f7e08a, #1a7a9a, #f7e08a, #2fd0c0)","glow":"rgba(47,208,192,0.55)"}'),
    ('2027-09', 'Night School', 'Study the odds. There will be a test.', '#c9a4f5',
     'Card Scholar', 'Wise Owl', '🦉', 'felt', 'Blackboard', '{"base":"#16261c","glow":"201 164 245"}',
     'Honour Roll', '{"color":"#c9a4f5","gradient":"conic-gradient(#c9a4f5, #f0d688, #5a3a9a, #f0d688, #c9a4f5)","glow":"rgba(201,164,245,0.55)"}'),
    ('2027-10', 'Fright Night II', 'It is back, and it brought friends.', '#9be564',
     'Things That Go Bump', 'Ghost', '👻', 'card_back', 'Graveyard Shift', '{"base":"#16241a","line":"155,229,100"}',
     'Full Moon', '{"color":"#9be564","gradient":"conic-gradient(#9be564, #2a1038, #f08a24, #2a1038, #9be564)","glow":"rgba(155,229,100,0.55)"}')
  ) as s(key, name, blurb, accent, title, avatar_name, glyph, extra_kind, extra_name, extra_look, frame_name, frame_look)
$$;

-- The season for the month the server's clock is in, or null.
create or replace function private.season_current()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select s from jsonb_array_elements(private.season_cfg()) s
   where s ->> 'key' = to_char(private.live_now() at time zone 'utc', 'YYYY-MM')
$$;

-- "2026-10" -> "s2610"
create or replace function private.season_slug(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$ select 's' || substr(p_key, 3, 2) || substr(p_key, 6, 2) $$;

-- The ten steps of a season's track: points needed and what each one gives.
create or replace function private.season_tiers(s jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_agg(jsonb_build_object('tier', t.tier, 'points', t.points, 'chips', t.chips,
           'cosmetic', case when t.kind is not null then private.season_slug(s ->> 'key') || '_' || t.suffix end) order by t.tier)
    from (values
      (1, 50, 500, null, null), (2, 120, 1000, null, null), (3, 200, 0, 'title', 'title'), (4, 300, 1500, null, null),
      (5, 400, 0, 'avatar', 'avatar'), (6, 520, 2500, null, null), (7, 640, 0, 'extra', 'extra'), (8, 760, 4000, null, null),
      (9, 880, 6000, null, null), (10, 1000, 0, 'frame', 'frame')
    ) as t(tier, points, chips, kind, suffix)
$$;

-- Publishes the current season's four cosmetics. Before this runs for a month,
-- those rows do not exist anywhere a client can read.
create or replace function private.season_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s jsonb := private.season_current();
  v_slug text;
begin
  if s is null then
    return;
  end if;
  v_slug := private.season_slug(s ->> 'key');
  if exists (select 1 from public.cosmetics where key = v_slug || '_frame') then
    return;
  end if;
  insert into public.cosmetics (key, kind, name, unlock_level, sort_order, season, look) values
    (v_slug || '_title',  'title',  s ->> 'title',       null, 900, s ->> 'key', null),
    (v_slug || '_avatar', 'avatar', s ->> 'avatar_name', null, 900, s ->> 'key', jsonb_build_object('glyph', s ->> 'glyph')),
    (v_slug || '_extra',  s ->> 'extra_kind', s ->> 'extra_name', null, 900, s ->> 'key', s -> 'extra_look'),
    (v_slug || '_frame',  'frame',  s ->> 'frame_name',  null, 900, s ->> 'key', s -> 'frame_look')
  on conflict (key) do nothing;
end $$;

-- Hands over every tier a player has reached in one season and not yet collected.
create or replace function private.season_grant(p_user uuid, p_season jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ps public.player_seasons;
  t jsonb;
  v_chips bigint := 0;
  v_items text[] := '{}';
  v_top integer;
begin
  select * into ps from public.player_seasons where user_id = p_user and season = p_season ->> 'key' for update;
  if not found then
    return jsonb_build_object('chips', 0, 'cosmetics', '[]'::jsonb, 'tiers', 0);
  end if;
  v_top := ps.claimed_tier;
  for t in select x from jsonb_array_elements(private.season_tiers(p_season)) x
            where (x ->> 'tier')::integer > ps.claimed_tier and (x ->> 'points')::integer <= ps.points
            order by (x ->> 'tier')::integer loop
    v_top := (t ->> 'tier')::integer;
    v_chips := v_chips + (t ->> 'chips')::bigint;
    if t ->> 'cosmetic' is not null and exists (select 1 from public.cosmetics where key = t ->> 'cosmetic') then
      insert into public.player_cosmetics (user_id, cosmetic_key) values (p_user, t ->> 'cosmetic') on conflict do nothing;
      v_items := array_append(v_items, t ->> 'cosmetic');
    end if;
  end loop;
  if v_top = ps.claimed_tier then
    return jsonb_build_object('chips', 0, 'cosmetics', '[]'::jsonb, 'tiers', 0);
  end if;
  update public.player_seasons set claimed_tier = v_top, updated_at = now() where user_id = p_user and season = ps.season;
  if v_chips > 0 then
    perform private.apply_chips(p_user, v_chips, 'season_reward', null, ps.season, jsonb_build_object('tier', v_top));
  end if;
  perform private.bump(p_user, 'season_tiers', v_top - ps.claimed_tier);
  if v_top = 10 then
    perform private.bump(p_user, 'seasons_done');
  end if;
  perform private.check_achievements(p_user);
  return jsonb_build_object('chips', v_chips, 'cosmetics', to_jsonb(v_items), 'tiers', v_top - ps.claimed_tier);
end $$;

-- A season that has ended: whatever the player had reached is handed over, and it is closed.
create or replace function private.season_settle(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now text := to_char(private.live_now() at time zone 'utc', 'YYYY-MM');
  r record;
  s jsonb;
  g jsonb;
begin
  for r in select * from public.player_seasons where user_id = p_user and season < v_now and claimed_tier < 10 and points >= 50 loop
    select x into s from jsonb_array_elements(private.season_cfg()) x where x ->> 'key' = r.season;
    if s is not null then
      g := private.season_grant(p_user, s);
      if (g ->> 'tiers')::integer > 0 then
        perform private.notify(p_user, 'season_rewards', jsonb_build_object('season', s ->> 'name', 'chips', g -> 'chips', 'items', jsonb_array_length(g -> 'cosmetics')));
      end if;
    end if;
  end loop;
end $$;

create or replace function private.season_add(p_user uuid, p_points integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s jsonb := private.season_current();
begin
  if s is null or p_points <= 0 then
    return;
  end if;
  perform private.season_sync();
  insert into public.player_seasons as ps (user_id, season, points) values (p_user, s ->> 'key', p_points)
  on conflict (user_id, season) do update set points = ps.points + excluded.points, updated_at = now();
end $$;

-- -----------------------------------------------------------------------------
-- Missions
-- -----------------------------------------------------------------------------
-- kind: rounds | wins | wager | category (param = games.category) | games (different games)
--       | multiple (param = times the bet, in one round) | net (chips won, winning rounds only) | tourney
create or replace function private.mission_pool()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_agg(to_jsonb(m)) from (values
    ('d_rounds',    'daily',  'rounds',   null,        20,    300,  40,  10),
    ('d_wins',      'daily',  'wins',     null,        8,     400,  40,  10),
    ('d_wager',     'daily',  'wager',    null,        2000,  400,  40,  10),
    ('d_slots',     'daily',  'category', 'slots',     15,    300,  40,  10),
    ('d_table',     'daily',  'category', 'table',     10,    300,  40,  10),
    ('d_poker',     'daily',  'category', 'poker',     5,     400,  40,  10),
    ('d_specialty', 'daily',  'category', 'specialty', 10,    300,  40,  10),
    ('d_games',     'daily',  'games',    null,        3,     400,  40,  10),
    ('d_multiple',  'daily',  'multiple', '5',         1,     500,  40,  10),
    ('d_net',       'daily',  'net',      null,        1000,  400,  40,  10),
    ('w_rounds',    'weekly', 'rounds',   null,        200,   2500, 250, 40),
    ('w_wins',      'weekly', 'wins',     null,        75,    2500, 250, 40),
    ('w_wager',     'weekly', 'wager',    null,        25000, 2500, 250, 40),
    ('w_games',     'weekly', 'games',    null,        8,     3000, 250, 40),
    ('w_multiple',  'weekly', 'multiple', '20',        1,     3000, 250, 40),
    ('w_net',       'weekly', 'net',      null,        10000, 3000, 250, 40),
    ('w_tourney',   'weekly', 'tourney',  null,        3,     3000, 250, 40),
    ('w_poker',     'weekly', 'category', 'poker',     40,    2500, 250, 40)
  ) as m(key, period, kind, param, goal, chips, xp, points)
$$;

-- Deals today's and this week's missions if the player doesn't have them yet.
-- Which three is fixed by the player and the date, so it can't be re-rolled.
create or replace function private.missions_ensure(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := private.live_day();
  v_week date := private.live_week();
begin
  if not exists (select 1 from public.player_missions where user_id = p_user and period = 'daily' and period_start = v_day) then
    insert into public.player_missions (user_id, period, period_start, slot, key, kind, param, goal, reward_chips, reward_xp, reward_points)
    select p_user, 'daily', v_day, row_number() over (order by x.h), x.m ->> 'key', x.m ->> 'kind', x.m ->> 'param',
           (x.m ->> 'goal')::bigint, (x.m ->> 'chips')::bigint, (x.m ->> 'xp')::integer, (x.m ->> 'points')::integer
      from (select m, md5(p_user::text || v_day::text || (m ->> 'key')) as h
              from jsonb_array_elements(private.mission_pool()) m where m ->> 'period' = 'daily' order by 2 limit 3) x
    on conflict do nothing;
  end if;
  if not exists (select 1 from public.player_missions where user_id = p_user and period = 'weekly' and period_start = v_week) then
    insert into public.player_missions (user_id, period, period_start, slot, key, kind, param, goal, reward_chips, reward_xp, reward_points)
    select p_user, 'weekly', v_week, row_number() over (order by x.h), x.m ->> 'key', x.m ->> 'kind', x.m ->> 'param',
           (x.m ->> 'goal')::bigint, (x.m ->> 'chips')::bigint, (x.m ->> 'xp')::integer, (x.m ->> 'points')::integer
      from (select m, md5(p_user::text || v_week::text || (m ->> 'key')) as h
              from jsonb_array_elements(private.mission_pool()) m where m ->> 'period' = 'weekly' order by 2 limit 3) x
    on conflict do nothing;
  end if;
end $$;

-- After every finished round of every game: move the player's missions along,
-- and tell them how a tournament ended.
create or replace function private.on_round_missions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := private.live_day();
  v_week date := private.live_week();
  v_cat text;
  v_done integer;
  v_weekly integer;
  s jsonb := coalesce(new.summary, '{}'::jsonb);
begin
  if new.game_key in ('sng_poker', 'slot_showdown') then
    perform private.notify(new.user_id, 'tournament_result', jsonb_build_object(
      'kind', s ->> 'kind', 'place', s -> 'place', 'players', s -> 'players', 'prize', new.returned));
  end if;

  perform private.missions_ensure(new.user_id);
  select category into v_cat from public.games where key = new.game_key;

  with moved as (
    update public.player_missions m
       set progress = least(m.goal, m.progress + x.inc),
           meta = case when m.kind = 'games' and x.inc > 0
                       then jsonb_set(m.meta, '{seen}', coalesce(m.meta -> 'seen', '[]'::jsonb) || to_jsonb(new.game_key)) else m.meta end,
           completed_at = case when m.progress + x.inc >= m.goal then now() end
      from (select m2.slot, m2.period, m2.period_start,
                   case m2.kind
                     when 'rounds'   then 1
                     when 'wins'     then (new.returned > new.wagered)::integer
                     when 'wager'    then new.wagered
                     when 'category' then (v_cat = m2.param)::integer
                     when 'games'    then (not coalesce(m2.meta -> 'seen', '[]'::jsonb) ? new.game_key)::integer
                     when 'multiple' then (new.wagered > 0 and new.returned >= new.wagered * m2.param::bigint)::integer
                     when 'net'      then greatest(new.returned - new.wagered, 0)
                     when 'tourney'  then (new.game_key in ('sng_poker', 'slot_showdown'))::integer
                     else 0 end as inc
              from public.player_missions m2
             where m2.user_id = new.user_id and m2.completed_at is null
               and ((m2.period = 'daily' and m2.period_start = v_day) or (m2.period = 'weekly' and m2.period_start = v_week))) x
     where m.user_id = new.user_id and m.period = x.period and m.period_start = x.period_start and m.slot = x.slot and x.inc > 0
    returning m.period, m.completed_at)
  select count(*) filter (where completed_at is not null), count(*) filter (where completed_at is not null and period = 'weekly')
    into v_done, v_weekly from moved;

  if v_done > 0 then
    perform private.bump(new.user_id, 'missions_done', v_done);
    if v_weekly > 0 then
      perform private.bump(new.user_id, 'weeklies_done', v_weekly);
    end if;
    -- All three of today's, the last of them just now.
    if v_done > v_weekly and not exists (select 1 from public.player_missions
                    where user_id = new.user_id and period = 'daily' and period_start = v_day and completed_at is null) then
      perform private.bump(new.user_id, 'daily_sweeps');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists game_history_missions on public.game_history;
create trigger game_history_missions after insert on public.game_history
  for each row execute function private.on_round_missions();

-- Everything the Missions page shows: today's and this week's missions, and the season.
create or replace function public.missions_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_day date := private.live_day();
  v_week date := private.live_week();
  s jsonb := private.season_current();
  ps public.player_seasons;
  v_season jsonb := null;
begin
  perform private.missions_ensure(v_uid);
  perform private.season_sync();
  perform private.season_settle(v_uid);
  if s is not null then
    select * into ps from public.player_seasons where user_id = v_uid and season = s ->> 'key';
    -- Told once, when a new season opens.
    if not exists (select 1 from public.notifications where user_id = v_uid and kind = 'season_start' and data ->> 'key' = s ->> 'key') then
      perform private.notify(v_uid, 'season_start', jsonb_build_object('key', s ->> 'key', 'season', s ->> 'name'));
    end if;
    v_season := jsonb_build_object(
      'key', s ->> 'key', 'name', s ->> 'name', 'blurb', s ->> 'blurb', 'accent', s ->> 'accent',
      'ends_at', (date_trunc('month', private.live_now() at time zone 'utc') + interval '1 month') at time zone 'utc',
      'points', coalesce(ps.points, 0), 'claimed_tier', coalesce(ps.claimed_tier, 0),
      'tiers', (select jsonb_agg(t || jsonb_build_object('reward',
                         (select jsonb_build_object('key', c.key, 'kind', c.kind, 'name', c.name, 'look', c.look)
                            from public.cosmetics c where c.key = t ->> 'cosmetic')) order by (t ->> 'tier')::integer)
                  from jsonb_array_elements(private.season_tiers(s)) t));
  end if;
  return jsonb_build_object(
    'server_now', now(),
    'daily_ends_at', (v_day + 1)::timestamp at time zone 'utc',
    'weekly_ends_at', (v_week + 7)::timestamp at time zone 'utc',
    'missions', (select coalesce(jsonb_agg(jsonb_build_object(
                   'period', m.period, 'slot', m.slot, 'key', m.key, 'kind', m.kind, 'param', m.param, 'goal', m.goal, 'progress', m.progress,
                   'chips', m.reward_chips, 'xp', m.reward_xp, 'points', m.reward_points,
                   'done', m.completed_at is not null, 'claimed', m.claimed_at is not null) order by m.period, m.slot), '[]'::jsonb)
                   from public.player_missions m
                  where m.user_id = v_uid and ((m.period = 'daily' and m.period_start = v_day) or (m.period = 'weekly' and m.period_start = v_week))),
    -- Finished missions waiting to be collected (the last two weeks' count too).
    'to_collect', (select count(*) from public.player_missions m
                    where m.user_id = v_uid and m.completed_at is not null and m.claimed_at is null and m.period_start > v_day - 14),
    'season', v_season);
end $$;

-- Collects every finished mission: chips, XP and season points.
create or replace function public.missions_claim()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_chips bigint;
  v_xp bigint;
  v_points integer;
  v_n integer;
  v_balance bigint;
begin
  with c as (
    update public.player_missions set claimed_at = now()
     where user_id = v_uid and completed_at is not null and claimed_at is null and period_start > private.live_day() - 14
    returning reward_chips, reward_xp, reward_points)
  select coalesce(sum(reward_chips), 0), coalesce(sum(reward_xp), 0), coalesce(sum(reward_points), 0), count(*)
    into v_chips, v_xp, v_points, v_n from c;
  if v_n = 0 then
    raise exception 'action_not_allowed' using hint = 'No finished missions to collect.';
  end if;
  v_balance := private.apply_chips(v_uid, v_chips, 'mission', null, null, jsonb_build_object('missions', v_n));
  insert into public.player_progress (user_id) values (v_uid) on conflict (user_id) do nothing;
  perform private.add_xp(v_uid, v_xp);
  perform private.season_add(v_uid, v_points);
  perform private.check_achievements(v_uid);
  return jsonb_build_object('missions', v_n, 'chips', v_chips, 'xp', v_xp, 'points', v_points, 'balance', v_balance);
end $$;

-- Collects every season tier reached so far (this month's season only).
create or replace function public.season_claim()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s jsonb := private.season_current();
  g jsonb;
begin
  if s is null then
    raise exception 'action_not_allowed' using hint = 'There is no season running.';
  end if;
  perform private.season_sync();
  g := private.season_grant(v_uid, s);
  if (g ->> 'tiers')::integer = 0 then
    raise exception 'action_not_allowed' using hint = 'Nothing to collect yet. Finish missions to earn season points.';
  end if;
  return g || jsonb_build_object('balance', (select balance from public.wallets where user_id = v_uid));
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.inbox()', 'public.inbox_read(bigint[])', 'public.inbox_clear(bigint)', 'public.invite_friend(uuid)',
    'public.missions_state()', 'public.missions_claim()', 'public.season_claim()'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security: all three are the player's own rows, read-only.
-- -----------------------------------------------------------------------------
alter table public.player_missions enable row level security;
alter table public.player_seasons  enable row level security;
alter table public.notifications   enable row level security;

drop policy if exists "player_missions: own rows" on public.player_missions;
create policy "player_missions: own rows" on public.player_missions for select to authenticated using (user_id = auth.uid());
drop policy if exists "player_seasons: own rows" on public.player_seasons;
create policy "player_seasons: own rows" on public.player_seasons for select to authenticated using (user_id = auth.uid());
drop policy if exists "notifications: own rows" on public.notifications;
create policy "notifications: own rows" on public.notifications for select to authenticated using (user_id = auth.uid());

revoke all on public.player_missions, public.player_seasons, public.notifications from anon;
revoke insert, update, delete, truncate on public.player_missions, public.player_seasons, public.notifications from authenticated;
grant select on public.player_missions, public.player_seasons, public.notifications to authenticated;

select private.add_to_realtime('notifications');
select private.add_to_realtime('player_missions');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

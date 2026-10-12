-- =============================================================================
-- All In · 17_clubs_records.sql
-- Stage 9, part 3: clubs, head-to-head records, the big-win ticker and personal records.
-- Run AFTER 01-16 (re-run 13_progression.sql first: its achievements and the
-- leaderboard's ban filter are there). Safe to re-run.
--
--   * clubs, club_members   a club has a name, a short tag and a preset emblem: the
--                           only typed text. One club per player, up to 50 members.
--   * head_to_head          wins between two players at poker tables and Sit & Gos
--                           (hidden; read through profile_extras).
--   * big_wins              the lounge's ticker: the last 40 big wins.
-- A third trigger on game_history fills the last two, so no game file changes.
-- =============================================================================

create table if not exists public.clubs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9 ]{1,22}[A-Za-z0-9]$' and name !~ '  '),
  tag          text not null check (tag ~ '^[A-Z0-9]{2,5}$'),
  emblem       text not null default 'spade'
               check (emblem in ('spade', 'heart', 'diamond', 'club', 'crown', 'dice', 'star', 'fire', 'clover', 'rocket', 'shield', 'gem')),
  is_open      boolean not null default true,
  invite_code  text not null unique,
  owner        uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
-- Whether ordinary members and officers may see the invite code, or only the owner.
alter table public.clubs add column if not exists code_visible boolean not null default true;
create unique index if not exists clubs_name_key on public.clubs (lower(name));
create unique index if not exists clubs_tag_key on public.clubs (tag);

create table if not exists public.club_members (
  club_id    uuid not null references public.clubs (id) on delete cascade,
  -- One club per player.
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'officer', 'member')),
  joined_at  timestamptz not null default now()
);
create index if not exists club_members_club_idx on public.club_members (club_id);

create table if not exists public.head_to_head (
  a           uuid not null references auth.users (id) on delete cascade,
  b           uuid not null references auth.users (id) on delete cascade,
  hands_a     integer not null default 0,
  hands_b     integer not null default 0,
  tourney_a   integer not null default 0,
  tourney_b   integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
create index if not exists head_to_head_b_idx on public.head_to_head (b);

create table if not exists public.big_wins (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('round', 'tournament')),
  game_key    text not null,
  amount      bigint not null,
  -- times the bet, for rounds
  multiple    numeric,
  created_at  timestamptz not null default now()
);

create index if not exists game_history_round_idx on public.game_history (round_id) where round_id is not null;

-- -----------------------------------------------------------------------------
-- After every finished round: head-to-head and the big-win ticker
-- -----------------------------------------------------------------------------
create or replace function private.h2h_add(p_winner uuid, p_loser uuid, p_tourney boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a uuid := least(p_winner, p_loser);
  v_b uuid := greatest(p_winner, p_loser);
  v_first boolean := p_winner = v_a;
  v_wins integer;
begin
  insert into public.head_to_head as h (a, b, hands_a, hands_b, tourney_a, tourney_b)
  values (v_a, v_b,
          (not p_tourney and v_first)::integer, (not p_tourney and not v_first)::integer,
          (p_tourney and v_first)::integer, (p_tourney and not v_first)::integer)
  on conflict (a, b) do update set
    hands_a = h.hands_a + excluded.hands_a, hands_b = h.hands_b + excluded.hands_b,
    tourney_a = h.tourney_a + excluded.tourney_a, tourney_b = h.tourney_b + excluded.tourney_b, updated_at = now()
  returning case when v_first then hands_a else hands_b end into v_wins;
  -- The most poker hands won against any one player (the Nemesis achievement).
  if not p_tourney then
    insert into public.player_progress (user_id) values (p_winner) on conflict (user_id) do nothing;
    update public.player_progress
       set counters = jsonb_set(counters, '{h2h_best}', to_jsonb(greatest(coalesce((counters ->> 'h2h_best')::integer, 0), v_wins)))
     where user_id = p_winner;
  end if;
end $$;

create or replace function private.on_round_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_place integer;
begin
  -- Poker hands: a player who came out ahead beat every player who came out behind.
  -- Rows for one hand arrive one by one, so each pair is settled when its second row lands.
  if new.round_id is not null and new.table_id is not null and (new.game_key like 'poker\_%' or new.game_key = 'teen_patti_live') then
    for o in select user_id, wagered, returned from public.game_history
              where round_id = new.round_id and game_key = new.game_key and user_id <> new.user_id and id <> new.id loop
      if new.returned > new.wagered and o.returned < o.wagered then
        perform private.h2h_add(new.user_id, o.user_id, false);
      elsif new.returned < new.wagered and o.returned > o.wagered then
        perform private.h2h_add(o.user_id, new.user_id, false);
      end if;
    end loop;
  elsif new.game_key = 'sng_poker' and new.round_id is not null then
    v_place := (new.summary ->> 'place')::integer;
    for o in select user_id, (summary ->> 'place')::integer as place from public.game_history
              where round_id = new.round_id and game_key = 'sng_poker' and user_id <> new.user_id and id <> new.id loop
      if v_place < o.place then
        perform private.h2h_add(new.user_id, o.user_id, true);
      elsif v_place > o.place then
        perform private.h2h_add(o.user_id, new.user_id, true);
      end if;
    end loop;
  end if;

  -- The ticker: 25 times the bet and at least 2,500 won, or a tournament win worth 1,000 or more.
  if not private.is_banned(new.user_id) then
    if new.game_key in ('sng_poker', 'slot_showdown') then
      if (new.summary ->> 'place')::integer = 1 and (new.summary ->> 'players')::integer >= 2 and new.returned >= 1000 then
        insert into public.big_wins (user_id, kind, game_key, amount) values (new.user_id, 'tournament', new.game_key, new.returned);
        perform private.bump(new.user_id, 'big_wins');
      end if;
    elsif new.wagered > 0 and new.returned >= new.wagered * 25 and new.returned - new.wagered >= 2500 then
      insert into public.big_wins (user_id, kind, game_key, amount, multiple)
      values (new.user_id, 'round', new.game_key, new.returned, round(new.returned::numeric / new.wagered, 1));
      perform private.bump(new.user_id, 'big_wins');
    end if;
    delete from public.big_wins where id <= (select max(id) from public.big_wins) - 40;
  end if;
  return new;
end $$;

drop trigger if exists game_history_records on public.game_history;
create trigger game_history_records after insert on public.game_history
  for each row execute function private.on_round_records();

-- The ticker, with each winner's current name and look.
create or replace function public.big_wins_recent()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', w.id, 'username', p.username, 'kind', w.kind, 'game_key', w.game_key,
           'game', (select name from public.games where key = w.game_key),
           'amount', w.amount, 'multiple', w.multiple, 'at', w.created_at) order by w.id desc), '[]'::jsonb)
    from (select * from public.big_wins order by id desc limit 15) w
    join public.profiles p on p.id = w.user_id
   where auth.uid() is not null and not private.is_banned(w.user_id)
$$;

-- -----------------------------------------------------------------------------
-- Clubs
-- -----------------------------------------------------------------------------
create or replace function private.club_json(c public.clubs)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'tag', c.tag, 'emblem', c.emblem, 'is_open', c.is_open, 'code_visible', c.code_visible, 'created_at', c.created_at,
    'members', (select count(*) from public.club_members m where m.club_id = c.id),
    -- Rounds its members have played this week: how clubs are ranked.
    'week_rounds', (select coalesce(sum(w.rounds), 0) from public.club_members m
                      join public.weekly_stats w on w.user_id = m.user_id and w.week_start = date_trunc('week', now() at time zone 'utc')::date
                     where m.club_id = c.id))
$$;

-- A player's club, as shown next to their name ({id, name, tag, emblem} or null).
create or replace function private.club_of(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'tag', c.tag, 'emblem', c.emblem)
    from public.club_members m join public.clubs c on c.id = m.club_id where m.user_id = p_user
$$;

-- The busiest clubs this week, or a search by name or tag.
create or replace function public.clubs_list(p_query text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_q text := lower(btrim(coalesce(p_query, '')));
begin
  return (select coalesce(jsonb_agg(x.j order by (x.j ->> 'week_rounds')::bigint desc, (x.j ->> 'members')::integer desc, x.j ->> 'name'), '[]'::jsonb)
            from (select private.club_json(c) as j from public.clubs c
                   where v_q = '' or lower(c.name) like '%' || replace(replace(v_q, '%', ''), '_', '') || '%' or lower(c.tag) = v_q
                   limit 200) x
           where true limit 1);
end $$;

-- One club: its members and this week's scores. p_club null = your own (null if you have none).
create or replace function public.club_state(p_club uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_week date := date_trunc('week', now() at time zone 'utc')::date;
  v_id uuid := coalesce(p_club, (select club_id from public.club_members where user_id = v_uid));
  c public.clubs;
  v_role text;
begin
  if v_id is null then
    return null;
  end if;
  select * into c from public.clubs where id = v_id;
  if not found then
    raise exception 'club_not_found';
  end if;
  select role into v_role from public.club_members where club_id = c.id and user_id = v_uid;
  return private.club_json(c) || jsonb_build_object(
    'my_role', v_role,
    'my_club', (select club_id from public.club_members where user_id = v_uid),
    -- The code that lets someone into a closed club: the owner always sees it, other members
    -- only if the owner allows it, and outsiders never.
    'invite_code', case when v_role = 'owner' or (v_role is not null and c.code_visible) then c.invite_code end,
    'roster', (select coalesce(jsonb_agg(private.player_card(m.user_id) || jsonb_build_object(
                  'role', m.role, 'joined_at', m.joined_at,
                  'week_rounds', coalesce(w.rounds, 0), 'week_net', coalesce(w.returned - w.wagered, 0),
                  'table', (select jsonb_build_object('id', t.id, 'name', t.name, 'game_key', t.game_key)
                              from public.table_seats s join public.game_tables t on t.id = s.table_id
                             where s.user_id = m.user_id and not t.is_private and not t.play_money and t.status = 'open' limit 1))
                  order by case m.role when 'owner' then 0 when 'officer' then 1 else 2 end, coalesce(w.rounds, 0) desc, m.joined_at), '[]'::jsonb)
                 from public.club_members m
                 left join public.weekly_stats w on w.user_id = m.user_id and w.week_start = v_week
                where m.club_id = c.id));
end $$;

create or replace function public.club_create(p_name text, p_tag text, p_emblem text default 'spade', p_open boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_tag text := upper(btrim(coalesce(p_tag, '')));
  c public.clubs;
begin
  if exists (select 1 from public.club_members where user_id = v_uid) then
    raise exception 'action_not_allowed' using hint = 'You are already in a club. Leave it first.';
  end if;
  if v_name !~ '^[A-Za-z0-9][A-Za-z0-9 ]{1,22}[A-Za-z0-9]$' then
    raise exception 'action_not_allowed' using hint = 'Club names are 3 to 24 letters, numbers and spaces.';
  end if;
  if v_tag !~ '^[A-Z0-9]{2,5}$' then
    raise exception 'action_not_allowed' using hint = 'Tags are 2 to 5 letters or numbers.';
  end if;
  -- Official-sounding names (All In, Staff, Admin, ...) are kept for the admin's own clubs.
  if not private.is_admin(v_uid) and (private.username_is_reserved(replace(v_name, ' ', '')) or private.username_is_reserved(v_tag)) then
    raise exception 'action_not_allowed' using hint = 'That name is not available.';
  end if;
  if exists (select 1 from public.clubs where lower(name) = lower(v_name)) then
    raise exception 'action_not_allowed' using hint = 'A club already has that name.';
  end if;
  if exists (select 1 from public.clubs where tag = v_tag) then
    raise exception 'action_not_allowed' using hint = 'A club already has that tag.';
  end if;
  insert into public.clubs (name, tag, emblem, is_open, invite_code, owner)
  values (v_name, v_tag, coalesce(p_emblem, 'spade'), coalesce(p_open, true), private.random_code(6), v_uid)
  returning * into c;
  insert into public.club_members (club_id, user_id, role) values (c.id, v_uid, 'owner');
  perform private.bump(v_uid, 'clubs_joined');
  perform private.bump(v_uid, 'clubs_founded');
  perform private.check_achievements(v_uid);
  return jsonb_build_object('id', c.id);
exception when check_violation then
  raise exception 'action_not_allowed' using hint = 'Pick one of the emblems on offer.';
end $$;

-- Join an open club, or a closed one with its code. p_club may be null when a code is given.
create or replace function public.club_join(p_club uuid default null, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  c public.clubs;
begin
  if exists (select 1 from public.club_members where user_id = v_uid) then
    raise exception 'action_not_allowed' using hint = 'You are already in a club. Leave it first.';
  end if;
  if p_club is not null then
    select * into c from public.clubs where id = p_club for update;
  else
    select * into c from public.clubs where invite_code = v_code for update;
  end if;
  if not found then
    raise exception 'club_not_found';
  end if;
  if not c.is_open and c.invite_code <> v_code then
    raise exception 'action_not_allowed' using hint = 'This club is invite only. Ask a member for its code.';
  end if;
  if (select count(*) from public.club_members where club_id = c.id) >= 50 then
    raise exception 'action_not_allowed' using hint = 'This club is full.';
  end if;
  insert into public.club_members (club_id, user_id) values (c.id, v_uid);
  if c.owner is not null then
    perform private.notify(c.owner, 'club_joined', jsonb_build_object('from', (select username from public.profiles where id = v_uid), 'club', c.name));
  end if;
  perform private.bump(v_uid, 'clubs_joined');
  perform private.check_achievements(v_uid);
  return jsonb_build_object('id', c.id);
end $$;

-- Takes a member out. An owner who goes hands the club to the longest-serving officer,
-- else member; the last one out closes it.
create or replace function private.club_remove(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.club_members;
  v_heir uuid;
begin
  delete from public.club_members where user_id = p_user returning * into m;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.club_members where club_id = m.club_id) then
    delete from public.clubs where id = m.club_id;
  elsif m.role = 'owner' then
    select user_id into v_heir from public.club_members where club_id = m.club_id
     order by case role when 'officer' then 0 else 1 end, joined_at limit 1;
    update public.club_members set role = 'owner' where user_id = v_heir;
    update public.clubs set owner = v_heir where id = m.club_id;
    perform private.notify(v_heir, 'club_role', jsonb_build_object('role', 'owner', 'club', (select name from public.clubs where id = m.club_id)));
  end if;
end $$;

create or replace function public.club_leave()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.club_remove(v_uid);
end $$;

-- Owners can remove anyone; officers can remove ordinary members.
create or replace function public.club_kick(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  me public.club_members;
  them public.club_members;
begin
  select * into me from public.club_members where user_id = v_uid;
  select * into them from public.club_members where user_id = p_user;
  if me.club_id is null or them.club_id is distinct from me.club_id or p_user = v_uid
     or not (me.role = 'owner' or (me.role = 'officer' and them.role = 'member')) then
    raise exception 'action_not_allowed' using hint = 'You can''t remove that member.';
  end if;
  perform private.notify(p_user, 'club_removed', jsonb_build_object('club', (select name from public.clubs where id = me.club_id)));
  perform private.club_remove(p_user);
end $$;

-- The owner makes a member an officer, an officer a member again, or hands over the club ('owner').
create or replace function public.club_set_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  me public.club_members;
begin
  select * into me from public.club_members where user_id = v_uid;
  if me.role is distinct from 'owner' or p_user = v_uid or p_role not in ('owner', 'officer', 'member')
     or not exists (select 1 from public.club_members where user_id = p_user and club_id = me.club_id) then
    raise exception 'action_not_allowed' using hint = 'Only the owner can change roles.';
  end if;
  if p_role = 'owner' then
    update public.club_members set role = 'officer' where user_id = v_uid;
    update public.clubs set owner = p_user where id = me.club_id;
  end if;
  update public.club_members set role = p_role where user_id = p_user;
  perform private.notify(p_user, 'club_role', jsonb_build_object('role', p_role, 'club', (select name from public.clubs where id = me.club_id)));
end $$;

-- The owner's settings: open to all or invite only, the emblem, and whether members may see the invite code.
drop function if exists public.club_update(boolean, text);
create or replace function public.club_update(p_open boolean default null, p_emblem text default null, p_code_visible boolean default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  update public.clubs set is_open = coalesce(p_open, is_open), emblem = coalesce(p_emblem, emblem),
         code_visible = coalesce(p_code_visible, code_visible)
   where id = (select club_id from public.club_members where user_id = v_uid and role = 'owner');
  if not found then
    raise exception 'action_not_allowed' using hint = 'Only the owner can change the club.';
  end if;
exception when check_violation then
  raise exception 'action_not_allowed' using hint = 'Pick one of the emblems on offer.';
end $$;

-- Admin: every club, renaming one (a rude name) and closing one.
create or replace function public.admin_clubs(p_query text default '')
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
  return (select coalesce(jsonb_agg(private.club_json(c) || jsonb_build_object('owner', (select username from public.profiles where id = c.owner), 'owner_id', c.owner)
                                    order by c.created_at desc), '[]'::jsonb)
            from public.clubs c where v_q = '' or lower(c.name) like '%' || replace(v_q, '%', '') || '%' or lower(c.tag) = v_q);
end $$;

create or replace function public.admin_club_rename(p_club uuid, p_name text, p_tag text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.clubs;
begin
  perform private.require_admin();
  select * into v_old from public.clubs where id = p_club;
  if not found then
    raise exception 'club_not_found';
  end if;
  update public.clubs set name = btrim(p_name), tag = upper(btrim(p_tag)) where id = p_club;
  perform private.admin_note('club_rename', v_old.owner, jsonb_build_object('from', v_old.name, 'to', p_name, 'tag_from', v_old.tag, 'tag_to', p_tag));
exception
  when check_violation then raise exception 'action_not_allowed' using hint = 'Names are 3 to 24 letters, numbers and spaces; tags 2 to 5 letters or numbers.';
  when unique_violation then raise exception 'action_not_allowed' using hint = 'Another club has that name or tag.';
end $$;

create or replace function public.admin_club_delete(p_club uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.clubs;
begin
  perform private.require_admin();
  delete from public.clubs where id = p_club returning * into v_old;
  if not found then
    raise exception 'club_not_found';
  end if;
  perform private.admin_note('club_delete', v_old.owner, jsonb_build_object('name', v_old.name, 'tag', v_old.tag));
end $$;

-- -----------------------------------------------------------------------------
-- What the profile page adds to get_profile: club, records, head-to-head
-- -----------------------------------------------------------------------------
create or replace function public.profile_extras(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_id uuid;
  c jsonb;
  h public.head_to_head;
begin
  select id into v_id from public.profiles where lower(username) = lower(btrim(p_username));
  if v_id is null then
    raise exception 'player_not_found';
  end if;
  select coalesce(counters, '{}'::jsonb) into c from public.player_progress where user_id = v_id;
  c := coalesce(c, '{}'::jsonb);
  if v_id <> v_uid then
    select * into h from public.head_to_head where a = least(v_uid, v_id) and b = greatest(v_uid, v_id);
  end if;
  return jsonb_build_object(
    'club', private.club_of(v_id),
    'records', jsonb_build_object(
      'peak_balance', (select peak_balance from public.wallets where user_id = v_id),
      'best_multiple', coalesce((c ->> 'max_multiple')::numeric, 0),
      'best_streak', coalesce((c ->> 'best_streak')::integer, 0),
      'tournaments', coalesce((c ->> 'tourney_played')::integer, 0),
      'tournament_wins', coalesce((c ->> 'tourney_wins')::integer, 0),
      'missions', coalesce((c ->> 'missions_done')::integer, 0),
      'season_rewards', coalesce((c ->> 'season_tiers')::integer, 0),
      'favourite', (select jsonb_build_object('name', g.name, 'rounds', s.rounds_played)
                      from public.player_game_stats s join public.games g on g.key = s.game_key
                     where s.user_id = v_id and s.rounds_played > 0 order by s.rounds_played desc limit 1),
      'best_games', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'biggest_win', x.biggest_win) order by x.biggest_win desc), '[]'::jsonb)
                       from (select g.name, s.biggest_win from public.player_game_stats s join public.games g on g.key = s.game_key
                              where s.user_id = v_id and s.biggest_win > 0 order by s.biggest_win desc limit 5) x),
      'poker_hands_won', (select coalesce(sum(case when hh.a = v_id then hh.hands_a else hh.hands_b end), 0)
                            from public.head_to_head hh where v_id in (hh.a, hh.b))),
    -- You against them (only on someone else's profile).
    'versus', case when v_id <> v_uid then jsonb_build_object(
                'hands_me', coalesce(case when h.a = v_uid then h.hands_a else h.hands_b end, 0),
                'hands_them', coalesce(case when h.a = v_uid then h.hands_b else h.hands_a end, 0),
                'tourney_me', coalesce(case when h.a = v_uid then h.tourney_a else h.tourney_b end, 0),
                'tourney_them', coalesce(case when h.a = v_uid then h.tourney_b else h.tourney_a end, 0)) end,
    -- The players you have met most (only on your own profile).
    'rivals', case when v_id = v_uid then (
                select coalesce(jsonb_agg(x.j order by x.n desc), '[]'::jsonb) from (
                  select (hh.hands_a + hh.hands_b + hh.tourney_a + hh.tourney_b) as n,
                         private.player_card(case when hh.a = v_uid then hh.b else hh.a end) || jsonb_build_object(
                           'won', case when hh.a = v_uid then hh.hands_a + hh.tourney_a else hh.hands_b + hh.tourney_b end,
                           'lost', case when hh.a = v_uid then hh.hands_b + hh.tourney_b else hh.hands_a + hh.tourney_a end) as j
                    from public.head_to_head hh where v_uid in (hh.a, hh.b)
                   order by 1 desc limit 5) x) end);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.big_wins_recent()', 'public.clubs_list(text)', 'public.club_state(uuid)', 'public.club_create(text, text, text, boolean)',
    'public.club_join(uuid, text)', 'public.club_leave()', 'public.club_kick(uuid)', 'public.club_set_role(uuid, text)',
    'public.club_update(boolean, text, boolean)', 'public.admin_clubs(text)', 'public.admin_club_rename(uuid, text, text)',
    'public.admin_club_delete(uuid)', 'public.profile_extras(text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security. Clubs and the ticker are public to signed-in players (the
-- invite code is not: the column is withheld); head-to-head is read through RPCs only.
-- -----------------------------------------------------------------------------
alter table public.clubs         enable row level security;
alter table public.club_members  enable row level security;
alter table public.head_to_head  enable row level security;
alter table public.big_wins      enable row level security;

drop policy if exists "clubs: signed-in players can read" on public.clubs;
create policy "clubs: signed-in players can read" on public.clubs for select to authenticated using (true);
drop policy if exists "club_members: signed-in players can read" on public.club_members;
create policy "club_members: signed-in players can read" on public.club_members for select to authenticated using (true);
drop policy if exists "big_wins: signed-in players can read" on public.big_wins;
create policy "big_wins: signed-in players can read" on public.big_wins for select to authenticated using (true);

revoke all on public.clubs, public.club_members, public.head_to_head, public.big_wins from anon, authenticated;
grant select (id, name, tag, emblem, is_open, code_visible, owner, created_at) on public.clubs to authenticated;
grant select on public.club_members, public.big_wins to authenticated;

select private.add_to_realtime('big_wins');
select private.add_to_realtime('club_members');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

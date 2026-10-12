-- =============================================================================
-- All In: a head start on the October 2026 season (Fright Night).
-- Run once by hand in the Supabase SQL Editor, AFTER 16_missions_seasons.sql.
-- Safe to re-run: nobody is ever given the points twice.
--
-- The season pass arrived part-way through the month, so:
--   * every account that exists now gets 333 season points, and
--   * every account created up to the end of 31 October (UTC) gets them too,
--     the moment it is created.
-- Season months are counted in UTC, so the cut-off is the instant the season ends.
-- Each player also gets a note in their inbox.
--
-- 333 points is past the third step of the track (200) and a third of the way to
-- the end (1,000). Points only make rewards collectable: nothing is collected for
-- the player, and no chips move here.
-- =============================================================================

-- Who has had the points (hidden from clients; only this file reads it).
create table if not exists public.season_gifts (
  user_id     uuid not null references auth.users (id) on delete cascade,
  season      text not null,
  points      integer not null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, season)
);
alter table public.season_gifts enable row level security;
revoke all on public.season_gifts from anon, authenticated;

create or replace function private.season_gift_2026_10(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if now() >= timestamptz '2026-11-01 00:00:00+00' then
    return;
  end if;
  insert into public.season_gifts (user_id, season, points) values (p_user, '2026-10', 333)
  on conflict (user_id, season) do nothing;
  if not found then
    return;  -- already given
  end if;
  insert into public.player_seasons as ps (user_id, season, points) values (p_user, '2026-10', 333)
  on conflict (user_id, season) do update set points = ps.points + 333, updated_at = now();
  perform private.notify(p_user, 'season_gift', jsonb_build_object('points', 333, 'season', 'Fright Night'));
end $$;

-- New accounts, until the season ends.
create or replace function private.season_gift_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.season_gift_2026_10(new.id);
  return new;
end $$;

drop trigger if exists profiles_season_gift on public.profiles;
create trigger profiles_season_gift after insert on public.profiles
  for each row execute function private.season_gift_on_signup();

-- Everyone who has an account already.
select private.season_gift_2026_10(p.id) from public.profiles p;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

-- What happened.
select count(*) as players_with_the_head_start,
       (select count(*) from public.profiles) as accounts
  from public.season_gifts where season = '2026-10';

-- After 31 October this trigger does nothing. To remove it then:
--   drop trigger if exists profiles_season_gift on public.profiles;

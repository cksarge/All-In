-- =============================================================================
-- All In · 01_profiles.sql
-- Player profiles, username rules, and the shared `private` helper schema.
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run.
-- =============================================================================

-- Internal helpers live in `private`. This schema is NOT exposed through the
-- Supabase API, and anon/authenticated get no access to it. Public RPCs are
-- SECURITY DEFINER functions that call into it.
create schema if not exists private;
revoke all on schema private from public;
-- New functions in `private` are not executable by default (Postgres grants
-- EXECUTE to PUBLIC otherwise).
alter default privileges in schema private revoke execute on functions from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema private from authenticated';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  onboarded_at  timestamptz,
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,16}$')
);

-- Usernames are unique regardless of case ("Ace" and "ace" collide).
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

comment on table public.profiles is
  'One row per player. Created automatically by the on_auth_user_created trigger (see 02_economy.sql).';

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Username rules
-- -----------------------------------------------------------------------------
create or replace function private.username_is_reserved(p_username text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(p_username) = any (array[
    'admin', 'administrator', 'allin', 'all_in', 'dealer', 'house', 'system',
    'moderator', 'mod', 'support', 'staff', 'official', 'root', 'null',
    'undefined', 'anonymous', 'casino', 'bank', 'cashier', 'pitboss'
  ]);
$$;

-- Returns one of: 'ok' | 'invalid' | 'reserved' | 'taken'.
-- Callable before sign-up (anon) so the form can check live.
create or replace function public.check_username(p_username text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,16}$' then
    return 'invalid';
  end if;
  if private.username_is_reserved(p_username) then
    return 'reserved';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(p_username)) then
    return 'taken';
  end if;
  return 'ok';
end $$;

revoke all on function public.check_username(text) from public;
grant execute on function public.check_username(text) to anon, authenticated;

-- Marks the first-time tour as seen.
create or replace function public.complete_onboarding()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.profiles
     set onboarded_at = coalesce(onboarded_at, now())
   where id = auth.uid();
end $$;

revoke all on function public.complete_onboarding() from public, anon;
grant execute on function public.complete_onboarding() to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- Profiles hold only public info (no email). Signed-in players can see all
-- profiles; nobody can write them directly. Changes go through RPCs.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles: signed-in players can read" on public.profiles;
create policy "profiles: signed-in players can read"
  on public.profiles for select
  to authenticated
  using (true);

-- Defence in depth: even if a policy is added by mistake, clients cannot write.
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

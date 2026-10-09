-- =============================================================================
-- All In · 02_economy.sql
-- Play-chip economy: wallets, the chip ledger, starting chips, the free daily
-- bonus (with streak multiplier) and the free refill.
--
-- All In is a free game. No real money is ever used. Chips have no cash value
-- and can never be bought, sold, transferred, or redeemed.
--
-- Rules enforced here:
--   * Clients can READ their own wallet and ledger. They can never write them.
--   * Every chip change goes through private.apply_chips(), which writes a
--     ledger row in the same transaction.
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- economy_config: single-row table of tunable numbers. Public read so the UI
-- can display the real values instead of hard-coding them.
-- -----------------------------------------------------------------------------
create table if not exists public.economy_config (
  id                   boolean primary key default true check (id),
  starting_chips       bigint     not null default 10000 check (starting_chips >= 0),
  daily_base           bigint     not null default 1000  check (daily_base > 0),
  -- Multiplier for streak day 1, 2, 3, ... The last entry applies to every day after.
  daily_multipliers    numeric[]  not null default array[1, 1.25, 1.5, 1.75, 2, 2.5, 3]::numeric[],
  refill_threshold     bigint     not null default 1000  check (refill_threshold >= 0),
  refill_to            bigint     not null default 5000  check (refill_to > 0),
  refill_cooldown      interval   not null default interval '4 hours',
  updated_at           timestamptz not null default now(),
  constraint economy_config_refill_sane check (refill_to > refill_threshold),
  constraint economy_config_multipliers_nonempty check (cardinality(daily_multipliers) > 0)
);

insert into public.economy_config (id) values (true)
on conflict (id) do nothing;

comment on table public.economy_config is
  'Single row of economy settings. Edit values here (as an admin, in the SQL editor) to tune the economy.';

-- -----------------------------------------------------------------------------
-- wallets: one per player. Balance is the player's play chips.
-- -----------------------------------------------------------------------------
create table if not exists public.wallets (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  balance           bigint not null default 0 check (balance >= 0),
  peak_balance      bigint not null default 0 check (peak_balance >= 0),
  daily_streak      integer not null default 0 check (daily_streak >= 0),
  last_daily_claim  date,
  last_refill_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.wallets is
  'Play-chip balance per player. Read-only for clients; written only by server functions.';

-- -----------------------------------------------------------------------------
-- chip_ledger: append-only record of EVERY chip change, with a reason.
-- -----------------------------------------------------------------------------
create table if not exists public.chip_ledger (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  delta          bigint not null check (delta <> 0),
  balance_after  bigint not null check (balance_after >= 0),
  -- e.g. signup_bonus, daily_bonus, refill, bet, payout, refund, table_sit, table_leave
  reason         text not null check (reason ~ '^[a-z][a-z0-9_]{1,40}$'),
  game           text,
  ref_id         text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists chip_ledger_user_created_idx
  on public.chip_ledger (user_id, created_at desc);
create index if not exists chip_ledger_created_idx
  on public.chip_ledger (created_at desc);

comment on table public.chip_ledger is
  'Append-only history of every play-chip change. Read-only for clients (own rows only).';

-- -----------------------------------------------------------------------------
-- Internal helpers (private schema: not callable from the browser)
-- -----------------------------------------------------------------------------

-- Chips a player currently has committed at tables (seated stacks, unresolved
-- bets). Later files (06_blackjack.sql, ...) replace this with the real sum so a
-- player with chips on a table can't claim a refill. Only created here if it
-- doesn't exist yet, so re-running this file never resets the later version.
do $$
begin
  if to_regprocedure('private.chips_in_play(uuid)') is null then
    execute $f$
      create function private.chips_in_play(p_user uuid)
      returns bigint
      language sql
      stable
      set search_path = ''
      as 'select 0::bigint'
    $f$;
  end if;
end $$;

-- THE ONLY way chips change. Atomically updates the wallet and writes the
-- ledger row. Raises 'insufficient_chips' instead of going negative.
create or replace function private.apply_chips(
  p_user    uuid,
  p_delta   bigint,
  p_reason  text,
  p_game    text  default null,
  p_ref_id  text  default null,
  p_meta    jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  if p_delta is null then
    raise exception 'invalid_amount';
  end if;

  if p_delta = 0 then
    select balance into v_balance from public.wallets where user_id = p_user;
    if not found then
      raise exception 'wallet_not_found';
    end if;
    return v_balance;
  end if;

  update public.wallets
     set balance      = balance + p_delta,
         peak_balance = greatest(peak_balance, balance + p_delta),
         updated_at   = now()
   where user_id = p_user
     and balance + p_delta >= 0
  returning balance into v_balance;

  if not found then
    if exists (select 1 from public.wallets where user_id = p_user) then
      raise exception 'insufficient_chips'
        using hint = 'Not enough play chips for that.';
    end if;
    raise exception 'wallet_not_found';
  end if;

  insert into public.chip_ledger (user_id, delta, balance_after, reason, game, ref_id, metadata)
  values (p_user, p_delta, v_balance, p_reason, p_game, p_ref_id, coalesce(p_meta, '{}'::jsonb));

  return v_balance;
end $$;

revoke all on function private.apply_chips(uuid, bigint, text, text, text, jsonb) from public;

create or replace function private.utc_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'utc')::date;
$$;

-- Daily bonus for a given streak day (1-based) using the current config.
create or replace function private.daily_bonus_amount(p_day integer)
returns bigint
language sql
stable
set search_path = ''
as $$
  select round(
           c.daily_base
           * c.daily_multipliers[least(greatest(p_day, 1), cardinality(c.daily_multipliers))]
         )::bigint
    from public.economy_config c
   where c.id;
$$;

create or replace function private.daily_multiplier(p_day integer)
returns numeric
language sql
stable
set search_path = ''
as $$
  select c.daily_multipliers[least(greatest(p_day, 1), cardinality(c.daily_multipliers))]
    from public.economy_config c
   where c.id;
$$;

-- -----------------------------------------------------------------------------
-- New player trigger: profile + wallet + starting chips, all in one transaction.
-- Username comes from sign-up metadata: options.data.username.
-- -----------------------------------------------------------------------------
create or replace function private.generate_username()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_name text;
begin
  loop
    v_name := 'player_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    exit when not exists (select 1 from public.profiles where lower(username) = lower(v_name));
  end loop;
  return v_name;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := nullif(btrim(new.raw_user_meta_data ->> 'username'), '');
  v_start    bigint;
begin
  if v_username is null then
    -- Users created from the dashboard have no username: give them a placeholder.
    v_username := private.generate_username();
  elsif v_username !~ '^[A-Za-z0-9_]{3,16}$' or private.username_is_reserved(v_username) then
    raise exception 'invalid_username' using errcode = '22023';
  elsif exists (select 1 from public.profiles where lower(username) = lower(v_username)) then
    raise exception 'username_taken' using errcode = '23505';
  end if;

  insert into public.profiles (id, username) values (new.id, v_username);
  insert into public.wallets (user_id) values (new.id);

  select starting_chips into v_start from public.economy_config where id;
  if coalesce(v_start, 0) > 0 then
    perform private.apply_chips(new.id, v_start, 'signup_bonus', null, null,
                                jsonb_build_object('note', 'Welcome to All In'));
  end if;

  return new;
end $$;

revoke all on function public.handle_new_user() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.handle_new_user() from anon, authenticated';
  end if;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: any account created before this file was run gets a profile,
-- a wallet and starting chips.
do $$
declare
  u record;
  v_name text;
begin
  for u in
    select au.id, au.raw_user_meta_data
      from auth.users au
     where not exists (select 1 from public.wallets w where w.user_id = au.id)
        or not exists (select 1 from public.profiles p where p.id = au.id)
  loop
    if not exists (select 1 from public.profiles where id = u.id) then
      v_name := nullif(btrim(u.raw_user_meta_data ->> 'username'), '');
      if v_name is null
         or v_name !~ '^[A-Za-z0-9_]{3,16}$'
         or private.username_is_reserved(v_name)
         or exists (select 1 from public.profiles where lower(username) = lower(v_name)) then
        v_name := private.generate_username();
      end if;
      insert into public.profiles (id, username) values (u.id, v_name);
    end if;
    if not exists (select 1 from public.wallets where user_id = u.id) then
      insert into public.wallets (user_id) values (u.id);
      perform private.apply_chips(u.id, (select starting_chips from public.economy_config where id),
                                  'signup_bonus', null, null, jsonb_build_object('note', 'Backfill'));
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------

-- Everything the lounge needs to render the economy widgets, computed by the
-- server (including server_now so the client can run accurate countdowns).
create or replace function public.get_economy_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  w            public.wallets;
  c            public.economy_config;
  v_today      date := private.utc_today();
  v_streak     integer;
  v_next_day   integer;
  v_available  boolean;
  v_in_play    bigint;
  v_below      boolean;
  v_refill_at  timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into w from public.wallets where user_id = v_uid;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  select * into c from public.economy_config where id;

  -- Effective streak right now (a missed day breaks it).
  v_streak := case
                when w.last_daily_claim >= v_today - 1 then w.daily_streak
                else 0
              end;
  v_available := w.last_daily_claim is null or w.last_daily_claim < v_today;
  -- If already claimed today, this is tomorrow's streak day.
  v_next_day  := v_streak + 1;

  v_in_play := private.chips_in_play(v_uid);
  v_below   := (w.balance + v_in_play) < c.refill_threshold;
  v_refill_at := case
                   when w.last_refill_at is null then now()
                   else greatest(now(), w.last_refill_at + c.refill_cooldown)
                 end;

  return jsonb_build_object(
    'server_now',          now(),
    'balance',             w.balance,
    'peak_balance',        w.peak_balance,
    'chips_in_play',       v_in_play,
    'daily', jsonb_build_object(
      'available',         v_available,
      'streak',            v_streak,
      'next_day',          v_next_day,
      'next_amount',       private.daily_bonus_amount(v_next_day),
      'next_multiplier',   private.daily_multiplier(v_next_day),
      'next_available_at', case when v_available then now()
                                else ((v_today + 1)::timestamp at time zone 'utc') end,
      'last_claim',        w.last_daily_claim,
      'base',              c.daily_base,
      'multipliers',       to_jsonb(c.daily_multipliers)
    ),
    'refill', jsonb_build_object(
      'available',         v_below and v_refill_at <= now(),
      'below_threshold',   v_below,
      'threshold',         c.refill_threshold,
      'refill_to',         c.refill_to,
      'cooldown_seconds',  extract(epoch from c.refill_cooldown)::bigint,
      'available_at',      v_refill_at,
      'last_refill_at',    w.last_refill_at
    )
  );
end $$;

revoke all on function public.get_economy_status() from public, anon;
grant execute on function public.get_economy_status() to authenticated;

-- Claim the free daily bonus. Resets at 00:00 UTC. Consecutive days build a
-- streak; the multiplier caps at the last entry of daily_multipliers.
create or replace function public.claim_daily_bonus()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  w         public.wallets;
  v_today   date := private.utc_today();
  v_streak  integer;
  v_amount  bigint;
  v_mult    numeric;
  v_balance bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into w from public.wallets where user_id = v_uid for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;

  if w.last_daily_claim is not null and w.last_daily_claim >= v_today then
    raise exception 'daily_already_claimed'
      using hint = 'The daily bonus resets at 00:00 UTC.';
  end if;

  v_streak := case when w.last_daily_claim = v_today - 1 then w.daily_streak + 1 else 1 end;
  v_amount := private.daily_bonus_amount(v_streak);
  v_mult   := private.daily_multiplier(v_streak);

  update public.wallets
     set daily_streak = v_streak,
         last_daily_claim = v_today
   where user_id = v_uid;

  v_balance := private.apply_chips(v_uid, v_amount, 'daily_bonus', null, v_today::text,
                                   jsonb_build_object('streak', v_streak, 'multiplier', v_mult));

  return jsonb_build_object(
    'amount',     v_amount,
    'streak',     v_streak,
    'multiplier', v_mult,
    'balance',    v_balance,
    'next_available_at', ((v_today + 1)::timestamp at time zone 'utc')
  );
end $$;

revoke all on function public.claim_daily_bonus() from public, anon;
grant execute on function public.claim_daily_bonus() to authenticated;

-- Free refill: when a player's chips (wallet + chips in play) are below the
-- threshold, top the wallet up to refill_to. One refill per cooldown window.
create or replace function public.claim_refill()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  w          public.wallets;
  c          public.economy_config;
  v_in_play  bigint;
  v_amount   bigint;
  v_balance  bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into w from public.wallets where user_id = v_uid for update;
  if not found then
    raise exception 'wallet_not_found';
  end if;
  select * into c from public.economy_config where id;

  v_in_play := private.chips_in_play(v_uid);
  if w.balance + v_in_play >= c.refill_threshold then
    raise exception 'refill_not_needed'
      using hint = format('Refills unlock when you have fewer than %s chips.', c.refill_threshold);
  end if;

  if w.last_refill_at is not null and now() < w.last_refill_at + c.refill_cooldown then
    raise exception 'refill_on_cooldown'
      using hint = format('Next refill at %s', w.last_refill_at + c.refill_cooldown);
  end if;

  v_amount := c.refill_to - w.balance;

  update public.wallets set last_refill_at = now() where user_id = v_uid;
  v_balance := private.apply_chips(v_uid, v_amount, 'refill', null, null,
                                   jsonb_build_object('refill_to', c.refill_to));

  return jsonb_build_object(
    'amount',       v_amount,
    'balance',      v_balance,
    'available_at', now() + c.refill_cooldown
  );
end $$;

revoke all on function public.claim_refill() from public, anon;
grant execute on function public.claim_refill() to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.economy_config enable row level security;
alter table public.wallets        enable row level security;
alter table public.chip_ledger    enable row level security;

drop policy if exists "economy_config: anyone can read" on public.economy_config;
create policy "economy_config: anyone can read"
  on public.economy_config for select
  to anon, authenticated
  using (true);

drop policy if exists "wallets: read own" on public.wallets;
create policy "wallets: read own"
  on public.wallets for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "chip_ledger: read own" on public.chip_ledger;
create policy "chip_ledger: read own"
  on public.chip_ledger for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update/delete policies exist, and table privileges are revoked
-- too, so the browser can never write chips.
revoke insert, update, delete, truncate on public.economy_config from anon, authenticated;
revoke insert, update, delete, truncate on public.wallets        from anon, authenticated;
revoke insert, update, delete, truncate on public.chip_ledger    from anon, authenticated;
revoke all on public.wallets, public.chip_ledger from anon;
grant select on public.economy_config to anon, authenticated;
grant select on public.wallets, public.chip_ledger to authenticated;

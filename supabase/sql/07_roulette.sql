-- =============================================================================
-- All In · 07_roulette.sql
-- Shared-table roulette with timed betting rounds. European (single zero) and
-- American (0 and 00) wheels; the wheel type is the table's `variant`.
--
-- Flow:  betting (20 s, opened by the first bet) → spinning (7 s) → settled (6 s)
--   * When betting closes the server picks the winning pocket and stores it in
--     rl_secrets (RLS on, no policies, no privileges), so nobody can see the
--     result while the ball is still spinning.
--   * When the spin timer ends, any client at the table calls rl_advance(); the
--     server reveals the number and pays every bet in the same transaction.
--
-- Pocket 37 means "00" (American tables only).
-- Every bet pays (36 / numbers covered) times the stake back, i.e. straight 35:1,
-- split 17:1, street 11:1, corner 8:1, line 5:1, dozen/column 2:1, even money 1:1.
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run.
-- =============================================================================

create table if not exists public.rl_rounds (
  id             uuid primary key default gen_random_uuid(),
  table_id       uuid not null references public.game_tables (id) on delete cascade,
  round_no       integer not null,
  phase          text not null check (phase in ('betting', 'spinning', 'settled')),
  phase_ends_at  timestamptz,
  -- Null until the ball lands (the pick lives in rl_secrets while spinning).
  result         smallint check (result between 0 and 37),
  created_at     timestamptz not null default now(),
  settled_at     timestamptz,
  unique (table_id, round_no)
);

create index if not exists rl_rounds_table_idx on public.rl_rounds (table_id, round_no desc);
create index if not exists rl_rounds_open_idx on public.rl_rounds (phase_ends_at) where phase <> 'settled';

-- One row per chip placement (so "undo" can take back the last one).
create table if not exists public.rl_bets (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.rl_rounds (id) on delete cascade,
  table_id    uuid not null references public.game_tables (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  bet_type    text not null check (bet_type in ('straight', 'split', 'street', 'corner', 'line', 'dozen', 'column',
                                                'red', 'black', 'odd', 'even', 'low', 'high')),
  selection   text not null default '',
  numbers     smallint[] not null,
  amount      bigint not null check (amount > 0),
  won         boolean,
  payout      bigint not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists rl_bets_round_idx on public.rl_bets (round_id, user_id);
create index if not exists rl_bets_table_idx on public.rl_bets (table_id);
create index if not exists rl_bets_open_idx on public.rl_bets (user_id) where won is null;

-- HIDDEN: the winning pocket while the wheel is spinning.
create table if not exists public.rl_secrets (
  round_id  uuid primary key references public.rl_rounds (id) on delete cascade,
  result    smallint not null
);

-- -----------------------------------------------------------------------------
-- Rules
-- -----------------------------------------------------------------------------
create or replace function private.rl_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'bet_seconds', 20,
    'spin_seconds', 7,
    'next_round_seconds', 6,
    -- A player's total stake per spin is capped at max_bet × this.
    'max_total_multiplier', 10
  );
$$;

create or replace function private.rl_is_red(n integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select n = any (array[1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
$$;

-- Numbers covered by a bet, or raise 'invalid_bet'. Selections:
--   straight '17' / '0' / '00'      split 'a-b' (lower first, 00 = 37)
--   street   first number (1,4,…,34) corner lowest number of the four
--   line     first number (1,4,…,31) dozen/column '1' | '2' | '3'
--   red/black/odd/even/low/high: ''
create or replace function private.rl_numbers(p_variant text, p_type text, p_sel text)
returns smallint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  american boolean := p_variant = 'american';
  a integer;
  b integer;
  parts text[];
  v integer[];
begin
  if p_type = 'straight' then
    a := case when p_sel = '00' then 37 else p_sel::integer end;
    if a between 0 and 36 or (american and a = 37) then
      return array[a]::smallint[];
    end if;

  elsif p_type = 'split' then
    parts := string_to_array(p_sel, '-');
    if cardinality(parts) = 2 then
      a := case when parts[1] = '00' then 37 else parts[1]::integer end;
      b := case when parts[2] = '00' then 37 else parts[2]::integer end;
      if a > b then
        a := a + b; b := a - b; a := a - b;
      end if;
      if a between 1 and 36 and b between 1 and 36
         and (b = a + 3 or (b = a + 1 and a % 3 <> 0)) then
        return array[a, b]::smallint[];
      end if;
      if not american and a = 0 and b between 1 and 3 then
        return array[a, b]::smallint[];
      end if;
      if american and ((a = 0 and b in (1, 2, 37)) or (b = 37 and a in (2, 3))) then
        return array[a, b]::smallint[];
      end if;
    end if;

  elsif p_type = 'street' then
    a := p_sel::integer;
    if a between 1 and 34 and a % 3 = 1 then
      return array[a, a + 1, a + 2]::smallint[];
    end if;

  elsif p_type = 'corner' then
    a := p_sel::integer;
    if a between 1 and 32 and a % 3 <> 0 then
      return array[a, a + 1, a + 3, a + 4]::smallint[];
    end if;

  elsif p_type = 'line' then
    a := p_sel::integer;
    if a between 1 and 31 and a % 3 = 1 then
      return array[a, a + 1, a + 2, a + 3, a + 4, a + 5]::smallint[];
    end if;

  elsif p_type = 'dozen' then
    a := p_sel::integer;
    if a between 1 and 3 then
      select array_agg(g) into v from generate_series((a - 1) * 12 + 1, a * 12) g;
      return v::smallint[];
    end if;

  elsif p_type = 'column' then
    a := p_sel::integer;
    if a between 1 and 3 then
      select array_agg(g) into v from generate_series(a, 36, 3) g;
      return v::smallint[];
    end if;

  elsif p_type in ('red', 'black', 'odd', 'even', 'low', 'high') then
    select array_agg(g) into v from generate_series(1, 36) g
     where case p_type
             when 'red' then private.rl_is_red(g)
             when 'black' then not private.rl_is_red(g)
             when 'odd' then g % 2 = 1
             when 'even' then g % 2 = 0
             when 'low' then g <= 18
             else g >= 19
           end;
    return v::smallint[];
  end if;

  raise exception 'invalid_bet';
exception
  when invalid_text_representation then
    raise exception 'invalid_bet';
end $$;

-- -----------------------------------------------------------------------------
-- Round engine (private)
-- -----------------------------------------------------------------------------
create or replace function private.rl_lock_table(p_table uuid)
returns public.game_tables
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.game_tables;
begin
  select * into t from public.game_tables where id = p_table for update;
  if not found or t.game_key <> 'roulette' then
    raise exception 'table_not_found';
  end if;
  return t;
end $$;

create or replace function private.rl_latest_round(p_table uuid)
returns public.rl_rounds
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.rl_rounds where table_id = p_table order by round_no desc limit 1;
$$;

-- Reveal the result and pay every bet.
create or replace function private.rl_settle(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rl_rounds;
  v_result smallint;
  u record;
begin
  select * into r from public.rl_rounds where id = p_round for update;
  select result into v_result from public.rl_secrets where round_id = p_round;

  update public.rl_bets
     set won = v_result = any (numbers),
         payout = case when v_result = any (numbers) then (amount * 36) / cardinality(numbers) else 0 end
   where round_id = p_round;

  for u in
    select user_id, sum(amount)::bigint as wagered, sum(payout)::bigint as returned,
           jsonb_agg(jsonb_build_object('type', bet_type, 'selection', selection, 'amount', amount, 'payout', payout)
                     order by created_at) as bets
      from public.rl_bets where round_id = p_round
     group by user_id
  loop
    if u.returned > 0 then
      perform private.apply_chips(u.user_id, u.returned, 'payout', 'roulette', p_round::text,
                                  jsonb_build_object('round_no', r.round_no, 'result', v_result));
    end if;
    perform private.record_round(u.user_id, 'roulette', r.table_id, p_round, u.wagered, u.returned,
      jsonb_build_object('round_no', r.round_no, 'result', v_result, 'bets', u.bets));
  end loop;

  update public.rl_rounds
     set phase = 'settled', result = v_result, settled_at = now(),
         phase_ends_at = now() + make_interval(secs => (private.rl_rules() ->> 'next_round_seconds')::int)
   where id = p_round;
end $$;

-- Close betting: pick the pocket (kept secret) and start the spin.
create or replace function private.rl_spin(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rl_rounds;
  t public.game_tables;
  v_pockets integer;
begin
  select * into r from public.rl_rounds where id = p_round for update;
  select * into t from public.game_tables where id = r.table_id;

  -- Bets from players who left before the spin are returned.
  perform private.apply_chips(b.user_id, sum(b.amount)::bigint, 'refund', 'roulette', p_round::text,
                              jsonb_build_object('note', 'Left before the spin'))
     from public.rl_bets b
    where b.round_id = p_round
      and not exists (select 1 from public.table_seats s where s.table_id = r.table_id and s.user_id = b.user_id)
    group by b.user_id;
  delete from public.rl_bets b
   where b.round_id = p_round
     and not exists (select 1 from public.table_seats s where s.table_id = r.table_id and s.user_id = b.user_id);

  if not exists (select 1 from public.rl_bets where round_id = p_round) then
    update public.rl_rounds set phase = 'settled', settled_at = now(), phase_ends_at = now() where id = p_round;
    return;
  end if;

  v_pockets := case when t.variant = 'american' then 38 else 37 end;
  insert into public.rl_secrets (round_id, result) values (p_round, private.random_int(v_pockets))
  on conflict (round_id) do update set result = excluded.result;

  update public.rl_rounds
     set phase = 'spinning',
         phase_ends_at = now() + make_interval(secs => (private.rl_rules() ->> 'spin_seconds')::int)
   where id = p_round;
  update public.game_tables set last_activity_at = now() where id = r.table_id;
end $$;

create or replace function private.rl_tick(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rl_rounds;
  i integer := 0;
begin
  loop
    i := i + 1;
    exit when i > 5;
    r := private.rl_latest_round(p_table);
    exit when r.id is null or r.phase = 'settled' or r.phase_ends_at > now();
    if r.phase = 'betting' then
      perform private.rl_spin(r.id);
    elsif r.phase = 'spinning' then
      perform private.rl_settle(r.id);
    end if;
  end loop;
end $$;

-- Place one chip (internal; used by rl_place_bet and rl_rebet).
create or replace function private.rl_add_bet(p_user uuid, t public.game_tables, r public.rl_rounds,
                                              p_type text, p_sel text, p_amount bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.stake_tiers;
  v_numbers smallint[];
  v_sel text := coalesce(p_sel, '');
  v_spot bigint;
  v_total bigint;
begin
  select * into st from public.stake_tiers where game_key = 'roulette' and tier = t.tier;
  v_numbers := private.rl_numbers(coalesce(t.variant, 'european'), p_type, v_sel);
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select coalesce(sum(amount), 0) into v_spot from public.rl_bets
   where round_id = r.id and user_id = p_user and bet_type = p_type and numbers = v_numbers;
  if v_spot + p_amount < st.min_bet or v_spot + p_amount > st.max_bet then
    raise exception 'bet_out_of_range'
      using hint = format('Each spot takes %s to %s chips.', st.min_bet, st.max_bet);
  end if;
  select coalesce(sum(amount), 0) into v_total from public.rl_bets where round_id = r.id and user_id = p_user;
  if v_total + p_amount > st.max_bet * (private.rl_rules() ->> 'max_total_multiplier')::bigint then
    raise exception 'bet_out_of_range'
      using hint = format('Your total bets per spin can be up to %s chips.',
                          st.max_bet * (private.rl_rules() ->> 'max_total_multiplier')::bigint);
  end if;

  perform private.apply_chips(p_user, -p_amount, 'bet', 'roulette', r.id::text,
                              jsonb_build_object('round_no', r.round_no, 'type', p_type, 'selection', v_sel));
  insert into public.rl_bets (round_id, table_id, user_id, bet_type, selection, numbers, amount)
  values (r.id, t.id, p_user, p_type, v_sel, v_numbers, p_amount);
end $$;

-- The betting round to add chips to (opening a new one if the last has finished).
create or replace function private.rl_betting_round(p_table uuid)
returns public.rl_rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rl_rounds;
begin
  r := private.rl_latest_round(p_table);
  if r.id is null or (r.phase = 'settled' and r.phase_ends_at <= now()) then
    insert into public.rl_rounds (table_id, round_no, phase, phase_ends_at)
    values (p_table, coalesce(r.round_no, 0) + 1, 'betting',
            now() + make_interval(secs => (private.rl_rules() ->> 'bet_seconds')::int))
    returning * into r;
  elsif r.phase = 'settled' then
    raise exception 'next_round_pending';
  elsif r.phase <> 'betting' then
    raise exception 'betting_closed';
  end if;
  return r;
end $$;

create or replace function private.rl_require_seat(p_table uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.table_seats set last_seen_at = now(), status = 'active'
   where table_id = p_table and user_id = p_user;
  if not found then
    raise exception 'not_seated';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------
create or replace function public.rl_state(p_table uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.game_tables;
  st public.stake_tiers;
  r public.rl_rounds;
  v_disc interval := (select disconnected from private.seat_timeouts());
begin
  if not private.can_view_table(p_table) then
    raise exception 'table_not_found';
  end if;
  select * into t from public.game_tables where id = p_table;
  if t.game_key <> 'roulette' then
    raise exception 'table_not_found';
  end if;
  select * into st from public.stake_tiers where game_key = t.game_key and tier = t.tier;
  r := private.rl_latest_round(p_table);

  return jsonb_build_object(
    'server_now', now(),
    'rules', private.rl_rules(),
    'table', jsonb_build_object(
      'id', t.id, 'name', t.name, 'tier', t.tier, 'tier_label', st.label, 'variant', coalesce(t.variant, 'european'),
      'min_bet', st.min_bet, 'max_bet', st.max_bet, 'min_bankroll', st.min_bankroll,
      'max_seats', t.max_seats, 'is_private', t.is_private, 'status', t.status,
      'invite_code', case when t.is_private then t.invite_code end
    ),
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seat_no', s.seat_no, 'user_id', s.user_id, 'username', p.username,
               'status', s.status, 'connected', s.last_seen_at > now() - v_disc) order by s.seat_no)
        from public.table_seats s join public.profiles p on p.id = s.user_id
       where s.table_id = p_table), '[]'::jsonb),
    'round', case when r.id is null then null else jsonb_build_object(
      'id', r.id, 'round_no', r.round_no, 'phase', r.phase, 'phase_ends_at', r.phase_ends_at,
      'result', r.result, 'settled_at', r.settled_at) end,
    'bets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'user_id', b.user_id, 'username', p.username, 'bet_type', b.bet_type,
               'selection', b.selection, 'numbers', to_jsonb(b.numbers), 'amount', b.amount,
               'won', b.won, 'payout', b.payout) order by b.created_at)
        from public.rl_bets b join public.profiles p on p.id = b.user_id
       where b.round_id = r.id), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x.result order by x.round_no desc)
        from (select result, round_no from public.rl_rounds
               where table_id = p_table and phase = 'settled' and result is not null
               order by round_no desc limit 20) x), '[]'::jsonb),
    -- Hot and cold numbers over the last 100 spins at this table.
    'stats', (
      with last100 as (
        select result from public.rl_rounds
         where table_id = p_table and phase = 'settled' and result is not null
         order by round_no desc limit 100
      ), counts as (
        select g as n, (select count(*) from last100 where result = g)::int as hits
          from generate_series(0, case when t.variant = 'american' then 37 else 36 end) g
      )
      select jsonb_build_object(
        'spins', (select count(*) from last100),
        'hot', coalesce((select jsonb_agg(jsonb_build_object('n', n, 'hits', hits))
                           from (select * from counts where hits > 0 order by hits desc, n limit 5) h), '[]'::jsonb),
        'cold', coalesce((select jsonb_agg(jsonb_build_object('n', n, 'hits', hits))
                            from (select * from counts order by hits, n limit 5) c), '[]'::jsonb),
        'red', (select count(*) from last100 where result between 1 and 36 and private.rl_is_red(result)),
        'black', (select count(*) from last100 where result between 1 and 36 and not private.rl_is_red(result)),
        'zero', (select count(*) from last100 where result in (0, 37))
      )
    )
  );
end $$;

create or replace function public.rl_place_bet(p_table uuid, p_type text, p_selection text, p_amount bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.game_tables;
  r public.rl_rounds;
begin
  t := private.rl_lock_table(p_table);
  perform private.rl_tick(p_table);
  perform private.rl_require_seat(p_table, v_uid);
  r := private.rl_betting_round(p_table);
  perform private.rl_add_bet(v_uid, t, r, p_type, p_selection, p_amount);
  update public.game_tables set last_activity_at = now() where id = p_table;
end $$;

-- Repeat your bets from the previous spin.
create or replace function public.rl_rebet(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.game_tables;
  r public.rl_rounds;
  v_prev uuid;
  b record;
begin
  t := private.rl_lock_table(p_table);
  perform private.rl_tick(p_table);
  perform private.rl_require_seat(p_table, v_uid);
  select rr.id into v_prev from public.rl_rounds rr
   where rr.table_id = p_table and rr.phase = 'settled'
     and exists (select 1 from public.rl_bets x where x.round_id = rr.id and x.user_id = v_uid)
   order by rr.round_no desc limit 1;
  if v_prev is null then
    raise exception 'nothing_to_rebet';
  end if;
  r := private.rl_betting_round(p_table);
  for b in select bet_type, selection, amount from public.rl_bets
            where round_id = v_prev and user_id = v_uid order by created_at loop
    perform private.rl_add_bet(v_uid, t, r, b.bet_type, b.selection, b.amount);
  end loop;
end $$;

-- Take back your most recent chip (or all of them).
create or replace function public.rl_undo_bet(p_table uuid, p_all boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r public.rl_rounds;
  b public.rl_bets;
begin
  perform private.rl_lock_table(p_table);
  perform private.rl_tick(p_table);
  r := private.rl_latest_round(p_table);
  if r.id is null or r.phase <> 'betting' then
    raise exception 'betting_closed';
  end if;
  for b in select * from public.rl_bets where round_id = r.id and user_id = v_uid
            order by created_at desc limit case when p_all then null else 1 end loop
    perform private.apply_chips(v_uid, b.amount, 'refund', 'roulette', r.id::text,
                                jsonb_build_object('round_no', r.round_no, 'note', 'Bet taken back'));
    delete from public.rl_bets where id = b.id;
  end loop;
end $$;

create or replace function public.rl_advance(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_uid();
  if not private.can_view_table(p_table) then
    raise exception 'table_not_found';
  end if;
  perform private.rl_lock_table(p_table);
  perform private.rl_tick(p_table);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.rl_state(uuid)', 'public.rl_place_bet(uuid, text, text, bigint)', 'public.rl_rebet(uuid)',
    'public.rl_undo_bet(uuid, boolean)', 'public.rl_advance(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Plug into the shared helpers (see 05_tables.sql).
create or replace function private.rl_tick_stale()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table uuid;
begin
  for v_table in
    select distinct r.table_id from public.rl_rounds r
     where r.phase <> 'settled' and r.phase_ends_at < now() - interval '2 seconds'
  loop
    perform private.rl_lock_table(v_table);
    perform private.rl_tick(v_table);
  end loop;
end $$;

create or replace function private.rl_in_play(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0)::bigint from public.rl_bets where user_id = p_user and won is null;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.rl_rounds  enable row level security;
alter table public.rl_bets    enable row level security;
alter table public.rl_secrets enable row level security;

drop policy if exists "rl_rounds: rounds at visible tables" on public.rl_rounds;
create policy "rl_rounds: rounds at visible tables"
  on public.rl_rounds for select to authenticated
  using (private.can_view_table(table_id));

-- Chips on the layout are visible to everyone at the table, as in a real casino.
drop policy if exists "rl_bets: bets at visible tables" on public.rl_bets;
create policy "rl_bets: bets at visible tables"
  on public.rl_bets for select to authenticated
  using (private.can_view_table(table_id));

revoke all on public.rl_secrets from anon, authenticated;
revoke insert, update, delete, truncate on public.rl_rounds, public.rl_bets from anon, authenticated;
revoke all on public.rl_rounds, public.rl_bets from anon;
grant select on public.rl_rounds, public.rl_bets to authenticated;

-- -----------------------------------------------------------------------------
-- Open the game: one European and one American house table per stake level.
-- -----------------------------------------------------------------------------
update public.games set released = true where key = 'roulette';

insert into public.game_tables (game_key, tier, name, max_seats, persistent, variant)
select 'roulette', v.tier, v.name, 8, true, v.variant
  from (values ('low', 'Riviera Wheel', 'european'), ('mid', 'Monaco Wheel', 'european'),
               ('high', 'Baden Wheel', 'european'), ('vip', 'Grand Salon Wheel', 'european'),
               ('low', 'Boardwalk Wheel', 'american'), ('mid', 'Strip Wheel', 'american'),
               ('high', 'Desert Palace Wheel', 'american'), ('vip', 'Diamond Wheel', 'american')) v(tier, name, variant)
 where not exists (
   select 1 from public.game_tables t
    where t.game_key = 'roulette' and t.tier = v.tier and t.persistent and t.variant = v.variant
 );

select private.add_to_realtime('rl_rounds');
select private.add_to_realtime('rl_bets');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

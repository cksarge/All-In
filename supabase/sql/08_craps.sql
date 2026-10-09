-- =============================================================================
-- All In · 08_craps.sql
-- Shared-table craps with a rotating shooter, fully server-side.
--
-- Bets (stake back plus the winnings shown):
--   pass / don't pass ............ 1:1   (don't pass: 12 is a push, "bar 12")
--   come / don't come ............ 1:1   (travel to the number rolled)
--   odds behind pass/come ........ true odds: 4/10 2:1, 5/9 3:2, 6/8 6:5
--   lay odds behind don't ........ 4/10 1:2, 5/9 2:3, 6/8 5:6   (odds up to 3× the line bet)
--   place 4/10 9:5, 5/9 7:5, 6/8 7:6  (stay up after a win; off on the come-out)
--   field 3,4,9,10,11 1:1 · 2 pays 2:1 · 12 pays 3:1   (one roll)
--   hard 4/10 7:1, hard 6/8 9:1       (lose on the easy way or a 7; off on the come-out)
--   any 7 4:1 · any craps 7:1 · 2 30:1 · 3 15:1 · 11 15:1 · 12 30:1   (one roll)
-- Winnings are rounded down to whole chips.
--
-- Rolling: once any bet is on the table a 20 s roll timer runs. The shooter
-- (rotating through the seated players, passing on a seven-out) can roll as
-- soon as 3 s have passed since the last roll; otherwise the server rolls when
-- the timer ends (any client may call cr_advance(), the server checks the time).
-- Dice are rolled by the server at the moment of the roll.
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run.
-- =============================================================================

create table if not exists public.cr_state (
  table_id       uuid primary key references public.game_tables (id) on delete cascade,
  point          smallint check (point in (4, 5, 6, 8, 9, 10)),
  shooter_user   uuid references auth.users (id) on delete set null,
  roll_no        integer not null default 0,
  phase          text not null default 'idle' check (phase in ('idle', 'betting')),
  phase_ends_at  timestamptz,
  last_d1        smallint,
  last_d2        smallint,
  last_roll_at   timestamptz,
  updated_at     timestamptz not null default now()
);

create table if not exists public.cr_rolls (
  id            bigint generated always as identity primary key,
  table_id      uuid not null references public.game_tables (id) on delete cascade,
  roll_no       integer not null,
  shooter_user  uuid references auth.users (id) on delete set null,
  d1            smallint not null check (d1 between 1 and 6),
  d2            smallint not null check (d2 between 1 and 6),
  total         smallint not null,
  point_before  smallint,
  point_after   smallint,
  outcome       text not null check (outcome in ('natural', 'craps', 'point_set', 'point_made', 'seven_out', 'roll')),
  created_at    timestamptz not null default now(),
  unique (table_id, roll_no)
);

create index if not exists cr_rolls_table_idx on public.cr_rolls (table_id, roll_no desc);

create table if not exists public.cr_bets (
  id             uuid primary key default gen_random_uuid(),
  table_id       uuid not null references public.game_tables (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  bet_type       text not null check (bet_type in ('pass', 'dont_pass', 'come', 'dont_come', 'place', 'hard', 'field',
                                                   'any7', 'any_craps', 'two', 'three', 'eleven', 'twelve')),
  number         smallint,
  amount         bigint not null check (amount > 0),
  odds           bigint not null default 0 check (odds >= 0),
  status         text not null default 'active' check (status in ('active', 'won', 'lost', 'push', 'returned')),
  -- Total paid back on resolution; for place bets also the running total of wins.
  payout         bigint not null default 0,
  last_win_roll  integer,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_roll  integer
);

create index if not exists cr_bets_table_active_idx on public.cr_bets (table_id) where status = 'active';
create index if not exists cr_bets_user_active_idx on public.cr_bets (user_id) where status = 'active';
create index if not exists cr_bets_table_roll_idx on public.cr_bets (table_id, resolved_roll);

-- -----------------------------------------------------------------------------
-- Rules and payouts
-- -----------------------------------------------------------------------------
create or replace function private.cr_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'roll_seconds', 20,
    'min_roll_gap_seconds', 3,
    'max_odds_multiple', 3
  );
$$;

-- Winnings (not including the stake) for a winning bet.
create or replace function private.cr_win(p_type text, p_number integer, p_amount bigint, p_d1 integer, p_d2 integer)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'place' then case when p_number in (4, 10) then p_amount * 9 / 5
                           when p_number in (5, 9) then p_amount * 7 / 5
                           else p_amount * 7 / 6 end
    when 'hard' then case when p_number in (4, 10) then p_amount * 7 else p_amount * 9 end
    when 'field' then case when p_d1 + p_d2 = 2 then p_amount * 2
                           when p_d1 + p_d2 = 12 then p_amount * 3
                           else p_amount end
    when 'any7' then p_amount * 4
    when 'any_craps' then p_amount * 7
    when 'two' then p_amount * 30
    when 'three' then p_amount * 15
    when 'eleven' then p_amount * 15
    when 'twelve' then p_amount * 30
    else p_amount  -- pass, don't pass, come, don't come: even money
  end;
$$;

-- Winnings on odds: true odds behind pass/come, lay odds behind don't.
create or replace function private.cr_odds_win(p_dont boolean, p_number integer, p_odds bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when not p_dont and p_number in (4, 10) then p_odds * 2
    when not p_dont and p_number in (5, 9) then p_odds * 3 / 2
    when not p_dont then p_odds * 6 / 5
    when p_number in (4, 10) then p_odds / 2
    when p_number in (5, 9) then p_odds * 2 / 3
    else p_odds * 5 / 6
  end;
$$;

-- -----------------------------------------------------------------------------
-- Engine (private)
-- -----------------------------------------------------------------------------
create or replace function private.cr_lock_table(p_table uuid)
returns public.game_tables
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.game_tables;
begin
  select * into t from public.game_tables where id = p_table for update;
  if not found or t.game_key <> 'craps' then
    raise exception 'table_not_found';
  end if;
  insert into public.cr_state (table_id) values (p_table) on conflict (table_id) do nothing;
  return t;
end $$;

-- Next shooter after p_after (by seat order, wrapping). Null when nobody is seated.
create or replace function private.cr_next_shooter(p_table uuid, p_after uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with seats as (
    select user_id, seat_no from public.table_seats
     where table_id = p_table and status = 'active'
       and last_seen_at > now() - (select disconnected from private.seat_timeouts())
  ), cur as (
    select seat_no from public.table_seats where table_id = p_table and user_id = p_after
  )
  select user_id from seats
   order by case when seat_no > coalesce((select seat_no from cur), 0) then 0 else 1 end, seat_no
   limit 1;
$$;

-- Keep the shooter valid and the roll timer running while bets are down.
create or replace function private.cr_refresh(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.cr_state;
  v_active boolean;
begin
  select * into s from public.cr_state where table_id = p_table for update;
  if s.shooter_user is null or not exists (
       select 1 from public.table_seats where table_id = p_table and user_id = s.shooter_user
     ) then
    update public.cr_state set shooter_user = private.cr_next_shooter(p_table, s.shooter_user), updated_at = now()
     where table_id = p_table;
  end if;

  v_active := exists (select 1 from public.cr_bets where table_id = p_table and status = 'active');
  if v_active and s.phase = 'idle' then
    update public.cr_state
       set phase = 'betting',
           phase_ends_at = now() + make_interval(secs => (private.cr_rules() ->> 'roll_seconds')::int),
           updated_at = now()
     where table_id = p_table;
  elsif not v_active and s.phase <> 'idle' then
    update public.cr_state set phase = 'idle', phase_ends_at = null, updated_at = now() where table_id = p_table;
  end if;
end $$;

-- Roll the dice and resolve every bet on the table.
create or replace function private.cr_roll(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.cr_state;
  b public.cr_bets;
  u record;
  d1 integer := private.random_int(6) + 1;
  d2 integer := private.random_int(6) + 1;
  total integer;
  v_point integer;
  v_new_point integer;
  v_outcome text;
  v_roll integer;
  v_status text;
  v_paid bigint;
  v_dont boolean;
begin
  select * into s from public.cr_state where table_id = p_table for update;
  total := d1 + d2;
  v_point := s.point;
  v_roll := s.roll_no + 1;

  -- Players who left get their optional bets back; contract bets play on.
  for b in
    select * from public.cr_bets cb
     where cb.table_id = p_table and cb.status = 'active'
       and not exists (select 1 from public.table_seats ts where ts.table_id = p_table and ts.user_id = cb.user_id)
       and (cb.bet_type in ('place', 'hard', 'field', 'any7', 'any_craps', 'two', 'three', 'eleven', 'twelve')
            or (cb.bet_type in ('pass', 'dont_pass') and v_point is null)
            or (cb.bet_type in ('come', 'dont_come') and cb.number is null))
  loop
    perform private.apply_chips(b.user_id, b.amount + b.odds, 'refund', 'craps', b.id::text,
                                jsonb_build_object('note', 'Left the table'));
    update public.cr_bets set status = 'returned', payout = b.amount + b.odds, resolved_at = now(), resolved_roll = v_roll
     where id = b.id;
  end loop;

  for b in select * from public.cr_bets where table_id = p_table and status = 'active' order by created_at loop
    v_status := null;  -- null = still riding
    v_paid := 0;
    v_dont := b.bet_type in ('dont_pass', 'dont_come');

    if b.bet_type = 'pass' or (b.bet_type = 'come' and b.number is not null) then
      if b.bet_type = 'pass' and v_point is null then
        if total in (7, 11) then v_status := 'won';
        elsif total in (2, 3, 12) then v_status := 'lost';
        end if;
      else
        if total = coalesce(b.number, v_point) then v_status := 'won';
        elsif total = 7 then v_status := 'lost';
        end if;
      end if;
      if v_status = 'won' then
        v_paid := b.amount * 2 + b.odds + private.cr_odds_win(false, coalesce(b.number, v_point), b.odds);
      end if;

    elsif b.bet_type = 'dont_pass' or (b.bet_type = 'dont_come' and b.number is not null) then
      if b.bet_type = 'dont_pass' and v_point is null then
        if total in (2, 3) then v_status := 'won';
        elsif total = 12 then v_status := 'push';
        elsif total in (7, 11) then v_status := 'lost';
        end if;
      else
        if total = 7 then v_status := 'won';
        elsif total = coalesce(b.number, v_point) then v_status := 'lost';
        end if;
      end if;
      if v_status = 'won' then
        v_paid := b.amount * 2 + b.odds + private.cr_odds_win(true, coalesce(b.number, v_point), b.odds);
      elsif v_status = 'push' then
        v_paid := b.amount + b.odds;
      end if;

    elsif b.bet_type = 'come' then  -- in the come box
      if total in (7, 11) then v_status := 'won'; v_paid := b.amount * 2;
      elsif total in (2, 3, 12) then v_status := 'lost';
      else update public.cr_bets set number = total where id = b.id;
      end if;

    elsif b.bet_type = 'dont_come' then  -- in the don't come box
      if total in (2, 3) then v_status := 'won'; v_paid := b.amount * 2;
      elsif total = 12 then v_status := 'push'; v_paid := b.amount;
      elsif total in (7, 11) then v_status := 'lost';
      else update public.cr_bets set number = total where id = b.id;
      end if;

    elsif b.bet_type = 'place' then
      if v_point is not null then
        if total = b.number then
          -- Winnings are paid; the bet stays up.
          v_paid := private.cr_win('place', b.number, b.amount, d1, d2);
          perform private.apply_chips(b.user_id, v_paid, 'payout', 'craps', b.id::text,
                                      jsonb_build_object('roll_no', v_roll, 'bet', 'place', 'number', b.number));
          perform private.record_round(b.user_id, 'craps', p_table, null, b.amount, b.amount + v_paid,
            jsonb_build_object('roll_no', v_roll, 'dice', array[d1, d2], 'bet', 'place', 'number', b.number));
          update public.cr_bets set payout = payout + v_paid, last_win_roll = v_roll where id = b.id;
          v_paid := 0;
        elsif total = 7 then
          v_status := 'lost';
        end if;
      end if;

    elsif b.bet_type = 'hard' then
      if v_point is not null then
        if total = b.number and d1 = d2 then
          v_status := 'won'; v_paid := b.amount + private.cr_win('hard', b.number, b.amount, d1, d2);
        elsif total = b.number or total = 7 then
          v_status := 'lost';
        end if;
      end if;

    else  -- one-roll bets: field and propositions
      if (b.bet_type = 'field' and total in (2, 3, 4, 9, 10, 11, 12))
         or (b.bet_type = 'any7' and total = 7)
         or (b.bet_type = 'any_craps' and total in (2, 3, 12))
         or (b.bet_type = 'two' and total = 2)
         or (b.bet_type = 'three' and total = 3)
         or (b.bet_type = 'eleven' and total = 11)
         or (b.bet_type = 'twelve' and total = 12) then
        v_status := 'won';
        v_paid := b.amount + private.cr_win(b.bet_type, null, b.amount, d1, d2);
      else
        v_status := 'lost';
      end if;
    end if;

    if v_status is not null then
      update public.cr_bets
         set status = v_status, payout = payout + v_paid, resolved_at = now(), resolved_roll = v_roll
       where id = b.id;
    end if;
  end loop;

  -- One credit and one history row per player for the bets this roll settled.
  for u in
    select user_id, sum(amount + odds)::bigint as wagered,
           -- (place bets never end as 'won': their wins were credited as they happened)
           sum(case when status in ('won', 'push') then payout else 0 end)::bigint as returned,
           jsonb_agg(jsonb_build_object('bet', bet_type, 'number', number, 'amount', amount, 'odds', odds,
                                        'status', status, 'payout', payout)) as bets
      from public.cr_bets
     where table_id = p_table and resolved_roll = v_roll and status in ('won', 'lost', 'push')
     group by user_id
  loop
    if u.returned > 0 then
      perform private.apply_chips(u.user_id, u.returned, 'payout', 'craps', p_table::text,
                                  jsonb_build_object('roll_no', v_roll, 'dice', array[d1, d2]));
    end if;
    perform private.record_round(u.user_id, 'craps', p_table, null, u.wagered, u.returned,
      jsonb_build_object('roll_no', v_roll, 'dice', array[d1, d2], 'total', total, 'bets', u.bets));
  end loop;

  -- Move the point and pass the dice.
  v_new_point := v_point;
  if v_point is null then
    if total in (4, 5, 6, 8, 9, 10) then v_new_point := total; v_outcome := 'point_set';
    elsif total in (7, 11) then v_outcome := 'natural';
    else v_outcome := 'craps';
    end if;
  elsif total = v_point then
    v_new_point := null; v_outcome := 'point_made';
  elsif total = 7 then
    v_new_point := null; v_outcome := 'seven_out';
  else
    v_outcome := 'roll';
  end if;

  insert into public.cr_rolls (table_id, roll_no, shooter_user, d1, d2, total, point_before, point_after, outcome)
  values (p_table, v_roll, s.shooter_user, d1, d2, total, v_point, v_new_point, v_outcome);

  update public.cr_state
     set point = v_new_point, roll_no = v_roll, last_d1 = d1, last_d2 = d2, last_roll_at = now(),
         shooter_user = case when v_outcome = 'seven_out' then private.cr_next_shooter(p_table, s.shooter_user)
                             else s.shooter_user end,
         phase = 'idle', phase_ends_at = null, updated_at = now()
   where table_id = p_table;

  update public.game_tables set last_activity_at = now() where id = p_table;
  perform private.cr_refresh(p_table);
end $$;

create or replace function private.cr_tick(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.cr_state;
begin
  perform private.cr_refresh(p_table);
  select * into s from public.cr_state where table_id = p_table;
  if s.phase = 'betting' and s.phase_ends_at <= now() then
    perform private.cr_roll(p_table);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------
create or replace function public.cr_state(p_table uuid)
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
  s public.cr_state;
  v_disc interval := (select disconnected from private.seat_timeouts());
begin
  if not private.can_view_table(p_table) then
    raise exception 'table_not_found';
  end if;
  select * into t from public.game_tables where id = p_table;
  if t.game_key <> 'craps' then
    raise exception 'table_not_found';
  end if;
  select * into st from public.stake_tiers where game_key = t.game_key and tier = t.tier;
  select * into s from public.cr_state where table_id = p_table;

  return jsonb_build_object(
    'server_now', now(),
    'rules', private.cr_rules(),
    'table', jsonb_build_object(
      'id', t.id, 'name', t.name, 'tier', t.tier, 'tier_label', st.label,
      'min_bet', st.min_bet, 'max_bet', st.max_bet, 'min_bankroll', st.min_bankroll,
      'max_seats', t.max_seats, 'is_private', t.is_private, 'status', t.status,
      'invite_code', case when t.is_private then t.invite_code end
    ),
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seat_no', ts.seat_no, 'user_id', ts.user_id, 'username', p.username,
               'status', ts.status, 'connected', ts.last_seen_at > now() - v_disc) order by ts.seat_no)
        from public.table_seats ts join public.profiles p on p.id = ts.user_id
       where ts.table_id = p_table), '[]'::jsonb),
    'state', jsonb_build_object(
      'point', s.point, 'shooter_user', s.shooter_user, 'roll_no', coalesce(s.roll_no, 0),
      'phase', coalesce(s.phase, 'idle'), 'phase_ends_at', s.phase_ends_at,
      'last_dice', case when s.last_d1 is null then null else jsonb_build_array(s.last_d1, s.last_d2) end,
      'last_roll_at', s.last_roll_at
    ),
    'bets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'user_id', b.user_id, 'username', p.username, 'bet_type', b.bet_type,
               'number', b.number, 'amount', b.amount, 'odds', b.odds, 'payout', b.payout,
               'last_win_roll', b.last_win_roll) order by b.created_at)
        from public.cr_bets b join public.profiles p on p.id = b.user_id
       where b.table_id = p_table and b.status = 'active'), '[]'::jsonb),
    -- What the most recent roll settled (for win/lose animations).
    'last_results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'user_id', b.user_id, 'bet_type', b.bet_type, 'number', b.number,
               'amount', b.amount, 'odds', b.odds, 'status', b.status, 'payout', b.payout))
        from public.cr_bets b
       where b.table_id = p_table and s.roll_no > 0
         and (b.resolved_roll = s.roll_no or b.last_win_roll = s.roll_no)), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('roll_no', x.roll_no, 'd1', x.d1, 'd2', x.d2, 'total', x.total,
                                          'outcome', x.outcome) order by x.roll_no desc)
        from (select * from public.cr_rolls where table_id = p_table order by roll_no desc limit 20) x), '[]'::jsonb)
  );
end $$;

create or replace function public.cr_place_bet(p_table uuid, p_type text, p_number integer, p_amount bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.game_tables;
  st public.stake_tiers;
  s public.cr_state;
  v_existing public.cr_bets;
  v_number smallint;
begin
  t := private.cr_lock_table(p_table);
  perform private.cr_tick(p_table);
  update public.table_seats set last_seen_at = now(), status = 'active'
   where table_id = p_table and user_id = v_uid;
  if not found then
    raise exception 'not_seated';
  end if;
  select * into st from public.stake_tiers where game_key = 'craps' and tier = t.tier;
  select * into s from public.cr_state where table_id = p_table;

  if p_type in ('pass', 'dont_pass') then
    if s.point is not null then
      raise exception 'bet_not_allowed' using hint = 'Line bets go down on the come-out roll, before a point is set.';
    end if;
    v_number := null;
  elsif p_type in ('come', 'dont_come') then
    if s.point is null then
      raise exception 'bet_not_allowed' using hint = 'Come bets open once a point is set. Use Pass / Don''t Pass now.';
    end if;
    v_number := null;
  elsif p_type = 'place' then
    if p_number not in (4, 5, 6, 8, 9, 10) then raise exception 'invalid_bet'; end if;
    v_number := p_number;
  elsif p_type = 'hard' then
    if p_number not in (4, 6, 8, 10) then raise exception 'invalid_bet'; end if;
    v_number := p_number;
  elsif p_type in ('field', 'any7', 'any_craps', 'two', 'three', 'eleven', 'twelve') then
    v_number := null;
  else
    raise exception 'invalid_bet';
  end if;

  -- Add to an existing bet on the same spot (come bets always start fresh in the box).
  select * into v_existing from public.cr_bets
   where table_id = p_table and user_id = v_uid and status = 'active' and bet_type = p_type
     and number is not distinct from v_number
     and p_type not in ('come', 'dont_come')
   limit 1;

  if p_amount is null or p_amount <= 0
     or coalesce(v_existing.amount, 0) + p_amount < st.min_bet
     or coalesce(v_existing.amount, 0) + p_amount > st.max_bet then
    raise exception 'bet_out_of_range' using hint = format('Each bet takes %s to %s chips.', st.min_bet, st.max_bet);
  end if;

  perform private.apply_chips(v_uid, -p_amount, 'bet', 'craps', p_table::text,
                              jsonb_build_object('bet', p_type, 'number', v_number));
  if v_existing.id is not null then
    update public.cr_bets set amount = amount + p_amount where id = v_existing.id;
  else
    insert into public.cr_bets (table_id, user_id, bet_type, number, amount)
    values (p_table, v_uid, p_type, v_number, p_amount);
  end if;
  perform private.cr_refresh(p_table);
end $$;

-- Odds behind a pass/come (or lay odds behind a don't) bet that has a number.
create or replace function public.cr_add_odds(p_table uuid, p_bet uuid, p_amount bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s public.cr_state;
  b public.cr_bets;
begin
  perform private.cr_lock_table(p_table);
  perform private.cr_tick(p_table);
  select * into s from public.cr_state where table_id = p_table;
  select * into b from public.cr_bets
   where id = p_bet and table_id = p_table and user_id = v_uid and status = 'active' for update;
  if not found or b.bet_type not in ('pass', 'dont_pass', 'come', 'dont_come')
     or (b.bet_type in ('pass', 'dont_pass') and s.point is null)
     or (b.bet_type in ('come', 'dont_come') and b.number is null) then
    raise exception 'bet_not_allowed' using hint = 'Odds go behind a line or come bet once it has a number.';
  end if;
  if p_amount is null or p_amount <= 0
     or b.odds + p_amount > b.amount * (private.cr_rules() ->> 'max_odds_multiple')::bigint then
    raise exception 'bet_out_of_range'
      using hint = format('Odds can be up to %s× your bet (%s chips).',
                          private.cr_rules() ->> 'max_odds_multiple',
                          b.amount * (private.cr_rules() ->> 'max_odds_multiple')::bigint);
  end if;
  perform private.apply_chips(v_uid, -p_amount, 'bet', 'craps', p_table::text,
                              jsonb_build_object('bet', b.bet_type, 'odds', true));
  update public.cr_bets set odds = odds + p_amount where id = b.id;
end $$;

-- Take a bet down (place, hard, one-roll bets, and line/come bets before they have a number).
create or replace function public.cr_remove_bet(p_table uuid, p_bet uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s public.cr_state;
  b public.cr_bets;
begin
  perform private.cr_lock_table(p_table);
  perform private.cr_tick(p_table);
  select * into s from public.cr_state where table_id = p_table;
  select * into b from public.cr_bets
   where id = p_bet and table_id = p_table and user_id = v_uid and status = 'active' for update;
  if not found then
    raise exception 'bet_not_allowed';
  end if;
  if not (b.bet_type in ('place', 'hard', 'field', 'any7', 'any_craps', 'two', 'three', 'eleven', 'twelve')
          or (b.bet_type in ('pass', 'dont_pass') and s.point is null)
          or (b.bet_type in ('come', 'dont_come') and b.number is null)) then
    raise exception 'bet_not_allowed' using hint = 'Line and come bets stay up once they have a number.';
  end if;
  perform private.apply_chips(v_uid, b.amount + b.odds, 'refund', 'craps', b.id::text,
                              jsonb_build_object('note', 'Bet taken down'));
  update public.cr_bets set status = 'returned', payout = b.amount + b.odds, resolved_at = now() where id = b.id;
  perform private.cr_refresh(p_table);
end $$;

-- The shooter throws (no sooner than 3 s after the last roll, so others can bet).
create or replace function public.cr_roll(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  s public.cr_state;
begin
  perform private.cr_lock_table(p_table);
  perform private.cr_tick(p_table);
  select * into s from public.cr_state where table_id = p_table;
  if s.shooter_user is distinct from v_uid then
    raise exception 'not_shooter';
  end if;
  if s.phase <> 'betting' then
    raise exception 'no_bets_down';
  end if;
  if s.last_roll_at is not null
     and s.last_roll_at > now() - make_interval(secs => (private.cr_rules() ->> 'min_roll_gap_seconds')::int) then
    raise exception 'roll_too_soon';
  end if;
  update public.table_seats set last_seen_at = now() where table_id = p_table and user_id = v_uid;
  perform private.cr_roll(p_table);
end $$;

create or replace function public.cr_advance(p_table uuid)
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
  perform private.cr_lock_table(p_table);
  perform private.cr_tick(p_table);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.cr_state(uuid)', 'public.cr_place_bet(uuid, text, integer, bigint)', 'public.cr_add_odds(uuid, uuid, bigint)',
    'public.cr_remove_bet(uuid, uuid)', 'public.cr_roll(uuid)', 'public.cr_advance(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Plug into the shared helpers (see 05_tables.sql).
create or replace function private.cr_tick_stale()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table uuid;
begin
  for v_table in
    select table_id from public.cr_state where phase = 'betting' and phase_ends_at < now() - interval '2 seconds'
  loop
    perform private.cr_lock_table(v_table);
    perform private.cr_tick(v_table);
  end loop;
end $$;

create or replace function private.cr_in_play(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount + odds), 0)::bigint from public.cr_bets where user_id = p_user and status = 'active';
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security: everything at a craps table is public to that table.
-- -----------------------------------------------------------------------------
alter table public.cr_state enable row level security;
alter table public.cr_rolls enable row level security;
alter table public.cr_bets  enable row level security;

drop policy if exists "cr_state: visible tables" on public.cr_state;
create policy "cr_state: visible tables" on public.cr_state for select to authenticated
  using (private.can_view_table(table_id));
drop policy if exists "cr_rolls: visible tables" on public.cr_rolls;
create policy "cr_rolls: visible tables" on public.cr_rolls for select to authenticated
  using (private.can_view_table(table_id));
drop policy if exists "cr_bets: visible tables" on public.cr_bets;
create policy "cr_bets: visible tables" on public.cr_bets for select to authenticated
  using (private.can_view_table(table_id));

revoke insert, update, delete, truncate on public.cr_state, public.cr_rolls, public.cr_bets from anon, authenticated;
revoke all on public.cr_state, public.cr_rolls, public.cr_bets from anon;
grant select on public.cr_state, public.cr_rolls, public.cr_bets to authenticated;

-- -----------------------------------------------------------------------------
-- Open the game and seed one house table per stake level.
-- -----------------------------------------------------------------------------
update public.games set released = true where key = 'craps';

insert into public.game_tables (game_key, tier, name, max_seats, persistent)
select 'craps', v.tier, v.name, 8, true
  from (values ('low', 'Lucky Dice'), ('mid', 'Hot Hand'), ('high', 'High Roller Rail'), ('vip', 'Golden Arm')) v(tier, name)
 where not exists (
   select 1 from public.game_tables t where t.game_key = 'craps' and t.tier = v.tier and t.persistent
 );

select private.add_to_realtime('cr_state');
select private.add_to_realtime('cr_rolls');
select private.add_to_realtime('cr_bets');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

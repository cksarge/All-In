-- =============================================================================
-- All In · 09_poker.sql
-- Multiplayer poker for 2 to 9 players, fully server-side. One engine plays
-- five games (each is its own game in the lobby):
--   poker_holdem      No-limit Texas Hold'em        2 hole cards + 5 on the board
--   poker_omaha       Pot-limit Omaha               4 hole cards, use exactly 2 + 3
--   poker_omaha_hilo  Pot-limit Omaha Hi-Lo         split with the best low (8 or better)
--   poker_stud        Fixed-limit Seven-Card Stud   antes, bring-in, 3 down + 4 up
--   poker_draw        No-limit Five-Card Draw       one draw of up to 5 cards
--
-- Chips: players bring chips from their wallet to the table (table_seats.stack)
-- and can top up between hands. Chips go back to the wallet when the seat is
-- freed (see private.on_seat_removed in 05_tables.sql).
--
-- Hidden information:
--   pk_hole   each player's own cards. RLS: a player can only read their own rows.
--   pk_decks  the undealt deck. RLS on, no policies, no client privileges.
-- Other players' cards are only copied to the public pk_players.shown_cards at
-- showdown. Stud up-cards are public in pk_players.up_cards.
--
-- Timers: every decision has a 20 s clock. Any client at the table can call
-- pk_advance(); the SERVER checks the deadline and checks (if free) or folds for
-- whoever ran out of time, then sits them out. Players who left or lost their
-- connection are acted for straight away, so a closed tab never stalls a hand.
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.pk_hands (
  id                uuid primary key default gen_random_uuid(),
  table_id          uuid not null references public.game_tables (id) on delete cascade,
  hand_no           integer not null,
  game_key          text not null references public.games (key) on delete cascade,
  -- Betting round index into the game's street list (see private.pk_config).
  street            integer not null default 0,
  phase             text not null check (phase in ('betting', 'drawing', 'settled')),
  -- Turn deadline / draw deadline / when the next hand may start.
  phase_ends_at     timestamptz,
  button_seat       integer,
  sb_seat           integer,
  bb_seat           integer,
  bring_in_seat     integer,
  board             smallint[] not null default '{}',
  turn_seat         integer,
  current_bet       bigint not null default 0,  -- highest bet this street
  min_raise         bigint not null default 0,  -- size of the last full bet or raise
  full_bet          bigint not null default 0,  -- bet level of the last full bet/raise (reopens the action)
  bets_this_street  integer not null default 0, -- fixed-limit cap (bet + 3 raises)
  showdown          boolean not null default false,
  pots              jsonb,                      -- final pots and who won them
  created_at        timestamptz not null default now(),
  settled_at        timestamptz,
  unique (table_id, hand_no)
);

create index if not exists pk_hands_table_idx on public.pk_hands (table_id, hand_no desc);
create index if not exists pk_hands_open_idx on public.pk_hands (phase_ends_at) where phase <> 'settled';

-- Public, per-player state for a hand. No hidden cards here.
create table if not exists public.pk_players (
  hand_id      uuid not null references public.pk_hands (id) on delete cascade,
  table_id     uuid not null references public.game_tables (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  seat_no      integer not null,
  status       text not null default 'active' check (status in ('active', 'folded', 'allin')),
  stack_start  bigint not null default 0,
  street_bet   bigint not null default 0 check (street_bet >= 0),
  committed    bigint not null default 0 check (committed >= 0),
  acted        boolean not null default false,
  raise_level  bigint,          -- full_bet when they last acted this street (null = not yet)
  last_action  text,
  up_cards     smallint[] not null default '{}', -- Seven-Card Stud face-up cards
  drew         integer,         -- Five-Card Draw: cards exchanged (null = not yet)
  shown_cards  smallint[],      -- revealed at showdown
  hi_score     integer,
  lo_score     integer,
  hand_name    text,
  low_name     text,
  best_cards   smallint[],
  won          bigint not null default 0,
  primary key (hand_id, seat_no),
  unique (hand_id, user_id)
);

create index if not exists pk_players_table_idx on public.pk_players (table_id);
create index if not exists pk_players_user_idx on public.pk_players (user_id);

-- PRIVATE TO EACH PLAYER: their own cards (hole cards; in stud all seven).
create table if not exists public.pk_hole (
  hand_id   uuid not null references public.pk_hands (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  table_id  uuid not null references public.game_tables (id) on delete cascade,
  cards     smallint[] not null default '{}',
  primary key (hand_id, user_id)
);

-- HIDDEN: the undealt deck (and Five-Card Draw discards, reshuffled if the deck runs out).
create table if not exists public.pk_decks (
  hand_id   uuid primary key references public.pk_hands (id) on delete cascade,
  cards     smallint[] not null,
  pos       integer not null default 0,
  discards  smallint[] not null default '{}'
);

-- Top-ups asked for during a hand, added to the stack once the hand ends.
create table if not exists public.pk_topups (
  table_id  uuid not null references public.game_tables (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  amount    bigint not null check (amount > 0),
  primary key (table_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Game rules
-- -----------------------------------------------------------------------------
create or replace function private.pk_config(p_game text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select (case p_game
    when 'poker_holdem' then
      '{"family":"board","hole":2,"limit":"nl","omaha":false,"hilo":false,
        "streets":["Preflop","Flop","Turn","River"]}'
    when 'poker_omaha' then
      '{"family":"board","hole":4,"limit":"pl","omaha":true,"hilo":false,
        "streets":["Preflop","Flop","Turn","River"]}'
    when 'poker_omaha_hilo' then
      '{"family":"board","hole":4,"limit":"pl","omaha":true,"hilo":true,
        "streets":["Preflop","Flop","Turn","River"]}'
    when 'poker_stud' then
      '{"family":"stud","hole":7,"limit":"fl","omaha":false,"hilo":false,
        "streets":["Third street","Fourth street","Fifth street","Sixth street","Seventh street"]}'
    when 'poker_draw' then
      '{"family":"draw","hole":5,"limit":"nl","omaha":false,"hilo":false,
        "streets":["Before the draw","After the draw"]}'
  end)::jsonb
  || '{"turn_seconds":20,"draw_seconds":20,"next_hand_seconds":4,"showdown_seconds":8,"max_draw":5}'::jsonb;
$$;

-- Blinds, antes and stack limits for a table (from stake_tiers.params).
create or replace function private.pk_stakes(p_table uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select st.params from public.game_tables t
    join public.stake_tiers st on st.game_key = t.game_key and st.tier = t.tier
   where t.id = p_table;
$$;

-- Size of one bet: the big blind in big-bet games, small/big bet in fixed limit.
create or replace function private.pk_bet_unit(p_game text, p_stakes jsonb, p_street integer)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when private.pk_config(p_game) ->> 'limit' = 'fl' then
      case when p_street <= 1 then (p_stakes ->> 'small_bet')::bigint else (p_stakes ->> 'big_bet')::bigint end
    else (p_stakes ->> 'big_blind')::bigint
  end;
$$;

-- -----------------------------------------------------------------------------
-- Hand evaluation. Cards are 0..51: rank = c % 13 (0 = Ace … 12 = King), suit = c / 13.
-- -----------------------------------------------------------------------------
create or replace function private.pk_rank(c smallint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when c % 13 = 0 then 14 else c % 13 + 1 end;
$$;

-- Score 1 to 5 cards as a high hand; higher is better.
-- (category << 20) | five 4-bit ranks in order of importance.
-- Straights and flushes only count with exactly 5 cards (stud "showing" hands use fewer).
create or replace function private.pk_eval(c smallint[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  n integer := coalesce(cardinality(c), 0);
  r integer[] := '{}';
  rk integer[] := '{}';
  cnt integer[] := '{}';
  k integer := 0;
  i integer;
  j integer;
  a integer;
  b integer;
  v_flush boolean := false;
  v_top integer := 0;
  cat integer;
  v integer := 0;
begin
  if n = 0 then
    return 0;
  end if;
  for i in 1..n loop
    r := r || private.pk_rank(c[i]);
  end loop;
  for i in 2..n loop
    a := r[i];
    j := i - 1;
    while j >= 1 loop
      exit when r[j] >= a;
      r[j + 1] := r[j];
      j := j - 1;
    end loop;
    r[j + 1] := a;
  end loop;

  if n = 5 then
    v_flush := c[1] / 13 = c[2] / 13 and c[1] / 13 = c[3] / 13 and c[1] / 13 = c[4] / 13 and c[1] / 13 = c[5] / 13;
    if r[1] > r[2] and r[2] > r[3] and r[3] > r[4] and r[4] > r[5] then
      if r[1] - r[5] = 4 then
        v_top := r[1];
      elsif r[1] = 14 and r[2] = 5 then
        v_top := 5; -- the wheel, A-2-3-4-5
      end if;
    end if;
    if v_top > 0 and v_flush then
      return (8 << 20) | (v_top << 16);
    end if;
  end if;

  -- Runs of equal ranks, then order by count (desc), keeping rank order (desc).
  for i in 1..n loop
    if k > 0 and rk[k] = r[i] then
      cnt[k] := cnt[k] + 1;
    else
      k := k + 1;
      rk[k] := r[i];
      cnt[k] := 1;
    end if;
  end loop;
  for i in 2..k loop
    a := cnt[i];
    b := rk[i];
    j := i - 1;
    while j >= 1 loop
      exit when cnt[j] >= a;
      cnt[j + 1] := cnt[j];
      rk[j + 1] := rk[j];
      j := j - 1;
    end loop;
    cnt[j + 1] := a;
    rk[j + 1] := b;
  end loop;

  if cnt[1] = 4 then
    cat := 7;
  elsif cnt[1] = 3 and k >= 2 and cnt[2] >= 2 then
    cat := 6;
  elsif v_flush then
    cat := 5;
  elsif v_top > 0 then
    return (4 << 20) | (v_top << 16);
  elsif cnt[1] = 3 then
    cat := 3;
  elsif cnt[1] = 2 and k >= 2 and cnt[2] = 2 then
    cat := 2;
  elsif cnt[1] = 2 then
    cat := 1;
  else
    cat := 0;
  end if;
  for i in 1..5 loop
    v := (v << 4) | coalesce(rk[i], 0);
  end loop;
  return (cat << 20) | v;
end $$;

-- Score exactly 5 cards as an "8 or better" low (aces low); LOWER is better.
-- Null when the cards don't qualify (a pair, or any card above 8).
create or replace function private.pk_low5(c smallint[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  r integer[] := '{}';
  i integer;
  j integer;
  a integer;
  v integer := 0;
begin
  if coalesce(cardinality(c), 0) <> 5 then
    return null;
  end if;
  for i in 1..5 loop
    a := (c[i] % 13) + 1; -- ace = 1
    if a > 8 or a = any (r) then
      return null;
    end if;
    r := r || a;
  end loop;
  for i in 2..5 loop
    a := r[i];
    j := i - 1;
    while j >= 1 loop
      exit when r[j] >= a;
      r[j + 1] := r[j];
      j := j - 1;
    end loop;
    r[j + 1] := a;
  end loop;
  for i in 1..5 loop
    v := (v << 4) | r[i];
  end loop;
  return v;
end $$;

-- Best hand from hole + board cards.
--   p_omaha: must use exactly two hole cards and three board cards.
--   p_low:   find the best qualifying low instead of the best high.
create or replace function private.pk_best(
  p_hole smallint[], p_board smallint[], p_omaha boolean, p_low boolean default false,
  out score integer, out cards smallint[]
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_all smallint[];
  n integer;
  hc integer := coalesce(cardinality(p_hole), 0);
  bc integer := coalesce(cardinality(p_board), 0);
  v smallint[];
  s integer;
  i1 integer; i2 integer; i3 integer; i4 integer; i5 integer;
begin
  score := null;
  cards := null;
  if p_omaha then
    if hc < 2 or bc < 3 then
      return;
    end if;
    for i1 in 1..hc - 1 loop
      for i2 in i1 + 1..hc loop
        for i3 in 1..bc - 2 loop
          for i4 in i3 + 1..bc - 1 loop
            for i5 in i4 + 1..bc loop
              v := array[p_hole[i1], p_hole[i2], p_board[i3], p_board[i4], p_board[i5]];
              s := case when p_low then private.pk_low5(v) else private.pk_eval(v) end;
              if s is not null and (score is null or (p_low and s < score) or (not p_low and s > score)) then
                score := s;
                cards := v;
              end if;
            end loop;
          end loop;
        end loop;
      end loop;
    end loop;
    return;
  end if;

  v_all := coalesce(p_hole, '{}') || coalesce(p_board, '{}');
  n := coalesce(cardinality(v_all), 0);
  if n = 0 then
    return;
  end if;
  if n <= 5 then
    score := case when p_low then private.pk_low5(v_all) else private.pk_eval(v_all) end;
    cards := case when score is not null then v_all end;
    return;
  end if;
  for i1 in 1..n - 4 loop
    for i2 in i1 + 1..n - 3 loop
      for i3 in i2 + 1..n - 2 loop
        for i4 in i3 + 1..n - 1 loop
          for i5 in i4 + 1..n loop
            v := array[v_all[i1], v_all[i2], v_all[i3], v_all[i4], v_all[i5]];
            s := case when p_low then private.pk_low5(v) else private.pk_eval(v) end;
            if s is not null and (score is null or (p_low and s < score) or (not p_low and s > score)) then
              score := s;
              cards := v;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
end $$;

create or replace function private.pk_rank_name(v integer, p_plural boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_plural then
    (array['', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'])[v]
  else
    (array['', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'])[v]
  end;
$$;

create or replace function private.pk_hand_name(p_score integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cat integer;
  a integer;
  b integer;
begin
  if p_score is null or p_score = 0 then
    return null;
  end if;
  cat := p_score >> 20;
  a := (p_score >> 16) & 15;
  b := (p_score >> 12) & 15;
  return case cat
    when 8 then case when a = 14 then 'Royal flush' else 'Straight flush, ' || private.pk_rank_name(a, false) || ' high' end
    when 7 then 'Four of a kind, ' || private.pk_rank_name(a, true)
    when 6 then 'Full house, ' || private.pk_rank_name(a, true) || ' over ' || private.pk_rank_name(b, true)
    when 5 then 'Flush, ' || private.pk_rank_name(a, false) || ' high'
    when 4 then 'Straight, ' || private.pk_rank_name(a, false) || ' high'
    when 3 then 'Three of a kind, ' || private.pk_rank_name(a, true)
    when 2 then 'Two pair, ' || private.pk_rank_name(a, true) || ' and ' || private.pk_rank_name(b, true)
    when 1 then 'Pair of ' || private.pk_rank_name(a, true)
    else private.pk_rank_name(a, false) || ' high'
  end;
end $$;

create or replace function private.pk_low_name(p_score integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_score is null then null
    when p_score = 344865 then 'Wheel (5-4-3-2-A)' -- 0x54321
    else (select string_agg(case when d = 1 then 'A' else d::text end, '-' order by i)
            from (select i, (p_score >> (4 * (5 - i))) & 15 as d from generate_series(1, 5) i) q) || ' low'
  end;
$$;

-- -----------------------------------------------------------------------------
-- Engine helpers (private)
-- -----------------------------------------------------------------------------
create or replace function private.pk_lock_table(p_table uuid)
returns public.game_tables
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.game_tables;
begin
  select * into t from public.game_tables where id = p_table for update;
  if not found or t.game_key not like 'poker\_%' then
    raise exception 'table_not_found';
  end if;
  return t;
end $$;

create or replace function private.pk_latest_hand(p_table uuid)
returns public.pk_hands
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.pk_hands where table_id = p_table order by hand_no desc limit 1;
$$;

-- Seated here and connected?
create or replace function private.pk_present(p_table uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.table_seats
     where table_id = p_table and user_id = p_user
       and last_seen_at > now() - (select disconnected from private.seat_timeouts())
  );
$$;

create or replace function private.pk_shuffle(p_cards smallint[])
returns smallint[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  v smallint[] := p_cards;
  j integer;
  t smallint;
begin
  for i in reverse coalesce(cardinality(v), 0)..2 loop
    j := private.random_int(i) + 1;
    t := v[i]; v[i] := v[j]; v[j] := t;
  end loop;
  return v;
end $$;

-- Take n cards off the deck. If a Five-Card Draw deck runs out, the discards are shuffled in.
create or replace function private.pk_take(p_hand uuid, p_n integer)
returns smallint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.pk_decks;
  v smallint[] := '{}';
begin
  select * into d from public.pk_decks where hand_id = p_hand for update;
  for i in 1..p_n loop
    if d.pos >= cardinality(d.cards) then
      if cardinality(d.discards) = 0 then
        raise exception 'deck_empty';
      end if;
      d.cards := private.pk_shuffle(d.discards);
      d.discards := '{}';
      d.pos := 0;
    end if;
    d.pos := d.pos + 1;
    v := v || d.cards[d.pos];
  end loop;
  update public.pk_decks set cards = d.cards, pos = d.pos, discards = d.discards where hand_id = p_hand;
  return v;
end $$;

create or replace function private.pk_cards_left(p_hand uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select cardinality(cards) - pos from public.pk_decks where hand_id = p_hand;
$$;

-- Move chips from a player's table stack into the pot. Goes all-in if short.
create or replace function private.pk_commit(p_hand uuid, p_seat integer, p_amount bigint, p_street boolean)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pk_players;
  v_stack bigint;
  v_amt bigint;
begin
  select * into p from public.pk_players where hand_id = p_hand and seat_no = p_seat for update;
  select stack into v_stack from public.table_seats where table_id = p.table_id and user_id = p.user_id for update;
  v_amt := least(greatest(p_amount, 0), coalesce(v_stack, 0));
  if v_amt > 0 then
    update public.table_seats set stack = stack - v_amt where table_id = p.table_id and user_id = p.user_id;
  end if;
  update public.pk_players
     set committed  = committed + v_amt,
         street_bet = street_bet + case when p_street then v_amt else 0 end,
         status     = case when coalesce(v_stack, 0) - v_amt <= 0 and status = 'active' then 'allin' else status end
   where hand_id = p_hand and seat_no = p_seat;
  return v_amt;
end $$;

-- Pay a player: to their table stack if still seated, otherwise to their wallet.
create or replace function private.pk_pay(p_hand uuid, p_user uuid, p_amount bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.pk_hands;
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;
  select * into h from public.pk_hands where id = p_hand;
  update public.table_seats set stack = stack + p_amount where table_id = h.table_id and user_id = p_user;
  if not found and exists (select 1 from public.wallets where user_id = p_user) then
    perform private.apply_chips(p_user, p_amount, 'poker_pot', h.game_key, p_hand::text,
                                jsonb_build_object('hand_no', h.hand_no));
  end if;
end $$;

-- Does this player still have to act this street?
create or replace function private.pk_needs_action(p_hand uuid, p_seat integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pk_players p join public.pk_hands h on h.id = p.hand_id
     where p.hand_id = p_hand and p.seat_no = p_seat and p.status = 'active' and h.phase = 'betting'
       and (p.street_bet < h.current_bet
            or (not p.acted and (select count(*) from public.pk_players q where q.hand_id = p_hand and q.status = 'active') >= 2))
  );
$$;

-- Next seat (clockwise) that still has to act, starting after (or at) p_from.
create or replace function private.pk_next_need(p_hand uuid, p_from integer, p_inclusive boolean)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select p.seat_no from public.pk_players p
   where p.hand_id = p_hand and private.pk_needs_action(p_hand, p.seat_no)
   order by case when p.seat_no > p_from or (p_inclusive and p.seat_no = p_from) then 0 else 1 end, p.seat_no
   limit 1;
$$;

-- Raise limits for a player: whether they may raise, and the smallest/largest
-- total bet ("raise to") allowed this street.
create or replace function private.pk_raise_limits(p_hand uuid, p_seat integer,
  out can_raise boolean, out min_to bigint, out max_to bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h public.pk_hands;
  p public.pk_players;
  v_stack bigint;
  v_allin bigint;
  v_limit text;
  v_unit bigint;
  v_pot bigint;
  v_target bigint;
begin
  can_raise := false;
  select * into h from public.pk_hands where id = p_hand;
  select * into p from public.pk_players where hand_id = p_hand and seat_no = p_seat;
  select coalesce(stack, 0) into v_stack from public.table_seats where table_id = p.table_id and user_id = p.user_id;
  v_stack := coalesce(v_stack, 0);
  v_allin := p.street_bet + v_stack;
  min_to := v_allin;
  max_to := v_allin;
  if h.phase <> 'betting' or p.status <> 'active' or v_allin <= h.current_bet then
    return; -- can only call (all in) or check
  end if;
  if not exists (select 1 from public.pk_players q where q.hand_id = p_hand and q.status = 'active' and q.seat_no <> p_seat) then
    return; -- everyone else is all in
  end if;
  if p.raise_level is not null and h.full_bet <= p.raise_level then
    return; -- action wasn't reopened by a full raise
  end if;
  v_limit := private.pk_config(h.game_key) ->> 'limit';
  v_unit := private.pk_bet_unit(h.game_key, private.pk_stakes(h.table_id), h.street);
  if v_limit = 'fl' then
    if h.bets_this_street >= 4 then
      return;
    end if;
    v_target := case when h.current_bet < v_unit then v_unit else h.current_bet + v_unit end;
    min_to := least(v_target, v_allin);
    max_to := min_to;
  elsif v_limit = 'pl' then
    select coalesce(sum(committed), 0) into v_pot from public.pk_players where hand_id = p_hand;
    max_to := least(v_allin, h.current_bet + v_pot + (h.current_bet - p.street_bet));
    min_to := least(v_allin, h.current_bet + greatest(h.min_raise, v_unit));
  else
    max_to := v_allin;
    min_to := least(v_allin, h.current_bet + greatest(h.min_raise, v_unit));
  end if;
  can_raise := true;
end $$;

-- Apply top-ups waiting for players who aren't in a live hand.
create or replace function private.pk_apply_topups(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.pk_topups;
  v_game text;
begin
  for r in select * from public.pk_topups where table_id = p_table for update loop
    continue when exists (
      select 1 from public.pk_players p join public.pk_hands h on h.id = p.hand_id
       where h.table_id = p_table and h.phase <> 'settled' and p.user_id = r.user_id and p.status <> 'folded');
    delete from public.pk_topups where table_id = r.table_id and user_id = r.user_id;
    update public.table_seats set stack = stack + r.amount where table_id = p_table and user_id = r.user_id;
    if not found then
      select game_key into v_game from public.game_tables where id = p_table;
      perform private.apply_chips(r.user_id, r.amount, 'table_chips_out', v_game, p_table::text, '{}'::jsonb);
    end if;
  end loop;
end $$;

-- Split an amount between winners; odd chips go to the first winners clockwise from the button.
create or replace function private.pk_split(p_hand uuid, p_seats integer[], p_amount bigint, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.pk_hands;
  k integer := cardinality(p_seats);
  v_each bigint;
  v_rem bigint;
  v_share bigint;
  i integer := 0;
  s integer;
  v_out jsonb := '[]'::jsonb;
  v_name text;
begin
  if k = 0 or p_amount <= 0 then
    return v_out;
  end if;
  select * into h from public.pk_hands where id = p_hand;
  v_each := p_amount / k;
  v_rem := p_amount % k;
  for s in
    select x from unnest(p_seats) x
     order by case when x > coalesce(h.button_seat, 0) then 0 else 1 end, x
  loop
    i := i + 1;
    v_share := v_each + case when i <= v_rem then 1 else 0 end;
    update public.pk_players set won = won + v_share where hand_id = p_hand and seat_no = s
    returning case when p_kind = 'low' then low_name else hand_name end into v_name;
    v_out := v_out || jsonb_build_object('seat_no', s, 'amount', v_share, 'kind', p_kind, 'hand', v_name);
  end loop;
  return v_out;
end $$;

-- End the hand: return any uncalled bet, show down, build side pots, pay out,
-- record history.
create or replace function private.pk_settle(p_hand uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.pk_hands;
  cfg jsonb;
  r record;
  b record;
  v_top record;
  v_second bigint;
  v_live integer;
  v_levels bigint[];
  v_lvl bigint;
  v_prev bigint := 0;
  v_cap bigint;
  v_amount bigint;
  v_hi integer;
  v_lo integer;
  v_hi_seats integer[];
  v_lo_seats integer[];
  v_eligible integer[];
  v_lo_amt bigint;
  v_winners jsonb;
  v_pots jsonb := '[]'::jsonb;
  v_omaha boolean;
  v_hilo boolean;
begin
  select * into h from public.pk_hands where id = p_hand for update;
  if h.phase = 'settled' then
    return;
  end if;
  cfg := private.pk_config(h.game_key);
  v_omaha := (cfg ->> 'omaha')::boolean;
  v_hilo := (cfg ->> 'hilo')::boolean;
  update public.pk_players set street_bet = 0 where hand_id = p_hand;

  -- Any uncalled part of the biggest bet goes back to whoever made it
  -- (folded players' chips always stay in the pot).
  select seat_no, user_id, committed into v_top
    from public.pk_players where hand_id = p_hand and status <> 'folded' order by committed desc, seat_no limit 1;
  select coalesce(max(committed), 0) into v_second
    from public.pk_players where hand_id = p_hand and seat_no <> v_top.seat_no;
  if v_top.seat_no is not null and v_top.committed > v_second then
    update public.pk_players set committed = v_second where hand_id = p_hand and seat_no = v_top.seat_no;
    perform private.pk_pay(p_hand, v_top.user_id, v_top.committed - v_second);
  end if;

  select count(*) into v_live from public.pk_players where hand_id = p_hand and status <> 'folded';

  if v_live <= 1 then
    -- Everyone else folded: no showdown, no cards shown.
    select coalesce(sum(committed), 0) into v_amount from public.pk_players where hand_id = p_hand;
    select array_agg(seat_no) into v_hi_seats from public.pk_players where hand_id = p_hand and status <> 'folded';
    v_winners := private.pk_split(p_hand, coalesce(v_hi_seats, '{}'), v_amount, 'all');
    v_pots := jsonb_build_array(jsonb_build_object('amount', v_amount, 'winners', v_winners));
  else
    -- Showdown: every remaining player's cards are shown.
    for r in
      select p.seat_no, k.cards from public.pk_players p
        join public.pk_hole k on k.hand_id = p.hand_id and k.user_id = p.user_id
       where p.hand_id = p_hand and p.status <> 'folded'
    loop
      select * into b from private.pk_best(r.cards, h.board, v_omaha, false);
      update public.pk_players
         set shown_cards = r.cards, hi_score = b.score, hand_name = private.pk_hand_name(b.score), best_cards = b.cards
       where hand_id = p_hand and seat_no = r.seat_no;
      if v_hilo then
        select * into b from private.pk_best(r.cards, h.board, v_omaha, true);
        update public.pk_players
           set lo_score = b.score, low_name = private.pk_low_name(b.score),
               best_cards = case when b.cards is null then best_cards
                                 else array(select distinct x from unnest(best_cards || b.cards) x) end
         where hand_id = p_hand and seat_no = r.seat_no;
      end if;
    end loop;

    -- Main pot and side pots, one level per all-in amount.
    select array_agg(distinct committed order by committed) into v_levels
      from public.pk_players where hand_id = p_hand and status <> 'folded';
    foreach v_lvl in array v_levels loop
      v_cap := case when v_lvl = v_levels[cardinality(v_levels)]
                    then (select max(committed) from public.pk_players where hand_id = p_hand)
                    else v_lvl end;
      select coalesce(sum(least(committed, v_cap) - least(committed, v_prev)), 0) into v_amount
        from public.pk_players where hand_id = p_hand;
      if v_amount > 0 then
        select array_agg(seat_no order by seat_no) into v_eligible
          from public.pk_players where hand_id = p_hand and status <> 'folded' and committed >= v_lvl;
        select max(hi_score) into v_hi from public.pk_players where hand_id = p_hand and seat_no = any (v_eligible);
        select array_agg(seat_no order by seat_no) into v_hi_seats
          from public.pk_players where hand_id = p_hand and seat_no = any (v_eligible) and hi_score = v_hi;
        v_lo := null;
        if v_hilo then
          select min(lo_score) into v_lo from public.pk_players where hand_id = p_hand and seat_no = any (v_eligible);
        end if;
        if v_lo is not null then
          select array_agg(seat_no order by seat_no) into v_lo_seats
            from public.pk_players where hand_id = p_hand and seat_no = any (v_eligible) and lo_score = v_lo;
          v_lo_amt := v_amount / 2; -- the odd chip goes to the high hand
          v_winners := private.pk_split(p_hand, v_hi_seats, v_amount - v_lo_amt, 'high')
                    || private.pk_split(p_hand, v_lo_seats, v_lo_amt, 'low');
        else
          v_winners := private.pk_split(p_hand, v_hi_seats, v_amount, case when v_hilo then 'high' else 'all' end);
        end if;
        v_pots := v_pots || jsonb_build_object('amount', v_amount, 'eligible', to_jsonb(v_eligible), 'winners', v_winners);
      end if;
      v_prev := v_cap;
    end loop;
  end if;

  update public.pk_hands
     set phase = 'settled', settled_at = now(), turn_seat = null, pots = v_pots, showdown = v_live >= 2,
         phase_ends_at = now() + make_interval(secs => (cfg ->> case when v_live >= 2 then 'showdown_seconds' else 'next_hand_seconds' end)::int)
   where id = p_hand;

  for r in select * from public.pk_players where hand_id = p_hand loop
    perform private.pk_pay(p_hand, r.user_id, r.won);
    if r.committed > 0 or r.won > 0 then
      perform private.record_round(r.user_id, h.game_key, h.table_id, h.id, r.committed, r.won,
        jsonb_build_object('hand_no', h.hand_no, 'hand', coalesce(r.hand_name, case when r.status = 'folded' then 'Folded' end),
                           'low', r.low_name));
    end if;
  end loop;

  perform private.pk_apply_topups(h.table_id);
end $$;

-- First seat to act on a stud street: best showing hand.
create or replace function private.pk_stud_first(p_hand uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select seat_no from public.pk_players
   where hand_id = p_hand and status <> 'folded'
   order by private.pk_eval(up_cards) desc, seat_no
   limit 1;
$$;

-- Hand the action to the next player who has to act, or end the street.
create or replace function private.pk_open_betting(p_hand uuid, p_from integer, p_inclusive boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.pk_hands;
  v_seat integer;
begin
  select * into h from public.pk_hands where id = p_hand;
  v_seat := private.pk_next_need(p_hand, p_from, p_inclusive);
  if v_seat is null then
    perform private.pk_end_street(p_hand);
    return;
  end if;
  update public.pk_hands
     set turn_seat = v_seat,
         phase_ends_at = now() + make_interval(secs => (private.pk_config(h.game_key) ->> 'turn_seconds')::int)
   where id = p_hand;
end $$;

-- Betting on this street is done: deal the next street, start the draw, or show down.
create or replace function private.pk_end_street(p_hand uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.pk_hands;
  cfg jsonb;
  v_last integer;
  v_live integer;
  v_cards smallint[];
  r record;
begin
  select * into h from public.pk_hands where id = p_hand for update;
  if h.phase = 'settled' then
    return;
  end if;
  cfg := private.pk_config(h.game_key);
  v_last := jsonb_array_length(cfg -> 'streets') - 1;

  update public.pk_players
     set street_bet = 0, acted = false, raise_level = null,
         last_action = case when status = 'allin' then 'All in' when status = 'folded' then last_action end
   where hand_id = p_hand;
  update public.pk_hands set current_bet = 0, full_bet = 0, bets_this_street = 0, turn_seat = null where id = p_hand;

  select count(*) into v_live from public.pk_players where hand_id = p_hand and status <> 'folded';
  if v_live <= 1 then
    perform private.pk_settle(p_hand);
    return;
  end if;

  if cfg ->> 'family' = 'draw' and h.street = 0 then
    update public.pk_hands
       set phase = 'drawing', phase_ends_at = now() + make_interval(secs => (cfg ->> 'draw_seconds')::int)
     where id = p_hand;
    return;
  end if;

  if h.street >= v_last then
    perform private.pk_settle(p_hand);
    return;
  end if;

  -- Deal the next street.
  h.street := h.street + 1;
  if cfg ->> 'family' = 'board' then
    perform private.pk_take(p_hand, 1); -- burn
    v_cards := private.pk_take(p_hand, case when h.street = 1 then 3 else 1 end);
    update public.pk_hands set board = board || v_cards where id = p_hand;
  elsif cfg ->> 'family' = 'stud' then
    if h.street = 4 and private.pk_cards_left(p_hand) < v_live then
      -- Not enough cards left for everyone: one shared card in the middle.
      update public.pk_hands set board = board || private.pk_take(p_hand, 1) where id = p_hand;
    else
      for r in select seat_no, user_id from public.pk_players where hand_id = p_hand and status <> 'folded' order by seat_no loop
        v_cards := private.pk_take(p_hand, 1);
        update public.pk_hole set cards = cards || v_cards where hand_id = p_hand and user_id = r.user_id;
        if h.street < 4 then
          update public.pk_players set up_cards = up_cards || v_cards where hand_id = p_hand and seat_no = r.seat_no;
        end if;
      end loop;
    end if;
  end if;

  update public.pk_hands
     set street = h.street, phase = 'betting',
         min_raise = private.pk_bet_unit(h.game_key, private.pk_stakes(h.table_id), h.street)
   where id = p_hand;

  if cfg ->> 'family' = 'stud' then
    perform private.pk_open_betting(p_hand, private.pk_stud_first(p_hand), true);
  else
    perform private.pk_open_betting(p_hand, coalesce(h.button_seat, 0), false);
  end if;
end $$;

-- Draw finished (everyone drew or time ran out): second betting round.
create or replace function private.pk_finish_draw(p_hand uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.pk_hands;
begin
  select * into h from public.pk_hands where id = p_hand for update;
  if h.phase <> 'drawing' then
    return;
  end if;
  update public.pk_hands
     set street = 1, phase = 'betting',
         min_raise = private.pk_bet_unit(h.game_key, private.pk_stakes(h.table_id), 1)
   where id = p_hand;
  perform private.pk_open_betting(p_hand, coalesce(h.button_seat, 0), false);
end $$;

-- After any action: settle if one player is left, finish the draw, or move the turn on.
create or replace function private.pk_progress(p_hand uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.pk_hands;
begin
  select * into h from public.pk_hands where id = p_hand for update;
  if h.phase = 'settled' then
    return;
  end if;
  if (select count(*) from public.pk_players where hand_id = p_hand and status <> 'folded') <= 1 then
    perform private.pk_settle(p_hand);
    return;
  end if;
  if h.phase = 'drawing' then
    if not exists (select 1 from public.pk_players where hand_id = p_hand and status <> 'folded' and drew is null) then
      perform private.pk_finish_draw(p_hand);
    end if;
    return;
  end if;
  if h.turn_seat is not null and private.pk_needs_action(p_hand, h.turn_seat) then
    return;
  end if;
  perform private.pk_open_betting(p_hand, coalesce(h.turn_seat, 0), false);
end $$;

-- Apply one betting action for the player in p_seat (validated here).
-- p_amount for 'raise'/'bet' is the total bet this street ("raise to").
create or replace function private.pk_do_action(p_hand uuid, p_seat integer, p_action text, p_amount bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.pk_hands;
  p public.pk_players;
  v_stack bigint;
  v_to_call bigint;
  lim record;
  v_to bigint;
  v_allin bigint;
  v_inc bigint;
  v_full boolean;
  v_label text;
  v_limit text;
  v_unit bigint;
begin
  select * into h from public.pk_hands where id = p_hand for update;
  select * into p from public.pk_players where hand_id = p_hand and seat_no = p_seat for update;
  if h.phase <> 'betting' or h.turn_seat is distinct from p_seat or p.status <> 'active' then
    raise exception 'not_your_turn';
  end if;
  select stack into v_stack from public.table_seats where table_id = p.table_id and user_id = p.user_id;
  v_stack := coalesce(v_stack, 0);
  v_to_call := greatest(h.current_bet - p.street_bet, 0);
  v_allin := p.street_bet + v_stack;
  v_limit := private.pk_config(h.game_key) ->> 'limit';

  if p_action = 'allin' then
    -- All in: a call if it doesn't cover the bet, otherwise a raise for everything.
    if v_allin <= h.current_bet then
      p_action := 'call';
    else
      p_action := 'raise';
      p_amount := v_allin;
    end if;
  end if;

  if p_action = 'fold' then
    update public.pk_players set status = 'folded', acted = true, last_action = 'Fold'
     where hand_id = p_hand and seat_no = p_seat;
  elsif p_action = 'check' then
    if v_to_call > 0 then
      raise exception 'action_not_allowed' using hint = 'There''s a bet to call.';
    end if;
    update public.pk_players set acted = true, raise_level = h.full_bet, last_action = 'Check'
     where hand_id = p_hand and seat_no = p_seat;
  elsif p_action = 'call' then
    if v_to_call <= 0 then
      raise exception 'action_not_allowed' using hint = 'Nothing to call. Check instead.';
    end if;
    perform private.pk_commit(p_hand, p_seat, v_to_call, true);
    update public.pk_players
       set acted = true, raise_level = h.full_bet,
           last_action = case when status = 'allin' then 'All in' else 'Call' end
     where hand_id = p_hand and seat_no = p_seat;
  elsif p_action in ('raise', 'bet') then
    select * into lim from private.pk_raise_limits(p_hand, p_seat);
    if not lim.can_raise then
      raise exception 'action_not_allowed' using hint = 'You can''t raise right now.';
    end if;
    v_to := p_amount;
    if v_to is null then
      raise exception 'invalid_amount';
    end if;
    if v_to >= v_allin and v_allin <= lim.max_to then
      v_to := v_allin; -- everything: always allowed, even if short of a full raise
    elsif v_to < lim.min_to or v_to > lim.max_to then
      raise exception 'bet_out_of_range'
        using hint = case when lim.min_to = lim.max_to then format('The bet here is %s chips.', lim.min_to)
                          else format('Bet between %s and %s chips.', lim.min_to, lim.max_to) end;
    end if;
    if v_to <= h.current_bet then
      raise exception 'action_not_allowed';
    end if;
    v_unit := private.pk_bet_unit(h.game_key, private.pk_stakes(h.table_id), h.street);
    v_label := case when v_to = v_allin then 'All in'
                    when h.current_bet = 0 then 'Bet'
                    when v_limit = 'fl' and h.full_bet = 0 then 'Complete'
                    else 'Raise' end;
    perform private.pk_commit(p_hand, p_seat, v_to - p.street_bet, true);
    v_inc := v_to - h.current_bet;
    -- A full bet/raise reopens the action; a short all-in doesn't.
    if v_limit = 'fl' then
      v_full := v_to >= case when h.current_bet < v_unit then v_unit else h.current_bet + v_unit end;
    else
      v_full := v_inc >= greatest(h.min_raise, v_unit);
    end if;
    if v_full then
      update public.pk_hands
         set current_bet = v_to, full_bet = v_to, bets_this_street = bets_this_street + 1,
             min_raise = case when v_limit = 'fl' then min_raise else greatest(min_raise, v_inc) end
       where id = p_hand;
    else
      update public.pk_hands set current_bet = v_to where id = p_hand;
    end if;
    -- Everyone else still in has to respond.
    update public.pk_players set acted = false
     where hand_id = p_hand and status = 'active' and seat_no <> p_seat;
    update public.pk_players
       set acted = true, raise_level = case when v_full then v_to else h.full_bet end, last_action = v_label
     where hand_id = p_hand and seat_no = p_seat;
  else
    raise exception 'action_not_allowed';
  end if;

  perform private.pk_progress(p_hand);
end $$;

-- Deal a new hand if at least two connected players with chips are ready.
create or replace function private.pk_start_hand(p_table uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.game_tables;
  cfg jsonb;
  st jsonb;
  prev public.pk_hands;
  h public.pk_hands;
  v_seats integer[];
  v_button integer;
  v_sb integer;
  v_bb integer;
  v_bring integer;
  v_post bigint;
  v_disc interval := (select disconnected from private.seat_timeouts());
  r record;
  v_cards smallint[];
begin
  select * into t from public.game_tables where id = p_table;
  if t.status <> 'open' then
    return false;
  end if;
  cfg := private.pk_config(t.game_key);
  st := private.pk_stakes(p_table);
  perform private.pk_apply_topups(p_table);

  select array_agg(seat_no order by seat_no) into v_seats
    from public.table_seats
   where table_id = p_table and status = 'active' and stack > 0 and last_seen_at > now() - v_disc;
  if coalesce(cardinality(v_seats), 0) < 2 then
    return false;
  end if;

  prev := private.pk_latest_hand(p_table);
  select x into v_button from unnest(v_seats) x
   order by case when x > coalesce(prev.button_seat, 0) then 0 else 1 end, x limit 1;

  insert into public.pk_hands (table_id, hand_no, game_key, street, phase, button_seat, min_raise)
  values (p_table, coalesce(prev.hand_no, 0) + 1, t.game_key, 0, 'betting',
          case when cfg ->> 'family' <> 'stud' then v_button end,
          private.pk_bet_unit(t.game_key, st, 0))
  returning * into h;
  insert into public.pk_decks (hand_id, cards) values (h.id, private.shuffled_shoe(1));
  insert into public.pk_players (hand_id, table_id, user_id, seat_no, stack_start)
  select h.id, p_table, s.user_id, s.seat_no, s.stack
    from public.table_seats s where s.table_id = p_table and s.seat_no = any (v_seats);

  -- Antes
  if coalesce((st ->> 'ante')::bigint, 0) > 0 then
    for r in select seat_no from public.pk_players where hand_id = h.id order by seat_no loop
      perform private.pk_commit(h.id, r.seat_no, (st ->> 'ante')::bigint, false);
    end loop;
    update public.pk_players set last_action = 'Ante' where hand_id = h.id;
  end if;

  -- Deal
  for r in select seat_no, user_id from public.pk_players where hand_id = h.id order by seat_no loop
    v_cards := private.pk_take(h.id, case when cfg ->> 'family' = 'stud' then 3 else (cfg ->> 'hole')::int end);
    insert into public.pk_hole (hand_id, user_id, table_id, cards) values (h.id, r.user_id, p_table, v_cards);
    if cfg ->> 'family' = 'stud' then
      update public.pk_players set up_cards = array[v_cards[3]] where hand_id = h.id and seat_no = r.seat_no;
    end if;
  end loop;

  if cfg ->> 'family' = 'stud' then
    -- Lowest up card brings it in (suits break ties: clubs, diamonds, hearts, spades).
    select seat_no into v_bring from public.pk_players where hand_id = h.id
     order by private.pk_rank(up_cards[1]),
              case up_cards[1] / 13 when 3 then 0 when 2 then 1 when 1 then 2 else 3 end
     limit 1;
    v_post := private.pk_commit(h.id, v_bring, (st ->> 'bring_in')::bigint, true);
    update public.pk_players set acted = true, raise_level = 0, last_action = 'Bring-in'
     where hand_id = h.id and seat_no = v_bring;
    update public.pk_hands set bring_in_seat = v_bring, current_bet = v_post where id = h.id;
    perform private.pk_open_betting(h.id, v_bring, false);
  else
    if cardinality(v_seats) = 2 then
      v_sb := v_button; -- heads-up: the button posts the small blind and acts first before the flop
    else
      select x into v_sb from unnest(v_seats) x order by case when x > v_button then 0 else 1 end, x limit 1;
    end if;
    select x into v_bb from unnest(v_seats) x order by case when x > v_sb then 0 else 1 end, x limit 1;
    perform private.pk_commit(h.id, v_sb, (st ->> 'small_blind')::bigint, true);
    perform private.pk_commit(h.id, v_bb, (st ->> 'big_blind')::bigint, true);
    update public.pk_players set last_action = 'Small blind' where hand_id = h.id and seat_no = v_sb;
    update public.pk_players set last_action = 'Big blind' where hand_id = h.id and seat_no = v_bb;
    update public.pk_hands
       set sb_seat = v_sb, bb_seat = v_bb,
           current_bet = (select max(street_bet) from public.pk_players where hand_id = h.id),
           full_bet = (select max(street_bet) from public.pk_players where hand_id = h.id),
           min_raise = (st ->> 'big_blind')::bigint
     where id = h.id;
    perform private.pk_open_betting(h.id, v_bb, false);
  end if;

  update public.game_tables set last_activity_at = now() where id = p_table;
  return true;
end $$;

-- Run the table forward: act for players who timed out or left, finish the
-- draw, and deal the next hand when it's time.
create or replace function private.pk_tick(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.pk_hands;
  p public.pk_players;
  v_present boolean;
  v_changed integer;
  i integer := 0;
begin
  loop
    i := i + 1;
    exit when i > 40;
    h := private.pk_latest_hand(p_table);
    if h.id is null or h.phase = 'settled' then
      exit when h.id is not null and h.phase_ends_at > now();
      exit when not private.pk_start_hand(p_table);
      continue;
    end if;

    if h.phase = 'betting' then
      select * into p from public.pk_players where hand_id = h.id and seat_no = h.turn_seat;
      if not found then
        perform private.pk_progress(h.id);
        exit when (select turn_seat from public.pk_hands where id = h.id) is not distinct from h.turn_seat;
        continue;
      end if;
      v_present := private.pk_present(p_table, p.user_id);
      exit when v_present and h.phase_ends_at > now();
      perform private.pk_do_action(h.id, p.seat_no,
        case when h.current_bet > p.street_bet then 'fold' else 'check' end, null);
      if v_present then
        -- Ran out of time: sit them out from the next hand.
        update public.table_seats set status = 'sitting_out' where table_id = p_table and user_id = p.user_id;
      end if;
    elsif h.phase = 'drawing' then
      update public.pk_players p2 set drew = 0, last_action = 'Stands pat'
       where p2.hand_id = h.id and p2.status <> 'folded' and p2.drew is null
         and (h.phase_ends_at <= now() or not private.pk_present(p_table, p2.user_id));
      get diagnostics v_changed = row_count;
      exit when v_changed = 0;
      perform private.pk_progress(h.id);
    else
      exit;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------

-- Everything a client needs to draw the table. Includes only YOUR hole cards.
create or replace function public.pk_state(p_table uuid)
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
  cfg jsonb;
  h public.pk_hands;
  me public.pk_players;
  v_hole smallint[];
  v_disc interval := (select disconnected from private.seat_timeouts());
  v_me jsonb := null;
  b record;
  lo record;
  lim record;
  v_stack bigint;
  v_to_call bigint;
begin
  if not private.can_view_table(p_table) then
    raise exception 'table_not_found';
  end if;
  select * into t from public.game_tables where id = p_table;
  if t.game_key not like 'poker\_%' then
    raise exception 'table_not_found';
  end if;
  select * into st from public.stake_tiers where game_key = t.game_key and tier = t.tier;
  cfg := private.pk_config(t.game_key);
  h := private.pk_latest_hand(p_table);

  select stack into v_stack from public.table_seats where table_id = p_table and user_id = v_uid;
  if h.id is not null then
    select * into me from public.pk_players where hand_id = h.id and user_id = v_uid;
    select cards into v_hole from public.pk_hole where hand_id = h.id and user_id = v_uid;
  end if;

  if v_stack is not null or me.user_id is not null then
    v_me := jsonb_build_object(
      'stack', coalesce(v_stack, 0),
      'pending_topup', coalesce((select amount from public.pk_topups where table_id = p_table and user_id = v_uid), 0),
      'in_hand', me.user_id is not null and h.phase <> 'settled' and me.status <> 'folded',
      'seat_no', me.seat_no,
      'hole', to_jsonb(v_hole)
    );
    if v_hole is not null then
      select * into b from private.pk_best(v_hole, h.board, (cfg ->> 'omaha')::boolean, false);
      v_me := v_me || jsonb_build_object('hand_name', private.pk_hand_name(b.score), 'best_cards', to_jsonb(b.cards));
      if (cfg ->> 'hilo')::boolean then
        select * into lo from private.pk_best(v_hole, h.board, true, true);
        v_me := v_me || jsonb_build_object('low_name', private.pk_low_name(lo.score));
      end if;
    end if;
    if me.user_id is not null and h.phase = 'betting' and h.turn_seat = me.seat_no and me.status = 'active' then
      v_to_call := greatest(h.current_bet - me.street_bet, 0);
      select * into lim from private.pk_raise_limits(h.id, me.seat_no);
      v_me := v_me || jsonb_build_object('options', jsonb_build_object(
        'to_call', least(v_to_call, coalesce(v_stack, 0)),
        'can_check', v_to_call = 0,
        'can_call', v_to_call > 0,
        'call_is_all_in', v_to_call > 0 and v_to_call >= coalesce(v_stack, 0),
        'can_raise', lim.can_raise,
        'is_bet', h.current_bet = 0 or (cfg ->> 'limit' = 'fl' and h.full_bet = 0),
        'min_to', lim.min_to,
        'max_to', lim.max_to,
        'all_in_to', me.street_bet + coalesce(v_stack, 0)
      ));
    end if;
    if me.user_id is not null and h.phase = 'drawing' and me.status <> 'folded' and me.drew is null then
      v_me := v_me || jsonb_build_object('can_draw', true);
    end if;
  end if;

  return jsonb_build_object(
    'server_now', now(),
    'config', cfg,
    'table', jsonb_build_object(
      'id', t.id, 'name', t.name, 'game_key', t.game_key, 'tier', t.tier, 'tier_label', st.label,
      'max_seats', t.max_seats, 'is_private', t.is_private, 'status', t.status,
      'invite_code', case when t.is_private then t.invite_code end,
      'stakes', st.params
    ),
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seat_no', s.seat_no, 'user_id', s.user_id, 'username', pr.username, 'stack', s.stack,
               'status', s.status, 'connected', s.last_seen_at > now() - v_disc) order by s.seat_no)
        from public.table_seats s join public.profiles pr on pr.id = s.user_id
       where s.table_id = p_table), '[]'::jsonb),
    'hand', case when h.id is null then null else jsonb_build_object(
      'id', h.id, 'hand_no', h.hand_no, 'street', h.street, 'street_name', cfg -> 'streets' ->> h.street,
      'phase', h.phase, 'phase_ends_at', h.phase_ends_at, 'button_seat', h.button_seat,
      'sb_seat', h.sb_seat, 'bb_seat', h.bb_seat, 'bring_in_seat', h.bring_in_seat,
      'board', to_jsonb(h.board), 'turn_seat', h.turn_seat, 'current_bet', h.current_bet,
      'pot', (select coalesce(sum(committed - street_bet), 0) from public.pk_players where hand_id = h.id),
      'total_pot', (select coalesce(sum(committed), 0) from public.pk_players where hand_id = h.id),
      'showdown', h.showdown, 'pots', h.pots, 'settled_at', h.settled_at
    ) end,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seat_no', p.seat_no, 'user_id', p.user_id, 'username', pr.username, 'status', p.status,
               'stack_start', p.stack_start, 'street_bet', p.street_bet, 'committed', p.committed,
               'last_action', p.last_action, 'up_cards', to_jsonb(p.up_cards),
               'card_count', coalesce(cardinality(k.cards), 0), 'drew', p.drew,
               'shown_cards', to_jsonb(p.shown_cards), 'hand_name', p.hand_name, 'low_name', p.low_name,
               'best_cards', to_jsonb(p.best_cards), 'won', p.won) order by p.seat_no)
        from public.pk_players p
        join public.profiles pr on pr.id = p.user_id
        left join public.pk_hole k on k.hand_id = p.hand_id and k.user_id = p.user_id
       where p.hand_id = h.id), '[]'::jsonb),
    'me', v_me,
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('hand_no', x.hand_no, 'board', to_jsonb(x.board), 'winners', x.winners)
                       order by x.hand_no desc)
        from (select hh.hand_no, hh.board,
                     (select jsonb_agg(jsonb_build_object('username', pr.username, 'won', p.won, 'hand', p.hand_name) order by p.won desc)
                        from public.pk_players p join public.profiles pr on pr.id = p.user_id
                       where p.hand_id = hh.id and p.won > 0) as winners
                from public.pk_hands hh
               where hh.table_id = p_table and hh.phase = 'settled'
               order by hh.hand_no desc limit 10) x), '[]'::jsonb)
  );
end $$;

-- Fold, check, call, bet/raise (p_amount = total bet this street) or all in.
create or replace function public.pk_action(p_table uuid, p_action text, p_amount bigint default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  h public.pk_hands;
  v_seat integer;
begin
  perform private.pk_lock_table(p_table);
  h := private.pk_latest_hand(p_table);
  if h.id is null or h.phase <> 'betting' then
    raise exception 'not_your_turn';
  end if;
  select seat_no into v_seat from public.pk_players where hand_id = h.id and user_id = v_uid;
  if v_seat is null or v_seat is distinct from h.turn_seat then
    raise exception 'not_your_turn';
  end if;
  if lower(coalesce(p_action, '')) not in ('fold', 'check', 'call', 'bet', 'raise', 'allin') then
    raise exception 'action_not_allowed';
  end if;
  update public.table_seats set last_seen_at = now() where table_id = p_table and user_id = v_uid;
  perform private.pk_do_action(h.id, v_seat, lower(p_action), p_amount);
  perform private.pk_tick(p_table);
  update public.game_tables set last_activity_at = now() where id = p_table;
end $$;

-- Five-Card Draw: swap the given cards (from your own hand) for new ones. Empty = stand pat.
create or replace function public.pk_draw(p_table uuid, p_discards smallint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  h public.pk_hands;
  p public.pk_players;
  v_hole smallint[];
  v_new smallint[];
  v_disc smallint[] := coalesce(p_discards, '{}');
  v_n integer;
  i integer;
  j integer := 0;
begin
  perform private.pk_lock_table(p_table);
  h := private.pk_latest_hand(p_table);
  if h.id is null or h.phase <> 'drawing' then
    raise exception 'action_not_allowed';
  end if;
  select * into p from public.pk_players where hand_id = h.id and user_id = v_uid for update;
  if not found or p.status = 'folded' or p.drew is not null then
    raise exception 'action_not_allowed';
  end if;
  select cards into v_hole from public.pk_hole where hand_id = h.id and user_id = v_uid for update;
  v_n := coalesce(cardinality(v_disc), 0);
  if v_n > (private.pk_config(h.game_key) ->> 'max_draw')::int
     or v_n <> (select count(distinct x) from unnest(v_disc) x)
     or exists (select 1 from unnest(v_disc) x where not (x = any (v_hole))) then
    raise exception 'invalid_discard';
  end if;
  if v_n > 0 then
    v_new := private.pk_take(h.id, v_n);
    for i in 1..cardinality(v_hole) loop
      if v_hole[i] = any (v_disc) then
        j := j + 1;
        v_hole[i] := v_new[j];
      end if;
    end loop;
    update public.pk_hole set cards = v_hole where hand_id = h.id and user_id = v_uid;
    update public.pk_decks set discards = discards || v_disc where hand_id = h.id;
  end if;
  update public.pk_players
     set drew = v_n, last_action = case when v_n = 0 then 'Stands pat' when v_n = 1 then 'Draws 1' else 'Draws ' || v_n end
   where hand_id = h.id and seat_no = p.seat_no;
  update public.table_seats set last_seen_at = now() where table_id = p_table and user_id = v_uid;
  perform private.pk_progress(h.id);
  perform private.pk_tick(p_table);
end $$;

-- Bring chips from your wallet to the table, or top up. During a hand you're in,
-- the top-up waits until the hand ends.
create or replace function public.pk_bring_chips(p_table uuid, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.game_tables;
  st jsonb;
  s public.table_seats;
  v_pending bigint;
  v_in_hand boolean;
  v_total bigint;
begin
  t := private.pk_lock_table(p_table);
  st := private.pk_stakes(p_table);
  select * into s from public.table_seats where table_id = p_table and user_id = v_uid for update;
  if not found then
    raise exception 'not_seated';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'invalid_amount';
  end if;
  v_pending := coalesce((select amount from public.pk_topups where table_id = p_table and user_id = v_uid), 0);
  v_in_hand := exists (
    select 1 from public.pk_players p join public.pk_hands h on h.id = p.hand_id
     where h.table_id = p_table and h.phase <> 'settled' and p.user_id = v_uid and p.status <> 'folded');
  v_total := s.stack + v_pending + p_amount;
  if v_total > (st ->> 'max_stack')::bigint then
    raise exception 'above_max_stack'
      using hint = format('You can have up to %s chips at this table.', st ->> 'max_stack');
  end if;
  if s.stack + v_pending = 0 and not v_in_hand and v_total < (st ->> 'min_stack')::bigint then
    raise exception 'below_min_stack'
      using hint = format('Bring at least %s chips to sit in.', st ->> 'min_stack');
  end if;

  perform private.apply_chips(v_uid, -p_amount, 'table_chips_in', t.game_key, p_table::text,
                              jsonb_build_object('seat_no', s.seat_no));
  if v_in_hand then
    insert into public.pk_topups (table_id, user_id, amount) values (p_table, v_uid, p_amount)
    on conflict (table_id, user_id) do update set amount = public.pk_topups.amount + excluded.amount;
  else
    update public.table_seats set stack = stack + p_amount, last_seen_at = now()
     where table_id = p_table and user_id = v_uid;
  end if;
  update public.game_tables set last_activity_at = now() where id = p_table;
  perform private.pk_tick(p_table);
  return jsonb_build_object('stack', (select stack from public.table_seats where table_id = p_table and user_id = v_uid),
                            'pending', case when v_in_hand then v_pending + p_amount else 0 end);
end $$;

-- Process expired timers and deal the next hand. Any player who can see the
-- table may call it; the server decides what's due.
create or replace function public.pk_advance(p_table uuid)
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
  perform private.pk_lock_table(p_table);
  perform private.pk_tick(p_table);
end $$;

-- Your recent hands at this table: your cards, the board, what was shown and who won.
create or replace function public.pk_hand_history(p_table uuid, p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.j order by x.hand_no desc), '[]'::jsonb)
    from (
      select h.hand_no, jsonb_build_object(
               'hand_no', h.hand_no, 'game_key', h.game_key, 'played_at', h.created_at, 'board', to_jsonb(h.board),
               'my_cards', to_jsonb(k.cards), 'my_committed', me.committed, 'my_won', me.won,
               'my_status', me.status, 'my_hand', me.hand_name,
               'pots', h.pots, 'showdown', h.showdown,
               'players', (select jsonb_agg(jsonb_build_object(
                                  'seat_no', p.seat_no, 'username', pr.username, 'status', p.status,
                                  'committed', p.committed, 'won', p.won, 'shown_cards', to_jsonb(p.shown_cards),
                                  'up_cards', to_jsonb(p.up_cards), 'hand_name', p.hand_name, 'low_name', p.low_name)
                                  order by p.seat_no)
                             from public.pk_players p join public.profiles pr on pr.id = p.user_id
                            where p.hand_id = h.id)) as j
        from public.pk_hands h
        join public.pk_players me on me.hand_id = h.id and me.user_id = auth.uid()
        left join public.pk_hole k on k.hand_id = h.id and k.user_id = auth.uid()
       where h.table_id = p_table and h.phase = 'settled' and auth.uid() is not null
       order by h.hand_no desc
       limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) x;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.pk_state(uuid)', 'public.pk_action(uuid, text, bigint)', 'public.pk_draw(uuid, smallint[])',
    'public.pk_bring_chips(uuid, bigint)', 'public.pk_advance(uuid)', 'public.pk_hand_history(uuid, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Plug-ins for the shared table code (05_tables.sql)
-- -----------------------------------------------------------------------------

-- Finish poker hands whose timers expired while nobody was watching.
create or replace function private.pk_tick_stale()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table uuid;
begin
  for v_table in
    select distinct h.table_id from public.pk_hands h
     where h.phase <> 'settled' and h.phase_ends_at < now() - interval '2 seconds'
  loop
    perform private.pk_lock_table(v_table);
    perform private.pk_tick(v_table);
  end loop;
end $$;

-- Chips in unfinished pots and top-ups waiting for the hand to end. (Chips
-- sitting in front of you at the table are counted from table_seats.stack.)
create or replace function private.pk_in_play(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (select coalesce(sum(p.committed), 0) from public.pk_players p join public.pk_hands h on h.id = p.hand_id
           where p.user_id = p_user and h.phase <> 'settled')
       + (select coalesce(sum(amount), 0) from public.pk_topups where user_id = p_user);
$$;

-- A seat was freed: return waiting top-ups and fold the player's live hand.
create or replace function private.pk_seat_left(p_table uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount bigint;
  v_game text;
  h public.pk_hands;
begin
  select game_key into v_game from public.game_tables where id = p_table;
  if v_game is null or v_game not like 'poker\_%' then
    return;
  end if;
  perform private.pk_lock_table(p_table);

  delete from public.pk_topups where table_id = p_table and user_id = p_user returning amount into v_amount;
  if v_amount is not null and exists (select 1 from public.wallets where user_id = p_user) then
    perform private.apply_chips(p_user, v_amount, 'table_chips_out', v_game, p_table::text, '{}'::jsonb);
  end if;

  h := private.pk_latest_hand(p_table);
  if h.id is null or h.phase = 'settled' then
    return;
  end if;
  update public.pk_players set status = 'folded', last_action = 'Left'
   where hand_id = h.id and user_id = p_user and status = 'active';
  if found then
    perform private.pk_progress(h.id);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.pk_hands   enable row level security;
alter table public.pk_players enable row level security;
alter table public.pk_hole    enable row level security;
alter table public.pk_decks   enable row level security;
alter table public.pk_topups  enable row level security;

drop policy if exists "pk_hands: hands at visible tables" on public.pk_hands;
create policy "pk_hands: hands at visible tables"
  on public.pk_hands for select
  to authenticated
  using (private.can_view_table(table_id));

drop policy if exists "pk_players: players at visible tables" on public.pk_players;
create policy "pk_players: players at visible tables"
  on public.pk_players for select
  to authenticated
  using (private.can_view_table(table_id));

-- Hole cards: ONLY your own.
drop policy if exists "pk_hole: own cards only" on public.pk_hole;
create policy "pk_hole: own cards only"
  on public.pk_hole for select
  to authenticated
  using (user_id = (select auth.uid()));

-- pk_decks and pk_topups: RLS on, NO policies, NO privileges. Unreadable by clients.
revoke all on public.pk_decks, public.pk_topups from anon, authenticated;
revoke insert, update, delete, truncate on public.pk_hands, public.pk_players, public.pk_hole from anon, authenticated;
revoke all on public.pk_hands, public.pk_players, public.pk_hole from anon;
grant select on public.pk_hands, public.pk_players, public.pk_hole to authenticated;

-- -----------------------------------------------------------------------------
-- Open the games and seed one always-open house table per stake level.
-- -----------------------------------------------------------------------------
update public.games set released = true
 where key in ('poker_holdem', 'poker_omaha', 'poker_omaha_hilo', 'poker_stud', 'poker_draw');

insert into public.game_tables (game_key, tier, name, max_seats, persistent)
select g.key, v.tier, v.prefix || ' ' || n.short, g.max_seats, true
  from (values ('poker_holdem', 'Hold''em'), ('poker_omaha', 'Omaha'), ('poker_omaha_hilo', 'Hi-Lo'),
               ('poker_stud', 'Stud'), ('poker_draw', 'Draw')) n(key, short)
  join public.games g on g.key = n.key
  cross join (values ('low', 'Emerald'), ('mid', 'Ruby'), ('high', 'Sapphire'), ('vip', 'Gold')) v(tier, prefix)
 where not exists (
   select 1 from public.game_tables t where t.game_key = g.key and t.tier = v.tier and t.persistent
 );

select private.add_to_realtime('pk_hands');
select private.add_to_realtime('pk_players');

-- Lock down every private helper; RLS only needs can_view_table.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

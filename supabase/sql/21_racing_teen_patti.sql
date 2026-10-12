-- =============================================================================
-- All In · 21_racing_teen_patti.sql
-- Stage 10, part 4: horse racing (one live room) and Teen Patti tables.
-- Run AFTER 01-20 (re-run 03_games_and_stakes.sql first: it lists these games).
-- Safe to re-run.
--
--   horse_racing     One shared race for everyone, like Crash. Six horses with
--                    odds. betting (25 s) -> racing (12 s) -> done (7 s) -> ...
--                    The finishing order is drawn when betting closes, so there
--                    is nothing to hide while bets can still be placed; winnings
--                    are paid when the race ends on screen.
--   teen_patti_live  Teen Patti at tables of 2 to 6, player against player.
--                    Everyone posts the boot and gets three cards face down.
--                    You play blind until you look. A blind player bets 1x or 2x
--                    the stake, a seen player 2x or 4x. With two players left
--                    either may pay for a show. Hands rank as in file 19
--                    (private.tpt_score): trail, pure sequence, sequence,
--                    colour, pair, high card.
--
-- A player's cards live in the hidden tpt_cards table. tpt_state hands a player
-- their own cards only once they have looked, and everyone's at a showdown.
--
-- All In is a free game. No real money is ever used.
-- =============================================================================

do $$
begin
  if (select count(*) from public.games where key in ('horse_racing', 'teen_patti_live')) < 2
     or (select count(distinct game_key) from public.stake_tiers where game_key in ('horse_racing', 'teen_patti_live')) < 2 then
    raise exception 'Run 03_games_and_stakes.sql again first: it adds these games to the catalogue.';
  end if;
  if to_regprocedure('private.tpt_score(smallint[])') is null then
    raise exception 'Run 19_table_poker.sql first: Teen Patti tables use its hand ranking.';
  end if;
end $$;

-- =============================================================================
-- HORSE RACING
-- =============================================================================

-- Every number of the race. "fields" are the chances (out of 100) of the six
-- runners; each race takes one field and hands its chances out at random.
-- A bet returns 92 / chance, in hundredths of the bet, rounded down to a
-- multiple of 10 (bets are multiples of 10, so chips stay whole).
create or replace function private.race_cfg()
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select $cfg$
{
  "bet_seconds": 25, "race_seconds": 12, "result_seconds": 7, "return_pct": 92, "max_bets": 6,
  "fields": [[30, 22, 18, 13, 10, 7], [40, 20, 15, 12, 8, 5], [24, 20, 18, 16, 12, 10]],
  "names": ["Midnight Ace", "Lucky Penny", "Ruby Run", "Gold Rush", "Wild Card", "Thunder Roll", "Silver Lining",
            "High Roller", "Double Down", "Snake Eyes", "Royal Flush", "Quick Draw", "Jackpot Jim", "Felt Lightning",
            "Paper Tiger", "Last Call", "Easy Eight", "Velvet Rope"]
}
  $cfg$::jsonb
$fn$;

create table if not exists public.race_rounds (
  id               uuid primary key default gen_random_uuid(),
  round_no         bigint generated always as identity,
  phase            text not null check (phase in ('betting', 'racing', 'done')),
  betting_ends_at  timestamptz not null,
  started_at       timestamptz,
  ends_at          timestamptz,
  -- [{no, name, chance, win, place}]: win and place are what a bet returns, in hundredths of the bet.
  horses           jsonb not null,
  -- The finishing order (horse numbers, first to last). Null while bets are open: it has not been drawn yet.
  result           integer[],
  created_at       timestamptz not null default now()
);
create index if not exists race_rounds_no_idx on public.race_rounds (round_no desc);

create table if not exists public.race_bets (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.race_rounds (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  username    text not null,
  horse       integer not null check (horse between 1 and 6),
  -- win: the horse comes first. place: it comes first or second.
  kind        text not null check (kind in ('win', 'place')),
  amount      bigint not null check (amount > 0),
  units       integer not null,
  payout      bigint not null default 0,
  settled     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (round_id, user_id, horse, kind)
);
create index if not exists race_bets_open_idx on public.race_bets (user_id) where not settled;
create index if not exists race_bets_round_idx on public.race_bets (round_id);

-- Six runners for a new race: names and chances drawn at random, odds worked out from the chances.
create or replace function private.race_field()
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  c jsonb := private.race_cfg();
  v_names text[];
  v_w integer[];
  v_pick text[] := '{}';
  v_chance integer[] := '{}';
  v_out jsonb := '[]'::jsonb;
  v_ret numeric := (c ->> 'return_pct')::numeric;
  j integer;
  q numeric;
begin
  select array_agg(x) into v_names from jsonb_array_elements_text(c -> 'names') x;
  select array_agg(x::integer) into v_w
    from jsonb_array_elements_text(c -> 'fields' -> private.random_int(jsonb_array_length(c -> 'fields'))) x;
  for i in 1..6 loop
    j := private.random_int(cardinality(v_names)) + 1;
    v_pick := v_pick || v_names[j];
    v_names := v_names[1 : j - 1] || v_names[j + 1 :];
    j := private.random_int(cardinality(v_w)) + 1;
    v_chance := v_chance || v_w[j];
    v_w := v_w[1 : j - 1] || v_w[j + 1 :];
  end loop;
  for i in 1..6 loop
    -- First or second: first, or second behind each of the others in turn.
    select v_chance[i] / 100.0 + sum((v_chance[k] / 100.0) * v_chance[i] / (100.0 - v_chance[k])) into q
      from generate_series(1, 6) k where k <> i;
    v_out := v_out || jsonb_build_object(
      'no', i, 'name', v_pick[i], 'chance', v_chance[i],
      'win', (floor(v_ret / (v_chance[i] / 100.0) / 10) * 10)::integer,
      'place', (floor(v_ret / q / 10) * 10)::integer);
  end loop;
  return v_out;
end $$;

-- Draws the finishing order: each place goes to one of the horses still running, by its chance.
create or replace function private.race_draw(p_horses jsonb)
returns integer[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_left integer[] := array[1, 2, 3, 4, 5, 6];
  v_order integer[] := '{}';
  v_total integer;
  v_r integer;
  h integer;
begin
  while cardinality(v_left) > 0 loop
    select sum((p_horses -> (x - 1) ->> 'chance')::integer) into v_total from unnest(v_left) x;
    v_r := private.random_int(v_total);
    foreach h in array v_left loop
      v_r := v_r - (p_horses -> (h - 1) ->> 'chance')::integer;
      exit when v_r < 0;
    end loop;
    v_order := v_order || h;
    v_left := array_remove(v_left, h);
  end loop;
  return v_order;
end $$;

-- Pays every bet on a finished race, one history row per player.
create or replace function private.race_settle(r public.race_rounds)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
  v_winner integer := r.result[1];
begin
  update public.race_bets b
     set settled = true,
         payout = case when (b.kind = 'win' and b.horse = r.result[1])
                         or (b.kind = 'place' and b.horse in (r.result[1], r.result[2]))
                       then b.amount * b.units / 100 else 0 end
   where b.round_id = r.id and not b.settled;
  for u in
    select b.user_id, sum(b.amount)::bigint as wagered, sum(b.payout)::bigint as returned,
           bool_or(b.kind = 'win' and b.payout > 0) as picked,
           coalesce(max(b.units) filter (where b.kind = 'win' and b.payout > 0), 0) as win_units,
           count(*) filter (where b.payout > 0) as hits
      from public.race_bets b where b.round_id = r.id
     group by b.user_id
  loop
    if u.returned > 0 then
      perform private.apply_chips(u.user_id, u.returned, 'payout', 'horse_racing', r.id::text,
                                  jsonb_build_object('winner', v_winner));
    end if;
    perform private.record_round(u.user_id, 'horse_racing', null, r.id, u.wagered, u.returned,
      jsonb_build_object('winner', v_winner, 'winner_name', r.horses -> (v_winner - 1) ->> 'name',
                         'picked_winner', u.picked, 'win_units', u.win_units, 'hits', u.hits));
  end loop;
end $$;

-- Moves the room along to "now". p_open: also open a new race when the last one is over.
create or replace function private.race_tick(p_open boolean)
returns public.race_rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := private.race_cfg();
  r public.race_rounds;
begin
  perform pg_advisory_xact_lock(hashtext('allin_race'));
  for i in 1..4 loop
    select * into r from public.race_rounds order by round_no desc limit 1;

    if not found or (r.phase = 'done' and now() >= r.ends_at + make_interval(secs => (c ->> 'result_seconds')::integer)) then
      exit when not p_open;
      insert into public.race_rounds (phase, betting_ends_at, horses)
      values ('betting', now() + make_interval(secs => (c ->> 'bet_seconds')::integer), private.race_field())
      returning * into r;
      exit;

    elsif r.phase = 'betting' and now() >= r.betting_ends_at then
      -- Bets are closed: only now is the order drawn.
      update public.race_rounds
         set phase = 'racing', started_at = now(),
             ends_at = now() + make_interval(secs => (c ->> 'race_seconds')::integer),
             result = private.race_draw(r.horses)
       where id = r.id;

    elsif r.phase = 'racing' and now() >= r.ends_at then
      perform private.race_settle(r);
      update public.race_rounds set phase = 'done' where id = r.id;

    else
      exit;
    end if;
  end loop;
  select * into r from public.race_rounds order by round_no desc limit 1;
  return r;
end $$;

create or replace function private.race_tick_stale()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.race_bets where not settled) then
    perform private.race_tick(false);
  end if;
end $$;

create or replace function private.race_in_play(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0)::bigint from public.race_bets where user_id = p_user and not settled;
$$;

-- The room: the race, your bets, what is riding on each horse, and recent winners.
create or replace function public.race_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r     public.race_rounds := private.race_tick(true);
begin
  return jsonb_build_object(
    'server_now', now(),
    'round', jsonb_build_object(
      'id', r.id, 'round_no', r.round_no, 'phase', r.phase, 'betting_ends_at', r.betting_ends_at,
      'started_at', r.started_at, 'ends_at', r.ends_at, 'horses', r.horses, 'result', to_jsonb(r.result)),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object(
               'horse', b.horse, 'kind', b.kind, 'amount', b.amount, 'units', b.units,
               'payout', b.payout, 'settled', b.settled) order by b.created_at), '[]'::jsonb)
               from public.race_bets b where b.round_id = r.id and b.user_id = v_uid),
    'pool', (select coalesce(jsonb_agg(jsonb_build_object('horse', x.horse, 'amount', x.amount, 'players', x.players) order by x.horse), '[]'::jsonb)
               from (select b.horse, sum(b.amount)::bigint as amount, count(distinct b.user_id) as players
                       from public.race_bets b where b.round_id = r.id group by b.horse) x),
    'players', (select count(distinct b.user_id) from public.race_bets b where b.round_id = r.id),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object(
                 'name', x.horses -> (x.result[1] - 1) ->> 'name', 'no', x.result[1],
                 'win', (x.horses -> (x.result[1] - 1) ->> 'win')::integer) order by x.round_no desc), '[]'::jsonb)
                 from (select horses, result, round_no from public.race_rounds
                        where phase = 'done' order by round_no desc limit 12) x)
  );
end $$;

-- One bet: a horse to win, or to place (first or second). Up to six bets a race.
create or replace function public.race_bet(p_horse integer, p_kind text, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r     public.race_rounds := private.race_tick(true);
  v_tier text;
  v_units integer;
begin
  if r.phase <> 'betting' then
    raise exception 'betting_closed';
  end if;
  if p_horse is null or p_horse < 1 or p_horse > 6 or coalesce(p_kind, '') not in ('win', 'place') then
    raise exception 'invalid_bet';
  end if;
  if not exists (select 1 from public.games where key = 'horse_racing' and released) then
    raise exception 'game_not_open';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount % 10 <> 0 then
    raise exception 'invalid_amount';
  end if;
  if exists (select 1 from public.race_bets where round_id = r.id and user_id = v_uid and horse = p_horse and kind = p_kind) then
    raise exception 'action_not_allowed' using hint = 'You already have that bet on this race.';
  end if;
  if (select count(*) from public.race_bets where round_id = r.id and user_id = v_uid) >= (private.race_cfg() ->> 'max_bets')::integer then
    raise exception 'action_not_allowed' using hint = 'That is the most bets you can have on one race.';
  end if;
  v_tier := private.slot_tier('horse_racing', p_amount);
  perform private.assert_tier_access(v_uid, 'horse_racing', v_tier);
  v_units := (r.horses -> (p_horse - 1) ->> p_kind)::integer;
  insert into public.race_bets (round_id, user_id, username, horse, kind, amount, units)
  values (r.id, v_uid, (select username from public.profiles where id = v_uid), p_horse, p_kind, p_amount, v_units);
  return jsonb_build_object(
    'round_id', r.id, 'units', v_units,
    'balance', private.apply_chips(v_uid, -p_amount, 'bet', 'horse_racing', r.id::text,
                                   jsonb_build_object('horse', p_horse, 'kind', p_kind)));
end $$;

-- What the screen needs once: the numbers for the rules, the bet steps and the stake levels.
create or replace function public.race_info(p_game text default 'horse_racing')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  g public.games;
begin
  select * into g from public.games where key = 'horse_racing';
  return jsonb_build_object(
    'game', g.key, 'name', g.name, 'released', g.released,
    'config', private.race_cfg() - 'names' - 'fields',
    'bets', (select coalesce(jsonb_agg(b order by b), '[]'::jsonb) from unnest(private.slot_bets()) b
              where exists (select 1 from public.stake_tiers t where t.game_key = g.key and b between t.min_bet and t.max_bet)),
    'tiers', (select jsonb_agg(jsonb_build_object('tier', t.tier, 'label', t.label, 'min_bet', t.min_bet,
                                                  'max_bet', t.max_bet, 'min_bankroll', t.min_bankroll) order by t.tier_rank)
                from public.stake_tiers t where t.game_key = g.key),
    'round', null);
end $$;

-- =============================================================================
-- TEEN PATTI TABLES
-- =============================================================================
create or replace function private.tpt_cfg()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  -- The stake can be raised to max_stake boots (a seen player bets twice the stake).
  -- When the pot reaches pot_limit boots, everyone still in shows their cards.
  select '{"turn_seconds": 20, "next_hand_seconds": 5, "showdown_seconds": 8, "max_stake": 8, "pot_limit": 200}'::jsonb
$$;

create table if not exists public.tpt_hands (
  id             uuid primary key default gen_random_uuid(),
  table_id       uuid not null references public.game_tables (id) on delete cascade,
  hand_no        integer not null,
  phase          text not null check (phase in ('betting', 'settled')),
  -- Turn deadline, or when the next hand may start.
  phase_ends_at  timestamptz,
  button_seat    integer,
  turn_seat      integer,
  boot           bigint not null,
  -- What a blind player has to put in to stay (a seen player puts in twice this).
  stake          bigint not null,
  showdown       boolean not null default false,
  -- [{seat_no, amount, hand}] once settled.
  winners        jsonb,
  created_at     timestamptz not null default now(),
  settled_at     timestamptz,
  unique (table_id, hand_no)
);
create index if not exists tpt_hands_table_idx on public.tpt_hands (table_id, hand_no desc);
create index if not exists tpt_hands_open_idx on public.tpt_hands (phase_ends_at) where phase <> 'settled';

-- Public, per-player state for a hand. No hidden cards here.
create table if not exists public.tpt_players (
  hand_id      uuid not null references public.tpt_hands (id) on delete cascade,
  table_id     uuid not null references public.game_tables (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  seat_no      integer not null,
  status       text not null default 'active' check (status in ('active', 'folded')),
  -- Has this player looked at their cards?
  seen         boolean not null default false,
  committed    bigint not null default 0 check (committed >= 0),
  last_bet     bigint not null default 0,
  last_action  text,
  shown_cards  smallint[],      -- revealed at a showdown
  hand_name    text,
  won          bigint not null default 0,
  primary key (hand_id, seat_no),
  unique (hand_id, user_id)
);
create index if not exists tpt_players_table_idx on public.tpt_players (table_id);
create index if not exists tpt_players_user_idx on public.tpt_players (user_id);

-- HIDDEN: everyone's three cards. Clients never read this table.
create table if not exists public.tpt_cards (
  hand_id  uuid not null references public.tpt_hands (id) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  cards    smallint[] not null,
  primary key (hand_id, user_id)
);

create or replace function private.tpt_stakes(p_table uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select st.params || jsonb_build_object('boot', (st.params ->> 'big_blind')::bigint)
    from public.game_tables t
    join public.stake_tiers st on st.game_key = t.game_key and st.tier = t.tier
   where t.id = p_table;
$$;

create or replace function private.tpt_lock_table(p_table uuid)
returns public.game_tables
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.game_tables;
begin
  select * into t from public.game_tables where id = p_table for update;
  if not found or t.game_key <> 'teen_patti_live' then
    raise exception 'table_not_found';
  end if;
  return t;
end $$;

create or replace function private.tpt_latest_hand(p_table uuid)
returns public.tpt_hands
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.tpt_hands where table_id = p_table order by hand_no desc limit 1;
$$;

create or replace function private.tpt_label(p_score integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['High card', 'Pair', 'Colour', 'Sequence', 'Pure sequence', 'Trail'])[p_score / 4096 + 1]
$$;

-- Moves chips from a seat's stack into the pot (never more than the stack). Returns what went in.
create or replace function private.tpt_commit(p_hand uuid, p_seat integer, p_amount bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.tpt_players;
  v_stack bigint;
  v_amt bigint;
begin
  select * into p from public.tpt_players where hand_id = p_hand and seat_no = p_seat for update;
  select stack into v_stack from public.table_seats where table_id = p.table_id and user_id = p.user_id for update;
  v_amt := least(greatest(p_amount, 0), coalesce(v_stack, 0));
  if v_amt > 0 then
    update public.table_seats set stack = stack - v_amt where table_id = p.table_id and user_id = p.user_id;
  end if;
  update public.tpt_players set committed = committed + v_amt, last_bet = v_amt where hand_id = p_hand and seat_no = p_seat;
  return v_amt;
end $$;

-- The next player still in, clockwise from p_from.
create or replace function private.tpt_next_seat(p_hand uuid, p_from integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select seat_no from public.tpt_players
   where hand_id = p_hand and status = 'active' and seat_no <> p_from
   order by (seat_no > p_from) desc, seat_no
   limit 1;
$$;

-- Ends the hand. With one player left they take the pot unseen. Otherwise it is a
-- showdown between everyone still in: the best hand wins, equal hands share the pot,
-- except that p_tie_loser (the player who paid for the show) loses a tie.
create or replace function private.tpt_settle(p_hand uuid, p_tie_loser integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.tpt_hands;
  c jsonb := private.tpt_cfg();
  v_pot bigint;
  v_live integer;
  v_best integer;
  v_winners integer[];
  v_share bigint;
  v_odd bigint;
  v_out jsonb := '[]'::jsonb;
  v_amt bigint;
  r record;
  i integer := 0;
begin
  select * into h from public.tpt_hands where id = p_hand for update;
  if h.phase = 'settled' then
    return;
  end if;
  select coalesce(sum(committed), 0) into v_pot from public.tpt_players where hand_id = p_hand;
  select count(*) into v_live from public.tpt_players where hand_id = p_hand and status = 'active';

  if v_live >= 2 then
    update public.tpt_players p
       set shown_cards = k.cards, hand_name = private.tpt_label(private.tpt_score(k.cards))
      from public.tpt_cards k
     where p.hand_id = p_hand and p.status = 'active' and k.hand_id = p.hand_id and k.user_id = p.user_id;
    select max(private.tpt_score(shown_cards)) into v_best from public.tpt_players where hand_id = p_hand and status = 'active';
    select array_agg(seat_no order by (seat_no > h.button_seat) desc, seat_no) into v_winners
      from public.tpt_players where hand_id = p_hand and status = 'active' and private.tpt_score(shown_cards) = v_best;
    if cardinality(v_winners) > 1 and p_tie_loser = any (v_winners) then
      v_winners := array_remove(v_winners, p_tie_loser);
    end if;
  else
    select array_agg(seat_no) into v_winners from public.tpt_players where hand_id = p_hand and status = 'active';
  end if;

  if coalesce(cardinality(v_winners), 0) > 0 then
    v_share := v_pot / cardinality(v_winners);
    v_odd := v_pot - v_share * cardinality(v_winners);
    for r in select p.* from public.tpt_players p where p.hand_id = p_hand and p.seat_no = any (v_winners)
              order by array_position(v_winners, p.seat_no)
    loop
      i := i + 1;
      v_amt := v_share + case when i <= v_odd then 1 else 0 end;
      update public.tpt_players set won = v_amt where hand_id = p_hand and seat_no = r.seat_no;
      -- To the table stack if still seated, otherwise straight to the wallet.
      update public.table_seats set stack = stack + v_amt where table_id = h.table_id and user_id = r.user_id;
      if not found and v_amt > 0 and exists (select 1 from public.wallets where user_id = r.user_id) then
        perform private.apply_chips(r.user_id, v_amt, 'poker_pot', 'teen_patti_live', p_hand::text,
                                    jsonb_build_object('hand_no', h.hand_no));
      end if;
      v_out := v_out || jsonb_build_object('seat_no', r.seat_no, 'amount', v_amt, 'hand', case when v_live >= 2 then r.hand_name end);
    end loop;
  end if;

  update public.tpt_hands
     set phase = 'settled', showdown = v_live >= 2, winners = v_out, turn_seat = null, settled_at = now(),
         phase_ends_at = now() + make_interval(secs => (c ->> case when v_live >= 2 then 'showdown_seconds' else 'next_hand_seconds' end)::integer)
   where id = p_hand;

  for r in select p.*, k.cards from public.tpt_players p
             left join public.tpt_cards k on k.hand_id = p.hand_id and k.user_id = p.user_id
            where p.hand_id = p_hand
  loop
    perform private.record_round(r.user_id, 'teen_patti_live', h.table_id, p_hand, r.committed, r.won,
      jsonb_build_object('hand', private.tpt_label(private.tpt_score(r.cards)), 'made', private.tpt_name(private.tpt_score(r.cards)),
                         'showdown', v_live >= 2, 'folded', r.status = 'folded',
                         -- Won without ever looking at the cards.
                         'blind', r.won > r.committed and not r.seen,
                         'players', (select count(*) from public.tpt_players where hand_id = p_hand)));
  end loop;
end $$;

-- One move by the player whose turn it is.
--   pack   fold
--   bet    stay in: the stake if blind, twice the stake if seen
--   raise  double it: twice the stake if blind, four times if seen
--   show   two players left: pay a bet and compare. Also the only move besides packing
--          for a player who cannot cover a bet: all their chips go in and everyone shows.
create or replace function private.tpt_do_action(p_hand uuid, p_seat integer, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.tpt_hands;
  p public.tpt_players;
  c jsonb := private.tpt_cfg();
  v_stack bigint;
  v_live integer;
  v_unit integer;
  v_cost bigint;
  v_stake bigint;
  v_pot bigint;
  v_next integer;
begin
  select * into h from public.tpt_hands where id = p_hand for update;
  select * into p from public.tpt_players where hand_id = p_hand and seat_no = p_seat for update;
  if h.phase <> 'betting' or not found or p.status <> 'active' then
    raise exception 'action_not_allowed';
  end if;
  select coalesce(stack, 0) into v_stack from public.table_seats where table_id = h.table_id and user_id = p.user_id;
  v_stack := coalesce(v_stack, 0);
  select count(*) into v_live from public.tpt_players where hand_id = p_hand and status = 'active';
  v_unit := case when p.seen then 2 else 1 end;

  if p_action = 'pack' then
    update public.tpt_players set status = 'folded', last_action = 'Pack' where hand_id = p_hand and seat_no = p_seat;
    if v_live - 1 <= 1 then
      perform private.tpt_settle(p_hand);
      return;
    end if;

  elsif p_action in ('bet', 'raise') then
    v_stake := h.stake * case when p_action = 'raise' then 2 else 1 end;
    if p_action = 'raise' and v_stake > h.boot * (c ->> 'max_stake')::integer then
      raise exception 'action_not_allowed' using hint = 'The stake is already as high as it goes at this table.';
    end if;
    v_cost := v_stake * v_unit;
    if v_stack < v_cost then
      raise exception 'not_enough_chips' using hint = 'You can''t cover that bet. Show your cards or pack.';
    end if;
    perform private.tpt_commit(p_hand, p_seat, v_cost);
    update public.tpt_players
       set last_action = case when p_action = 'raise' then 'Raise' when p.seen then 'Chaal' else 'Blind' end
     where hand_id = p_hand and seat_no = p_seat;
    update public.tpt_hands set stake = v_stake where id = p_hand;
    -- The pot has reached the table's limit: everyone still in shows.
    select coalesce(sum(committed), 0) into v_pot from public.tpt_players where hand_id = p_hand;
    if v_pot >= h.boot * (c ->> 'pot_limit')::integer then
      perform private.tpt_settle(p_hand);
      return;
    end if;

  elsif p_action = 'show' then
    v_cost := h.stake * v_unit;
    if v_live > 2 and v_stack >= v_cost then
      raise exception 'action_not_allowed' using hint = 'You can ask for a show when only two players are left.';
    end if;
    perform private.tpt_commit(p_hand, p_seat, v_cost);
    update public.tpt_players set last_action = 'Show' where hand_id = p_hand and seat_no = p_seat;
    -- Heads-up, the player who asked for the show loses if the hands are equal.
    perform private.tpt_settle(p_hand, case when v_live = 2 then p_seat end);
    return;

  else
    raise exception 'action_not_allowed';
  end if;

  v_next := private.tpt_next_seat(p_hand, p_seat);
  update public.tpt_hands
     set turn_seat = v_next, phase_ends_at = now() + make_interval(secs => (c ->> 'turn_seconds')::integer)
   where id = p_hand;
end $$;

-- Deals a hand if at least two seated, connected players can post the boot.
create or replace function private.tpt_start_hand(p_table uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.game_tables;
  c jsonb := private.tpt_cfg();
  st jsonb := private.tpt_stakes(p_table);
  v_boot bigint := (st ->> 'boot')::bigint;
  prev public.tpt_hands;
  h public.tpt_hands;
  v_seats integer[];
  v_button integer;
  v_deck smallint[];
  v_disc interval := (select disconnected from private.seat_timeouts());
  r record;
  i integer := 0;
begin
  select * into t from public.game_tables where id = p_table;
  if t.status <> 'open' then
    return false;
  end if;
  select array_agg(seat_no order by seat_no) into v_seats
    from public.table_seats
   where table_id = p_table and stack >= v_boot and status = 'active' and last_seen_at > now() - v_disc;
  if coalesce(cardinality(v_seats), 0) < 2 then
    return false;
  end if;

  prev := private.tpt_latest_hand(p_table);
  -- The button moves to the next player in.
  select x into v_button from unnest(v_seats) x
   order by (x > coalesce(prev.button_seat, 0)) desc, x limit 1;

  insert into public.tpt_hands (table_id, hand_no, phase, button_seat, boot, stake)
  values (p_table, coalesce(prev.hand_no, 0) + 1, 'betting', v_button, v_boot, v_boot)
  returning * into h;

  v_deck := private.shuffled_shoe(1);
  -- Cards go out three at a time, starting left of the button.
  for r in select s.seat_no, s.user_id from public.table_seats s
            where s.table_id = p_table and s.seat_no = any (v_seats)
            order by (s.seat_no > v_button) desc, s.seat_no
  loop
    insert into public.tpt_players (hand_id, table_id, user_id, seat_no) values (h.id, p_table, r.user_id, r.seat_no);
    insert into public.tpt_cards (hand_id, user_id, cards) values (h.id, r.user_id, v_deck[i * 3 + 1 : i * 3 + 3]);
    perform private.tpt_commit(h.id, r.seat_no, v_boot);
    i := i + 1;
  end loop;
  update public.tpt_players set last_bet = 0 where hand_id = h.id;

  update public.tpt_hands
     set turn_seat = private.tpt_next_seat(h.id, v_button),
         phase_ends_at = now() + make_interval(secs => (c ->> 'turn_seconds')::integer)
   where id = h.id;
  update public.game_tables set last_activity_at = now() where id = p_table;
  return true;
end $$;

-- Acts for players who ran out of time or went away, and deals the next hand when it is due.
create or replace function private.tpt_tick(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.tpt_hands;
  p public.tpt_players;
  v_present boolean;
  i integer := 0;
begin
  loop
    i := i + 1;
    exit when i > 20;
    h := private.tpt_latest_hand(p_table);
    if h.id is null or h.phase = 'settled' then
      exit when h.id is not null and h.phase_ends_at > now();
      exit when not private.tpt_start_hand(p_table);
      continue;
    end if;
    -- Everyone else has gone: the hand is over.
    if (select count(*) from public.tpt_players where hand_id = h.id and status = 'active') <= 1 then
      perform private.tpt_settle(h.id);
      continue;
    end if;
    select * into p from public.tpt_players where hand_id = h.id and seat_no = h.turn_seat and status = 'active';
    if not found then
      -- The player to act has left: pass the turn on.
      update public.tpt_hands
         set turn_seat = private.tpt_next_seat(h.id, coalesce(h.turn_seat, 0)),
             phase_ends_at = now() + make_interval(secs => (private.tpt_cfg() ->> 'turn_seconds')::integer)
       where id = h.id;
      continue;
    end if;
    v_present := private.pk_present(p_table, p.user_id);
    exit when v_present and h.phase_ends_at > now();
    perform private.tpt_do_action(h.id, p.seat_no, 'pack');
    if v_present then
      -- Ran out of time: sit them out from the next hand.
      update public.table_seats set status = 'sitting_out' where table_id = p_table and user_id = p.user_id;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------

-- Everything a client needs to draw the table. Your cards are included only once you have looked.
create or replace function public.tpt_state(p_table uuid)
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
  c jsonb := private.tpt_cfg();
  h public.tpt_hands;
  me public.tpt_players;
  v_cards smallint[];
  v_disc interval := (select disconnected from private.seat_timeouts());
  v_seat public.table_seats;
  v_me jsonb := null;
  v_live integer;
  v_unit integer;
  v_opts jsonb := null;
begin
  if not private.can_view_table(p_table) then
    raise exception 'table_not_found';
  end if;
  select * into t from public.game_tables where id = p_table;
  if not found or t.game_key <> 'teen_patti_live' then
    raise exception 'table_not_found';
  end if;
  select * into st from public.stake_tiers where game_key = t.game_key and tier = t.tier;
  h := private.tpt_latest_hand(p_table);
  select * into v_seat from public.table_seats where table_id = p_table and user_id = v_uid;

  if h.id is not null then
    select * into me from public.tpt_players where hand_id = h.id and user_id = v_uid;
    if me.user_id is not null and me.seen then
      select cards into v_cards from public.tpt_cards where hand_id = h.id and user_id = v_uid;
    end if;
  end if;

  if v_seat.user_id is not null or me.user_id is not null then
    if me.user_id is not null and h.phase = 'betting' and h.turn_seat = me.seat_no and me.status = 'active' then
      select count(*) into v_live from public.tpt_players where hand_id = h.id and status = 'active';
      v_unit := case when me.seen then 2 else 1 end;
      v_opts := jsonb_build_object(
        'bet', h.stake * v_unit,
        'raise', case when h.stake * 2 <= h.boot * (c ->> 'max_stake')::integer then h.stake * 2 * v_unit end,
        'show_cost', least(h.stake * v_unit, coalesce(v_seat.stack, 0)),
        'can_bet', coalesce(v_seat.stack, 0) >= h.stake * v_unit,
        'can_raise', h.stake * 2 <= h.boot * (c ->> 'max_stake')::integer and coalesce(v_seat.stack, 0) >= h.stake * 2 * v_unit,
        'can_show', v_live = 2 or coalesce(v_seat.stack, 0) < h.stake * v_unit,
        'short', coalesce(v_seat.stack, 0) < h.stake * v_unit);
    end if;
    v_me := jsonb_build_object(
      'stack', coalesce(v_seat.stack, 0), 'pending_topup', 0,
      'in_hand', me.user_id is not null and h.phase = 'betting' and me.status = 'active',
      'seat_no', v_seat.seat_no, 'seen', coalesce(me.seen, false),
      'can_see', me.user_id is not null and h.phase = 'betting' and me.status = 'active' and not me.seen,
      'hole', to_jsonb(v_cards),
      'hand_name', case when v_cards is not null then private.tpt_label(private.tpt_score(v_cards)) end,
      'options', v_opts);
  end if;

  return jsonb_build_object(
    'server_now', now(),
    'config', c || jsonb_build_object('family', 'draw'),
    'table', jsonb_build_object(
      'id', t.id, 'name', t.name, 'game_key', t.game_key, 'tier', t.tier, 'tier_label', st.label,
      'max_seats', t.max_seats, 'is_private', t.is_private, 'status', t.status,
      'invite_code', case when t.is_private then t.invite_code end,
      'stakes', private.tpt_stakes(p_table)),
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seat_no', s.seat_no, 'user_id', s.user_id, 'username', pr.username, 'stack', s.stack,
               'status', s.status, 'connected', s.last_seen_at > now() - v_disc) order by s.seat_no)
        from public.table_seats s join public.profiles pr on pr.id = s.user_id
       where s.table_id = p_table), '[]'::jsonb),
    'hand', case when h.id is null then null else jsonb_build_object(
      'id', h.id, 'hand_no', h.hand_no, 'phase', h.phase, 'phase_ends_at', h.phase_ends_at,
      'button_seat', h.button_seat, 'turn_seat', h.turn_seat, 'boot', h.boot, 'stake', h.stake,
      'pot', (select coalesce(sum(committed), 0) from public.tpt_players where hand_id = h.id),
      'pot_limit', h.boot * (c ->> 'pot_limit')::integer,
      'showdown', h.showdown, 'winners', h.winners, 'settled_at', h.settled_at
    ) end,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seat_no', p.seat_no, 'user_id', p.user_id, 'username', pr.username, 'status', p.status,
               'seen', p.seen, 'committed', p.committed, 'last_bet', p.last_bet, 'last_action', p.last_action,
               'card_count', 3, 'shown_cards', to_jsonb(p.shown_cards), 'hand_name', p.hand_name, 'won', p.won)
               order by p.seat_no)
        from public.tpt_players p join public.profiles pr on pr.id = p.user_id
       where p.hand_id = h.id), '[]'::jsonb),
    'me', v_me,
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('hand_no', x.hand_no, 'winners', x.winners) order by x.hand_no desc)
        from (select hh.hand_no,
                     (select jsonb_agg(jsonb_build_object('username', pr.username, 'won', p.won, 'hand', case when hh.showdown then p.hand_name end) order by p.won desc)
                        from public.tpt_players p join public.profiles pr on pr.id = p.user_id
                       where p.hand_id = hh.id and p.won > 0) as winners
                from public.tpt_hands hh
               where hh.table_id = p_table and hh.phase = 'settled'
               order by hh.hand_no desc limit 10) x), '[]'::jsonb)
  );
end $$;

-- pack, bet, raise or show on your turn. "see" (look at your cards) is allowed at any time while you are in.
create or replace function public.tpt_action(p_table uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  h public.tpt_hands;
  p public.tpt_players;
  v_action text := lower(coalesce(p_action, ''));
begin
  perform private.tpt_lock_table(p_table);
  h := private.tpt_latest_hand(p_table);
  if h.id is null or h.phase <> 'betting' then
    raise exception 'not_your_turn';
  end if;
  select * into p from public.tpt_players where hand_id = h.id and user_id = v_uid;
  if not found or p.status <> 'active' then
    raise exception 'not_your_turn';
  end if;
  update public.table_seats set last_seen_at = now() where table_id = p_table and user_id = v_uid;

  if v_action = 'see' then
    update public.tpt_players set seen = true, last_action = 'Seen' where hand_id = h.id and user_id = v_uid and not seen;
    update public.game_tables set last_activity_at = now() where id = p_table;
    return;
  end if;
  if p.seat_no is distinct from h.turn_seat then
    raise exception 'not_your_turn';
  end if;
  if v_action not in ('pack', 'bet', 'raise', 'show') then
    raise exception 'action_not_allowed';
  end if;
  perform private.tpt_do_action(h.id, p.seat_no, v_action);
  perform private.tpt_tick(p_table);
  update public.game_tables set last_activity_at = now() where id = p_table;
end $$;

-- Move chips from your wallet to the table. Not while you are in a hand.
create or replace function public.tpt_bring_chips(p_table uuid, p_amount bigint)
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
begin
  t := private.tpt_lock_table(p_table);
  st := private.tpt_stakes(p_table);
  select * into s from public.table_seats where table_id = p_table and user_id = v_uid for update;
  if not found then
    raise exception 'not_seated';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'invalid_amount';
  end if;
  if exists (select 1 from public.tpt_players p join public.tpt_hands h on h.id = p.hand_id
              where h.table_id = p_table and h.phase <> 'settled' and p.user_id = v_uid and p.status = 'active') then
    raise exception 'action_not_allowed' using hint = 'Wait for this hand to end, then top up.';
  end if;
  if s.stack + p_amount > (st ->> 'max_stack')::bigint then
    raise exception 'above_max_stack'
      using hint = format('You can have up to %s chips at this table.', st ->> 'max_stack');
  end if;
  if s.stack = 0 and p_amount < (st ->> 'min_stack')::bigint then
    raise exception 'below_min_stack'
      using hint = format('Bring at least %s chips to sit in.', st ->> 'min_stack');
  end if;
  perform private.apply_chips(v_uid, -p_amount, 'table_chips_in', t.game_key, p_table::text,
                              jsonb_build_object('seat_no', s.seat_no));
  update public.table_seats set stack = stack + p_amount, last_seen_at = now()
   where table_id = p_table and user_id = v_uid;
  update public.game_tables set last_activity_at = now() where id = p_table;
  perform private.tpt_tick(p_table);
  return jsonb_build_object('stack', (select stack from public.table_seats where table_id = p_table and user_id = v_uid), 'pending', 0);
end $$;

-- Process expired timers and deal the next hand. Anyone who can see the table may call it.
create or replace function public.tpt_advance(p_table uuid)
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
  perform private.tpt_lock_table(p_table);
  perform private.tpt_tick(p_table);
end $$;

-- Your recent hands at this table.
create or replace function public.tpt_hand_history(p_table uuid, p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.j order by x.hand_no desc), '[]'::jsonb)
    from (
      select h.hand_no, jsonb_build_object(
               'hand_no', h.hand_no, 'played_at', h.created_at, 'showdown', h.showdown,
               -- Your own cards, if you looked at them or they were shown.
               'my_cards', case when me.seen or me.shown_cards is not null then to_jsonb(k.cards) end,
               'my_committed', me.committed, 'my_won', me.won, 'my_status', me.status,
               'players', (select jsonb_agg(jsonb_build_object(
                                  'seat_no', p.seat_no, 'username', pr.username, 'status', p.status, 'seen', p.seen,
                                  'committed', p.committed, 'won', p.won, 'shown_cards', to_jsonb(p.shown_cards),
                                  'hand_name', p.hand_name) order by p.seat_no)
                             from public.tpt_players p join public.profiles pr on pr.id = p.user_id
                            where p.hand_id = h.id)) as j
        from public.tpt_hands h
        join public.tpt_players me on me.hand_id = h.id and me.user_id = auth.uid()
        left join public.tpt_cards k on k.hand_id = h.id and k.user_id = auth.uid()
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
    'public.race_state()', 'public.race_bet(integer, text, bigint)', 'public.race_info(text)',
    'public.tpt_state(uuid)', 'public.tpt_action(uuid, text)', 'public.tpt_bring_chips(uuid, bigint)',
    'public.tpt_advance(uuid)', 'public.tpt_hand_history(uuid, integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Plug-ins for the shared table code (05_tables.sql)
-- -----------------------------------------------------------------------------
create or replace function private.tpt_tick_stale()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table uuid;
begin
  for v_table in
    select distinct h.table_id from public.tpt_hands h
     where h.phase <> 'settled' and h.phase_ends_at < now() - interval '2 seconds'
  loop
    perform private.tpt_lock_table(v_table);
    perform private.tpt_tick(v_table);
  end loop;
end $$;

-- Chips in unfinished pots. (Chips in front of you are counted from table_seats.stack.)
create or replace function private.tpt_in_play(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(p.committed), 0)::bigint from public.tpt_players p join public.tpt_hands h on h.id = p.hand_id
   where p.user_id = p_user and h.phase <> 'settled';
$$;

-- A seat was freed: the player's live hand is packed.
create or replace function private.tpt_seat_left(p_table uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.tpt_hands;
  p public.tpt_players;
begin
  if not exists (select 1 from public.game_tables where id = p_table and game_key = 'teen_patti_live') then
    return;
  end if;
  perform private.tpt_lock_table(p_table);
  h := private.tpt_latest_hand(p_table);
  if h.id is null or h.phase = 'settled' then
    return;
  end if;
  select * into p from public.tpt_players where hand_id = h.id and user_id = p_user and status = 'active';
  if not found then
    return;
  end if;
  update public.tpt_players set status = 'folded', last_action = 'Left' where hand_id = h.id and seat_no = p.seat_no;
  perform private.tpt_tick(p_table);
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.race_rounds enable row level security;
alter table public.race_bets   enable row level security;
alter table public.tpt_hands   enable row level security;
alter table public.tpt_players enable row level security;
alter table public.tpt_cards   enable row level security;

-- Everyone in the room sees the race and who bet what, as at a table.
drop policy if exists "race_rounds: signed-in players can read" on public.race_rounds;
create policy "race_rounds: signed-in players can read"
  on public.race_rounds for select to authenticated using (true);

drop policy if exists "race_bets: signed-in players can read" on public.race_bets;
create policy "race_bets: signed-in players can read"
  on public.race_bets for select to authenticated using (true);

drop policy if exists "tpt_hands: hands at visible tables" on public.tpt_hands;
create policy "tpt_hands: hands at visible tables"
  on public.tpt_hands for select to authenticated using (private.can_view_table(table_id));

drop policy if exists "tpt_players: players at visible tables" on public.tpt_players;
create policy "tpt_players: players at visible tables"
  on public.tpt_players for select to authenticated using (private.can_view_table(table_id));

-- tpt_cards: RLS on, NO policies, NO privileges. Unreadable by clients.
revoke all on public.tpt_cards from anon, authenticated;
revoke insert, update, delete, truncate on public.race_rounds, public.race_bets, public.tpt_hands, public.tpt_players
  from anon, authenticated;
revoke all on public.race_rounds, public.race_bets, public.tpt_hands, public.tpt_players from anon;
grant select on public.race_rounds, public.race_bets, public.tpt_hands, public.tpt_players to authenticated;

-- -----------------------------------------------------------------------------
-- Open the games and seed one always-open Teen Patti table per stake level.
-- -----------------------------------------------------------------------------
update public.games set released = true where key in ('horse_racing', 'teen_patti_live');

insert into public.game_tables (game_key, tier, name, max_seats, persistent)
select g.key, v.tier, v.prefix || ' Teen Patti', g.max_seats, true
  from public.games g
  cross join (values ('low', 'Emerald'), ('mid', 'Ruby'), ('high', 'Sapphire'), ('vip', 'Gold')) v(tier, prefix)
 where g.key = 'teen_patti_live'
   and not exists (select 1 from public.game_tables t where t.game_key = g.key and t.tier = v.tier and t.persistent);

select private.add_to_realtime('race_rounds');
select private.add_to_realtime('race_bets');
select private.add_to_realtime('tpt_hands');
select private.add_to_realtime('tpt_players');

-- Lock down every private helper; RLS only needs can_view_table.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

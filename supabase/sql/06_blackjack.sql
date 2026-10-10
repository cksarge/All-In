-- =============================================================================
-- All In · 06_blackjack.sql
-- Multiplayer blackjack (up to 5 seats vs. the dealer), fully server-side.
--
-- House rules: 6-deck shoe (reshuffled at ~75% penetration), dealer stands on
-- soft 17, blackjack pays 3:2, insurance pays 2:1, double on any first two
-- cards (including after a split), split up to 3 hands, split aces get one
-- card each, late surrender on the first two cards.
--
-- Hidden information: the undealt shoe (bj_shoes) and the dealer's hole card
-- (bj_secrets) have RLS enabled with NO policies and no table privileges for
-- clients, so they can't be read by anyone but these functions.
--
-- Flow per round:  betting → (insurance) → playing → settled
--   * The first bet opens a 15 s betting window; it deals early once every
--     connected, active player has bet.
--   * Each decision has a 20 s timer. Any client at the table can call
--     bj_advance(): the SERVER checks the deadline and auto-stands for anyone
--     who timed out or left, so the game never stalls if a tab is closed.
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.bj_rounds (
  id             uuid primary key default gen_random_uuid(),
  table_id       uuid not null references public.game_tables (id) on delete cascade,
  round_no       integer not null,
  phase          text not null check (phase in ('betting', 'insurance', 'playing', 'settled')),
  -- Betting close / insurance close / current turn deadline / next round allowed.
  phase_ends_at  timestamptz,
  turn_hand_id   uuid,
  -- Face-up dealer cards only. The hole card lives in bj_secrets until revealed.
  dealer_cards   smallint[] not null default '{}',
  dealer_total   integer,
  dealer_result  text check (dealer_result in ('blackjack', 'bust', 'stand')),
  created_at     timestamptz not null default now(),
  settled_at     timestamptz,
  unique (table_id, round_no)
);

create index if not exists bj_rounds_table_idx on public.bj_rounds (table_id, round_no desc);
create index if not exists bj_rounds_open_idx on public.bj_rounds (phase_ends_at) where phase <> 'settled';

create table if not exists public.bj_hands (
  id                  uuid primary key default gen_random_uuid(),
  round_id            uuid not null references public.bj_rounds (id) on delete cascade,
  table_id            uuid not null references public.game_tables (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  seat_no             integer not null,
  hand_index          integer not null default 0 check (hand_index between 0 and 2),
  bet                 bigint not null check (bet > 0),
  insurance           bigint not null default 0 check (insurance >= 0),
  insurance_decided   boolean not null default false,
  cards               smallint[] not null default '{}',
  status              text not null default 'betting'
                      check (status in ('betting', 'waiting', 'playing', 'stood', 'busted', 'blackjack', 'surrendered')),
  doubled             boolean not null default false,
  from_split          boolean not null default false,
  result              text check (result in ('win', 'lose', 'push', 'blackjack', 'surrender')),
  payout              bigint not null default 0,
  created_at          timestamptz not null default now(),
  unique (round_id, seat_no, hand_index)
);

create index if not exists bj_hands_round_idx on public.bj_hands (round_id, seat_no, hand_index);
create index if not exists bj_hands_table_idx on public.bj_hands (table_id);
create index if not exists bj_hands_user_idx on public.bj_hands (user_id) where result is null;

-- HIDDEN: the undealt shoe for each table.
create table if not exists public.bj_shoes (
  table_id     uuid primary key references public.game_tables (id) on delete cascade,
  cards        smallint[] not null,
  pos          integer not null default 0,
  shuffled_at  timestamptz not null default now()
);

-- HIDDEN: the dealer's hole card for each round.
create table if not exists public.bj_secrets (
  round_id   uuid primary key references public.bj_rounds (id) on delete cascade,
  hole_card  smallint not null
);

-- -----------------------------------------------------------------------------
-- Rules and card helpers
-- -----------------------------------------------------------------------------
create or replace function private.bj_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'decks', 6,
    'reshuffle_at', 234,          -- 75% of 312 cards
    'bet_seconds', 15,
    'insurance_seconds', 10,
    'turn_seconds', 20,
    'next_round_seconds', 5,
    'max_hands', 3
  );
$$;

create or replace function private.bj_card_value(c smallint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when c % 13 = 0 then 11 when c % 13 >= 9 then 10 else (c % 13) + 1 end;
$$;

-- Best total for a hand (aces count 11 unless that would bust).
create or replace function private.bj_total(p_cards smallint[])
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_aces integer := 0;
  c smallint;
begin
  foreach c in array coalesce(p_cards, '{}') loop
    v_total := v_total + private.bj_card_value(c);
    if c % 13 = 0 then v_aces := v_aces + 1; end if;
  end loop;
  while v_total > 21 and v_aces > 0 loop
    v_total := v_total - 10;
    v_aces := v_aces - 1;
  end loop;
  return v_total;
end $$;

-- True if the best total still counts an ace as 11 ("soft").
create or replace function private.bj_is_soft(p_cards smallint[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_hard integer := 0;
  v_has_ace boolean := false;
  c smallint;
begin
  foreach c in array coalesce(p_cards, '{}') loop
    v_hard := v_hard + case when c % 13 = 0 then 1 else private.bj_card_value(c) end;
    if c % 13 = 0 then v_has_ace := true; end if;
  end loop;
  return v_has_ace and v_hard + 10 <= 21;
end $$;

create or replace function private.bj_is_natural(p_cards smallint[], p_from_split boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not p_from_split and cardinality(p_cards) = 2 and private.bj_total(p_cards) = 21;
$$;

-- Draw the next card from the table's shoe (shuffles a fresh shoe if needed).
create or replace function private.bj_draw(p_table uuid)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.bj_shoes;
  v_card smallint;
begin
  select * into s from public.bj_shoes where table_id = p_table for update;
  if not found or s.pos >= cardinality(s.cards) then
    insert into public.bj_shoes (table_id, cards, pos, shuffled_at)
    values (p_table, private.shuffled_shoe((private.bj_rules() ->> 'decks')::int), 0, now())
    on conflict (table_id) do update set cards = excluded.cards, pos = 0, shuffled_at = now()
    returning * into s;
  end if;
  v_card := s.cards[s.pos + 1];
  update public.bj_shoes set pos = pos + 1 where table_id = p_table;
  return v_card;
end $$;

-- -----------------------------------------------------------------------------
-- Round engine (private)
-- -----------------------------------------------------------------------------
create or replace function private.bj_lock_table(p_table uuid)
returns public.game_tables
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.game_tables;
begin
  select * into t from public.game_tables where id = p_table for update;
  if not found or t.game_key <> 'blackjack' then
    raise exception 'table_not_found';
  end if;
  return t;
end $$;

create or replace function private.bj_latest_round(p_table uuid)
returns public.bj_rounds
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.bj_rounds where table_id = p_table order by round_no desc limit 1;
$$;

-- Is this player connected and still seated at the table?
create or replace function private.bj_player_present(p_table uuid, p_user uuid)
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

-- Settle every hand, pay out, record history. Dealer cards must be final.
create or replace function private.bj_settle(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.bj_rounds;
  h public.bj_hands;
  u record;
  v_dealer_total integer;
  v_dealer_bj boolean;
  v_total integer;
  v_result text;
  v_payout bigint;
  v_ins_payout bigint;
begin
  select * into r from public.bj_rounds where id = p_round for update;
  v_dealer_total := private.bj_total(r.dealer_cards);
  v_dealer_bj := private.bj_is_natural(r.dealer_cards, false);

  for h in select * from public.bj_hands where round_id = p_round order by seat_no, hand_index loop
    v_total := private.bj_total(h.cards);
    if h.status = 'surrendered' then
      v_result := 'surrender'; v_payout := h.bet / 2;
    elsif h.status = 'busted' then
      v_result := 'lose'; v_payout := 0;
    elsif h.status = 'blackjack' then
      if v_dealer_bj then v_result := 'push'; v_payout := h.bet;
      else v_result := 'blackjack'; v_payout := h.bet + (h.bet * 3) / 2;
      end if;
    elsif v_dealer_bj then
      v_result := 'lose'; v_payout := 0;
    elsif v_dealer_total > 21 or v_total > v_dealer_total then
      v_result := 'win'; v_payout := h.bet * 2;
    elsif v_total = v_dealer_total then
      v_result := 'push'; v_payout := h.bet;
    else
      v_result := 'lose'; v_payout := 0;
    end if;

    v_ins_payout := case when v_dealer_bj and h.insurance > 0 then h.insurance * 3 else 0 end;

    update public.bj_hands
       set result = v_result, payout = v_payout + v_ins_payout,
           status = case when status in ('playing', 'waiting') then 'stood' else status end
     where id = h.id;
  end loop;

  -- One credit, one history row per player (covers split hands and insurance).
  for u in
    select user_id, sum(bet + insurance)::bigint as wagered, sum(payout)::bigint as returned,
           jsonb_agg(jsonb_build_object('cards', cards, 'bet', bet, 'result', result, 'payout', payout,
                                        'total', private.bj_total(cards), 'insurance', insurance)
                     order by hand_index) as hands
      from public.bj_hands where round_id = p_round
     group by user_id
  loop
    if u.returned > 0 then
      perform private.apply_chips(u.user_id, u.returned, 'payout', 'blackjack', p_round::text,
                                  jsonb_build_object('round_no', r.round_no));
    end if;
    perform private.record_round(u.user_id, 'blackjack', r.table_id, p_round, u.wagered, u.returned,
      jsonb_build_object('round_no', r.round_no, 'hands', u.hands,
                         'dealer', jsonb_build_object('cards', r.dealer_cards, 'total', v_dealer_total)));
  end loop;

  update public.bj_rounds
     set phase = 'settled',
         turn_hand_id = null,
         dealer_total = v_dealer_total,
         dealer_result = case when v_dealer_bj then 'blackjack' when v_dealer_total > 21 then 'bust' else 'stand' end,
         settled_at = now(),
         phase_ends_at = now() + make_interval(secs => (private.bj_rules() ->> 'next_round_seconds')::int)
   where id = p_round;
end $$;

-- Reveal the hole card, draw to 17 (standing on soft 17) if anyone needs it, settle.
create or replace function private.bj_dealer_play(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.bj_rounds;
  v_cards smallint[];
  v_hole smallint;
  v_needs_draw boolean;
begin
  select * into r from public.bj_rounds where id = p_round for update;
  select hole_card into v_hole from public.bj_secrets where round_id = p_round;
  v_cards := r.dealer_cards || v_hole;

  v_needs_draw := exists (select 1 from public.bj_hands where round_id = p_round and status = 'stood');
  if v_needs_draw then
    while private.bj_total(v_cards) < 17 loop
      v_cards := v_cards || private.bj_draw(r.table_id);
    end loop;
  end if;

  update public.bj_rounds set dealer_cards = v_cards, turn_hand_id = null where id = p_round;
  perform private.bj_settle(p_round);
end $$;

-- Hand the turn to the next unfinished hand, skipping (auto-standing) players
-- who have left or disconnected. When nobody is left to act, the dealer plays.
create or replace function private.bj_next_turn(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.bj_rounds;
  h public.bj_hands;
begin
  select * into r from public.bj_rounds where id = p_round for update;
  loop
    select * into h from public.bj_hands
     where round_id = p_round and status in ('waiting', 'playing')
     order by seat_no, hand_index
     limit 1;

    if not found then
      perform private.bj_dealer_play(p_round);
      return;
    end if;

    if not private.bj_player_present(r.table_id, h.user_id) then
      update public.bj_hands set status = 'stood' where id = h.id;
      continue;
    end if;

    update public.bj_hands set status = 'playing' where id = h.id;
    update public.bj_rounds
       set phase = 'playing',
           turn_hand_id = h.id,
           phase_ends_at = now() + make_interval(secs => (private.bj_rules() ->> 'turn_seconds')::int)
     where id = p_round;
    return;
  end loop;
end $$;

-- After the insurance window (or straight after the deal): dealer peeks when
-- showing an Ace or a ten. Dealer blackjack ends the round immediately.
create or replace function private.bj_after_insurance(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.bj_rounds;
  v_hole smallint;
  v_up smallint;
begin
  select * into r from public.bj_rounds where id = p_round for update;
  update public.bj_hands set insurance_decided = true where round_id = p_round;
  v_up := r.dealer_cards[1];
  select hole_card into v_hole from public.bj_secrets where round_id = p_round;

  if private.bj_card_value(v_up) >= 10 and private.bj_is_natural(array[v_up, v_hole]::smallint[], false) then
    update public.bj_rounds set dealer_cards = array[v_up, v_hole]::smallint[] where id = p_round;
    update public.bj_hands set status = case when status = 'blackjack' then 'blackjack' else 'stood' end
     where round_id = p_round;
    perform private.bj_settle(p_round);
    return;
  end if;

  perform private.bj_next_turn(p_round);
end $$;

-- Close betting and deal two cards to every hand and the dealer.
create or replace function private.bj_deal(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.bj_rounds;
  h record;
  v_up smallint;
  v_hole smallint;
  v_shoe public.bj_shoes;
begin
  select * into r from public.bj_rounds where id = p_round for update;

  -- Players who left during betting get their bet back.
  for h in
    select bh.* from public.bj_hands bh
     where bh.round_id = p_round
       and not exists (select 1 from public.table_seats s where s.table_id = r.table_id and s.user_id = bh.user_id)
  loop
    perform private.apply_chips(h.user_id, h.bet, 'refund', 'blackjack', p_round::text,
                                jsonb_build_object('note', 'Left before the deal'));
    delete from public.bj_hands where id = h.id;
  end loop;

  if not exists (select 1 from public.bj_hands where round_id = p_round) then
    update public.bj_rounds set phase = 'settled', settled_at = now(), phase_ends_at = now() where id = p_round;
    return;
  end if;

  -- Fresh shoe once the cut card is reached.
  select * into v_shoe from public.bj_shoes where table_id = r.table_id;
  if not found or v_shoe.pos >= (private.bj_rules() ->> 'reshuffle_at')::int then
    insert into public.bj_shoes (table_id, cards, pos, shuffled_at)
    values (r.table_id, private.shuffled_shoe((private.bj_rules() ->> 'decks')::int), 0, now())
    on conflict (table_id) do update set cards = excluded.cards, pos = 0, shuffled_at = now();
  end if;

  -- Classic order: one card to each hand, dealer up card, second card each, dealer hole card.
  for h in select id from public.bj_hands where round_id = p_round order by seat_no loop
    update public.bj_hands set cards = array[private.bj_draw(r.table_id)] where id = h.id;
  end loop;
  v_up := private.bj_draw(r.table_id);
  for h in select id from public.bj_hands where round_id = p_round order by seat_no loop
    update public.bj_hands set cards = cards || private.bj_draw(r.table_id) where id = h.id;
  end loop;
  v_hole := private.bj_draw(r.table_id);

  insert into public.bj_secrets (round_id, hole_card) values (p_round, v_hole)
  on conflict (round_id) do update set hole_card = excluded.hole_card;

  update public.bj_hands
     set status = case when private.bj_is_natural(cards, false) then 'blackjack' else 'waiting' end
   where round_id = p_round;

  update public.bj_rounds set dealer_cards = array[v_up]::smallint[] where id = p_round;
  update public.game_tables set last_activity_at = now() where id = r.table_id;

  if v_up % 13 = 0 then
    update public.bj_rounds
       set phase = 'insurance',
           phase_ends_at = now() + make_interval(secs => (private.bj_rules() ->> 'insurance_seconds')::int)
     where id = p_round;
  else
    perform private.bj_after_insurance(p_round);
  end if;
end $$;

-- Process any expired deadline. Safe to call any time, by anyone at the table.
create or replace function private.bj_tick(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.bj_rounds;
  h public.bj_hands;
  i integer := 0;
begin
  loop
    i := i + 1;
    exit when i > 25;
    r := private.bj_latest_round(p_table);
    exit when r.id is null or r.phase = 'settled' or r.phase_ends_at is null or r.phase_ends_at > now();

    if r.phase = 'betting' then
      perform private.bj_deal(r.id);
    elsif r.phase = 'insurance' then
      perform private.bj_after_insurance(r.id);
    elsif r.phase = 'playing' then
      select * into h from public.bj_hands where id = r.turn_hand_id;
      if found and h.status = 'playing' then
        update public.bj_hands set status = 'stood' where id = h.id;
      end if;
      perform private.bj_next_turn(r.id);
    end if;
  end loop;
end $$;

-- Deal early once every connected, active player at the table has a bet down.
create or replace function private.bj_maybe_deal_early(p_round uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.bj_rounds;
begin
  select * into r from public.bj_rounds where id = p_round;
  if r.phase <> 'betting' then
    return;
  end if;
  if not exists (
    select 1 from public.table_seats s
     where s.table_id = r.table_id
       and s.status = 'active'
       and s.last_seen_at > now() - (select disconnected from private.seat_timeouts())
       and not exists (select 1 from public.bj_hands bh where bh.round_id = r.id and bh.user_id = s.user_id)
  ) then
    perform private.bj_deal(r.id);
  end if;
end $$;

-- The current user's hand whose turn it is, or an error.
create or replace function private.bj_my_turn_hand(p_table uuid, p_user uuid)
returns public.bj_hands
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.bj_rounds;
  h public.bj_hands;
begin
  r := private.bj_latest_round(p_table);
  if r.id is null or r.phase <> 'playing' then
    raise exception 'not_your_turn';
  end if;
  select * into h from public.bj_hands where id = r.turn_hand_id;
  if not found or h.user_id <> p_user or h.status <> 'playing' then
    raise exception 'not_your_turn';
  end if;
  return h;
end $$;

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------

-- Everything a client needs to draw the table. Never includes the shoe or the
-- dealer's hole card.
create or replace function public.bj_state(p_table uuid)
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
  r public.bj_rounds;
  v_disc interval := (select disconnected from private.seat_timeouts());
begin
  if not private.can_view_table(p_table) then
    raise exception 'table_not_found';
  end if;
  select * into t from public.game_tables where id = p_table;
  if t.game_key <> 'blackjack' then
    raise exception 'table_not_found';
  end if;
  select * into st from public.stake_tiers where game_key = t.game_key and tier = t.tier;
  r := private.bj_latest_round(p_table);

  return jsonb_build_object(
    'server_now', now(),
    'rules', private.bj_rules(),
    'table', jsonb_build_object(
      'id', t.id, 'name', t.name, 'tier', t.tier, 'tier_label', st.label,
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
      'turn_hand_id', r.turn_hand_id, 'dealer_cards', to_jsonb(r.dealer_cards),
      'dealer_total', case when cardinality(r.dealer_cards) > 0 then private.bj_total(r.dealer_cards) end,
      'dealer_result', r.dealer_result, 'settled_at', r.settled_at,
      'hole_hidden', r.phase in ('insurance', 'playing') and cardinality(r.dealer_cards) = 1
    ) end,
    'hands', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'seat_no', h.seat_no, 'user_id', h.user_id, 'hand_index', h.hand_index,
               'bet', h.bet, 'insurance', h.insurance, 'insurance_decided', h.insurance_decided,
               'cards', to_jsonb(h.cards), 'total', private.bj_total(h.cards), 'soft', private.bj_is_soft(h.cards),
               'status', h.status, 'doubled', h.doubled, 'from_split', h.from_split,
               'result', h.result, 'payout', h.payout) order by h.seat_no, h.hand_index)
        from public.bj_hands h where h.round_id = r.id), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('round_no', x.round_no, 'dealer_total', x.dealer_total,
                                          'dealer_result', x.dealer_result) order by x.round_no desc)
        from (select round_no, dealer_total, dealer_result from public.bj_rounds
               where table_id = p_table and phase = 'settled' and dealer_total is not null
               order by round_no desc limit 12) x), '[]'::jsonb)
  );
end $$;

-- Place (or change) your bet for the next hand.
create or replace function public.bj_place_bet(p_table uuid, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.game_tables;
  r public.bj_rounds;
  v_seat integer;
  v_old bigint;
begin
  t := private.bj_lock_table(p_table);
  perform private.bj_tick(p_table);

  select seat_no into v_seat from public.table_seats where table_id = p_table and user_id = v_uid;
  if v_seat is null then
    raise exception 'not_seated';
  end if;
  update public.table_seats set status = 'active', last_seen_at = now()
   where table_id = p_table and user_id = v_uid;

  perform private.assert_bet_in_range('blackjack', t.tier, p_amount);

  r := private.bj_latest_round(p_table);
  if r.id is null or (r.phase = 'settled' and r.phase_ends_at <= now()) then
    insert into public.bj_rounds (table_id, round_no, phase, phase_ends_at)
    values (p_table, coalesce(r.round_no, 0) + 1, 'betting',
            now() + make_interval(secs => (private.bj_rules() ->> 'bet_seconds')::int))
    returning * into r;
  elsif r.phase = 'settled' then
    raise exception 'next_round_pending';
  elsif r.phase <> 'betting' then
    raise exception 'betting_closed';
  end if;

  select bet into v_old from public.bj_hands where round_id = r.id and user_id = v_uid and hand_index = 0;
  if v_old is null then
    perform private.apply_chips(v_uid, -p_amount, 'bet', 'blackjack', r.id::text,
                                jsonb_build_object('round_no', r.round_no));
    insert into public.bj_hands (round_id, table_id, user_id, seat_no, bet)
    values (r.id, p_table, v_uid, v_seat, p_amount);
  elsif v_old <> p_amount then
    perform private.apply_chips(v_uid, v_old - p_amount, 'bet', 'blackjack', r.id::text,
                                jsonb_build_object('round_no', r.round_no, 'changed_from', v_old, 'bet', p_amount));
    update public.bj_hands set bet = p_amount, seat_no = v_seat
     where round_id = r.id and user_id = v_uid and hand_index = 0;
  end if;

  update public.game_tables set last_activity_at = now() where id = p_table;
  perform private.bj_maybe_deal_early(r.id);
  return jsonb_build_object('round_id', r.id, 'bet', p_amount);
end $$;

-- Take your bet back while betting is still open.
create or replace function public.bj_clear_bet(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r public.bj_rounds;
  h public.bj_hands;
begin
  perform private.bj_lock_table(p_table);
  perform private.bj_tick(p_table);
  r := private.bj_latest_round(p_table);
  if r.id is null or r.phase <> 'betting' then
    raise exception 'betting_closed';
  end if;
  select * into h from public.bj_hands where round_id = r.id and user_id = v_uid and hand_index = 0;
  if found then
    perform private.apply_chips(v_uid, h.bet, 'refund', 'blackjack', r.id::text,
                                jsonb_build_object('round_no', r.round_no, 'note', 'Bet cleared'));
    delete from public.bj_hands where id = h.id;
  end if;
end $$;

-- Ask the dealer to deal now (only once every present player has bet).
create or replace function public.bj_deal_now(p_table uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r public.bj_rounds;
begin
  perform private.bj_lock_table(p_table);
  r := private.bj_latest_round(p_table);
  if r.id is null or r.phase <> 'betting'
     or not exists (select 1 from public.bj_hands where round_id = r.id and user_id = v_uid) then
    raise exception 'betting_closed';
  end if;
  perform private.bj_maybe_deal_early(r.id);
end $$;

-- Take or decline insurance (offered when the dealer shows an Ace).
create or replace function public.bj_insurance(p_table uuid, p_take boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  r public.bj_rounds;
  h public.bj_hands;
  v_amount bigint;
begin
  perform private.bj_lock_table(p_table);
  perform private.bj_tick(p_table);
  r := private.bj_latest_round(p_table);
  if r.id is null or r.phase <> 'insurance' then
    raise exception 'insurance_closed';
  end if;
  select * into h from public.bj_hands
   where round_id = r.id and user_id = v_uid and hand_index = 0 and not insurance_decided;
  if not found then
    raise exception 'insurance_closed';
  end if;

  if p_take then
    v_amount := h.bet / 2;
    if v_amount > 0 then
      perform private.apply_chips(v_uid, -v_amount, 'bet', 'blackjack', r.id::text,
                                  jsonb_build_object('round_no', r.round_no, 'insurance', true));
    end if;
    update public.bj_hands set insurance = v_amount, insurance_decided = true where id = h.id;
  else
    update public.bj_hands set insurance_decided = true where id = h.id;
  end if;

  if not exists (select 1 from public.bj_hands where round_id = r.id and not insurance_decided) then
    perform private.bj_after_insurance(r.id);
  end if;
end $$;

-- hit | stand | double | split | surrender
create or replace function public.bj_action(p_table uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  t public.game_tables;
  r public.bj_rounds;
  h public.bj_hands;
  v_total integer;
  v_card smallint;
  v_hand_count integer;
  v_new_index integer;
  v_split_aces boolean;
begin
  t := private.bj_lock_table(p_table);
  perform private.bj_tick(p_table);
  h := private.bj_my_turn_hand(p_table, v_uid);
  r := private.bj_latest_round(p_table);
  update public.table_seats set last_seen_at = now() where table_id = p_table and user_id = v_uid;

  if p_action = 'hit' then
    update public.bj_hands set cards = cards || private.bj_draw(p_table) where id = h.id
    returning * into h;
    v_total := private.bj_total(h.cards);
    if v_total > 21 then
      update public.bj_hands set status = 'busted' where id = h.id;
      perform private.bj_next_turn(r.id);
    elsif v_total = 21 then
      update public.bj_hands set status = 'stood' where id = h.id;
      perform private.bj_next_turn(r.id);
    else
      update public.bj_rounds
         set phase_ends_at = now() + make_interval(secs => (private.bj_rules() ->> 'turn_seconds')::int)
       where id = r.id;
    end if;

  elsif p_action = 'stand' then
    update public.bj_hands set status = 'stood' where id = h.id;
    perform private.bj_next_turn(r.id);

  elsif p_action = 'double' then
    if cardinality(h.cards) <> 2 then
      raise exception 'action_not_allowed' using hint = 'You can only double on your first two cards.';
    end if;
    perform private.apply_chips(v_uid, -h.bet, 'bet', 'blackjack', r.id::text,
                                jsonb_build_object('round_no', r.round_no, 'double', true));
    v_card := private.bj_draw(p_table);
    update public.bj_hands
       set bet = bet * 2, doubled = true, cards = cards || v_card,
           status = case when private.bj_total(cards || v_card) > 21 then 'busted' else 'stood' end
     where id = h.id;
    perform private.bj_next_turn(r.id);

  elsif p_action = 'split' then
    if cardinality(h.cards) <> 2 or private.bj_card_value(h.cards[1]) <> private.bj_card_value(h.cards[2]) then
      raise exception 'action_not_allowed' using hint = 'You can only split two cards of the same value.';
    end if;
    select count(*), max(hand_index) + 1 into v_hand_count, v_new_index
      from public.bj_hands where round_id = r.id and user_id = v_uid;
    if v_hand_count >= (private.bj_rules() ->> 'max_hands')::int then
      raise exception 'action_not_allowed' using hint = 'You can split into at most 3 hands.';
    end if;
    perform private.apply_chips(v_uid, -h.bet, 'bet', 'blackjack', r.id::text,
                                jsonb_build_object('round_no', r.round_no, 'split', true));
    v_split_aces := h.cards[1] % 13 = 0;

    insert into public.bj_hands (round_id, table_id, user_id, seat_no, hand_index, bet, cards, status,
                                 from_split, insurance_decided)
    values (r.id, p_table, v_uid, h.seat_no, v_new_index, h.bet,
            array[h.cards[2], private.bj_draw(p_table)]::smallint[],
            case when v_split_aces then 'stood' else 'waiting' end, true, true);

    update public.bj_hands
       set cards = array[h.cards[1], private.bj_draw(p_table)]::smallint[], from_split = true
     where id = h.id
    returning * into h;

    if v_split_aces or private.bj_total(h.cards) = 21 then
      update public.bj_hands set status = 'stood' where id = h.id;
      perform private.bj_next_turn(r.id);
    else
      update public.bj_rounds
         set phase_ends_at = now() + make_interval(secs => (private.bj_rules() ->> 'turn_seconds')::int)
       where id = r.id;
    end if;

  elsif p_action = 'surrender' then
    if cardinality(h.cards) <> 2 or h.from_split
       or (select count(*) from public.bj_hands where round_id = r.id and user_id = v_uid) > 1 then
      raise exception 'action_not_allowed' using hint = 'You can only surrender your first two cards.';
    end if;
    update public.bj_hands set status = 'surrendered' where id = h.id;
    perform private.bj_next_turn(r.id);

  else
    raise exception 'action_not_allowed';
  end if;

  update public.game_tables set last_activity_at = now() where id = p_table;
end $$;

-- Process expired timers (auto-stand, close betting, close insurance).
-- Any signed-in player who can see the table may call it; the server decides.
create or replace function public.bj_advance(p_table uuid)
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
  perform private.bj_lock_table(p_table);
  perform private.bj_tick(p_table);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.bj_state(uuid)', 'public.bj_place_bet(uuid, bigint)', 'public.bj_clear_bet(uuid)',
    'public.bj_deal_now(uuid)', 'public.bj_insurance(uuid, boolean)', 'public.bj_action(uuid, text)',
    'public.bj_advance(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Finish blackjack rounds whose timers expired while nobody was at the table,
-- so bets never stay stuck "in play". Picked up by private.tick_stale_tables().
create or replace function private.bj_tick_stale()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table uuid;
begin
  for v_table in
    select distinct r.table_id from public.bj_rounds r
     where r.phase <> 'settled' and r.phase_ends_at < now() - interval '2 seconds'
  loop
    perform private.bj_lock_table(v_table);
    perform private.bj_tick(v_table);
  end loop;
end $$;

-- Unsettled blackjack bets (picked up by private.chips_in_play()).
create or replace function private.bj_in_play(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(bet + insurance), 0)::bigint from public.bj_hands
   where user_id = p_user and result is null;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.bj_rounds  enable row level security;
alter table public.bj_hands   enable row level security;
alter table public.bj_shoes   enable row level security;
alter table public.bj_secrets enable row level security;

drop policy if exists "bj_rounds: rounds at visible tables" on public.bj_rounds;
create policy "bj_rounds: rounds at visible tables"
  on public.bj_rounds for select
  to authenticated
  using (private.can_view_table(table_id));

-- Blackjack player cards are dealt face up, so everyone at the table sees them.
drop policy if exists "bj_hands: hands at visible tables" on public.bj_hands;
create policy "bj_hands: hands at visible tables"
  on public.bj_hands for select
  to authenticated
  using (private.can_view_table(table_id));

-- bj_shoes and bj_secrets: RLS on, NO policies, NO privileges. Unreadable by clients.
revoke all on public.bj_shoes, public.bj_secrets from anon, authenticated;
revoke insert, update, delete, truncate on public.bj_rounds, public.bj_hands from anon, authenticated;
revoke all on public.bj_rounds, public.bj_hands from anon;
grant select on public.bj_rounds, public.bj_hands to authenticated;

-- -----------------------------------------------------------------------------
-- Open the game and seed one always-open house table per stake level.
-- -----------------------------------------------------------------------------
update public.games set released = true where key = 'blackjack';

insert into public.game_tables (game_key, tier, name, max_seats, persistent)
select 'blackjack', v.tier, v.name, 5, true
  from (values ('low', 'Emerald Room'), ('mid', 'Ruby Room'), ('high', 'Sapphire Room'), ('vip', 'Gold Room')) v(tier, name)
 where not exists (
   select 1 from public.game_tables t where t.game_key = 'blackjack' and t.tier = v.tier and t.persistent
 );

select private.add_to_realtime('bj_rounds');
select private.add_to_realtime('bj_hands');

-- Lock down every private helper; RLS only needs can_view_table.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

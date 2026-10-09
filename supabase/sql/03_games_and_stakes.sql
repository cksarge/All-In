-- =============================================================================
-- All In · 03_games_and_stakes.sql
-- Game catalogue and stake tiers (Low, Mid, High, VIP) for every game.
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run: seed rows are upserted, so edits made here are re-applied.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- games: one row per playable game (each slot machine is its own game).
-- `released` flips to true in the phase that ships the game.
-- -----------------------------------------------------------------------------
create table if not exists public.games (
  key            text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name           text not null,
  category       text not null check (category in ('table', 'poker', 'slots', 'specialty')),
  tagline        text not null default '',
  multiplayer    boolean not null default false,
  min_seats      integer not null default 1,
  max_seats      integer not null default 1,
  stake_profile  text not null check (stake_profile in ('table', 'poker', 'stud', 'slots', 'specialty')),
  sort_order     integer not null default 100,
  released       boolean not null default false,
  created_at     timestamptz not null default now()
);

insert into public.games (key, name, category, tagline, multiplayer, min_seats, max_seats, stake_profile, sort_order) values
  ('blackjack',          'Blackjack',            'table',     'Beat the dealer to 21. Up to 5 seats.',            true,  1, 5, 'table',     10),
  ('roulette',           'Roulette',             'table',     'European and American wheels, shared table.',     true,  1, 8, 'table',     20),
  ('craps',              'Craps',                'table',     'Roll the bones with a rotating shooter.',         true,  1, 8, 'table',     30),
  ('baccarat',           'Baccarat',             'table',     'Player, Banker or Tie.',                          false, 1, 1, 'table',     40),
  ('poker_holdem',       'Texas Hold''em',       'poker',     'No-limit Hold''em for 2 to 9 players.',           true,  2, 9, 'poker',     50),
  ('poker_omaha',        'Omaha',                'poker',     'Pot-limit Omaha. Four hole cards.',               true,  2, 9, 'poker',     51),
  ('poker_omaha_hilo',   'Omaha Hi-Lo',          'poker',     'Split pots between the best high and low.',       true,  2, 9, 'poker',     52),
  ('poker_stud',         'Seven-Card Stud',      'poker',     'Antes, bring-ins and five betting streets.',      true,  2, 8, 'stud',      53),
  ('poker_draw',         'Five-Card Draw',       'poker',     'Classic draw poker.',                             true,  2, 6, 'poker',     54),
  ('slots_classic',      'Lucky Sevens',         'slots',     'Classic 3-reel fruit machine.',                   false, 1, 1, 'slots',     60),
  ('slots_paylines',     'Pharaoh''s Fortune',   'slots',     '5 reels, 20 paylines, wilds and free spins.',     false, 1, 1, 'slots',     61),
  ('slots_cascade',      'Gem Cascade',          'slots',     'Cluster pays with cascading wins.',               false, 1, 1, 'slots',     62),
  ('slots_ways',         'Wild Frontier',        'slots',     'Ways-to-win with expanding reels.',               false, 1, 1, 'slots',     63),
  ('slots_holdwin',      'Dragon Pearls',        'slots',     'Hold-and-win bonus rounds.',                      false, 1, 1, 'slots',     64),
  ('slots_progressive',  'Grand Jackpot',        'slots',     'One shared progressive jackpot for everyone.',    false, 1, 1, 'slots',     65),
  ('video_poker_jacks',  'Jacks or Better',      'specialty', 'Video poker. Pair of jacks or better pays.',      false, 1, 1, 'slots',     70),
  ('video_poker_deuces', 'Deuces Wild',          'specialty', 'Video poker. Every 2 is wild.',                   false, 1, 1, 'slots',     71),
  ('three_card_poker',   'Three Card Poker',     'specialty', 'Ante, Play and Pair Plus.',                       false, 1, 1, 'table',     72),
  ('pai_gow_poker',      'Pai Gow Poker',        'specialty', 'Set a five-card and a two-card hand.',            false, 1, 1, 'table',     73),
  ('sic_bo',             'Sic Bo',               'specialty', 'Three dice, dozens of ways to call them.',        false, 1, 1, 'table',     74),
  ('keno',               'Keno',                 'specialty', 'Pick up to 10 numbers and watch the draw.',       false, 1, 1, 'slots',     75),
  ('money_wheel',        'Big Six Wheel',        'specialty', 'Spin the big money wheel.',                       false, 1, 1, 'table',     76)
on conflict (key) do update set
  name          = excluded.name,
  category      = excluded.category,
  tagline       = excluded.tagline,
  multiplayer   = excluded.multiplayer,
  min_seats     = excluded.min_seats,
  max_seats     = excluded.max_seats,
  stake_profile = excluded.stake_profile,
  sort_order    = excluded.sort_order;
-- Note: `released` is intentionally NOT overwritten so later phases stay released.

-- -----------------------------------------------------------------------------
-- stake_tiers: min/max bet and minimum bankroll to enter, per game per tier.
-- For poker, min_bet is the big blind and `params` holds blinds/antes/stacks.
-- -----------------------------------------------------------------------------
create table if not exists public.stake_tiers (
  game_key      text not null references public.games (key) on delete cascade,
  tier          text not null check (tier in ('low', 'mid', 'high', 'vip')),
  tier_rank     integer not null check (tier_rank between 1 and 4),
  label         text not null,
  min_bet       bigint not null check (min_bet > 0),
  max_bet       bigint not null,
  min_bankroll  bigint not null check (min_bankroll >= 0),
  params        jsonb not null default '{}'::jsonb,
  primary key (game_key, tier),
  constraint stake_tiers_bet_range check (max_bet >= min_bet)
);

-- Tier templates per stake profile.
with profile (stake_profile, tier, tier_rank, label, min_bet, max_bet, min_bankroll, params) as (
  values
    -- Table games: per-hand / per-spot limits.
    ('table',     'low',  1, 'Low',  10::bigint,    500::bigint,     100::bigint,    '{}'::jsonb),
    ('table',     'mid',  2, 'Mid',  100,           5000,            2500,           '{}'),
    ('table',     'high', 3, 'High', 1000,          50000,           25000,          '{}'),
    ('table',     'vip',  4, 'VIP',  10000,         250000,          250000,         '{}'),
    -- Hold'em / Omaha / Draw: blinds. max_bet = max table stack.
    ('poker',     'low',  1, 'Low',  10,            1000,            200,
       '{"small_blind":5,"big_blind":10,"ante":0,"min_stack":200,"max_stack":1000}'),
    ('poker',     'mid',  2, 'Mid',  100,           10000,           2000,
       '{"small_blind":50,"big_blind":100,"ante":0,"min_stack":2000,"max_stack":10000}'),
    ('poker',     'high', 3, 'High', 1000,          100000,          20000,
       '{"small_blind":500,"big_blind":1000,"ante":0,"min_stack":20000,"max_stack":100000}'),
    ('poker',     'vip',  4, 'VIP',  5000,          500000,          100000,
       '{"small_blind":2500,"big_blind":5000,"ante":500,"min_stack":100000,"max_stack":500000}'),
    -- Seven-Card Stud: ante + bring-in, fixed small/big bets.
    ('stud',      'low',  1, 'Low',  10,            1000,            200,
       '{"ante":2,"bring_in":5,"small_bet":10,"big_bet":20,"min_stack":200,"max_stack":1000}'),
    ('stud',      'mid',  2, 'Mid',  100,           10000,           2000,
       '{"ante":20,"bring_in":50,"small_bet":100,"big_bet":200,"min_stack":2000,"max_stack":10000}'),
    ('stud',      'high', 3, 'High', 1000,          100000,          20000,
       '{"ante":200,"bring_in":500,"small_bet":1000,"big_bet":2000,"min_stack":20000,"max_stack":100000}'),
    ('stud',      'vip',  4, 'VIP',  5000,          500000,          100000,
       '{"ante":1000,"bring_in":2500,"small_bet":5000,"big_bet":10000,"min_stack":100000,"max_stack":500000}'),
    -- Slots, video poker, keno: per spin / per hand.
    ('slots',     'low',  1, 'Low',  10,            100,             10,             '{}'),
    ('slots',     'mid',  2, 'Mid',  100,           1000,            2500,           '{}'),
    ('slots',     'high', 3, 'High', 1000,          10000,           25000,          '{}'),
    ('slots',     'vip',  4, 'VIP',  5000,          50000,           250000,         '{}')
)
insert into public.stake_tiers (game_key, tier, tier_rank, label, min_bet, max_bet, min_bankroll, params)
select g.key, p.tier, p.tier_rank, p.label, p.min_bet, p.max_bet, p.min_bankroll, p.params
  from public.games g
  join profile p on p.stake_profile = g.stake_profile
on conflict (game_key, tier) do update set
  tier_rank    = excluded.tier_rank,
  label        = excluded.label,
  min_bet      = excluded.min_bet,
  max_bet      = excluded.max_bet,
  min_bankroll = excluded.min_bankroll,
  params       = excluded.params;

-- -----------------------------------------------------------------------------
-- Server-side guards used by every game function in later phases.
-- -----------------------------------------------------------------------------

-- Raises 'tier_locked' unless the player's chips meet the tier's minimum bankroll.
create or replace function private.assert_tier_access(p_user uuid, p_game text, p_tier text)
returns public.stake_tiers
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.stake_tiers;
  v_chips bigint;
begin
  select * into t from public.stake_tiers where game_key = p_game and tier = p_tier;
  if not found then
    raise exception 'unknown_stake_tier';
  end if;
  select w.balance + private.chips_in_play(p_user) into v_chips
    from public.wallets w where w.user_id = p_user;
  if coalesce(v_chips, 0) < t.min_bankroll then
    raise exception 'tier_locked'
      using hint = format('%s stakes need at least %s chips.', t.label, t.min_bankroll);
  end if;
  return t;
end $$;

-- Raises 'bet_out_of_range' unless min_bet <= amount <= max_bet.
create or replace function private.assert_bet_in_range(p_game text, p_tier text, p_amount bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.stake_tiers;
begin
  select * into t from public.stake_tiers where game_key = p_game and tier = p_tier;
  if not found then
    raise exception 'unknown_stake_tier';
  end if;
  if p_amount is null or p_amount < t.min_bet or p_amount > t.max_bet then
    raise exception 'bet_out_of_range'
      using hint = format('Bets at this table are %s to %s chips.', t.min_bet, t.max_bet);
  end if;
end $$;

revoke all on function private.assert_tier_access(uuid, text, text) from public;
revoke all on function private.assert_bet_in_range(text, text, bigint) from public;

-- -----------------------------------------------------------------------------
-- Row Level Security: public, read-only reference data.
-- -----------------------------------------------------------------------------
alter table public.games       enable row level security;
alter table public.stake_tiers enable row level security;

drop policy if exists "games: anyone can read" on public.games;
create policy "games: anyone can read"
  on public.games for select
  to anon, authenticated
  using (true);

drop policy if exists "stake_tiers: anyone can read" on public.stake_tiers;
create policy "stake_tiers: anyone can read"
  on public.stake_tiers for select
  to anon, authenticated
  using (true);

revoke insert, update, delete, truncate on public.games, public.stake_tiers from anon, authenticated;
grant select on public.games, public.stake_tiers to anon, authenticated;

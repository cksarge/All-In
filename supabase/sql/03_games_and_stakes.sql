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

-- A seasonal game is only open during its month ("2026-10"). Null = always open.
alter table public.games add column if not exists season text check (season ~ '^[0-9]{4}-[0-9]{2}$');

insert into public.games (key, name, category, tagline, multiplayer, min_seats, max_seats, stake_profile, sort_order) values
  ('blackjack',          'Blackjack',            'table',     'Beat the dealer to 21. Up to 5 seats.',            true,  1, 5, 'table',     10),
  ('roulette',           'Roulette',             'table',     'European and American wheels, shared table.',     true,  1, 8, 'table',     20),
  ('craps',              'Craps',                'table',     'Roll the bones with a rotating shooter.',         true,  1, 8, 'table',     30),
  ('baccarat',           'Baccarat',             'table',     'Player, Banker or Tie.',                          false, 1, 1, 'table',     40),
  ('dragon_tiger',       'Dragon Tiger',         'table',     'One card each. Bet on the higher one.',           false, 1, 1, 'table',     41),
  ('casino_war',         'Casino War',           'table',     'Your card against the dealer''s. Tie? Go to war.', false, 1, 1, 'table',    42),
  ('sic_bo',             'Sic Bo',               'table',     'Three dice, dozens of ways to call them.',        false, 1, 1, 'table',     43),
  ('money_wheel',        'Big Six Wheel',        'table',     'Spin the big money wheel.',                       false, 1, 1, 'table',     44),
  ('spanish_21',         'Spanish 21',           'table',     'Blackjack with no tens in the deck and bonus 21s.', false, 1, 1, 'table',   121),
  ('blackjack_switch',   'Blackjack Switch',     'table',     'Two hands. Swap their second cards if you like.', false, 1, 1, 'table',     122),
  ('free_bet_blackjack', 'Free Bet Blackjack',   'table',     'The house pays for your doubles and splits.',     false, 1, 1, 'table',     123),
  ('pontoon',            'Pontoon',              'table',     'Twist, stick or buy. A five-card trick pays double.', false, 1, 1, 'table', 124),
  ('red_dog',            'Red Dog',              'table',     'Will the third card land between the first two?', false, 1, 1, 'slots',     125),
  ('andar_bahar',        'Andar Bahar',          'table',     'Which side gets the matching card first?',        false, 1, 1, 'table',     126),
  ('chuck_a_luck',       'Chuck-a-Luck',         'table',     'Three dice in a cage. Bet on what they show.',    false, 1, 1, 'table',     127),
  ('poker_holdem',       'Texas Hold''em',       'poker',     'No-limit Hold''em for 2 to 9 players.',           true,  2, 9, 'poker',     50),
  ('poker_omaha',        'Omaha',                'poker',     'Pot-limit Omaha. Four hole cards.',               true,  2, 9, 'poker',     51),
  ('poker_omaha_hilo',   'Omaha Hi-Lo',          'poker',     'Split pots between the best high and low.',       true,  2, 9, 'poker',     52),
  ('poker_stud',         'Seven-Card Stud',      'poker',     'Antes, bring-ins and five betting streets.',      true,  2, 8, 'stud',      53),
  ('poker_draw',         'Five-Card Draw',       'poker',     'Classic draw poker.',                             true,  2, 6, 'poker',     54),
  ('poker_shortdeck',    'Short Deck Hold''em',  'poker',     'Hold''em with a 36-card deck. A flush beats a full house.', true, 2, 9, 'poker', 131),
  ('poker_razz',         'Razz',                 'poker',     'Seven-card stud where the lowest hand wins.',     true,  2, 8, 'stud',      132),
  ('poker_27',           '2-7 Triple Draw',      'poker',     'Lowball with three draws. 7-5-4-3-2 is the best hand.', true, 2, 6, 'poker', 133),
  ('poker_badugi',       'Badugi',               'poker',     'Four cards, three draws. Make four low cards of different suits.', true, 2, 6, 'poker', 134),
  ('ultimate_holdem',    'Ultimate Texas Hold''em', 'poker',  'Hold''em against the dealer. Bet early for more.', false, 1, 1, 'table',    55),
  ('three_card_poker',   'Three Card Poker',     'poker',     'Ante, Play and Pair Plus.',                       false, 1, 1, 'table',     56),
  ('pai_gow_poker',      'Pai Gow Poker',        'poker',     'Set a five-card and a two-card hand.',            false, 1, 1, 'table',     57),
  ('caribbean_stud',     'Caribbean Stud',       'poker',     'Five cards against the dealer. Raise or fold.',   false, 1, 1, 'table',     101),
  ('casino_holdem',      'Casino Hold''em',      'poker',     'Hold''em against the dealer: see the flop, then call or fold.', false, 1, 1, 'table', 102),
  ('let_it_ride',        'Let It Ride',          'poker',     'Three bets down. Take two back, or let them ride.', false, 1, 1, 'table',   103),
  ('mississippi_stud',   'Mississippi Stud',     'poker',     'No dealer hand: bet up to three times as the cards turn.', false, 1, 1, 'table', 104),
  ('four_card_poker',    'Four Card Poker',      'poker',     'Five cards to make your best four. The dealer gets six.', false, 1, 1, 'table', 105),
  ('teen_patti_live',    'Teen Patti Tables',    'poker',     'Three cards, played blind or seen, against other players.', true, 2, 6, 'poker', 135),
  ('slots_haunted',      'Haunted Manor',        'slots',     'October only. Ghosts turn symbols wild, and midnight spins climb to ×10.', false, 1, 1, 'slots', 59),
  ('horse_racing',       'Horse Racing',         'specialty', 'Six runners, one race for the whole room. Back a winner.', false, 1, 1, 'slots', 79),
  ('teen_patti',         'Teen Patti',           'poker',     'Three cards against the dealer, where a trail beats everything.', false, 1, 1, 'table', 106),
  ('sng_poker',          'Sit & Go Poker',       'poker',     'Knockout Hold''em tournaments. Last one standing wins.', false, 2, 6, 'poker', 58),
  ('slots_classic',      'Lucky Sevens',         'slots',     'Classic 3-reel fruit machine.',                   false, 1, 1, 'slots',     60),
  ('slots_paylines',     'Pharaoh''s Fortune',   'slots',     '5 reels, 20 paylines, wilds and free spins.',     false, 1, 1, 'slots',     61),
  ('slots_cascade',      'Gem Cascade',          'slots',     'Cluster pays with cascading wins.',               false, 1, 1, 'slots',     62),
  ('slots_ways',         'Wild Frontier',        'slots',     'Ways-to-win with expanding reels.',               false, 1, 1, 'slots',     63),
  ('slots_holdwin',      'Dragon Pearls',        'slots',     'Hold-and-win bonus rounds.',                      false, 1, 1, 'slots',     64),
  ('slots_progressive',  'Grand Jackpot',        'slots',     'One shared progressive jackpot for everyone.',    false, 1, 1, 'slots',     65),
  ('slot_showdown',      'Slot Showdown',        'slots',     'Everyone gets the same spins. The best score takes the pot.', false, 1, 1, 'slots', 66),
  ('video_poker_jacks',  'Jacks or Better',      'specialty', 'Video poker. Pair of jacks or better pays.',      false, 1, 1, 'slots',     70),
  ('video_poker_deuces', 'Deuces Wild',          'specialty', 'Video poker. Every 2 is wild.',                   false, 1, 1, 'slots',     71),
  ('video_poker_bonus',  'Bonus Poker',          'specialty', 'Video poker with extra for four of a kind.',      false, 1, 1, 'slots',     111),
  ('video_poker_double', 'Double Bonus Poker',   'specialty', 'Video poker. Four aces pays 160.',                false, 1, 1, 'slots',     112),
  ('video_poker_joker',  'Joker Poker',          'specialty', 'Video poker with a wild joker. Kings or better pays.', false, 1, 1, 'slots', 113),
  ('hi_lo',              'Hi-Lo',                'specialty', 'Higher or lower? Keep going, or collect.',        false, 1, 1, 'slots',     114),
  ('keno',               'Keno',                 'specialty', 'Pick up to 10 numbers and watch the draw.',       false, 1, 1, 'slots',     72),
  ('bingo',              'Bingo',                'specialty', '75-ball bingo with everyone in the room.',        false, 1, 1, 'slots',     73),
  ('power_draw',         'Power Draw',           'specialty', 'Pick five numbers and a power ball.',             false, 1, 1, 'slots',     74),
  ('scratch_cards',      'Scratch Cards',        'specialty', 'Three cards to scratch. Match three to win.',     false, 1, 1, 'slots',     75),
  ('crash',              'Crash',                'specialty', 'Ride the multiplier. Collect before it crashes.', false, 1, 1, 'slots',     76),
  ('plinko',             'Plinko',               'specialty', 'Drop the ball and see where it lands.',           false, 1, 1, 'slots',     77),
  ('mines',              'Mines',                'specialty', 'Uncover gems, dodge the mines, collect any time.', false, 1, 1, 'slots',    78)
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

-- Seasonal games: each is open for one month, and a different game takes its place the next.
update public.games set season = '2026-10' where key = 'slots_haunted';

-- Is this game open right now? (Always, unless it is a seasonal game outside its month.)
create or replace function private.game_in_season(p_game text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select g.season is null or g.season = to_char(now() at time zone 'utc', 'YYYY-MM')
                     from public.games g where g.key = p_game), false)
$$;

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
    -- Slots, video poker, keno and the instant games: per spin / per hand / per ticket.
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

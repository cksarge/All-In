-- =============================================================================
-- All In · 13_progression.sql
-- XP and levels, achievements, earned cosmetics, leaderboards, public profiles
-- and friends. Needs 01, 02, 03 and 05.
--
-- How it hooks in: every game already writes one game_history row and updates
-- player_game_stats for each finished round (private.record_round in 05).
-- Triggers on those two tables give XP, keep a few counters and check
-- achievements, so no game file had to change and any future game gets all of
-- this for free.
--
--   * XP per round = 2 + sqrt(chips wagered), half again for a win.
--     Level L starts at 100 * (L - 1)^2 XP, up to level 100.
--   * Chip rewards (200 x level for each new level, and a fixed amount per
--     achievement) are never paid automatically: the player collects them with
--     claim_rewards(). So a round's own chip maths is never disturbed.
--   * Cosmetics are earned, never sold: by reaching a level, or as an
--     achievement's prize. What a cosmetic looks like lives in the app; the
--     database only knows its key, kind and how it is unlocked.
--   * Friends are mutual: one player asks, the other accepts.
--
-- All In is a free game. No real money is ever used.
-- Safe to re-run: catalogue rows are upserted, player rows are never reset.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.player_progress (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  xp             bigint not null default 0 check (xp >= 0),
  level          integer not null default 1 check (level between 1 and 100),
  -- The highest level whose chip reward has been collected.
  claimed_level  integer not null default 1,
  -- Things counted as rounds finish, for achievements (see private.round_counters).
  counters       jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now()
);

create table if not exists public.cosmetics (
  key           text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  kind          text not null check (kind in ('avatar', 'frame', 'title', 'card_back', 'felt')),
  name          text not null,
  -- Unlocked on reaching this level. Null = only as an achievement's prize.
  unlock_level  integer check (unlock_level between 1 and 100),
  sort_order    integer not null default 100
);

-- Reputation cosmetics (22_reputation_chat.sql): owned only WHILE the player's reputation is at least this.
alter table public.cosmetics add column if not exists min_reputation integer check (min_reputation between 1 and 100);

create table if not exists public.achievements (
  key           text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name          text not null,
  description   text not null,
  category      text not null check (category in ('play', 'wins', 'games', 'feats', 'social')),
  -- Unlocked when private.player_metrics(user) ->> metric reaches goal.
  metric        text not null,
  goal          bigint not null check (goal > 0),
  reward_chips  bigint not null default 0 check (reward_chips >= 0),
  reward_xp     integer not null default 0 check (reward_xp >= 0),
  cosmetic_key  text references public.cosmetics (key) on delete set null,
  sort_order    integer not null default 100
);

create table if not exists public.player_achievements (
  user_id          uuid not null references auth.users (id) on delete cascade,
  achievement_key  text not null references public.achievements (key) on delete cascade,
  unlocked_at      timestamptz not null default now(),
  -- When its chip reward was collected (null = still waiting).
  claimed_at       timestamptz,
  primary key (user_id, achievement_key)
);

-- Cosmetics won as achievement prizes. Level cosmetics need no row: a player
-- owns every cosmetic whose unlock_level they have reached.
create table if not exists public.player_cosmetics (
  user_id       uuid not null references auth.users (id) on delete cascade,
  cosmetic_key  text not null references public.cosmetics (key) on delete cascade,
  unlocked_at   timestamptz not null default now(),
  primary key (user_id, cosmetic_key)
);

-- What a player has equipped.
create table if not exists public.player_loadouts (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  avatar      text not null default 'avatar_initial',
  frame       text not null default 'frame_none',
  title       text not null default 'title_newcomer',
  card_back   text not null default 'back_ruby',
  felt        text not null default 'felt_classic',
  updated_at  timestamptz not null default now()
);

-- One row per player per week (weeks start on Monday, UTC) for the weekly board.
create table if not exists public.weekly_stats (
  user_id     uuid not null references auth.users (id) on delete cascade,
  week_start  date not null,
  rounds      bigint not null default 0,
  wagered     bigint not null default 0,
  returned    bigint not null default 0,
  primary key (user_id, week_start)
);
create index if not exists weekly_stats_week_idx on public.weekly_stats (week_start, (returned - wagered) desc);

create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester     uuid not null references auth.users (id) on delete cascade,
  addressee     uuid not null references auth.users (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  constraint friendships_not_self check (requester <> addressee)
);
-- One friendship per pair, whoever asked.
create unique index if not exists friendships_pair_key
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee_idx on public.friendships (addressee, status);
create index if not exists friendships_requester_idx on public.friendships (requester, status);

create index if not exists player_progress_xp_idx on public.player_progress (xp desc);

-- The two rarest achievements hand over more than one cosmetic.
alter table public.achievements add column if not exists extra_cosmetics text[] not null default '{}';

-- Stage 8 added a 'tournaments' group of achievements.
alter table public.achievements drop constraint if exists achievements_category_check;
alter table public.achievements add constraint achievements_category_check
  check (category in ('play', 'wins', 'games', 'feats', 'tournaments', 'missions', 'social'));

-- -----------------------------------------------------------------------------
-- Catalogue: cosmetics
-- -----------------------------------------------------------------------------
insert into public.cosmetics (key, kind, name, unlock_level, sort_order) values
  ('avatar_initial',  'avatar', 'Your initial',   1,    10),
  ('avatar_top_hat',  'avatar', 'Top Hat',        2,    20),
  ('avatar_dice',     'avatar', 'Lucky Dice',     3,    30),
  ('avatar_clover',   'avatar', 'Four-Leaf',      4,    40),
  ('avatar_fox',      'avatar', 'Sly Fox',        6,    50),
  ('avatar_owl',      'avatar', 'Night Owl',      8,    60),
  ('avatar_star',     'avatar', 'Rising Star',    10,   70),
  ('avatar_crown',    'avatar', 'Champion',       15,   80),
  ('avatar_dragon',   'avatar', 'Dragon',         20,   90),
  ('avatar_rocket',   'avatar', 'Rocket',         null, 100),
  ('avatar_joker',    'avatar', 'Joker',          null, 110),
  ('avatar_fire',     'avatar', 'On Fire',        null, 120),
  ('avatar_diamond',  'avatar', 'Diamond',        null, 130),
  ('avatar_whale',    'avatar', 'The Whale',      null, 140),
  ('avatar_medal',    'avatar', 'Gold Medal',     null, 150),
  ('avatar_clipboard', 'avatar', 'To-Do List',    null, 160),
  ('avatar_swords',   'avatar', 'Crossed Swords', null, 170),
  ('avatar_jester',   'avatar', 'The Jester',     null, 175),
  ('avatar_crystal_ball', 'avatar', 'Crystal Ball', null, 177),
  ('avatar_bicycle',  'avatar', 'The Bicycle',    null, 178),
  ('avatar_infinity', 'avatar', 'Infinity',       null, 999),

  ('frame_none',      'frame',  'No frame',       1,    10),
  ('frame_felt',      'frame',  'Felt Green',     3,    20),
  ('frame_ruby',      'frame',  'Ruby',           5,    30),
  ('frame_sapphire',  'frame',  'Sapphire',       8,    40),
  ('frame_gold',      'frame',  'Gold',           12,   50),
  ('frame_royal',     'frame',  'Royal Purple',   18,   60),
  ('frame_diamond',   'frame',  'Diamond',        30,   70),
  ('frame_jackpot',   'frame',  'Jackpot',        null, 80),
  ('frame_laurel',    'frame',  'Laurel Wreath',  null, 90),
  ('frame_clockwork', 'frame',  'Clockwork',      null, 95),
  ('frame_spotlight', 'frame',  'Spotlight',      null, 97),
  ('frame_grandmaster', 'frame', 'Grandmaster''s Halo', null, 998),
  ('frame_completionist', 'frame', 'Black Diamond', null, 999),

  ('title_newcomer',     'title', 'Newcomer',       1,    10),
  ('title_sharp',        'title', 'Sharp',          10,   20),
  ('title_professional', 'title', 'Professional',   25,   30),
  ('title_legend',       'title', 'Legend',         50,   40),
  ('title_regular',      'title', 'Regular',        null, 50),
  ('title_explorer',     'title', 'Explorer',       null, 60),
  ('title_card_shark',   'title', 'Card Shark',     null, 70),
  ('title_reel_deal',    'title', 'Reel Deal',      null, 80),
  ('title_lucky',        'title', 'Lucky',          null, 90),
  ('title_high_roller',  'title', 'High Roller',    null, 100),
  ('title_millionaire',  'title', 'Millionaire',    null, 110),
  ('title_veteran',      'title', 'Veteran',        null, 120),
  ('title_socialite',    'title', 'Socialite',      null, 130),
  ('title_contender',    'title', 'Contender',      null, 140),
  ('title_taskmaster',   'title', 'Taskmaster',     null, 160),
  ('title_founder',      'title', 'Founder',        null, 165),
  ('title_trail_blazer', 'title', 'Trail Blazer',   null, 168),
  ('title_trickster',    'title', 'Trickster',      null, 169),
  ('title_number_one',   'title', 'Number One',     null, 171),
  ('title_jockey',       'title', 'Jockey',         null, 172),
  ('title_blind_faith',  'title', 'Blind Faith',    null, 173),
  ('avatar_horse',       'avatar', 'Racehorse',     null, 174),
  ('back_teen_patti',    'card_back', 'Marigold',   null, 175),
  ('frame_trail',        'frame', 'Trail',          null, 176),
  ('title_well_mannered', 'title', 'Well-Mannered', null, 180),
  ('frame_good_standing', 'frame', 'Good Standing', null, 181),
  ('title_pillar',       'title', 'Pillar of the Lounge', null, 182),
  ('avatar_dove',        'avatar', 'Dove',          null, 183),
  ('frame_exemplary',    'frame', 'Exemplary',      null, 184),
  ('title_host',         'title', 'The Host',       null, 185),
  ('title_club_champion', 'title', 'Club Champion', null, 186),
  ('title_grandmaster',  'title', 'Grandmaster',    null, 998),
  ('title_completionist', 'title', 'Completionist', null, 999),
  ('title_field_marshal', 'title', 'Field Marshal', null, 167),
  ('title_season_veteran', 'title', 'Season Veteran', null, 170),
  ('title_tournament_champion', 'title', 'Tournament Champion', null, 150),

  ('back_ruby',       'card_back', 'Ruby Lattice',   1,  10),
  ('back_sapphire',   'card_back', 'Sapphire',       4,  20),
  ('back_emerald',    'card_back', 'Emerald',        7,  30),
  ('back_onyx',       'card_back', 'Onyx and Gold',  12, 40),
  ('back_royal',      'card_back', 'Royal Purple',   20, 50),
  ('back_diamond',    'card_back', 'Diamond',        35, 60),
  ('back_tournament', 'card_back', 'Tournament Gold', null, 70),
  ('back_planner',    'card_back', 'Day Planner',   null, 75),
  ('back_aces',       'card_back', 'Four Aces',     null, 78),
  ('back_four_suits', 'card_back', 'Four Suits',    null, 79),

  ('felt_classic',    'felt', 'Classic Green',  1,  10),
  ('felt_midnight',   'felt', 'Midnight Blue',  6,  20),
  ('felt_burgundy',   'felt', 'Burgundy',       9,  30),
  ('felt_charcoal',   'felt', 'Charcoal',       14, 40),
  ('felt_royal',      'felt', 'Royal Purple',   22, 50),
  ('felt_final_table', 'felt', 'Final Table',   null, 60),
  ('felt_trophy_room', 'felt', 'Trophy Room',   null, 65)
on conflict (key) do update set
  kind = excluded.kind, name = excluded.name, unlock_level = excluded.unlock_level, sort_order = excluded.sort_order;

-- Held only while the reputation lasts: 75 for the first three, 100 for the others.
update public.cosmetics set min_reputation = 75 where key in ('title_well_mannered', 'frame_good_standing');
update public.cosmetics set min_reputation = 100 where key in ('title_pillar', 'avatar_dove', 'frame_exemplary');


-- -----------------------------------------------------------------------------
-- Catalogue: achievements
-- -----------------------------------------------------------------------------
insert into public.achievements (key, name, description, category, metric, goal, reward_chips, reward_xp, cosmetic_key, sort_order) values
  ('first_round',     'First Chip',        'Finish your first round of any game.',               'play',  'rounds',           1,       250,   25,   null,                 10),
  ('rounds_100',      'Regular',           'Finish 100 rounds.',                                 'play',  'rounds',           100,     1000,  100,  'title_regular',      20),
  ('rounds_1000',     'Seasoned',          'Finish 1,000 rounds.',                               'play',  'rounds',           1000,    5000,  400,  null,                 30),
  ('rounds_10000',    'Veteran',           'Finish 10,000 rounds.',                              'play',  'rounds',           10000,   25000, 1500, 'title_veteran',      40),
  ('level_5',         'Getting Started',   'Reach level 5.',                                     'play',  'level',            5,       1000,  0,    null,                 50),
  ('level_10',        'Double Digits',     'Reach level 10.',                                    'play',  'level',            10,      2500,  0,    null,                 60),
  ('level_25',        'Quarter Century',   'Reach level 25.',                                    'play',  'level',            25,      10000, 0,    null,                 70),
  ('level_50',        'Halfway to Legend', 'Reach level 50.',                                    'play',  'level',            50,      50000, 0,    null,                 80),
  ('level_100',       'Grandmaster',       'Reach level 100, the highest there is.',             'play',  'level',            100,     250000, 0,   'title_grandmaster',  85),
  ('daily_7',         'Seven Days',        'Collect the daily bonus seven days in a row.',       'play',  'daily_streak',     7,       2500,  200,  null,                 90),

  ('win_1k',          'Nice Hit',          'Win 1,000 chips or more in a single round.',         'wins',  'biggest_win',      1000,    500,   50,   null,                 110),
  ('win_10k',         'Big Winner',        'Win 10,000 chips or more in a single round.',        'wins',  'biggest_win',      10000,   2500,  200,  null,                 120),
  ('win_100k',        'High Roller',       'Win 100,000 chips or more in a single round.',       'wins',  'biggest_win',      100000,  10000, 600,  'title_high_roller',  130),
  ('win_1m',          'The Whale',         'Win 1,000,000 chips or more in a single round.',     'wins',  'biggest_win',      1000000, 50000, 2000, 'avatar_whale',       140),
  ('multiple_10',     'Tenfold',           'Win 10 times your bet in one round.',                'wins',  'max_multiple',     10,      500,   50,   null,                 150),
  ('multiple_100',    'Hundredfold',       'Win 100 times your bet in one round.',               'wins',  'max_multiple',     100,     5000,  300,  'title_lucky',        160),
  ('multiple_1000',   'Thousandfold',      'Win 1,000 times your bet in one round.',             'wins',  'max_multiple',     1000,    25000, 1000, null,                 170),
  ('streak_5',        'On a Roll',         'Win 5 rounds in a row.',                             'wins',  'best_streak',      5,       1000,  100,  null,                 180),
  ('streak_10',       'Unstoppable',       'Win 10 rounds in a row.',                            'wins',  'best_streak',      10,      5000,  400,  'avatar_fire',        190),
  ('bank_25k',        'Comfortable',       'Hold 25,000 chips at once.',                         'wins',  'peak_balance',     25000,   1000,  100,  null,                 200),
  ('bank_100k',       'Six Figures',       'Hold 100,000 chips at once.',                        'wins',  'peak_balance',     100000,  5000,  300,  null,                 210),
  ('bank_1m',         'Millionaire',       'Hold 1,000,000 chips at once.',                      'wins',  'peak_balance',     1000000, 25000, 1000, 'title_millionaire',  220),

  ('games_5',         'Explorer',          'Play 5 different games.',                            'games', 'games',            5,       1000,  100,  'title_explorer',     310),
  ('games_15',        'Well Travelled',    'Play 15 different games.',                           'games', 'games',            15,      5000,  400,  null,                 320),
  ('games_all',       'Seen It All',       'Play every game in the lounge.',                     'games', 'games_left',       1,       25000, 1500, 'avatar_diamond',     330),
  ('table_250',       'Table Regular',     'Finish 250 rounds of table games.',                  'games', 'rounds_table',     250,     2500,  200,  null,                 340),
  ('poker_100',       'Card Shark',        'Finish 100 hands of poker.',                         'games', 'rounds_poker',     100,     2500,  200,  'title_card_shark',   350),
  ('slots_500',       'Reel Deal',         'Spin the slots 500 times.',                          'games', 'rounds_slots',     500,     2500,  200,  'title_reel_deal',    360),
  ('specialty_250',   'Specialist',        'Finish 250 rounds of specialty games.',              'games', 'rounds_specialty', 250,     2500,  200,  null,                 370),

  ('jackpot',         'Jackpot!',          'Win the Grand Jackpot.',                             'feats', 'jackpots',         1,       0,     2000, 'frame_jackpot',      410),
  ('royal_flush',     'Royal Flush',       'Make a royal flush at video poker.',                 'feats', 'royals',           1,       5000,  500,  'avatar_joker',       420),
  ('straight_flush',  'Straight Flush',    'Make a straight flush against the dealer.',          'feats', 'straight_flushes', 1,       2500,  250,  null,                 430),
  ('slot_features',   'Feature Hunter',    'Trigger 25 slot features (free spins or hold and win).', 'feats', 'slot_features', 25,     2500,  250,  null,                 440),
  ('crash_10x',       'To the Moon',       'Collect at 10x or higher in Crash.',                 'feats', 'crash_10x',        1,       2500,  250,  'avatar_rocket',      450),
  ('mines_cleared',   'Bomb Squad',        'Find every gem in a game of Mines.',                 'feats', 'mines_cleared',    1,       2500,  250,  null,                 460),
  ('bingo_fast',      'Quick Line',        'Complete a bingo line within 20 calls.',             'feats', 'bingo_fast',       1,       2500,  250,  null,                 470),
  ('keno_perfect',    'Perfect Card',      'Hit every number on a keno card of 5 or more.',      'feats', 'keno_perfect',     1,       5000,  500,  null,                 480),

  ('tourney_first',   'Contender',         'Enter your first tournament.',                       'tournaments', 'tourney_played', 1,   500,   50,   'title_contender',    610),
  ('tourney_10',      'Regular Contender', 'Enter 10 tournaments.',                              'tournaments', 'tourney_played', 10,  2500,  250,  null,                 620),
  ('tourney_50',      'Circuit Grinder',   'Enter 50 tournaments.',                              'tournaments', 'tourney_played', 50,  10000, 800,  'felt_final_table',   630),
  ('tourney_win',     'Champion',          'Win a tournament against at least one other player.', 'tournaments', 'tourney_wins',  1,   2500,  300,  'title_tournament_champion', 640),
  ('tourney_win_10',  'Dynasty',           'Win 10 tournaments.',                                'tournaments', 'tourney_wins',   10,  25000, 1500, 'frame_laurel',       650),
  ('sng_win',         'Last One Standing', 'Win a Sit & Go poker tournament.',                   'tournaments', 'sng_wins',       1,   2500,  300,  'avatar_medal',       660),
  ('showdown_win',    'Showstopper',       'Win a Slot Showdown.',                               'tournaments', 'showdown_wins',  1,   2500,  300,  'back_tournament',    670),
  ('freeroll_podium', 'Free Lunch',        'Finish in the top three of a Daily Freeroll with four or more players.', 'tournaments', 'freeroll_podiums', 1, 1000, 150, null, 680),

  ('mission_first',   'On a Mission',      'Finish your first mission.',                  'missions', 'missions_done', 1,   250,   50,   null,                700),
  ('mission_25',      'Busy Bee',          'Finish 25 missions.',                         'missions', 'missions_done', 25,  2500,  300,  'avatar_clipboard',  710),
  ('mission_100',     'Taskmaster',        'Finish 100 missions.',                        'missions', 'missions_done', 100, 10000, 1000, 'title_taskmaster',  720),
  ('daily_sweep',     'Clean Sweep',       'Finish all three daily missions in one day.', 'missions', 'daily_sweeps',  1,   500,   100,  null,                730),
  ('daily_sweep_20',  'Creature of Habit', 'Finish all three daily missions on 20 days.', 'missions', 'daily_sweeps',  20,  10000, 1000, 'frame_clockwork',   740),
  ('weekly_10',       'Weekly Regular',    'Finish 10 weekly missions.',                  'missions', 'weeklies_done', 10,  5000,  500,  'back_planner',      750),
  ('season_tier_5',   'Season Ticket',     'Collect five season rewards.',                'missions', 'season_tiers',  5,   1000,  200,  null,                760),
  ('season_done',     'Season Finale',     'Reach the end of a season track.',            'missions', 'seasons_done',  1,   5000,  1000, 'title_season_veteran', 770),
  ('invite_first',    'Good Host',         'Invite a friend to your table.',              'social',   'invites_sent',  1,   250,   50,   null,                805),

  ('joker_wild',      'Joker''s Wild',     'Make a royal flush or five of a kind in Joker Poker.',  'feats', 'joker_big',  1, 5000, 500, 'avatar_jester',      581),
  ('four_aces',       'Four Bullets',      'Hit four aces in Bonus or Double Bonus Poker.',         'feats', 'four_aces',  1, 2500, 300, 'back_aces',          582),
  ('trail_blazer',    'Trail Blazer',      'Be dealt a trail (three of a kind) in Teen Patti.',     'feats', 'trails',     1, 2500, 300, 'title_trail_blazer', 583),
  ('full_ride',       'Let It All Ride',   'Win at Let It Ride with all three bets still down.',    'feats', 'full_rides', 1, 1000, 150, null,                 584),
  ('five_card_trick', 'Trickster',         'Make a five-card trick in Pontoon.',                    'feats', 'five_card_tricks', 1, 1000, 150, 'title_trickster',     585),
  ('spanish_bonus',   'Spanish Gold',      'Win a bonus 21 in Spanish 21.',                         'feats', 'spanish_bonuses',  1, 1000, 150, null,                  586),
  ('hilo_run',        'Fortune Teller',    'Collect at Hi-Lo after five right guesses in a row.',   'feats', 'hilo_runs',        1, 2500, 300, 'avatar_crystal_ball', 587),
  ('top_dog',         'Top Dog',           'Hit three of a kind at Red Dog.',                       'feats', 'red_dog_triples',  1, 2500, 300, null,                  588),
  ('razz_wheel',      'The Bicycle',       'Win a Razz pot with 5-4-3-2-A.',                        'feats', 'razz_wheels', 1, 2500, 300, 'avatar_bicycle',      589),
  ('number_one',      'Number One',        'Win a 2-7 Triple Draw pot with 7-5-4-3-2.',             'feats', 'number_ones', 1, 5000, 500, 'title_number_one',    5891),
  ('badugi_made',     'Badugi!',           'Win a Badugi pot with a four-card badugi.',             'feats', 'badugis',     1, 1000, 150, 'back_four_suits',     5892),
  ('host_first',      'Master of Ceremonies', 'Host a private tournament that gets played.',       'tournaments', 'tournaments_hosted', 1, 1000, 150, 'title_host',          5901),
  ('club_event_win',  'Club Champion',     'Win a club event with three or more players.', 'tournaments', 'club_event_wins',    1, 2500, 300, 'title_club_champion', 5902),
  ('rep_75',          'In Good Standing',  'Reach a reputation of 75.',                             'social', 'reputation_best', 75,  2500,  300,  null,            5899),
  ('rep_100',         'Model Citizen',     'Reach a reputation of 100, the highest there is.',      'social', 'reputation_best', 100, 10000, 1000, null,            5900),
  ('race_winner',     'First Past the Post', 'Back the winner of a horse race.',                    'feats', 'race_winners',   1,  500,  75,  null,                  5893),
  ('race_regular',    'Stable Regular',    'Back 25 winners at the races.',                         'feats', 'race_winners',   25, 5000, 500, 'title_jockey',        5894),
  ('race_longshot',   'Long Shot',         'Back a winner that pays 10 times your bet or more.',    'feats', 'race_longshots', 1,  2500, 300, 'avatar_horse',        5895),
  ('tpt_blind',       'Blind Faith',       'Win a pot at a Teen Patti table without looking at your cards.', 'feats', 'tpt_blind_wins', 1, 1000, 150, 'title_blind_faith', 5896),
  ('tpt_regular',     'Patti Party',       'Win 25 pots at Teen Patti tables.',                     'feats', 'tpt_wins',       25, 5000, 500, 'back_teen_patti',     5897),
  ('tpt_trail',       'Three of a Kind',   'Win a showdown at a Teen Patti table with a trail.',    'feats', 'tpt_trails',     1,  5000, 500, 'frame_trail',         5898),
  ('completionist',   'Completionist',     'Unlock every other achievement.',                       'feats', 'all_achievements', 1, 500000, 0, 'title_completionist', 9999),
  ('headliner',       'Headliner',         'Land a win big enough for the lounge''s big-win ticker.', 'feats', 'big_wins', 1, 2500, 300, 'frame_spotlight', 590),
  ('nemesis',         'Nemesis',           'Beat the same player 10 times at poker.',     'feats',    'h2h_best',      10,  2500,  300,  'avatar_swords',     595),
  ('club_member',     'Clubbable',         'Join or start a club.',                       'social',   'clubs_joined',  1,   500,   100,  null,                806),
  ('club_founder',    'Founder',           'Start a club of your own.',                   'social',   'clubs_founded', 1,   1000,  200,  'title_founder',     807),

  ('mtt_win',         'Field Marshal',     'Win a multi-table tournament.',               'tournaments', 'mtt_wins',   1,   5000,  500,  'title_field_marshal', 690),
  ('trophies_10',     'Trophy Cabinet',    'Collect 10 tournament trophies.',             'tournaments', 'trophies',   10,  5000,  500,  'felt_trophy_room',  695),
  ('show_off',        'Show-off',          'Show your cards when you didn''t have to.',   'feats',       'cards_shown', 1,  250,   50,   null,                597),

  ('friend_1',        'Friendly',          'Make a friend.',                                     'social', 'friends',         1,       500,   50,   null,                 510),
  ('friend_5',        'Popular',           'Have 5 friends.',                                    'social', 'friends',         5,       2500,  200,  'title_socialite',    520)
on conflict (key) do update set
  name = excluded.name, description = excluded.description, category = excluded.category, metric = excluded.metric,
  goal = excluded.goal, reward_chips = excluded.reward_chips, reward_xp = excluded.reward_xp,
  cosmetic_key = excluded.cosmetic_key, sort_order = excluded.sort_order;

-- The extra prizes of the two rarest achievements (a frame with the title; an avatar and a frame with the title).
update public.achievements set extra_cosmetics = array['frame_grandmaster'] where key = 'level_100';
update public.achievements set extra_cosmetics = array['avatar_infinity', 'frame_completionist'] where key = 'completionist';


-- -----------------------------------------------------------------------------
-- Levels and XP
-- -----------------------------------------------------------------------------
create or replace function private.level_for_xp(p_xp bigint)
returns integer language sql immutable set search_path = '' as $$
  select least(100, floor(sqrt(greatest(p_xp, 0) / 100.0))::integer + 1)
$$;

-- XP needed to reach a level (level 1 = 0).
create or replace function private.xp_for_level(p_level integer)
returns bigint language sql immutable set search_path = '' as $$
  select 100::bigint * (p_level - 1) * (p_level - 1)
$$;

-- Plinko is the exception: a press drops up to ten balls, each its own round at about a 99% return,
-- which made XP almost free. A ball earns a quarter of the square root of its bet and no flat 2
-- (so a 10-chip ball earns nothing). The Plinko page says so.
drop function if exists private.round_xp(bigint, bigint);
create or replace function private.round_xp(p_wagered bigint, p_returned bigint, p_game text default null)
returns integer language sql immutable set search_path = '' as $$
  select floor(case when p_game = 'plinko'
                    then sqrt(least(greatest(p_wagered, 0), 1000000)::numeric) / 4
                    else 2 + floor(sqrt(least(greatest(p_wagered, 0), 1000000)::numeric)) end
               * case when p_returned > p_wagered then 1.5 else 1 end)::integer
$$;

-- Chips for reaching a level.
create or replace function private.level_reward(p_level integer)
returns bigint language sql immutable set search_path = '' as $$
  select 200::bigint * p_level
$$;

-- Makes sure a player has their progress and loadout rows.
create or replace function private.ensure_progress(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.player_progress (user_id) values (p_user) on conflict do nothing;
  insert into public.player_loadouts (user_id) values (p_user) on conflict do nothing;
$$;

-- Counters after one more round. They only ever feed achievements.
create or replace function private.round_counters(c jsonb, r public.game_history)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  s jsonb := r.summary;
  v_streak integer := coalesce((c ->> 'streak')::integer, 0);
  v_made text := s ->> 'made';
  v_bump text[] := '{}';
  k text;
begin
  -- Wins in a row (a push neither adds to the run nor ends it).
  if r.outcome = 'win' then
    v_streak := v_streak + 1;
  elsif r.outcome = 'loss' then
    v_streak := 0;
  end if;
  c := c || jsonb_build_object(
    'streak', v_streak,
    'best_streak', greatest(coalesce((c ->> 'best_streak')::integer, 0), v_streak),
    'max_multiple', greatest(coalesce((c ->> 'max_multiple')::bigint, 0),
                             case when r.wagered > 0 then r.returned / r.wagered else 0 end));

  if s ->> 'feature' = 'jackpot' then v_bump := array_append(v_bump, 'jackpots'); end if;
  if s ->> 'feature' in ('free', 'hold') then v_bump := array_append(v_bump, 'slot_features'); end if;
  if r.game_key like 'video\_poker\_%' and v_made in ('royal_flush', 'natural_royal') then v_bump := array_append(v_bump, 'royals'); end if;
  if r.game_key in ('three_card_poker', 'ultimate_holdem') and v_made in ('straight_flush', 'royal_flush') then
    v_bump := array_append(v_bump, 'straight_flushes');
  end if;
  if r.game_key = 'mines' and s ->> 'outcome' = 'cleared' then v_bump := array_append(v_bump, 'mines_cleared'); end if;
  if r.game_key = 'crash' and (s ->> 'collected_at')::numeric >= 10 then v_bump := array_append(v_bump, 'crash_10x'); end if;
  if r.game_key = 'bingo' and (s ->> 'line_at')::integer <= 20 then v_bump := array_append(v_bump, 'bingo_fast'); end if;
  if r.game_key = 'keno' and (s ->> 'picks')::integer >= 5 and s ->> 'hits' = s ->> 'picks' then v_bump := array_append(v_bump, 'keno_perfect'); end if;
  -- Stage 10 games.
  if r.game_key = 'video_poker_joker' and s ->> 'made' in ('natural_royal', 'wild_royal', 'five_kind') then v_bump := array_append(v_bump, 'joker_big'); end if;
  if r.game_key in ('video_poker_bonus', 'video_poker_double') and s ->> 'made' = 'four_aces' then v_bump := array_append(v_bump, 'four_aces'); end if;
  if r.game_key = 'teen_patti' and s ->> 'made' = 'trail' then v_bump := array_append(v_bump, 'trails'); end if;
  if r.game_key = 'let_it_ride' and s ->> 'outcome' = 'win' and (s #>> '{bets,bet}')::bigint = 3 * (s ->> 'main')::bigint then v_bump := array_append(v_bump, 'full_rides'); end if;
  if r.game_key = 'pontoon' and (s ->> 'five_card')::boolean then v_bump := array_append(v_bump, 'five_card_tricks'); end if;
  if r.game_key = 'spanish_21' and (s ->> 'bonus')::boolean then v_bump := array_append(v_bump, 'spanish_bonuses'); end if;
  if r.game_key = 'hi_lo' and s ->> 'outcome' = 'collect' and (s ->> 'steps')::integer >= 5 then v_bump := array_append(v_bump, 'hilo_runs'); end if;
  if r.game_key = 'red_dog' and s ->> 'outcome' = 'triple' then v_bump := array_append(v_bump, 'red_dog_triples'); end if;
  if r.returned > r.wagered and r.game_key = 'poker_razz' and s ->> 'hand' = '5-4-3-2-A low' then v_bump := array_append(v_bump, 'razz_wheels'); end if;
  if r.returned > r.wagered and r.game_key = 'poker_27' and s ->> 'hand' = '7-5-4-3-2 low' then v_bump := array_append(v_bump, 'number_ones'); end if;
  if r.returned > r.wagered and r.game_key = 'poker_badugi' and s ->> 'hand' like 'Badugi,%' then v_bump := array_append(v_bump, 'badugis'); end if;
  if r.game_key = 'horse_racing' and (s ->> 'picked_winner')::boolean then
    v_bump := array_append(v_bump, 'race_winners');
    if (s ->> 'win_units')::integer >= 1000 then v_bump := array_append(v_bump, 'race_longshots'); end if;
  end if;
  if r.game_key = 'teen_patti_live' and r.returned > r.wagered then
    v_bump := array_append(v_bump, 'tpt_wins');
    if (s ->> 'blind')::boolean then v_bump := array_append(v_bump, 'tpt_blind_wins'); end if;
    if (s ->> 'showdown')::boolean and s ->> 'made' = 'trail' then v_bump := array_append(v_bump, 'tpt_trails'); end if;
  end if;
  -- Tournaments (14_tournaments.sql) record one round per player when they end.
  if r.game_key in ('sng_poker', 'slot_showdown') then
    v_bump := array_append(v_bump, 'tourney_played');
    -- A private tournament or club event (24_events.sql) is played among friends, so winning one
    -- is not a tournament win: it has its own counter.
    if (s ->> 'private')::boolean then
      if (s ->> 'club')::boolean and (s ->> 'place')::integer = 1 and (s ->> 'players')::integer >= 3 then
        v_bump := array_append(v_bump, 'club_event_wins');
      end if;
    elsif (s ->> 'place')::integer = 1 and (s ->> 'players')::integer >= 2 then
      v_bump := array_append(v_bump, 'tourney_wins');
      if s ->> 'kind' = 'sng' then v_bump := array_append(v_bump, 'sng_wins'); end if;
      if s ->> 'kind' = 'mtt' then v_bump := array_append(v_bump, 'mtt_wins'); end if;
      if s ->> 'kind' = 'showdown' then v_bump := array_append(v_bump, 'showdown_wins'); end if;
    end if;
    if s ->> 'kind' = 'freeroll' and (s ->> 'place')::integer <= 3 and (s ->> 'players')::integer >= 4 then
      v_bump := array_append(v_bump, 'freeroll_podiums');
    end if;
  end if;

  foreach k in array v_bump loop
    c := c || jsonb_build_object(k, coalesce((c ->> k)::integer, 0) + 1);
  end loop;
  return c;
end $$;

-- Every number an achievement can be measured against.
create or replace function private.player_metrics(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.counters, '{}'::jsonb) || jsonb_build_object(
    'level', coalesce(p.level, 1),
    'rounds', coalesce(s.rounds, 0),
    'games', coalesce(s.games, 0),
    -- 1 once every released game has been played (so the goal doesn't change as games are added)
    -- (Seasonal games come and go, so they are not part of it.)
    'games_left', case when coalesce(s.games, 0) >= (select count(*) from public.games where released and season is null) then 1 else 0 end,
    'biggest_win', coalesce(s.biggest_win, 0),
    'rounds_table', coalesce(s.rounds_table, 0),
    'rounds_poker', coalesce(s.rounds_poker, 0),
    'rounds_slots', coalesce(s.rounds_slots, 0),
    'rounds_specialty', coalesce(s.rounds_specialty, 0),
    'peak_balance', coalesce(w.peak_balance, 0),
    'daily_streak', coalesce(w.daily_streak, 0),
    'friends', (select count(*) from public.friendships f
                 where f.status = 'accepted' and p_user in (f.requester, f.addressee)),
    -- 1 once every other achievement is unlocked (so the goal doesn't change as achievements are added)
    'all_achievements', case when (select count(*) from public.player_achievements pa where pa.user_id = p_user and pa.achievement_key <> 'completionist')
                                  >= (select count(*) from public.achievements a where a.key <> 'completionist') then 1 else 0 end)
    from (select p_user as id) u
    left join public.player_progress p on p.user_id = u.id
    left join public.wallets w on w.user_id = u.id
    left join lateral (
      select sum(st.rounds_played) as rounds,
             count(*) filter (where st.rounds_played > 0 and g.season is null) as games,
             max(st.biggest_win) as biggest_win,
             sum(st.rounds_played) filter (where g.category = 'table') as rounds_table,
             sum(st.rounds_played) filter (where g.category = 'poker') as rounds_poker,
             sum(st.rounds_played) filter (where g.category = 'slots') as rounds_slots,
             sum(st.rounds_played) filter (where g.category = 'specialty') as rounds_specialty
        from public.player_game_stats st join public.games g on g.key = st.game_key
       where st.user_id = u.id) s on true
$$;

-- Adds XP and moves the level to match.
create or replace function private.add_xp(p_user uuid, p_xp bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.player_progress
     set xp = xp + greatest(p_xp, 0),
         level = private.level_for_xp(xp + greatest(p_xp, 0)),
         updated_at = now()
   where user_id = p_user;
$$;

-- Unlocks every achievement whose goal has been reached. An achievement's XP can
-- lift the level, which can unlock another, so it looks again until nothing changes.
create or replace function private.check_achievements(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  m jsonb;
  a public.achievements;
  v_new integer := 0;
  v_pass integer;
begin
  for i in 1..4 loop
    m := private.player_metrics(p_user);
    v_pass := 0;
    for a in
      select x.* from public.achievements x
       where coalesce((m ->> x.metric)::numeric, 0) >= x.goal
         and not exists (select 1 from public.player_achievements pa where pa.user_id = p_user and pa.achievement_key = x.key)
       order by x.sort_order
    loop
      insert into public.player_achievements (user_id, achievement_key, claimed_at)
      values (p_user, a.key, case when a.reward_chips = 0 then now() end)
      on conflict do nothing;
      if a.cosmetic_key is not null then
        insert into public.player_cosmetics (user_id, cosmetic_key) values (p_user, a.cosmetic_key) on conflict do nothing;
      end if;
      insert into public.player_cosmetics (user_id, cosmetic_key)
      select p_user, x from unnest(a.extra_cosmetics) x where exists (select 1 from public.cosmetics c where c.key = x)
      on conflict do nothing;
      if a.reward_xp > 0 then
        perform private.add_xp(p_user, a.reward_xp);
      end if;
      v_pass := v_pass + 1;
    end loop;
    v_new := v_new + v_pass;
    exit when v_pass = 0;
  end loop;
  return v_new;
end $$;

-- After every finished round of every game.
create or replace function private.on_round_recorded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_progress(new.user_id);
  update public.player_progress
     set counters = private.round_counters(counters, new)
   where user_id = new.user_id;
  perform private.add_xp(new.user_id, private.round_xp(new.wagered, new.returned, new.game_key));

  insert into public.weekly_stats as w (user_id, week_start, rounds, wagered, returned)
  values (new.user_id, date_trunc('week', now() at time zone 'utc')::date, 1, new.wagered, new.returned)
  on conflict (user_id, week_start) do update set
    rounds = w.rounds + 1, wagered = w.wagered + excluded.wagered, returned = w.returned + excluded.returned;

  return new;
end $$;

drop trigger if exists game_history_progress on public.game_history;
create trigger game_history_progress
  after insert on public.game_history
  for each row execute function private.on_round_recorded();

-- record_round writes the history row first and the per-game stats second, and
-- achievements read those stats, so they are checked once the stats are in.
create or replace function private.on_stats_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_achievements(new.user_id);
  return new;
end $$;

drop trigger if exists player_game_stats_achievements on public.player_game_stats;
create trigger player_game_stats_achievements
  after insert or update on public.player_game_stats
  for each row execute function private.on_stats_updated();

-- Players who signed up before this file was run.
insert into public.player_progress (user_id) select id from auth.users on conflict do nothing;
insert into public.player_loadouts (user_id) select id from auth.users on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Cosmetics
-- -----------------------------------------------------------------------------
-- Reputation lives in 22_reputation_chat.sql, which replaces these two with the real thing.
-- Until that file has run, everyone is at the starting 50 and nobody is muted.
do $$
begin
  if to_regclass('public.player_reputation') is null then
    create or replace function private.reputation_of(p_user uuid) returns integer
      language sql stable security definer set search_path = '' as 'select 50';
    create or replace function private.quick_muted(p_user uuid) returns boolean
      language sql stable security definer set search_path = '' as 'select false';
  end if;
end $$;

create or replace function private.owns_cosmetic(p_user uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cosmetics c
     where c.key = p_key
       and (c.unlock_level <= (select coalesce(max(level), 1) from public.player_progress where user_id = p_user)
            or exists (select 1 from public.player_cosmetics pc where pc.user_id = p_user and pc.cosmetic_key = c.key)
            or private.reputation_of(p_user) >= c.min_reputation))
$$;

create or replace function private.loadout_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('avatar', l.avatar, 'frame', l.frame, 'title', l.title, 'card_back', l.card_back, 'felt', l.felt)
       from public.player_loadouts l where l.user_id = p_user),
    jsonb_build_object('avatar', 'avatar_initial', 'frame', 'frame_none', 'title', 'title_newcomer',
                       'card_back', 'back_ruby', 'felt', 'felt_classic'))
$$;

-- A player as other players see them in lists.
create or replace function private.player_card(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', pr.id, 'username', pr.username,
    'level', coalesce((select level from public.player_progress where user_id = pr.id), 1),
    'loadout', private.loadout_json(pr.id))
    from public.profiles pr where pr.id = p_user
$$;

create or replace function public.equip_cosmetic(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  c public.cosmetics;
begin
  select * into c from public.cosmetics where key = p_key;
  if not found then
    raise exception 'unknown_cosmetic';
  end if;
  perform private.ensure_progress(v_uid);
  if not private.owns_cosmetic(v_uid, p_key) then
    raise exception 'cosmetic_locked';
  end if;
  execute format('update public.player_loadouts set %I = $1, updated_at = now() where user_id = $2',
                 case c.kind when 'avatar' then 'avatar' when 'frame' then 'frame' when 'title' then 'title'
                             when 'card_back' then 'card_back' else 'felt' end)
    using p_key, v_uid;
  return private.loadout_json(v_uid);
end $$;

-- Loadouts for a handful of players (the avatars around a table).
create or replace function public.loadouts_for(p_users uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null then '{}'::jsonb else coalesce(
    (select jsonb_object_agg(u::text, private.loadout_json(u) || jsonb_build_object(
               'level', coalesce((select level from public.player_progress where user_id = u), 1),
               -- Quick chat is switched off for this player: other browsers drop what they send.
               'quick_muted', private.quick_muted(u)))
       from (select distinct x as u from unnest(p_users[1:40]) x) s), '{}'::jsonb) end
$$;

-- -----------------------------------------------------------------------------
-- Your own progress, and collecting rewards
-- -----------------------------------------------------------------------------
create or replace function public.my_progress()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  p public.player_progress;
begin
  perform private.ensure_progress(v_uid);
  -- Catches achievements that don't come from finishing a round (daily streak, friends, chips held).
  perform private.check_achievements(v_uid);
  select * into p from public.player_progress where user_id = v_uid;
  return jsonb_build_object(
    'xp', p.xp, 'level', p.level,
    'level_xp', private.xp_for_level(p.level),
    'next_level_xp', case when p.level < 100 then private.xp_for_level(p.level + 1) end,
    'loadout', private.loadout_json(v_uid),
    'owned', (select coalesce(jsonb_agg(c.key order by c.kind, c.sort_order), '[]'::jsonb) from public.cosmetics c
               where private.owns_cosmetic(v_uid, c.key)),
    'achievements', (select coalesce(jsonb_agg(jsonb_build_object('key', pa.achievement_key, 'unlocked_at', pa.unlocked_at,
                                                                  'claimed', pa.claimed_at is not null) order by pa.unlocked_at), '[]'::jsonb)
                       from public.player_achievements pa where pa.user_id = v_uid),
    'metrics', private.player_metrics(v_uid),
    'unclaimed_chips',
      (select coalesce(sum(private.level_reward(g)), 0) from generate_series(p.claimed_level + 1, p.level) g)
      + (select coalesce(sum(a.reward_chips), 0) from public.player_achievements pa join public.achievements a on a.key = pa.achievement_key
          where pa.user_id = v_uid and pa.claimed_at is null),
    'friend_requests', (select count(*) from public.friendships where addressee = v_uid and status = 'pending')
  );
end $$;

-- Collects every chip reward that is waiting: new levels and achievements.
create or replace function public.claim_rewards()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  p public.player_progress;
  v_levels bigint;
  v_ach bigint;
  v_balance bigint;
begin
  perform private.ensure_progress(v_uid);
  select * into p from public.player_progress where user_id = v_uid for update;
  select coalesce(sum(private.level_reward(g)), 0) into v_levels from generate_series(p.claimed_level + 1, p.level) g;
  select coalesce(sum(a.reward_chips), 0) into v_ach
    from public.player_achievements pa join public.achievements a on a.key = pa.achievement_key
   where pa.user_id = v_uid and pa.claimed_at is null;
  if v_levels + v_ach = 0 then
    raise exception 'nothing_to_claim';
  end if;

  update public.player_progress set claimed_level = p.level where user_id = v_uid;
  update public.player_achievements set claimed_at = now() where user_id = v_uid and claimed_at is null;
  if v_levels > 0 then
    v_balance := private.apply_chips(v_uid, v_levels, 'level_up', null, null,
                                     jsonb_build_object('from', p.claimed_level + 1, 'to', p.level));
  end if;
  if v_ach > 0 then
    v_balance := private.apply_chips(v_uid, v_ach, 'achievement', null, null);
  end if;
  return jsonb_build_object('amount', v_levels + v_ach, 'levels', v_levels, 'achievements', v_ach, 'balance', v_balance);
end $$;

-- -----------------------------------------------------------------------------
-- Profiles and leaderboards
-- -----------------------------------------------------------------------------
create or replace function private.friend_state(p_me uuid, p_other uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_me = p_other then 'self'
    else coalesce((
      select case when f.status = 'accepted' then 'friends'
                  when f.requester = p_me then 'pending_out' else 'pending_in' end
        from public.friendships f
       where least(f.requester, f.addressee) = least(p_me, p_other)
         and greatest(f.requester, f.addressee) = greatest(p_me, p_other)), 'none') end
$$;

-- Banned players are left off the leaderboards. The table is made by 15_moderation.sql;
-- until that file is run nobody is banned.
create or replace function private.is_banned(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v boolean := false;
begin
  if to_regclass('public.player_sanctions') is not null then
    execute 'select exists (select 1 from public.player_sanctions where user_id = $1 and banned_at is not null)' into v using p_user;
  end if;
  return v;
end $$;

create or replace function public.get_profile(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  pr public.profiles;
  p public.player_progress;
begin
  select * into pr from public.profiles where lower(username) = lower(btrim(p_username));
  if not found then
    raise exception 'player_not_found';
  end if;
  select * into p from public.player_progress where user_id = pr.id;
  return jsonb_build_object(
    'user_id', pr.id, 'username', pr.username, 'member_since', pr.created_at,
    'xp', coalesce(p.xp, 0), 'level', coalesce(p.level, 1),
    'level_xp', private.xp_for_level(coalesce(p.level, 1)),
    'next_level_xp', case when coalesce(p.level, 1) < 100 then private.xp_for_level(coalesce(p.level, 1) + 1) end,
    'loadout', private.loadout_json(pr.id),
    'friendship', private.friend_state(v_uid, pr.id),
    'balance', (select balance from public.wallets where user_id = pr.id),
    'achievements', (select coalesce(jsonb_agg(jsonb_build_object('key', pa.achievement_key, 'unlocked_at', pa.unlocked_at) order by pa.unlocked_at desc), '[]'::jsonb)
                       from public.player_achievements pa where pa.user_id = pr.id),
    'totals', (select jsonb_build_object(
                 'rounds', coalesce(sum(s.rounds_played), 0), 'won', coalesce(sum(s.rounds_won), 0),
                 'wagered', coalesce(sum(s.total_wagered), 0), 'returned', coalesce(sum(s.total_returned), 0),
                 'biggest_win', coalesce(max(s.biggest_win), 0), 'games', count(*) filter (where s.rounds_played > 0))
                 from public.player_game_stats s where s.user_id = pr.id),
    'games', (select coalesce(jsonb_agg(jsonb_build_object(
                'game_key', s.game_key, 'name', g.name, 'rounds', s.rounds_played, 'won', s.rounds_won,
                'biggest_win', s.biggest_win, 'net', s.total_returned - s.total_wagered) order by s.rounds_played desc), '[]'::jsonb)
                from public.player_game_stats s join public.games g on g.key = s.game_key
               where s.user_id = pr.id and s.rounds_played > 0)
  );
end $$;

-- Top 50 of a board, plus the caller's own place.
--   p_board: 'level' | 'chips' | 'biggest_win' | 'week' (net chips won this week, Monday to Sunday UTC)
--   p_friends: only the caller and their friends
create or replace function public.leaderboard(p_board text, p_friends boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_week date := date_trunc('week', now() at time zone 'utc')::date;
  v_rows jsonb;
  v_me jsonb;
begin
  if p_board not in ('level', 'chips', 'biggest_win', 'week', 'tournaments') then
    raise exception 'unknown_board';
  end if;

  with pool as (
    select pr.id from public.profiles pr
     where not private.is_banned(pr.id)
       and (not coalesce(p_friends, false)
        or pr.id = v_uid
        or exists (select 1 from public.friendships f where f.status = 'accepted'
                    and ((f.requester = v_uid and f.addressee = pr.id) or (f.addressee = v_uid and f.requester = pr.id))))
  ), scored as (
    select po.id, case p_board
        when 'level' then coalesce((select xp from public.player_progress where user_id = po.id), 0)
        when 'chips' then coalesce((select balance from public.wallets where user_id = po.id), 0)
        when 'biggest_win' then coalesce((select max(biggest_win) from public.player_game_stats where user_id = po.id), 0)
        when 'tournaments' then coalesce((select (counters ->> 'tourney_wins')::bigint from public.player_progress where user_id = po.id), 0)
        else coalesce((select returned - wagered from public.weekly_stats where user_id = po.id and week_start = v_week), 0)
      end as value,
      -- The weekly board only lists people who played this week.
      -- ... and the tournament board only people who have finished one.
      case p_board
        when 'week' then exists (select 1 from public.weekly_stats where user_id = po.id and week_start = v_week)
        when 'tournaments' then coalesce((select (counters ->> 'tourney_played')::bigint from public.player_progress where user_id = po.id), 0) > 0
        else true end as listed
      from pool po
  ), ranked as (
    select s.id, s.value, rank() over (order by s.value desc) as rnk from scored s where s.listed
  )
  select
    (select coalesce(jsonb_agg(private.player_card(r.id) || jsonb_build_object('rank', r.rnk, 'value', r.value) order by r.rnk, r.id), '[]'::jsonb)
       from (select * from ranked order by rnk, id limit 50) r),
    (select jsonb_build_object('rank', r.rnk, 'value', r.value) from ranked r where r.id = v_uid)
    into v_rows, v_me;

  return jsonb_build_object('board', p_board, 'friends', coalesce(p_friends, false), 'rows', v_rows, 'me', v_me);
end $$;

-- -----------------------------------------------------------------------------
-- Friends
-- -----------------------------------------------------------------------------
-- Usernames starting with the query (at least 2 characters), for the "add a friend" box.
create or replace function public.find_players(p_query text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null or length(btrim(coalesce(p_query, ''))) < 2 then '[]'::jsonb else coalesce(
    (select jsonb_agg(private.player_card(x.id) || jsonb_build_object('friendship', private.friend_state(auth.uid(), x.id)) order by x.username)
       from (select pr.id, pr.username from public.profiles pr
              where lower(pr.username) like replace(replace(lower(btrim(p_query)), '\', ''), '%', '') || '%'
                and pr.id <> auth.uid()
              order by pr.username limit 10) x), '[]'::jsonb) end
$$;

create or replace function public.friend_request(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_other uuid;
  f public.friendships;
begin
  select id into v_other from public.profiles where lower(username) = lower(btrim(p_username));
  if v_other is null then
    raise exception 'player_not_found';
  end if;
  if v_other = v_uid then
    raise exception 'action_not_allowed' using hint = 'That''s you.';
  end if;

  select * into f from public.friendships
   where least(requester, addressee) = least(v_uid, v_other) and greatest(requester, addressee) = greatest(v_uid, v_other)
   for update;
  if found then
    if f.status = 'pending' and f.addressee = v_uid then
      -- They had already asked: this accepts.
      update public.friendships set status = 'accepted', responded_at = now() where id = f.id;
    end if;
  else
    if (select count(*) from public.friendships where requester = v_uid and status = 'pending') >= 50 then
      raise exception 'slow_down' using hint = 'You have a lot of requests waiting. Give them time to answer.';
    end if;
    insert into public.friendships (requester, addressee) values (v_uid, v_other);
  end if;
  perform private.check_achievements(v_uid);
  perform private.check_achievements(v_other);
  return jsonb_build_object('friendship', private.friend_state(v_uid, v_other));
end $$;

-- Answer a request from p_user.
create or replace function public.friend_respond(p_user uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  if coalesce(p_accept, false) then
    update public.friendships set status = 'accepted', responded_at = now()
     where requester = p_user and addressee = v_uid and status = 'pending';
  else
    delete from public.friendships where requester = p_user and addressee = v_uid and status = 'pending';
  end if;
  if not found then
    raise exception 'request_not_found';
  end if;
  perform private.check_achievements(v_uid);
  perform private.check_achievements(p_user);
  return jsonb_build_object('friendship', private.friend_state(v_uid, p_user));
end $$;

-- Unfriend, or take back a request you sent.
create or replace function public.friend_remove(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  delete from public.friendships
   where least(requester, addressee) = least(v_uid, p_user) and greatest(requester, addressee) = greatest(v_uid, p_user)
     and (status = 'accepted' or requester = v_uid);
  return jsonb_build_object('friendship', private.friend_state(v_uid, p_user));
end $$;

-- Friends (with the public table they are sitting at, if any) and requests both ways.
create or replace function public.friends_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as id),
  f as (
    select fr.*, case when fr.requester = me.id then fr.addressee else fr.requester end as other
      from public.friendships fr, me
     where me.id in (fr.requester, fr.addressee)
  )
  select case when (select id from me) is null then null else jsonb_build_object(
    'friends', (select coalesce(jsonb_agg(private.player_card(f.other) || jsonb_build_object(
                  'since', f.responded_at,
                  -- Where they are sitting. Private tables stay private: only the fact is shown.
                  'table', (select jsonb_build_object(
                              'id', case when not t.is_private then t.id end, 'game_key', t.game_key, 'game', g.name, 'name', t.name,
                              'tier', t.tier, 'private', t.is_private,
                              'full', (select count(*) from public.table_seats s2 where s2.table_id = t.id) >= t.max_seats)
                              from public.table_seats s join public.game_tables t on t.id = s.table_id
                              join public.games g on g.key = t.game_key
                             where s.user_id = f.other limit 1)
                ) order by lower(pr.username)), '[]'::jsonb)
                  from f join public.profiles pr on pr.id = f.other where f.status = 'accepted'),
    'incoming', (select coalesce(jsonb_agg(private.player_card(f.other) || jsonb_build_object('at', f.created_at) order by f.created_at desc), '[]'::jsonb)
                   from f, me where f.status = 'pending' and f.addressee = me.id),
    'outgoing', (select coalesce(jsonb_agg(private.player_card(f.other) || jsonb_build_object('at', f.created_at) order by f.created_at desc), '[]'::jsonb)
                   from f, me where f.status = 'pending' and f.requester = me.id)
  ) end
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.my_progress()', 'public.claim_rewards()', 'public.equip_cosmetic(text)', 'public.loadouts_for(uuid[])',
    'public.get_profile(text)', 'public.leaderboard(text, boolean)', 'public.find_players(text)',
    'public.friend_request(text)', 'public.friend_respond(uuid, boolean)', 'public.friend_remove(uuid)',
    'public.friends_list()'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.player_progress     enable row level security;
alter table public.cosmetics           enable row level security;
alter table public.achievements        enable row level security;
alter table public.player_achievements enable row level security;
alter table public.player_cosmetics    enable row level security;
alter table public.player_loadouts     enable row level security;
alter table public.weekly_stats        enable row level security;
alter table public.friendships         enable row level security;

-- Catalogues and what players have earned are public to signed-in players.
drop policy if exists "cosmetics: signed-in players can read" on public.cosmetics;
create policy "cosmetics: signed-in players can read" on public.cosmetics for select to authenticated using (true);
drop policy if exists "achievements: signed-in players can read" on public.achievements;
create policy "achievements: signed-in players can read" on public.achievements for select to authenticated using (true);
drop policy if exists "player_progress: signed-in players can read" on public.player_progress;
create policy "player_progress: signed-in players can read" on public.player_progress for select to authenticated using (true);
drop policy if exists "player_achievements: signed-in players can read" on public.player_achievements;
create policy "player_achievements: signed-in players can read" on public.player_achievements for select to authenticated using (true);
drop policy if exists "player_cosmetics: signed-in players can read" on public.player_cosmetics;
create policy "player_cosmetics: signed-in players can read" on public.player_cosmetics for select to authenticated using (true);
drop policy if exists "player_loadouts: signed-in players can read" on public.player_loadouts;
create policy "player_loadouts: signed-in players can read" on public.player_loadouts for select to authenticated using (true);
drop policy if exists "weekly_stats: signed-in players can read" on public.weekly_stats;
create policy "weekly_stats: signed-in players can read" on public.weekly_stats for select to authenticated using (true);

-- A friendship is visible only to the two people in it.
drop policy if exists "friendships: read own" on public.friendships;
create policy "friendships: read own"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester, addressee));

revoke insert, update, delete, truncate on public.player_progress, public.cosmetics, public.achievements,
  public.player_achievements, public.player_cosmetics, public.player_loadouts, public.weekly_stats, public.friendships
  from anon, authenticated;
revoke all on public.player_progress, public.cosmetics, public.achievements, public.player_achievements,
  public.player_cosmetics, public.player_loadouts, public.weekly_stats, public.friendships from anon;
grant select on public.player_progress, public.cosmetics, public.achievements, public.player_achievements,
  public.player_cosmetics, public.player_loadouts, public.weekly_stats, public.friendships to authenticated;

-- So the app can say "achievement unlocked" and "friend request" as they happen.
select private.add_to_realtime('player_achievements');
select private.add_to_realtime('player_progress');
select private.add_to_realtime('friendships');

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.can_view_table(uuid) to authenticated;

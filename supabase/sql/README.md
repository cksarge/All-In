# All In: database SQL

Paste these files into **Supabase Dashboard → SQL Editor** and run them **in order**.
Every file is safe to re-run: tables use `create table if not exists`, functions use
`create or replace`, policies are dropped before being re-created, and seed data is upserted.
When a later phase adds or changes a file, re-running everything from `01` is always fine.

| # | File | What it does |
| --- | --- | --- |
| 1 | `01_profiles.sql` | Creates the `private` schema (internal helpers, not reachable from the browser). `profiles` table (username unique case-insensitively, 3–16 letters/numbers/underscore). `check_username()` RPC for the live availability check at sign-up, `complete_onboarding()` RPC. RLS: signed-in players can read profiles; nobody can write them directly. |
| 2 | `02_economy.sql` | `economy_config` (tunable numbers), `wallets` (play-chip balance, streak, refill timer), `chip_ledger` (every chip change with a reason). `private.apply_chips()` is the **only** code path that changes chips; it writes the ledger in the same transaction and refuses to go negative. Sign-up trigger `on_auth_user_created` creates profile + wallet + **10,000 starting chips**. Backfills any users created before this file ran. RPCs: `get_economy_status()`, `claim_daily_bonus()`, `claim_refill()`. RLS: players read only their own wallet/ledger; no client writes at all. |
| 3 | `03_games_and_stakes.sql` | `games` catalogue (every game and slot machine) and `stake_tiers` (Low / Mid / High / VIP per game: min bet, max bet, minimum chips to sit, blinds/antes for poker). Guards `private.assert_tier_access()` and `private.assert_bet_in_range()` that every game function will call. Public read-only. |
| 4 | `04_realtime.sql` | Adds `wallets` and `chip_ledger` to the `supabase_realtime` publication so balances update live. Realtime respects RLS, so each player only receives their own rows. Also defines `private.add_to_realtime()` used by later files. |
| 5 | `05_tables.sql` | Multiplayer tables and seats for every table game: `game_tables` (public or private with a 6-character invite code), `table_seats` (one seat per player, heartbeat-based **2-minute reconnect hold**). Crypto-random helpers (`private.random_int`, `private.shuffled_shoe`) using pgcrypto. `game_history` and `player_game_stats`, written when rounds settle. **Always a free table:** whenever every public table at a stake level is full, a new one opens automatically (`private.ensure_open_tables`, run by the lobby and quick join; an advisory lock stops duplicates), and the last free table at a level is never auto-closed. RPCs: `list_tables`, `quick_join`, `create_table` (one per player every 20 s), `join_table`, `join_by_code`, `leave_table`, `table_heartbeat`, `set_sitting_out`, `my_table`. |
| 6 | `06_blackjack.sql` | Multiplayer blackjack, fully server-side. `bj_rounds` and `bj_hands` (public to the table: blackjack cards are dealt face up), plus the **hidden** `bj_shoes` (undealt cards) and `bj_secrets` (dealer hole card), which have RLS on with no policies and no client privileges. RPCs: `bj_state`, `bj_place_bet`, `bj_clear_bet`, `bj_deal_now`, `bj_insurance`, `bj_action` (hit/stand/double/split/surrender), `bj_advance`. Opens blackjack and seeds four always-open house tables. |
| 7 | `07_roulette.sql` | Shared-table roulette with 20 s betting rounds. European (single 0) and American (0 + 00) wheels via the table's `variant`. `rl_rounds`, `rl_bets` (public to the table) and the **hidden** `rl_secrets`: the pocket is drawn when betting closes and stays unreadable until the ball lands. Every bet is validated server-side (straight, split, street, corner, line, dozen, column, red/black, odd/even, low/high) and pays 36 ÷ numbers covered. Hot/cold numbers over the last 100 spins. RPCs: `rl_state`, `rl_place_bet`, `rl_undo_bet`, `rl_rebet`, `rl_advance`. Seeds a European and an American house wheel per stake level. |
| 8 | `08_craps.sql` | Shared-table craps with a rotating shooter. `cr_state` (point, shooter, roll timer), `cr_rolls` (history), `cr_bets` (bets that ride across rolls). Pass / don't pass, come / don't come, odds (up to 3×, true odds), place, field, hardways and proposition bets. Dice are rolled by the server; the shooter can roll after 3 s, otherwise it auto-rolls after 20 s. Players who leave get optional bets back; contract bets play out. RPCs: `cr_state`, `cr_place_bet`, `cr_add_odds`, `cr_remove_bet`, `cr_roll`, `cr_advance`. |
| 9 | `09_poker.sql` | Multiplayer poker, 2 to 9 seats, one engine, first for five games: no-limit **Texas Hold'em**, pot-limit **Omaha** and **Omaha Hi-Lo** (8 or better), fixed-limit **Seven-Card Stud** (antes, bring-in, best hand showing acts first) and no-limit **Five-Card Draw**. Players bring chips from their wallet to the table (`table_seats.stack`) and can top up between hands. Blinds/antes, a moving dealer button, server-checked minimum raises, pot-limit maths and fixed-limit caps, short all-ins that don't reopen the betting, side pots, split pots (odd chip left of the button), showdowns with hand names and the winning five cards. Tables: `pk_hands`, `pk_players` (public to the table), **`pk_hole`** (each player can read only their own cards), and the **hidden** `pk_decks` and `pk_topups`. RPCs: `pk_state`, `pk_action`, `pk_draw`, `pk_bring_chips`, `pk_advance`, `pk_hand_history`. Opens all five games with four always-open house tables each. Stage 10 added four more to the same engine, each with its own hand ranking behind `private.pk_show`: **Short Deck** (36 cards, a flush beats a full house), **Razz** (lowest hand wins), **2-7 Triple Draw** and **Badugi** (three draws each, fixed limit with blinds). |
| 10 | `10_slots.sql` | Six solo slot machines and one shared progressive jackpot. **Lucky Sevens** (3 reels, one line), **Pharaoh's Fortune** (5×3, 20 paylines, wilds, free spins with wins ×2), **Gem Cascade** (6×5 cluster pays, cascades with a rising multiplier), **Wild Frontier** (243 to 3,125 ways, free spins on full-height reels), **Dragon Pearls** (5×3, 10 paylines, hold-and-win respins) and **Grand Jackpot** (5×3, 10 paylines; 2% of each bet feeds the pot and every spin can win it, with a chance in proportion to the bet). One RPC, `slot_spin(game, bet)`, takes the bet, draws every symbol, plays any feature to the end and pays in a single transaction, then returns the whole sequence for the browser to replay; `slot_info(game)` returns the paytable, bets and live jackpot (never the reel weights). Table: `jackpots` (readable by signed-in players, live). Paytables are in hundredths of the bet and tuned to return about 95 to 97%; `private.slot_simulate(game, spins)` measures it. |
| 11 | `11_solo_games.sql` | Eight solo games against the house. One call each: **Baccarat** (`baccarat_deal`: Player, Banker less 5%, Tie 8:1, pairs 11:1, eight-deck shoe), **Sic Bo** (`sicbo_roll`), **Keno** (`keno_draw`: 1 to 10 picks, 20 of 80 drawn, about 94 to 95% back) and the **Big Six wheel** (`wheel_spin`, 54 segments). Two calls each, with the decision in between: **Jacks or Better** and **Deuces Wild** video poker (`vp_deal`, `vp_draw`), **Three Card Poker** (`tcp_deal`, `tcp_act`: Ante, Play, Pair Plus, ante bonus) and **Pai Gow Poker** (`pgw_deal`, `pgw_set`: 53 cards with the joker, a computed house way for the dealer and for the "House way" button). `solo_info(game)` returns rules, paytables, stake levels and any round waiting. Tables: `solo_rounds` (a player's open round, own rows only) and the **hidden** `solo_secrets` (the undealt deck and the dealer's cards). |
| 12 | `12_more_games.sql` | Nine more games (their catalogue rows are in file 3, so re-run that first). Against the house in one call: **Dragon Tiger** (`dragon_tiger_deal`), **Plinko** (`plinko_drop`: 8, 12 or 16 rows, three risk levels), **Scratch Cards** (`scratch_play`: three cards with different prize tables) and **Power Draw** (`power_draw_play`: 5 of 30 plus a power ball of 10). With decisions, using `solo_rounds` from file 11: **Casino War** (`war_deal`, `war_act`), **Ultimate Texas Hold'em** (`uth_deal`, `uth_act`; reuses the poker evaluator from file 9) and **Mines** (`mines_start`, `mines_pick`, `mines_collect`). Two live rooms shared by everyone: **Crash** (`crash_state`, `crash_bet`, `crash_collect`; tables `crash_rounds`, `crash_bets` and the **hidden** `crash_secrets`) and **Bingo** (`bingo_state`, `bingo_buy`; tables `bingo_rounds`, `bingo_cards` readable by their owner, and the **hidden** `bingo_secrets`). `more_info(game)` returns rules and paytables. |
| 13 | `13_progression.sql` | XP and levels, achievements, earned cosmetics, leaderboards, public profiles and friends. Triggers on `game_history` and `player_game_stats` (both written by `record_round` for every game) give XP, keep counters and unlock achievements, so no game file changes. Chip rewards for levels and achievements wait until the player calls `claim_rewards()`. Tables: `player_progress`, `achievements` and `cosmetics` (catalogues, edit and re-run to change them), `player_achievements`, `player_cosmetics`, `player_loadouts`, `weekly_stats`, and `friendships` (visible only to the two people in one). RPCs: `my_progress`, `claim_rewards`, `equip_cosmetic`, `loadouts_for`, `get_profile`, `leaderboard`, `find_players`, `friend_request`, `friend_respond`, `friend_remove`, `friends_list`. An achievement can give more than one cosmetic (`extra_cosmetics`), used by Grandmaster (level 100) and Completionist (every other achievement). |
| 14 | `14_tournaments.sql` | Tournaments. Needs the current files 3, 5, 9 and 13 (re-run them first). **Sit & Go poker** (`sng_register`, `sng_unregister`, `sng_status`): a Hold'em table flagged `play_money`, whose chips are a score and never touch a wallet; rising blinds; the entries are the prize pool. **Slot Showdowns** and the **Daily Freeroll** (`showdown_enter`, `showdown_spin`, `showdown_state`): fixed spins that move no chips, best score wins; rounds are created and settled lazily, with no cron. `tournaments_state()` feeds the Tournaments page. Tables `tournaments` and `tournament_entries` are readable by signed-in players and written only by the functions. |
| 15 | `15_moderation.sql` | The admin and moderation. Re-run files 2 and 5 first (their sign-in checks call the sanction check defined here). The admin is a row in the hidden `admins` table, seeded with the account whose username is Carter. Players: `my_account`, `report_player`, `block_player`, `unblock_player`, `change_username` (only when a moderator asked for it). Admin only: `admin_overview`, `admin_reports`, `admin_resolve_report`, `admin_find_players`, `admin_player`, `admin_ban`, `admin_unban`, `admin_timeout`, `admin_rename`, `admin_chips`, `admin_kick`, `admin_set_notice`. Tables: `player_sanctions` and `player_blocks` (own rows readable), `site_notice`, `site_status`, and the hidden `admins`, `player_reports` and `admin_log`. **Site maintenance:** `admin_set_maintenance(on, message)` closes the site to everyone but the admin; `site_status()` (callable signed out) is what every browser asks first. `../maintenance/maintenance_off.sql` opens the site again by hand. |
| 16 | `16_missions_seasons.sql` | Daily and weekly **missions** (`missions_state`, `missions_claim`; progress is counted by a trigger on `game_history`), monthly **seasons** (`season_claim`; the list of seasons is a private function, and a season's cosmetics are only written to `cosmetics` once its month has begun), the **inbox** (`inbox`, `inbox_read`, `inbox_clear`) and **table invites** (`invite_friend`). Re-run file 13 first (the mission achievements are there). Tables: `player_missions`, `player_seasons`, `notifications`, all readable only by their owner. |
| 17 | `17_clubs_records.sql` | **Clubs** (`clubs_list`, `club_state`, `club_create`, `club_join`, `club_leave`, `club_kick`, `club_set_role`, `club_update`; admin `admin_clubs`, `admin_club_rename`, `admin_club_delete`): a name, a tag and a preset emblem, one club per player, up to 50 members. **Head-to-head** records and the **big-win ticker** (`big_wins_recent`), both filled by a trigger on `game_history`. `profile_extras` adds the club, personal records and head-to-head to a profile. Re-run file 13 first. Tables: `clubs` (its invite code column is withheld from clients), `club_members`, `big_wins`, and the hidden `head_to_head`. |
| 18 | `18_tournaments_plus.sql` | The multi-table **Main Event** (`mtt_register`, `mtt_unregister`, `mtt_state`, `mtt_poke`; tables listed in `tournament_tables`, rebalanced and merged between hands), `tourney_status` (the strip above any tournament table), **trophies** (`player_trophies`, `trophies_for`) and `pk_show` (show your cards after a hand). Re-run files 13 and 14 first: the Sit & Go formats (turbo, Omaha), the tournament leaderboard and the achievements are there. |
| 19 | `19_table_poker.sql` | Six card games against the dealer on one engine: **Caribbean Stud**, **Casino Hold'em**, **Let It Ride**, **Mississippi Stud**, **Four Card Poker** and **Teen Patti**. `tp_deal(game, tier, bets)` then `tp_act(game, action)`; the returned state lists the player's next choices and their cost. `game_info(game)` returns paytables and any hand left open. Re-run file 3 first (it lists the games) and file 11 (three more video poker machines: Bonus, Double Bonus, Joker). |
| 20 | `20_blackjack_variants.sql` | Four solo blackjack variants on one engine (`bjv_deal`, `bjv_act`): **Spanish 21**, **Blackjack Switch**, **Free Bet Blackjack** and **Pontoon**. Four quick games: **Red Dog** (`reddog_deal`, `reddog_act`), **Hi-Lo** (`hilo_start`, `hilo_guess`, `hilo_collect`), **Andar Bahar** (`andar_bahar_deal`) and **Chuck-a-Luck** (`chuck_roll`). `quick_info(game)` returns rules and any round left open. Re-run file 3 first (it lists the games). |
| 21 | `21_racing_teen_patti.sql` | Re-run file 3 first. **Horse racing**, one live room like Crash: six runners with prices worked out from their chances (every bet returns about 92%), Win and Place bets, and a finishing order that is only drawn when betting closes (`race_state`, `race_bet`, `race_info`; tables `race_rounds`, `race_bets`). **Teen Patti tables**, 2 to 6 players against each other: boot, blind and seen play, raises, packing, a paid show with two players left, a pot limit (`tpt_state`, `tpt_action`, `tpt_bring_chips`, `tpt_advance`, `tpt_hand_history`; tables `tpt_hands`, `tpt_players` and the **hidden** `tpt_cards`, which holds everyone's cards: a player is handed their own only after choosing to look). Four always-open house tables. |
| 22 | `22_reputation_chat.sql` | Re-run file 13 first. **Reputation** (0 to 100, start 50; `player_reputation`, `reputation_log`, both own rows only): rises with clean chat, falls with filter catches and moderators' decisions (a trigger on `admin_log`), switches typed chat off at 30 or less and quick chat at 20 or less, and at 75 and 100 lends cosmetics that are taken away when it drops. **Typed chat** at tables, in live rooms and in clubs: `chat_send`, `chat_fetch`, `chat_report`; a filter for swear words, spam and advertising; 3 seconds between messages; kept 3 days in the **hidden** `chat_messages`. Admin: `admin_reputation_view`, `admin_reputation`, `admin_chat_ban`, `admin_warn`, `admin_report_false`. Player: `my_reputation`. |
| 23 | `23_social.sql` | What friends are playing, and watching them: `set_activity`, `friends_activity`, `friend_watch`, `set_watchable` (columns added to the hidden `player_activity`). The rest of that stage lives where its tables are: **waiting rooms** for private tables in file 5 (`game_tables.waiting`, `create_table(…, hosted)`, `table_start`; every table game refuses bets or deals while a table waits) and **direct messages** between friends in file 22 (`dm:` channels, `dm_threads`, the hidden `dm_reads`). |

## Turn timers without a server process

There is no background job. Each round stores its deadline (`phase_ends_at`). Every client at the table calls
the game's advance function (`bj_advance`, `rl_advance`, `cr_advance`, `pk_advance`, `tpt_advance`) when a countdown hits zero (the Crash, Bingo and horse racing rooms do the same inside `crash_state`, `bingo_state` and `race_state`, which their screens poll); the **server** checks the deadline and, if it has passed, closes betting,
closes insurance, auto-stands the player who timed out, or (poker) checks or folds for them and sits them out (disconnected players are skipped straight away). The lobby
(`list_tables`) also finishes any round whose timer ran out while nobody was watching, so bets can't get stuck.
No Edge Functions or `pg_cron` are needed.

## Adding a game

Each game file plugs into shared helpers from `05_tables.sql` by naming convention, so shared code never
has to change: `private.<game>_tick_stale()` (finish that game's expired rounds),
`private.<game>_in_play(uuid)` (chips a player has riding on that game) and, optionally,
`private.<game>_seat_left(table uuid, user uuid)` (called whenever a seat is freed; poker and Teen Patti fold the hand).
A new game's catalogue row goes in `03_games_and_stakes.sql`, and its achievements and cosmetics in `13_progression.sql`.
Chips a player brought to the table (`table_seats.stack`) are returned to their wallet automatically by the
`table_seats_removed` trigger, however the seat is freed: leaving, switching tables, or the reconnect hold running out.

Solo games need none of that: there is no table or seat. The slots, baccarat, Sic Bo, keno and the wheel settle in
the same call that places the bet, so chips are never left in play. Games with a decision in the middle (video poker,
the dealer poker games, the blackjack variants, Mines, Hi-Lo and others) keep
one open round per player in `solo_rounds` while the player decides; it has no timer and simply waits, and
`private.solo_in_play` counts its chips.

## Security model

- **Server-authoritative.** Clients call `supabase.rpc(...)`. All randomness, rules and chip
  changes happen inside `SECURITY DEFINER` Postgres functions with a fixed `search_path`.
- **No client writes to chips.** `wallets` and `chip_ledger` have no insert/update/delete
  policies, *and* those table privileges are revoked from `anon` and `authenticated`.
- **Internal functions live in `private`**, which is not exposed by the Data API. Execute is
  revoked on every function there; the only exception is `private.can_view_table()`, which RLS
  policies call as the `authenticated` role. Do **not** add `private` to *Settings → Data API → Exposed schemas*.
- **Hidden information** (the undealt shoe and decks, the dealer's hole card and solo-game hands, the next roulette pocket) lives in
  tables with RLS enabled and no policies and no privileges, so no client query can read them, and they are
  never added to the realtime publication. Poker hole cards (`pk_hole`) have a single policy: you can read
  your own rows and nobody else's. Other players' cards only become public (`pk_players.shown_cards`) at showdown.
  At Teen Patti tables even your own cards are hidden (`tpt_cards`) until you choose to look.
- **Chat is never read from a table.** `chat_messages` has no policies and no privileges; `chat_fetch` decides per
  channel who may read, and returns the filtered text. Realtime only carries a content-free ping between browsers.
- **Sanctions and maintenance in one place.** `private.require_uid()`, which every game function calls first, runs
  `private.sanction_check`: a banned or timed-out player, or anyone but the admin during site maintenance, is refused.
- **Supabase's security advisor** flags every public `SECURITY DEFINER` function. That is this design, not a leak:
  each one checks the caller. Only `check_username` and `site_status` can be called signed out.
- **Errors are short codes** (`daily_already_claimed`, `insufficient_chips`, `refill_on_cooldown`, …)
  that the app maps to friendly messages.

## Economy defaults (edit `economy_config` to tune)

| Setting | Default |
| --- | --- |
| Starting chips | 10,000 |
| Daily bonus | 1,000 × streak multiplier (1, 1.25, 1.5, 1.75, 2, 2.5, 3; day 7+ stays at 3x). Resets 00:00 UTC; missing a day resets the streak. |
| Free refill | When wallet + chips in play < 1,000, top up to 5,000. Once every 4 hours. |

```sql
-- Example: make the refill threshold 2,000 chips
update public.economy_config set refill_threshold = 2000, updated_at = now() where id;
```

## Testing locally (optional)

`npm run test:sql` spins up a throwaway local Postgres (needs Postgres 15+ binaries installed),
loads a small Supabase stand-in (`supabase/tests/00_supabase_stub.sql`), applies every file
**twice** to prove re-runnability, then runs `supabase/tests/*_test.sql`
(18 files: the economy, every game's rules and payouts, RLS and permission denials, progression,
tournaments, moderation, missions and seasons, clubs). It also checks that
`supabase/maintenance/check_database.sql` matches the files; regenerate that with `bash scripts/gen-db-check.sh`
after changing any SQL.
The stub is for local tests only. Never run it on your Supabase project.

## Scripts run by hand (`supabase/maintenance/`)

These are not part of the numbered files and are never applied by the tests.

- `check_database.sql` reads the database and compares it with everything the numbered files create (tables, columns,
  row level security, policies, triggers, every function and whether its body is current, realtime tables, and the
  game, stake level, achievement and cosmetic rows). It names the file to re-run for anything missing or out of date.
  It is generated by `scripts/gen-db-check.sh`: do not edit it.
- `cleanup.sql` deletes finished rounds, history and activity beyond what the screens show. It never touches
  balances, progress, or anything still being played. Give any new table that piles up rows a step there.
- `maintenance_off.sql` opens the site if the admin is locked out while maintenance is on.

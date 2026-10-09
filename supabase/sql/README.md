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

## Turn timers without a server process

There is no background job. Each round stores its deadline (`phase_ends_at`). Every client at the table calls
the game's advance function (`bj_advance`, `rl_advance`, `cr_advance`) when a countdown hits zero; the **server** checks the deadline and, if it has passed, closes betting,
closes insurance, or auto-stands the player who timed out (disconnected players are skipped straight away). The lobby
(`list_tables`) also finishes any round whose timer ran out while nobody was watching, so bets can't get stuck.
No Edge Functions or `pg_cron` are needed.

## Adding a game

Each game file plugs into two shared helpers from `05_tables.sql` by naming convention, so shared code never
has to change: `private.<game>_tick_stale()` (finish that game's expired rounds) and
`private.<game>_in_play(uuid)` (chips a player has riding on that game).

## Security model

- **Server-authoritative.** Clients call `supabase.rpc(...)`. All randomness, rules and chip
  changes happen inside `SECURITY DEFINER` Postgres functions with a fixed `search_path`.
- **No client writes to chips.** `wallets` and `chip_ledger` have no insert/update/delete
  policies, *and* those table privileges are revoked from `anon` and `authenticated`.
- **Internal functions live in `private`**, which is not exposed by the Data API. Execute is
  revoked on every function there; the only exception is `private.can_view_table()`, which RLS
  policies call as the `authenticated` role. Do **not** add `private` to *Settings → Data API → Exposed schemas*.
- **Hidden information** (the undealt shoe, the dealer's hole card) lives in tables with RLS
  enabled and no policies and no privileges, so no client query can read them, and they are
  never added to the realtime publication.
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
(sign-up trigger, RLS, daily streaks, refill cooldowns, ledger integrity, permission denials).
The stub is for local tests only. Never run it on your Supabase project.

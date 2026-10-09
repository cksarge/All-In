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
| 4 | `04_realtime.sql` | Adds `wallets` and `chip_ledger` to the `supabase_realtime` publication so balances update live. Realtime respects RLS, so each player only receives their own rows. |

## Security model

- **Server-authoritative.** Clients call `supabase.rpc(...)`. All randomness, rules and chip
  changes happen inside `SECURITY DEFINER` Postgres functions with a fixed `search_path`.
- **No client writes to chips.** `wallets` and `chip_ledger` have no insert/update/delete
  policies, *and* those table privileges are revoked from `anon` and `authenticated`.
- **Internal functions live in `private`**, which is not exposed by the Data API and has no
  grants for `anon`/`authenticated`. Do **not** add `private` to *Settings → Data API → Exposed schemas*.
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

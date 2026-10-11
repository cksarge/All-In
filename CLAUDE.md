# CLAUDE.md: All In

Everything needed to keep building **All In**, a web-based, free-play, multiplayer social casino that uses
**play chips only**. Read this whole file before changing anything. README.md (setup/deploy), SETUP.md
(Supabase dashboard checklist) and `supabase/sql/README.md` (database files, security model) go deeper.

---

## 1. Non-negotiable rules (from the original spec)

1. **No real money, ever.** No payments, purchases, cash-out, prizes of real value, or payment libraries.
   Chips can't be bought, sold, gifted for value, transferred between players or redeemed.
2. **Server-authoritative.** All randomness, rules, bet validation and chip changes run in Postgres
   functions called with `supabase.rpc()`. Clients can only *read* their own balance, never write it.
3. **Hidden information stays hidden**, enforced by RLS: other players' hole cards, undealt decks/shoes,
   the dealer's hole card, the next roulette pocket, etc.
4. **Only the publishable key** in the client. Never use or ask for the service role / secret key in
   front-end code (`src/lib/supabase.ts` refuses to start with one).
5. **Copy rules** (enforced by `npm run check:copy`, which also runs in CI):
   - Never show `$` or any currency symbol for chips. Use the chip icon (`<ChipAmount>` / `<ChipIcon>`).
   - Never use the words "deposit", "withdraw", "cash out", "buy" or "purchase" in the UI, except
     disclaimers like "No purchases". For example, poker rebuys are called **"Top up"** and buy-ins
     **"Bring chips"**.
6. **Persistent footer statement**: "Free to play. No real money. No purchases. Chips have no cash value."
7. **SQL files are numbered and re-runnable** (`create … if not exists`, `create or replace`, drop and
   re-create policies, upserted seeds), with **RLS on every table**.
8. **After each phase, tell the user** (1) which SQL files to run, (2) any Supabase dashboard settings,
   (3) what to test. They run the SQL by hand in the Supabase SQL Editor.

## 2. Fixed values (all public)

| What | Value |
| --- | --- |
| Supabase URL | `https://irwctaccrxtcoqsskjpy.supabase.co` |
| Publishable key | `sb_publishable_16Wb-YS3WD6d6iq93tDRpA_pdMlm7xT` |
| Turnstile site key | `0x4AAAAAAFSY1ZizIBVxN3W0` (the secret key lives only in Supabase → Attack Protection) |
| Live site | `https://allin.carterscoding.com/` (GitHub Pages, custom domain, `public/CNAME`) |
| Repo | `cksarge/All-In`, default branch `main` |

Local `.env` (gitignored) holds the three `VITE_*` values above; `.env.example` has them too.

## 3. Stack and commands

Vite 7 + React 19 + TypeScript 5.9, Tailwind 4 (`@tailwindcss/vite`), Framer Motion 12, Zustand 5,
React Router 7, supabase-js v2. Static site. Node 22 (CI uses 22).

```bash
npm install
npm run dev          # http://localhost:5173 against the real Supabase project (.env)
npm run check        # typecheck (tsc -b) + copy guard: run before every commit
npm run build        # tsc -b && vite build -> dist/ (also writes 404.html for SPA routes)
npm run test:sql     # throwaway Postgres: applies every SQL file twice, runs supabase/tests/*_test.sql
```

`test:sql` needs Postgres 15+ binaries (`initdb`, `pg_ctl`, `psql`) on PATH (or `PG_BIN=…`). On macOS:
`brew install postgresql@16`. On Windows use WSL. When run as root it switches to the `postgres` user.

## 4. Git and PR workflow

- Phases so far were developed on a feature branch (`claude/youthful-turing-56segv`) and merged into
  `main` through PRs #1 to #6. **Merging to `main` deploys the site** (GitHub Actions → Pages).
- Create a PR only when the user asks; so far they have asked after every phase. No PR template.
- If a branch's PR was merged, start follow-up work from the latest `main`.
- Never put a model name in commits or PRs. Add attribution lines only as the harness instructs.
- Never commit `.env`, `dist/` or `node_modules/`.

## 5. Status and roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Scaffold, auth (email + 6-digit OTP), email templates, profiles, chip economy | ✅ merged |
| 2 | Lobby, tables & seats, realtime plumbing, multiplayer blackjack | ✅ merged |
| 3 | Roulette (European/American), craps | ✅ merged |
| 4 | Poker: Hold'em (NL), Omaha (PL), Omaha Hi-Lo (PL), Seven-Card Stud (FL), Five-Card Draw (NL) | ✅ merged (PR #6) |
| 5 | **Six slot machines + one shared progressive jackpot** | **Next** |
| 6 | Baccarat, video poker (Jacks or Better, Deuces Wild), Three Card Poker, Pai Gow, Sic Bo, Keno, Big Six wheel | |
| 7 | XP, achievements, earned cosmetics + locker, leaderboards, profile, friends with "join their table" | |
| 8 | Polish: sounds, animations, tutorials, accessibility, mobile pass, Sit & Go poker tournaments | |

**User action pending for Phase 4:** run `05_tables.sql` (changed) then `09_poker.sql` (new) in the
Supabase SQL Editor, if they haven't already. Re-running every file from `01` is always safe.

### Phase 5 plan (slots), as agreed with the user
The game rows already exist in `03_games_and_stakes.sql` (stake profile `slots`: Low 10–100,
Mid 100–1,000, High 1,000–10,000, VIP 5,000–50,000 per spin). They are single-player (`multiplayer = false`).
`src/components/lounge/GameGrid.tsx` already links non-multiplayer games to **`/play/:gameKey`**, a route
that doesn't exist yet: add it in `src/App.tsx` (a `PlayPage` dispatching by game key).

| Key | Name | Mechanic |
| --- | --- | --- |
| `slots_classic` | Lucky Sevens | 3-reel fruit machine |
| `slots_paylines` | Pharaoh's Fortune | 5 reels × 3 rows, 20 paylines, wilds, free spins |
| `slots_cascade` | Gem Cascade | Cluster pays with cascading wins |
| `slots_ways` | Wild Frontier | Ways-to-win (243+) with expanding reels |
| `slots_holdwin` | Dragon Pearls | Hold-and-win bonus rounds |
| `slots_progressive` | Grand Jackpot | One shared progressive jackpot for everyone |

The design should follow the existing pattern:
- New file `supabase/sql/10_slots.sql`.
- Reel strips and paytables live in SQL. One spin RPC per game (or a generic `slot_spin(p_game, p_bet, …)`)
  does all randomness with `private.random_int`, pays with `private.apply_chips`, and logs with
  `private.record_round`.
- A hidden RNG state is not needed (each spin is atomic), but free-spin and hold-and-win state must be
  server-side.
- Jackpot: a `jackpots` table, seeded and fed by a small % of each progressive spin, added to the realtime
  publication so a live ticker updates. Winning resets it to its seed.
- Aim for a sensible RTP (about 94–97%) and verify it with a SQL simulation test.
- Re-check the copy guard: no "buy feature" wording.
- Finish with SQL tests in `supabase/tests/06_slots_test.sql` and e2e screenshots.

### Deferred items already promised
- Friends and "join their table" (Phase 7).
- Tutorials, including craps (Phase 8).
- Keyboard access for the thin roulette edge zones (Phase 8).
- Hardening broadcast emotes so only seated players can send them (Phase 8).
- Poker pre-action buttons (check/fold in turn) and showing cards voluntarily when everyone folds
  would be nice later.

## 6. Repository map

```
.github/workflows/deploy-pages.yml   build + deploy to GitHub Pages on push to main (VITE_BASE from configure-pages)
public/                              favicon.svg (same ruby chip as ChipIcon), CNAME, _redirects, .nojekyll
index.html                           boot screen inside #root ("Shuffling up…", help text after 6 s)
vite.config.ts                       VITE_BASE base path, spaFallback plugin (404.html), manualChunks, @ -> src
scripts/check-copy.mjs               copy guard (currency symbols, banned words)
scripts/test-sql.sh                  SQL test runner
scripts/e2e/                         local end-to-end harness (see §9)
supabase/sql/01…09_*.sql             the database, applied in order (see §7)
supabase/tests/00_supabase_stub.sql  fake auth schema/roles for local tests ONLY
supabase/tests/0N_*_test.sql         tests: tests.ok / tests.throws helpers, run as role authenticated
supabase/email-templates/            confirm-signup.html, reset-password.html (+ subjects in README)
src/App.tsx                          routes: / signup login verify forgot-password how-chips-work settings
                                     lounge lobby table/:id join/:code *
src/lib/                             supabase client, errors (friendlyError), format, cards, sound (WebAudio),
                                     turnstile, validation, types, and per-game helpers: blackjack, roulette, craps, poker
src/stores/                          zustand: auth, wallet (balance, ledger), presence, settings, toast, ui
src/hooks/useLiveTable.ts            shared live-table plumbing (see §8); useBlackjackTable / usePokerTable wrap it
src/hooks/useLobby.ts                lobby table list + online presence
src/components/table/                TableHeader, PlayerStrip, PhaseBar, TimerRing(+useSecondsLeft), ReactionBar,
                                     ChipStack, InfoModal(+TabButtons), GameHistoryModal
src/components/{blackjack,roulette,craps,poker}/   one folder per game; *Table.tsx is the entry
src/components/cards/PlayingCard.tsx PlayingCard + CardFan (sizes xs/sm/md/lg, highlight, still, delay)
src/pages/TablePage.tsx              loads game_tables.game_key and dispatches to the right *Table component
src/pages/LobbyPage.tsx              game tabs, quick join per tier, private tables, join by code, live tables
```

## 7. Database architecture

**Files** (`supabase/sql/`, run in order; all re-runnable):
1. `01_profiles.sql`: `private` schema; `profiles` (case-insensitive unique username, 3–16 chars of
   `[A-Za-z0-9_]`); `check_username`, `complete_onboarding`.
2. `02_economy.sql`: `economy_config`, `wallets`, `chip_ledger`, and **`private.apply_chips(user, delta,
   reason, game, ref_id, meta)`, the ONLY way chips change** (it writes the ledger and refuses to go
   negative). Also the sign-up trigger (profile + wallet + 10,000 chips, `signup_bonus`) and
   `get_economy_status`, `claim_daily_bonus` (1,000 × streak multiplier 1, 1.25, 1.5, 1.75, 2, 2.5, 3;
   UTC days) and `claim_refill` (below 1,000 → refill to 5,000, every 4 h; counts chips in play).
3. `03_games_and_stakes.sql`: `games` catalogue (every game; `released` flips per phase) and
   `stake_tiers` (low/mid/high/vip per game; poker params `{small_blind, big_blind, ante, min_stack,
   max_stack}`, stud `{ante, bring_in, small_bet, big_bet, …}`); `private.assert_tier_access`,
   `private.assert_bet_in_range`.
4. `04_realtime.sql`: publishes wallets and the ledger; defines `private.add_to_realtime(table)`.
5. `05_tables.sql`: shared multiplayer layer:
   - Tables: `game_tables` (public/private + 6-char invite code, `variant`, `persistent` house tables),
     `table_seats` (one seat per user, `stack` = poker chips at the table, `status` active/sitting_out,
     heartbeat `last_seen_at`).
   - Helpers: `private.random_int(n)` (pgcrypto CSPRNG with rejection sampling), `private.shuffled_shoe(decks)`
     (Fisher-Yates), `private.random_code`, `private.can_view_table` (the only private function RLS may call),
     `cleanup_tables`, `ensure_open_tables` (**there is always a public table with a free seat at every tier**;
     advisory lock), `take_seat` (moving tables frees the old seat).
   - Trigger **`table_seats_removed`**: returns `stack` to the wallet (`table_chips_out`) however a seat is
     freed, then calls every `private.<x>_seat_left(table, user)` hook.
   - RPCs: `list_tables`, `create_table` (one per player per 20 s → `slow_down`), `quick_join`, `join_table`,
     `join_by_code`, `leave_table`, `table_heartbeat`, `set_sitting_out`, `my_table`.
   - Also `game_history` + `player_game_stats`, written by `private.record_round(...)`.
6. `06_blackjack.sql`: 6-deck shoe, dealer stands soft 17, 3:2, insurance, double, split ×3, surrender.
   Hidden `bj_shoes`, `bj_secrets`.
7. `07_roulette.sql`: 20 s betting → 7 s spin → 6 s results; European/American via `variant`; hidden
   `rl_secrets`; pays 36 ÷ numbers covered.
8. `08_craps.sql`: rotating shooter, pass/don't, come/don't, odds 3× (true odds), place, field, hardways,
   props; roll timer 20 s, minimum 3 s between rolls.
9. `09_poker.sql`: one engine, five games (`pk_config(game)` → family board/stud/draw, limit nl/pl/fl).
   - Tables: `pk_hands`, `pk_players` (public), **`pk_hole` (RLS: own rows only)**, hidden `pk_decks`
     and `pk_topups`.
   - RPCs: `pk_state`, `pk_action(table, action, amount)` (`amount` = total "raise to" this street),
     `pk_draw(table, cards[])`, `pk_bring_chips`, `pk_advance`, `pk_hand_history`.
   - Rules covered: min raise, pot-limit max, fixed-limit cap of 4, short all-ins don't reopen the betting,
     uncalled bets returned (never to folded players), side pots, split pots (odd chip left of the button),
     hi-lo 8-or-better.
   - Timer 20 s → check if free else fold, then sit out; players who left or disconnected are acted for at once.

**Conventions every game follows** (shared code in 05 never needs editing):
- `private.<game>_tick_stale()`: finish expired rounds when nobody is watching (called from `list_tables`).
- `private.<game>_in_play(uuid)`: chips riding on unfinished rounds; summed into
  `private.chips_in_play` together with `table_seats.stack`.
- Optional `private.<game>_seat_left(uuid, uuid)`.
- Public RPCs are `security definer`, `set search_path = ''`, start with `private.require_uid()`, lock the
  table row (`<game>_lock_table`) before mutating, and raise **short snake_case error codes** (with a
  friendly `hint` when useful) that `src/lib/errors.ts` maps to messages. New codes go in `RPC_MESSAGES`;
  add the code to `USE_HINT` when the server hint is player-friendly.
- **Timers are deadlines, not jobs:** rows store `phase_ends_at`; any client calls `<game>_advance` when a
  countdown hits zero and the server decides. No cron or edge functions.
- **Hidden tables:** RLS on, no policies, `revoke all … from anon, authenticated`, never published to realtime.
- **Each file ends with** `revoke execute on all functions in schema private from public, anon, authenticated;
  grant execute on function private.can_view_table(uuid) to authenticated;`. `private` must NOT be added to
  the Data API's exposed schemas.
- Seed persistent house tables with `insert … where not exists`; flip `games.released = true` in the
  game's own file.
- Ledger reasons used so far: `signup_bonus`, `daily_bonus`, `refill`, `bet`, `payout`, `refund`, `push`,
  `table_chips_in`, `table_chips_out`, `poker_pot`. Add labels in `src/components/economy/RecentActivity.tsx`.

**Realtime publication** now has 13 tables: wallets, chip_ledger, game_tables, table_seats, bj_rounds,
bj_hands, rl_rounds, rl_bets, cr_state, cr_rolls, cr_bets, pk_hands, pk_players. Postgres Changes enforce RLS.

**Cards** everywhere: integers 0–51, `rank = c % 13` (0 = Ace … 12 = King), `suit = c / 13` in ♠ ♥ ♦ ♣ order.

## 8. Frontend architecture and conventions

- **`useLiveTable({ tableId, stateFn, advanceFn, realtimeTables, getDeadline })`** is the base of every
  table game. It:
  - fetches the `<game>_state` snapshot and refetches on Postgres Changes for the game's tables plus
    `table_seats` and `game_tables` (60 ms debounce, plus a 12 s safety refetch);
  - handles broadcast quick-chat (IDs only, no free text) and presence (watchers);
  - sends a heartbeat every 15 s, and leaves the seat 300 ms after unmount (in-app navigation);
  - runs the deadline watcher (calls `advanceFn` with jitter once a timer passes);
  - computes the server clock offset.
  It returns `call(fn, args)`, which fills in `p_table` and returns a friendly error string or null.
- **supabase-js requests are lazy:** `void supabase.rpc(...)` never runs. Always `await` it or `.then()`.
  Also, supabase-js reports every HTTP 5xx as `AuthRetryableFetchError` with a status, so `friendlyError`
  treats only status 0 as a network failure.
- Table pages share `TableHeader`: a single "← Leave table" / "← Lobby" button that leaves the seat, plus
  Rules, History, Sit out, an `extra` slot and an optional `stakes` label.
- **UX decisions the user asked for (keep them):**
  - Settings is a popup opened by the gear next to the sound icon.
  - Status lines are keyed by phase/turn, so the countdown seconds tick without re-animating.
  - Result banners have their own timer.
  - Win labels show the amount paid back (e.g. +200 on a 100 bet).
  - Going to the lobby leaves the table.
  - The favicon matches the logo chip.
  - Nothing may be clipped at 360–390 px wide.
- Auth:
  - Email + password. Sign-up confirmation and password reset use a 6-digit OTP (`{{ .Token }}`):
    `verifyOtp` type `'email'` for sign-up and `'recovery'` for reset.
  - Every `signUp`, `signInWithPassword`, `resend` and `resetPasswordForEmail` call gets a fresh Turnstile
    token (`TurnstileHandle.getToken()`, then `reset()`). The widget uses `appearance='always'` on the main forms.
- Styling: Tailwind with custom colours (`ink`, `felt`, `ruby`, `gold`, `cream`, `ivory`), the `.felt` and
  `.surface` classes, Playfair Display headings and Inter body text. Sounds come from `playSound(...)` in
  `src/lib/sound.ts`.

## 9. Testing

1. `npm run check` and `npm run test:sql` before every commit. SQL tests:
   - impersonate users with `tests.as_user(uuid)` + `set role authenticated`;
   - use security-definer helpers to peek at hidden state;
   - stack decks by overriding `private.shuffled_shoe` / `private.random_int` in the test file.
2. **End-to-end (two real browsers against the real SQL, no Supabase needed)**, in `scripts/e2e/`:
   ```bash
   bash scripts/e2e/setup-db.sh                 # Postgres on :55432 with all SQL, test helpers, users ann/ben/cat@allin.test
   (cd scripts/e2e && npm install && npx playwright install chromium)
   node scripts/e2e/mini-supabase.cjs &         # tiny Auth + PostgREST stand-in on :54321 (any password works)
   VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local VITE_TURNSTILE_SITE_KEY= \
     npx vite build --outDir /tmp/allin-e2e-dist --emptyOutDir
   npx vite preview --outDir /tmp/allin-e2e-dist --port 4180 --strictPort &
   psql -h localhost -p 55432 -U postgres -f scripts/e2e/reset.sql   # fresh players before each run
   node scripts/e2e/poker.cjs /tmp/shots        # Hold'em, Draw, Stud (24 checks); screenshots to /tmp/shots
   node scripts/e2e/phase3.cjs /tmp/shots       # roulette + craps
   ```
   Notes:
   - The stand-in has **no realtime**, so the scripts nudge a page to refetch by dispatching
     `visibilitychange`, and the header shows "Reconnecting…" (expected).
   - Test helpers: `select tests.deck('As Ah Kc Kd …')` stacks the next poker deck;
     `insert into tests.dice (v) values (2),(3)` queues a craps roll of 3 + 4.
   - Use `exact: true` in Playwright name selectors ('50 chip' matches '250 chip').
   - Test emails need a TLD. The poker history step has timed out once on a cold start; re-run if so.
   - Kill background node processes with a bracket pattern, e.g. `pkill -f "[m]ini-supabase"`.
     The bracket stops the pattern from matching the pkill command itself, but avoid running it in the
     same command line that restarts the server: that line contains the name too and gets killed.
   - Always look at the screenshots, desktop (1280 px) and phone (390 px), before calling UI work done.

## 10. Deployment and Supabase dashboard

- **GitHub Pages:** Settings → Pages → Source must be **GitHub Actions**. The workflow builds with
  `VITE_BASE` from `configure-pages` (`/` on the custom domain) and the public env values as defaults.
  **After any custom-domain change, re-run the deploy workflow**, otherwise the site sticks on "Shuffling up…".
- Supabase settings already done by the user (details in SETUP.md):
  - Email OTP length 6, Confirm email on, password rules (8+, lower, upper, digit).
  - Branded templates with `{{ .Token }}`.
  - Site URL `https://allin.carterscoding.com` with redirect URLs.
  - Turnstile CAPTCHA (Attack Protection).
  - Custom SMTP through Resend. Note that the user's school email domain blocks these emails, and the user
    confirmed that account manually.
  - Realtime "allow public access" left on.

## 11. How to work with this user

- They're building this phase by phase and test on the live site. Give short, concrete "what to test" lists.
- They like to be asked before a PR and say "make a pr" when ready.
- They're not a poker or craps expert; explain game rules plainly when they ask (e.g. why a field bet paid 1:1).
- Report honestly what was verified (tests, e2e, screenshots) and what wasn't.

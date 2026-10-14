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
npm run check        # typecheck (tsc -b) + copy guard + icon check: run before every commit
npm run build        # tsc -b && vite build -> dist/ (also writes 404.html for SPA routes)
npm run test:sql     # throwaway Postgres: applies every SQL file twice, runs supabase/tests/*_test.sql
```

`test:sql` needs Postgres 15+ binaries (`initdb`, `pg_ctl`, `psql`) on PATH (or `PG_BIN=…`). On macOS:
`brew install postgresql@16`, or Postgres.app in `/Applications` (the scripts find it by themselves; the user's
Mac has Postgres.app 16 and no Homebrew). On Windows use WSL. When run as root it switches to the `postgres` user.

## 4. Git and PR workflow

- Phases 1 to 4 were built in cloud sessions on a feature branch (`claude/youthful-turing-56segv`) and merged
  into `main` through PRs #1 to #6. Since Phase 5 the work happens on the user's Mac, **directly on `main`**
  (their choice; no feature branches or PRs unless they ask). That old branch was deleted on 2026-10-13
  (the user's request); `main` is the only branch, locally and on GitHub.
- **Pushing to `main` deploys the site** (GitHub Actions → Pages), so commit and push only when the user says to.
- Add attribution lines to commits as the harness instructs (the user is fine with the model name there).
- Never commit `.env`, `dist/` or `node_modules/`.

## 5. Status and roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Scaffold, auth (email + 6-digit OTP), email templates, profiles, chip economy | ✅ merged |
| 2 | Lobby, tables & seats, realtime plumbing, multiplayer blackjack | ✅ merged |
| 3 | Roulette (European/American), craps | ✅ merged |
| 4 | Poker: Hold'em (NL), Omaha (PL), Omaha Hi-Lo (PL), Seven-Card Stud (FL), Five-Card Draw (NL) | ✅ merged (PR #6) |
| 5 | Six slot machines + one shared progressive jackpot | ✅ on `main` |
| 6 | Baccarat, video poker (Jacks or Better, Deuces Wild), Three Card Poker, Pai Gow, Sic Bo, Keno, Big Six wheel | ✅ on `main` |
| 6.5 | Ultimate Texas Hold'em, Dragon Tiger, Casino War, Crash, Plinko, Mines, Scratch Cards, Power Draw, Bingo; lounge sections; every game in the lobby picker | ✅ on `main` |
| 7 | XP and levels, achievements, earned cosmetics + locker, leaderboards, profiles, friends with "join their table" | ✅ built on `main` |
| 8 | Tournaments (Sit & Go poker, Slot Showdowns, Daily Freeroll) + polish: sounds, animations, first-visit guides, accessibility, mobile | ✅ built on `main` |
| 9 | **Live-service features, in four parts (below)** | ✅ all four parts built on `main` |
| 10 | **More games (the user's list, below), in four parts** | ✅ all four parts built on `main` |
| 11 | **Reputation and typed chat** (`22_reputation_chat.sql`), Terms of Service and Privacy Policy | ✅ built on `main` |
| 12 | **Quality of life, social, events, practice, admin tools (the user's list, below), in four parts** | ✅ all four parts built on `main` |
| 13 | **Keyboard shortcuts everywhere, bet presets, friends online on the lounge, turn alerts** (no SQL; §8) | ✅ built on `main` |

**User action pending for two-step verification (2026-10-13):** re-run `15_moderation.sql`, and in the dashboard
paste `supabase/email-templates/verify-identity.html` into Authentication → Emails → **Magic Link** (subject in
SETUP.md §4).
**User action pending for stage 12 part 4:** re-run `15_moderation.sql`, then run the new `25_admin_tools.sql`. No
dashboard settings. Afterwards `supabase/maintenance/check_database.sql` should say OK.
**And for part 3, if not run yet:** re-run `03_games_and_stakes.sql`, `10_slots.sql`, `13_progression.sql`,
`14_tournaments.sql`, `16_missions_seasons.sql` and `18_tournaments_plus.sql` (in that order), then run `24_events.sql`.
(Part 2's SQL first, if not run yet: re-run `05`, `06`, `07`, `08`, `09`, `21`, `22`, then run `23_social.sql`.)
(Phase 11's SQL first, if not run yet: re-run `13` and `15`, run `22`, then `maintenance/special_cosmetics.sql`.)

### Stage 12 plan (the user's list of 2026-10-12, split into four parts like stages 9 and 10)
1. ✅ **Quality of life, no SQL:** the music control in the top bar, bets and choices remembered per game, Rebet that
   survives a reload, auto-play for the one-step games, lounge search and filters, "Sit out next hand" and auto
   top-up, a confirmation before leaving with chips in play, a Stats button on every game, a size setting.
2. ✅ **Social:** direct messages between friends (in `22`), private tables with a waiting room (in `05`), watching a
   friend's game (`23_social.sql`).
3. ✅ **Events and practice:** private tournaments and club events (`24_events.sql`), seven practice drills
   (`/practice`, browser only), the seasonal game **Haunted Manor** for October 2026 (in `03` and `10`) and three
   **season-long missions worth 300 season points** tied to it (in `16`). **Each later month needs its own seasonal
   game built** (the user wants a different one every month, and a slot must be special): see file 24's notes in §7.
4. ✅ **Admin:** a site stats page, chat log search and appeals (`25_admin_tools.sql`), scheduled site notices and
   maintenance (in `15`). Also in this round: the Practice page gained **walkthroughs** ("Learn to play"), and the
   "Play chips" tag was taken off the top bar's balance (the user's requests of 2026-10-12).
**The user's answers (2026-10-12):** direct messages are friends only and kept at most 3 days. Watching a friend
works for tables and solo games, with a way to join when the game is live. The seasonal game is a **different game
each month**; it may be a slot machine, but then it must be special: its own effects and interesting gameplay, not a
reskin (October 2026 is a slot). Practice modes: as many as possible: blackjack, video poker, poker, craps and more.

### Stage 10 plan (agreed 2026-10-11; the user's answers: blackjack variants solo, horse racing a shared live
race, Teen Patti both against the dealer and at player-against-player tables)
1. ✅ Video poker (Bonus, Double Bonus, Joker) and six dealer card games (`19_table_poker.sql`).
2. ✅ (`20_blackjack_variants.sql`) Blackjack variants, all solo: Spanish 21, Blackjack Switch, Free Bet Blackjack, Pontoon. Quick games: Red Dog,
   Hi-Lo, Andar Bahar, Chuck-a-Luck.
3. ✅ (in `09_poker.sql`) Player-against-player poker in the 09 engine: Short Deck, Razz, 2-7 Triple Draw, Badugi.
4. ✅ (`21_racing_teen_patti.sql`) Horse racing as a live room (like Crash), and Teen Patti tables (player against player; a new betting engine).
   `supabase/maintenance/cleanup.sql` trims `race_rounds` and `tpt_hands` by name: keep those names and their
   `round_no` / `hand_no` / `phase` columns.

### Stage 9: what the user asked for (2026-10-11), delivered in parts, each committed and tested
1. ✅ **Admin and moderation** (`15_moderation.sql`): hidden `/admin` page for the account called Carter, reports,
   blocks, bans, timeouts, forced renames, chip changes, site notice. Profile page: the Leaderboards / Friends /
   Open locker buttons and the Tournaments pill were removed (the user's request).
2. ✅ (`16_missions_seasons.sql`) **Missions** (daily and weekly), **monthly season tracks** (first one Halloween, October 2026; rewards defined up
   to October 2027 but a season's rewards must be invisible and unearnable until its month starts, checked on the
   server; **a season's rewards are gone for good when it ends**), a **notification inbox**, **invite a friend to
   your table**.
3. ✅ (`17_clubs_records.sql`) **Clubs** (a typed name and tag, members, club leaderboard; preset chat only at first, typed chat since phase 11),
   **head-to-head records**, a **big-win ticker**, a **personal records** section on the profile page.
4. ✅ (`18_tournaments_plus.sql`) **Tournament leaderboard and trophies**, **multi-table tournaments**, **more tournament formats**, and quality of
   play: poker pre-action buttons, showing cards after everyone folds, slot auto-spin, a video poker strategy hint,
   favourite games and "continue where you left off", more emotes. **Not wanted:** music or sound options, installing
   as an app. Not asked for (skip unless they ask): lucky wheel, private tournaments, shareable wins, profile showcase,
   fairness page, play reminders.
Every part must come with its achievements, cosmetics and menu entries (standing request).

### Where things stand (2026-10-12)
Everything planned has been built: stages 1 to 11. Nothing is designed or agreed beyond this. The site has
**57 games** (15 table, 20 poker, 8 slots of which one is seasonal, 14 specialty; all released), **85 achievements**,
25 numbered SQL files making 74 tables (33 in Realtime), 23 SQL test files and 22 browser suites. Stages 12 and 13
are finished; nothing further is designed or agreed (the brainstorm of 2026-10-13 is listed below).

Stage 10's 23 games, for reference: Caribbean Stud, Casino Hold'em, Let It Ride, Mississippi Stud, Four Card Poker,
Teen Patti against the dealer (19); Bonus, Double Bonus and Joker video poker (11); Spanish 21, Blackjack Switch,
Free Bet Blackjack, Pontoon, Red Dog, Hi-Lo, Andar Bahar, Chuck-a-Luck (20); Short Deck, Razz, 2-7 Triple Draw,
Badugi (09); horse racing and Teen Patti tables (21).

### Ideas mentioned but never built (only if the user asks)
- From the brainstorm of 2026-10-13 (the user picked four, built as stage 13). Large: a solo career mode, a lounge
  of your own to decorate, club wars, a poker hand replayer, **house bots at empty poker tables** (my first pick),
  prestige after level 100, a daily seeded challenge, a watchable final table. Small: a session summary, a shareable
  win card, a fairness page, a statistics page, colour-blind and four-colour decks, "recently played with", private
  notes on opponents.
- Showing which solo game an online friend is in (only table seats are known to the server).
- A weekly reward for the weekly leaderboard.
- Auto-play for solo games other than the slots.
- A side show in Teen Patti; a simulation to measure the house edge of the stage 10 games (their paytables are the
  standard published ones).
- From the stage 9 brainstorm, not asked for: lucky wheel, private tournaments, shareable wins, profile showcase,
  fairness page, play reminders. **Not wanted:** installing as an app. (Music was not wanted at first; the user
  asked for it on 2026-10-12 and it is built, as a shuffled playlist with a theme for the seasonal slot: see §8.)

## 6. Repository map

```
.github/workflows/deploy-pages.yml   build + deploy to GitHub Pages on push to main (VITE_BASE from configure-pages)
public/                              favicon.svg (same ruby chip as ChipIcon), CNAME, _redirects, .nojekyll
index.html                           boot screen inside #root ("Shuffling up…", help text after 6 s)
vite.config.ts                       VITE_BASE base path, spaFallback plugin (404.html), manualChunks, @ -> src
scripts/check-copy.mjs               copy guard (currency symbols, banned words)
scripts/check-icons.mjs              every game in file 3 has its own icon in GameIcon.tsx, and no two are the same
scripts/test-sql.sh                  SQL test runner (also fails when check_database.sql is stale)
scripts/gen-db-check.sh              regenerates supabase/maintenance/check_database.sql (run after ANY SQL change)
scripts/e2e/                         local end-to-end harness: 22 suites (see §9)
supabase/sql/01…25_*.sql             the database, applied in order (see §7)
supabase/maintenance/                run by hand, not numbered, not applied by test:sql:
                                     check_database.sql (is the live database up to date? generated),
                                     cleanup.sql (frees space), maintenance_off.sql (opens a site closed for maintenance),
                                     two_step_off.sql (switches two-step verification off for the admin's own account),
                                     season_bonus_2026_10.sql, special_cosmetics.sql (the Developer items), email_logs.sql
supabase/tests/00_supabase_stub.sql  fake auth schema/roles for local tests ONLY
supabase/tests/NN_*_test.sql         23 test files: tests.ok / tests.throws helpers, run as role authenticated
supabase/email-templates/            confirm-signup.html, reset-password.html, verify-identity.html (+ subjects in README)
src/App.tsx                          routes: / signup login verify forgot-password how-chips-work terms privacy settings
                                     lounge lobby table/:id play/:gameKey join/:code
                                     profile profile/:username locker friends leaderboards clubs clubs/:id
                                     missions inbox tournaments tournaments/:id practice practice/:drill practice/learn/:lesson admin *
                                     Wrapped in MaintenanceGate; connectors for progress, account and live data.
src/lib/                             supabase client, errors (friendlyError), format, cards, sound (WebAudio),
                                     turnstile, validation, types, hotkeys (keyboard shortcuts), and per-game helpers: blackjack, roulette, craps, poker,
                                     slots (result types, symbol art, themes, and buildScenes: result -> playback),
                                     solo (useSoloGame, holdBalance/settleBalance, hand names, history lines),
                                     games (the four lounge sections; gameMode: tables / live room / solo / tournament; gameHref),
                                     progress (types, and what every cosmetic looks like: AVATAR_GLYPH, FRAMES, CARD_BACKS, FELTS),
                                     chat (quick-chat phrases), live (inbox wording), clubs, tournaments,
                                     quickstart (first-visit guides), vpHint (video poker hint)
src/stores/                          zustand: auth, wallet (balance, ledger, displayBalance), presence, settings, toast, ui,
                                     progress (own XP / achievements / loadout, the catalogues, other players' looks),
                                     account (sanctions, admin flag, blocks), live (missions, season, inbox),
                                     reputation (your own standing: may you chat?)
src/hooks/useLiveTable.ts            shared live-table plumbing (see §8); useBlackjackTable / usePokerTable wrap it
src/hooks/useLobby.ts                lobby table list + online presence
src/hooks/useTurnAlert.ts            flashes the tab title when it is your turn at a table in a background tab
src/components/hotkeys/HotkeyHost.tsx the one keyboard listener, the "?" list of shortcuts, and the Keys button
src/hooks/useChat.ts                 typed chat for one channel (chat_fetch / chat_send, a content-free realtime ping, a slow poll)
src/components/chat/ChatBox.tsx      the message list and input every typed chat uses
src/hooks/useLiveRoom.ts             a shared room with no tables or seats (Crash, Bingo, horse racing): polls its
                                     state RPC, listens to Realtime
src/components/table/                TableHeader, PlayerStrip, PhaseBar, TimerRing(+useSecondsLeft), ReactionBar,
                                     ChipStack, InfoModal(+TabButtons), GameHistoryModal, InviteModal, SeatAvatar (+SeatTitle),
                                     BetPresets (the Presets menu and its storage)
src/components/{blackjack,roulette,craps,poker}/   one folder per game; *Table.tsx is the entry (PokerTable plays all nine
                                     poker games and every tournament table)
src/components/teenpatti/            TeenPattiTable (its own engine; reuses PokerSeat and BringChipsModal)
src/components/slots/                SlotMachine (the entry, every machine), SlotReels, SlotSymbol, SlotRules, JackpotTicker,
                                     HauntedFx (the seasonal machine's scenery, lightning and multiplier meter)
src/components/solo/                 SoloShell (page frame, TierPicker, ChipRack, BetSpot, useSpotBets, BetStepper) and one
                                     file per game: Baccarat, VideoPoker (all five machines), ThreeCard, PaiGow, SicBo, Keno, Wheel
src/components/more/                 stage 6.5, one file per game: DragonTiger, CasinoWar, UltimateHoldem, Plinko, Mines,
                                     Scratch, PowerDraw, Crash, Bingo (they reuse SoloShell and its pieces)
src/components/tablepoker/           TablePokerGame: the six dealer card games of file 19
src/components/stage10/              BlackjackVariantGame (four variants), QuickGames (Red Dog, Hi-Lo, Andar Bahar,
                                     Chuck-a-Luck), HorseRacingGame
src/components/tournaments/          SngBar (the strip on a tournament table), TournamentRules, PrivateEvents
src/components/account/              AccountGate (suspended / timeout / rename screens), AppealBox, ReportModal, MaintenanceGate,
                                     TwoStep (two-step verification: the gate, "Verify your identity", the offer after sign-up)
src/components/admin/AdminTools.tsx  the admin page's Appeals, Chat and Stats tabs and the schedule panel
src/components/onboarding/           the welcome tour and QuickStart (first-visit guide per game)
src/components/lounge/GameGrid.tsx   the lounge's game list in four sections, each card tagged Live or Solo
src/components/lounge/FriendsStrip.tsx friends who are on the site now: join, watch or message from the lounge
src/components/progress/             ProgressCard (lounge), ProfileExtras, ReputationCard (own profile), and bits: LevelBadge, XpBar, PlayerLine
src/components/layout/               SiteHeader (top bar, inbox bell), SectionNav, footer, balance pill, MusicPlayer
src/assets/music/                    the music: a shuffled playlist and game themes, README and CREDITS.txt (see §8)
src/components/ui/GameIcon.tsx       one icon per game (`ICONS`, keyed by game key), built from shared Card / Die / Chip / Screen pieces
src/components/ui/Avatar.tsx         a player's picture and frame; src/components/table/SeatAvatar.tsx looks it up by user id
src/components/cards/PlayingCard.tsx PlayingCard + CardFan (sizes xs/sm/md/lg, highlight, still, delay; 52 = joker)
src/pages/                           one file per route: Profile, Locker, Friends, Leaderboard, Clubs, Missions, Inbox,
                                     Tournaments, Showdown (one slot showdown), Admin, and the auth and info pages
src/pages/{Terms,Privacy}Page.tsx    the Terms of Service and Privacy Policy (frame: components/legal/LegalDoc; facts: lib/legal.ts)
src/pages/TablePage.tsx              loads game_tables.game_key and dispatches to the right *Table component
src/pages/PlayPage.tsx               /play/:gameKey: dispatches every game that isn't played at a table
src/pages/LobbyPage.tsx              a picker with every game (by section); table games show quick join, private
                                     tables, join by code and live tables; the rest show a Play / Join the room panel
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
9. `09_poker.sql`: one engine, nine games (`pk_config(game)` → family board/stud/draw, limit nl/pl/fl).
   - Tables: `pk_hands`, `pk_players` (public), **`pk_hole` (RLS: own rows only)**, hidden `pk_decks`
     and `pk_topups`.
   - RPCs: `pk_state`, `pk_action(table, action, amount)` (`amount` = total "raise to" this street),
     `pk_draw(table, cards[])`, `pk_bring_chips`, `pk_advance`, `pk_hand_history`.
   - Rules covered: min raise, pot-limit max, fixed-limit cap of 4, short all-ins don't reopen the betting,
     uncalled bets returned (never to folded players), side pots, split pots (odd chip left of the button),
     hi-lo 8-or-better.
   - Timer 20 s → check if free else fold, then sit out; players who left or disconnected are acted for at once.
   - **Stage 10 added four games to the same engine** (`pk_config_game` holds each game, `pk_config` puts the shared
     defaults first). A game's `rank` says how hands compare, and **`private.pk_show(game, hole, board)` returns a
     score where higher always wins, the cards and the hand's name**, so pots and side pots need no changes:
     `short` (Short Deck: 36 cards via `deck: short`, a flush beats a full house, A-6-7-8-9 is a straight),
     `razz` (lowest five of seven; `pk_low_a5`; the highest up card brings in and the lowest showing hand acts
     first), `27` (2-7 Triple Draw: `pk_eval27`, aces high, A-2-3-4-5 is not a straight) and `badugi` (`pk_badugi`).
     Draw games take `draws` (3 for Triple Draw and Badugi): a draw follows every betting round but the last, and
     `drew` is cleared before each. Fixed-limit games played with blinds bet the big blind, then twice it
     (`pk_bet_unit`).
10. `10_slots.sql`: six solo machines and the shared jackpot. No tables, seats or timers.
   - `private.slot_cfg(game)` holds each machine's maths as JSON: per-reel symbol `weights`, `pays`, features.
     Every visible cell is drawn independently from its reel's weighted bag, **reel by reel, top to bottom**.
   - **Pays are in hundredths of the total bet ("units") and every value is a multiple of 10.** Bets must be
     multiples of 10, so `bet * units / 100` is always whole chips. Keep both rules when editing a paytable.
   - `slot_spin(game, bet)` is atomic: bet, all draws, the whole feature (free spins, hold-and-win respins,
     cascades), payout, `record_round`. It returns the full sequence and the browser replays it. There is
     **no session or half-played feature** on the server, by design.
   - Stake level = the lowest tier whose range contains the bet (`private.slot_tier`), then `assert_tier_access`.
   - `slot_info(game)` returns paytable, bets, tiers and jackpot, **never** `weights` / `heights` / pearl odds.
   - `jackpots` (pot kept in hundredths of a chip so 10-chip bets feed it; `amount` is a generated column).
     Grand Jackpot: 2% of each bet in, win chance = bet / 5,000,000 per spin, pays the pot, resets to 100,000.
     Ledger reason `jackpot`.
   - Tuned return: Lucky Sevens 95.8% (exact), Pharaoh 96.6, Gem Cascade 95.3, Wild Frontier 96.6,
     Dragon Pearls 95.3, Grand Jackpot 91.4 + 4.0 from the pot. After changing any weight or pay, re-measure
     with `select private.slot_simulate('slots_x', 1000000)` (about a minute; returns percent) and update the
     `rtp` in the config and the expected numbers in `supabase/tests/06_slots_test.sql`.
11. `11_solo_games.sql`: eight solo games against the house.
   - **One call:** `baccarat_deal(tier, bets)`, `sicbo_roll(tier, bets)`, `wheel_spin(tier, bets)`,
     `keno_draw(bet, picks)`. `bets` is JSON like `{"player": 100, "tie": 10}`; `private.solo_spots` checks every
     spot name against a regex and every amount against the stake level, and `private.solo_settle` takes the
     bets, pays and records.
   - **Two calls** with the player's decision in between: `vp_deal` / `vp_draw(game, holds[5])`,
     `tcp_deal(tier, ante, pair_plus)` / `tcp_act(play)`, `pgw_deal(tier, bet)` / `pgw_set(low[2] or null)`.
     The open round is one row in `solo_rounds` (`state` = what the player may see; unique per user and game)
     plus the **hidden** `solo_secrets` (rest of the deck, dealer's cards). It has **no timer**: it waits for the
     player, `private.solo_in_play` counts its chips, and the row is deleted when the round ends.
   - Stake level: multi-spot games take `p_tier` and each spot must be in range; single-bet games (video poker,
     keno) use `private.slot_tier` like the slots.
   - `solo_info(game)` returns `private.solo_cfg(game)` (paytables, shown as-is in the rules), tiers, bet steps
     and the open round.
   - Cards: 0..51 as everywhere, **52 = joker** (Pai Gow only). `private.cg_score5(ranks, suits)` is the
     five-card evaluator (category = value / 15^5, 9 = five aces); it takes ranks and suits, not cards, so the
     joker can be substituted. `private.tcp_score` is the three-card one (a straight beats a flush).
   - **Pai Gow house way** (`private.pgw_house_way`): every legal split is scored by how often its two hands
     beat the hands the same method produces; the two 50-entry tables in that function are those hands' 2%
     to 100% points, found with an offline simulation (house edge 2.7%). If the scoring or joker rules change,
     the tables need regenerating the same way.
   - Commissions (baccarat Banker, Pai Gow) are 5% **rounded up to a whole chip**, so chips stay whole.
   - Keno prizes are hundredths of the bet in multiples of 10, the same rule as the slots.
12. `12_more_games.sql`: nine more games. **Their `games` rows live in file 3**, so a new game here means editing
    both files; file 12 starts with a guard that raises if file 3 is stale.
   - Config in `private.more_cfg(game)`; the screen's info RPC is **`more_info(game)`** (same shape as
     `solo_info`; `useSoloGame(key, 'more_info')`). Single-bet games validate with `private.more_bet_tier`.
   - One call: `dragon_tiger_deal(tier, bets)` (ace low; a tie returns half, rounded down),
     `plinko_drop(bet, rows, risk)` (the slot is the number of right bounces; nine tables, each about 99%),
     `scratch_play(card, bet)` (prize drawn first from weights out of 100,000, then nine panels laid out to
     show it: exactly three of the prize, never three of anything else; all three cards return 94%),
     `power_draw_play(bet, picks[5], power)` (5 of 30 + 1 of 10; prize keys like `'3'` and `'3p'`).
   - Decisions, in `solo_rounds`: `war_deal(tier, ante, tie)` returns a finished result unless the cards tie,
     then `war_act(war)`; `uth_deal(tier, ante, trips)` then `uth_act('bet4'|'bet3'|'check'|'bet2'|'bet1'|'fold')`
     (the Blind always equals the ante; hands come from `private.pk_best` in file 9);
     `mines_start(bet, mines)`, `mines_pick(tile)`, `mines_collect()` (prize = fair odds less 3%, in
     hundredths of the bet, rounded down: `private.mines_units`).
   - **Live rooms** (one global round each, serialised with an advisory lock; rounds only advance when a
     client calls the state RPC, or from the lobby's stale tick):
     - Crash: `crash_state()` / `crash_bet(amount, auto)` / `crash_collect()`. betting 8 s → flying → crashed
       4 s. Multiplier = `exp(0.07 * seconds)`; crash point drawn at close of betting with
       P(point ≥ x) = 0.97 / x and kept in the hidden `crash_secrets`. A collect is priced at the **server's**
       clock when the call arrives. Automatic collects are paid by the tick as the flight passes them.
     - Bingo: `bingo_state()` / `bingo_buy(price, count)`. The first card opens a 20 s sale, then 40 of 75
       balls are drawn at once into the hidden `bingo_secrets` and **revealed by time** (`bingo_state` returns
       only the prefix called so far), then cards are paid by how early their first line completed
       (`private.bingo_units`), by the house, not from a pot. `bingo_cards` are readable by their owner only.
   - Both rooms define `private.<game>_tick_stale()` and `private.<game>_in_play(uuid)` like the table games.
13. `13_progression.sql`: XP, achievements, cosmetics, leaderboards, profiles, friends. **No game file knows
    about it.** It hangs off `private.record_round` (file 5) with two triggers:
   - `game_history` insert → `private.on_round_recorded`: XP (`private.round_xp`: 2 + sqrt(wager), ×1.5 for a
     win; **Plinko alone earns sqrt(wager) / 4 with no flat 2**, because ten-ball drops at a 99% return made XP
     nearly free: the user's fix, and the Plinko page says so), the counters in `player_progress.counters` (`private.round_counters` reads the round's `summary`
     for feats such as a jackpot, a royal flush or a cleared Mines field), and `weekly_stats`.
   - `player_game_stats` insert/update → `private.check_achievements`. It has to be this second trigger:
     `record_round` writes the history row **before** the stats, and most achievements read the stats.
   - **So a game gets XP and achievements for free as long as it calls `record_round`.** For a new feat, add a
     branch to `private.round_counters` keyed on something the game puts in its `summary`, and an
     `achievements` row whose `metric` is that counter.
   - Level L starts at `100 * (L - 1)^2` XP, capped at 100. An achievement is unlocked when
     `private.player_metrics(user) ->> metric >= goal` (the metrics are stats aggregates, wallet fields, the
     counters and the friend count).
   - `achievements.extra_cosmetics text[]` gives more prizes than the one `cosmetic_key` (used by the two rarest:
     **Grandmaster**, level 100, and **Completionist**, every other achievement, whose metric `all_achievements`
     is 1 once all the rest are unlocked). The locker lists these extras as locked teasers and tags season
     cosmetics "Seasonal · month year".
   - **Chip rewards are never paid automatically** (200 × level per new level; a fixed amount per
     achievement). They wait until `claim_rewards()`, so no round's own chip maths or returned balance
     changes, and the earlier tests' exact balances still hold. Ledger reasons `level_up` and `achievement`.
   - Cosmetics: the database knows only key, kind and unlock (`unlock_level`, or null = an achievement's
     `cosmetic_key` prize); the looks are in `src/lib/progress.ts`. A player owns every cosmetic at or below
     their level without a row; `player_cosmetics` holds only achievement prizes. `equip_cosmetic(key)`.
   - `leaderboard(board, friends)`: `level`, `chips`, `biggest_win`, `week` (net this week from `weekly_stats`,
     Monday to Sunday UTC, only people who played). `get_profile(username)` is public to signed-in players.
   - Friends are mutual (`friend_request` / `friend_respond` / `friend_remove`; asking someone who already
     asked you accepts). `friends_list()` includes the **public** table a friend is seated at ("Join their
     table" is just a link to `/table/:id`); for a private table only the fact is shown, never the id.
   - **One-of-a-kind cosmetics** exist only in the live database, not in this file (the SQL is kept in
     `supabase/maintenance/special_cosmetics.sql`): the user ran SQL that added
     `title_developer` ("Developer") and `avatar_developer` (the crown emoji) with no level and no achievement,
     and granted them to their own account (username Carter) in `player_cosmetics`. The locker hides such items
     from everyone who doesn't own them. `avatar_developer`'s emoji is in `AVATAR_GLYPH`; the level-15
     `avatar_crown` was renamed "Champion" with a trophy so the crown stays theirs alone.
   - The `achievements` and `cosmetics` rows are upserted, so editing the file and re-running it changes them.
     Removing one needs a `delete` by hand.

14. `14_tournaments.sql` (stage 8): `tournaments` + `tournament_entries` (public read, both in realtime).
   - **Sit & Go** (`sng_register(size, entry_fee)`, `sng_unregister`, `sng_status(table)`): when the last seat fills,
     `private.sng_start` makes a `poker_holdem` table with **`game_tables.play_money = true`** and seats everyone with
     1,500 tournament chips. `play_money` tables (handled in 05 and 09) never move wallet chips: stacks are not
     returned on leaving, no top-ups, no sitting out, no `record_round` per hand, not in `list_tables`, nobody can sit
     down, seats are never released for being away, and blinds come from `game_tables.stakes` (set per level by
     `private.sng_sync`, which also knocks players out and finishes the game; poker calls it after every hand).
     Leaving the seat = knocked out. The frontend keeps the seat on navigation (`keepSeat` in `useLiveTable`).
   - **Slot Showdown / Daily Freeroll** (`showdown_enter`, `showdown_spin`, `showdown_state`): rounds are created
     lazily by `private.showdown_ensure` (one per stake level per 15 minutes, one freeroll per UTC day) and settled
     lazily by `private.tourney_tick`. Spins use `private.slot_play` and move no chips; score = units won.
     Fewer than 2 entrants: void and refunded. All numbers live in `private.tourney_cfg()`.
   - `tournaments_state()` feeds `/tournaments`; `/tournaments/:id` is one showdown. One `game_history` row per
     player per tournament (`sng_poker` / `slot_showdown`, summary `{kind, place, players}`), which drives the eight
     tournament achievements in 13. Ledger reasons `tournament_entry`, `tournament_prize`.
   - The copy guard rejects the word "buy" even in identifiers, hence `entry_fee`.
   - **Standing request:** every new feature adds its achievements and cosmetic prizes (catalogues in 13, looks in
     `src/lib/progress.ts`) and its menu entries.

15. `15_moderation.sql` (stage 9 part 1): the admin and moderation.
   - **The admin is a row in the hidden `admins` table**, seeded once with the account whose username is Carter and
     tied to its id (so a rename can't hand it over). Every `admin_*` RPC starts with `private.require_admin()`
     and answers `not_admin` to anyone else. The `/admin` page had no link at first; since 2026-10-12 (the user's
     request) the top bar shows **Admin** after Profile, and the account menu too, **only when `my_account().admin`**.
     Everyone else sees no link and "Access not allowed" on the page; the page is a convenience, the server is the gate.
   - **Enforcement is one hook:** `private.require_uid()` (05) and the three economy RPCs (02) call
     `private.sanction_check(uid)` if it exists, which raises `account_banned`, `account_timeout` or
     `rename_required`. So a sanction stops every game at once and new games need nothing extra, as long as their
     RPCs start with `require_uid()`. `my_account()` and `change_username()` deliberately skip it.
   - `player_sanctions` (own row readable, in realtime), `player_blocks` (own rows), `player_reports`, `admin_log`
     (both hidden), `site_notice` (one row, shown under the top bar). A block removes the friendship and a trigger
     on `friendships` refuses new requests either way; the client also hides a blocked player's emotes.
   - Admin RPCs: `admin_overview`, `admin_reports`, `admin_resolve_report`, `admin_find_players`, `admin_player`,
     `admin_ban` / `admin_unban`, `admin_timeout(user, minutes)` (0 ends it), `admin_rename(user, name or null)`
     (null = replace the name with `Player_xxxxxx` and set `must_rename`), `admin_chips(user, 'add'|'set', amount)`
     (through `apply_chips`, ledger reason `admin_adjust`), `admin_kick`, `admin_set_notice`. A ban or timeout also
     takes the player off their table. All actions go to `admin_log`.
   - **A removed name can't be chosen again:** a forced `admin_rename` remembers it in `player_sanctions.removed_name`
     and `change_username` refuses it in any capitals. **Notes on a player's file:** the hidden `player_notes`,
     `admin_file_note_add(user, note)` / `admin_file_note_delete(id)`, returned by `admin_player` as `notes`; only the
     admin ever sees them (the name `admin_note` was taken by the log writer in `private`).
   - **Site maintenance:** `site_status` (one row, readable by anyone, in realtime), `site_status()` (callable signed
     out) and `admin_set_maintenance(on, message)`. While on, `private.sanction_check` refuses every game call from
     anyone but the admin (`site_maintenance`), and `MaintenanceGate` (wrapping everything in `App.tsx`) shows only
     the maintenance page to everyone else, **including the login page**: the admin must already be signed in.
     `supabase/maintenance/maintenance_off.sql` switches it off by hand if the admin is locked out.
   - **Two-step verification (2026-10-13, the user's request):** an emailed 6-digit code after the password, at
     every login, **off unless the player switches it on**. The hidden `player_security` holds the switch.
     **The server is the gate:** Supabase Auth writes how a session was made into the token's `amr` claim
     (`password`, or `otp` once a code from an email was entered: the sign-up code, a reset code or this one), and
     `private.session_verified()` reads it. `private.sanction_check` and `private.require_admin` raise
     `verify_required` while `private.two_step_pending(uid)` (on, and the session has only the password).
     `set_two_step(on)` needs a verified session **both ways**: on, so nobody is locked out by an inbox that never
     gets the codes (the user's school address blocks them); off, so a password alone cannot remove it.
     `my_account()` returns `two_step`, `verified`, `verify_required`. `admin_two_step_off(user)` (logged) is for a
     locked-out player; `supabase/maintenance/two_step_off.sql` for the admin. The code is sent with
     `signInWithOtp({ shouldCreateUser: false })` (the dashboard's **Magic Link** template =
     `verify-identity.html`) and checked with `verifyOtp({ type: 'email' })`, which replaces the session.
     Frontend, all in `src/components/account/TwoStep.tsx`: `TwoStepGate` (inside `RequireAuth` and around `/admin`)
     shows **"Verify your identity"** while a code is owed, and once, right after the sign-up code, **"Secure your
     account?"** (a `sessionStorage` flag set by `VerifyEmailPage`); `IdentityCodeForm` sends and checks a code
     (one automatic send, not repeated by a reload within 10 minutes). After a code is entered `useAccount.bump()`
     raises `epoch`, which re-mounts the data connectors in `App.tsx`: their first calls were refused. The switch is
     in Settings → Account; from a password-only session it asks for a code first. Accounts older than the feature
     got one inbox notice (`two_step_available`, sent once by file 15; `player_security.announced_at` is the record).
     **Limits, by design:** direct table reads allowed by RLS (own balance, profile) and the few RPCs that skip
     `require_uid()` still answer a password-only session, as they do for a banned one; nothing can be played or
     changed. Supabase's **Secure email change** must stay on, or the password alone could move the account's email.
     **No achievement:** Completionist must stay reachable for a player whose mail provider blocks the codes.
   - Frontend: `useAccount` (`src/stores/accountStore.ts`), `AccountGate` inside `RequireAuth` (the suspended /
     timeout / choose-a-new-name screens), `ReportModal`, Block and Report on other players' profiles, the blocked
     list on the Friends page, `src/pages/AdminPage.tsx`.

16. `16_missions_seasons.sql` (stage 9 part 2): missions, seasons, the inbox, table invites.
   - **Missions:** `private.mission_pool()` (kinds: rounds, wins, wager, category, games, multiple, net, tourney).
     Each player is dealt **one easy, one medium and one hard** mission a day and the same each week (slots 1 to 3;
     the tier is in `meta`), picked within each tier by a hash of player and date (`private.missions_deal`), into
     `player_missions`. Season points are fixed by tier so the totals never change: 7 + 10 + 13 = 30 a day and
     30 + 40 + 50 = 120 a week (the user's numbers). A second trigger on `game_history`
     (`private.on_round_missions`) moves them along, so **every game counts with no changes**. Rewards (chips, XP,
     season points) wait for `missions_claim()`, like every other reward. Ledger reason `mission`.
   - **Seasons:** `private.season_cfg()` lists 13 monthly seasons, October 2026 to October 2027, each with a title,
     an avatar, a card back or felt, and a frame, on a ten-step track (`private.season_tiers`; 1,000 points; points
     come only from missions). **Secrecy and timing are enforced on the server:** the config is a private function,
     a season's cosmetics are inserted into `cosmetics` (with their `look` JSON and `season`) only by
     `private.season_sync()` once its month has begun, and `missions_state` / `season_claim` only read the month of
     `private.live_now()`. Points only go to the current month. When a month ends, `private.season_settle` hands
     over the steps a player had reached and the rest is gone (the user's choice). Ledger reason `season_reward`.
     (The repo is public, so the list can be read in this file; it cannot be seen or earned in the app.)
   - `private.live_now()` is the clock for all of it; the tests replace it to travel between months.
   - A player's `player_seasons` row doubles as the record that they were told a season opened (created in
     `missions_state`); the notification itself can be cleared, so it must not be the record.
   - `supabase/maintenance/season_bonus_2026_10.sql` (run by hand, once): 333 points for every account that
     exists or is created before November 2026 (UTC), tracked in the hidden `season_gifts` table, with a trigger on
     `profiles` for new sign-ups. Not part of the numbered files, so `test:sql` does not apply it.
   - Because season cosmetics can't be built into the app, `cosmetics.look` carries their look and
     `registerLooks()` in `src/lib/progress.ts` adds them to `AVATAR_GLYPH` / `FRAMES` / `CARD_BACKS` / `FELTS` when
     the catalogue loads. The locker already hides cosmetics with no level and no achievement from non-owners.
   - **Inbox:** `notifications` (own rows, realtime, newest 60 kept), written by `private.notify(user, kind, data)`
     from triggers: friend request and answer, achievement unlocked, tournament result (from the `game_history` row),
     season start and end, table invite, a moderator's chip change. Never free text: the client words each kind in
     `inboxText()` (`src/lib/live.ts`). RPCs `inbox`, `inbox_read`, `inbox_clear`.
   - **Invites:** `invite_friend(user)`: you must be seated (not at a tournament table), they must be a friend, once
     a minute each. A private table's code travels in the notification. The friend gets a toast with a Join link.
   - Frontend: `useLive` (`src/stores/liveStore.ts`), `/missions` (season track + missions), `/inbox`, `MissionsCard`
     on the lounge, the bell in the top bar (wide screens; the account menu on phones), `InviteModal` behind an
     Invite button in `TableHeader`. Counters for achievements are bumped with `private.bump(user, key)`.

17. `17_clubs_records.sql` (stage 9 part 3): clubs, head-to-head, the big-win ticker, personal records.
   - **Clubs:** `clubs` (name 3 to 24 letters/numbers/spaces, tag 2 to 5, one of twelve preset emblems, open or
     invite only, a 6-character code whose column clients cannot select; `code_visible` lets the owner keep it from
     other members, and the club page hides it behind a Show button like a password) and `club_members` (**one club per
     player**, 50 per club, roles owner / officer / member). RPCs `clubs_list`, `club_state`, `club_create`,
     `club_join(club or code)`, `club_leave`, `club_kick`, `club_set_role`, `club_update`. An owner who leaves hands
     over to the longest-serving officer, then member; the last member leaving deletes the club. Clubs are ranked
     by rounds their members played this week. Club chat is typed chat (channel `club:<id>`, file 22) plus a broadcast channel of the preset phrases, which are not stored. Admin: `admin_clubs`,
     `admin_club_rename`, `admin_club_delete` (a Clubs tab on `/admin`).
   - **Head to head** (`head_to_head`, hidden): a third trigger on `game_history` (`private.on_round_records`)
     pairs up the rows of one poker hand (same `round_id`; ahead beats behind) and of one Sit & Go (lower place
     beats higher). Each pair is settled when its second row arrives.
   - **Ticker** (`big_wins`, newest 40, realtime): a round paying 25 times the bet and at least 2,500 more than
     it cost, or a tournament win of 1,000 or more. `big_wins_recent()` joins the current username.
   - `profile_extras(username)`: club, personal records (from counters, stats and wallets), `versus` (you against
     them, other profiles only) and `rivals` (your own only). The profile also charts your own last 100 ledger
     balances.
   - `private.is_banned(uuid)` (in 13, guarded so it works before 15 exists) keeps banned players off the
     leaderboards and the ticker.
   - Frontend: `/clubs` and `/clubs/:id` (`ClubsPage`), `ProfileExtras`, `BigWinTicker` on the lounge.

18. `18_tournaments_plus.sql` (stage 9 part 4), with matching edits in 13 and 14.
   - **Sit & Go formats** (in 14): `tournaments.variant` = `standard`, `turbo` (60 s levels) or `omaha` (a
     `poker_omaha` table). `sng_register(size, entry_fee, variant)`; `private.sng_level(started, seconds)`.
   - **Main Event** (multi-table, kind `mtt`): one every 30 minutes (`private.mtt_ensure`), entry 1,000, 3 to 18
     players on tables of 6 listed in `tournament_tables`. `mtt_register` / `mtt_unregister` / `mtt_state`.
     At the start time `private.mtt_start` seats everyone or voids and refunds. `private.mtt_sync(tournament,
     table)` is called after every hand (14's `sng_after_hand` forwards to `private.mtt_after_hand`) and from
     `mtt_poke(table)`, which browsers at an idle event table call every 3 s. **A table only ever changes itself**
     (its blinds, moving its own players to other tables, closing itself) and only between hands; every caller
     holds its own table's lock, then one advisory lock per event, never a second table's lock, so there are no
     deadlocks. It merges when the players left fit the other tables, and sends one player to the smallest table
     when it is two or more ahead. Payouts by field: up to 6 pay 65/35, up to 12 pay 50/30/20, up to 18 pay
     45/27/18/10. History rows use game `sng_poker` with summary kind `mtt`.
   - `tourney_status(table)` is the strip for any tournament table (it returns `sng_status` or the event's, with
     `my_table` so a moved player's browser can follow its seat). One poker tournament at a time per player.
   - **Trophies:** `player_trophies` (kind, place 1 to 3, count), from a fourth trigger on `game_history`; second
     place needs a field of three, third a field of four. `trophies_for(username)`. The leaderboard (13) has a
     `tournaments` board (tournaments won).
   - **`pk_show(table)`:** a dealt-in player may reveal their cards for a few seconds after a hand ends.
   - Client-only quality of play: poker "Check / fold" and "Check" decided in advance (`PokerTable`), slot
     auto-spin for 10 / 25 / 50 spins (`SlotMachine`; it never stops for a win, the user's choice: only when the
     count or the chips run out, or Stop is pressed), a video poker Hint
     (`src/lib/vpHint.ts`: a priority list, close to but not perfect play), favourites and "Jump back in" on the
     lounge (kept per device in the settings store; `QuickStart` notes each game opened), sixteen emotes
     (appended, because emotes travel as list positions).

19. `19_table_poker.sql` (stage 10 part 1): Caribbean Stud, Casino Hold'em, Let It Ride, Mississippi Stud, Four
    Card Poker and Teen Patti (against the dealer), **on one engine**. Their `games` rows are in file 3.
   - `tp_deal(game, tier, bets)` then `tp_act(game, action)` until the returned state has `final: true`. The open
     hand is a `solo_rounds` row; **`state.actions` lists what the player may do next and what each costs**
     (`private.tp_actions`), so the browser holds no rules. `game_info(game)` has the paytables (`private.tp_cfg`)
     and any hand left open. One React component serves all six: `src/components/tablepoker/TablePokerGame.tsx`
     (`LAYOUTS[game]` = card counts, spot labels and rules text; `useSoloGame(key, 'game_info')`).
   - Evaluators: `private.tp_score5` (five cards, via `cg_score5`), `private.fc_best` (best four of five or six;
     three of a kind beats a flush beats a straight), `private.tpt_score` (Teen Patti: trail, pure sequence,
     sequence, colour, pair; A-K-Q then A-2-3 lead), and `private.pk_best` from file 9 for Casino Hold'em.
   - Let It Ride takes three bets up front and returns a pulled-back bet at once with ledger reason `refund`; only
     the bets left riding count as wagered. Elsewhere later bets are taken as they are made.
   - Payouts are the standard published paytables; house edges were **not** measured by simulation here.
   - Video poker's three new machines are in file 11: `private.vp_eval` gained Bonus / Double Bonus (four of a
     kind paid by rank: `four_aces`, `four_low`) and Joker Poker (53 cards from `private.pgw_deck()`, joker = 52,
     best of the 52 substitutions, kings or better). The Hint button uses the Jacks or Better list for the bonus
     machines and is hidden on Joker Poker.

20. `20_blackjack_variants.sql` (stage 10 part 2). Their `games` rows are in file 3; config in `private.s10_cfg`;
    info RPC `quick_info(game)` (`useSoloGame(key, 'quick_info')`).
   - **Four solo blackjack variants on one engine** (the multiplayer tables in 06 are untouched):
     `bjv_deal(game, tier, bet)` then `bjv_act(game, action)`; `state.actions` lists the choices and their cost, as
     in 19. A hand has a `stake` (the player's chips) and a `free` amount (chips the house put up): a win returns
     `stake * 2 + free`, a push the stake. Rules are flags in the config: `no_tens` and `player_21_wins` and
     `bonuses` (Spanish 21), `two_hands` and `push_22` and even-money blackjack (Switch), `free` and `push_22`
     (Free Bet: free doubles on hard 9 to 11, free splits except tens), `pontoon` (both dealer cards hidden, no
     standing below 15, dealer wins ties, pontoon and five-card trick pay 2 to 1, cards may still be taken after
     doubling). The dealer peeks for blackjack with an ace or ten showing; no insurance.
     One React component: `src/components/stage10/BlackjackVariantGame.tsx`.
   - **Pontoon's word for doubling is banned by the copy guard**, so the button says "Double".
   - **Red Dog** (`reddog_deal`, `reddog_act`), **Hi-Lo** (`hilo_start`, `hilo_guess`, `hilo_collect`; multiples in
     hundredths, always multiples of 10, fair odds less 3% rounded down), **Andar Bahar** (`andar_bahar_deal`;
     Andar pays 1 to 1 less a 10% commission rounded up), **Chuck-a-Luck** (`chuck_roll`). Screens in
     `src/components/stage10/QuickGames.tsx`.
   - As in 19, the payouts are standard ones and house edges were not measured by simulation.

21. `21_racing_teen_patti.sql` (stage 10 part 4). Their `games` rows are in file 3.
   - **Horse racing** (`horse_racing`, a live room built like Crash: `private.race_tick`, an advisory lock, rounds only
     move when someone calls `race_state()` or from the lobby's stale tick). betting 25 s → racing 12 s → done 7 s.
     `private.race_cfg()` has three "fields" of six chances (out of 100); a race takes one and deals the chances out at
     random with six names. A bet returns `92 / chance` in hundredths of the bet, rounded down to a multiple of 10;
     Place (first or second) is priced from the chance of finishing in the first two. `race_bet(horse, kind, amount)`:
     up to six bets a race, one Win and one Place per horse, amounts in multiples of 10.
     **The finishing order is drawn only when betting closes** (`private.race_draw`: each place goes to a horse still
     running, by its chance) and is then public in `race_rounds.result`: there is no secrets table because nothing is
     known while bets are open. Winnings are paid when the race ends, so the balance never gives the result away
     early. The browser only draws the race: `progress()` in `HorseRacingGame.tsx` turns the order into lane positions
     with a wobble seeded from the round id, so every browser shows the same race. One `game_history` row per player
     per race (summary `picked_winner`, `win_units`, `hits`).
   - **Teen Patti tables** (`teen_patti_live`, its own small engine, not `pk_*`; uses the `poker` stake profile, the
     **boot is the big blind**). `tpt_hands`, `tpt_players` (public) and the **hidden `tpt_cards`**: `tpt_state` returns
     a player's own cards only once `seen` is true, and everyone's at a showdown (`shown_cards`).
     `tpt_action(table, 'see' | 'pack' | 'bet' | 'raise' | 'show')`: `see` works at any time while you are in; the rest
     on your turn. `stake` is what a blind player pays to stay; a seen player pays twice it. A raise doubles the stake,
     up to `max_stake` (8) boots. Show: only with two players left, costs one bet, and **the player who asked loses a
     tie**. A player who cannot cover a bet may put in what is left and show, which turns everyone's cards over. At
     `pot_limit` (200) boots in the pot everyone shows; equal hands then share. Top-ups only between hands (there is
     no waiting top-up as in poker). There is **no side show**. Timeout = pack and sit out, as in poker.
     Hands rank with `private.tpt_score` from file 19. The seats are drawn by `PokerSeat` (the state is shaped to
     fit it); the screen is `src/components/teenpatti/TeenPattiTable.tsx`. Head-to-head records (17) count these hands.

22. `22_reputation_chat.sql` (phase 11): reputation and typed chat. **All numbers are in `private.rep_cfg()`** and are
    the user's (some adjusted with them on 2026-10-12).
   - **Reputation** (`player_reputation`, own row readable, in realtime; `reputation_log`, own rows, newest 50): 0 to
     100, start 50. **`private.rep_change(user, delta, reason, note, set)` is the only way it changes**: it logs,
     strips cosmetics, bumps the `reputation_best` counter (the two achievements) and notifies (not for small gains).
     - Up: +1 per 25 clean typed messages (3 chars or more, not a repeat), at most 3 a day. Below 50 only: +2 on each
       day a round is played, up to 50 (a fifth trigger on `game_history`), so a chat-banned player can recover.
     - Down: the chat filter (first catch of a UTC day is a warning with no loss, then 25 each), `admin_warn` 25,
       a report judged false 10 from the reporter (`admin_report_false`), and, **through a trigger on `admin_log`** so
       file 15 is untouched: rename 50, timeout under a day 50, under a week 75, a week or more or a ban: to 0.
     - **30 or less: no typed chat. 20 or less: no quick chat either** (the user first said 40 and agreed to 30, since
       one penalty from 50 lands on 25). `admin_chat_ban(user, 'chat'|'quick', minutes | null = until lifted | 0)`
       switches either off whatever the reputation, with a `reason` the player is shown (`chat_ban_reason` /
       `quick_ban_reason`); `admin_reputation(user, 'add'|'set', amount, note)`. **Which notes a player sees:** the
       reason of an `admin_warn` (on their reputation card and in the inbox) and of a chat ban. The note on a
       points change is the admin's own. The admin's reputation panel has its own reason box for all three.
     - Only the player (`my_reputation()`, the card on their own profile) and the admin (`admin_reputation_view`) see it.
   - **Reputation cosmetics** (catalogue in 13): `cosmetics.min_reputation` (75: Well-Mannered, Good Standing; 100:
     Pillar of the Lounge, Dove, Exemplary). `private.owns_cosmetic` counts them as owned only **while**
     `private.reputation_of(user) >= min_reputation`; `private.rep_strip` takes them out of the loadout the moment the
     reputation drops. A row in `player_cosmetics` (what `special_cosmetics.sql` gives Carter) keeps one for good.
     The achievements (`rep_75`, `rep_100`) are permanent and carry no cosmetic. 13 defines placeholder
     `reputation_of` / `quick_muted` functions that 22 replaces, so 13 still runs on its own.
   - **Typed chat**: `chat_send(channel, text)` and `chat_fetch(channel, after)`. Channels: `table:<id>` (anyone who can
     see the table reads, only seated players write), `club:<id>` (members), `room:crash|bingo|horse_racing`.
     **`chat_messages` is a hidden table: clients have no access at all.** Who may read is decided inside `chat_fetch`
     (which also leaves out players you blocked), so no RLS policy needs a private function. Realtime carries only a
     content-free broadcast ping (`chat:<channel>`, event `new`) telling browsers to call `chat_fetch`; a poll (4 s
     with the chat open, 12 s shut) covers a missed ping and the local e2e harness.
     - **3 seconds between messages for everyone, enforced in `chat_send`** (`slow_down`); 200 characters; kept 3 days
       (`chat_send` deletes older ones; `cleanup.sql` too). Tables and rooms show the last 2 hours, clubs all 3 days.
     - **The filter** (`private.chat_filter`): swear words from `private.chat_words()` matched as whole words after
       undoing number-for-letter swaps, starred out and delivered (`raw` keeps what was typed, for the admin);
       advertising (links, addresses, "follow me", "my channel") and spam (the same message a third time in two
       minutes, seven messages in half a minute, a character repeated 12 times) are stored `hidden` and not delivered.
     - `chat_report(message)` files an ordinary report with the message (as typed) in its `context`.
   - **Quick chat** stays a client broadcast, so its limits are in the browsers: the sender's (`canQuickChat()`,
     `CHAT_GAP_MS` = 3 s) and every receiver's (`loadouts_for` returns `quick_muted`, and `useLiveTable` drops reactions
     from muted players). Club quick phrases are only checked on the sender's side.
   - Frontend: `useReputation` (`src/stores/reputationStore.ts`, connector in `App.tsx`), `useChat`, `ChatBox`,
     `ReactionBar` (a "Type" tab when given a `channel`, an unread badge and a short preview of new messages),
     `SoloShell`'s `chat` prop (the room chat in Crash, Bingo and horse racing), `ClubChat`, `ReputationCard`,
     the locker's "Reputation N+" tag, and "Reputation and chat" in the admin's player panel plus "Warn" and
     "False report" on each report.

25. `25_admin_tools.sql` (stage 12 part 4), with scheduling in 15.
   - **Scheduled notices and maintenance (in 15):** the hidden `site_schedule` (kind, message, `starts_at`,
     `ends_at`, `cancelled_at`). **Nothing runs at those times.** `private.site_now()` answers from the clock:
     maintenance is on when the hand switch is on *or* a maintenance row's window is open; the notice is an open
     notice row's message, else the hand-set one. `sanction_check`, `site_status()` and `my_account()` all read it,
     so a closure starts and ends on the server whether or not any browser is watching. `site_status()` also
     returns `until` and `upcoming` (a closure starting within a day): `MaintenanceGate` re-asks at those moments
     and shows a gold warning strip during the last hour. `admin_schedule_add(kind, message, starts_at, ends_at)`
     (a notice needs an end; a closure with none lasts until switched off), `admin_schedule_cancel(id)`,
     `admin_schedule()`. `admin_set_maintenance(false)` and `maintenance_off.sql` also end a running window.
   - **Site statistics:** `admin_stats(days)` (up to 60): totals, one row per UTC day (new players, players who
     played, rounds, chips bet and paid back), every game of the last 7 days with its actual return, the ledger by
     reason, the ten largest balances. Read-only; `cleanup.sql` trims the history it reads.
   - **Chat log search:** `admin_chat_search(query, player, kind, before)` over the hidden `chat_messages` (so only
     the 3 days that are kept): words as delivered or as typed, a username, and kind `all | table | club | room |
     dm | caught | hidden`; 100 a page. **Every search is written to `admin_log`** (`chat_search`).
   - **Appeals:** the hidden `player_appeals`. `private.appeal_kind(user)` = `ban`, `timeout`, `chat` (cannot type or
     cannot quick chat, by ban or by reputation) or null. `my_appeal()` and `appeal_submit(text)` use `auth.uid()`
     directly and **skip the sanction check on purpose** (they are for locked-out players, and work during
     maintenance too). One open appeal per player; after a refusal, 3 days before another. `admin_appeals(status)`,
     `admin_appeal_resolve(id, accept, reply, lift, reputation)`: accepting with `lift` calls `admin_unban` /
     `admin_timeout(…, 0)` / `admin_chat_ban(…, 0)` for what was appealed, and `reputation` sets the number (a ban
     takes it to 0, and at 30 or less chat stays off). The player gets `appeal_answer` in the inbox.
   - Frontend: `src/components/admin/AdminTools.tsx` (tabs Appeals, Chat, Stats; `SchedulePanel` on Overview),
     `AppealBox` on the suspended and timeout screens and on the reputation card when chat is restricted.
   - No achievements or cosmetics came with this part: it is moderator tooling, and a prize for appealing would be
     perverse. (The standing request was considered, not forgotten.)

24. `24_events.sql` (stage 12 part 3), with the seasonal game in 03 and 10 and the season missions in 16.
   - **Private tournaments and club events (24, with columns in 14):** `tournaments.host`, `invite_code`, `club_id`.
     **`invite_code is not null` is what marks one** (the host column empties if the host's account goes), and
     clients cannot select that column (column grants in 14; `events_state()` gives the code to the people already
     in it). `sng_private_create(size, entry_fee, variant, club)` (the host takes the first seat; fees from
     `private.events_cfg()`, 0 allowed; one waiting per host and per club; a club event needs an owner or officer and
     3 or 6 players, and notifies the members with `club_event`), `sng_private_join(code)` or
     `sng_private_join(null, tournament)` for a member of the club, `sng_private_cancel`, and the ordinary
     `sng_unregister` for guests (the host must cancel). Unfilled after 2 hours: void and refunded
     (`private.events_sweep`, run from these RPCs). Once full it is an ordinary Sit & Go from `private.sng_start`.
     Its history row has `private: true` (and `club: true`): **13 gives no `tourney_wins` / `sng_wins`, 18 no trophy,
     16 no tournament-mission credit**, because they are played among friends. Counters `tournaments_hosted` (bumped
     for the host when one starts) and `club_event_wins` (three or more players) drive the achievements `host_first`
     and `club_event_win` (titles The Host, Club Champion). The public queue, list and "being played" skip them.
     Frontend: `PrivateEvents` on the Tournaments page (`/tournaments#events`).
   - **Seasonal games (03, 10):** `games.season` ("2026-10", null = always open) and `private.game_in_season(game)`.
     `slot_spin` raises `game_not_open` out of season and `slot_info.released` turns false; the lounge and lobby hide
     such games (`inSeason` in `src/lib/games.ts`) and the lounge shows the current one in a banner. A seasonal game
     is left out of the "play every game" metric and **has no achievements** (Completionist must stay reachable
     after its month). A seasonal game that is not a slot needs the same `game_in_season` check in its own RPCs.
   - **Haunted Manor (`slots_haunted`, October 2026):** a `lines` machine with two extras in the engine. `haunt`
     (`odds`, `cells`): after the reels stop, one spin in `odds` has 2 to 4 cells on **reels 2 to 5** turned wild
     (never reel 1: a line is read from its first symbol, so a wild there pays nothing) and the result carries
     `before` and `haunted`. `free.mult_step` / `mult_max`: the free-spin multiplier climbs by one after every
     winning free spin (each free spin carries its `mult`). **Every spin draws one extra random number for the
     haunting right after its grid**, which matters when rigging tests. Return 94.9% measured over six million spins
     (it swings a lot between runs of a million because of the multiplier). `slot_info` blanks `haunt`.
     Frontend: `HauntedFx.tsx` (backdrop of moon, bats, fog and cobweb; `Lightning`; `MultiplierMeter`), scene fields
     `haunted`, `mult`, `multAfter`, `fx` and the `haunt` entrance in `buildScenes` / `SlotReels`, sounds `thunder`,
     `ghost`, `bell`, CSS classes `haunt-*` in `index.css`.
   - **Season missions (16):** `private.season_game_cfg()` maps a month to its game and three missions (period
     `season`, kinds `g_rounds`, `g_wins`, `g_feat` with `meta.feat` = the round summary's `feature`; 60 + 100 + 140
     points). Dealt by `missions_ensure` once the month has begun, moved by the same trigger, and **only collectable
     during their month**. `missions_state` returns them with `season_game`. A month with no entry has none.
   - **Practice has two sections** (the user's request): **Learn to play**, walkthroughs in `src/lib/lessons.ts`
     (`LESSONS`: blackjack, Hold'em, craps, roulette, baccarat, video poker). A step has text, an optional scene
     (cards, dice, a roulette pocket, facts) and an optional "Your move" that must be answered correctly to go on;
     a wrong pick explains itself. Progress is kept per device (`lesson:<key>`). **The rules they state are this
     site's** (payouts, 3× odds, the field's 2 and 12, the 5% commission, 20-second timers): change a game's
     rules and its walkthrough must change too. And **Drills**:
   - **Practice (no SQL):** `src/lib/practice.ts` (`DRILLS`: blackjack basic strategy, video poker holds through
     `vpHint`, Hold'em showdowns, pot odds, craps bets, roulette payouts, baccarat's third card) and
     `src/pages/PracticePage.tsx` (`/practice`, `/practice/:drill`). Nothing is bet, nothing reaches the server, the
     score is kept per device with `useRemembered`, and so **practice earns nothing** (no XP or achievements: the
     server could not check them). Linked from the lounge header and the account menu.

23. `23_social.sql` (stage 12 part 2), with the other two thirds of that part in 05 and 22.
   - **Waiting rooms (in 05):** `game_tables.waiting`. `create_table(game, tier, private, variant, hosted)`: a private
     table opened with `hosted` waits. While it does, `private.assert_table_started(table)` (called first thing by
     `bj_place_bet`, `rl_place_bet`, `cr_place_bet`) raises `table_waiting`, and `pk_start_hand` / `tpt_start_hand`
     deal nothing. `table_start(table)`: the host (`created_by`), or anyone seated once the host has left; it then
     ticks poker or Teen Patti so the first hand is dealt at once. **A new table game must add one of these gates.**
     Frontend: `WaitingRoom` (a banner above the table in `TablePage`, reading `game_tables` directly) and a
     checkbox in the lobby's private-table popup (on by default).
   - **Direct messages (in 22):** friends only, same table, filter, reputation rules and 3 days as all chat.
     The browser names a conversation `dm:<the friend's id>`; `private.chat_channel` stores it under one name for
     both sides (`dm:` + md5 of the two ids). `chat_allowed` requires an accepted friendship and no block either way.
     `chat_fetch` on a `dm:` channel marks it read (hidden `dm_reads`); `dm_threads()` lists conversations with unread
     counts. Clean direct messages do **not** earn reputation. The moderator can read them like any chat (the
     Privacy Policy says so). Frontend: `useDm` (unread count, a toast for a new message), `DmModal` on the
     Friends page (`/friends?dm=<id>` opens one), and `useChat` pairs the two browsers on a shared ping channel.
   - **What friends are playing, and watching (23):** `PlayPage` reports the open game with `set_activity(game)`
     (on open, every 45 s, and null on close) into the hidden `player_activity`. `friends_activity()` gives the
     games friends have open (within 100 s); `friend_watch(user)` gives that friend's rounds at the game they
     have open (last 15 minutes, 15 at most) and any **public** table they sit at. `set_watchable(false)` hides
     all of it. Watching a table is just visiting it: anyone who can see a table can watch, and sit if there is
     a seat. Frontend: `WatchModal` (polls every 3 s; "Play it too" / "Join the room" / "Watch the table" /
     "Join their table") and the switch on the Friends page.

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
  Today: `bj_shoes`, `bj_secrets`, `rl_secrets`, `pk_decks`, `pk_topups`, `solo_secrets`, `crash_secrets`,
  `bingo_secrets`, `tpt_cards`, `chat_messages`, `dm_reads`, `admins`, `player_reports`, `admin_log`,
  `player_activity`, `player_notes`, `head_to_head`, `site_schedule`, `player_appeals`, `player_security`.
- **Each file ends with** `revoke execute on all functions in schema private from public, anon, authenticated;
  grant execute on function private.can_view_table(uuid) to authenticated;`. `private` must NOT be added to
  the Data API's exposed schemas.
- Seed persistent house tables with `insert … where not exists`; flip `games.released = true` in the
  game's own file.
- Ledger reasons used so far: `signup_bonus`, `daily_bonus`, `refill`, `bet`, `payout`, `refund`, `push`,
  `table_chips_in`, `table_chips_out`, `poker_pot` (Teen Patti tables too), `jackpot`, `level_up`, `achievement`,
  `mission`, `season_reward`, `tournament_entry`, `tournament_prize`, `admin_adjust`. Solo games use `bet` and `payout` only (a returned
  stake is part of the `payout`). Add labels in `src/components/economy/RecentActivity.tsx`.

**Realtime publication** now has 33 tables (after the 20 listed: tournaments, tournament_entries, player_sanctions,
notifications, player_missions, big_wins, club_members, site_status, race_rounds, race_bets, tpt_hands, tpt_players,
player_reputation): wallets, chip_ledger, game_tables, table_seats, bj_rounds,
bj_hands, rl_rounds, rl_bets, cr_state, cr_rolls, cr_bets, pk_hands, pk_players, jackpots, crash_rounds,
crash_bets, bingo_rounds, player_progress, player_achievements, friendships. Postgres Changes enforce RLS.

**Cards** everywhere: integers 0–51, `rank = c % 13` (0 = Ace … 12 = King), `suit = c / 13` in ♠ ♥ ♦ ♣ order.

## 8. Frontend architecture and conventions

- **`useLiveTable({ tableId, stateFn, advanceFn, realtimeTables, getDeadline })`** is the base of every
  table game. It:
  - fetches the `<game>_state` snapshot and refetches on Postgres Changes for the game's tables plus
    `table_seats` and `game_tables` (60 ms debounce, plus a 12 s safety refetch);
  - handles broadcast quick chat (phrase and emote IDs only; typed chat is `useChat`, see below) and presence (watchers);
  - sends a heartbeat every 15 s, and leaves the seat 300 ms after unmount (in-app navigation);
  - runs the deadline watcher (calls `advanceFn` with jitter once a timer passes);
  - computes the server clock offset.
  It returns `call(fn, args)`, which fills in `p_table` and returns a friendly error string or null.
- **supabase-js requests are lazy:** `void supabase.rpc(...)` never runs. Always `await` it or `.then()`.
  Also, supabase-js reports every HTTP 5xx as `AuthRetryableFetchError` with a status, so `friendlyError`
  treats only status 0 as a network failure.
- **Solo games (slots)** don't use `useLiveTable`. `SlotMachine` calls `slot_info` once, then `slot_spin` per
  spin and plays the answer back: `buildScenes()` in `src/lib/slots.ts` turns a result into a list of scenes
  (base spin, each free spin, each respin, each cascade, banners) and `spin()` steps through them with timers.
  **Skip** jumps to the end; leaving the page just stops the show (the chips are already settled).
  - The server pays before the reels stop, so the header balance would give the result away. `spin()` sets
    `useWallet().displayBalance` (what `BalancePill` shows) and raises it scene by scene, then clears it.
    Use the same field for any future game that settles before its animation ends.
  - Symbols are emoji, text or small SVGs sized with container-query units (`SlotSymbol`); add a machine's
    symbols and theme in `SYMBOLS` / `THEMES`. The order of `SYMBOLS[game]` is the paytable order.
- **Phase 6 solo games** share `src/components/solo/SoloShell.tsx`: each game file is a thin outer component
  (`useSoloGame(key)` loads `solo_info`, shows `SoloGate` until it has it) around an inner one that owns the
  round. Betting-spot games use `useSpotBets` + `SpotControls` + `BetSpot`; single-bet games use `BetStepper`.
  `call(fn, args)` returns `[result, null]` or `[null, message]`: test `err !== null`, not `if (err)`, or
  TypeScript won't narrow the result. Rules text lives in each game file and reads its numbers from the config.
  A two-call game starts from `info.round` so a hand left open is picked up after a reload.
- **Live rooms (Crash, Bingo, horse racing)** use `useLiveRoom({ stateFn, tables, pollMs })`: the state RPC both reports and
  advances the round, so the screen polls it (400 ms while a Crash round flies, about 1 s otherwise) and also
  refetches on Realtime changes. Crash draws its multiplier locally from `started_at` and the server clock
  offset, so it can run a fraction of a second past the real crash point before the next poll corrects it.
- Plinko can have many balls in the air: each ball is its own `plinko_drop` call and bet (1, 3, 5 or 10 per
  press, and Drop can be pressed again mid-flight). The header balance is held with `holdBalance` and moved
  ball by ball. Crash draws the line falling to the floor for about a second after a crash (asked for by the user).
- **Quick chat** lives in `src/lib/chat.ts`: `PHRASES` is **append-only** (a phrase travels as its position), and
  `phraseGroups(context)` gives the menus for blackjack, roulette, craps, poker (plus a tournament group) and clubs.
  `ReactionBar` takes a `game` prop and shows the groups as tabs, with emotes as the last tab.
- **Copy:** the word for taking a win is **"Collect"** (the user's choice; the copy guard also rejects
  identifiers like `buy`, so name functions `takeCards`, not `buy`).
- **Lounge and lobby:** the lounge lists games in four sections (`CATEGORIES` in `src/lib/games.ts`, driven
  by `games.category`) with a Live or Solo tag per card. The lobby's picker lists **every** game; games
  without tables show a panel linking to `/play/:key`.
- Roulette keeps a just-settled number out of "Last numbers" and the hot/cold stats until the ball has
  landed on screen, and shows the last 8 only (both asked for by the user) For the same reason the header balance is
  held (`displayBalance`) from "no more bets" until the ball lands: the server pays when the spin ends, a few
  seconds earlier (asked for by the user).
- **Progress (stage 7):** `useProgress` (`src/stores/progressStore.ts`) holds your own `my_progress()` result,
  the two catalogues, and other players' looks. `ProgressConnector` in `App.tsx` loads it at sign-in and
  refetches on every route change, on Realtime changes, when the tab regains focus and every 45 s; each
  refetch is compared with the last one to toast new achievements, levels and friend requests (so it works
  without Realtime too).
  - `Avatar` draws a picture and frame from a loadout. At tables use `SeatAvatar` (it looks the player up by
    id through `useLook`, which batches ids into one `loadouts_for` call).
  - The equipped **card back** is read inside `PlayingCard`'s `CardBack`; the equipped **felt** is two CSS
    variables on `<html>` (`--felt-base`, `--felt-glow`) that the `.felt` class uses. Both are your own view
    only. Anything new that should follow the felt just needs the `.felt` class.
  - "Collect rewards" lives on the lounge's `ProgressCard`; the header avatar shows a gold dot when rewards
    or a friend request are waiting.
- The top bar's balance (`BalancePill`) shows the chip icon and the number only: the user had the "Play chips" tag
  removed from it (2026-10-12). The tag is still on the lounge's balance card and the How chips work page.
- **Game icons** (`src/components/ui/GameIcon.tsx`): **every game has an icon of its own and no two are alike** (the
  user's request, 2026-10-13). They are 48 x 48 SVGs in `ICONS`, keyed by game key. **A new game needs a new entry
  there**: `npm run check` fails (`check:icons`) while a game in file 3 has none, or shares another's drawing.
- **The dealer button** (poker and Teen Patti tables) is moved with `animate={{ left, top }}`, never Framer's
  `layout` prop: `layout` re-measures on every render (the table re-renders twice a second), so whenever anything
  else on the page shifted (the betting controls appearing on your turn, a banner) the button came loose from its
  seat and glided back. Don't put `layout` on anything positioned on the felt.
- **Playing cards** (`PlayingCard`): the rank and suit in the two corners and the big suit in the middle are each
  pinned in place (absolute, inside an `overflow-hidden` face), so nothing can spill off a card at any size; the
  middle suit has a size per card size (`PIP`). A row that shows a highlighted card (it lifts and glows) must not
  clip: no `overflow-hidden` on it. Rows of buttons in a game's controls use `items-center` so their text lines up.
- Table pages share `TableHeader`: a single "← Leave table" / "← Lobby" button that leaves the seat, plus
  Rules, History, Sit out, an `extra` slot and an optional `stakes` label.
- Stage 8 polish: `QuickStart` (first-visit guide per game, text in `src/lib/quickstart.ts`, mounted once in
  `TablePage`, `PlayPage` and `TournamentsPage`; switch and reset in Settings), `SectionNav` (Profile / Locker /
  Friends / Clubs / Leaderboards links), `SeatTitle` (equipped title under every seated player's name),
  roulette's list of line and corner bets for keyboard users, emotes shown only from seated players, a page fade
  (`.page-in`, opacity only: a transform would trap the fixed control bars) and a rolling header balance.
  The site links to its public repo from the landing page and the footer (`GitHubLink`).
- **UX decisions the user asked for (keep them):**
  - Top bar: Lounge, Lobby, Tournaments, Profile (and Admin, for the admin only). The profile pages' row of links is Profile, Locker, Friends,
    Clubs, Leaderboards (no Tournaments, and no duplicate buttons on the profile itself).
  - Equipped titles are visible to everyone at the tables.
  - The landing page says the project is open source and links to the repo; so does the footer.
  - Settings is a popup opened by the gear next to the sound icon.
  - Status lines are keyed by phase/turn, so the countdown seconds tick without re-animating.
  - Result banners have their own timer.
  - Win labels show the amount paid back (e.g. +200 on a 100 bet).
  - Going to the lobby leaves the table.
  - The favicon matches the logo chip.
  - Nothing may be clipped at 360–390 px wide.
- Auth:
  - Sign-up asks for two confirmations: play chips only, and the Terms / Privacy / age box.
  - After the sign-up code, and before the lounge, new players are asked once whether to switch on two-step
    verification (§7, file 15). "Replay welcome tour" lives under Game guides in Settings, not Account.
  - Email + password. Sign-up confirmation and password reset use a 6-digit OTP (`{{ .Token }}`):
    `verifyOtp` type `'email'` for sign-up and `'recovery'` for reset.
  - Every `signUp`, `signInWithPassword`, `resend` and `resetPasswordForEmail` call gets a fresh Turnstile
    token (`TurnstileHandle.getToken()`, then `reset()`). The widget uses `appearance='always'` on the main forms.
- **Terms of Service and Privacy Policy** (`/terms`, `/privacy`; written by Claude for the user to review, not by a
  lawyer). The shared facts are in `src/lib/legal.ts` (`LEGAL`): effective date October 11, 2026, operator Carter K,
  Arizona law, contact `contact@carterscoding.com`, minimum age 13 (under 18 with a parent's permission): the user's
  choices. Both are linked from the footer and from the maintenance page, and stay readable during maintenance.
  Sign-up has a second required checkbox (age, agree to the Terms, have read the Privacy Policy); the accepted
  `legal_version` and `legal_accepted_at` are saved in the account's auth metadata, so no SQL was needed.
  **Standing request (2026-10-12): update both documents with any change that affects players or their data,
  and say so.** When either document changes, change `LEGAL.version` and `LEGAL.effective` (now October 13, 2026). If the game starts collecting
  something new or uses a new outside service, the Privacy Policy must say so. The copy guard applies to these
  pages too: the banned words only pass on a line that also contains a disclaimer such as "no purchases".
- **Music** (2026-10-12, the user's fourth and current version): **every track in `src/assets/music/` plays in a
  random order on every screen, except a game's own theme, which loops on that game's screen.** Today the only
  theme is `Fearless First` for Haunted Manor (`GAME_THEMES` in `src/lib/music.ts`: game key to file name without
  its ending). `music.ts` finds the files at build time with `import.meta.glob` (`PLAYLIST`, `gameTheme(key)`,
  `shuffledOrder`: each track once per round, never the same one twice in a row). `MusicPlayer` is mounted once in
  `App.tsx` above the routes with two `<audio>` elements: the playlist is only paused while a theme plays on
  `/play/<game>` and carries on where it was; the theme starts from its beginning each visit. Music starts on the
  first click or key press (browsers require that) and pauses while the tab is hidden. Credits are in
  `CREDITS.txt` beside the files (shown in Settings minus its `#` lines); the user adds tracks and credits
  themselves. Settings has a Music switch and a volume slider (`musicOn`, `musicVolume`; on at 30% by default).
  Earlier versions the user dropped: one track in the lounge only, and one track looped everywhere.
- **Stage 12 part 1 (quality of life, all in the browser):**
  - `useRemembered(key, initial, valid)` (`src/hooks/useRemembered.ts`, localStorage `allin-mem:<key>`, plus `recall` /
    `remember`) keeps a choice on this device. Used for every single-bet game's bet (`bet:<game>`), Plinko rows and
    risk, the Mines count, the scratch card, keno numbers, and by `useSpotBets(tiers, info.game)` for the stake level,
    chip and **last bets, so Rebet works after a reload**. An open hand still decides the bet in Mines and video poker.
  - **Auto-play:** `SpotControls` takes `auto` (Baccarat, Sic Bo, the wheel, Dragon Tiger, Andar Bahar, Chuck-a-Luck:
    the games with no decision after the bet). It puts the last bets back and presses the game's own button for 10,
    25 or 50 rounds; it stops when chips run out or on "Stop auto". Like the slots, it does not stop for a win.
  - **Lounge:** one toolbar in `GameGrid`: a search box (every word must be in the name or tagline), a menu for the
    kind of game (live, solo, tournaments, favourites) and the section tabs. The user found two rows of pill
    buttons looked like two sets of filters, hence the menu.
  - **Tables:** `TableHeader` takes `atStake` (a sentence saying what happens to the chips in play: leaving then asks
    first, and `useLeaveWarning` makes the browser ask before the tab closes) and `game` (adds a Stats button).
    Poker and Teen Patti have "Sit out next hand"; poker has "Auto top-up" (back to what you first brought, between
    hands). Poker already had keyboard shortcuts (the Fold button's text is "Fold F").
  - `GameStatsModal` reads the player's own `player_game_stats` row; it is on every table, `SoloShell` and the slots.
  - **Music control** (`MusicControl`): a button in the top bar with the switch and volume, hidden below 430px wide
    because the top bar has no room (the header must fit 360px).
  - **Size** (Settings): compact / normal / large set the page's base font size (`TEXT_SCALE`; everything is in rem).
    Large is 106.25% instead of 112.5% under 430px wide, so the 360px layouts still fit.
- **Stage 13 (2026-10-13, all in the browser, no SQL):**
  - **Keyboard shortcuts** (`src/lib/hotkeys.ts`): a screen registers keys with `useHotkeys([...])`, or simply with
    **`hotkey="space"` on a `Button`** (it presses the button while it is on screen and enabled; `hotkeyLabel` names
    it when the button's text will not do). One listener lives in `HotkeyHost` (mounted in `App.tsx`); **"?"** and the
    **Keys** button in every game's header list what is registered on that screen. Conventions: **Space** = the main
    action (Deal, Spin, Roll, Drop, Draw), **1, 2, 3…** = chips (or holds in video poker, or Bet 1× to 4×), **C**
    clear / call / collect, **R** rebet / raise, **− and +** the bet stepper, **Shift + 1 to 3** bet presets; the card
    games' decisions come from `ACTION_KEYS` (H hit, S stand, D double, P split, F fold…). Keys do nothing while
    typing or while a popup covers the page (a `Modal`, which is `aria-modal`; the table chat panel and the music
    control are small `role="dialog"` panels beside the game and only take the keys while the keyboard is inside
    them), and can be switched off in Settings (`hotkeysOn`). A key the screen has registered is always kept from
    the browser, even when its button is disabled, or Space would scroll the page. **Digits are read from the
    character typed** (`e.key`), not the key's position, so French keyboards and the number pad work; Shift + a
    top-row key that types something else is a preset. Only a `Button` with `hotkey` runs any shortcut code
    (`HotkeyButton`); the rest are a plain button. Poker (`PokerActions`) and
    the blackjack table keep their own older listeners and only describe their keys with `useHotkeyDocs`.
    **A button clicked with the mouse is blurred** (in `HotkeyHost`), or Space would press it again (another chip
    on the same spot) instead of dealing; keyboard users are not affected. **A new game should put `hotkey` on its
    main button and decisions.** To hide a hotkey button on phones use `max-md:hidden`, not `hidden md:…` (the
    Button's own `inline-flex` wins over `hidden`).
  - **Bet presets** (`BetPresets`): three slots per game and stake level, kept on the device. Every game on
    `SpotControls` has them through `useSpotBets` (`presets`, `savePreset`, `loadPreset`); roulette and craps keep
    theirs with `useStoredPresets` and replay a preset as ordinary `rl_place_bet` / `cr_place_bet` calls, one per
    spot. Because that is not one step on the server: **roulette** only places a preset on an empty table, with the
    chips for all of it and at least 4 seconds left, and takes back what went down (`rl_undo_bet`) if a bet is
    refused, so it is all or nothing; **craps**, where bets stay up between rolls, places only the bets that are not
    already on the table and can be made on that roll (pressing twice changes nothing), saves a moved Come bet as
    a Come bet, and leaves odds out. On phones the menu opens as a sheet over the controls bar.
  - **Friends online** (`FriendsStrip`, on the lounge under the big-win ticker): friends who are in the presence
    list, at a table or with a game open, each with Join / Watch / Message. Hidden when there are none. It reads
    `friends_list()` and `friends_activity()` through `loadFriends()` (`src/lib/friends.ts`, shared with the Friends
    page) when the lounge opens, every half minute, and when a **friend** joins or leaves the presence list (not
    on every change to that list: it holds everyone on the site). It reuses `WatchModal` and `DmModal`.
  - **Turn alerts** (`useTurnAlert(turnKey, words, ring)`): poker, Teen Patti, blackjack and the craps shooter. With
    the tab in the background the title flashes "Your turn!" until you return or the turn passes, and the turn
    sound plays again after 8 seconds. Settings switch `turnAlerts`. No browser notifications (they need a
    permission prompt; not asked for).
  - No achievements came with this stage: it is how the games are operated, not something to earn.
- Styling: Tailwind with custom colours (`ink`, `felt`, `ruby`, `gold`, `cream`, `ivory`), the `.felt` and
  `.surface` classes, Playfair Display headings and Inter body text. Sounds come from `playSound(...)` in
  `src/lib/sound.ts`.

## 9. Testing

1. `npm run check` and `npm run test:sql` before every commit. **After changing any SQL file run
   `bash scripts/gen-db-check.sh`**: it rewrites `supabase/maintenance/check_database.sql`, the list (with a
   fingerprint of every function body, and the file that last defined each thing) that the user runs on the live
   database to see which files need re-running. `test:sql` fails while that file is stale. New tables that pile
   up rows also need a step in `supabase/maintenance/cleanup.sql`. SQL tests:
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
   node scripts/e2e/poker.cjs /tmp/shots        # Hold'em, Draw, Stud (25 checks); screenshots to /tmp/shots
   node scripts/e2e/phase3.cjs /tmp/shots       # roulette (incl. the balance waiting for the ball) + craps (11 checks)
   node scripts/e2e/slots.cjs /tmp/shots        # all six machines, features, jackpot, phone widths (21 checks)
   node scripts/e2e/solo.cjs /tmp/shots         # the eight Phase 6 games, a resumed hand, phone widths (29 checks)
   node scripts/e2e/more.cjs /tmp/shots         # stage 6.5: nine games, two players in Crash and Bingo, lounge, lobby (44 checks)
   node scripts/e2e/social.cjs /tmp/shots       # stage 7: rewards, profile, locker, friends, join their table, leaderboards (24 checks)
   node scripts/e2e/tournaments.cjs /tmp/shots  # stage 8: freeroll, showdown, heads-up Sit & Go, first-visit guide (29 checks)
   node scripts/e2e/moderation.cjs /tmp/shots   # stage 9 part 1: admin page, report, block, timeout, rename, chips, ban, site maintenance (24 checks)
   node scripts/e2e/live.cjs /tmp/shots         # stage 9 part 2: missions, season track, inbox, table invite (17 checks; season checks need a running season)
   node scripts/e2e/clubs.cjs /tmp/shots        # stage 9 part 3: clubs, ticker, head-to-head, personal records (16 checks)
   node scripts/e2e/events.cjs /tmp/shots       # stage 9 part 4: favourites, VP hint, auto-spin, formats, a three-player Main Event, trophies (20 checks)
   node scripts/e2e/stage10.cjs /tmp/shots      # stage 10 part 1: the six dealer card games, a resumed hand, two video poker machines, phone widths (23 checks)
   node scripts/e2e/stage10b.cjs /tmp/shots     # stage 10 part 2: four blackjack variants, Red Dog, Hi-Lo, Andar Bahar, Chuck-a-Luck, phone widths (23 checks)
   node scripts/e2e/stage10c.cjs /tmp/shots     # stage 10 part 3: a full Badugi hand with three draws, lobby entries, Grandmaster, seasonal tag (12 checks)
   node scripts/e2e/stage10d.cjs /tmp/shots     # stage 10 part 4: a horse race with two players, a Teen Patti hand with a show, phone widths (23 checks)
   node scripts/e2e/stage11.cjs /tmp/shots      # phase 11: room and table chat, the filter, reputation, a reported message, admin controls and reasons, notes, cosmetics (24 checks)
   node scripts/e2e/stage12a.cjs /tmp/shots     # stage 12 part 1: lounge search, music control, auto-play, remembered bets, stats, size, leave confirmation, sit out next hand, auto top-up (22 checks)
   node scripts/e2e/stage12b.cjs /tmp/shots     # stage 12 part 2: direct messages, a waiting-room table, watching a friend alone and at a table (16 checks)
   node scripts/e2e/stage12d.cjs /tmp/shots     # stage 12 part 4: practice walkthroughs, site stats, chat log search, a scheduled notice and closure, an appeal (37 checks)
   node scripts/e2e/twostep.cjs /tmp/shots      # two-step verification: the offer after sign-up, "Verify your identity" at login, the Settings switch, the admin's off switch (26 checks)
   node scripts/e2e/stage13.cjs /tmp/shots      # stage 13: shortcuts in six games, presets (solo, roulette, craps, phone), turn alert, the lounge's friends strip (33 checks)
   node scripts/e2e/stage12c.cjs /tmp/shots     # stage 12 part 3: Haunted Manor, season missions, seven practice drills, a private tournament, a club event (39 checks; season missions need October 2026)
   ```
   Run `reset.sql` before each script: they assume fresh players and the jackpot at its seed.
   Notes:
   - The stand-in has **no realtime**, so the scripts nudge a page to refetch by dispatching
     `visibilitychange`, and the header shows "Reconnecting…" (expected).
   - Test helpers: `select tests.deck('As Ah Kc Kd …')` stacks the next poker deck;
     `insert into tests.dice (v) values (2),(3)` queues a craps roll of 3 + 4;
     `select tests.slot_reel('slots_classic', 0, 'BLANK', 'SEVEN', 'BLANK')` stacks one reel of the next spin
     (queue the reels in order; reel heights, pearl prizes and the jackpot draw are raw `tests.dice` values).
   - `tests.dice` feeds **every** `private.random_int` call, and `tests.deck(...)` is the next shoe of **any**
     size (poker, baccarat, video poker, Three Card Poker, Pai Gow), so leftovers from one test rig the next
     game. `reset.sql` clears both. For Pai Gow also queue one `tests.dice` value: where the joker goes
     (52 = bottom of the deck, not dealt).
   - `mini-supabase.cjs` passes JSON objects as `jsonb` and arrays as Postgres arrays. A password login gets a
     token with `amr: password`; `/auth/v1/verify` accepts any six digits but `000000` and gives `amr: otp`;
     `GET /test/otp-sent` lists the login codes "emailed".
   - Use `exact: true` in Playwright name selectors ('50 chip' matches '250 chip').
   - Test emails need a TLD. The poker history step has timed out once on a cold start; re-run if so.
   - Kill background node processes with a bracket pattern, e.g. `pkill -f "[m]ini-supabase"`.
     The bracket stops the pattern from matching the pkill command itself, but avoid running it in the
     same command line that restarts the server: that line contains the name too and gets killed.
   - `setup-db.sh` does not stop an older test database on the same port: stop it first. Re-applying a SQL file
     to the test database wipes the rigging: re-run `scripts/e2e/test-helpers.sql` afterwards.
   - The scripts switch first-visit guides off through localStorage (`allin-settings`), except `tournaments.cjs`.
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

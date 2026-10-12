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
`brew install postgresql@16`, or Postgres.app in `/Applications` (the scripts find it by themselves; the user's
Mac has Postgres.app 16 and no Homebrew). On Windows use WSL. When run as root it switches to the `postgres` user.

## 4. Git and PR workflow

- Phases 1 to 4 were built in cloud sessions on a feature branch (`claude/youthful-turing-56segv`) and merged
  into `main` through PRs #1 to #6. Since Phase 5 the work happens on the user's Mac, **directly on `main`**
  (their choice; no feature branches or PRs unless they ask). Keep the old local branch; don't delete it.
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
| 9 | **Live-service features, in four parts (below)** | **Part 1 built on `main`; parts 2 to 4 next** |
| 10 | More games (the user's list, below) | |

**User action pending for stage 9 part 1:** re-run `02_economy.sql` and `05_tables.sql`, then run the new
`15_moderation.sql`. No dashboard settings. (Realtime gains `player_sanctions`: 23 tables.)

### Stage 9: what the user asked for (2026-10-11), delivered in parts, each committed and tested
1. ✅ **Admin and moderation** (`15_moderation.sql`): hidden `/admin` page for the account called Carter, reports,
   blocks, bans, timeouts, forced renames, chip changes, site notice. Profile page: the Leaderboards / Friends /
   Open locker buttons and the Tournaments pill were removed (the user's request).
2. **Missions** (daily and weekly), **monthly season tracks** (first one Halloween, October 2026; rewards defined up
   to October 2027 but a season's rewards must be invisible and unearnable until its month starts, checked on the
   server; **a season's rewards are gone for good when it ends**), a **notification inbox**, **invite a friend to
   your table**.
3. **Clubs** (a typed name and tag only, preset chat, members, club leaderboard: the user chose no free text),
   **head-to-head records**, a **big-win ticker**, a **personal records** section on the profile page.
4. **Tournament leaderboard and trophies**, **multi-table tournaments**, **more tournament formats**, and quality of
   play: poker pre-action buttons, showing cards after everyone folds, slot auto-spin, a video poker strategy hint,
   favourite games and "continue where you left off", more emotes. **Not wanted:** music or sound options, installing
   as an app. Not asked for (skip unless they ask): lucky wheel, private tournaments, shareable wins, profile showcase,
   fairness page, play reminders.
Every part must come with its achievements, cosmetics and menu entries (standing request).

### Stage 10: more games (the user's list, saved on 2026-10-11; not designed yet)
- **Table poker against the dealer:** Caribbean Stud, Let It Ride, Mississippi Stud, Four Card Poker, Casino Hold'em.
- **Blackjack variants:** Spanish 21, Blackjack Switch, Free Bet Blackjack, Pontoon.
- **Player-against-player poker:** Short Deck (6+) Hold'em, Razz, 2-7 Triple Draw, Badugi.
- **Video poker:** Joker Poker, Double Bonus, Bonus Poker (mostly new paytables on the Jacks or Better engine).
- **Other:** Red Dog, Hi-Lo (is the next card higher or lower), Teen Patti, Andar Bahar, Chuck-a-Luck, virtual horse racing.

Where each would plug in: the dealer poker games follow Three Card Poker / Ultimate Hold'em (`solo_rounds`,
`private.pk_best` or `private.cg_score5`); the video pokers are new entries in `private.solo_cfg` plus an
evaluator branch in `private.vp_eval`; the player-against-player pokers are new `pk_config` families in
`09_poker.sql` (Razz and 2-7 need low-hand ranking; Badugi needs its own evaluator); the blackjack variants
need changes to `06_blackjack.sql`'s rules, which is multiplayer.

### Stage 8 starting points
Nothing has been designed or agreed with the user yet. The list from the original roadmap: sounds, animations,
tutorials, accessibility, a mobile pass, and Sit & Go poker tournaments. See "Deferred items" below for
things already promised for it.

### Deferred items already promised
- Tutorials, including craps (Phase 8).
- Keyboard access for the thin roulette edge zones (Phase 8).
- Hardening broadcast emotes so only seated players can send them (Phase 8).
- Poker pre-action buttons (check/fold in turn) and showing cards voluntarily when everyone folds
  would be nice later.
- Solo games: auto-spin / auto-play, and a strategy hint for video poker, would be nice later.
- Stage 7 leftovers that would be nice later: blocking a player, showing which solo game an online friend is
  in (only table seats are known to the server), a weekly reward for the weekly board, and titles shown at tables.

## 6. Repository map

```
.github/workflows/deploy-pages.yml   build + deploy to GitHub Pages on push to main (VITE_BASE from configure-pages)
public/                              favicon.svg (same ruby chip as ChipIcon), CNAME, _redirects, .nojekyll
index.html                           boot screen inside #root ("Shuffling up…", help text after 6 s)
vite.config.ts                       VITE_BASE base path, spaFallback plugin (404.html), manualChunks, @ -> src
scripts/check-copy.mjs               copy guard (currency symbols, banned words)
scripts/test-sql.sh                  SQL test runner
scripts/e2e/                         local end-to-end harness (see §9)
supabase/sql/01…13_*.sql             the database, applied in order (see §7)
supabase/tests/00_supabase_stub.sql  fake auth schema/roles for local tests ONLY
supabase/tests/0N_*_test.sql         tests: tests.ok / tests.throws helpers, run as role authenticated
supabase/email-templates/            confirm-signup.html, reset-password.html (+ subjects in README)
src/App.tsx                          routes: / signup login verify forgot-password how-chips-work settings
                                     lounge lobby table/:id play/:gameKey join/:code
                                     profile profile/:username locker friends leaderboards *
src/lib/                             supabase client, errors (friendlyError), format, cards, sound (WebAudio),
                                     turnstile, validation, types, and per-game helpers: blackjack, roulette, craps, poker,
                                     slots (result types, symbol art, themes, and buildScenes: result -> playback),
                                     solo (useSoloGame, holdBalance/settleBalance, hand names, history lines),
                                     games (the four lounge sections; gameMode: tables / live room / solo; gameHref),
                                     progress (types, and what every cosmetic looks like: AVATAR_GLYPH, FRAMES, CARD_BACKS, FELTS)
src/stores/                          zustand: auth, wallet (balance, ledger, displayBalance), presence, settings, toast, ui,
                                     progress (own XP / achievements / loadout, the catalogues, other players' looks)
src/hooks/useLiveTable.ts            shared live-table plumbing (see §8); useBlackjackTable / usePokerTable wrap it
src/hooks/useLobby.ts                lobby table list + online presence
src/hooks/useLiveRoom.ts             a shared room with no tables or seats (Crash, Bingo): polls its state RPC, listens to Realtime
src/components/table/                TableHeader, PlayerStrip, PhaseBar, TimerRing(+useSecondsLeft), ReactionBar,
                                     ChipStack, InfoModal(+TabButtons), GameHistoryModal
src/components/{blackjack,roulette,craps,poker}/   one folder per game; *Table.tsx is the entry
src/components/slots/                SlotMachine (the entry, all six machines), SlotReels, SlotSymbol, SlotRules, JackpotTicker
src/components/solo/                 SoloShell (page frame, TierPicker, ChipRack, BetSpot, useSpotBets, BetStepper) and one
                                     file per game: Baccarat, VideoPoker (both), ThreeCard, PaiGow, SicBo, Keno, Wheel
src/components/more/                 stage 6.5, one file per game: DragonTiger, CasinoWar, UltimateHoldem, Plinko, Mines,
                                     Scratch, PowerDraw, Crash, Bingo (they reuse SoloShell and its pieces)
src/components/lounge/GameGrid.tsx   the lounge's game list in four sections, each card tagged Live or Solo
src/components/progress/             ProgressCard (lounge), and bits: LevelBadge, XpBar, PlayerLine (avatar + name + title)
src/components/ui/Avatar.tsx         a player's picture and frame; src/components/table/SeatAvatar.tsx looks it up by user id
src/pages/{Profile,Locker,Friends,Leaderboard}Page.tsx   the four stage 7 pages
src/components/cards/PlayingCard.tsx PlayingCard + CardFan (sizes xs/sm/md/lg, highlight, still, delay; 52 = joker)
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
9. `09_poker.sql`: one engine, five games (`pk_config(game)` → family board/stud/draw, limit nl/pl/fl).
   - Tables: `pk_hands`, `pk_players` (public), **`pk_hole` (RLS: own rows only)**, hidden `pk_decks`
     and `pk_topups`.
   - RPCs: `pk_state`, `pk_action(table, action, amount)` (`amount` = total "raise to" this street),
     `pk_draw(table, cards[])`, `pk_bring_chips`, `pk_advance`, `pk_hand_history`.
   - Rules covered: min raise, pot-limit max, fixed-limit cap of 4, short all-ins don't reopen the betting,
     uncalled bets returned (never to folded players), side pots, split pots (odd chip left of the button),
     hi-lo 8-or-better.
   - Timer 20 s → check if free else fold, then sit out; players who left or disconnected are acted for at once.
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
     win), the counters in `player_progress.counters` (`private.round_counters` reads the round's `summary`
     for feats such as a jackpot, a royal flush or a cleared Mines field), and `weekly_stats`.
   - `player_game_stats` insert/update → `private.check_achievements`. It has to be this second trigger:
     `record_round` writes the history row **before** the stats, and most achievements read the stats.
   - **So a game gets XP and achievements for free as long as it calls `record_round`.** For a new feat, add a
     branch to `private.round_counters` keyed on something the game puts in its `summary`, and an
     `achievements` row whose `metric` is that counter.
   - Level L starts at `100 * (L - 1)^2` XP, capped at 100. An achievement is unlocked when
     `private.player_metrics(user) ->> metric >= goal` (the metrics are stats aggregates, wallet fields, the
     counters and the friend count).
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
   - **One-of-a-kind cosmetics** exist only in the live database, not in this file: the user ran SQL that added
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
     and answers `not_admin` to anyone else. The `/admin` page has **no link anywhere** (the user's wish) and
     shows "Access not allowed" unless `my_account().admin`; the page is a convenience, the server is the gate.
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
   - Frontend: `useAccount` (`src/stores/accountStore.ts`), `AccountGate` inside `RequireAuth` (the suspended /
     timeout / choose-a-new-name screens), `ReportModal`, Block and Report on other players' profiles, the blocked
     list on the Friends page, `src/pages/AdminPage.tsx`.
   - Not done yet: banned players still appear on leaderboards.

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
  `table_chips_in`, `table_chips_out`, `poker_pot`, `jackpot`, `level_up`, `achievement`. Solo games use `bet` and `payout` only (a returned
  stake is part of the `payout`). Add labels in `src/components/economy/RecentActivity.tsx`.

**Realtime publication** now has 22 tables (the last two are tournaments, tournament_entries): wallets, chip_ledger, game_tables, table_seats, bj_rounds,
bj_hands, rl_rounds, rl_bets, cr_state, cr_rolls, cr_bets, pk_hands, pk_players, jackpots, crash_rounds,
crash_bets, bingo_rounds, player_progress, player_achievements, friendships. Postgres Changes enforce RLS.

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
- **Live rooms (Crash, Bingo)** use `useLiveRoom({ stateFn, tables, pollMs })`: the state RPC both reports and
  advances the round, so the screen polls it (400 ms while a Crash round flies, about 1 s otherwise) and also
  refetches on Realtime changes. Crash draws its multiplier locally from `started_at` and the server clock
  offset, so it can run a fraction of a second past the real crash point before the next poll corrects it.
- Plinko can have many balls in the air: each ball is its own `plinko_drop` call and bet (1, 3, 5 or 10 per
  press, and Drop can be pressed again mid-flight). The header balance is held with `holdBalance` and moved
  ball by ball. Crash draws the line falling to the floor for about a second after a crash (asked for by the user).
- **Copy:** the word for taking a win is **"Collect"** (the user's choice; the copy guard also rejects
  identifiers like `buy`, so name functions `takeCards`, not `buy`).
- **Lounge and lobby:** the lounge lists games in four sections (`CATEGORIES` in `src/lib/games.ts`, driven
  by `games.category`) with a Live or Solo tag per card. The lobby's picker lists **every** game; games
  without tables show a panel linking to `/play/:key`.
- Roulette keeps a just-settled number out of "Last numbers" and the hot/cold stats until the ball has
  landed on screen, and shows the last 8 only (both asked for by the user).
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
- Table pages share `TableHeader`: a single "← Leave table" / "← Lobby" button that leaves the seat, plus
  Rules, History, Sit out, an `extra` slot and an optional `stakes` label.
- Stage 8 polish: `QuickStart` (first-visit guide per game, text in `src/lib/quickstart.ts`, mounted once in
  `TablePage`, `PlayPage` and `TournamentsPage`; switch and reset in Settings), `SectionNav` (Profile / Locker /
  Friends / Leaderboards / Tournaments links), `SeatTitle` (equipped title under every seated player's name),
  roulette's list of line and corner bets for keyboard users, emotes shown only from seated players, a page fade
  (`.page-in`, opacity only: a transform would trap the fixed control bars) and a rolling header balance.
  The site links to its public repo from the landing page and the footer (`GitHubLink`).
- **UX decisions the user asked for (keep them):**
  - Top bar: Lounge, Lobby, Tournaments, Profile. The profile pages' row of links is Profile, Locker, Friends,
    Leaderboards (no Tournaments, and no duplicate buttons on the profile itself).
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
   node scripts/e2e/slots.cjs /tmp/shots        # all six machines, features, jackpot, phone widths (21 checks)
   node scripts/e2e/solo.cjs /tmp/shots         # the eight Phase 6 games, a resumed hand, phone widths (29 checks)
   node scripts/e2e/more.cjs /tmp/shots         # stage 6.5: nine games, two players in Crash and Bingo, lounge, lobby (44 checks)
   node scripts/e2e/social.cjs /tmp/shots       # stage 7: rewards, profile, locker, friends, join their table, leaderboards (24 checks)
   node scripts/e2e/tournaments.cjs /tmp/shots  # stage 8: freeroll, showdown, heads-up Sit & Go, first-visit guide (30 checks)
   node scripts/e2e/moderation.cjs /tmp/shots   # stage 9 part 1: admin page, report, block, timeout, rename, chips, ban (18 checks)
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
   - `mini-supabase.cjs` passes JSON objects as `jsonb` and arrays as Postgres arrays.
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

# All In

A web-based, free-play, multiplayer social casino game.

> **All In is a free game. No real money is ever used.**
> Play chips only: no gambling, no purchases, nothing to pay for, ever. Chips have no cash value and can't be
> exchanged, transferred, sold or redeemed.

## Ground rules (enforced in code)

1. **No real money.** No payments, store, payment libraries, cash-out or prizes. Cosmetics are earned, never sold.
2. **Server-authoritative.** Shuffles, rolls, spins, rules, bet validation and every chip change run in Postgres
   functions called with `supabase.rpc()`. The browser can read its own balance and can never write it.
3. **Hidden information stays hidden.** Hole cards and the undealt deck are protected by RLS, not by the UI.
4. **Bot protection.** Cloudflare Turnstile guards sign-up, log-in, code resends and password resets. Supabase
   Auth verifies the tokens, so the Turnstile secret never touches the front end.
5. **Publishable key only** in the client. The secret / service-role key is never used in front-end code.

`npm run check:copy` scans the UI and email templates for currency symbols and words like
"deposit", "withdraw", "cash out", "buy" or "purchase" (the required "No purchases" disclaimers are allowed).

## Stack

Vite · React 19 · TypeScript · Tailwind CSS v4 · Framer Motion · Zustand · `@supabase/supabase-js` v2.
It builds to a static site.

## Folder structure

```
.
├── .github/workflows/     deploy-pages.yml (GitHub Pages)
├── index.html
├── public/                  favicon, _redirects (Netlify SPA fallback)
├── vercel.json              SPA fallback for Vercel
├── scripts/
│   ├── check-copy.mjs       "no real money" copy guard
│   └── test-sql.sh          runs the SQL against a throwaway local Postgres
├── src/
│   ├── App.tsx, main.tsx, index.css (design tokens)
│   ├── components/
│   │   ├── ui/              Button, TextField, Modal, ChipIcon, ChipAmount, states, …
│   │   ├── layout/          header, footer, balance pill, sound toggle, no-real-money notice
│   │   ├── auth/            OTP input, password checklist, resend button, auth card
│   │   ├── economy/         balance, daily bonus, refill, recent activity
│   │   ├── lounge/          game grid
│   │   └── onboarding/      first-time welcome tour
│   ├── hooks/               useNow, useUsernameCheck
│   ├── lib/                 supabase client, friendly errors, validation, formatting, sound
│   ├── pages/               Landing, SignUp, VerifyEmail, LogIn, ForgotPassword, Lounge,
│   │                        HowChipsWork, Settings, NotFound
│   ├── routes/              auth guards
│   └── stores/              auth, wallet (with Realtime), settings, toasts
└── supabase/
    ├── sql/                 numbered, re-runnable SQL files and their README
    ├── email-templates/     confirm-signup.html, reset-password.html (+ subjects)
    └── tests/               local-only Supabase stub and SQL tests
```

## Local setup

Requirements: Node 20+ and a Supabase project.

```bash
npm install
cp .env.example .env          # already filled in with the project URL and publishable key
npm run dev                   # http://localhost:5173
```

Then follow **[SETUP.md](./SETUP.md)** to run the SQL files and configure the Supabase dashboard
(email OTP, password rules, email templates, SMTP, Realtime).

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript only |
| `npm run check:copy` | Copy guard for the "no real money" rules |
| `npm run check` | Typecheck + copy guard |
| `npm run test:sql` | Apply `supabase/sql` twice to a throwaway Postgres and run the SQL tests (needs Postgres 15+ binaries locally) |

## Deploy to GitHub Pages (recommended)

`.github/workflows/deploy-pages.yml` builds and deploys on every push to `main`, or on demand from the Actions tab.

1. Repo **Settings → Pages → Source: GitHub Actions**.
2. Push or merge to `main`. The site appears at **https://allin.carterscoding.com/** (custom domain, set in
   *Settings → Pages* and in `public/CNAME`). Without a custom domain it would be `https://cksarge.github.io/All-In/`.
3. In Supabase, set **Site URL** to that address (see [SETUP.md](./SETUP.md)).

How it works on Pages: the workflow asks GitHub for the site's base path (`/` on the custom domain, `/All-In/`
on a plain github.io project site) and builds with it,
and the build copies `index.html` to `404.html` so deep links like `/All-In/lounge` still load the app
(GitHub Pages has no rewrite rules).

## Other static hosts

`npm run build` produces a static site in `dist/`. The two `VITE_*` variables are baked in **at build time**,
so set them in your host's build environment:

```
VITE_SUPABASE_URL=https://irwctaccrxtcoqsskjpy.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_16Wb-YS3WD6d6iq93tDRpA_pdMlm7xT
VITE_TURNSTILE_SITE_KEY=0x4AAAAAAFSY1ZizIBVxN3W0
# Only when serving from a sub-path (e.g. GitHub Pages project sites):
VITE_BASE=/All-In/
```

- **Netlify:** build command `npm run build`, publish directory `dist`. `public/_redirects` handles SPA routes.
- **Vercel:** framework preset *Vite*. `vercel.json` handles SPA routes.
- **Cloudflare Pages:** build command `npm run build`, output `dist`. SPA fallback is automatic.
- **Anything else:** serve `dist/` and rewrite unknown paths to `/index.html`.

After deploying, set **Authentication → URL Configuration → Site URL** in Supabase to your live URL.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Scaffold, design system, landing, auth (OTP), email templates, profiles, chip economy, SQL | ✅ Done |
| 2 | Lobby, tables & seats, Realtime plumbing, multiplayer blackjack | ✅ Done |
| 3 | Roulette, craps | Next |
| 4 | Poker: Hold'em, Omaha, Omaha Hi-Lo, Stud, Draw | |
| 5 | Six slot machines + shared progressive jackpot | |
| 6 | Baccarat, video poker, Three Card Poker, Pai Gow, Sic Bo, Keno, Big Six | |
| 7 | XP, achievements, cosmetics, locker, leaderboards, profile, friends | |
| 8 | Polish: sounds, animations, tutorials, accessibility, mobile, Sit & Go | |

Free to play. No real money. No purchases. Chips have no cash value.

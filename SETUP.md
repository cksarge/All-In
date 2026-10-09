# All In: Supabase dashboard checklist

Work through this once for your project (`https://irwctaccrxtcoqsskjpy.supabase.co`).
Dashboard menu names move around now and then. If a path below doesn't match exactly,
look for the same setting name under **Authentication**.

> All In is a free game. No real money is ever used. Nothing here involves payments.

---

## 1. Run the SQL

**SQL Editor → New query.** Paste and run each file in `supabase/sql/` **in order**:

1. `01_profiles.sql`
2. `02_economy.sql`
3. `03_games_and_stakes.sql`
4. `04_realtime.sql`

Every file is safe to re-run. See `supabase/sql/README.md` for what each one does.

Then check **Settings → Data API → Exposed schemas**: it should list `public` (default).
Do **not** add `private`.

## 2. Email sign-in settings

**Authentication → Sign In / Providers → Email**

| Setting | Value |
| --- | --- |
| Enable Email provider | **On** |
| Confirm email | **On** (players verify with a 6-digit code) |
| Email OTP Length | **6** |
| Email OTP Expiration | **3600** seconds (the emails say "expires in 60 minutes") |
| Secure email change | On (default) |

Magic links are never used. The app only uses the code (`{{ .Token }}`).

## 3. Password requirements

**Authentication → Sign In / Providers → Email** (or **Authentication → Policies / Passwords**, depending on your dashboard version)

| Setting | Value |
| --- | --- |
| Minimum password length | **8** |
| Password requirements | **Lowercase, uppercase letters and digits** |
| Leaked password protection | Optional (Pro plan). The app already shows a friendly message if it triggers. |

The sign-up and reset forms check the same rules live with a checklist.

## 4. Email templates

**Authentication → Emails → Templates**

| Template | Subject | Body |
| --- | --- | --- |
| **Confirm signup** | `{{ .Token }} is your All In verification code` | Paste all of `supabase/email-templates/confirm-signup.html` |
| **Reset password** | `{{ .Token }} is your All In password reset code` | Paste all of `supabase/email-templates/reset-password.html` |

Prefer not to show the code in the inbox preview? Use `Your All In verification code` and
`Reset your All In password` instead. Save each template.

## 5. URL configuration

**Authentication → URL Configuration**

| Setting | Value |
| --- | --- |
| Site URL | Your deployed URL, e.g. `https://allin.example.com` (used for the "All In" link in email footers) |
| Redirect URLs | Add `http://localhost:5173/**` for local development, plus your deployed URL with `/**` |

## 6. Custom SMTP (strongly recommended, needed before real players)

Supabase's built-in email sender is for testing only. It is **heavily rate limited** (only a few
emails per hour for the whole project) and **only delivers to members of your Supabase
organization**. Anyone else sees *"We can't send email to that address yet"*.

1. Create an account with an email provider (Resend, Postmark, Amazon SES, SendGrid, Brevo, …)
   and verify a sending domain (SPF + DKIM records on your DNS).
2. **Authentication → Emails → SMTP Settings** → enable **Custom SMTP** and enter the
   host, port, username, password, sender email (e.g. `no-reply@yourdomain.com`) and sender name `All In`.
3. **Authentication → Rate Limits** → raise *Rate limit for sending emails* to suit your traffic
   (e.g. 100+/hour). Leave the per-address resend wait at 60 seconds (the app's "resend code"
   countdown matches it).

## 7. Realtime

`04_realtime.sql` adds `wallets` and `chip_ledger` to the `supabase_realtime` publication.
Check **Database → Publications → supabase_realtime**: both tables should be listed.

**Realtime → Settings**: for Phase 1, leave **"Allow public access"** enabled (do not switch
to private-channels-only yet). Postgres Changes still enforce RLS, so each player only
receives their own wallet and ledger rows. Later phases will say if this needs to change.

## 8. API keys

**Settings → API Keys.** The app uses only the **publishable** key
(`sb_publishable_…`) via `VITE_SUPABASE_PUBLISHABLE_KEY`. Never put the secret /
`service_role` key in `.env`, your host's build settings, or anywhere in front-end code.
The app refuses to start if it detects one.

## 9. Smoke test

1. `npm run dev`, open `http://localhost:5173`.
2. Sign up → you should receive the branded email with a 6-digit code → enter it → you land in
   the Lounge with **10,000** chips.
3. **Table Editor**: `profiles`, `wallets` and `chip_ledger` each have a row for you
   (`chip_ledger.reason = signup_bonus`).

# All In email templates

Paste each file's full HTML into **Supabase Dashboard → Authentication → Emails → Templates**.

| Dashboard template | File | Subject line |
| --- | --- | --- |
| **Confirm signup** | `confirm-signup.html` | `{{ .Token }} is your All In verification code` |
| **Reset password** | `reset-password.html` | `{{ .Token }} is your All In password reset code` |
| **Magic Link** | `verify-identity.html` | `{{ .Token }} is your All In login code` |

Alternative subjects if you'd rather not show the code in the inbox preview:

- Confirm signup: `Your All In verification code`
- Reset password: `Reset your All In password`
- Magic Link: `Your All In login code`

**Magic Link** is the dashboard's name for the email Supabase sends when the app asks for a login code. All In
uses it for **two-step verification** only: the code a player enters after their password ("Verify your identity").
No link is sent, despite the name.

All three templates:

- show the code with `{{ .Token }}` (6 digits when **Email OTP Length** is set to 6) and contain **no magic links**;
- use `{{ .Email }}` and `{{ .SiteURL }}` in the footer;
- adapt to light and dark mail clients (`prefers-color-scheme` and Outlook.com `[data-ogsc]` overrides; the brand header is dark in both);
- include the line **"All In is a free game. No real money is ever used."**

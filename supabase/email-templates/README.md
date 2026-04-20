# CarReminder — Supabase Auth Email Templates

Branded Hebrew RTL email templates for the built-in Supabase Auth flows
(signup confirmation, password reset, magic link). They mirror the same
visual identity as our app and as the `src/lib/emailTemplates.js` helper
used for invite emails.

## Files

| File | Use for | Subject (suggested) |
| --- | --- | --- |
| `confirm-signup.html` | "Confirm signup" template — new user OTP / verification | `קוד האימות שלך: {{ .Token }}` |
| `reset-password.html` | "Reset password" template | `איפוס הסיסמה ב-CarReminder` |
| `magic-link.html` | "Magic Link" template (passwordless sign-in) | `קישור התחברות מהיר ל-CarReminder` |

## How to install

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → select the project.
2. Sidebar → **Authentication** → **Email Templates**.
3. For each template above:
   - Click the matching tab (Confirm signup / Reset Password / Magic Link).
   - Copy the subject line from the table above into the **Subject** field.
   - Copy the **entire contents** of the matching `.html` file into the **Message body** field — replacing whatever is there.
   - Click **Save changes**.
4. (Optional but recommended) Make sure **Site URL** is set correctly under
   **Authentication → URL Configuration** → Site URL = `https://car-reminder.app`.
   Redirect URLs used by the app should also appear there.

## Supabase template variables

These are the Go-template placeholders Supabase substitutes at send time.
Don't rename or remove them — they're required for the flow to work.

- `{{ .Token }}` — 6-digit numeric OTP code (used in signup confirmation).
- `{{ .ConfirmationURL }}` — the full magic link / confirmation URL.
- `{{ .Email }}` — the recipient's email address.
- `{{ .SiteURL }}` — configured Site URL.

## Testing

After saving, the fastest way to see the real email:

1. In the app, sign out.
2. On the auth page → **הרשמה** with a fresh email → you'll get the
   `confirm-signup.html` template.
3. On the auth page → **שכחתי סיסמה** → triggers `reset-password.html`.

Or, in the Dashboard → Authentication → Users → pick a user → "Send
password recovery" — fires the reset email immediately.

## Keeping branding in sync

The three files here are intentionally standalone HTML (Supabase doesn't
run JavaScript on templates). When you change the brand — colour, logo,
footer text — **update all four places together** to stay consistent:

- `src/lib/emailTemplates.js` (invite + in-app emails)
- `supabase/email-templates/confirm-signup.html`
- `supabase/email-templates/reset-password.html`
- `supabase/email-templates/magic-link.html`

## Deliverability checklist

- **Sender domain** — Supabase sends from its own `@mail.app.supabase.io`
  domain unless you configure a custom SMTP. If you want all auth emails
  to also come from `car-reminder.app` (like the invite emails do via
  Resend), configure **Authentication → SMTP Settings** with your Resend
  SMTP credentials.
- **Spam folder** — first test emails almost always land in spam. Mark
  as "not spam" to train the filter.

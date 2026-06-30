# Notifications & Email — session runbook (2026-06-27)

Single source of truth for everything done in the "notifications & emails" session,
plus the exact steps to make it all live. Claude works in-repo only; every external
step (SQL apply, function redeploy, push, EmailCenter toggles) is Ofek's.

---

## 1. What we found (audit)

Five channels were mapped from code + live DB:

| Channel | State at audit |
|---|---|
| Transactional email (welcome / invite / share / admin reply) | ✅ working |
| Scheduled **reminder emails** (cron → dispatch-reminder-emails) | 🔴 **starved** — provisioning bug meant 14/564 users had settings; ~1 email/30d |
| Local device notifications (Capacitor) | ✅ working (native only) |
| In-app bell (`app_notifications`) | ✅ working |
| Server push (FCM/APNs) | 🟡 wired; Android 242 tokens, **iOS 0** |

Root cause of the reminder failure: `handle_new_user` did `ON CONFLICT (user_id)`
but `reminder_settings` had **no UNIQUE on user_id** (42P10) → every signup's
settings insert silently failed. **Fixed + proven** (31 reminder_test emails sent
after the constraint + backfill, up from 1).

---

## 2. What changed (by area)

- **Reminder provisioning** — UNIQUE(user_id) + backfill of all users (default email on).
- **Per-user control** — `notify_*` toggles + per-type days now persist to DB and are
  honored by both email and local notifications (default ON).
- **license / maintenance** — marked not-implemented + locked in EmailCenter (no candidate
  clause; they'd send 0 silently).
- **Email snooze** — `notifKeyToReminderType` fixed (was ignoring snoozes).
- **Email redesign** — test + insurance: countdown hero with urgency tiers
  (green >14d · amber 4-14d · red ≤3d), grammar at the edges ("יום"/"היום"),
  TZ-safe date, gov/app CTAs, neutral canvas + WCAG footer + logo fallback.
- **EmailCenter preview/test** — now renders the dispatcher-derived hero vars
  (`deriveReminderHeroVars` mirrored client-side) + validator no longer flags them.
- **Overdue email** — NEW one-time urgent email ~7 days after a test/insurance date
  passes unrenewed (`reminder_test_overdue` / `reminder_insurance_overdue`).
- **gov-sync notification** — warmer personal copy.
- **Business welcome** — premium email on business-account approval + matching
  "request sent" modal on submission (shared feature list in `src/lib/businessWelcome.js`).
- **Brand casing** — standardized to "CarReminder".
- **iOS push** — added the missing `CapacitorPushNotifications` pod to the iOS Podfile.

---

## 3. Commits (staging)

Earlier 7 already pushed; the last 3 are **pending push** (a1ebde3, a1a2571, ef774bb).

| commit | summary |
|---|---|
| `5954e93` | reminder provisioning fix + iOS push Podfile + license/maintenance lock + snooze |
| `b67c057` | per-user reminder control (notify_* + per-type timing) |
| `06ecee9` | warmer gov-sync / test-renewal copy |
| `1c87a06` | test + insurance email redesign (countdown hero, urgency tiers) |
| `b17ff6c` | render reminder hero vars in EmailCenter preview |
| `5a7a185` | validator stops flagging system-derived vars |
| `d231627` | test-send renders hero (derived-wins + guard) |
| `a1ebde3` | business welcome email + request-sent modal |
| `a1a2571` | brand casing → CarReminder |
| `ef774bb` | one-time overdue email (test + insurance) |

---

## 4. Deploy runbook (Ofek)

### 4a. SQL — run in Supabase SQL Editor, in this order
1. ✅ `supabase-reminder-settings-provisioning-fix-2026-06-26.sql` — **already applied, do not re-run**
2. `supabase-reminder-license-maintenance-not-implemented-2026-06-26.sql`
3. `supabase-add-reminder-notify-columns.sql` — **must precede #4 and the frontend push**
4. `supabase-reminder-overdue-emails-2026-06-27.sql` — this is the **final** `email_dispatch_candidates` (8 branches: upcoming + overdue) and supersedes the per-user-prefs migration, so you can **skip** `supabase-email-candidate-per-user-prefs-2026-06-26.sql`
5. `supabase-reminder-test-email-redesign-2026-06-26.sql`
6. `supabase-reminder-insurance-email-redesign-2026-06-26.sql`
7. `supabase-welcome-business-notification-2026-06-27.sql`

### 4b. Redeploy Edge Function
`dispatch-reminder-emails` — carries the snooze fix + hero/grammar/urgency/overdue/TZ-safe-date logic. The redesign + overdue templates render literally without it.

### 4c. Push staging
Brings the frontend (emailRender, emailValidate, SendTestDialog, ReminderSettingsPage DB_COLUMNS, business modal, brand casing). **Must come after SQL #3** or settings-save 500s on the missing columns.

### 4d. Enable in EmailCenter (when ready)
- `reminder_insurance` — works but off; enable when you want insurance reminders live.
- `reminder_test_overdue` / `reminder_insurance_overdue` — overdue triggers, off by default.
(Mind Resend's 100/day free-tier cap when enabling more types.)

---

## 5. Verification (after 4a–4c)
- Settings → התראות: change a toggle, save → no error (columns exist).
- EmailCenter → תבנית → בדיקה: send test for `reminder_test` at daysLeft 1 / 3 / 14 / 30
  → grammar ("יום"/"היום") + tier colors + real hero (not `{{heroBg}}`).
- Submit a business-account request → premium "בקשתך בדרך!" modal pops.
- After approval → business welcome email arrives.
- `SELECT notification_key,status,count(*) FROM email_send_log WHERE sent_at > now()-interval '1 day' GROUP BY 1,2;`

---

## 6. Open gates & known limitations
- 🔴 **Ship gate (business email + modal):** they advertise **AI invoice scan** and
  **power-of-attorney forms** — per our records AI scan was gated off and forms may be
  unpushed. Confirm both are LIVE before push, or swap those cards, or they over-promise.
- 🟡 **iOS push:** code + Podfile ready, but needs `pod install` / `cap sync ios` + a new
  Xcode build + App Store submission, and `APNS_USE_SANDBOX=false` on the prod build.
  Until then iOS `device_tokens` stays 0.
- 🟡 **Apple "Hide My Email" bounces:** sender domain likely not registered in Apple's
  Private Email Relay → every Apple-Sign-In hide-email user gets no email. Register
  `car-reminder.app` / `no-reply@` in Apple Developer + verify Resend SPF/DKIM.
- 🟡 **Vessel gov link:** the test reminder/overdue gov CTA uses the car renewal URL for
  all; vessels (כושר שייט) renew elsewhere. Thread `is_vessel` if vessel volume warrants.
- ℹ️ **Business welcome email** is code-rendered (not an EmailCenter-editable template).
- ℹ️ **Dual-render sync:** `deriveReminderHeroVars` is duplicated in the dispatcher (Deno)
  and `emailRender.js` (client) — keep in sync (both carry KEEP IN SYNC notes).

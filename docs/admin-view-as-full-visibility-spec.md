# Admin View-As — Full Visibility ("see everything he sees")

> ## ⚠️ SUPERSEDED — 2026-07-24
>
> §1 below is titled *"extend the split model (NOT JWT impersonation)"*. That
> decision was **reversed**: JWT impersonation is exactly what shipped. See
> **`docs/admin-impersonation-spec.md`**.
>
> The goal in this document was right and is now met — the admin sees the
> notification bell, notifications, reminders and profile of the person they
> are viewing. The *mechanism* proposed here (more `is_viewing_user()` policies,
> one per table) is what failed: it requires remembering every future table, and
> the count of un-escaped functions was 21 out of 22 when it was measured.
>
> Real impersonation makes `auth.uid()` the target, so every policy and RPC —
> including ones not written yet — behaves as it does for the real user. There
> is nothing left to enumerate.
>
> The status line below is also stale: view-as is no longer held, and sessions
> are now identified by **(user, account)** rather than by account alone.
>
> Kept for the requirements and the edge-case list. Do not build against §1.

**Status:** SPEC / not started. View-as itself is currently **HELD** (reverted in v6.3.0,
commit `75edc63`) pending Phase 1A-H + security sign-off. DB functions are live-but-dormant.
**Owner decision (2026-06-30):** Ofek wants full impersonation *visibility* — the admin,
while viewing an account, should see **everything the user sees**, including the notification
bell, notifications, reminders, and profile — not just the account's vehicles/documents.

---

## 1. Approach — extend the split model (NOT JWT impersonation)

Two ways to achieve "see everything he sees":

| | **A. Split model (CHOSEN)** | B. True impersonation |
|---|---|---|
| Identity | Admin keeps own JWT (`auth.uid()` = admin) | Client logs in AS the target (target JWT) |
| How data shows target | Each user-scoped read becomes view-as-aware, gated by `is_viewing` | Automatic — all queries are the target's |
| Audit | Every action stays attributable to the admin | Actions look like the *target* did them (audit breaks) |
| Blast radius of a bug | Contained (admin still admin) | Full account takeover |
| Effort | Per-surface wiring | Near-zero client wiring, high risk |

**Decision: A.** Same end-user experience ("I see what he sees") without the takeover/audit risk
that the split model was deliberately built to avoid. This spec is Approach A only.

---

## 2. Current state (baseline)

| Data class | Scope | View-as today |
|---|---|---|
| vehicles, documents, maintenance, expenses, routes, cork notes | `account_id` | ✅ shows target (activeWorkspaceId swap) |
| **notifications (bell + page)**, **reminder settings**, **profile**, **activity log** | `user_id` | ❌ shows the ADMIN (auth.uid) — the "Frankenstein" gap |

Account-scoped already works because view-as overrides `activeWorkspaceId`. User-scoped does not,
because view-as intentionally keeps `auth.uid()` = admin.

---

## 3. Core mechanism — an "effective user id"

`admin_view_sessions` already stores **`target_user_id`** (the account owner). We surface it so the
client and RLS can read the *target's* user-scoped rows during an active session.

- **State/hook:** extend `viewAsState` / `useViewAs()` to expose `targetUserId` alongside
  `targetAccountId` (populated from `admin_current_view` on hydrate + on `enterViewAs`).
- **Client helper:** `effectiveUserId = isViewAs() ? viewAs.targetUserId : user.id`.
  Every user-scoped read swaps `user.id` → `effectiveUserId` (and its react-query keys).
- **Server helper (RLS):** `public.is_viewing_user(p_user_id uuid)` returns
  `is_admin() AND EXISTS(active session whose target_user_id = p_user_id)`. Fail-closed,
  mirrors the existing `is_viewing(account_id)`. (Impl: resolve via `admin_view_sessions`.)

---

## 4. Surfaces to make view-as-aware (enumerated from code)

| Surface | File(s) | Table | Change |
|---|---|---|---|
| Notification **bell** | `src/components/shared/NotificationBell.jsx` | `app_notifications` | query `effectiveUserId`; react-query key includes it |
| **Notifications** page | `src/pages/Notifications.jsx` (`app-notifs`, `reminder-settings`, snooze) | `app_notifications`, `reminder_settings` | same; also `useReminderSnooze(effectiveUserId)` |
| **Reminder settings** | `src/pages/ReminderSettingsPage.jsx` | `reminder_settings` | read target's; **write = decision (§6)** |
| **Profile** | `src/pages/UserProfile.jsx`, `src/hooks/useUserProfile.js` | `user_profiles` | read target's; **write = decision (§6)** |
| **Activity log** | `src/pages/ActivityLog.jsx` | (user-scoped log) | read target's |
| **Upcoming reminders / snooze** | `src/components/dashboard/UpcomingReminders.jsx`, `src/hooks/useReminderSnooze.js` | reminders/snooze | `effectiveUserId` |
| push tokens | `src/lib/pushNotifications.js` (`device_tokens`) | — | **NOT** a display surface; leave on admin (no change) |

Guard: `useNotificationScheduler` must STAY disabled during view-as (already handled in the reverted
code) so we never schedule/deliver the admin's device notifications for the target's data.

---

## 5. RLS additions (all additive, fail-closed)

Session-gated SELECT policies (mirror the existing view-as read policies), keyed on the target user:

```sql
-- read the target's user-scoped rows during an active, audited view session
create policy view_select_notifications on public.app_notifications
  for select to authenticated using (public.is_viewing_user(user_id));
create policy view_select_reminder_settings on public.reminder_settings
  for select to authenticated using (public.is_viewing_user(user_id));
create policy view_select_user_profiles on public.user_profiles
  for select to authenticated using (public.is_viewing_user(user_id));
-- + activity/audit log table, same pattern
```

`is_viewing_user()` is `is_admin() AND active-session-with-matching-target_user_id` → zero effect on
regular users. Reads only (writes below).

---

## 6. Open decisions (need Ofek)

1. **Write access to user-scoped data in view-as?**
   - Reading the target's notifications/profile/reminders = clearly in scope ("see what he sees").
   - *Editing* them (e.g. change his reminder timing, mark his notifications read, edit his profile) —
     do we want that too? Default proposal: **read-only** for notifications + profile; **allow write**
     only for reminder settings (a plausible "I'll fix his reminders for him" support action). Confirm.
2. **Privacy scope** — anything to exclude from the admin's view? (e.g. profile ID/license image,
   private community DMs.) Default: include all app surfaces; the ToS support-access clause covers it.
3. **Marking-as-read side effects** — if the admin opens the bell, do we suppress "mark read" so we
   don't alter the target's unread state? Proposal: **yes, suppress mutations** while viewing.

---

## 7. Phase 1A-H — the prerequisite (why view-as is held)

view-as cannot be un-held until the pre-existing **unconditional admin read bypass** on 5 core tables
is tightened, so admin data access is session-gated end-to-end:

- Tables: `accounts`, `vehicles`, `documents`, `maintenance_logs`, `account_members` currently have
  `admin_select_all_*` policies with predicate `is_current_user_admin()` and **no session gate**.
- Blocker to tightening: `AdminDashboard` reads these tables directly (`AdminDashboard.jsx` ~427-432,
  ~1399-1402). Those must first move to admin SECURITY DEFINER RPCs, THEN the broad policies can be
  narrowed to `is_viewing()`-gated (or admin-RPC-only).
- Also: MFA on the admin account + a final `/security` pass.

---

## 8. Sequencing

```
1. Phase 1A-H         migrate AdminDashboard reads → admin RPCs; tighten 5-table bypass; MFA; /security
2. Un-revert view-as  restore commit 75edc63's 20 files (client + SQL), verify against live-dormant DB
3. Full-visibility    §3 effectiveUserId + §4 surfaces + §5 RLS  (this spec)
4. Ship 6.4.0
```

Steps 1–2 restore what shipped-then-held; step 3 is the new "see everything" layer.

---

## 9. Non-goals

- No true JWT impersonation (rejected — see §1).
- No change to the account-scoped surfaces (already correct).
- No delivery of the target's push/email to the admin's devices (scheduler stays off in view-as).

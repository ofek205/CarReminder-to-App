# Admin "View-As" (Impersonation) — Design Spec

> Status: design / pre-implementation. Target branch: `staging`.
> Goal: let an admin (Ofek) enter a specific account (personal OR business),
> see exactly what that user sees, and manage their vehicles — safely,
> auditable, and without identity confusion.

## 1. Chosen model — "split capability"

Two **separate** capabilities that combine in one screen:

1. **View-as (read-only)** — the admin keeps their own login (`auth.uid()` stays
   admin). The client's *active account* is overridden to the target account, so
   the real user screens render the target's data. Reads already work because the
   existing `admin_select_all_*` RLS bypass lets the admin read every account.
   No write-RLS broadening.

2. **Edit-as-admin (explicit RPC)** — editing the target's data is done through
   **admin SECURITY DEFINER RPCs** (`admin_update_vehicle`, `admin_delete_vehicle`,
   new `admin_add_vehicle`), NOT through impersonated user writes. The edit is an
   explicit admin action, attributed to the admin, side-effect-controlled.

Rationale: "see as them, edit as admin." Avoids write-RLS broadening, avoids
user-facing notifications firing from admin actions, keeps audit unambiguous, and
reuses RPCs that already exist.

Rejected alternatives:
- **Full JWT impersonation** — highest fidelity but mints a real user token,
  destroys audit attribution, and risks losing the admin's own session on native
  (Capacitor). Rejected.
- **RPC-only mirror screens** — huge duplication, drifts from the real UI.
  Rejected (except for the edit path, which is deliberately RPC-based).

## 2. Three findings from the deep code audit that shape the design

### Finding 1 (CORRECTNESS — showstopper for the naive approach)
`ensure_user_account()` is **auto-fired** in `WorkspaceContext.jsx:201`,
`GuestContext.jsx:123`, `vehicleQuickCheck.js:332`, `Dashboard.jsx:989` whenever
memberships look empty. It resolves to the **admin's own** personal account via
`auth.uid()` and would silently kick the admin out of view-as.
Additionally, the resolution effect in `WorkspaceContext.jsx:170-187` **resets**
any `activeId` that is not in the logged-in user's memberships — and the target
account is never in the admin's memberships.

→ Consequence: naively setting `activeId` to the target account **breaks**.
→ Fix: a **separate `viewAsId`** that takes precedence in the *exposed* value
   only (`activeWorkspaceId = viewAsId ?? activeId`), never written to the
   `cr_last_active_workspace` cache, and a **hard block** on `ensure_user_account`
   (and every auto-write RPC) while view-as is active.

### Finding 2 (SECURITY — mostly reassuring, with specific exceptions)
The membership / vehicle / share write RPCs are **safe** during view-as: they take
an explicit `account_id`/`vehicle_id` and re-check ownership/membership; since the
admin is **not** a member of the target account they fail with `not_authorized`.
The genuinely dangerous RPCs are:
- `admin_delete_account`, `admin_set_role`, `admin_delete_vehicle`,
  `admin_update_vehicle` — pass `is_admin()` and act on any id. They live only in
  admin UI; must stay out of the view-as surface (hide admin nav while view-as).
- `delete_my_account` — uses `auth.uid()` to delete the **admin's own** accounts.
  A footgun if reachable during view-as ("I thought I was deleting their account").
  Must be blocked/hidden in view-as.

→ Read-only view-as is safe **iff**: (a) admin nav hidden during view-as,
  (b) auto-write RPCs blocked, (c) edits go only through the explicit admin RPC path.

### Finding 3 (STATE HYGIENE — substantial)
~15 module caches / singletons / localStorage keys persist target data or get
polluted, and the device notification scheduler would schedule the **target's**
reminders on the **admin's** device. Highlights:
- `useNotificationScheduler` (`Dashboard.jsx:95`) loads the admin's reminder
  settings (`user.id`) and applies them to the target's vehicles, then schedules
  **local device notifications on the admin's phone** and writes non-user-keyed
  markers `cr_reminder_*` to localStorage. Must be **disabled** in view-as.
- `urlCache` (`useSignedUrl.js:35`) caches signed URLs 6 days — not cleared.
- `cr_last_active_workspace:<uid>` would be overwritten with the target account
  if we reused `switchTo` (we won't — `viewAsId` is separate and not persisted).
- crash log / breadcrumbs tagged with target identity; dashboard `VEHICLES_CACHE_KEY`
  snapshot; Capacitor `LocalNotifications` scheduled on device; realtime
  subscriptions firing during view-as.

→ Two mandates: (a) disable scheduler + device-token registration + analytics
  attribution during view-as; (b) a real **teardown** on exit (see §6).
→ Strongly prefer entering view-as in a **clean boot** (fresh navigation) so state
  starts clean and the admin's own tab/state is never mutated.

## 3. Data-scoping classification (which screens view-as covers)

Source: full route inventory.

- **Covered (account-scoped, follow the override):** Dashboard, Vehicles,
  VehicleDetail, AddVehicle/EditVehicle, Documents, Accidents, MyExpenses,
  Settings (hub), ReminderSettingsPage, ChecklistHub/Checklist/Editor/History,
  Community, Forms; **business:** BusinessDashboard, Fleet, Drivers, DriverDetail,
  Routes/CreateRoute/RouteDetail, FleetMap, ActivityLog, Expenses, MyVehicles,
  Reports, DrivingLog, BusinessSettings, Team, TeamManagement, BulkAddVehicles.
- **Blocked/hidden in view-as (user-identity scoped):** UserProfile,
  AccountSettings, Notifications, CreateBusinessWorkspace.
- **Blocked (footgun / system):** DeleteAccount, all `/Admin*`, EmailCenter.
- **Business UI fidelity:** the app auto-renders business vs personal UI from
  `activeWorkspace.account_type === 'business'` and redirects `/Dashboard` →
  `/BusinessDashboard` (`Dashboard.jsx:181`). So the synthesized view-as workspace
  object MUST carry `account_type` and a synthetic `role: 'בעלים'` so
  `useWorkspaceRole` resolves owner/business perspective correctly.

## 4. Database changes

Run as one SQL file (`supabase-admin-view-as.sql`), applied manually by Ofek.

### 4.1 Session table (governance/audit/expiry — NOT an access primitive)
```
admin_view_sessions(
  id, admin_user_id default auth.uid(), target_account_id -> accounts(id),
  target_user_id, reason, started_at, expires_at default now()+'60 min',
  ended_at
)
RLS: select own rows where is_admin(); writes via RPC only.
```

### 4.2 Read policies — fill the gaps
Existing bypass covers accounts/vehicles/documents/maintenance_logs/account_members.
Add `admin_select_all_*` (USING `is_current_user_admin()`) for: accidents,
vessel_issues, cork_notes, repair_logs, vehicle_expenses, routes (+ stops),
driver_assignments — everything a user screen reads.
Add Storage **read** policy for admin so photos/documents render.

### 4.3 RPCs (all SECURITY DEFINER, gated `is_admin()`, log via `admin_log`)
- `admin_start_view(p_account_id, p_reason)` → closes prior open sessions for this
  admin, inserts row, logs `view_start`, returns `{target_account_id, target_user_id,
  target_name, target_type, owner_email, expires_at}`.
- `admin_end_view()` → close open sessions, log `view_end`.
- `admin_current_view()` → active, unexpired session for boot revalidation.

### 4.4 Edit path (Phase 2)
- `admin_add_vehicle(p_account_id, p_payload jsonb)` (new) — insert into target
  account, log. Side effects: adding a vehicle does NOT insert `app_notifications`,
  so no push/email reaches the user by default (desired).
- Reuse existing `admin_update_vehicle`, `admin_delete_vehicle`,
  `admin_delete_vehicles`.
- Storage **write** policy for admin (upload photo/doc into target's path).

## 5. Client changes

### 5.1 WorkspaceContext — separate override
- New state `viewAs = { active, targetAccountId, targetUserId, targetName,
  targetType, expiresAt }`, hydrated on boot from `admin_current_view()` (only when
  `useIsAdmin()`), and via `enterViewAs(accountId)` / `exitViewAs()`.
- Exposed value: `activeWorkspaceId = viewAs.active ? viewAs.targetAccountId : activeId`.
  `activeWorkspace` = synthesized `{account_id, account_name, account_type, role:'בעלים',
  owner_user_id}` when view-as is active. **Never** write `cr_last_active_workspace`
  while view-as is active. `switchTo` is disabled while view-as is active.
- Guard the resolution effect (`:170-187`) and the auto-heal effect (`:192-205`)
  to no-op while view-as is active.

### 5.2 Hard guards (driven by a single `isViewAs` flag)
- Block `ensure_user_account` at all call sites when `isViewAs` (Finding 1).
- Disable `useNotificationScheduler` entirely when `isViewAs` (Finding 3).
- Skip device-token registration; suppress/redirect analytics attribution.
- Hide admin nav and block `/Admin*`, DeleteAccount, and user-identity screens
  while view-as (Finding 2 + §3).
- Read-only enforced server-side too: no write-RLS bypass exists, so user-screen
  writes simply fail; UI also hides write CTAs and shows "צפייה בלבד".

### 5.3 Entry point + banner
- "צפה בחשבון" button per row in AdminUsers / AdminUserDrawer → confirm dialog
  (reason optional) → `admin_start_view` → **fresh navigation** into the app in
  view-as mode (clean boot) → land on `/Dashboard` (auto-redirects to business if
  account_type=business).
- Global, resilient orange banner on every screen: "צופה בחשבון של <שם> · <countdown>
  · יציאה". Auto-exit on expiry.

### 5.4 Edit-as-admin (Phase 2)
- In view-as, an "עריכת אדמין" affordance opens a form wired to
  `admin_add_vehicle` / `admin_update_vehicle` / delete. On success: invalidate +
  refresh. Banner shows an "עריכה" tag.

## 6. Teardown on exit (must clear)
- `queryClient.clear()` (full) + invalidate.
- `urlCache` (signed URLs), feature-flag/admin module caches.
- localStorage: `VEHICLES_CACHE_KEY`, `app_error_log`/`app_error_queue`,
  `cr_reminder_*` markers, breadcrumbs (`clearBreadcrumbs()`).
- Capacitor `LocalNotifications.removeAllNotifications()`.
- Restore admin's real `activeId` (it was never overwritten, so just drop `viewAs`).
Best mitigated by entering view-as in a fresh boot so the admin's own state is
never mutated in the first place; the teardown then mostly protects the device
(scheduler/notifications) and module caches.

## 7. QA matrix (gate 4)
existing user w/ data · new/empty account · personal vs business · driver-only
account · reload mid-session (server revalidates) · expiry auto-exit · offline
(block enter; degrade gracefully) · RTL · mobile + Capacitor (no session swap →
no lock risk) · admin-on-admin · non-admin calling RPCs → `42501` · exit restores
admin's own workspace cleanly.

## 8. Open decisions
1. Same-tab vs new-tab (web) entry. Native has no tabs → in-app clean reset.
2. Role-level vs account-level view (v1 = account/owner perspective).
3. Privacy: ToS line + whether to log *views* (not just edits).
4. Dedicated staging test accounts (DB shared with prod).

## 9. Build order (on staging)
1. Phase 1A — DB: `supabase-admin-view-as.sql` (table + 3 RPCs + read policies +
   storage read). Ofek runs.
2. Phase 1B — Client: WorkspaceContext `viewAs` override + hard guards + entry +
   banner + teardown. Verify in preview with a test account.
3. `/security` review of the full design.
4. Phase 2A — DB: `admin_add_vehicle` + storage write.
5. Phase 2B — Client: "עריכת אדמין" inside view-as.

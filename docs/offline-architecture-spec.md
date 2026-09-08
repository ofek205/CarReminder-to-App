# Offline-First Architecture — Full Spec (seam + read + write)

> Status: design / pre-implementation. Target branch: `staging`.
> Decision (Ofek, 2026-06-29): **full offline** — a unified Data Access seam,
> offline reads (cache), AND offline writes (outbox + sync). Built "from the
> root" — offline is a property of one seam, not a patchwork of guards.
> Grounded in a 5-agent codebase audit (RQ-persistence, read hazards,
> write-path blast-radius, identity/security, native/Capacitor).

> ⚠️ **Scope honesty.** This is the hardest tier. It is built **incrementally over
> several weeks**, each phase shippable on its own. The hard problems
> (conflict resolution, RLS rejection at flush, local IDs, file uploads) are
> solved once, in the seam. Do NOT attempt a big-bang.

---

## 0. The principle — one Data Access seam

**Root cause of "plaster on plaster":** there is no single seam for data access.
Entity CRUD goes through `makeEntity` (`supabaseEntities.js`), but **>half the
writes bypass it** and call `supabase.rpc(...)` / `supabase.from(...)` directly
(expenses, repairs, maintenance, drivers, sharing, community, vehicle-delete).
So every cross-cutting capability (timeout, offline, error-handling, telemetry)
needs a separate patch in every screen.

**The fix:** every server interaction — table CRUD, RPC, storage — goes through
**one Data Access Layer (DAL)**. Screens never call `supabase.*` directly. The DAL
owns: timeout, online detection, read-cache, **normalized errors** (this kills the
"8 scattered try/catch" problem at the root), and the **write outbox**. Adding
offline support to any mutation = registering it in the DAL, not patching a screen.

```
            ┌─────────────────────────────────────────────┐
  Screens → │                 DAL (db.*)                  │
            │  reads ─► React Query (+ IDB persistence)   │ ─► Supabase (RLS)
            │  writes ─► Command Registry ─► Outbox ─► Sync│
            │  (optimistic apply to cache; flush online)  │
            └─────────────────────────────────────────────┘
                         ▲ local store (IndexedDB) ▲
```

---

## 1. Verified current state (grounded facts)

| Fact | Value | Source |
|---|---|---|
| `@tanstack/react-query` | 5.90.21 installed (`^5.84.1`) | node_modules / package.json:79 |
| Persister / outbox today | **none** | query-client.js:4, App.jsx:229 |
| Default `gcTime` / `staleTime` / `retry` | **10 min** ⚠️ / 5 min / 1 | query-client.js:34-36 |
| `networkMode` | implicit `'online'` | grep: 0 |
| `__APP_VERSION__` Vite global | exists (`6.2.0`) | vite.config.js:15-17 |
| Native origin | `https://localhost` / `capacitor://localhost` (NOT file://) | capacitor.config.ts |
| `@capacitor/network` | **not installed** | package.json |
| Optimistic updates (`onMutate`) today | **none** | grep |
| Entity CRUD choke-point | `makeEntity` create/update/delete via `withTimeout` | supabaseEntities.js:220-254 |
| Write surface that BYPASSES the entity layer | >half — direct `supabase.rpc`/`.from` | write-path audit (§5) |
| `vehicles.updated_at` | **does NOT exist** (only `created_at`) ⚠️ conflict-detection gap | [[project_db_perf_gotchas_2026_06_25]] |
| Signed-URL TTL / in-mem cache | 7 days / 6 days | supabaseStorage.js:19, useSignedUrl.js:38 |
| Ad-hoc vehicle persistence | `useMyVehicles` mirrors to storage + initialData | useMyVehicles.js:114,121 |

---

## 2. The DAL seam (Phase 0 — consolidation, no behavior change)

Extend the existing `db` object (`supabaseEntities.js`) into the single seam.

**Reads:** keep `db.<entity>.filter/get/list` (already there). They feed React Query.

**Writes — a Command Registry.** Every mutation becomes a named *command* with a
declarative descriptor, instead of an ad-hoc `supabase.rpc`/`.from` call in a screen:
```js
defineCommand('expense.create', {
  offlineCapable: true,
  entity: 'vehicle_expenses',
  // apply optimistically to the RQ cache (so UI updates offline)
  optimistic: (cache, payload, localId) => /* insert row with id=localId */,
  // how to execute against the server (table op OR rpc)
  run: (payload) => supabase.from('vehicle_expenses').insert(payload)...,
  // conflict policy override (default: last-write-wins, §6)
  conflict: 'lww',
});
```
- **All current bypass RPCs become commands** (`save_repair_with_children`,
  `delete_vehicle_with_share_choice`, expense/driver RPCs, etc.) — moved out of
  screens into the registry. This is the bulk of Phase 0 refactor.
- Screens call `db.run('expense.create', payload)` — never `supabase.*`.
- **Error normalization** lives here: one place maps Supabase/RLS/timeout/offline
  errors to typed errors + clean Hebrew messages. Removes the need for the 8
  scattered try/catch fixes — they become one path.

**Phase 0 ships with NO behavior change** — the app works identically, but now every
read and write goes through one seam. Verify nothing broke (build + `/qa`), commit.
*(This is the foundation; everything below hangs off it.)*

---

## 3. Offline-capable boundary (principled, not arbitrary)

Not every command can or should work offline. Each declares `offlineCapable`:

**✅ OFFLINE-CAPABLE — owner-scoped, simple, plausibly edited in the field:**
vehicle field edits + add-vehicle, mileage update, expenses (add/update/delete),
maintenance logs, repairs (save-with-children), tasks, checklist runs/ticks,
cork notes, accidents (create), vessel issues, reminder settings, user profile,
repair-types, maint-prefs.

**🌐 ONLINE-REQUIRED — multi-party / transactional / security / social:**
sharing (share/revoke), `delete_vehicle_with_share_choice` (cascade + notifies
recipients), ownership transfer, member invites + role changes, account deletion,
business-workspace creation, driver-assignment changes (role-sensitive), all
community (posts/comments/likes/blocks), all admin + view-as.

**Why this is principled, not a patch:** offline-write is for *your own data*;
online-required is for operations that touch *other parties, money-like cascades,
or security*. Online-required commands **fast-fail offline** — but via ONE
declarative `offlineCapable:false` rule in the seam, with a clean toast, not 8
scattered guards. (This subsumes the entire "fast-fail" section of the old Tier-1 plan.)

---

## 4. Read-cache (offline reads)

Persist the React Query cache to IndexedDB. (Most of this was already designed and is unchanged.)

**Packages (Ofek `npm i`):** `@tanstack/react-query-persist-client@^5.90.0`,
`@tanstack/query-async-storage-persister@^5.90.0`, `idb-keyval@^6.2.1`.

**🛑 BLOCKER — raise `gcTime` to ≥ `maxAge`.** Current 10 min < 24h `maxAge` →
restored cache evaporates within minutes (RQ v5 hard rule). Fix `query-client.js:36`
→ `gcTime: 24h`. Only one per-query override exists (`useDisabilityPermit.js:42`, already 24h ✓).

**Config:** `PersistQueryClientProvider` (App.jsx:229) with async IDB persister,
`buster: __APP_VERSION__` (every release busts the cache — shape-drift safety),
`maxAge: 24h`, `throttleTime: 1000`. **Keep `networkMode:'online'`** (NOT
offlineFirst — offlineFirst adds 8s `withTimeout` stalls + floods `query_failed`
telemetry; under 'online' an offline query pauses instantly and serves cache).

**ALLOWLIST persisted keys** (allowlist, not denylist — `query-persist-allowlist.js`):
vehicles, vehicle, my-vehicles, my-vehicles-detail, vehicles-list, documents,
maintenance-logs-v2, repair-logs, tasks-v2, cork-notes, vessel_issues,
vessel_checklists(+runs), accidents, user-profile, user-workspaces,
reminder-settings, repair-types, maint-prefs, disability-permit, expenses (view-only).
**Never persist:** `is-admin` (auth decision!), all `admin-*`, `view-as-accounts`,
`community_*`/`blocked_users` (stale block-list = safety regression), `app-notifs`,
`routes/fleet-map/driving-log/biz-dash-*` (live dispatch), `vehicle-share*`/
`transfer-candidates`/membership keys (gate destructive/role actions — §6c).

**🛑 Signed-URL hazard.** Rows embed `vehicle_photo`/`file_url`/`extra_file_urls`
(7-day signed URLs) → broken offline. **Strip these on dehydrate** (`serializeData`),
keep `*_storage_path`; re-derive the URL online via `useSignedUrl`, placeholder
offline. Add `VehicleImage` `onError`→placeholder (VehicleImage.jsx:47). `maxAge:24h`
caps residual staleness.

**Verify:** do `cork-notes`/`accidents` rows embed attachment URLs? does the
`light:true` `vehicles-list` select include `vehicle_photo_storage_path`?

---

## 5. Write engine (offline writes) — outbox + sync

The heart of Tier 2. All offline-capable commands flow through this:

### 5.1 Optimistic apply + local IDs
- On `db.run(cmd, payload)` while offline (or always, optimistic-first): generate a
  **client UUID** (`crypto.randomUUID()`) for creates; apply the command's
  `optimistic()` to the React Query cache so the UI updates instantly; enqueue to outbox.
- The server must accept an **explicit `id` on insert** (Supabase allows it if the
  column default is overridable). ↳ **Verify per offline-capable table** that RLS
  `WITH CHECK` doesn't reject client-supplied ids.

### 5.2 The outbox (durable mutation queue)
- A dedicated IndexedDB store (`idb-keyval` or a small `idb` object store), **separate
  from the RQ cache**, survives reload/crash/kill.
- Each item: `{ opId (uuid), command, payload, localId, createdAt, attempts, status }`.
- FIFO, ordered per-entity (so dependent writes replay in order — e.g. create then update).

### 5.3 Sync engine (drain on reconnect)
- Subscribe to `onlineManager` → on online, drain the outbox: replay each item via the
  command's `run()`, with retry + exponential backoff.
- **Idempotency:** creates upsert on the client `id` (replay-safe); updates/deletes are
  naturally idempotent. Complex commands need an idempotency key — but offline-capable
  ones are simple table ops, so this stays tractable.
- **Auth at flush:** the JWT may have expired offline (>1h). `autoRefreshToken` handles
  it if the refresh token is valid; if not, pause the queue and prompt re-auth (don't drop writes).
- `onSuccess` of the persist provider calls `resumePausedMutations()` — wire the outbox drain here too.

### 5.4 RLS rejection / conflict at flush (the "failed-sync inbox")
A queued write can be **rejected at flush** (permission revoked, row deleted by another
device, validation, RLS `42501`). **Never silently drop.** Terminal failures move to a
**failed-sync inbox** surfaced in the UI ("3 changes couldn't be saved — review"), with
the option to retry or discard. This is a first-class state, not an afterthought.

### 5.5 Conflict resolution
- **Default: last-write-wins (LWW) at row level**, using `updated_at` where present.
- 🛑 **DB prerequisite:** `vehicles` has **no `updated_at`** (only `created_at`) — and
  likely other tables. LWW conflict detection needs `updated_at` + a trigger on every
  offline-write table. **Ofek runs the SQL** (add `updated_at timestamptz default now()`
  + `BEFORE UPDATE` trigger). Without it, "last sync to arrive wins" — acceptable for
  one-user-multi-device, riskier for shared rows (another reason shared/business data is
  online-required in §3).
- Per-command `conflict` override for the rare case that needs field-merge.

### 5.6 File uploads offline (photos/documents)
- Offline: store the blob in IndexedDB/Filesystem, create the row with a **local
  reference + pending `storage_path`** (NOT base64 in the DB row — the existing
  base64-guard `assertNotBase64`/`guardFileFields` stays intact). Enqueue an upload command.
- On reconnect: upload to Storage → get `storage_path` → patch the row → drop the local blob.
- Until upload completes, `VehicleImage`/doc viewer render from the local blob URL.

---

## 6. 🔐 Security — clear ALL local stores on identity boundaries

Persisted cache **and the outbox** = customer data at rest. Wipe both wherever identity
changes, or data bleeds across users / survives a view-as session on the admin's device.
Most of these paths don't even clear the in-memory cache today.

Wire `clearPersistedCache()` + **`clearOutbox()`** (+ `queryClient.clear()`) at:

| Sev | Site | file:line |
|---|---|---|
| SEV-1 | `exitViewAs` (clears in-mem; add disk + outbox) | WorkspaceContext.jsx:296-305 |
| SEV-1 | `enterViewAs` | WorkspaceContext.jsx:271-292 |
| SEV-1 | identity-change effect (`user?.id`) | WorkspaceContext.jsx:196-203 |
| SEV-1 | central sign-out listener — **the logout chokepoint** | GuestContext.jsx:307-330 |
| SEV-1 | account deletion (both `account` + `data` modes) | DeleteAccount.jsx:80-99 |
| SEV-2 | two `handleLogout` copies (or fold into the listener) | Layout.jsx:261,414 |
| SEV-2 | PinLock sign-out (covered via listener — verify SIGNED_OUT fires) | PinLock.jsx:146,181 |

**⚠️ Outbox-on-logout decision:** if a user signs out with **unsynced offline writes**,
clearing the outbox loses them. Options: (a) block sign-out while outbox non-empty
("יש שינויים שטרם נשמרו"), (b) flush-then-logout, (c) warn + discard. Recommend (a)/(b).
This is a real product decision — see §10.

**Structural defenses:** persist/queue **only when authenticated** (no guest); scope the
IDB stores by `user.id` so a stale store can't be read after identity change.
**PII:** `useUserProfile` caches phone/birth-date/license — own data, OK *given* the
clears. **ת.ז confirmed NOT in any RQ cache** (localStorage only). ✓

---

## 7. Native (Capacitor)

1. **Add `@capacitor/network`** (decisive) — `navigator.onLine` + browser events are
   unreliable in WKWebView/Android WebView; `onlineManager` defaults to them. Wire on
   native: `Network.addListener(... onlineManager.setOnline(s.connected))` + seed with
   `getStatus()`. Web keeps the reliable default. After install → Ofek `npx cap sync`.
   ↳ The offline guard + sync engine both read `onlineManager.isOnline()` — single source of truth.
2. **IndexedDB works** on the custom-scheme origins (real secure origins). Wrap every IDB
   op in a 2.5s `Promise.race` timeout (WKWebView open-hang bug; mirrors `supabase.js`
   `raceWithFallback`). Treat the cache as best-effort/disposable (iOS 7-day eviction →
   cold fetch). The **outbox is NOT disposable** — but iOS eviction of script storage can
   still drop it; mitigate by flushing aggressively on reconnect and warning on long offline spells.
3. **Boot stays non-blocking** — `main.jsx` has a 7s auth watchdog + 8s splash; persister
   hydrates async and renders children immediately. Never gate `ReactDOM.render` on restore
   or outbox load; swallow failures (proceed cold). Verify `window.__crAuthResolvedAt` isn't delayed.
4. No base64 in the cache/DB (quota + base64-guard).

---

## 8. UI surfaces

- **OfflineBanner** (`Layout.jsx`, pattern of StagingBanner/ViewAsBanner) — sticky cue
  while offline: *"אתה במצב לא מקוון — שינויים יסונכרנו כשתחזור לרשת."* RTL, thumb-reach, safe-area.
- **Pending-sync indicator** — small badge/cue when the outbox is non-empty ("N שינויים ממתינים לסנכרון").
- **Failed-sync inbox** — a screen/sheet listing rejected writes (retry/discard). First-class state.
- **Per-item optimistic state** — rows created offline show a subtle "ממתין לסנכרון" tag.
- Per CLAUDE.md playbook: every UI covers default/loading/empty/error/**offline**; RTL;
  mobile-first; verify in preview. Copy via `/copywriter` where it's user-facing.

---

## 9. Incremental build order (each phase shippable)

| Phase | What | Ships |
|---|---|---|
| **0** | **The seam** — route ALL data access through the DAL; move bypass RPCs into the command registry; normalize errors. **No behavior change.** | Refactor only; `/qa` proves parity |
| **1** | **Read-cache** — persister + allowlist + URL-strip + gcTime fix + OfflineBanner (read-only offline). | Offline reads work |
| **2** | **Detection + guard** — `@capacitor/network` + `onlineManager` wiring; `offlineCapable:false` commands fast-fail cleanly. | Clean offline write-blocking |
| **3** | **Outbox core** — durable queue + sync engine + optimistic apply + local UUIDs, proven end-to-end on **ONE** command (mileage or expense). | First real offline write |
| **4** | **Expand coverage** — register the rest of the offline-capable commands, one at a time. | Offline write across owner data |
| **5** | **File-upload queue** — offline photos/docs → Filesystem → upload on reconnect. | Offline media |
| **6** | **Failed-sync inbox + conflict UI** — surface RLS rejections / conflicts. | Robust sync UX |

**DB prerequisites (Ofek runs SQL, gated by §5 of CLAUDE.md):** add `updated_at` +
update-trigger to every offline-write table; verify client-supplied `id` inserts pass RLS.
Each phase: build + lint clean, `/code-review` + `/qa`, `commit-gatekeeper`, commit to staging.

---

## 10. Open decisions (Ofek)

1. ✅ **DECIDED (2026-06-29): warn + discard.** On logout with a non-empty outbox, show a clear warning that unsynced changes will be lost; on confirm, discard + logout. (Ofek's call; revisit to flush-first if data loss bites.) Implication: the OfflineBanner/pending-sync cue must make "ממתין לסנכרון" visible enough that a user knows before logging out.
2. **Conflict policy** — LWW default OK? Any entity needing field-merge?
3. ✅ **DECIDED (2026-06-29): single-writer rule.** Offline-write is allowed for single-writer data — including a driver's own fleet actions (`vehicle.driverUpdateMileage`, `route.updateStopStatus`, `route.addStopDocumentation`). Genuinely multi-writer/shared rows (a vehicle shared with others, shared business records) stay online-required. The `offlineCapable` flag per command encodes this; when in doubt about a business command, default to online-required.
4. **`updated_at` rollout** — add to which tables, and when (it's a prerequisite for clean conflict detection).
5. **Effort appetite** — phases 0-2 alone deliver "offline reads + clean offline behavior" (the 80%); phases 3-6 are the genuine offline-write build. Stop after 2 and reassess, or commit to the full run?

---

## 11. Risks & tradeoffs

- **Biggest lift of all tiers** — weeks of incremental work; each phase de-risks the next.
- **Phase 0 refactor touches many screens** (moving bypass writes into the seam) — behavior-preserving but broad; `/qa` parity check is mandatory.
- **Conflict + RLS-rejection** are inherent to offline-write; the failed-sync inbox is the honest mitigation (no silent data loss).
- **iOS storage eviction** can drop the outbox on long offline spells — flush aggressively, warn.
- **Testing on shared prod DB** (staging=prod) — dedicated test accounts; test sync on device.
- **`updated_at` gap** is a real DB prerequisite, not optional, for safe conflict handling.

---

## Appendix A — Command inventory (from full audit, 2026-06-29)

**~83 distinct writes: ~38 offline-capable / ~45 online-required (≈46/54).** Full
per-row table (command · mechanism · table · file:line · class · side-effects ·
optimistic-difficulty) is in the audit transcript; key design inputs distilled here.

**Three mechanisms coexist** and the registry unifies them:
- entity-layer (`db.<e>.create/update/delete`) — most offline-capable writes.
- `supabase.rpc(...)` — **expenses are RLS-locked to RPCs** even for single-row writes
  → the registry MUST support an `rpc` backend per command, not just table CRUD.
- direct `supabase.from(...)` — e.g. `cork_notes` is written BOTH via `db.cork_notes`
  AND raw `supabase.from('cork_notes')` (TasksSection) → unify in the registry.

**Dependent side-effects:** `notify_vehicle_change` / `notify_community_comment`
are fire-and-forget AFTER a parent write — model as derived effects of the parent
command, NOT independent outbox entries.

**Storage uploads are the hard boundary** (`useFileUpload`/`uploadToBucket`): every
MEDIUM-difficulty command's cost is a paired multi-MB upload → out of the outbox-v1
PoC; handled in Phase 5.

**Offline-capable domains:** vehicles (field edits, mileage, delete-unshared, scan,
driver-mileage/event, bulk-add), expenses, maintenance + maint-prefs, repairs
(save/delete) + repair-types, documents, accidents, vessel-issues, checklists,
cork-notes + tasks, notifications (log/markRead/snooze/device-token), profile,
reminder-settings, route stop-status/documentation (field driver), user-preferences.
**Online-required:** all sharing, members/team/business, ownership transfer, account
provisioning/deletion, drivers/fleet/route-create, ALL community, ALL admin/view-as.

## Appendix B — Seam API (the registry)

```js
// src/lib/dal/commands.js — one descriptor per write
defineCommand('vehicle.updateMileage', {
  offlineCapable: true,
  table: 'vehicles', kind: 'update',
  run: ({ id, current_mileage }) => db.vehicles.update(id, { current_mileage }),
  optimistic: (qc, { id, current_mileage }) => /* patch cached vehicle row */,
  invalidates: ({ id }) => [['vehicle', id], ['vehicles'], ['my-vehicles']],
  conflict: 'lww',
});
defineCommand('expense.create', {            // RLS forces an RPC backend
  offlineCapable: true, table: 'vehicle_expenses', kind: 'rpc',
  run: (p) => withTimeout(supabase.rpc('add_vehicle_expense', p), 'expense.create'),
  optimistic: (qc, p, localId) => /* insert row id=localId */,
  invalidates: () => [['vehicle-expenses'], ['expenses']],
});
defineCommand('share.revoke', {              // online-required → ONE declarative rule
  offlineCapable: false,
  run: (p) => withTimeout(supabase.rpc('revoke_vehicle_share', p), 'share.revoke'),
  invalidates: (p) => [['vehicle-shares', p.vehicleId], ['vehicle-share-info', p.vehicleId]],
});
```

```
db.run(name, payload):
  cmd = registry[name]                          // throws if unknown
  if onlineManager.isOnline():
     r = await cmd.run(payload); invalidate(cmd.invalidates(payload)); return r
  else if !cmd.offlineCapable:
     throw new OfflineError()                    // clean Hebrew toast, ONE rule (kills 8 scattered patches)
  else:                                          // offline + capable (Phase 3+)
     localId = payload.id ?? crypto.randomUUID()
     cmd.optimistic(queryClient, payload, localId)   // UI updates instantly
     enqueueOutbox({ opId, name, payload, localId }) // durable IDB queue
     return { id: localId, _pendingSync: true }
```

**Phase 0 is itself incremental (NOT big-bang):** introduce `db.run` + registry, then
migrate call sites **domain by domain**, each verified by `/qa`. Un-migrated sites keep
working the old way until migrated. Migrate the **bypass writes first** (the direct
`rpc`/`from` calls that currently escape all cross-cutting concerns). Until Phase 3 the
offline branch is stubbed (offline-capable still just runs / fails like today) — so
Phase 0 changes **routing only, behavior identical**.

**PoC slice (Phase 3):** `vehicle.updateMileage` (flagship) + `corkNote.create` +
`reminderSettings.update` — exercises insert + update + entity routing with zero files,
zero children, zero server-computed dependencies.

---

## Appendix C — Progress tracker

Legend: `[x]` done · `[~]` in progress · `[ ]` todo. Commits are on `staging`.

### Phase 0 — route every write through the seam ✅ COMPLETE (2026-09-07)
**119 commands in 19 `src/lib/dal/commands/*.js` files. The invariant now holds: no screen writes to supabase directly**, except the 3 deliberate exclusions below. Behavior-preserving throughout; each domain was its own commit, each verified with full-project `eslint .` (0 errors) + `vite build`.
Foundation. Behavior-preserving; each domain = its own commit.

- [x] **seam core** — `src/lib/dal/{registry,run,index}.js`, `dal.run` (`d355041`)
- [x] **expenses** — expense.{create,update,delete} (`d355041`)
- [x] **cork_notes + tasks** — corkNote.{create,update,delete}, task.{create,toggleDone,delete} (`b6ed878`)
- [x] **vehicles** — vehicle.{update,create,delete}, all 18 sites (`82c74ac` mileage + completion, `4cc97cc` the rest). Still to register: `vehicle.bulkAdd`, the driver RPCs (driverUpdateMileage, driverLogEvent), and the ONLINE-REQUIRED `deleteWithShareChoice`
- [x] **maintenance** — maintenance.{create,update,delete} (was direct-from) + maintPref.{create,update,delete} (`2fb6d8e`)
- [x] **repairs** — repair.save (`save_repair_with_children` rpc, HARD), repair.delete, repairType.{create,update,delete} (`06bb1d4`). ⚠️ `repair.save` returns the raw `{data,error}` envelope — **Phase-2 task: normalize it** (its 2 call sites branch on `error` differently)
- [x] **documents** — document.{create,delete} (`93df04a`)
- [x] **accidents** — accident.{create,update} (`93df04a`)
- [x] **vessel-issues** — vesselIssue.{create,update,delete} (`d78fab8`)
- [x] **checklists** — checklist.{create,update}, checklistRun.{create,update} (`72f8260`, which also closed 2 writes missed by earlier slices)

**Verified remaining entity-layer writes (swept 2026-09-07, excluding src/lib/dal):** user_profiles ×6 (UserProfile, CompleteProfileScreen) · reminder_settings ×3 + reminder_snoozes ×1 · notification_log ×3 (notificationChannels, MaintenanceSection) · community ×3 (online-required) · contact_messages ×1 (admin, online-required). Plus the non-entity bypasses still to route: direct `supabase.from` in TasksSection-style spots already done, but community/notifications/admin/sharing/drivers/routes RPCs remain. **Re-run the sweep rather than trusting this list** — two misses were found that way:
`grep -rnE "db\.[a-z_]+\.(create|update|delete)\(" src/ | grep -v "^src/lib/dal"`
- [~] **notifications** — notificationLog.{create,markRead} + reminderSnooze.{upsert,delete} done (`2d0f8a1`). TODO: `appNotification.markRead` (bulk `.in('id', ids)` / `.eq` writes in NotificationBell, Notifications, PendingInviteBanner — needs a bulk command shape) + `deviceToken.register`
- [x] **profile / settings** — profile.{create,update}, reminderSettings.{create,update} (`2d0f8a1`). Remaining odds and ends: contact, review, analytics, crashReport, popupEvent, userPreferences.upsert (all fire-and-forget / telemetry)
- [x] **routes** — route.updateStopStatus + route.addStopDocumentation (offlineCapable), route.createWithStops (online-required: transactional + server geocoding) (`6414563`)

**The 3 envelope commands (Phase-2 normalization list):** `repair.save`, `reminderSnooze.upsert`, and the 3 `route.*` — these resolve to the raw supabase `{data,error}` because their call sites branch on `error` (or need `data`) rather than using try/catch. Normalizing them means touching call-site control flow, which is why it is Phase 2, not Phase 0.
- [~] **ONLINE-REQUIRED** (`offlineCapable:false`): ✅ sharing (5) + members/team/business (7) via `access.js` (`54c4457`); ✅ drivers + assignments (6) via `drivers.js` (`4f1aced`); ✅ route.createWithStops; ✅ community feed (18 sites / 16 commands) via `community.js` (`4a291a9`); ✅ admin console (22 sites / 17 commands) via `admin.js` (`53e6d8e`); ✅ the remainder — deleteWithShareChoice, bulkAdd, driver field RPCs, notify_vehicle_change, account provisioning/deletion, workspace pref, single-row notification mark-read (`c745914`); ✅ email admin + telemetry (`7992937`). Nothing left except the 3 exclusions. Historical TODO list: `vehicle.deleteWithShareChoice`, `notify_*` side-effects, `appNotification` bulk mark-read, `deviceToken.register`, `account.{ensure,claimMigrated,deleteMine}`, `vehicle.bulkAdd`, driver mileage/event RPCs

---

## Appendix D — Known-open offline issues (audited, triaged, NOT fixed)

Five agents audited Phase 0 + Phase 1 on 2026-09-07. Nine bugs were found and
fixed (see the commits from `b9f7d34` to `79c3508`). What follows is everything
that was found and **deliberately left open**, with the reasoning and a fix
recipe, so the next person does not have to re-derive any of it. **None of
these can destroy or silently corrupt data** — that class was closed.

| # | Issue | Severity | Why not fixed now | Fix recipe |
|---|---|---|---|---|
| D-1 ✅ **CLOSED 2026-09-08** | ~~**Empty-state flash during restore.**~~ Fixed centrally by `RestoreGate` in App.jsx (`useIsRestoring()`), so the 14-screen sweep below was never needed. See the Phase-2 cleanup entry for the two scoping decisions (never gate `/`; use LoadingSpinner, not SuspenseFallback). Original entry follows for context. **Empty-state flash during restore.** While the cache restores, React Query reports `isLoading === false` with `data === undefined`, so screens gated on `isLoading` fall through to their empty state ("no documents") instead of a skeleton. Before the persister they showed a skeleton. | LOW (cosmetic, bounded) | The window is normally tens of ms, worst case ~2.5 s on a wedged WKWebView IDB, and the data appears as soon as restore finishes — it is a flash, not a wrong resting state. The fix touches **14+ screens**, which is a lot of churn to add on top of a large untested change set. | `useIsRestoring()` from `@tanstack/react-query`; OR it into each screen's loading condition (`if (!accountId \|\| isLoading \|\| isRestoring)`). Do it as its own commit, screen by screen. |
| D-2 ⚠️ **RE-GRADED 2026-09-08 → LOW, accepted** | Re-examined against the code rather than re-stated, and the residual risk is much narrower than MEDIUM implied. **What was verified:** (1) `refetchOnReconnect` is set nowhere in `src/`, so React Query's default of `true` applies and `user-workspaces` re-validates automatically on reconnect — combined with `staleTime: 30s` and `refetchOnMount: 'always'` (useWorkspaces.js), the ONLINE window is already closed, which was half the original concern. (2) `role` is stripped on dehydrate (query-persister.js:92) and `activeWorkspace?.role ?? null` (useAccountRole.js:47,70) makes **every capability check false offline**, so a stale membership unlocks no permission. (3) Phase 2's guard refuses every write offline. So the exposure is exactly: **offline only, up to the 24h maxAge, read-only, no capability, and limited to rows this device had already downloaded under a then-valid grant.** Nothing new is fetched and nothing is writable. Worth stating plainly: those bytes sit in IndexedDB on that person's own device and are readable with devtools no matter what our JS decides, so this is about the app not presenting a stale grant as current, not a hard boundary. **Deliberately NOT fixed with a trust TTL.** The only real fix, expiring `status` sooner than the cache, means that after N offline hours no workspace resolves and offline reads — the entire feature — stop working for every legitimate user, to shorten a read-only window on data already on the device. That is the wrong trade at this severity. 🛑 **Ofek's knob if he ever wants it:** pick a membership trust window (8h/12h) and restored memberships older than it stop granting, falling back to the existing "no memberships" state. Original entry follows. **`status` on `user-workspaces` is an authorization verdict on disk.** `status === 'פעיל'` is the membership grant test (`isGrantedMember`), and it is the same predicate RLS uses. A user removed from a fleet keeps a `'פעיל'` row locally, so their persisted account-scoped entries still resolve and render. | MEDIUM | `role` was strippable because it fails closed. `status` cannot be stripped the same way: without it no workspace resolves offline at all and the feature dies. It needs a freshness rule, not a field removal, and that is a design decision about how stale a membership may be. | Either persist `status` with a short independent TTL and treat an expired one as "unknown, read-only", or re-validate memberships on reconnect before trusting persisted account-scoped data. |
| D-3 ⚠️ **HALF CLOSED 2026-09-08** | **The security half is FIXED**, the cosmetic half remains. `shouldDehydrateQuery` now refuses to write anything unless `cr_has_session` is present, so the leak — a background tab that had not yet processed SIGNED_OUT re-persisting the previous identity's rows after another tab wiped memory and disk — is closed: localStorage is shared across an origin's tabs, so the moment any tab signs out every tab stops persisting, and a late writer can only produce a snapshot with no queries in it. `cr_has_session` is used rather than the user id because the id is not knowable synchronously on native, where the Supabase token lives in Preferences and not localStorage. It fails closed if localStorage throws. **The read side is deliberately NOT gated**, and a symmetric guard there was written and then removed: GuestContext drops that marker for ANY session-less event including the null-session INITIAL_SESSION Supabase emits when it cannot validate a stored token offline, and `clearPersistedCache()` is deliberately skipped in that case precisely so a user does not lose their offline data when their token expires with no connection. A read gate races that same event and losing the race defeats that protection, while buying little, since a signed-out viewer lands on AuthPage which renders no cached account data. Verified with a positive control: signed in, one query dehydrates; signed out, zero; and a snapshot written during a session still restores without the marker. **Still open:** same-user last-write-wins between two tabs, where a tab on a quiet screen replaces a richer snapshot. Cosmetic — both snapshots belong to the same user and the data refetches when online. This also settles the Phase-1 guest-mode persistence question, since a guest has no session. Original entry follows. **Two tabs share one cache key.** One `cr-rq-cache` key, N independent throttled writers: last write wins, so a tab parked on a quiet screen can replace a rich snapshot. A background tab that has not yet processed `SIGNED_OUT` can also re-write its stale in-memory rows after another tab cleared them. | MEDIUM | The spec's own answer (§6, "scope the IDB store by `user.id`") cannot be applied naively: the key is fixed when the module loads, before auth resolves. A half-fix risks regressing the boot-survival behaviour that was just repaired, which is the more valuable property. | Either recreate the persister on identity change with a user-scoped key, or stamp the owning user id inside the snapshot and refuse to hydrate on mismatch once auth resolves. Verify the boot-survival test still passes afterwards. |
| D-4 | **The buster wipes the cache exactly when it hurts.** `buster` is the app version, so a user who installed a new build online and then opens the app **offline** gets their whole cache discarded with no network to refill it. | LOW-MEDIUM (accepted trade) | This is the safe side of a real trade-off. The alternative is rehydrating rows written by an older build into new code, which risks rendering against a changed row shape — a correctness bug, worse than a cold start. Keeping it. | If it ever needs softening: version the *shape* of each persisted query rather than the whole app, so only changed queries are dropped. |
| D-5 | **Legacy photo rows lose their image.** Rows that predate Storage hold a base64 `vehicle_photo` and no `vehicle_photo_storage_path`. Since `vehicle_photo` is stripped, for those rows the comment "the URL is re-derived online" is false — the photo is simply absent from the cache. | LOW | Correct as a privacy/size trade: base64 images must not bloat the snapshot. Affects only pre-migration rows, and only their photo. | Nothing, unless a base64 backfill happens. |
| D-6 | **`business_meta` capability flags persist.** Holds `driver_hide_community` / `driver_hide_ai`, which gate nav items. | LOW | Stripping it would make **every** driver see those items offline; keeping it only affects a driver whose manager changed the toggle since their last sync. Keeping is the smaller wrong. It is a display preference, not a security boundary. | Only revisit if a toggle ever gates something sensitive. |
| D-7 | **Offline vehicle photos render as empty space**, because `hasVehiclePhoto()` returns true off `storage_path` while the URL cannot be signed offline. | LOW | Not a broken-image icon, just a gap. A proper fix means a placeholder at each call site, since `VehicleImage` deliberately has none. | Add an `onError`/no-URL placeholder per call site, or give `VehicleImage` an opt-in placeholder prop. |
| D-8 ✅ **MOSTLY CLOSED 2026-09-08** | Audited properly: all 35 envelope commands were scanned for call sites that never read `error`, which found 24. Two were real and are FIXED in `37a76c4`: the community post edit (closed as if saved, edit silently discarded) and the route-stop issue documentation (driver told a manager would see a report that did not exist; the line directly above it already checked its own envelope, which is what marked it an oversight). The other 22 are verified fine: `community.postReport` is documented fire-and-forget defence-in-depth, the like/reaction/saved cluster is optimistic UI that self-corrects on the invalidate and refetch, and the rest are telemetry, best-effort cap sync, and UI hints with explicit comments. Original entry follows. **Eight pre-existing silent write failures** (post edit closes as if saved; a driver is told a route issue was logged when the text was dropped; like/reaction/saved snap back with no toast). | MEDIUM | **Not caused by this work** — the original code ignored these errors too and the refactor preserved that faithfully. Fixing them is a separate error-handling pass, not part of a behaviour-preserving refactor. | Tracked as its own task with the full prioritised list. Check each command's `returnsEnvelope` and add an error branch. |

Also closed as **not problems** by the adversarial pass, so nobody re-litigates
them: quota/partial writes cannot corrupt the blob (single-transaction `put`,
and both `serialize`/`deserialize` fail soft); a hanging IndexedDB cannot trip
the 7 s auth watchdog or 8 s splash net (every op races a *resolving* 2.5 s
timeout); `gcTime` ≥ `maxAge` holds including the one per-query override; and
`query-persister.js` is the only IndexedDB consumer, so no key collisions.

---

**Three writes deliberately kept OUT of the seam (by design, not oversight):**
1. `admin_start_view` / `admin_end_view` (`WorkspaceContext.jsx`) — the view-as impersonation path that shipped to prod in v6.4.0. Security-critical + the most-churned file in the repo.
2. `crashReporter`'s `app_errors` insert — telemetry must keep working when the app is broken, so it stays independent of the seam it would report on (also avoids an import cycle via `supabaseQuery` → `crashReporter`).
3. `app_notifications` bulk mark-read (NotificationBell / Notifications / PendingInviteBanner) — bulk `.in('id', ids)` needs a different command shape; also `NotificationBell.jsx` is frequently under parallel edit.

**Lesson (2026-09-07): never delete an import based on a single-line grep.** `grep -c 'supabase\.'` reported 0 uses in CreateBusinessWorkspace.jsx, but the file reads `withTimeout(supabase` with `.from()` on the NEXT line → dropping the import produced a `no-undef` that would have crashed the page at runtime. **Always run the full-project `npx --no-install eslint .` (0 errors) before committing a slice** — `no-undef` + `unused-imports` are the two rules that keep catching this refactor's real bugs.

### Phase 1 — read-cache (offline reads) — ~80% of the value ✅ CODE COMPLETE (2026-09-07)
- [x] deps installed: `idb-keyval@6.3.0`, `@tanstack/react-query-persist-client@5.90.2`, `@tanstack/query-async-storage-persister@5.90.2`. ⚠️ **Gotcha:** the install silently re-resolved `@tanstack/react-query` 5.90.21 → 5.102.8 (the `^5.84.1` range allowed it). Pinned back to `^5.90.21`; persist at 5.90.2 peers `^5.90.2`. **Check `@tanstack/react-query`'s resolved version after any future npm install.**
- [x] 🛑 `gcTime` 10min → 24h (`query-client.js`) — must stay >= `PERSIST_MAX_AGE`
- [x] `query-persister.js` + `query-persist-allowlist.js` + `PersistQueryClientProvider` (App.jsx), `buster: __APP_VERSION__`, `maxAge: 24h`, IDB calls raced against a 2.5s resolve-timeout (WKWebView hang)
- [x] 🛑 signed-URL fields stripped on dehydrate (verified in-browser: no token, no URL field, `*_storage_path` kept). **`VehicleImage` placeholder NOT done** — `hasVehiclePhoto()` still returns true offline (it checks `storage_path`), so the component renders nothing → an empty area, not a broken-image icon. Minor cosmetic gap, offline only; a real fix means per-call-site placeholders since VehicleImage deliberately has none.
- [x] `OfflineBanner` + `useOnlineStatus` / `useSettledOnlineStatus` (asymmetric debounce: 600ms to appear, instant to hide). Mounted in Layout below StagingBanner. **Only renders on signed-in pages** (Layout isn't mounted on AuthPage) — acceptable, since logging in offline is impossible anyway.
- [x] `clearPersistedCache()` wired at 5 identity boundaries: sign-out (the central `onAuthStateChange` chokepoint, which also covers PIN lockout + server-revoked sessions), identity change, both view-as teardowns, account deletion (both modes)
- [ ] **NOT live-tested with a signed-in session** — the banner's appearance and a real offline reload both need Ofek on the staging preview.
- [ ] Guest mode: persistence is not gated on `authState`. Low risk (guest data lives in localStorage and the allowlist is account-scoped), and the identity-change clear covers the guest→auth transition. Revisit if it ever matters.

### Phase 2 — reliable detection + offline guard
- [x] `@capacitor/network@8.0.1` installed (matches Capacitor 8.3.0) + `src/lib/nativeConnectivity.js`: seeds `onlineManager` from `Network.getStatus()` and tracks `networkStatusChange`. Native-only (web keeps the reliable browser events + the navigator seed in query-client.js). **Plugin imported EAGERLY, not dynamically** — same reason SplashScreen is eager in capacitor.js:10: iOS 26 WKWebView can freeze the dynamic-import loader on cold launch, which would silently leave iOS on the very `navigator.onLine` value this module exists to replace. Every call guarded; a plugin that isn't registered degrades to the browser signal instead of breaking boot.
- [ ] 🛑 **Ofek: `npx cap sync`** — until then the native projects have no Network plugin and native falls back to the browser signal (no crash, just no improvement).
- [x] offline fast-fail in **`runCommand`, not `withTimeout`** (spec originally said withTimeout). `runCommand` is the only place that sees every write regardless of backend — RPC, entity CRUD, direct `.from()`, or `adminSupabase` — and it is the only place that knows the command's `offlineCapable` flag. A guard in `withTimeout` would have missed every command that doesn't route through it and would have had no access to the flag.
- [x] **The guard honours each command's declared contract** (the decision that keeps this from being a breaking change): 32 of the 118 commands `returnsEnvelope`, because their call sites branch on `error` instead of using try/catch. Throwing at those sites would skip the error branch they already have, and surface as an unhandled rejection wherever no outer catch exists. So an envelope command **resolves** with `{ data: null, error: OfflineError }` — the exact shape it already produces for a server-side failure — and only the 86 throwing commands throw. Offline therefore needs no per-call-site handling: it arrives in the shape each site already handles.
- [x] `OfflineError` (`src/lib/dal/errors.js`) carries `isOffline`, `queueable`, and a **user-safe Hebrew message**, because several catch blocks interpolate `err.message` straight into a toast (ReminderSettingsPage:258, RepairsSection, Expenses, MyVehicles). Two wordings: offline-capable work invites a retry (`אין חיבור לאינטרנט. השינוי לא נשמר, נסה שוב כשתחזור לרשת.`), online-only work is a flat refusal (`הפעולה הזו דורשת חיבור לאינטרנט.`). `queueable` is the flag Phase 3 branches on to enqueue instead of refuse.
- [x] Verified in-browser by forcing `onlineManager.setOnline(false)` and running real commands through the seam: envelope+capable resolved with `queueable:true` and the retry wording; envelope+online-only resolved with the refusal wording; a throwing command threw an `OfflineError`; an unknown command still failed loudly; and **no request reached the Supabase host** — a true fast-fail, not a failure after a round trip. The four boot/fire-and-forget call sites (`account.ensure`, `userPreferences.setLastActive`, `notificationLog.*`, guest→real migration) were each checked to already sit inside a try/catch, so none of them turned into an unhandled rejection.
- [x] **Offline refusals are kept OUT of observability**, which the guard would otherwise have poisoned: `reportUserError` forces `visible:true`, so every refused write would have written a user-visible row to `app_errors` and fed the `user_visible_error_spike` alert — the exact false-positive class query-client.js:29-34 documents them already fighting, now firing hardest for a user who is simply in a tunnel. Suppressed at both entry points: `MutationCache.onError` (the automatic path, reached from the `useMutation` sites in AddRepairDialog + useEmailAdmin) and `toastError` (the explicit path, ~11 migrated call sites). The toast and the breadcrumb are kept in both cases, so the user still sees the failure and a later real error still carries the context. Verified in-browser: an OfflineError through `toastError` added 0 rows to `app_error_log`, while an ordinary Error and a message-only toast each still added 1, proving the suppression is specific rather than a broken pipeline.
- [ ] ⚠️ **Residual risk, accepted and named**: the guard trusts `onlineManager`, so a *false* offline reading turns the app read-only and refuses every write. This adds no new source of truth (Phase 1 already made `onlineManager` authoritative for reads, so a false-offline already paused them) and it now fails loudly with a banner plus a message instead of silently, which makes the state diagnosable rather than mysterious. A wrong initial value also self-corrects on the next real `online` event, and native replaces the guess with the OS signal. Worth watching for reports of "can't save" from users with working connections.
- [x] ~~Known gap: envelope call sites render their own generic failure copy rather than the `OfflineError` message.~~ **FIXED centrally instead of as a 30-site sweep:** `toastError` now prefers `err.message` when `isOfflineError(err)`, so a site that passes the error at all gets the offline wording without being edited. The call site's string is a fixed decision made before the attempt ("שמירה נכשלה"); the OfflineError knows what actually happened and whether a retry will help, and its message was written to be user-facing. This is what routing writes through one seam buys: the improvement lands everywhere at once. Sites that never pass `err` still show their own copy, which is the remaining (small) tail.

### Post-Phase-2 cleanup (same session)
- [x] **The cap feature's 3 raw RPCs now route through the seam** (`src/lib/dal/commands/cap.js`: `cap.bumpPersonal`, `cap.syncToCount`, `cap.createBusinessWorkspace`), closing the invariant erosion the merge left behind. 5 call sites migrated: GuestDataContext ×2, Dashboard ×2, CreateBusinessWorkspace ×1. All `offlineCapable: false` (an entitlement only the server can arbitrate; `create_business_workspace_from_cap` re-verifies the cap server-side, so it must never be replayed from a queue against a cap that has since moved). All three declare `returnsEnvelope: true` — **the rule for any raw `supabase.rpc` command**: rpc resolves `{data, error}` rather than throwing, so a command that omitted the flag would resolve an envelope online and throw offline, i.e. an inconsistent contract. Behaviour is unchanged at the four best-effort sites, which swallow failures either way. `GuestDataContext`'s `supabase` import went dead as a result and was removed (caught by full-project eslint, exactly as the earlier lesson prescribes; verified the file had no remaining reference rather than trusting a single-line grep). 121 commands registered, integrity clean.
- [x] **The empty-state flash during restore is FIXED** — Appendix D's notable open item, closed centrally rather than across 14+ screens. While the persister restores, React Query holds every query `pending` with `fetchStatus:'idle'`, so `isLoading` is FALSE with no data and any screen gating its skeleton on `isLoading` falls through to its empty state: a user opening the app offline is told "אין רכבים" at the exact moment the cache is about to prove otherwise. New `RestoreGate` in App.jsx holds page content on `useIsRestoring()`. Two deliberate scoping calls: it wraps **only the routed pages, never `/`** (that route is RootGate, whose synchronous redirect exists to prevent the login-screen flash on cold launch, so delaying it would reintroduce that bug), and it renders **LoadingSpinner, not SuspenseFallback** (the Suspense fallback hard-reloads the WebView after 8s to escape WKWebView's stuck module loader, which is right for a missing chunk and badly wrong for a cache read). Reuses the house spinner that 30 other files already use, so no new UI. **Verified on the production build** by planting a 4 MB snapshot to make the restore window observable: during restore the Layout shell rendered with a spinner and NO empty state, and after restore the gate released and content rendered, proving it is not a permanent block.

### Phase 3 — outbox core (first real offline writes)
- [ ] 🛑 DB: add `updated_at` + trigger to offline-write tables; verify client-supplied `id` inserts pass RLS (Ofek SQL)
- [ ] durable IndexedDB outbox + sync engine (drain on reconnect, idempotency, retry, ordering)
- [ ] optimistic apply + local UUIDs; prove on PoC (vehicle.updateMileage + corkNote.create + reminderSettings.update)

### Phase 4-6
- [ ] Phase 4 — register optimistic/invalidates on all offline-capable commands (expand coverage)
- [ ] Phase 5 — file-upload queue (offline photos/docs → Filesystem → upload on reconnect)
- [ ] Phase 6 — failed-sync inbox + conflict UI + pending-sync indicator; logout warn+discard (§10.1 decided)

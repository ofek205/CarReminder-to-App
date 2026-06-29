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

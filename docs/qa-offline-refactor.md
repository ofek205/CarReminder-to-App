# QA plan — Data Access seam + offline reads (30 commits on `staging`)

> Status: **not yet live-tested.** Static verification is complete and green
> (full eslint 0 errors, vite build, query-timeout gate 24/24, view-as identity
> gate OK, in-browser unit checks of the persister). Nothing here has been
> exercised against a real database by a real signed-in user.
>
> ⚠️ **staging shares the PRODUCTION Supabase database.** Every test below
> writes real rows. Use the dedicated test accounts only
> (`natanzone2024@gmail.com` and friends). Never run the destructive tests
> (§5) on a real customer account.

---

## 1. Scope

**In scope:** every write path in the app (now routed through
`dal.run(...)`), and the new IndexedDB read cache + offline banner.

**Out of scope here:** native iOS/Android behavior (needs a device build —
IndexedDB differs in WKWebView: ~7-day eviction, possible hang on open), and
offline WRITES (not built yet — Phase 2/3).

**Known non-issue:** `scripts/test-startup-logic.cjs` fails 1/15
(`trimmedValue is not defined`). `envValidator.js` is untouched by these
commits and the symbol exists pre-refactor — pre-existing, unrelated.

---

## 2. Why this change set is unusually risky

Not because any one edit is complex, but because there were ~200 near-identical
mechanical edits. The failure mode of mechanical work is **a silently wrong
parameter that still compiles and still "succeeds"**. No build, lint or type
check can catch that; only exercising the flow can.

Ranked by how bad the outcome is:

| Rank | Failure | Why it's the worst |
|---|---|---|
| 1 | **Privacy leak** — user B sees user A's cached data | Irreversible trust damage. New risk: data now sits on disk. |
| 2 | **Silent wrong write** — a mis-mapped field writes wrong/blank data | Corrupts real records, spreads unnoticed |
| 3 | **Wrong destructive target** — delete cascades to the wrong rows / other people's access | Unrecoverable |
| 4 | **Silent failed write** — user thinks it saved, it didn't | Data loss by omission; the envelope-vs-throw class |
| 5 | Stuck spinner / blocked flow | Annoying, recoverable |
| 6 | Empty photo area offline | Cosmetic, known, accepted |

---

## 3. 🚦 The 20-minute smoke test — run this FIRST

Purpose: decide **keep or roll back**. Stop at the first ❌ and report it.
Use a test account. Web (desktop Chrome) is fine for all of it.

| # | Do this | Must see | Covers |
|---|---|---|---|
| 1 | Sign in, land on Dashboard | App loads, vehicles listed, no console errors | boot + provisioning (`account.ensure`) not broken |
| 2 | Vehicle → update mileage (קילומטראז') | New value saved, visible after **reload** | the flagship write + read-back |
| 3 | Add an expense (הוצאות) | Row appears with the right amount, category, date, vehicle | RPC-backed write, param mapping |
| 4 | Edit that expense, change amount **and** vendor/title | Both survive; **vendor/title not blanked** | ⚠️ the one param-mapping risk I flagged (inline form previously omitted title/vendor) |
| 5 | Add a maintenance log (טיפול) | Saved; appears in history | a write that previously swallowed errors |
| 6 | Add a cork note + add a task, mark task done | All three persist after reload | entity + raw-write unification |
| 7 | Upload a document, then open it | File opens (fresh signed URL) | storage path + URL re-signing still intact |
| 8 | Delete an **unshared** vehicle you just created | Deletes cleanly | plain delete path (not the cascade) |
| 9 | **Privacy:** sign out → sign in as a *different* test account | **Zero** data from account #1 anywhere | `clearPersistedCache()` at sign-out |
| 10 | **Offline:** DevTools → Network → Offline → **reload** | Vehicles/dates still shown + grey banner "אין חיבור לאינטרנט" | the whole point of Phase 1 |
| 11 | Go back online | Banner disappears on its own, data refreshes | reconnect + refetch |
| 12 | (admin account) Admin → open a user → change a role or add a note | Action succeeds | the `adminSupabase` fix |

**If 1, 9 or 10 fails → stop and roll back.** Those are boot, privacy, and the
feature itself. Everything else can be fixed forward.

---

## 4. Offline test procedure (do it exactly in this order)

Order matters: the cache must be **populated while online** before it can be
restored offline.

1. Online, signed in: visit Dashboard, Vehicles, open one vehicle, open
   Documents. (This populates the allowlisted queries.)
2. DevTools → Network → **Offline**.
3. **Reload the page.** ← the real test. Without a reload you're only seeing
   the in-memory cache, which proves nothing.
4. Expect: vehicle list + test/insurance dates render; grey sticky banner at
   top; **no** error screens or infinite spinners.
5. Expect (known, accepted): vehicle **photos show as empty space**, not broken
   icons. Documents won't open offline.
6. Navigate to a screen you did **not** visit in step 1 → an empty state or a
   paused/loading state is acceptable; a crash is not.
7. Try to save something (e.g. mileage) → must fail with a **clear message and
   no stuck spinner**. (A generic network error is expected for now — the clean
   Hebrew offline message is Phase 2.)
8. Back online → banner clears itself within a second, data refetches.
9. **Flap test:** toggle offline→online→offline quickly. Banner must not
   strobe (600ms debounce before it appears).

### Privacy tests (the highest-stakes ones)

| # | Steps | Must see |
|---|---|---|
| P1 | Account A: browse vehicles → sign out → sign in as account B | No trace of A's vehicles, not even for a flash |
| P2 | DevTools → Application → IndexedDB → `keyval-store` after sign-out | Key `cr-rq-cache` **gone** |
| P3 | Admin: enter view-as on a customer → browse → exit → check IndexedDB | Customer rows **not** on the admin's disk |
| P4 | Switch workspace (personal ↔ business) | No cross-account rows |
| P5 | Delete account (mode=data) on a throwaway test account | No "ghost" vehicles reappear after reload |

---

## 5. Destructive-path tests — test accounts ONLY

These are the ones where a wrong param does unrecoverable damage.

| # | Scenario | Must see | Priority |
|---|---|---|---|
| D1 | Delete a vehicle that **is shared** with someone | Sharee loses access **and gets a notification** | P0 |
| D2 | Delete an **unshared** vehicle | Deletes cleanly (now also via the cascade RPC — that is intended) | P0 |
| D2b | Open a **shared** vehicle and hit delete **immediately**, before the "shared with N" pill appears | Still notifies the sharee. The dialog text must NOT say the deletion affects only you | P0 |
| D3 | Revoke a share | That person loses access | P0 |
| D4 | Remove a team member / change their role | Correct member affected, correct new role | P0 |
| D5 | Transfer ownership | Ownership moves to the intended person | P0 |
| D6 | Admin: delete account / delete user | The **intended** account only | P0 |
| D7 | Bulk-delete vehicles (admin + fleet) | Exactly the selected ids | P0 |

D1 and D7 are the two I'd watch hardest: both pass id **lists/modes** through
the new command layer.

---

## 6. Regression matrix by role

| Role | Must still work |
|---|---|
| **Personal owner** | add/edit/delete vehicle · documents · maintenance · repairs · accidents · expenses · cork notes/tasks · reminder settings · snooze a reminder · profile edit |
| **Business owner/manager** | fleet list · bulk add · drivers (create/edit/archive external) · assign & end assignment · create route with stops · invite member · change role · business settings |
| **Driver-only** | see assigned vehicles · update mileage (driver RPC) · log an event · update a route stop status · add stop documentation/issue |
| **Guest** | add vehicle locally · then **sign up** → guest data migrates (this loops through `vehicle.create` per item) |
| **Admin** | user drawer actions · role change · notes · bug resolve · popups · version broadcast · release announcement · AI provider · approve/deny business request |
| **Admin in view-as** | ✅ admin actions still work (this is what the `adminSupabase` fix restored) · admin nav hidden · exit restores own workspace · **no customer data left on disk** |

---

## 7. Edge cases specific to the two deliberate behavior changes

**(a) Writes that used to swallow errors now surface them.**

| # | Scenario | Must see |
|---|---|---|
| E1 | Edit a maintenance log that was deleted in another tab/device | A clear error toast, **not** a silent no-op that looks successful |
| E2 | Driver tries to update mileage on a vehicle no longer assigned to them | Error surfaces (RLS denial) rather than appearing to save |
| E3 | Any save while the session has expired | Error toast, no stuck spinner, no half-saved state |
| E4 | A checklist item toggle that fails | The toggle must not silently revert with no explanation |

**(b) Envelope-vs-throw contracts.** Some commands return raw
`{ data, error }` (repair.save, reminderSnooze.upsert, all route.*, access.*,
admin.*, community moderation, telemetry); the rest throw. A mismatch shows up
only on the **failure** path, so test failures deliberately:

| # | Scenario | Must see |
|---|---|---|
| E5 | Report the same community post twice | Friendly "already reported" — **not** a generic error (relies on `error.code === '23505'` reaching the call site) |
| E6 | Invite an email that's already invited | The specific Hebrew message, not a generic failure |
| E7 | Open an **expired** share invite link | "הזמנת השיתוף פגה" specifically (error-code → Hebrew mapping intact) |
| E8 | Save a repair with an attachment while the network drops mid-save | Toast + no orphaned attachment; the transactional RPC either fully applied or not at all |
| E9 | Snooze a reminder twice on the same vehicle/type | Second one updates rather than erroring (upsert on conflict) |

**(b2) Two data-value changes found by the param-mapping audit — test these explicitly**

| # | Scenario | Must see | Why |
|---|---|---|---|
| E10 | Add a task (משימות) with leading/trailing spaces and with an HTML-ish string like `<b>בדיקה</b>` in the title/content | Saved **trimmed** and **HTML-stripped** | Tasks used raw `supabase.from` before and stored the value as-is; routing through the entity layer now applies `sanitizeString`. A real change to what lands in the DB. |
| E11 | Add an expense from the **Expenses page** inline form (not the dialog) → inspect the row's `source` | `source = 'manual'` | The old inline RPC omitted `p_source`, so those rows were written with `NULL`. Now it's `'manual'`. Arguably a fix, but it changes what new rows contain — confirm nothing downstream filters on `source IS NULL`. |
| E12 | Maintenance save that FAILS (e.g. expired session) | Error toast, and **no** success toast + **no** reminder scheduled | Previously a failed maintenance save still showed success and scheduled the local notification. This is now correct, but it is the most user-visible behavior change in the set. |
| E13 | AI expert reply on a new community post, with the network dropped mid-reply | Post itself still created; the AI comment just doesn't appear (silent) | The AI comment insert now throws into a catch that only logs, so it fails silently rather than half-succeeding. |

**(c) Other things worth a look**

- Double-click submit on any form (expenses, maintenance, repair) → one row, not two.
- Guest → signup with several vehicles → all migrate, none duplicated.
- A vehicle with **no** photo vs one **with** a photo, offline and online.
- Business account with 0 vehicles / 1 / many (fleet pagination).
- RTL: the new banner's text and icon order at 360px width.
- Two banners stacked: staging preview + offline → both readable, no overlap.

---

## 8. GO / NO-GO

### Push to `staging`
**GO if:** smoke items 1–12 pass, P1–P3 pass, and the two gates stay green
(`node scripts/check-query-timeouts.cjs`, `node scripts/check-view-as-identity.cjs`).
**NO-GO if:** any privacy test fails, boot fails, or any P0 destructive test
touches the wrong rows.

### Promote to production
Additionally required — do **not** promote on web-only testing:
1. All of §5 (destructive) passes on test accounts.
2. All of §6 roles covered, including driver-only and admin-in-view-as.
3. **A native build tested on a real device** (iOS + Android): offline reload,
   IndexedDB survives app restart, no splash-forever, banner respects the notch.
4. Offline behavior confirmed on a real phone with airplane mode, not just
   DevTools.
5. The pre-existing `test-startup-logic` failure either fixed or explicitly
   accepted.
6. Full 7-gate production process per CLAUDE.md (this change set is large
   enough that gate 4's QA walkthrough is not optional).

### Rollback
Every slice is its own commit, so rollback is targeted:
- Offline reads only → revert `72d2b0d` + `13d7e8b`.
- A single domain's writes → revert that domain's commit alone.
- Everything → reset to `d355041~1`.

# iOS TestFlight Debugging Runbook

A systematic playbook for diagnosing "TestFlight stuck on splash" or
"Simulator works, real device doesn't" issues — without USB access to
the device.

---

## TL;DR — what to do first

1. On the iPhone: **uninstall + reinstall from TestFlight**, launch the app.
   - If it still hangs → continue.
2. **Wait at least 16 seconds.** The native watchdog in `AppDelegate.swift`
   will pop a UIAlertController if the WebView didn't load.
   - The alert offers "Copy diagnostics" — tap it, then paste in WhatsApp
     and send to support.
3. If the alert never fires (no native watchdog yet on the installed
   build) → install a build that includes this commit and retry.
4. If the alert fires → you have a definitive log line saying *why* the
   WebView didn't load. Continue with **Reading native diagnostics** below.

---

## Layered diagnostics — the four levels

When startup fails, exactly one of these signals will be present.
Each level reveals the layer above died.

| Level | Signal | What it means |
|---|---|---|
| 0 | App icon flashes, returns to Home Screen | Process died before `application:didFinishLaunchingWithOptions:` — usually a missing framework / dyld error. Get crash log via Settings → Privacy → Analytics → Analytics Data. |
| 1 | LaunchScreen.storyboard stays forever, **no native alert** at 16s | AppDelegate hung OR watchdog code missing from this build. Confirm build number ≥ first build with `AppDelegate.swift` watchdog (search `recordNativeStage` in commit history). |
| 2 | Native alert at 16s ("App didn't load") | AppDelegate ran fine, WebView didn't reach JS. **Read the alert's diagnostics** — see below. |
| 3 | Green branded loader visible (with "טוען..."), then stuck | WKWebView loaded `index.html`, JS started, but a synchronous import or env-validation failed. Visit `/boot-debug`. |
| 4 | App reaches some UI but a screen is broken | Not a startup issue; debug as a normal feature bug. |

---

## Reading native diagnostics (Level 2)

The alert's "Copy diagnostics" button writes a JSON to UIPasteboard
that includes:

```json
{
  "app": "CarReminder",
  "bundleId": "com.carreminders.app",
  "version": "3.0.0",
  "build": "28",
  "iosVersion": "26.3.1",
  "device": "iPhone12,1",
  "nativeLog": [
    { "stage": "did_finish_launching", "ts": ... },
    { "stage": "did_become_active",    "ts": ... },
    { "stage": "watchdog_probe",       "extra": { "label": "first",  "result": "no-snapshot-fn" } },
    { "stage": "watchdog_probe",       "extra": { "label": "final",  "result": "no-snapshot-fn" } },
    { "stage": "hang_alert_shown",     "extra": { "reason": "JS heartbeat: ..." } }
  ],
  "jsSnapshot": "..."   // present only if JS was partially alive
}
```

### Interpreting `result` values from `watchdog_probe`

| `result` | Meaning |
|---|---|
| `"alive"` | False alarm — JS responded; the watchdog should not have fired. Check if `boot_succeeded` was reached in `jsSnapshot.currentLog`. |
| `"no-snapshot-fn"` | JS started but didn't reach the line in `main.jsx` that registers `window.__crGetBootSnapshotSync`. Look at `jsSnapshot` (if present) — the last log entry tells you which import threw. |
| `"<nil>"` (with `error` populated) | WKWebView could not evaluate JS at all. Most often: WebContent process crashed (memory pressure on iPhone 11) or the bundle's main script never finished parsing. |
| `"throw:..."` | JS is alive but threw inside the probe — extremely rare; means the JS engine is corrupted. Force-quit + relaunch. |

### What `device` codes mean
`iPhone12,1` = iPhone 11. `iPhone14,*` = iPhone 13. Etc. Useful for
distinguishing "all devices" vs "iPhone 11 only" issues.

---

## Reading JS diagnostics (Level 3)

If the user can reach `/boot-debug` (URL or via the 7s recovery panel):

1. Tap **"שתף יומן"** — pops the iOS native share sheet (Mail / WhatsApp /
   Telegram / AirDrop). This is the most reliable export path inside a
   degraded WKWebView.
2. Tap **"שלח לתמיכה"** — pushes a `boot_debug_manual` entry to the
   Supabase `app_errors` table. Inspect via Admin → Bugs.
3. As a fallback, **"העתק"** copies the JSON to UIPasteboard (sometimes
   restricted in iOS).

Each stage in `currentLog` includes `t` (ms since boot start) and a
delta from the previous stage. Stages > 1000ms are highlighted amber —
those are your suspects.

### Key stages to verify in order
1. `main_entry` — `main.jsx` started.
2. `env_check` — env validator ran. If `extra.ok === false` → the build was missing a `VITE_*` var. CI didn't inject secrets correctly.
3. `react_mount_start` → `react_mount_rendered` — React's first paint succeeded.
4. `splash_hide` (reason=`react-mount`) — happens after 2 RAFs post-render.
5. `auth_watchdog_timeout` — 7s elapsed without auth resolving. Auth/session is hung.
6. `boot_succeeded` — terminal success state.

If `main_entry` is missing → JS bundle never executed (Level 2 was wrong; revisit).
If `env_check` shows `ok=false` → CI secrets problem.
If `react_mount_start` exists but `react_mount_rendered` doesn't → React crashed during render, AppErrorBoundary caught it.
If `auth_watchdog_timeout` fires → Supabase session restore hung; usually network or stale token.

---

## Identifying the root layer (decision tree)

```
Stuck on launch screen
│
├── Native alert at 16s? ────────────────── No ──> Level 1 (AppDelegate hung)
│                                                  └─ Get device crash log
│                                                  └─ Or build with this watchdog and retry
│   │
│   └── Yes
│       └── jsSnapshot present in copy? ──── No ──> Level 2 (WebView dead)
│                                                   └─ Common: WebContent crashed
│                                                   └─ Try: uninstall, reinstall, clean WebKit storage
│           │
│           └── Yes ──> Level 3 (JS hung mid-boot)
│                       └─ Read currentLog last stage
│                       └─ Cross-reference table above
```

---

## Local reproduction on remote Mac

The simulator alone is **not** a faithful TestFlight reproducer because
the default `npm run ios` builds Debug. To match TestFlight you must
build Release and install from the .app. Run:

```bash
# Reproduce the user's iPhone 11 setup as closely as a sim allows
./scripts/ios-release-simulator.sh "iPhone 11"

# Compare to Debug behavior
IOS_CONFIG=Debug ./scripts/ios-release-simulator.sh "iPhone 11"
```

This script:
- Runs `npm ci` (clean deps, matches CI)
- Runs `npm run build` (production minified)
- Runs `npx cap sync ios` (copies to embedded bundle)
- Runs `pod install`
- Builds via `xcodebuild` with `-configuration Release`
- Verifies `public/index.html` made it into the .app
- Installs to a fresh-state simulator (uninstalls first)
- Launches and tails logs

If the **Release sim hangs but Debug sim works**, the bug is in
production-only code — minification, dead-code elimination, env
injection, or asset path resolution. Inspect `assets/index-*.js` in
`dist/` for clues.

If **both Release sim and Debug sim work but TestFlight on iPhone 11
hangs**, the bug is device-specific — usually iOS-version regression
(WebKit / WKWebView), memory pressure, or storage corruption. Confirm
with the native alert.

---

## CI verification gate

`.github/workflows/ios-release.yml` now runs `scripts/ios-verify-build.sh`
**before** the archive step. It fails the build if:

- Required env vars are missing (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- `dist/index.html` is missing
- `ios/App/App/public/index.html` differs from `dist/index.html`
- `package.json` version disagrees with iOS `MARKETING_VERSION` (warning)
- Privacy manifest missing (warning)
- Capacitor pod version is unexpected

This is the gate that proves "the IPA we just archived contains the
web bundle we think it contains". If TestFlight still hangs after this
gate passes, the issue is **not** with the build pipeline — focus on
runtime / device diagnostics.

---

## Rule out vs. confirm — what each result means

| Failing layer | "GitHub build is fine" if... | "GitHub build is broken" if... |
|---|---|---|
| Level 0 | — | First-launch crash → check `crash logs` for missing dylib |
| Level 1 | `nativeLog` shows `did_finish_launching` | `nativeLog` is empty |
| Level 2 | `index.html` exists in IPA + dist matches embedded | `cap sync` skipped, public/ is stale |
| Level 3 | `env_check.ok === true` in JS log | `env_check.ok === false` → secrets not injected |
| Level 4 | — | Specific feature bug; not pipeline |

---

## Who owns each surface

- **`AppDelegate.swift` watchdog** — native fallback. Owned by iOS code.
- **`bootDiagnostics.js`** — synchronous JS log. Owned by web code.
- **`crashReporter.js`** — remote Supabase telemetry. Owned by web code.
- **`/boot-debug` page** — UI for reading the JS log. Owned by web code.
- **`scripts/ios-verify-build.sh`** — pre-archive gate. Owned by CI.
- **`scripts/ios-release-simulator.sh`** — local reproduction harness. Owned by dev workflow.
- **`docs/IOS_PLUGIN_AUDIT.md`** — plugin-by-plugin failure modes.

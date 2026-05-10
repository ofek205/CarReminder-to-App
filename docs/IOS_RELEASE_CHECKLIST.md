# iOS Release Build Comparison Checklist

Use this before every TestFlight upload to catch "works on simulator,
breaks on device" issues *before* they reach reviewers or beta testers.

## 0 · Pre-flight (Windows or Mac, in this repo)

- [ ] Branch is `staging` (per project rule).
- [ ] `git status` clean (or only intended changes staged).
- [ ] `git pull origin staging` — sync to latest CI'd state.
- [ ] `package.json` version intentional (matches what we'll tag).
- [ ] iOS `MARKETING_VERSION` (in `ios/App/App.xcodeproj/project.pbxproj`)
      matches `package.json` version, or differs intentionally.

## 1 · Local Simulator Debug test (Mac, fastest signal)

```bash
IOS_CONFIG=Debug ./scripts/ios-release-simulator.sh "iPhone 11"
```

Verify:
- [ ] Splash dismisses within 5 seconds.
- [ ] AuthPage / Dashboard renders (depending on session state).
- [ ] No red console errors in Xcode log stream.
- [ ] No stuck spinner past 15 seconds.

If this fails, do **not** proceed. The issue is in source code; fix it
locally before chasing build pipeline ghosts.

## 2 · Local Simulator Release test (closest to TestFlight without device)

```bash
./scripts/ios-release-simulator.sh "iPhone 11"   # Release is the default
```

Verify:
- [ ] Same behavior as Debug above.
- [ ] If Debug worked but Release fails → suspect: minification,
      tree-shaking, env injection, or asset paths.
- [ ] `dist/index.html` matches `ios/App/App/public/index.html` byte-for-byte.

## 3 · Compare Debug vs Release explicitly

```bash
# Debug
IOS_CONFIG=Debug SKIP_BUILD=1 ./scripts/ios-release-simulator.sh "iPhone 11"

# Release (build from scratch to catch stale deps)
./scripts/ios-release-simulator.sh "iPhone 11"
```

If a stage in `localStorage.getItem('cr_boot_log')` differs between the
two runs, the difference points to the failing layer. The most
common find: a synchronous import that throws only after Vite's
production minification renames a class.

## 4 · Local archive from remote Mac (true TestFlight equivalent)

```bash
cd ios/App
xcodebuild \
  -workspace App.xcworkspace \
  -scheme App \
  -configuration Release \
  -archivePath /tmp/App.xcarchive \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  archive
```

This produces an `.xcarchive` that is byte-equivalent (modulo signing)
to the CI archive. Inspect `App.xcarchive/Products/Applications/App.app/public/index.html`
to confirm the exact bundle that would ship.

## 5 · CI verification gate

When pushing to a branch that triggers `ios-release.yml`, the workflow
runs `scripts/ios-verify-build.sh` before archive. Confirm in the
GitHub Actions log:

- [ ] `node`, `npm`, `pod`, `xcodebuild` versions logged.
- [ ] `iphoneos SDK` version logged.
- [ ] `branch`, `commit`, `pkg version` logged.
- [ ] `VITE_SUPABASE_URL` reported as `present` (length only — never the value).
- [ ] `VITE_SUPABASE_ANON_KEY` reported as `present`.
- [ ] `dist/index.html` exists.
- [ ] `ios/App/App/public/index.html matches dist/index.html` ✓.
- [ ] `marketing version`, `build number`, `bundle id`, `min iOS` logged.
- [ ] **No `::error::` lines.**

If any required check fails, the workflow exits *before* archive.

## 6 · TestFlight install on real iPhone

After Apple processing finishes (typically 5-30 min):

- [ ] Uninstall any previous TestFlight build of this app first.
- [ ] Open TestFlight, install the new build.
- [ ] Launch from TestFlight (NOT Home Screen for the first launch — TestFlight launches with attached console which Apple sometimes uses for debugging).
- [ ] Wait at least 16 seconds before declaring "stuck".

### Expected startup diagnostics result (healthy)

| Time | What you should see |
|---|---|
| 0–1.5s | LaunchScreen.storyboard (white + Splash logo). |
| 1.5–3s | Inline green branded loader from `dist/index.html` (visible if React is slow). |
| 3–5s | First React render — AuthPage or Dashboard. |
| 5s+ | Normal app interaction. |

### Expected diagnostic result (unhealthy)

| Symptom | What it means |
|---|---|
| LaunchScreen stays > 5s, no green loader | WebView didn't load the bundle. |
| LaunchScreen stays > 16s, native alert pops | Native watchdog tripped. **Tap Copy diagnostics → send to support.** |
| Green loader visible but stuck > 12s | JS started but a sync import hung or threw silently — visit `/boot-debug`. |
| White-screen-with-spinner > 12s | A lazy chunk failed to load — Suspense fallback fired. App may auto-reload. |
| AppErrorBoundary "משהו השתבש" screen | React render threw — error captured to crashReporter. |

## 7 · Copying logs from the app (no USB needed)

There are three escape hatches, in order of reliability under stress:

1. **Native UIAlertController → "Copy diagnostics"** — fires automatically
   at 16s if WebView never started. Diagnostics include native log,
   bundle metadata, iOS version, device model. Copies to UIPasteboard.
   *Works even when WebView is dead.*

2. **`/boot-debug` page → "שתף יומן" button** — pops the iOS native
   share sheet. Send via WhatsApp / Mail / Telegram / AirDrop.
   *Works when JS is alive, even if the rest of the app is broken.*

3. **`/boot-debug` page → "שלח לתמיכה" button** — pushes the snapshot
   to Supabase `app_errors`. Visible in Admin → Bugs.
   *Works when JS is alive AND network is up. No user action needed by support.*

## 8 · Identifying which layer is at fault

| Test | If green | If red | What to check next |
|---|---|---|---|
| 1. Local Sim Debug | Bug only in build pipeline | Bug in code | Fix code first |
| 2. Local Sim Release | Bug device-specific | Bug in production-only code | Inspect minified bundle |
| 3. CI verify-build gate | Pipeline OK | Missing env / stale sync | Fix CI secrets / re-run sync |
| 4. Real device launch | Ship | Device-specific issue | Read native alert |
| 5. Native alert at 16s | WebView issue isolated | AppDelegate hung | Check device crash logs |

## Anti-patterns to avoid

- ❌ "It works on my simulator" → Debug-mode Mac sims are not equivalent
  to a Release-mode arm64 build. Always run #2 above.
- ❌ Adding a `console.log` to debug a TestFlight build — there's no
  Web Inspector access to a Release build. Use `recordBootStage` instead;
  it's queryable via `/boot-debug` and via the next-launch flush.
- ❌ Asking a user to email a screenshot of the splash — useless. Ask
  them to wait for the 16s native alert and copy diagnostics.
- ❌ Bumping the version to "force a refresh" — does nothing for a
  WebView storage issue. The fix is uninstall + reinstall.

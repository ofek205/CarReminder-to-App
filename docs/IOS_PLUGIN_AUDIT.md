# Capacitor Plugin Audit — iOS Boot Risk

For each Capacitor plugin used in this project, this document records:
- **What it does at startup** — the actual code path on cold launch.
- **Real-device-vs-simulator differences** — what only fails on devices.
- **Boot-criticality** — does the app need this to render the first screen?
- **Failure mode** — what happens if the plugin call hangs or throws.

If a plugin is "boot-critical" and its initialization isn't wrapped in
a timeout / error handler, that plugin can hang the whole app on iOS.

The principle this codebase follows: **non-critical plugin init is
delayed and lazy-loaded**. See `src/main.jsx` → `initNonCriticalServices`.

| Plugin | Boot-critical | Init at boot? | Real-device risk | Mitigation in code |
|---|---|---|---|---|
| `@capacitor/app` | No | Lazy (back button, deep links, app-state listener — registered on demand) | Listener registration can fail silently | All `App.addListener` wrapped in try/catch in `lib/capacitor.js` |
| `@capacitor/browser` | No | Lazy (only on OAuth/external-link flow) | None at boot | n/a |
| `@capacitor/camera` | No | Lazy (only when user taps camera) | First-call permission prompt; on iOS 26 the prompt can stall if `NSCameraUsageDescription` is missing | Description is set in `Info.plist` |
| `@capacitor/filesystem` | No | Lazy (only on save/download) | iOS 26 sandbox tightening on `Directory.Documents` writes | Wrapped in try/catch in `lib/capacitor.js → saveFile` |
| `@capacitor/geolocation` | No | Lazy (only on FindGarage) | Permission prompt synchronous; can stall app if invoked during boot | Never called at boot |
| `@capacitor/haptics` | No | Lazy (utility only) | None | Silent catch in `hapticFeedback` |
| `@capacitor/keyboard` | **Almost** | Eager: `initKeyboard()` runs in `main.jsx` | Plugin init creates listeners; very rare to hang but can throw if iOS bridge isn't ready | `initKeyboard` is fire-and-forget; errors logged not thrown |
| `@capacitor/local-notifications` | No | Lazy (`initNotifications` deferred 1.2s post-mount) | Permission prompt; can stall if NSUserNotification state is corrupted | `initNonCriticalServices` setTimeout fence; try/catch wraps it |
| `@capacitor/preferences` | No | Lazy (storage adapter for Supabase) | UserDefaults.suite() can stall if first-write happens during disk pressure | Used via Supabase auth; not called directly at boot |
| `@capacitor/share` | No | Lazy (only on Share button taps + boot-debug share) | First share-sheet call requires UIScene to be ready | Used after first paint only |
| `@capacitor/splash-screen` | **YES** | Eager: import is **static** (not dynamic!) at top of `lib/capacitor.js` | If the SplashScreen pod failed to link, even importing the JS module would throw and stop boot | Static import is intentional; the comment in code explains why |
| `@capacitor/status-bar` | No | Eager: `initStatusBar()` runs in `main.jsx` | Setting style before UIScene ready throws on iOS 26 | Fire-and-forget with try/catch |

## Cold-start sequence (current)

1. `main.jsx` → `initBootLog()` (sync, never throws)
2. `main.jsx` → `recordBootStage('main_entry', ...)`
3. `main.jsx` → `flushPreviousFailedBoot()` (fire-and-forget; dynamic import of crashReporter)
4. `main.jsx` → `validateEnv()` (sync; reads import.meta.env)
5. `lib/capacitor.js` static imports load: `Capacitor`, `SplashScreen`
6. `main.jsx` → `initStatusBar()` (await-less, errors logged)
7. `main.jsx` → `initKeyboard()` (await-less, errors logged)
8. `main.jsx` → `initBackButton()` (await-less, errors logged)
9. `main.jsx` → `initSessionKeepAlive()` (await-less, dynamic-imports supabase)
10. **Env-error gate**: if `__envFail || __crBootEnvError` → render error UI, stop
11. `ReactDOM.createRoot(rootEl).render(<App />)`
12. Two RAFs → `hideSplash()` (fire-and-forget, 1.5s timeout race)
13. `setTimeout(initNonCriticalServices, 1200)` — kicks off LocalNotifications / permissionBootstrap
14. `setTimeout(authWatchdog, 7000)` — fires recovery UI if `__crAuthResolvedAt` not set
15. `setTimeout(splashSafety, 8000)` — hard-hide splash if no other path closed it

## Why these defaults are safe

- **Plugin imports are dynamic where possible.** Only `Capacitor`,
  `SplashScreen` are eager — both are tiny and proven-stable.
- **Every `await` at boot is bounded.** `hideSplash` races a 1.5s timer.
  The auth watchdog forces a recovery UI at 7s. The splash hard-timeout
  closes splash at 8s regardless.
- **Permissions are never requested at boot.** The first time camera /
  geolocation / notifications are needed is *after* the user taps a UI
  affordance — never during cold start. iOS permission prompts that
  fire during cold start are the #1 cause of "stuck on splash" on
  real devices.
- **The native AppDelegate watchdog (`AppDelegate.swift`)** is the
  fallback for cases where even the JS-side watchdogs don't fire (i.e.
  WKWebView never loads the bundle). At 16s, a native UIAlertController
  appears with diagnostics — the user can copy them and paste into
  WhatsApp to support, even without USB or Web Inspector.

## When adding a new plugin

Use this checklist:

- [ ] Is the plugin needed at boot? If no, lazy-import it inside the
      function that uses it (see `takePhoto` in `lib/capacitor.js`
      for the pattern).
- [ ] If yes, can it ever request a permission? If yes, defer to
      `initNonCriticalServices`. Permissions during cold start hang
      the app.
- [ ] Wrap the first call in try/catch and `recordBootStage`.
- [ ] Add a 5s timeout race for any await that could hang.
- [ ] Document the plugin's boot-critical status in this table.

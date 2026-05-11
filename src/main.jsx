import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { isNative, initStatusBar, initKeyboard, initBackButton, hideSplash, initSessionKeepAlive } from '@/lib/capacitor'
import { reportError } from '@/lib/crashReporter';
import { initBootLog, recordBootStage, markBootSucceeded, flushPreviousFailedBoot } from '@/lib/bootDiagnostics';
import { validateEnv } from '@/lib/envValidator';

// Boot log is the FIRST thing we initialize — even before plugin init,
// so a crash inside any subsequent line still leaves a trail behind for
// post-mortem analysis. Synchronous, never throws.
initBootLog();
recordBootStage('main_entry', { isNative, ua: navigator?.userAgent?.slice(0, 120) });

// Flush previous-launch boot log if it ended without `boot_succeeded`.
// Fire-and-forget — never blocks current boot. Gives us a remote
// post-mortem for stuck-on-splash launches without USB / web inspector.
try { flushPreviousFailedBoot(); } catch {}

// Explicit env validation. Records snapshot (presence-only, no secrets)
// to bootDiagnostics so a hung TestFlight launch can surface the cause
// via /boot-debug or via the next-launch flush. The supabase.js stub
// continues to set __crBootEnvError as a defense-in-depth fallback.
let __envCheck = { ok: true, errors: [], snapshot: {} };
try {
  __envCheck = validateEnv();
  recordBootStage('env_check', {
    ok: __envCheck.ok,
    errors: __envCheck.errors,
    snapshot: __envCheck.snapshot,
    mode: __envCheck.mode,
  });
} catch (e) {
  recordBootStage('env_check_threw', { level: 'error', message: e?.message || String(e) });
}

// Mark document for native-specific CSS
if (isNative) {
  document.documentElement.classList.add('native-app');
}

// Initialize native plugins (no-op on web)
initStatusBar();
initKeyboard();
initBackButton();

// Refresh Supabase session whenever the app/tab returns to foreground, so
// users don't get silently logged out after leaving the app for a while.
initSessionKeepAlive();

const FORCE_GUEST_ONCE_KEY = 'cr_force_guest_once';

function markBootStage(stage, extra = {}) {
  try { console.info('[boot]', stage, extra); } catch {}
  // Persistent telemetry — synchronous, survives a hard hang.
  try { recordBootStage(stage, extra); } catch {}
  // Keep remote (Supabase) telemetry low-noise: only native app or explicit failures.
  if (isNative || extra?.level === 'error') {
    try { reportError('boot_stage', new Error(stage), extra); } catch {}
  }
}

// Initialize non-critical services only AFTER first paint. This keeps cold
// start focused on rendering UI quickly and avoids plugin-init races that
// can freeze WKWebView on some iOS launches.
function initNonCriticalServices() {
  setTimeout(async () => {
    markBootStage('non_critical_init_start');
    try {
      const [{ initNotifications }, { requestAllPermissionsOnFirstLaunch }] = await Promise.all([
        import('@/lib/notificationService'),
        import('@/lib/permissionBootstrap'),
      ]);
      initNotifications();
      requestAllPermissionsOnFirstLaunch();
      markBootStage('non_critical_init_ok');
    } catch (err) {
      markBootStage('non_critical_init_failed', { level: 'error', message: err?.message || String(err) });
    }
  }, 1200);
}

// Splash screen lifecycle. We must NOT hide the native splash until React
// has actually painted, otherwise the user sees a white screen between the
// splash fading and the first React frame. App Store reviewers consistently
// flag this gap as "blank screen on launch" (Guideline 2.1(a)).
//
// Strategy:
//   1. Schedule hideSplash() to fire AFTER ReactDOM.render returns (below).
//   2. As a belt-and-suspenders, also hide on window 'load' — covers cases
//      where React fails to mount but the page itself loaded.
//   3. Final safety net: 8s hard timeout. If something is really stuck,
//      we'd rather show a (possibly broken) UI than a green splash forever.
let __splashHidden = false;
function hideSplashOnce(reason) {
  if (__splashHidden) return;
  __splashHidden = true;
  markBootStage('splash_hide', { reason });
  hideSplash();
}
window.addEventListener('load', () => hideSplashOnce('window-load'));
setTimeout(() => hideSplashOnce('safety-8s'), 8000);

// Global error logger → localStorage (for admin Bugs tab) + remote Supabase
// (best-effort via crashReporter). See scripts/supabase-add-app-errors.sql.
window.addEventListener('error', (e) => {
  try { recordBootStage('window_error', { level: 'error', message: e?.message || e?.error?.message || 'unknown' }); } catch {}
  reportError('Error', e.error || e);
});
window.addEventListener('unhandledrejection', (e) => {
  try { recordBootStage('unhandled_rejection', { level: 'error', message: e?.reason?.message || String(e?.reason) }); } catch {}
  reportError('Promise', e.reason);
});

// Global accessor for boot snapshot — used by:
//   1. /boot-debug page (Share button calls this then routes to Capacitor Share)
//   2. Manual debugging via Safari Web Inspector / Chrome DevTools
//   3. Native AppDelegate watchdog (via WKWebView evaluateJavaScript) when
//      it needs to know if JS is alive
// Lives on window so it survives even if React fails to mount.
try {
  // Async — gives the full snapshot via the bootDiagnostics module.
  window.__crGetBootSnapshot = () =>
    import('@/lib/bootDiagnostics').then(m => m.getBootSnapshot()).catch(() => null);
  // Sync version — falls back to a minimal payload if the module fails.
  window.__crGetBootSnapshotSync = () => {
    try {
      const log = JSON.parse(localStorage.getItem('cr_boot_log') || '[]');
      return {
        platform: /iPad|iPhone|iPod/.test(navigator.userAgent) ? 'iOS'
                 : /Android/.test(navigator.userAgent) ? 'Android' : 'Web',
        userAgent: navigator.userAgent.slice(0, 200),
        currentLog: log,
        timestamp: new Date().toISOString(),
      };
    } catch { return null; }
  };
} catch {}

// Service Worker. offline support for web users only (Capacitor loads from
// file:// and doesn't need/benefit from a SW).
if (!isNative && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}

// Keyboard handling: scroll focused input into view on mobile when keyboard opens
if (typeof window !== 'undefined' && 'visualViewport' in window) {
  let lastFocused = null;
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      lastFocused = el;
      setTimeout(() => {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      }, 300);
    }
  });
  window.visualViewport.addEventListener('resize', () => {
    if (lastFocused && document.activeElement === lastFocused) {
      try { lastFocused.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    }
  });
}

// Build-time env-var validation. Two independent gates fail boot fast
// instead of letting providers hang on undefined config:
//   (a) explicit envValidator above (covers the REQUIRED_VARS list).
//   (b) supabase.js stub setting `window.__crBootEnvError` (legacy gate
//       still useful as a defence-in-depth — catches the case where
//       someone adds a new client but forgets to add it to envValidator).
const __envFail = !__envCheck.ok ? __envCheck.errors.join(' | ') : null;
const __envErrMsg = __envFail || (typeof window !== 'undefined' ? window.__crBootEnvError : null);
if (__envErrMsg) {
  markBootStage('boot_env_error', { level: 'error', message: __envErrMsg, snapshot: __envCheck.snapshot });
  try {
    const rootEl = document.getElementById('root');
    if (rootEl) {
      const isProd = import.meta.env.PROD;
      const detail = isProd
        ? 'הגדרות בנייה חסרות. אנא דווח/י לתמיכה.'
        : `Build-time error: ${__envErrMsg}`;
      // Diagnostic payload — rendered IN-PLACE on this error screen so a
      // TestFlight user can screenshot it (or copy via the button below)
      // and we know exactly which gate fired and what import.meta.env saw.
      // Contains ONLY presence/length per required var — never raw values.
      // This block exists because /boot-debug is unreachable from this
      // dead-end state, and the env-error path is the most opaque historical
      // failure mode of the iOS TestFlight pipeline.
      const __diagPayload = {
        v: (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null),
        mode: __envCheck.mode,
        prod: __envCheck.isProd,
        dev: __envCheck.isDev,
        validatorErrors: __envCheck.errors,
        snapshot: __envCheck.snapshot,
        supabaseReason: (typeof window !== 'undefined' && window.__crBootEnvError) || null,
        ua: (navigator?.userAgent || '').slice(0, 140),
        ts: new Date().toISOString(),
      };
      const __diagJson = JSON.stringify(__diagPayload, null, 2);
      const __escDiag = __diagJson
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      rootEl.innerHTML = `
        <div dir="rtl" style="display:flex;align-items:flex-start;justify-content:center;
             min-height:100vh;background:#FAFFFE;font-family:system-ui;padding:24px;">
          <div style="text-align:center;max-width:340px;width:100%;">
            <div style="font-size:48px;margin-bottom:8px;">⚙️</div>
            <div style="font-size:22px;font-weight:800;color:#1F2937;margin-bottom:8px;">
              האפליקציה לא הצליחה לעלות
            </div>
            <div style="font-size:13px;color:#6B7280;margin-bottom:14px;line-height:1.6;">${detail}</div>
            <pre id="cr-env-diag" style="font-size:10px;text-align:left;direction:ltr;
                 background:#F3F4F6;padding:10px;border-radius:8px;overflow:auto;max-height:240px;
                 color:#374151;margin:0 0 12px;white-space:pre-wrap;word-break:break-all;">${__escDiag}</pre>
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
              <button onclick="window.location.reload()"
                style="padding:10px 22px;border-radius:12px;background:#2D5233;color:#fff;
                       font-weight:700;border:none;cursor:pointer;font-size:14px;">
                נסה שוב
              </button>
              <button id="cr-env-copy"
                style="padding:10px 22px;border-radius:12px;background:#fff;color:#2D5233;
                       font-weight:700;border:1px solid #D8E5D9;cursor:pointer;font-size:14px;">
                העתק אבחון
              </button>
            </div>
          </div>
        </div>`;
      // Wire Copy. Inline (no React) so it survives even if the
      // bundle is in a partially-failed state. Clipboard API is async
      // and gated on iOS, so we also surface a manual fallback by
      // selecting the <pre> text on tap if clipboard.writeText fails.
      try {
        const btn = document.getElementById('cr-env-copy');
        const pre = document.getElementById('cr-env-diag');
        if (btn) {
          btn.addEventListener('click', async () => {
            const text = pre?.innerText || '';
            try {
              await navigator.clipboard.writeText(text);
              btn.innerText = 'הועתק ✓';
            } catch {
              // WKWebView clipboard restrictions: fall back to selectAll
              try {
                const range = document.createRange();
                range.selectNodeContents(pre);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                btn.innerText = 'נבחר — Cmd/Ctrl+C';
              } catch {}
            }
          });
        }
      } catch {}
    }
  } catch {}
  hideSplashOnce('env-error');
  // Stop further boot — fall through to nothing else.
  throw new Error('Boot stopped: ' + __envErrMsg);
}

// Mount React. Wrapped in try/catch so that if a top-level import threw OR
// the root element disappeared, we still hide the splash and surface a
// useful error UI instead of a blank green-then-white screen.
try {
  markBootStage('react_mount_start');
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Missing #root element');
  ReactDOM.createRoot(rootEl).render(<App />);
  markBootStage('react_mount_rendered');
  // Hide splash on the next frame so the first React paint has a chance
  // to land first. Two RAFs ensure layout has committed in WKWebView.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => hideSplashOnce('react-mount'));
  });
  initNonCriticalServices();

  // Mark boot as visually-complete once the auth state resolves. This
  // closes the loop with bootDiagnostics so a future post-mortem reader
  // can tell "this launch reached the auth screen" vs "this launch hung".
  const ___bootSuccessPoll = setInterval(() => {
    if (window.__crAuthResolvedAt) {
      clearInterval(___bootSuccessPoll);
      try { markBootSucceeded(); } catch {}
    }
  }, 250);
  setTimeout(() => clearInterval(___bootSuccessPoll), 30000); // hard cap

  // Hard startup watchdog: if auth never resolves, users get stuck forever
  // on the AuthPage spinner. After 7s (was 12s) we surface a full-screen
  // recovery panel and allow a one-shot forced guest boot on next reload.
  //
  // Critical change vs. previous version: we use root.replaceChildren()
  // (or innerHTML overwrite as fallback for older WKWebView) so the
  // recovery UI ALWAYS replaces React's rendered tree. The old
  // appendChild approach left React's loading spinner visible when
  // React's reconciler later updated the tree, defeating the watchdog
  // on the exact iOS WKWebView path that needed it most.
  setTimeout(() => {
    const resolvedAt = Number(window.__crAuthResolvedAt || 0);
    if (resolvedAt) return;
    // Skip the recovery overlay when the user is already on the diagnostic
    // page — they navigated there explicitly to read logs, and overlaying
    // it with the "המשך כאורח" UI hides the very thing they came to see.
    // BootDebug bypasses providers, so __crAuthResolvedAt never gets set
    // there; without this guard the overlay always fires after 7s on
    // /boot-debug.
    if (typeof window !== 'undefined' && window.location?.pathname === '/boot-debug') {
      markBootStage('auth_watchdog_skipped_on_boot_debug');
      return;
    }
    markBootStage('auth_watchdog_timeout', { level: 'error', timeoutMs: 7000 });
    try {
      const root = document.getElementById('root');
      if (!root) return;
      const recoveryHTML = `
        <div dir="rtl" style="
          position:fixed;inset:0;z-index:99999;background:#FAFFFE;
          display:flex;align-items:center;justify-content:center;
          padding:24px;font-family:system-ui;">
          <div style="text-align:center;max-width:340px">
            <div style="font-size:22px;font-weight:800;color:#1F2937;margin-bottom:8px">הפתיחה לוקחת יותר מהרגיל</div>
            <div style="font-size:14px;color:#6B7280;margin-bottom:18px;line-height:1.5">
              אפשר לנסות טעינה נקייה ולהיכנס כאורח. לא נאבד נתונים בחשבון.
            </div>
            <button id="cr-force-guest-btn" style="padding:10px 20px;border-radius:12px;background:#2D5233;color:#fff;font-weight:700;border:none;cursor:pointer;font-size:14px;margin-left:8px">
              המשך כאורח
            </button>
            <button id="cr-retry-btn" style="padding:10px 20px;border-radius:12px;background:#fff;color:#2D5233;font-weight:700;border:1px solid #D8E5D9;cursor:pointer;font-size:14px;margin-left:8px">
              נסה שוב
            </button>
            <a href="/boot-debug" style="display:inline-block;margin-top:14px;font-size:12px;color:#9CA3AF;text-decoration:underline">
              הצג יומן אבחון
            </a>
          </div>
        </div>`;
      // replaceChildren wipes React's tree; innerHTML fallback for older Safari/WKWebView.
      try { root.replaceChildren(); } catch {}
      root.innerHTML = recoveryHTML;
      const forceBtn = root.querySelector('#cr-force-guest-btn');
      const retryBtn = root.querySelector('#cr-retry-btn');
      if (forceBtn) {
        forceBtn.addEventListener('click', () => {
          try { sessionStorage.setItem(FORCE_GUEST_ONCE_KEY, '1'); } catch {}
          window.location.reload();
        });
      }
      if (retryBtn) retryBtn.addEventListener('click', () => window.location.reload());
    } catch {}
  }, 7000);
} catch (err) {
  markBootStage('react_mount_failed', { level: 'error', message: err?.message || String(err) });
  console.error('Fatal bootstrap error:', err);
  try {
    const rootEl = document.getElementById('root');
    if (rootEl) {
      rootEl.innerHTML = `
        <div dir="rtl" style="display:flex;align-items:center;justify-content:center;
             min-height:100vh;background:#FAFFFE;font-family:system-ui;padding:24px;">
          <div style="text-align:center;max-width:320px;">
            <div style="font-size:22px;font-weight:800;color:#1F2937;margin-bottom:8px;">
              משהו השתבש 😕
            </div>
            <div style="font-size:14px;color:#6B7280;margin-bottom:20px;">
              נסה לסגור את האפליקציה ולפתוח אותה מחדש
            </div>
            <button onclick="window.location.reload()"
              style="padding:10px 28px;border-radius:12px;background:#2D5233;color:#fff;
                     font-weight:700;border:none;cursor:pointer;font-size:14px;">
              נסה שוב
            </button>
          </div>
        </div>`;
    }
  } catch {}
  hideSplashOnce('bootstrap-error');
}

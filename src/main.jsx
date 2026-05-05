import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { isNative, initStatusBar, initKeyboard, initBackButton, hideSplash, initSessionKeepAlive } from '@/lib/capacitor'
import { reportError } from '@/lib/crashReporter';
import { initBootLog, recordBootStage, markBootSucceeded } from '@/lib/bootDiagnostics';

// Boot log is the FIRST thing we initialize — even before plugin init,
// so a crash inside any subsequent line still leaves a trail behind for
// post-mortem analysis. Synchronous, never throws.
initBootLog();
recordBootStage('main_entry', { isNative, ua: navigator?.userAgent?.slice(0, 120) });

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
window.addEventListener('error', (e) => reportError('Error', e.error || e));
window.addEventListener('unhandledrejection', (e) => reportError('Promise', e.reason));

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

// Build-time env-var validation. supabase.js sets this flag when
// VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY were not injected at build
// time (i.e. CI forgot the env block). Bypass React entirely and show a
// clear startup-error screen — otherwise the app sits forever on splash
// while every Supabase-backed provider quietly fails to initialise.
if (typeof window !== 'undefined' && window.__crBootEnvError) {
  markBootStage('boot_env_error', { level: 'error', message: window.__crBootEnvError });
  try {
    const rootEl = document.getElementById('root');
    if (rootEl) {
      const isProd = import.meta.env.PROD;
      const detail = isProd
        ? 'הגדרות בנייה חסרות. אנא דווח/י לתמיכה.'
        : `Build-time error: ${window.__crBootEnvError}`;
      rootEl.innerHTML = `
        <div dir="rtl" style="display:flex;align-items:center;justify-content:center;
             min-height:100vh;background:#FAFFFE;font-family:system-ui;padding:24px;">
          <div style="text-align:center;max-width:340px;">
            <div style="font-size:48px;margin-bottom:8px;">⚙️</div>
            <div style="font-size:22px;font-weight:800;color:#1F2937;margin-bottom:8px;">
              האפליקציה לא הצליחה לעלות
            </div>
            <div style="font-size:13px;color:#6B7280;margin-bottom:18px;line-height:1.6;">${detail}</div>
            <button onclick="window.location.reload()"
              style="padding:10px 28px;border-radius:12px;background:#2D5233;color:#fff;
                     font-weight:700;border:none;cursor:pointer;font-size:14px;">
              נסה שוב
            </button>
          </div>
        </div>`;
    }
  } catch {}
  hideSplashOnce('env-error');
  // Stop further boot — fall through to nothing else.
  throw new Error('Boot stopped: ' + window.__crBootEnvError);
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

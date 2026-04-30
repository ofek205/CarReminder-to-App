import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { isNative, initStatusBar, initKeyboard, initBackButton, hideSplash, initSessionKeepAlive } from '@/lib/capacitor'

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

// Initialize notification system
import { initNotifications } from '@/lib/notificationService';
initNotifications();

// First-launch permission bootstrap. Fires the native permission prompts
// for location / notifications / camera in sequence on the first launch
// so users aren't surprised by them mid-workflow. No-op on web and on
// subsequent launches.
import { requestAllPermissionsOnFirstLaunch } from '@/lib/permissionBootstrap';
requestAllPermissionsOnFirstLaunch();

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
  try { console.info('[splash] hide:', reason); } catch {}
  hideSplash();
}
window.addEventListener('load', () => hideSplashOnce('window-load'));
setTimeout(() => hideSplashOnce('safety-8s'), 8000);

// Global error logger → localStorage (for admin Bugs tab) + remote Supabase
// (best-effort via crashReporter). See scripts/supabase-add-app-errors.sql.
import { reportError } from '@/lib/crashReporter';
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

// Mount React. Wrapped in try/catch so that if a top-level import threw OR
// the root element disappeared, we still hide the splash and surface a
// useful error UI instead of a blank green-then-white screen.
try {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Missing #root element');
  ReactDOM.createRoot(rootEl).render(<App />);
  // Hide splash on the next frame so the first React paint has a chance
  // to land first. Two RAFs ensure layout has committed in WKWebView.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => hideSplashOnce('react-mount'));
  });
} catch (err) {
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

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

// Hide splash screen after app mounts
setTimeout(() => hideSplash(), 500);

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

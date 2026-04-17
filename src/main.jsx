import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { isNative, initStatusBar, initKeyboard, initBackButton, hideSplash } from '@/lib/capacitor'

// Mark document for native-specific CSS
if (isNative) {
  document.documentElement.classList.add('native-app');
}

// Initialize native plugins (no-op on web)
initStatusBar();
initKeyboard();
initBackButton();

// Initialize notification system
import { initNotifications } from '@/lib/notificationService';
initNotifications();

// Hide splash screen after app mounts
setTimeout(() => hideSplash(), 500);

// Global error logger → localStorage for admin bugs tab
function logError(type, error) {
  try {
    const log = JSON.parse(localStorage.getItem('app_error_log') || '[]');
    log.push({
      type,
      message: error?.message || String(error),
      stack: error?.stack?.slice(0, 500),
      url: window.location.pathname,
      timestamp: Date.now(),
      userAgent: navigator.userAgent.slice(0, 100),
    });
    localStorage.setItem('app_error_log', JSON.stringify(log.slice(-50)));
  } catch {}
}
window.addEventListener('error', (e) => logError('Error', e.error || e));
window.addEventListener('unhandledrejection', (e) => logError('Promise', e.reason));

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

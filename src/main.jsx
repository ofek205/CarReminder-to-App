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

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

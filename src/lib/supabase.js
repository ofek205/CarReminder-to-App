import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Custom storage adapter for Supabase Auth.
 *
 * Why: on native (Capacitor), WebView localStorage CAN be cleared by Android
 * when the device is low on memory or when the user does "Clear cache" in
 * system settings. Capacitor's @capacitor/preferences is backed by
 * SharedPreferences on Android + NSUserDefaults on iOS. it survives those
 * operations and only clears on full "Clear data" / uninstall.
 *
 * On web we just use localStorage so nothing changes for browser users.
 *
 * The adapter is synchronous-compatible (Supabase expects sync or promise).
 * Preferences returns promises. that's fine, Supabase awaits them.
 */
const isNative = Capacitor.isNativePlatform();

const STORAGE_OP_TIMEOUT_MS = 2500;
const withTimeout = (promise, fallbackValue, timeoutMs = STORAGE_OP_TIMEOUT_MS) =>
  Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallbackValue), timeoutMs)),
  ]);

const nativeStorage = {
  async getItem(key) {
    try {
      const mod = await withTimeout(import('@capacitor/preferences'), null);
      const Preferences = mod?.Preferences;
      if (!Preferences?.get) return null;
      const result = await withTimeout(Preferences.get({ key }), { value: null });
      const value = result?.value;
      return value ?? null;
    } catch { return null; }
  },
  async setItem(key, value) {
    try {
      const mod = await withTimeout(import('@capacitor/preferences'), null);
      const Preferences = mod?.Preferences;
      if (!Preferences?.set) return;
      await withTimeout(Preferences.set({ key, value }), null);
    } catch {}
  },
  async removeItem(key) {
    try {
      const mod = await withTimeout(import('@capacitor/preferences'), null);
      const Preferences = mod?.Preferences;
      if (!Preferences?.remove) return;
      await withTimeout(Preferences.remove({ key }), null);
    } catch {}
  },
};

// Browser localStorage with try/catch (Safari private mode can throw)
const webStorage = {
  getItem(key) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { localStorage.setItem(key, value); } catch {} },
  removeItem(key) { try { localStorage.removeItem(key); } catch {} },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Use SharedPreferences-backed storage on native (survives memory pressure
    // and WebView clears). Fall back to localStorage on the web.
    storage: isNative ? nativeStorage : webStorage,

    // Persist the session across app launches. this is the default but we
    // spell it out so it's obvious at the call site.
    persistSession: true,

    // Refresh the JWT in the background 60s before it expires. Without this,
    // a user who's been in the app for an hour gets a cold 401 on their next
    // API call. With this, the refresh happens transparently.
    autoRefreshToken: true,

    // Parse ?access_token=... from OAuth redirects. needed for Google login.
    detectSessionInUrl: true,

    // PKCE is safer than implicit flow for public clients (mobile apps).
    flowType: 'pkce',
  },
});

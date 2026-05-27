import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

// Trim whitespace defensively. GitHub Actions secrets pasted with a
// trailing newline get baked into the bundle verbatim ("eyJ...\n"),
// which makes `new URL()` inside createClient() throw AND breaks the
// JWT-shape regex in envValidator (since /…$/ without the `m` flag
// rejects a trailing \n). This was the actual production failure on
// 3.0.2 (152): CI saw `len=209` while local builds had `len=208`,
// off-by-one exactly == the trailing newline. Trimming here keeps the
// runtime path tolerant; envValidator's snapshot records the raw vs
// trimmed length so /boot-debug surfaces the discrepancy explicitly.
const __rawUrl = import.meta.env.VITE_SUPABASE_URL;
const __rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseUrl = typeof __rawUrl === 'string' ? __rawUrl.trim() : __rawUrl;
const supabaseAnonKey = typeof __rawKey === 'string' ? __rawKey.trim() : __rawKey;

// Defensive check: if a CI build forgot to inject VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY, `createClient(undefined, undefined)` throws
// synchronously below. That throw cascades through every module that
// imports '@/lib/supabase' — React never mounts, and on iOS the WebView
// is stuck on a white screen / native splash forever (no JS runs to call
// SplashScreen.hide()). This was the root cause of the iOS TestFlight
// "infinite loading" bug across builds 2.7.0..2.7.5.
//
// Instead of throwing at module-load, we set a window flag and export a
// stub client below. main.jsx detects the flag and shows a clear
// startup-error screen rather than letting the user stare at a blank app.
function makeStubClient(reason) {
   
  console.error('[supabase] config error:', reason);
  if (typeof window !== 'undefined') {
    window.__crBootEnvError = reason;
  }
  const reject = () => Promise.reject(new Error(`Supabase not configured: ${reason}`));
  const subscription = { unsubscribe: () => {} };
  // Stub surface enough of the client API that consumer top-level access
  // (e.g. `supabase.auth.onAuthStateChange(...)` in providers) doesn't
  // crash on undefined. Calls return rejected promises / empty results,
  // which ARE handled (catch blocks, `data, error` patterns) throughout
  // the codebase. The point is to let main.jsx render an error UI.
  return {
    auth: {
      getSession:            () => Promise.resolve({ data: { session: null }, error: new Error(reason) }),
      getUser:               () => Promise.resolve({ data: { user: null }, error: new Error(reason) }),
      signInWithPassword:    reject,
      signInWithOAuth:       reject,
      signUp:                reject,
      signOut:               () => Promise.resolve({ error: null }),
      onAuthStateChange:     () => ({ data: { subscription } }),
      refreshSession:        reject,
      updateUser:            reject,
      resetPasswordForEmail: reject,
      exchangeCodeForSession: reject,
      setSession:            reject,
    },
    from: () => ({
      select: () => ({
        eq:          () => ({ maybeSingle: () => Promise.resolve({ data: null, error: new Error(reason) }), single: reject, order: () => ({ limit: () => Promise.resolve({ data: [], error: new Error(reason) }) }), limit: () => Promise.resolve({ data: [], error: new Error(reason) }) }),
        maybeSingle: () => Promise.resolve({ data: null, error: new Error(reason) }),
        single:      reject,
        order:       () => ({ limit: () => Promise.resolve({ data: [], error: new Error(reason) }) }),
        limit:       () => Promise.resolve({ data: [], error: new Error(reason) }),
      }),
      insert: reject, update: reject, delete: reject, upsert: reject,
    }),
    storage:   { from: () => ({ upload: reject, download: reject, remove: reject, list: reject, getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    rpc:       reject,
    functions: { invoke: reject },
    channel:   () => ({ on: () => ({ subscribe: () => subscription }) }),
    removeChannel: () => {},
  };
}

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
// NOTE: deliberately NOT named withTimeout — the helper in src/lib/supabaseQuery.js
// has the same name but opposite semantics (rejects on timeout, takes a label).
// This one resolves with a fallback value on timeout, used to keep native storage
// reads from hanging the auth boot path.
const raceWithFallback = (promise, fallbackValue, timeoutMs = STORAGE_OP_TIMEOUT_MS) =>
  Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallbackValue), timeoutMs)),
  ]);

const nativeStorage = {
  async getItem(key) {
    try {
      const mod = await raceWithFallback(import('@capacitor/preferences'), null);
      const Preferences = mod?.Preferences;
      if (!Preferences?.get) return null;
      const result = await raceWithFallback(Preferences.get({ key }), { value: null });
      const value = result?.value;
      return value ?? null;
    } catch { return null; }
  },
  async setItem(key, value) {
    try {
      const mod = await raceWithFallback(import('@capacitor/preferences'), null);
      const Preferences = mod?.Preferences;
      if (!Preferences?.set) return;
      await raceWithFallback(Preferences.set({ key, value }), null);
    } catch {}
  },
  async removeItem(key) {
    try {
      const mod = await raceWithFallback(import('@capacitor/preferences'), null);
      const Preferences = mod?.Preferences;
      if (!Preferences?.remove) return;
      await raceWithFallback(Preferences.remove({ key }), null);
    } catch {}
  },
};

// Browser localStorage with try/catch (Safari private mode can throw)
const webStorage = {
  getItem(key) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { localStorage.setItem(key, value); } catch {} },
  removeItem(key) { try { localStorage.removeItem(key); } catch {} },
};

// Guarded createClient: if env vars are missing (CI forgot to inject), use
// a stub so module-load doesn't throw. main.jsx will detect window.__crBootEnvError
// and render a clear error screen instead of an infinite splash.
function buildSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    const missing = !supabaseUrl ? 'VITE_SUPABASE_URL' : 'VITE_SUPABASE_ANON_KEY';
    return makeStubClient(`Missing build-time env var ${missing}`);
  }
  try {
    return createClient(supabaseUrl, supabaseAnonKey, {
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
  } catch (e) {
    return makeStubClient(`createClient failed: ${e?.message || 'unknown'}`);
  }
}

export const supabase = buildSupabaseClient();

// The resolved (trimmed) project URL + anon key, exported for the rare
// call site that must hit an Edge Function with a raw fetch — e.g.
// overpass-proxy in FindGarage, which needs an AbortSignal that
// supabase.functions.invoke() doesn't accept. Use supabase.functions
// .invoke() for everything else; only reach for these when you need
// fetch-level control (abort, streaming, custom timeout).
export { supabaseUrl, supabaseAnonKey };

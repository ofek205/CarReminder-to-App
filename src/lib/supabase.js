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

const realClient = buildSupabaseClient();

// ═══════════════════════════════════════════════════════════════════════════
// Admin impersonation — data-plane redirection
//
// During an audited view session, admin-impersonate mints a short-lived JWT
// whose `sub` is the TARGET user. Routing data calls through a client carrying
// that token makes auth.uid() the target, so every RLS policy and every
// SECURITY DEFINER RPC — including ones not written yet — behaves exactly as
// it does for the real user. That replaces the previous model, where each
// policy needed its own is_viewing() escape: a scan on 2026-07-24 found 22
// functions gating on auth.uid() membership and exactly ONE with an escape.
//
// WHAT IS AND IS NOT REDIRECTED
//   Redirected: from, rpc, storage, functions — the data plane.
//   NOT redirected: auth. The admin's real session lives there, and it is what
//     the view-as banner, the exit button, token refresh and sign-out all
//     depend on. Point auth at a session-less client and the admin cannot get
//     back out.
//   NOT redirected: channel / removeChannel. Realtime authenticates its socket
//     separately; a half-authenticated websocket fails quietly and is
//     miserable to diagnose. Realtime during view-as is a nice-to-have, so it
//     stays on the real client rather than becoming a subtle failure.
//
// The impersonation client never persists. persistSession:false means the
// target's token is never written to disk — close the tab mid-session and it
// is simply gone, rather than leaving an admin holding a customer's identity
// in localStorage. autoRefreshToken:false because a self-signed token has no
// refresh token; letting the SDK try would fail and could clear the session.
// ═══════════════════════════════════════════════════════════════════════════

let _impersonationClient = null;

/** Route data calls as the impersonated user. Called on entering view-as. */
export function setImpersonationToken(token) {
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    _impersonationClient = null;
    return false;
  }
  try {
    _impersonationClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession:     false,
        autoRefreshToken:   false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    return true;
  } catch {
    // Fail closed: no impersonation client means every call falls back to the
    // admin's own token, which is the pre-existing behaviour. Degraded, not broken.
    _impersonationClient = null;
    return false;
  }
}

/** Drop the impersonated identity. Called on exiting view-as and on expiry. */
export function clearImpersonationToken() {
  _impersonationClient = null;
}

/** True while data calls are being made as someone else. */
export function isImpersonating() {
  return _impersonationClient !== null;
}

/**
 * The un-proxied client — always the signed-in user, never the impersonated
 * one. Use for anything that must speak AS THE ADMIN while a session is live:
 * admin_start_view, admin_end_view, admin_current_view, admin_user_accounts,
 * and the admin-impersonate mint itself.
 *
 * Every one of those begins with an is_admin() check and would be rejected if
 * it arrived as the target — who is never an admin, since minting refuses
 * admin targets. Worse, several of the rejections are swallowed by a catch,
 * so the failure is silent: an exit that does not exit, a renewal that never
 * renews, a workspace list that quietly empties.
 *
 * This existed as "remember to call clearImpersonationToken() first" and was
 * forgotten three times in one sitting. A named export makes the correct
 * client the one you have to ask for, rather than the one you have to
 * remember to restore.
 */
export const adminSupabase = realClient;

const DATA_PLANE = new Set(['from', 'rpc', 'storage', 'functions']);

export const supabase = new Proxy(realClient, {
  get(target, prop) {
    const client = (DATA_PLANE.has(prop) && _impersonationClient) || target;
    const value = Reflect.get(client, prop, client);
    // Methods must keep their own client as `this` — an unbound reference
    // would execute against the wrong instance and silently use the wrong
    // token, which is the exact failure this whole mechanism exists to avoid.
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

// The resolved (trimmed) project URL + anon key, exported for the rare
// call site that must hit an Edge Function with a raw fetch — e.g.
// overpass-proxy in FindGarage, which needs an AbortSignal that
// supabase.functions.invoke() doesn't accept. Use supabase.functions
// .invoke() for everything else; only reach for these when you need
// fetch-level control (abort, streaming, custom timeout).
export { supabaseUrl, supabaseAnonKey };

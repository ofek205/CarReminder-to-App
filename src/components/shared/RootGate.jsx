import React from 'react';
import { Navigate } from 'react-router-dom';
import AuthPage from '@/pages/AuthPage';

/**
 * RootGate — synchronous router for the `/` route.
 *
 * Background: pages.config.js sets `mainPage: 'Auth'`, so the bare `/`
 * URL used to render AuthPage. AuthPage handles authenticated visitors
 * by running `navigate('/Dashboard')` from a useEffect once auth resolves,
 * but that's an *asynchronous* redirect — it fires AFTER React has
 * already painted at least one frame of AuthPage's own loading screen,
 * and on slower connections after the 3-second bypass timer it also
 * paints the actual login form. Users on every platform reported seeing
 * a few seconds of "login screen / popup / spinner" on every cold
 * launch and every refresh.
 *
 * RootGate sits at the `/` route INSTEAD of AuthPage. It performs a
 * synchronous decision before React even commits the first paint:
 *
 *   1. Look in localStorage for any Supabase auth-token key. Supabase v2
 *      stores the active session under `sb-<project-ref>-auth-token`.
 *      If the user has signed in on this device before AND hasn't been
 *      logged out, the key is there. Reading localStorage is sync and
 *      cheap (<1ms).
 *
 *   2. Also consider a remembered last-route in sessionStorage (the
 *      `cr_last_route` key, written by Layout on every navigation).
 *      Refreshing while you were on /Documents should drop you back on
 *      /Documents, not on /Dashboard — that's the "feels like native"
 *      promise.
 *
 *   3. If a token exists, return <Navigate replace /> immediately. The
 *      first render is the navigation itself — AuthPage is never even
 *      mounted, so it cannot flash. React Router handles the bookkeeping;
 *      the user sees /Dashboard's chrome immediately, with Dashboard's
 *      own localStorage cache (v4.6.4) hydrating its content.
 *
 *   4. If no token exists, fall through to AuthPage. The
 *      `hasStoredSession` check in AuthPage will short-circuit its 3s
 *      bypass anyway, so unauthenticated users see the form right away
 *      without the bypass-induced flash.
 *
 * If the stored token turns out to be invalid (expired, server-revoked,
 * tampered), the user will land on the target route, Layout's redirect
 * useEffect will detect `!isAuthenticated` after the async bootstrap,
 * and send them back to `/Auth`. That round-trip is identical to what
 * would happen if they navigated to a protected route directly. The
 * worst case is a brief Dashboard glance — still better than the
 * pre-fix flash of the login form.
 *
 * Why a separate component and not inline in App.jsx:
 *   - Keeps the route table flat and readable
 *   - Allows future enrichment (e.g. respecting a `?next=` query param,
 *     PWA "shortcuts" deep links) without bloating App.jsx
 *   - Makes the synchronous-vs-async decision a single named primitive
 *     that's easy to review and to wrap in tests
 */

// Synchronously scan localStorage for a Supabase session key. Returns
// the saved location to navigate to (last route or /Dashboard) when a
// token is found, or null when no token exists.
//
// We don't trust the token's contents — we only check that a non-empty
// value exists under the right key shape. Verifying the JWT is the
// server's job; this is just routing intent.
function resolveBootDestination() {
  let hasToken = false;
  try {
    // Primary signal — Supabase v2 storage key. Present on WEB always
    // (the storage adapter writes there). On CAPACITOR this key is
    // empty because supabase-js writes to Capacitor Preferences
    // (UserDefaults / SharedPreferences) instead — see src/lib/supabase.js,
    // `nativeStorage` adapter. That's exactly why the cr_has_session
    // mirror below exists: it's a synchronous breadcrumb we write
    // ourselves from GuestContext.onAuthStateChange, so RootGate has
    // something to read on native cold-launch before any async API
    // call resolves.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const v = localStorage.getItem(k);
        if (v && v.length > 10) { hasToken = true; break; }
      }
    }
    // Secondary signal — written by GuestContext on every SIGNED_IN /
    // INITIAL_SESSION event, cleared on SIGNED_OUT (and again in
    // handleLogout for belt-and-suspenders). This is the ONLY signal
    // available on Capacitor; on web it's a redundant but harmless
    // cross-check. Presence is enough — we don't trust contents.
    if (!hasToken && localStorage.getItem('cr_has_session') === '1') {
      hasToken = true;
    }
  } catch {
    // localStorage denied (Safari private mode, GDPR holdouts). Treat
    // as "no token" — user will see AuthPage. Their session will still
    // restore once supabase-js falls back to its in-memory storage.
    return null;
  }
  if (!hasToken) return null;

  // Optional: respect a last-route hint stamped by Layout. The hint is
  // a pathname only, no query/hash, so we don't risk re-opening a stale
  // modal-via-query-param. Limited to a small allow-list of internal
  // routes — anything weird falls back to /Dashboard.
  let last = null;
  try {
    last = sessionStorage.getItem('cr_last_route');
  } catch {}
  if (last && /^\/[A-Za-z][\w/-]*$/.test(last) && last !== '/' && last !== '/Auth') {
    return last;
  }
  return '/Dashboard';
}

export default function RootGate() {
  const destination = resolveBootDestination();
  if (destination) {
    // `replace` so the back button doesn't bring the user back to `/`
    // (which would just re-run this gate and re-navigate them away —
    // visually fine but causes a single wasted history entry).
    return <Navigate to={destination} replace />;
  }
  // No token → no flash for unauthenticated users either: AuthPage's
  // own `hasStoredSession` probe will be false, so its 3s bypass timer
  // is irrelevant for THIS path (it only suppresses the form when a
  // token exists). The plain form renders as soon as auth resolves.
  return <AuthPage />;
}

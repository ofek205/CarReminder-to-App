import React from 'react';
import { Navigate } from 'react-router-dom';
import AuthPage from '@/pages/AuthPage';
import useIsAdmin from '@/hooks/useIsAdmin';
import { isNative } from '@/lib/capacitor';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

/**
 * RootGate — the landing router for the `/` route.
 *
 * Background: pages.config.js sets `mainPage: 'Auth'`, so the bare `/`
 * URL used to render AuthPage, which then async-redirected authenticated
 * users to /Dashboard — causing a login-screen flash on every cold launch.
 * RootGate replaces that with a synchronous decision before first paint.
 *
 * ── Landing policy ───────────────────────────────────────────────────
 *   • No session token            → AuthPage (no flash for guests either).
 *   • Admin (known)               → /AdminHome (the admin's default home),
 *                                    or their last admin route on refresh.
 *   • Non-admin (known)           → last route, else /Dashboard.
 *   • Admin status UNKNOWN at boot → defer to <BootAdminResolver>, which
 *                                    WAITS for the authoritative is_admin()
 *                                    result instead of guessing.
 *
 * ── Why the "unknown" branch exists (the race this fixes) ────────────
 * Admin status comes from the async `is_admin()` RPC; useIsAdmin() caches
 * the result in localStorage('cr_is_admin') AFTER it resolves (~300ms). A
 * synchronous boot read therefore can't trust that flag right after login
 * or on a fresh device — GuestContext clears 'cr_is_admin' on SIGNED_OUT,
 * so a just-logged-in admin has NO cached flag and the old code defaulted
 * them to /Dashboard. The previous "always land on admin" attempts failed
 * for exactly this read-before-write reason.
 *
 * The fix: when the cached flag is PRESENT we route synchronously (instant,
 * no spinner — the common "reopen the app" case). When it's ABSENT we don't
 * guess: we render a one-time spinner and let useIsAdmin() resolve, then
 * navigate. That spinner only ever shows right after login or on a brand-new
 * device — returning users never see it.
 */

// Boot decision shapes:
//   { kind: 'auth' }                              → render AuthPage
//   { kind: 'go', to }                            → <Navigate replace>
//   { kind: 'admin-unknown', last, lastIsValid }  → wait for is_admin()
function resolveBootDestination() {
  let hasToken = false;
  try {
    // Primary signal — Supabase v2 web storage key. Empty on Capacitor
    // (supabase-js writes to native Preferences there), which is why the
    // cr_has_session mirror below exists as a synchronous breadcrumb.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const v = localStorage.getItem(k);
        if (v && v.length > 10) { hasToken = true; break; }
      }
    }
    // Secondary signal — written by GuestContext on SIGNED_IN /
    // INITIAL_SESSION, cleared on SIGNED_OUT. The only signal on Capacitor.
    if (!hasToken && localStorage.getItem('cr_has_session') === '1') {
      hasToken = true;
    }
  } catch {
    // localStorage denied (private mode). Treat as no token → AuthPage.
    return { kind: 'auth' };
  }
  if (!hasToken) {
    // No account. On the WEB that is usually a stranger who typed the brand
    // domain, and the marketing site is what they came for: car-reminder.app
    // used to answer them with a login form, so every visitor Google sent to
    // the bare domain met a wall instead of the twenty pages built for them.
    //
    // Two groups must NOT be sent there, and both are invisible in `hasToken`:
    //
    //   • Native. The app shell boots this same route from local files
    //     (capacitor.config webDir 'dist', no server.url), so a redirect here
    //     would open the marketing site INSIDE the app.
    //   • Guests. Guest mode keeps real vehicles in localStorage and never
    //     issues a token, so a returning guest is indistinguishable from a
    //     stranger by token alone. Bouncing them to marketing would read as
    //     "my vehicles are gone".
    //
    // Everyone else keeps a way in: the marketing header carries
    // "כניסה לחשבון", and /Auth stays directly reachable.
    let hasGuestData = false;
    try {
      const raw = localStorage.getItem('fleet_guest_vehicles');
      hasGuestData = !!raw && JSON.parse(raw)?.length > 0;
    } catch { hasGuestData = true; }
    if (!isNative && !hasGuestData) return { kind: 'go', to: '/website' };
    return { kind: 'auth' };
  }

  // Last-route hint stamped by Layout (pathname only, allow-listed).
  let last = null;
  try { last = sessionStorage.getItem('cr_last_route'); } catch {}
  const lastIsValid =
    last && /^\/[A-Za-z][\w/-]*$/.test(last) && last !== '/' && last !== '/Auth';

  // Admin landing. The cached flag is the ONLY synchronous signal we have;
  // we trust it only when explicitly set. See the doc comment for why an
  // absent flag must NOT be treated as "not admin".
  let adminHint = null;
  try { adminHint = localStorage.getItem('cr_is_admin'); } catch {}

  if (adminHint === '1') {
    // Returning admin — instant, no flash. Refreshing while on an admin
    // page keeps you there; everything else defaults to /AdminHome.
    if (lastIsValid && last.startsWith('/Admin')) return { kind: 'go', to: last };
    return { kind: 'go', to: '/AdminHome' };
  }
  if (adminHint === '0') {
    // Known non-admin — legacy behavior: last route wins, else Dashboard.
    return { kind: 'go', to: lastIsValid ? last : '/Dashboard' };
  }

  // Flag absent (just logged in, or first launch on this device). Don't
  // guess — defer to the reactive resolver below.
  return { kind: 'admin-unknown', last, lastIsValid };
}

export default function RootGate() {
  const decision = resolveBootDestination();
  if (decision.kind === 'auth') return <AuthPage />;
  if (decision.kind === 'go') {
    // `replace` so back doesn't return to `/` and re-run the gate.
    return <Navigate to={decision.to} replace />;
  }
  return <BootAdminResolver last={decision.last} lastIsValid={decision.lastIsValid} />;
}

/**
 * Mounted ONLY when a session token exists but the admin flag is not yet
 * cached (post-login / fresh device). Waits for the authoritative
 * is_admin() result rather than racing it, then navigates to the correct
 * home. useIsAdmin() returns null while resolving — we show a spinner for
 * that brief window instead of flashing the wrong screen.
 */
function BootAdminResolver({ last, lastIsValid }) {
  const isAdmin = useIsAdmin();
  if (isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <LoadingSpinner />
      </div>
    );
  }
  if (isAdmin) return <Navigate to="/AdminHome" replace />;
  return <Navigate to={lastIsValid ? last : '/Dashboard'} replace />;
}

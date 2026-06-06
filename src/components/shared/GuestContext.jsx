/**
 * GuestContext — Auth session facade.
 *
 * Manages: Supabase auth state (loading/authenticated/guest), user object,
 * session bootstrap (iOS WKWebView timeouts, retry), account provisioning,
 * OAuth welcome email, PIN lock binding, push notification init.
 *
 * Guest data CRUD (vehicles, documents, accidents, vessel issues, cork
 * notes, reminder settings, demo state) lives in GuestDataContext.jsx.
 * This provider wraps <GuestDataProvider> and useAuth() merges both
 * contexts for full backward compatibility — zero consumer changes.
 */
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { GuestDataProvider, GuestDataCtx, DEFAULT_REMINDER_SETTINGS } from '@/contexts/GuestDataContext';

const AuthCtx = createContext(null);
const FORCE_GUEST_ONCE_KEY = 'cr_force_guest_once';

//  Welcome email dispatch — OAuth signup paths
// Email+password signups dispatch their welcome from AuthPage (which has
// the user's full name from form state). OAuth signups (Google / Apple,
// web + native) skip AuthPage's dispatcher entirely — they exchange a
// code/token for a session and SIGNED_IN fires here. Without this
// helper they'd never receive a welcome email.
//
// Discovery context: launch day for v4.7.0, ~45 signups, only 2 welcome
// emails reached Resend because all but 2 came in via OAuth.
//
// Gates (must all pass):
//   1. provider !== 'email' — email/password path is owned by AuthPage,
//      so this helper stays out of its way and we never race two dispatches.
//   2. user.created_at within last 5 minutes — INITIAL_SESSION fires on
//      every page load when a session is stored, so without an age check
//      we'd re-fire welcome on every return visit during the same hour.
//   3. localStorage flag not set — protects against tab refresh during
//      the OAuth callback (a real path on slow networks). Per-device only,
//      which is fine: a second-device sign-in within 5 min is extremely rare.
//
// Failure policy: silent. Welcome is best-effort, must never block auth
// or surface an error to the user.
async function dispatchOAuthWelcomeEmail(user) {
  if (!user || !user.id || !user.email) return;
  const provider = user.app_metadata?.provider;
  if (!provider || provider === 'email') return;

  const createdAtMs = user.created_at ? new Date(user.created_at).getTime() : 0;
  if (!createdAtMs || Date.now() - createdAtMs > 5 * 60 * 1000) return;

  const flagKey = `cr_welcome_sent_${user.id}`;
  try { if (localStorage.getItem(flagKey)) return; } catch {}

  // Set flag BEFORE sending to prevent race condition: INITIAL_SESSION
  // and SIGNED_IN fire back-to-back, both check the flag before either
  // finishes the async send → duplicate emails. Setting early means a
  // failed send won't retry, but that's acceptable for a welcome email.
  try { localStorage.setItem(flagKey, '1'); } catch {}

  try {
    const fullName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      '';
    const firstName = String(fullName).trim().split(/\s+/)[0] || '';
    const { sendEmail } = await import('@/lib/sendEmail');
    const { buildWelcomeEmail, buildWelcomeText } = await import('@/lib/emailTemplates');
    await sendEmail({
      to: user.email,
      subject: `ברוכים הבאים ל-CarReminder${firstName ? `, ${firstName}` : ''}`,
      html: buildWelcomeEmail({ firstName, appUrl: 'https://car-reminder.app' }),
      text: buildWelcomeText({ firstName, appUrl: 'https://car-reminder.app' }),
      notificationKey: 'welcome',
    });
  } catch (err) {
    if (import.meta.env?.DEV) {
      console.warn('[welcome-email] OAuth dispatch failed:', err?.message);
    }
  }
}

// Normalize Supabase user to a consistent shape used across the app
function normalizeUser(supabaseUser) {
  return {
    ...supabaseUser,
    full_name: supabaseUser.user_metadata?.full_name || supabaseUser.email,
    role: supabaseUser.user_metadata?.role || null,
  };
}

/**
 * Inner auth provider. MUST be rendered inside <GuestDataProvider>
 * so it can access migrateGuestDataIfNeeded via context.
 */
function AuthInner({ children }) {
  // Access guest data context via ref so the mount-time useEffect
  // closure always sees the latest context value.
  const guestData = useContext(GuestDataCtx);
  const guestDataRef = useRef(guestData);
  guestDataRef.current = guestData;

  const [authState, setAuthState] = useState('loading');
  const [user, setUser] = useState(null);

  useEffect(() => {
    // ensure_user_account is idempotent: returns the existing account
    // for already-provisioned users, atomically creates one for first-
    // timers. Calling it from the single auth chokepoint here means
    // every page (Vehicles, AddVehicle, Dashboard, Layout, …) finds
    // an account_members row by the time it queries — no more
    // infinite-skeleton state for users who land on a non-Dashboard
    // route after sign-up. The server-side trigger
    // (supabase-new-user-bootstrap.sql) is the primary defense; this
    // client call is the safety net for already-existing users who
    // signed up before the trigger landed.
    //
    // 5s timeout: a stalled RPC must not pin users on the loading
    // screen indefinitely. Pages tolerate missing membership (will
    // refetch once it arrives), so we'd rather flip authState and
    // recover than block the entire app on a slow round-trip.
    const provisionIfNeeded = async () => {
      try {
        await Promise.race([
          supabase.rpc('ensure_user_account'),
          new Promise(resolve => setTimeout(resolve, 5000)),
        ]);
      } catch { /* fall through; pages will surface the error */ }
    };

    // Emergency recovery path from main.jsx watchdog. If set, we skip
    // session restoration exactly once and enter guest mode immediately.
    // SECURITY: uses sessionStorage (per-tab, cleared on close) NOT
    // localStorage. The key is removed immediately after reading so it
    // cannot persist. Additionally, we verify the value was set by the
    // watchdog (which stamps a timestamp) to reject stale/injected values.
    // Audit finding H-4 (2026-05-27): localStorage version could be set
    // by XSS to downgrade auth. sessionStorage + timestamp check mitigates.
    try {
      const forceGuestVal = sessionStorage.getItem(FORCE_GUEST_ONCE_KEY);
      if (forceGuestVal === '1') {
        sessionStorage.removeItem(FORCE_GUEST_ONCE_KEY);
        // Only honor if the watchdog set it recently (within 30s).
        // This prevents a stale or externally-injected value from
        // downgrading auth on a later page load.
        const watchdogTs = Number(sessionStorage.getItem('cr_watchdog_ts') || '0');
        sessionStorage.removeItem('cr_watchdog_ts');
        if (watchdogTs && Date.now() - watchdogTs < 30000) {
          setAuthState('guest');
          try { window.__crAuthResolvedAt = Date.now(); } catch {}
          return undefined;
        }
        // Stale/missing timestamp — ignore the flag, proceed with normal auth.
      }
    } catch {}

    // iOS hot-fix: on some WKWebView cold starts, Supabase
    // auth.getSession() can stall while reading persisted auth data
    // from the native storage bridge. If we await it forever, authState
    // never leaves "loading" and AuthPage shows the spinner forever.
    // We cap the initial bootstrap wait and degrade gracefully to guest.
    //
    // Timeouts tightened (8s→4s) because user-visible "stuck spinner"
    // is a worse failure mode than a brief race-to-authenticate when
    // storage is genuinely slow. The post-bootstrap retry pass will
    // upgrade us back to authenticated within ~2s if the session shows
    // up, so the worst-case behaviour for a real user is: 4s on a
    // guest spinner → 2s of "almost there" UI → authenticated.
    const getSessionWithTimeout = async (timeoutMs = 4000) => {
      try {
        const timeout = new Promise(resolve =>
          setTimeout(() => resolve({ data: { session: null }, error: new Error('getSession timeout') }), timeoutMs)
        );
        const result = await Promise.race([supabase.auth.getSession(), timeout]);
        return result || { data: { session: null }, error: null };
      } catch (err) {
        return { data: { session: null }, error: err };
      }
    };

    let cancelled = false;
    let retryTimer = null;
    let hardFallbackTimer = null;

    // Hard fallback: regardless of what getSession / onAuthStateChange
    // are doing, after 5s we ALWAYS leave 'loading' state. Even if
    // every async path is hung, even if `cancelled` was somehow set,
    // even if the storage adapter is dead — at 5s the user sees a UI
    // they can interact with. This is the unconditional escape hatch
    // that ensures `isLoading` cannot last more than 5 seconds.
    hardFallbackTimer = setTimeout(() => {
      // Read the latest authState via functional update — if some
      // other code path already resolved auth, we MUST NOT clobber it.
      setAuthState(current => {
        if (current !== 'loading') return current;
        try { window.__crAuthResolvedAt = Date.now(); } catch {}
        try { console.warn('[auth] hard fallback to guest @5s'); } catch {}
        return 'guest';
      });
    }, 5000);

    const initAuthBootstrap = async () => {
      const { data, error } = await getSessionWithTimeout();
      if (cancelled) return;
      const session = data?.session || null;

      if (session?.user) {
        setUser(normalizeUser(session.user));
        await provisionIfNeeded();
        if (!cancelled) {
          setAuthState('authenticated');
          try { window.__crAuthResolvedAt = Date.now(); } catch {}
        }
        return;
      }

      if (error && import.meta.env.DEV) {
        console.warn('Auth bootstrap fallback to guest:', error?.message || error);
      }
      setAuthState('guest');
      try { window.__crAuthResolvedAt = Date.now(); } catch {}

      // Soft recovery: if storage was merely slow (not dead), try one
      // delayed pass to restore an existing authenticated session without
      // forcing the user to sign in again.
      retryTimer = setTimeout(async () => {
        if (cancelled) return;
        const retry = await getSessionWithTimeout(4000);
        const retrySession = retry?.data?.session || null;
        if (!retrySession?.user || cancelled) return;
        setUser(normalizeUser(retrySession.user));
        await provisionIfNeeded();
        if (!cancelled) {
          setAuthState('authenticated');
          try { window.__crAuthResolvedAt = Date.now(); } catch {}
        }
      }, 2000);
    };
    initAuthBootstrap();

    // Listen for auth state changes. Provisioning runs only on the
    // events where it can actually matter (first sign-in / restored
    // session). Skipping TOKEN_REFRESHED / USER_UPDATED avoids one
    // RPC round-trip per hour per active user — cheap on its own,
    // but unnecessary noise.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const newUser = normalizeUser(session.user);
        setUser(newUser);
        // Bind the PIN module to this user FIRST, before any pages
        // mount and read isPinEnabled(). Without this, user B logging
        // in on a device where user A previously set a PIN would be
        // prompted for user A's PIN — because the storage keys used
        // to be global. Now every key is namespaced by userId and the
        // module no-ops when the active user isn't set.
        //
        // Also: if the pinLock module just deleted legacy v1 keys on
        // boot (multi-user migration), surface a one-time toast that
        // guides the user to re-enable PIN in Settings. The user lost
        // PIN protection by upgrading — that's intentional + safer
        // than auto-migrating a stranger's PIN, but they DO need to
        // know about it.
        import('@/lib/pinLock')
          .then(async ({ setActivePinUser, consumeV1MigrationNotice }) => {
            setActivePinUser(newUser.id);
            if (consumeV1MigrationNotice()) {
              try {
                const { toast } = await import('sonner');
                toast.info('שדרגנו את ה-PIN', {
                  description: 'אנא הגדר/י קוד נעילה מחדש בהגדרות → אבטחה',
                  duration: 8000,
                });
              } catch {}
            }
          })
          .catch(() => {});
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          // Provision before flipping authState so pages mounting on
          // 'authenticated' find a membership row on first query.
          await provisionIfNeeded();
          // Register the device for server-side push notifications.
          // Non-blocking, idempotent, web no-op. Failures (permission
          // denied, plugin missing) are swallowed inside the helper so
          // auth flow never gets stuck on a push edge case.
          import('@/lib/pushNotifications')
            .then(({ initPushNotifications }) => initPushNotifications(newUser.id))
            .catch(() => {});
          // Welcome email for OAuth signups (Google / Apple). Email+password
          // signups are dispatched from AuthPage with the form's fullName,
          // so this helper short-circuits on provider==='email' to avoid
          // double-dispatch. See dispatchOAuthWelcomeEmail above for gates.
          dispatchOAuthWelcomeEmail(session.user);
        }
        // Synchronous "has-session" flag for RootGate. Supabase v2
        // stores the actual token in Capacitor Preferences on native
        // (UserDefaults / SharedPreferences) — NOT in localStorage —
        // so the localStorage scan in RootGate can never see it on
        // iOS / Android. This flag bridges that gap: it sits in
        // localStorage (works on every platform) and tracks "user has
        // a live Supabase session". RootGate treats its presence as
        // a strong hint that we should navigate to /Dashboard rather
        // than mount AuthPage. Value is just '1' — we only ever check
        // presence; never trust contents.
        try { localStorage.setItem('cr_has_session', '1'); } catch {}
        setAuthState('authenticated');
        try { window.__crAuthResolvedAt = Date.now(); } catch {}
        // Migrate guest data after login/signup (non-blocking).
        guestDataRef.current?.migrateGuestDataIfNeeded(newUser);
      } else {
        setUser(null);
        // Mirror the cr_has_session removal here so a SIGNED_OUT or
        // session-expired event clears the gate-relevant flag immediately.
        // Defensive: even if our handleLogout path already cleared this,
        // this keeps the flag accurate against external sign-outs (e.g.
        // server-revoked token on next API call).
        try { localStorage.removeItem('cr_has_session'); } catch {}
        try { localStorage.removeItem('cr_is_admin'); } catch {}
        setAuthState('guest');
        try { window.__crAuthResolvedAt = Date.now(); } catch {}
        // Detach PIN — every subsequent isPinEnabled() / tryUnlock()
        // returns false / no_pin_set until another user signs in.
        // Important: we do NOT clearPin() here, only detach. Wiping
        // would lose user A's PIN forever if they log back in.
        import('@/lib/pinLock')
          .then(({ setActivePinUser }) => setActivePinUser(null))
          .catch(() => {});
        // Tear down push listeners so a different user signing in next
        // doesn't inherit the previous session's token route.
        import('@/lib/pushNotifications')
          .then(({ teardownPushNotifications }) => teardownPushNotifications())
          .catch(() => {});
      }
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (hardFallbackTimer) clearTimeout(hardFallbackTimer);
      subscription.unsubscribe();
    };
  }, []);

  //  User refresh
  const refreshUser = async () => {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (u) {
      const normalized = normalizeUser(u);
      setUser(normalized);
      return normalized;
    }
  };

  return (
    <AuthCtx.Provider value={{
      authState,
      isLoading: authState === 'loading',
      isAuthenticated: authState === 'authenticated',
      isGuest: authState === 'guest',
      user,
      refreshUser,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

/**
 * Public provider — wraps GuestDataProvider + AuthInner.
 * Drop-in replacement for the old monolithic GuestProvider.
 */
export function GuestProvider({ children }) {
  return (
    <GuestDataProvider>
      <AuthInner>{children}</AuthInner>
    </GuestDataProvider>
  );
}

// Safe default returned when useAuth() is called outside <GuestProvider>.
// Prevents "Cannot destructure property 'user' of 'useAuth(...)' as it is null" crashes.
const SAFE_DEFAULT_AUTH = {
  // Auth
  authState: 'loading',
  isLoading: true,
  isAuthenticated: false,
  isGuest: false,
  user: null,
  refreshUser: async () => null,
  // Vehicles
  guestVehicles: [],
  addGuestVehicle: () => null,
  updateGuestVehicle: () => {},
  removeGuestVehicle: () => {},
  clearGuestData: () => {},
  getStoredGuestVehicles: () => [],
  // Documents
  guestDocuments: [],
  addGuestDocument: () => null,
  removeGuestDocument: () => {},
  updateGuestDocument: () => {},
  getStoredGuestDocuments: () => [],
  // Accidents
  guestAccidents: [],
  addGuestAccident: () => null,
  updateGuestAccident: () => {},
  removeGuestAccident: () => {},
  // Vessel Issues
  guestVesselIssues: [],
  addGuestVesselIssue: () => null,
  updateGuestVesselIssue: () => {},
  removeGuestVesselIssue: () => {},
  // Cork Notes
  guestCorkNotes: [],
  addGuestCorkNote: () => null,
  updateGuestCorkNote: () => {},
  removeGuestCorkNote: () => {},
  // Reminder settings
  guestReminderSettings: DEFAULT_REMINDER_SETTINGS,
  updateGuestReminderSettings: () => {},
  getStoredGuestReminderSettings: () => DEFAULT_REMINDER_SETTINGS,
  // Sign-up prompt
  showSignUpPrompt: false,
  setShowSignUpPrompt: () => {},
  // Demo vehicle management
  isDemoDismissed: false,
  dismissDemo: () => {},
  resetDemo: () => {},
  // Migration (used internally, but included for completeness)
  migrateGuestDataIfNeeded: async () => {},
};

/**
 * Primary hook — backward-compatible with the old monolithic context.
 * Merges auth state from AuthCtx + guest data from GuestDataCtx.
 */
export function useAuth() {
  const auth = useContext(AuthCtx);
  const guestData = useContext(GuestDataCtx);
  if (!auth) return SAFE_DEFAULT_AUTH;
  return { ...(guestData || {}), ...auth };
}

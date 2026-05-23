import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { toast } from 'sonner';
import { isVessel } from './DateStatusUtils';
import { MEMBER_STATUS } from '@/lib/enums';

const GuestContext = createContext(null);
const STORAGE_KEY          = 'fleet_guest_vehicles';
const DEMO_DISMISSED_KEY   = 'fleet_guest_demo_dismissed';
const DOCS_KEY             = 'fleet_guest_documents';
const SETTINGS_KEY         = 'fleet_guest_reminder_settings';
const ACCIDENTS_KEY        = 'fleet_guest_accidents';
const VESSEL_ISSUES_KEY    = 'fleet_guest_vessel_issues';
const CORK_NOTES_KEY       = 'fleet_guest_cork_notes';
const FORCE_GUEST_ONCE_KEY = 'cr_force_guest_once';

const DEFAULT_REMINDER_SETTINGS = {
  remind_test_days_before:       14,
  remind_insurance_days_before:  14,
  remind_document_days_before:   14,
  remind_maintenance_days_before: 7,
  overdue_repeat_every_days:      3,
  daily_job_hour:                 8,
};

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
      // eslint-disable-next-line no-console
      console.warn('[welcome-email] OAuth dispatch failed:', err?.message);
    }
  }
}

export function GuestProvider({ children }) {
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'authenticated' | 'guest'
  const [user, setUser] = useState(null);

  // Deep sanitize all strings in data loaded from localStorage to prevent stored XSS
  const sanitizeValue = (v) => {
    if (typeof v === 'string') {
      return v.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
              .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
              .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
              .replace(/[\uFF1C\uFE64]/g, '<').replace(/[\uFF1E\uFE65]/g, '>')
              .replace(/<[^>]*>/g, '')
              .replace(/on\w+\s*=/gi, '')
              .replace(/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi, '');
    }
    if (Array.isArray(v)) return v.map(sanitizeValue);
    if (v && typeof v === 'object') {
      const clean = {};
      for (const [key, val] of Object.entries(v)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        clean[key] = sanitizeValue(val);
      }
      return clean;
    }
    return v;
  };

  const sanitizeLocalData = (arr) => {
    if (!Array.isArray(arr)) return [];
    return arr.map(sanitizeValue);
  };

  const safeLoadArray = (key) => {
    try {
      const data = JSON.parse(localStorage.getItem(key) || '[]');
      return sanitizeLocalData(data);
    } catch { return []; }
  };

  /**
   * localStorage.setItem wrapped to handle QuotaExceededError (~5MB cap).
   * Without this, guest writes would silently fail once the user accumulates
   * enough vehicles/documents, and the app would act like the save succeeded
   * while the new row lives only in React state until reload.
   */
  const safeSetItem = (key, value) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      if (err?.name === 'QuotaExceededError' || (err?.code && /quota/i.test(err.code))) {
        toast.error('נגמר האחסון המקומי. הירשם כדי לשמור את הרכבים בחשבון ולא לאבד אותם.');
      } else {
        toast.error('שמירה מקומית נכשלה');
      }
      return false;
    }
  };

  const [guestVehicles, setGuestVehicles] = useState(() => safeLoadArray(STORAGE_KEY));
  const [guestDocuments, setGuestDocuments] = useState(() => safeLoadArray(DOCS_KEY));

  const [guestReminderSettings, setGuestReminderSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || DEFAULT_REMINDER_SETTINGS; } catch { return DEFAULT_REMINDER_SETTINGS; }
  });

  const [guestAccidents, setGuestAccidents] = useState(() => safeLoadArray(ACCIDENTS_KEY));
  const [guestVesselIssues, setGuestVesselIssues] = useState(() => safeLoadArray(VESSEL_ISSUES_KEY));
  const [guestCorkNotes, setGuestCorkNotes] = useState(() => safeLoadArray(CORK_NOTES_KEY));

  const [showSignUpPrompt, setShowSignUpPrompt] = useState(false);

  const [isDemoDismissed, setIsDemoDismissed] = useState(() => {
    try { return localStorage.getItem(DEMO_DISMISSED_KEY) === 'true'; } catch { return false; }
  });

  const migrationRunRef = useRef(false);

  // Migrate guest vehicles to authenticated account after signup/login
  const migrateGuestDataIfNeeded = async (authenticatedUser) => {
    if (migrationRunRef.current) return; // prevent double-run
    try {
      const storedVehicles = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      // Only migrate real guest vehicles (not demo_xxx)
      const toMigrate = storedVehicles.filter(v => v.id?.startsWith('guest_'));
      if (toMigrate.length === 0) return;

      migrationRunRef.current = true;

      // Get account_id for the authenticated user.
      // New user might not have account_members yet (trigger race), so we
      // retry — but cap the attempts so a misconfigured DB doesn't loop
      // forever and pin the CPU.
      let members = await db.account_members.filter({ user_id: authenticatedUser.id, status: MEMBER_STATUS.ACTIVE });
      let attempts = 0;
      while (members.length === 0 && attempts < 3) {
        await new Promise(r => setTimeout(r, 2000 + attempts * 1000));
        members = await db.account_members.filter({ user_id: authenticatedUser.id, status: MEMBER_STATUS.ACTIVE });
        attempts++;
      }
      if (members.length === 0) {
        console.warn('Guest migration: no account_members after 3 retries, aborting');
        migrationRunRef.current = false;
        return;
      }
      const accountId = members[0].account_id;

      // DB columns whitelist
      const DB_COLUMNS = ['vehicle_type','manufacturer','model','year',
        'nickname','license_plate','test_due_date','insurance_due_date','insurance_company',
        'current_km','current_engine_hours','vehicle_photo','fuel_type','is_vintage',
        'last_tire_change_date','km_since_tire_change',
        'flag_country','marina','marina_abroad','engine_manufacturer',
        'pyrotechnics_expiry_date','fire_extinguisher_expiry_date','fire_extinguishers',
        'life_raft_expiry_date','last_shipyard_date','hours_since_shipyard',
        'front_tire','rear_tire','engine_model','color','last_test_date','first_registration_date','ownership',
        'model_code','trim_level','vin','pollution_group','vehicle_class','safety_rating',
        'horsepower','engine_cc','drivetrain','total_weight','doors','seats','airbags',
        'transmission','body_type','country_of_origin','co2','green_index','tow_capacity',
        'offroad_equipment','offroad_usage_type','last_offroad_service_date',
        'ownership_hand','ownership_history',
        'is_personal_import','personal_import_type'];

      let migrated = 0;
      for (const guestVehicle of toMigrate) {
        const cleanData = { account_id: accountId };
        DB_COLUMNS.forEach(k => {
          if (guestVehicle[k] !== undefined && guestVehicle[k] !== null && guestVehicle[k] !== '') {
            cleanData[k] = guestVehicle[k];
          }
        });
        // Type conversions
        if (cleanData.year) cleanData.year = Number(cleanData.year);
        if (cleanData.current_km) {
          cleanData.current_km = Number(cleanData.current_km);
          cleanData.km_baseline = cleanData.current_km;
        }
        if (cleanData.current_engine_hours) {
          cleanData.current_engine_hours = Number(cleanData.current_engine_hours);
          cleanData.engine_hours_baseline = cleanData.current_engine_hours;
        }

        try {
          await db.vehicles.create(cleanData);
          migrated++;
        } catch (err) {
          console.warn('Guest vehicle migration failed for one vehicle:', err?.message);
        }
      }

      if (migrated > 0) {
        // Clear guest data after successful migration
        localStorage.removeItem(STORAGE_KEY);
        setGuestVehicles([]);
        toast.success(
          migrated === 1
            ? 'הרכב שהוספת הועבר בהצלחה לחשבון שלך!'
            : `${migrated} כלי רכב הועברו בהצלחה לחשבון שלך!`
        );
      }
    } catch (err) {
      console.error('Guest data migration error:', err);
      // Don't block the user. they can still use the app
    } finally {
      migrationRunRef.current = false;
    }
  };

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
    try {
      if (sessionStorage.getItem(FORCE_GUEST_ONCE_KEY) === '1') {
        sessionStorage.removeItem(FORCE_GUEST_ONCE_KEY);
        setAuthState('guest');
        try { window.__crAuthResolvedAt = Date.now(); } catch {}
        return undefined;
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
        migrateGuestDataIfNeeded(newUser);
      } else {
        setUser(null);
        // Mirror the cr_has_session removal here so a SIGNED_OUT or
        // session-expired event clears the gate-relevant flag immediately.
        // Defensive: even if our handleLogout path already cleared this,
        // this keeps the flag accurate against external sign-outs (e.g.
        // server-revoked token on next API call).
        try { localStorage.removeItem('cr_has_session'); } catch {}
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

  useEffect(() => {
    const handleStorage = (e) => {
      // All storage events pass through sanitizeLocalData to prevent stored XSS
      if (e.key === STORAGE_KEY) {
        try { setGuestVehicles(sanitizeLocalData(JSON.parse(e.newValue || '[]'))); } catch {}
      }
      if (e.key === DOCS_KEY) {
        try { setGuestDocuments(sanitizeLocalData(JSON.parse(e.newValue || '[]'))); } catch {}
      }
      if (e.key === ACCIDENTS_KEY) {
        try { setGuestAccidents(sanitizeLocalData(JSON.parse(e.newValue || '[]'))); } catch {}
      }
      if (e.key === VESSEL_ISSUES_KEY) {
        try { setGuestVesselIssues(sanitizeLocalData(JSON.parse(e.newValue || '[]'))); } catch {}
      }
      if (e.key === CORK_NOTES_KEY) {
        try { setGuestCorkNotes(sanitizeLocalData(JSON.parse(e.newValue || '[]'))); } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  //  Vehicles 

  const addGuestVehicle = (vehicleData) => {
    if (guestVehicles.length >= 20) return null;
    const cleanData = Object.fromEntries(
      Object.entries(vehicleData).filter(([k]) => !k.startsWith('_'))
    );
    const vehicle = { ...cleanData, id: `guest_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestVehicles(prev => {
      // Remove matching demo: vessel demo for vessel, car demo for car
      const addingVessel = isVessel(vehicleData.vehicle_type, vehicleData.nickname);
      const filtered = prev.filter(v => {
        if (!v._isDemo && !v.id?.startsWith('demo_')) return true; // keep real vehicles
        const demoIsVessel = isVessel(v.vehicle_type, v.nickname);
        return addingVessel ? !demoIsVessel : demoIsVessel; // remove only the matching demo
      });
      const updated = [...filtered, vehicle];
      safeSetItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
    return vehicle;
  };

  const updateGuestVehicle = (id, changes) => {
    setGuestVehicles(prev => {
      const updated = prev.map(v => v.id === id ? { ...v, ...changes } : v);
      safeSetItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const removeGuestVehicle = (id) => {
    setGuestVehicles(prev => {
      const updated = prev.filter(v => v.id !== id);
      safeSetItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const clearGuestData = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DOCS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(ACCIDENTS_KEY);
    localStorage.removeItem(VESSEL_ISSUES_KEY);
    localStorage.removeItem(CORK_NOTES_KEY);
    setGuestVehicles([]);
    setGuestDocuments([]);
    setGuestAccidents([]);
    setGuestVesselIssues([]);
    setGuestCorkNotes([]);
    setGuestReminderSettings(DEFAULT_REMINDER_SETTINGS);
  };

  const getStoredGuestVehicles = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  };

  const getStoredGuestDocuments = () => {
    try { return JSON.parse(localStorage.getItem(DOCS_KEY) || '[]'); } catch { return []; }
  };

  const getStoredGuestReminderSettings = () => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || DEFAULT_REMINDER_SETTINGS; } catch { return DEFAULT_REMINDER_SETTINGS; }
  };

  //  Documents 

  const addGuestDocument = (docData) => {
    const cleanData = Object.fromEntries(
      Object.entries(docData).filter(([k]) => !k.startsWith('_'))
    );
    const doc = { ...cleanData, id: `guest_doc_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestDocuments(prev => {
      const updated = [...prev, doc];
      safeSetItem(DOCS_KEY, JSON.stringify(updated));
      return updated;
    });
    return doc;
  };

  const removeGuestDocument = (id) => {
    setGuestDocuments(prev => {
      const updated = prev.filter(d => d.id !== id);
      safeSetItem(DOCS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  //  Accidents 

  const addGuestAccident = (data) => {
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([k]) => !k.startsWith('_'))
    );
    const accident = { ...cleanData, id: `guest_accident_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestAccidents(prev => {
      const updated = [...prev, accident];
      safeSetItem(ACCIDENTS_KEY, JSON.stringify(updated));
      return updated;
    });
    return accident;
  };

  const updateGuestAccident = (id, changes) => {
    setGuestAccidents(prev => {
      const updated = prev.map(a => a.id === id ? { ...a, ...changes } : a);
      safeSetItem(ACCIDENTS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const removeGuestAccident = (id) => {
    setGuestAccidents(prev => {
      const updated = prev.filter(a => a.id !== id);
      safeSetItem(ACCIDENTS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  //  Vessel Issues 

  const addGuestVesselIssue = (data) => {
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([k]) => !k.startsWith('_'))
    );
    const issue = { ...cleanData, id: `guest_issue_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestVesselIssues(prev => {
      const updated = [...prev, issue];
      safeSetItem(VESSEL_ISSUES_KEY, JSON.stringify(updated));
      return updated;
    });
    return issue;
  };

  const updateGuestVesselIssue = (id, changes) => {
    setGuestVesselIssues(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, ...changes } : i);
      safeSetItem(VESSEL_ISSUES_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const removeGuestVesselIssue = (id) => {
    setGuestVesselIssues(prev => {
      const updated = prev.filter(i => i.id !== id);
      safeSetItem(VESSEL_ISSUES_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  //  Cork notes 

  const addGuestCorkNote = (noteData) => {
    const note = { ...noteData, id: `guest_note_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestCorkNotes(prev => {
      const updated = [...prev, note].slice(0, 100);
      safeSetItem(CORK_NOTES_KEY, JSON.stringify(updated));
      return updated;
    });
    return note;
  };

  const updateGuestCorkNote = (id, changes) => {
    setGuestCorkNotes(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, ...changes } : n);
      safeSetItem(CORK_NOTES_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const removeGuestCorkNote = (id) => {
    setGuestCorkNotes(prev => {
      const updated = prev.filter(n => n.id !== id);
      safeSetItem(CORK_NOTES_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  //  Reminder settings 

  const updateGuestReminderSettings = (changes) => {
    setGuestReminderSettings(prev => {
      const updated = { ...prev, ...changes };
      safeSetItem(SETTINGS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  //  User 

  const refreshUser = async () => {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (u) {
      const normalized = normalizeUser(u);
      setUser(normalized);
      return normalized;
    }
  };

  //  Demo 

  const dismissDemo = () => {
    safeSetItem(DEMO_DISMISSED_KEY, 'true');
    setIsDemoDismissed(true);
  };

  const resetDemo = () => {
    localStorage.removeItem(DEMO_DISMISSED_KEY);
    setIsDemoDismissed(false);
  };

  return (
    <GuestContext.Provider value={{
      authState,
      isLoading: authState === 'loading',
      isAuthenticated: authState === 'authenticated',
      isGuest: authState === 'guest',
      user,
      // Vehicles
      guestVehicles,
      addGuestVehicle,
      updateGuestVehicle,
      removeGuestVehicle,
      clearGuestData,
      getStoredGuestVehicles,
      // Documents
      guestDocuments,
      addGuestDocument,
      removeGuestDocument,
      getStoredGuestDocuments,
      // Accidents
      guestAccidents,
      addGuestAccident,
      updateGuestAccident,
      removeGuestAccident,
      // Vessel Issues
      guestVesselIssues,
      addGuestVesselIssue,
      updateGuestVesselIssue,
      removeGuestVesselIssue,
      // Cork Notes
      guestCorkNotes,
      addGuestCorkNote,
      updateGuestCorkNote,
      removeGuestCorkNote,
      // Reminder settings
      guestReminderSettings,
      updateGuestReminderSettings,
      getStoredGuestReminderSettings,
      // Sign-up prompt
      showSignUpPrompt,
      setShowSignUpPrompt,
      // User refresh
      refreshUser,
      // Demo vehicle management
      isDemoDismissed,
      dismissDemo,
      resetDemo,
    }}>
      {children}
    </GuestContext.Provider>
  );
}

// Safe default. returned when useAuth() is called outside <GuestProvider>
// Prevents "Cannot destructure property 'user' of 'useAuth(...)' as it is null" crashes
const SAFE_DEFAULT_AUTH = {
  authState: 'loading',
  isLoading: true,
  isAuthenticated: false,
  isGuest: false,
  user: null,
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
  // User refresh
  refreshUser: async () => null,
  // Demo vehicle management
  isDemoDismissed: false,
  dismissDemo: () => {},
  resetDemo: () => {},
};

export function useAuth() {
  const ctx = useContext(GuestContext);
  return ctx || SAFE_DEFAULT_AUTH;
}

// Normalize Supabase user to a consistent shape used across the app
function normalizeUser(supabaseUser) {
  return {
    ...supabaseUser,
    full_name: supabaseUser.user_metadata?.full_name || supabaseUser.email,
    role: supabaseUser.user_metadata?.role || null,
  };
}

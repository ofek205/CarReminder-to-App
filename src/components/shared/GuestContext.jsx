import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { toast } from 'sonner';
import { isVessel } from './DateStatusUtils';

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
      let members = await db.account_members.filter({ user_id: authenticatedUser.id, status: 'פעיל' });
      let attempts = 0;
      while (members.length === 0 && attempts < 3) {
        await new Promise(r => setTimeout(r, 2000 + attempts * 1000));
        members = await db.account_members.filter({ user_id: authenticatedUser.id, status: 'פעיל' });
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
    const getSessionWithTimeout = async (timeoutMs = 8000) => {
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
        const retry = await getSessionWithTimeout(6000);
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
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          // Provision before flipping authState so pages mounting on
          // 'authenticated' find a membership row on first query.
          await provisionIfNeeded();
        }
        setAuthState('authenticated');
        try { window.__crAuthResolvedAt = Date.now(); } catch {}
        // Migrate guest data after login/signup (non-blocking).
        migrateGuestDataIfNeeded(newUser);
      } else {
        setUser(null);
        setAuthState('guest');
        try { window.__crAuthResolvedAt = Date.now(); } catch {}
      }
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
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

/**
 * GuestDataContext — localStorage-backed CRUD for guest mode data.
 *
 * Manages: vehicles, documents, accidents, vessel issues, cork notes,
 * reminder settings, demo state, and the sign-up prompt flag.
 *
 * Extracted from the monolithic GuestContext to separate guest data
 * management from auth session management. The original useAuth() hook
 * in GuestContext.jsx merges both contexts for backward compatibility.
 *
 * Consumers that only need guest data can import useGuestData() directly;
 * most existing code continues using useAuth() which returns both.
 */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { db } from '@/lib/supabaseEntities';
import { toast } from 'sonner';
import { isVessel } from '@/components/shared/DateStatusUtils';
import { MEMBER_STATUS } from '@/lib/enums';

// ── Storage keys ────────────────────────────────────────────────
const STORAGE_KEY          = 'fleet_guest_vehicles';
const DOCS_KEY             = 'fleet_guest_documents';
const SETTINGS_KEY         = 'fleet_guest_reminder_settings';
const ACCIDENTS_KEY        = 'fleet_guest_accidents';
const VESSEL_ISSUES_KEY    = 'fleet_guest_vessel_issues';
const CORK_NOTES_KEY       = 'fleet_guest_cork_notes';
const DEMO_DISMISSED_KEY   = 'fleet_guest_demo_dismissed';

const DEFAULT_REMINDER_SETTINGS = {
  remind_test_days_before:       14,
  remind_insurance_days_before:  14,
  remind_document_days_before:   14,
  remind_maintenance_days_before: 7,
  overdue_repeat_every_days:      3,
  daily_job_hour:                 8,
};

// ── Sanitization (XSS prevention for localStorage) ─────────────
const sanitizeValue = (v) => {
  if (typeof v === 'string') {
    return v.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
            .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
            .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
            .replace(/[＜﹤]/g, '<').replace(/[＞﹥]/g, '>')
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

// ── Context ─────────────────────────────────────────────────────
const GuestDataCtx = createContext(null);

export function GuestDataProvider({ children }) {
  // ── State ──────────────────────────────────────────────────
  const [guestVehicles, setGuestVehicles]       = useState(() => safeLoadArray(STORAGE_KEY));
  const [guestDocuments, setGuestDocuments]       = useState(() => safeLoadArray(DOCS_KEY));
  const [guestAccidents, setGuestAccidents]       = useState(() => safeLoadArray(ACCIDENTS_KEY));
  const [guestVesselIssues, setGuestVesselIssues] = useState(() => safeLoadArray(VESSEL_ISSUES_KEY));
  const [guestCorkNotes, setGuestCorkNotes]       = useState(() => safeLoadArray(CORK_NOTES_KEY));
  const [guestReminderSettings, setGuestReminderSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || DEFAULT_REMINDER_SETTINGS; }
    catch { return DEFAULT_REMINDER_SETTINGS; }
  });
  const [showSignUpPrompt, setShowSignUpPrompt] = useState(false);
  const [isDemoDismissed, setIsDemoDismissed]   = useState(() => {
    try { return localStorage.getItem(DEMO_DISMISSED_KEY) === 'true'; } catch { return false; }
  });

  // ── Cross-tab sync ─────────────────────────────────────────
  useEffect(() => {
    const handleStorage = (e) => {
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

  // ── Vehicles ───────────────────────────────────────────────
  const addGuestVehicle = useCallback((vehicleData) => {
    if (guestVehicles.length >= 20) return null;
    const cleanData = Object.fromEntries(
      Object.entries(vehicleData).filter(([k]) => !k.startsWith('_'))
    );
    const vehicle = { ...cleanData, id: `guest_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestVehicles(prev => {
      const addingVessel = isVessel(vehicleData.vehicle_type, vehicleData.nickname);
      const filtered = prev.filter(v => {
        if (!v._isDemo && !v.id?.startsWith('demo_')) return true;
        const demoIsVessel = isVessel(v.vehicle_type, v.nickname);
        return addingVessel ? !demoIsVessel : demoIsVessel;
      });
      const updated = [...filtered, vehicle];
      safeSetItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
    return vehicle;
  }, [guestVehicles.length]);

  const updateGuestVehicle = useCallback((id, changes) => {
    setGuestVehicles(prev => {
      const updated = prev.map(v => v.id === id ? { ...v, ...changes } : v);
      safeSetItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeGuestVehicle = useCallback((id) => {
    setGuestVehicles(prev => {
      const updated = prev.filter(v => v.id !== id);
      safeSetItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const getStoredGuestVehicles = useCallback(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  }, []);

  // ── Documents ──────────────────────────────────────────────
  const addGuestDocument = useCallback((docData) => {
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
  }, []);

  const removeGuestDocument = useCallback((id) => {
    setGuestDocuments(prev => {
      const updated = prev.filter(d => d.id !== id);
      safeSetItem(DOCS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // C9: Documents.jsx calls updateGuestDocument(old.id, { _superseded: true })
  // when a guest adds a renewed doc, but the function never existed (optional
  // chaining swallowed it) so old copies stayed "latest". Mirror the others.
  const updateGuestDocument = useCallback((id, patch) => {
    setGuestDocuments(prev => {
      const updated = prev.map(d => (d.id === id ? { ...d, ...patch } : d));
      safeSetItem(DOCS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const getStoredGuestDocuments = useCallback(() => {
    try { return JSON.parse(localStorage.getItem(DOCS_KEY) || '[]'); } catch { return []; }
  }, []);

  // ── Accidents ──────────────────────────────────────────────
  const addGuestAccident = useCallback((data) => {
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
  }, []);

  const updateGuestAccident = useCallback((id, changes) => {
    setGuestAccidents(prev => {
      const updated = prev.map(a => a.id === id ? { ...a, ...changes } : a);
      safeSetItem(ACCIDENTS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeGuestAccident = useCallback((id) => {
    setGuestAccidents(prev => {
      const updated = prev.filter(a => a.id !== id);
      safeSetItem(ACCIDENTS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── Vessel Issues ──────────────────────────────────────────
  const addGuestVesselIssue = useCallback((data) => {
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
  }, []);

  const updateGuestVesselIssue = useCallback((id, changes) => {
    setGuestVesselIssues(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, ...changes } : i);
      safeSetItem(VESSEL_ISSUES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeGuestVesselIssue = useCallback((id) => {
    setGuestVesselIssues(prev => {
      const updated = prev.filter(i => i.id !== id);
      safeSetItem(VESSEL_ISSUES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── Cork Notes ─────────────────────────────────────────────
  const addGuestCorkNote = useCallback((noteData) => {
    const note = { ...noteData, id: `guest_note_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestCorkNotes(prev => {
      const updated = [...prev, note].slice(0, 100);
      safeSetItem(CORK_NOTES_KEY, JSON.stringify(updated));
      return updated;
    });
    return note;
  }, []);

  const updateGuestCorkNote = useCallback((id, changes) => {
    setGuestCorkNotes(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, ...changes } : n);
      safeSetItem(CORK_NOTES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeGuestCorkNote = useCallback((id) => {
    setGuestCorkNotes(prev => {
      const updated = prev.filter(n => n.id !== id);
      safeSetItem(CORK_NOTES_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── Reminder settings ──────────────────────────────────────
  const updateGuestReminderSettings = useCallback((changes) => {
    setGuestReminderSettings(prev => {
      const updated = { ...prev, ...changes };
      safeSetItem(SETTINGS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const getStoredGuestReminderSettings = useCallback(() => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || DEFAULT_REMINDER_SETTINGS; }
    catch { return DEFAULT_REMINDER_SETTINGS; }
  }, []);

  // ── Demo ───────────────────────────────────────────────────
  const dismissDemo = useCallback(() => {
    safeSetItem(DEMO_DISMISSED_KEY, 'true');
    setIsDemoDismissed(true);
  }, []);

  const resetDemo = useCallback(() => {
    localStorage.removeItem(DEMO_DISMISSED_KEY);
    setIsDemoDismissed(false);
  }, []);

  // ── Clear all guest data ───────────────────────────────────
  const clearGuestData = useCallback(() => {
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
  }, []);

  // ── Migration: guest → authenticated ───────────────────────
  // Called by GuestContext (auth layer) after successful sign-in.
  // Exposed via context so the auth provider can invoke it without
  // owning the guest state.
  const migrationRunRef = useRef(false);

  const migrateGuestDataIfNeeded = useCallback(async (authenticatedUser) => {
    if (migrationRunRef.current) return;
    try {
      const storedVehicles = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const toMigrate = storedVehicles.filter(v => v.id?.startsWith('guest_'));
      if (toMigrate.length === 0) return;

      migrationRunRef.current = true;

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
      const idMap = {}; // guest vehicle id → new server id (C4: remap dependent data)
      for (const guestVehicle of toMigrate) {
        const cleanData = { account_id: accountId };
        DB_COLUMNS.forEach(k => {
          if (guestVehicle[k] !== undefined && guestVehicle[k] !== null && guestVehicle[k] !== '') {
            cleanData[k] = guestVehicle[k];
          }
        });
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
          const createdVehicle = await db.vehicles.create(cleanData);
          if (createdVehicle?.id) idMap[guestVehicle.id] = createdVehicle.id;
          migrated++;
        } catch (err) {
          console.warn('Guest vehicle migration failed for one vehicle:', err?.message);
        }
      }

      if (migrated > 0) {
        localStorage.removeItem(STORAGE_KEY);
        setGuestVehicles([]);
        toast.success(
          migrated === 1
            ? 'הרכב שהוספת הועבר בהצלחה לחשבון שלך!'
            : `${migrated} כלי רכב הועברו בהצלחה לחשבון שלך!`
        );
      }

      // C4: migrate the guest's DEPENDENT data too (documents, accidents,
      // vessel issues, cork notes) — previously ONLY vehicles migrated, so the
      // rest was silently lost on signup despite the "save permanently" promise.
      // Each item's vehicle_id is remapped via idMap; per-item try/catch so one
      // bad row never aborts or corrupts the batch; a key is cleared only after
      // >=1 of its rows migrated. Guest files live inline (base64 in file_url /
      // JSONB photos) and the viewers already handle file_url-only rows, so no
      // Storage upload is needed here.
      const migrateDependent = async (storageKey, entity, setter) => {
        let items;
        try { items = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return; }
        if (!Array.isArray(items) || items.length === 0) return;
        let n = 0;
        for (const item of items) {
          const mappedVehicleId = item.vehicle_id ? idMap[item.vehicle_id] : null;
          if (item.vehicle_id && !mappedVehicleId) continue; // orphan: its vehicle wasn't migrated
          const clean = { account_id: accountId };
          for (const [k, v] of Object.entries(item)) {
            if (['id', 'vehicle_id', 'account_id', 'created_date', 'created_at'].includes(k) || k.startsWith('_')) continue;
            if (v !== undefined && v !== null) clean[k] = v;
          }
          if (mappedVehicleId) clean.vehicle_id = mappedVehicleId;
          try { await db[entity].create(clean); n++; }
          catch (e) { console.warn(`Guest ${entity} migration failed for one row:`, e?.message); }
        }
        if (n > 0) { try { localStorage.removeItem(storageKey); } catch {} setter([]); }
      };
      await migrateDependent(DOCS_KEY, 'documents', setGuestDocuments);
      await migrateDependent(ACCIDENTS_KEY, 'accidents', setGuestAccidents);
      await migrateDependent(VESSEL_ISSUES_KEY, 'vessel_issues', setGuestVesselIssues);
      await migrateDependent(CORK_NOTES_KEY, 'cork_notes', setGuestCorkNotes);
    } catch (err) {
      console.error('Guest data migration error:', err);
    } finally {
      migrationRunRef.current = false;
    }
  }, []);

  // ── Context value ──────────────────────────────────────────
  const value = {
    // Vehicles
    guestVehicles,
    addGuestVehicle,
    updateGuestVehicle,
    removeGuestVehicle,
    getStoredGuestVehicles,
    // Documents
    guestDocuments,
    addGuestDocument,
    removeGuestDocument,
    updateGuestDocument,
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
    // Demo
    isDemoDismissed,
    dismissDemo,
    resetDemo,
    // Clear + migrate (used by auth layer)
    clearGuestData,
    migrateGuestDataIfNeeded,
  };

  return <GuestDataCtx.Provider value={value}>{children}</GuestDataCtx.Provider>;
}

/**
 * Hook for components that only need guest data (not auth state).
 * Most existing code should keep using useAuth() from GuestContext.
 */
export function useGuestData() {
  return useContext(GuestDataCtx);
}

// Re-export for use by GuestContext facade
export { GuestDataCtx, DEFAULT_REMINDER_SETTINGS };

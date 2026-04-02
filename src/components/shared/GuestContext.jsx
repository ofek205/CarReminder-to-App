import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const GuestContext = createContext(null);
const STORAGE_KEY          = 'fleet_guest_vehicles';
const DEMO_DISMISSED_KEY   = 'fleet_guest_demo_dismissed';
const DOCS_KEY             = 'fleet_guest_documents';
const SETTINGS_KEY         = 'fleet_guest_reminder_settings';
const ACCIDENTS_KEY        = 'fleet_guest_accidents';
const VESSEL_ISSUES_KEY    = 'fleet_guest_vessel_issues';
const CORK_NOTES_KEY       = 'fleet_guest_cork_notes';

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

  const [guestVehicles, setGuestVehicles] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  });

  const [guestDocuments, setGuestDocuments] = useState(() => {
    try { return JSON.parse(localStorage.getItem(DOCS_KEY) || '[]'); } catch { return []; }
  });

  const [guestReminderSettings, setGuestReminderSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || DEFAULT_REMINDER_SETTINGS; } catch { return DEFAULT_REMINDER_SETTINGS; }
  });

  const [guestAccidents, setGuestAccidents] = useState(() => {
    try { return JSON.parse(localStorage.getItem(ACCIDENTS_KEY) || '[]'); } catch { return []; }
  });

  const [guestVesselIssues, setGuestVesselIssues] = useState(() => {
    try { return JSON.parse(localStorage.getItem(VESSEL_ISSUES_KEY) || '[]'); } catch { return []; }
  });

  const [guestCorkNotes, setGuestCorkNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CORK_NOTES_KEY) || '[]'); } catch { return []; }
  });

  const [showSignUpPrompt, setShowSignUpPrompt] = useState(false);

  const [isDemoDismissed, setIsDemoDismissed] = useState(() => {
    try { return localStorage.getItem(DEMO_DISMISSED_KEY) === 'true'; } catch { return false; }
  });

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(normalizeUser(session.user));
        setAuthState('authenticated');
      } else {
        setAuthState('guest');
      }
    });

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(normalizeUser(session.user));
        setAuthState('authenticated');
      } else {
        setUser(null);
        setAuthState('guest');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === STORAGE_KEY) {
        try { setGuestVehicles(JSON.parse(e.newValue || '[]')); } catch {}
      }
      if (e.key === DOCS_KEY) {
        try { setGuestDocuments(JSON.parse(e.newValue || '[]')); } catch {}
      }
      if (e.key === ACCIDENTS_KEY) {
        try { setGuestAccidents(JSON.parse(e.newValue || '[]')); } catch {}
      }
      if (e.key === VESSEL_ISSUES_KEY) {
        try { setGuestVesselIssues(JSON.parse(e.newValue || '[]')); } catch {}
      }
      if (e.key === CORK_NOTES_KEY) {
        try { setGuestCorkNotes(JSON.parse(e.newValue || '[]')); } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // ── Vehicles ────────────────────────────────────────────────────────────────

  const addGuestVehicle = (vehicleData) => {
    if (guestVehicles.length >= 20) return null;
    const cleanData = Object.fromEntries(
      Object.entries(vehicleData).filter(([k]) => !k.startsWith('_'))
    );
    const vehicle = { ...cleanData, id: `guest_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestVehicles(prev => {
      const updated = [...prev, vehicle];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
    return vehicle;
  };

  const updateGuestVehicle = (id, changes) => {
    setGuestVehicles(prev => {
      const updated = prev.map(v => v.id === id ? { ...v, ...changes } : v);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const removeGuestVehicle = (id) => {
    setGuestVehicles(prev => {
      const updated = prev.filter(v => v.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
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

  // ── Documents ───────────────────────────────────────────────────────────────

  const addGuestDocument = (docData) => {
    const cleanData = Object.fromEntries(
      Object.entries(docData).filter(([k]) => !k.startsWith('_'))
    );
    const doc = { ...cleanData, id: `guest_doc_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestDocuments(prev => {
      const updated = [...prev, doc];
      localStorage.setItem(DOCS_KEY, JSON.stringify(updated));
      return updated;
    });
    return doc;
  };

  const removeGuestDocument = (id) => {
    setGuestDocuments(prev => {
      const updated = prev.filter(d => d.id !== id);
      localStorage.setItem(DOCS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  // ── Accidents ──────────────────────────────────────────────────────────────

  const addGuestAccident = (data) => {
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([k]) => !k.startsWith('_'))
    );
    const accident = { ...cleanData, id: `guest_accident_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestAccidents(prev => {
      const updated = [...prev, accident];
      localStorage.setItem(ACCIDENTS_KEY, JSON.stringify(updated));
      return updated;
    });
    return accident;
  };

  const updateGuestAccident = (id, changes) => {
    setGuestAccidents(prev => {
      const updated = prev.map(a => a.id === id ? { ...a, ...changes } : a);
      localStorage.setItem(ACCIDENTS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const removeGuestAccident = (id) => {
    setGuestAccidents(prev => {
      const updated = prev.filter(a => a.id !== id);
      localStorage.setItem(ACCIDENTS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  // ── Vessel Issues ──────────────────────────────────────────────────────────

  const addGuestVesselIssue = (data) => {
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([k]) => !k.startsWith('_'))
    );
    const issue = { ...cleanData, id: `guest_issue_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestVesselIssues(prev => {
      const updated = [...prev, issue];
      localStorage.setItem(VESSEL_ISSUES_KEY, JSON.stringify(updated));
      return updated;
    });
    return issue;
  };

  const updateGuestVesselIssue = (id, changes) => {
    setGuestVesselIssues(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, ...changes } : i);
      localStorage.setItem(VESSEL_ISSUES_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const removeGuestVesselIssue = (id) => {
    setGuestVesselIssues(prev => {
      const updated = prev.filter(i => i.id !== id);
      localStorage.setItem(VESSEL_ISSUES_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  // ── Cork notes ─────────────────────────────────────────────────────────────

  const addGuestCorkNote = (noteData) => {
    const note = { ...noteData, id: `guest_note_${crypto.randomUUID()}`, created_date: new Date().toISOString() };
    setGuestCorkNotes(prev => {
      const updated = [...prev, note].slice(0, 100);
      localStorage.setItem(CORK_NOTES_KEY, JSON.stringify(updated));
      return updated;
    });
    return note;
  };

  const updateGuestCorkNote = (id, changes) => {
    setGuestCorkNotes(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, ...changes } : n);
      localStorage.setItem(CORK_NOTES_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const removeGuestCorkNote = (id) => {
    setGuestCorkNotes(prev => {
      const updated = prev.filter(n => n.id !== id);
      localStorage.setItem(CORK_NOTES_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  // ── Reminder settings ───────────────────────────────────────────────────────

  const updateGuestReminderSettings = (changes) => {
    setGuestReminderSettings(prev => {
      const updated = { ...prev, ...changes };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  // ── User ────────────────────────────────────────────────────────────────────

  const refreshUser = async () => {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (u) {
      const normalized = normalizeUser(u);
      setUser(normalized);
      return normalized;
    }
  };

  // ── Demo ────────────────────────────────────────────────────────────────────

  const dismissDemo = () => {
    localStorage.setItem(DEMO_DISMISSED_KEY, 'true');
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

export function useAuth() {
  return useContext(GuestContext);
}

// Normalize Supabase user to a consistent shape used across the app
function normalizeUser(supabaseUser) {
  return {
    ...supabaseUser,
    full_name: supabaseUser.user_metadata?.full_name || supabaseUser.email,
    role: supabaseUser.user_metadata?.role || null,
  };
}

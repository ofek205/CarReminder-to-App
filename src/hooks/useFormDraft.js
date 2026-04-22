import { useState, useEffect, useRef, useCallback } from 'react';

const PREFIX = 'draft_';
const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const SILENT_RESTORE_MS = 60 * 1000; // 1 minute. restore without prompt
const DEBOUNCE_MS = 2000;
const INDICATOR_MS = 1400;

function getDraftKey(key, userId) {
  return `${PREFIX}${key}_${userId || 'anon'}`;
}

function readDraft(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || !parsed?.data) return null;
    // Expired
    if (Date.now() - parsed.savedAt > EXPIRY_MS) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch { return null; }
}

function writeDraft(storageKey, data) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {}
}

function clearDraft(storageKey) {
  try { localStorage.removeItem(storageKey); } catch {}
}

function isFormEmpty(data, defaultData) {
  if (!data) return true;
  if (!defaultData) return false;
  return JSON.stringify(data) === JSON.stringify(defaultData);
}

/**
 * Smart form draft hook.
 *
 * @param {object} opts
 * @param {string} opts.key        . unique form identifier (e.g. 'add_vehicle')
 * @param {object} opts.data       . current form state
 * @param {function} opts.setData  . state setter
 * @param {object} opts.defaultData. empty/initial form state (to detect "nothing filled")
 * @param {string} [opts.userId]   . isolate drafts per user
 * @param {boolean} [opts.enabled=true]. disable draft for certain conditions
 */
export default function useFormDraft({ key, data, setData, defaultData, userId, enabled = true }) {
  const storageKey = getDraftKey(key, userId);
  const [showResume, setShowResume] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const pendingDraftRef = useRef(null);
  const debounceRef = useRef(null);
  const savedTimerRef = useRef(null);
  const initializedRef = useRef(false);
  const suppressSaveRef = useRef(false);

  //  On mount: check for existing draft 
  useEffect(() => {
    if (!enabled || initializedRef.current) return;
    initializedRef.current = true;

    const draft = readDraft(storageKey);
    if (!draft) return;
    if (isFormEmpty(draft.data, defaultData)) {
      clearDraft(storageKey);
      return;
    }

    const age = Date.now() - draft.savedAt;
    pendingDraftRef.current = draft.data;

    if (age < SILENT_RESTORE_MS) {
      // Silent restore. no prompt
      suppressSaveRef.current = true;
      setData(draft.data);
      setTimeout(() => { suppressSaveRef.current = false; }, 500);
    } else {
      // Show resume prompt
      setShowResume(true);
    }
  }, [storageKey, enabled]);

  //  Auto-save on data change (debounced) 
  useEffect(() => {
    if (!enabled || !initializedRef.current || suppressSaveRef.current) return;
    if (isFormEmpty(data, defaultData)) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      writeDraft(storageKey, data);
      // Show saved indicator briefly
      setShowSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setShowSaved(false), INDICATOR_MS);
    }, DEBOUNCE_MS);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [data, storageKey, enabled]);

  //  Save on exit (beforeunload + visibilitychange) 
  useEffect(() => {
    if (!enabled) return;
    const saveNow = () => {
      if (!isFormEmpty(data, defaultData)) {
        writeDraft(storageKey, data);
      }
    };
    const handleVisibility = () => { if (document.visibilityState === 'hidden') saveNow(); };
    window.addEventListener('beforeunload', saveNow);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('beforeunload', saveNow);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [data, storageKey, enabled, defaultData]);

  //  Resume / discard actions 
  const resumeDraft = useCallback(() => {
    if (pendingDraftRef.current) {
      suppressSaveRef.current = true;
      setData(pendingDraftRef.current);
      setTimeout(() => { suppressSaveRef.current = false; }, 500);
    }
    setShowResume(false);
    pendingDraftRef.current = null;
  }, [setData]);

  const discardDraft = useCallback(() => {
    clearDraft(storageKey);
    pendingDraftRef.current = null;
    setShowResume(false);
  }, [storageKey]);

  //  Clear draft (call on successful submit) 
  const clear = useCallback(() => {
    clearDraft(storageKey);
    setShowResume(false);
    setShowSaved(false);
  }, [storageKey]);

  return {
    showResume,
    resumeDraft,
    discardDraft,
    showSaved,
    clearDraft: clear,
  };
}

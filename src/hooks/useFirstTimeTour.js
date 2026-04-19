/**
 * useFirstTimeTour — state machine for the first-time-user tooltip tour.
 *
 * Shows a 4-step contextual walkthrough exactly ONCE to authenticated users
 * on their first /Dashboard visit. The tour auto-starts 500ms after the
 * WelcomePopup unmounts so the user briefly sees the real dashboard before
 * the spotlight appears.
 *
 * Skip OR finish = permanent dismissal (localStorage flag).
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'cr_tour_v1_seen';
const AUTO_START_DELAY_MS = 500;

/** Read-only check for callers that want to know if the user has seen the tour. */
export function hasSeenFirstTimeTour() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

/** Reset (e.g. future "show tour again" button). Not wired anywhere yet. */
export function resetFirstTimeTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

/**
 * @param {object} opts
 * @param {boolean} opts.enabled  – gate (isAuthenticated && !isGuest && route match)
 * @returns {{ open, step, next, skip, finish, totalSteps }}
 */
export default function useFirstTimeTour({ enabled, totalSteps = 4 } = {}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Auto-start when enabled flips on AND user has never seen the tour.
  useEffect(() => {
    if (!enabled) return;
    if (hasSeenFirstTimeTour()) return;
    const t = setTimeout(() => {
      setStep(0);
      setOpen(true);
    }, AUTO_START_DELAY_MS);
    return () => clearTimeout(t);
  }, [enabled]);

  const markSeen = () => { try { localStorage.setItem(STORAGE_KEY, '1'); } catch {} };

  const next = useCallback(() => {
    setStep(s => {
      if (s + 1 >= totalSteps) {
        markSeen();
        setOpen(false);
        return 0;
      }
      return s + 1;
    });
  }, [totalSteps]);

  const skip = useCallback(() => {
    markSeen();
    setOpen(false);
    setStep(0);
  }, []);

  const finish = useCallback(() => {
    markSeen();
    setOpen(false);
    setStep(0);
  }, []);

  // Android hardware back button → treat as skip (native only, no-op on web).
  useEffect(() => {
    if (!open) return;
    const onPop = () => skip();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open, skip]);

  return { open, step, next, skip, finish, totalSteps };
}

/**
 * useFirstTimeTour. state machine for the first-time-user tooltip tour.
 *
 * Shows a 4-step contextual walkthrough exactly ONCE to authenticated users
 * on their first /Dashboard visit. The tour auto-starts 500ms after the
 * WelcomePopup unmounts so the user briefly sees the real dashboard before
 * the spotlight appears.
 *
 * Skip OR finish = permanent dismissal (localStorage flag).
 */
import { useCallback, useEffect, useState } from 'react';

const DEFAULT_STORAGE_KEY = 'cr_tour_v1_seen';
const AUTO_START_DELAY_MS = 500;

/** Read-only check for callers that want to know if the user has seen the tour. */
export function hasSeenFirstTimeTour(storageKey = DEFAULT_STORAGE_KEY) {
  try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
}

/** Reset (e.g. future "show tour again" button). Not wired anywhere yet. */
export function resetFirstTimeTour(storageKey = DEFAULT_STORAGE_KEY) {
  try { localStorage.removeItem(storageKey); } catch {}
}

/**
 * @param {object} opts
 * @param {boolean} opts.enabled     - gate (authenticated + right route)
 * @param {number}  opts.totalSteps  - number of steps, controls next()/finish
 * @param {string}  opts.storageKey  - localStorage key for "seen" flag.
 *                                     Different tours use different keys so
 *                                     they don't share one dismissal.
 * @param {boolean} opts.persistSeen - if false, skip/finish do NOT mark the
 *                                     tour as seen in localStorage. The
 *                                     caller is expected to gate the tour
 *                                     with some other condition (e.g. has
 *                                     the user completed the setup step?).
 *                                     Default true (original behaviour).
 * @returns {{ open, step, next, skip, finish, totalSteps }}
 */
export default function useFirstTimeTour({
  enabled,
  totalSteps = 4,
  storageKey = DEFAULT_STORAGE_KEY,
  persistSeen = true,
} = {}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Auto-start when enabled flips on AND user has never seen the tour
  // (when persistence is on). When persistSeen=false we ignore the flag
  // and rely entirely on the caller's `enabled` gate, so the tour reopens
  // on every eligible mount.
  useEffect(() => {
    if (!enabled) return;
    if (persistSeen && hasSeenFirstTimeTour(storageKey)) return;
    const t = setTimeout(() => {
      setStep(0);
      setOpen(true);
    }, AUTO_START_DELAY_MS);
    return () => clearTimeout(t);
  }, [enabled, storageKey, persistSeen]);

  const markSeen = () => {
    if (!persistSeen) return;
    try { localStorage.setItem(storageKey, '1'); } catch {}
  };

  // When the tour completes (not when skipped), return the user to the
  // top of the page so they can start interacting from a clean slate
  // rather than being stranded wherever the last spotlight happened to
  // land (usually deep on the page).
  const scrollToTop = () => {
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  };

  const next = useCallback(() => {
    setStep(s => {
      if (s + 1 >= totalSteps) {
        markSeen();
        setOpen(false);
        scrollToTop();
        return 0;
      }
      return s + 1;
    });
  }, [totalSteps]);

  const prev = useCallback(() => {
    setStep(s => Math.max(0, s - 1));
  }, []);

  const goTo = useCallback((idx) => {
    if (typeof idx !== 'number' || !Number.isFinite(idx)) return;
    setStep(Math.max(0, Math.min(totalSteps - 1, idx)));
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
    scrollToTop();
  }, []);

  // Android hardware back button → treat as skip (native only, no-op on web).
  useEffect(() => {
    if (!open) return;
    const onPop = () => skip();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open, skip]);

  return { open, step, next, prev, goTo, skip, finish, totalSteps };
}

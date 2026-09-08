/**
 * Sign out, but not silently over unsynced work.
 *
 * Implements the §10.1 decision: warn, then discard on confirm. The outbox is
 * wiped at the sign-out boundary (clearPersistedCache in the GuestContext
 * listener also clears it), so without a warning a user who wrote something
 * offline and then signed out would lose it with no indication at all. That is
 * the gap this closes, and it is the prerequisite the outbox coverage was
 * waiting on.
 *
 * It also collapses the TWO identical handleLogout copies in Layout.jsx
 * (UserPopover and NavContent) onto one path. That is not tidiness: a guard
 * added to one copy and not the other is worse than no guard, because the
 * unguarded route would look safe while destroying data.
 *
 * NOT flush-then-logout. The spec recommended that and Ofek chose warn+discard
 * (§10.1), so this implements his decision. Flushing first when online would be
 * a small change in this one function if that is ever revisited.
 */
import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { pendingCount } from '@/lib/dal/outbox';

/** Clear per-session personal data, then end the session. */
async function performLogout() {
  // Privacy: chat history and notification-read markers are per-user.
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('yossi_chat_history') || k === 'read_notif_ids' || k === 'read_notif_timed' || k === 'dismissed_notif_ids')
      .forEach((k) => localStorage.removeItem(k));
  } catch (err) {
    console.warn('[logout] localStorage clear failed:', err?.message || err);
  }
  // The vehicle cache and last-route hint must die with the session, or the
  // next signed-in user gets routed into the previous session's route or shown
  // stale data for the wrong account.
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('cr-vehicles-cache:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch { /* private mode */ }
  try {
    sessionStorage.removeItem('cr_last_route');
  } catch { /* private mode */ }
  await supabase.auth.signOut();
}

export default function useLogoutWithGuard() {
  const { user, isGuest } = useAuth();
  // null = no warning showing. A number = that many unsynced writes.
  // 'unknown' = the queue could not be read.
  const [warnCount, setWarnCount] = useState(null);

  const requestLogout = useCallback(async () => {
    const userId = !isGuest ? user?.id : null;
    if (!userId) { await performLogout(); return; }
    let count = 0;
    try {
      count = await pendingCount(userId);
    } catch {
      // Fail toward WARNING. A false "nothing pending" would wave the user
      // through and destroy work; a warning they did not strictly need costs
      // one tap.
      setWarnCount('unknown');
      return;
    }
    if (count > 0) { setWarnCount(count); return; }
    await performLogout();
  }, [user?.id, isGuest]);

  const confirmDiscardAndLogout = useCallback(async () => {
    setWarnCount(null);
    await performLogout();
  }, []);

  const cancelLogout = useCallback(() => setWarnCount(null), []);

  return { requestLogout, warnCount, confirmDiscardAndLogout, cancelLogout };
}

/** Dialog copy for the warning. Hebrew needs the singular form for one. */
export function logoutWarningCopy(warnCount) {
  if (warnCount === 'unknown') {
    return {
      title: 'ייתכן שיש שינויים שלא סונכרנו',
      description: 'לא הצלחנו לבדוק אם נשארו שינויים שממתינים לסנכרון. אם תתנתק עכשיו והם קיימים, הם יימחקו ולא יהיה אפשר לשחזר אותם.',
    };
  }
  const one = warnCount === 1;
  return {
    title: 'יש שינויים שלא סונכרנו',
    description: one
      ? 'שינוי אחד נשמר במכשיר בלבד ועדיין לא הגיע לשרת. אם תתנתק עכשיו הוא יימחק, ולא יהיה אפשר לשחזר אותו.'
      : `${warnCount} שינויים נשמרו במכשיר בלבד ועדיין לא הגיעו לשרת. אם תתנתק עכשיו הם יימחקו, ולא יהיה אפשר לשחזר אותם.`,
  };
}

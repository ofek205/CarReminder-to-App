/**
 * useEffectiveUserId — the user_id whose USER-SCOPED data the UI should read.
 *
 * Normally this is the signed-in user. During an admin "view-as" session it is
 * the TARGET user (the account owner being viewed), so user-scoped surfaces —
 * the notification bell, notifications page, reminder settings, profile,
 * activity log — show what the *target* sees, not the admin. This is the
 * client half of Approach A (split model): the admin keeps their own JWT, and
 * each user-scoped read swaps in the target's id. Server-side, RLS
 * (`is_viewing_user`) is what actually authorises reading those rows.
 *
 * Returns null when neither is known (guest / not yet loaded) — callers should
 * gate their queries on it (`enabled: !!effectiveUserId`).
 *
 *   const effectiveUserId = useEffectiveUserId();
 */
import useViewAs from '@/hooks/useViewAs';
import { useAuth } from '@/components/shared/GuestContext';

export default function useEffectiveUserId() {
  const viewAs = useViewAs();
  const { user } = useAuth();
  return viewAs?.targetUserId ?? user?.id ?? null;
}

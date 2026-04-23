/**
 * System Popup Registry
 *
 * Hard-coded UUIDs that match the seed rows created by
 * supabase-admin-popups-seed-system.sql. Every code-owned popup imports
 * the ID it corresponds to, then calls `logSystemPopupEvent` at the
 * right moments (shown / dismissed / clicked) so the admin catalog tab
 * shows real analytics next to each of them.
 *
 * Changing a value here without running a matching migration will
 * silently stop logging for that popup. Treat these as constants.
 */

import { supabase } from '@/lib/supabase';

export const SYSTEM_POPUP_IDS = {
  welcome:        'ffffffff-ffff-ffff-ffff-000000000001',
  guestWelcome:   'ffffffff-ffff-ffff-ffff-000000000002',
  urgentBanner:   'ffffffff-ffff-ffff-ffff-000000000003',
  firstTimeTour:  'ffffffff-ffff-ffff-ffff-000000000004',
  mileageReminder:'ffffffff-ffff-ffff-ffff-000000000005',
  reviewPrompt:   'ffffffff-ffff-ffff-ffff-000000000006',
  signUpPrompt:   'ffffffff-ffff-ffff-ffff-000000000007',
};

/**
 * Fire-and-forget impression/dismissal/click event for a system popup.
 * Never throws — admin popup analytics is best-effort and must not affect
 * the user flow even if Supabase is unreachable.
 *
 * @param {string} popupId  — one of SYSTEM_POPUP_IDS values
 * @param {'shown'|'dismissed'|'clicked'} kind
 */
export function logSystemPopupEvent(popupId, kind) {
  if (!popupId || !kind) return;
  try {
    supabase.auth.getUser().then(({ data }) => {
      const userId = data?.user?.id || null;
      supabase.from('admin_popup_events').insert({
        popup_id: popupId, user_id: userId, kind,
      }).then(() => {}, () => {});
    }).catch(() => {});
  } catch {}
}

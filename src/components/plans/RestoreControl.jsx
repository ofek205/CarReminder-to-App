/**
 * "שחזור רכישות": the one visible way to recover a subscription on /Plans.
 *
 * ⚠️ REQUIRED IN PRACTICE BY APPLE (3.1.1: a restore mechanism for anything
 * restorable). Restore already ran automatically when the screen opened, and
 * a reviewer who cannot SEE a restore control rejects the subscriptions
 * regardless. It is also the real path for a second phone or a reinstall.
 *
 * ⚠️ QUIET ON PURPOSE. The screen's contract is one lit action row: the open
 * plan's filled "בחר מסלול". A second outlined button would compete with it,
 * so this is a text button in the primary colour and nothing more.
 *
 * ⚠️ THE MESSAGE LINE IS RESERVED EVEN WHEN EMPTY, so an answer appearing
 * does not push the closing line down under the user's thumb. It stays until
 * the next tap or leaving the screen; a message that vanishes by itself is
 * one a slow reader never gets.
 *
 * ⚠️ NOTHING HERE PROMISES A CHARGE OUTCOME. "Found" hands over to the
 * existing verification banner, which is where payment is talked about.
 *
 * @see docs/plan-apple-iap.md §6
 */

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { C } from '@/lib/designTokens';

export const RESTORE_COPY = Object.freeze({
  button: 'שחזור רכישות',
  working: 'בודקים מול החנות',
  // "for this account", not "in this Apple account": a subscription bought
  // for ANOTHER account of ours on the same Apple ID is filtered out, and
  // "none in your Apple account" would then be false.
  none: 'לא נמצא מנוי לשחזור עבור החשבון הזה.',
  error: 'לא הצלחנו לבדוק מול החנות כרגע. אפשר לנסות שוב בעוד רגע.',
  offline: 'אין חיבור לאינטרנט. השחזור יתאפשר כשהחיבור יחזור.',
});

/**
 * Which line sits under the button. Pure, so every branch is tested.
 *
 * @param {'idle'|'working'|'none'|'error'} status
 * @param {boolean} online
 * @returns {{ text: string, tone: 'muted'|'error' } | null}
 */
export function restoreMessage(status, online) {
  if (!online) return { text: RESTORE_COPY.offline, tone: 'muted' };
  if (status === 'none') return { text: RESTORE_COPY.none, tone: 'muted' };
  if (status === 'error') return { text: RESTORE_COPY.error, tone: 'error' };
  return null;
}

/**
 * @param {object}   props
 * @param {boolean}  props.hidden   true while the sheet is open or the
 *   server is verifying: a second flow must not start beside the first. The
 *   component stays mounted so its answer survives the round trip.
 * @param {boolean}  props.online
 * @param {(opts: {manual: boolean}) => Promise<'restored'|'none'|'error'>} props.onRestore
 */
export default function RestoreControl({ hidden = false, online = true, onRestore }) {
  const [status, setStatus] = useState('idle');
  if (hidden) return null;

  const working = status === 'working';
  const message = restoreMessage(status, online);

  const run = async () => {
    if (working || !online) return;
    setStatus('working');
    let result = 'error';
    try {
      result = await onRestore({ manual: true });
    } catch {
      result = 'error';
    }
    // 'restored' hands over to the verification banner; nothing to say here.
    setStatus(result === 'none' || result === 'error' ? result : 'idle');
  };

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={run}
        disabled={working || !online}
        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 text-[13px] font-medium hover:underline underline-offset-2 disabled:opacity-50 disabled:no-underline"
        style={{ color: C.primary }}
      >
        {working && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        {working ? RESTORE_COPY.working : RESTORE_COPY.button}
      </button>
      <p
        className="min-h-[18px] text-[12px] leading-[18px] text-center"
        style={{ color: message?.tone === 'error' ? C.errorDark : C.gray500 }}
        aria-live="polite"
      >
        {message?.text || ''}
      </p>
    </div>
  );
}

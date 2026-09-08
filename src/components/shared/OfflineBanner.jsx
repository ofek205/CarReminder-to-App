/**
 * OfflineBanner — tells the user why the screen looks frozen in time.
 *
 * With the query cache persisted to IndexedDB, an offline app no longer shows
 * errors or empty screens: it shows the LAST KNOWN data, which is genuinely
 * useful (when is my test due, where is my insurance) but indistinguishable
 * from live data. That ambiguity is the actual UX risk of offline reads, so the
 * banner exists to name it. This app also carries time sensitive information
 * (test and insurance dates), where "looks current but isn't" matters.
 *
 * States: online renders nothing at all, so users who are never offline see the
 * same DOM as before this existed. Offline renders a sticky strip. Recovery is
 * automatic: React Query's onlineManager flips, the banner unmounts, and the
 * stale queries refetch on their own.
 *
 * There is deliberately NO dismiss button: dismissing a state banner would be a
 * lie, because the state is still true. And deliberately no "last updated"
 * timestamp — different queries have different ages, so a single global figure
 * would be confidently wrong, which costs more trust than showing none. The
 * copy carries the meaning instead. Per-screen freshness is a separate concern.
 *
 * Appearance is debounced (see useSettledOnlineStatus) so a brief connectivity
 * blip doesn't flash the strip and shove the page down and back.
 *
 * Visual choice: deliberately NEUTRAL (slate/grey), not red or amber. Being
 * offline is a state, not an error or a warning, and the two existing banners
 * already own yellow (staging) and orange (admin view as). Keeping this one
 * grey means all three can stack legibly without competing for alarm.
 */
import React from 'react';
import { CloudOff, CloudUpload, AlertTriangle } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { useSettledOnlineStatus } from '@/hooks/useOnlineStatus';
import useOutboxStatus from '@/hooks/useOutboxStatus';

/**
 * Hebrew agreement, for the noun AND the verb.
 *
 * "1 שינויים" is wrong, and so is "שינוי אחד לא נשמרו" — the verb has to agree
 * too, which a count-aware noun helper alone does not give you. Each message
 * therefore supplies both forms rather than composing a noun phrase onto a
 * fixed verb.
 */
const changes = (n) => (n === 1 ? 'שינוי אחד' : `${n} שינויים`);
const pick = (n, one, many) => (n === 1 ? one : many);

/**
 * Which of the five states the strip is in.
 *
 * Extracted as a pure function so every state is testable without a DOM. This
 * component only renders on signed-in pages, so its states cannot be reached in
 * a preview without a real session — and "all states covered" is a hard
 * requirement here, not a nicety. A table of inputs to outputs verifies it
 * better than clicking through ever could.
 *
 * Priority order is the design: failures first, because they are the only state
 * that needs a DECISION from the user. Then offline. Then a sync that is
 * visibly not completing.
 */
export function bannerState({ isOnline, pending = 0, failed = 0, lingering = false }) {
  if (failed > 0) {
    return {
      tone: 'danger',
      icon: 'failed',
      tappable: true,
      message: `${changes(failed)} ${pick(failed, 'לא נשמר', 'לא נשמרו')} בשרת.`,
    };
  }
  if (!isOnline) {
    return {
      tone: 'neutral',
      icon: 'offline',
      tappable: false,
      message: pending > 0
        ? `אין חיבור לאינטרנט. ${changes(pending)} ${pick(pending, 'ממתין', 'ממתינים')} לסנכרון.`
        : 'אין חיבור לאינטרנט. מוצגים הנתונים האחרונים שנשמרו.',
    };
  }
  if (lingering && pending > 0) {
    // Online with a queue that is not draining. Names the problem, then
    // reassures: the writes are on disk, not lost.
    return {
      tone: 'neutral',
      icon: 'syncing',
      tappable: false,
      message: `הסנכרון מתעכב. ${changes(pending)} ${pick(pending, 'שמור', 'שמורים')} במכשיר.`,
    };
  }
  // Online, nothing pending, nothing failed: nothing at all, so users who are
  // never offline see the same DOM as before any of this existed.
  return null;
}

const ICONS = { offline: CloudOff, syncing: CloudUpload, failed: AlertTriangle };

export default function OfflineBanner({ onShowFailed }) {
  const isOnline = useSettledOnlineStatus();
  const { pending, failed, lingering } = useOutboxStatus();

  // Phase 6: the strip now reports the outbox as well as connectivity, because
  // "is my data current" and "did my change save" are the same question to a
  // user. Extending this one strip rather than adding a second is deliberate:
  // two competing sticky banners is a worse outcome than any wording, and this
  // is already where people look for that answer.
  const state = bannerState({ isOnline, pending, failed, lingering });
  if (!state) return null;
  const { tone, message } = state;
  const Icon = ICONS[state.icon];

  return (
    <div
      role="status"
      aria-live="polite"
      dir="rtl"
      style={{
        position: 'sticky',
        // Sits below StagingBanner (which owns top:0 with z-index 9999) so on
        // a staging preview both remain readable instead of overlapping.
        top: 0,
        zIndex: 9998,
        // Neutral grey for every state EXCEPT a terminal failure. Being offline
        // or mid-sync is a state, not an error, and yellow/orange are already
        // owned by the staging and view-as banners. A failure genuinely needs a
        // decision, so it is the one case that earns the danger colour.
        background: tone === 'danger' ? C.error : C.gray700,
        color: C.card,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        // Generous vertical padding keeps the text clear of the notch on
        // native, where this banner is the topmost element.
        padding: '7px 12px',
        paddingTop: 'max(7px, env(safe-area-inset-top, 0px))',
        fontSize: 13,
        fontWeight: 600,
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
      }}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
      {failed > 0 && onShowFailed && (
        <button
          type="button"
          onClick={onShowFailed}
          // 44px min touch target per the project's mobile rule, achieved with
          // padding rather than height so the strip itself stays slim.
          style={{
            background: 'transparent',
            border: 'none',
            color: C.card,
            font: 'inherit',
            textDecoration: 'underline',
            cursor: 'pointer',
            padding: '11px 8px',
            margin: '-11px 0',
            minWidth: 44,
          }}
        >
          הצג
        </button>
      )}
    </div>
  );
}

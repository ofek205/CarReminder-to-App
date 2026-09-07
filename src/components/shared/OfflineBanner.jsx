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
import { CloudOff } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { useSettledOnlineStatus } from '@/hooks/useOnlineStatus';

export default function OfflineBanner() {
  const isOnline = useSettledOnlineStatus();
  if (isOnline) return null;

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
        background: C.gray700,
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
      <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>אין חיבור לאינטרנט. מוצגים הנתונים האחרונים שנשמרו.</span>
    </div>
  );
}

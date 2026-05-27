import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import useUpdateAvailable, { snoozeUpdateBanner } from '@/hooks/useUpdateAvailable';
import { C } from '@/lib/designTokens';

/**
 * UpdateAvailableBanner — centered popup telling native users a newer
 * version is available in the store.
 *
 * Sister to AppUpdateGate. AppUpdateGate is the *hard* full-screen
 * block when the installed version is below `*_min_version`. This
 * popup is the *soft* nudge when the installed version is below
 * `*_latest_version` — admin-controlled remotely, dismissible,
 * snoozable.
 *
 * UX:
 *   • Placement     : centered modal with backdrop overlay
 *   • First show    : 2.5s after boot (handled in the hook)
 *   • Snooze        : 3 days after dismissal
 *   • Re-show       : only on wall-clock snooze expiry
 *   • Visual weight : prominent — matches AppUpdateGate palette,
 *                     but dismissible (not a hard block)
 *   • Web           : never renders (useUpdateAvailable returns
 *                     show:false on Capacitor.isNative === false)
 */
export default function UpdateAvailableBanner() {
  const { show, currentVersion, latestVersion, storeUrl, platform } = useUpdateAvailable();

  // Local state for enter/exit animation.
  const [visible, setVisible] = useState(false);
  const [animIn, setAnimIn] = useState(false);

  useEffect(() => {
    if (show) {
      setVisible(true);
      // Trigger enter animation on next frame.
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimIn(true)));
    } else {
      setAnimIn(false);
      const t = setTimeout(() => setVisible(false), 250);
      return () => clearTimeout(t);
    }
  }, [show]);

  if (!visible) return null;

  const storeName = platform === 'ios' ? 'App Store' : 'Google Play';

  const handleSnooze = () => {
    snoozeUpdateBanner();
    setAnimIn(false);
  };

  const handleUpdate = () => {
    snoozeUpdateBanner();
    try {
      window.open(storeUrl, '_blank', 'noopener,noreferrer');
    } catch {
      window.location.href = storeUrl;
    }
    setAnimIn(false);
  };

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="עדכון גרסה זמין"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-6"
      style={{
        background: animIn
          ? 'rgba(15, 40, 28, 0.45)'
          : 'rgba(15, 40, 28, 0)',
        transition: 'background 300ms ease-out',
      }}
      onClick={handleSnooze}
    >
      <div
        className="max-w-sm w-full"
        style={{
          transform: animIn ? 'scale(1) translateY(0)' : 'scale(0.92) translateY(24px)',
          opacity: animIn ? 1 : 0,
          transition: animIn
            ? 'transform 350ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 300ms ease-out'
            : 'transform 200ms ease-in, opacity 200ms ease-in',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="rounded-2xl overflow-hidden p-6"
          style={{
            background: '#FFFFFF',
            boxShadow: '0 24px 48px -12px rgba(15,40,28,0.22), 0 8px 16px rgba(15,40,28,0.10)',
          }}
        >
          {/* Icon */}
          <div className="flex justify-center mb-5">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
                boxShadow: '0 12px 28px -8px rgba(16,185,129,0.4)',
              }}
            >
              <Sparkles size={30} strokeWidth={2.5} color="#FFFFFF" />
            </div>
          </div>

          <h2
            className="text-xl font-black text-center mb-2"
            style={{ color: C.primaryDark, letterSpacing: '-0.02em' }}
          >
            גרסה חדשה זמינה!
          </h2>
          <p className="text-sm text-center leading-relaxed mb-1" style={{ color: C.textAlt }}>
            שדרגו לגרסה האחרונה כדי ליהנות משיפורים וכלים חדשים.
          </p>

          {/* Version comparison */}
          {latestVersion && currentVersion && (
            <div
              className="rounded-xl p-3 my-4 text-center"
              style={{
                background: C.bgSubtle,
                border: `1px solid ${C.bgSage}`,
              }}
            >
              <div className="flex items-center justify-around text-xs">
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: C.gray400 }}>
                    הגרסה שלך
                  </p>
                  <p className="font-black tabular-nums mt-1" style={{ color: C.gray500, fontSize: '1rem' }} dir="ltr">
                    {currentVersion}
                  </p>
                </div>
                <div className="text-lg" style={{ color: C.gray300 }}>→</div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: C.gray400 }}>
                    חדשה
                  </p>
                  <p className="font-black tabular-nums mt-1" style={{ color: C.successDark, fontSize: '1rem' }} dir="ltr">
                    {latestVersion}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Primary CTA */}
          <button
            type="button"
            onClick={handleUpdate}
            className="w-full py-3.5 rounded-2xl font-bold text-center transition-all active:scale-[0.98]"
            style={{
              background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
              color: '#FFFFFF',
              boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
            }}
          >
            עדכן ב-{storeName}
          </button>

          {/* Dismiss */}
          <button
            type="button"
            onClick={handleSnooze}
            className="w-full mt-2 py-3 rounded-2xl text-center text-sm font-bold transition-colors"
            style={{ color: C.gray400 }}
          >
            אחר כך
          </button>
        </div>
      </div>
    </div>
  );
}

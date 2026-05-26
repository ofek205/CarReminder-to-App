import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import useUpdateAvailable, { snoozeUpdateBanner } from '@/hooks/useUpdateAvailable';
import { C } from '@/lib/designTokens';

/**
 * UpdateAvailableBanner — bottom non-blocking strip telling native
 * users a newer version is in the store.
 *
 * Sister to AppUpdateGate. AppUpdateGate is the *hard* full-screen
 * block when the installed version is below `*_min_version`. This
 * banner is the *soft* nudge when the installed version is below
 * `*_latest_version` — admin-controlled remotely, dismissible,
 * snoozable.
 *
 * UX spec (locked by the ux skill review):
 *   • Placement     : bottom strip above BottomNav, thumb-reach zone
 *   • First show    : 2.5s after boot (handled in the hook)
 *   • Snooze        : 3 days after dismissal
 *   • Re-show       : NO on background-foreground cycles; only on
 *                     wall-clock snooze expiry
 *   • Animation     : slide up 300ms ease-out on entry, slide down
 *                     200ms ease-in on dismiss
 *   • Visual weight : medium — soft green, matches AppUpdateGate
 *                     palette so "green = update" stays consistent,
 *                     no pulse / no nag
 *   • Web fallback  : never renders (useUpdateAvailable returns
 *                     show:false on Capacitor.isNative === false)
 *
 * Stacking:
 *   • If AppUpdateGate is active (currentVersion < min), this
 *     component never renders — the gate replaces the entire app
 *     children tree.
 *   • Coexists with bottom-aligned popups (MileageReminderPopup,
 *     AiScanUnavailableDialog) because both are modal overlays that
 *     sit above the banner. The banner only competes for visual
 *     attention with the BottomNav itself.
 */
export default function UpdateAvailableBanner() {
  const { show, currentVersion, latestVersion, storeUrl } = useUpdateAvailable();

  // Local state so we can play the slide-out animation BEFORE the
  // banner unmounts. Without this, tapping "אחר כך" flips `show` from
  // the hook to false instantly and the strip disappears with no
  // transition, which reads as "did something happen?" to the user.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (show) {
      // Mount + small delay to let the initial transform: translateY
      // settle before the transition class kicks in. Otherwise the
      // browser collapses the two states into one frame and skips
      // the animation.
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [show]);

  if (!show) return null;

  const handleSnooze = () => {
    snoozeUpdateBanner();
    setVisible(false);
  };

  const handleUpdate = () => {
    // Snooze AND open the store. If the user actually updates, the
    // next boot won't show the banner (latest == current). If they
    // bail at the store, we still give them 3 days of quiet before
    // re-prompting — they clearly know about the update now.
    snoozeUpdateBanner();
    try {
      window.open(storeUrl, '_blank', 'noopener,noreferrer');
    } catch {
      // Capacitor WKWebView / WebView fallback if window.open is
      // blocked: assign location instead (the browser bridge handles
      // store schemes when registered).
      window.location.href = storeUrl;
    }
    setVisible(false);
  };

  return (
    <div
      dir="rtl"
      role="status"
      aria-live="polite"
      className="fixed left-0 right-0 z-[1000] pointer-events-none"
      style={{
        // Sit above the BottomNav. The BottomNav height changes with
        // safe-area-inset-bottom on iPhones with a home indicator;
        // env(safe-area-inset-bottom) + a constant covers both cases.
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)',
        padding: '0 12px',
      }}
    >
      <div
        className="mx-auto max-w-md pointer-events-auto"
        style={{
          transform: visible ? 'translateY(0)' : 'translateY(140%)',
          opacity: visible ? 1 : 0,
          transition: visible
            ? 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 300ms ease-out'
            : 'transform 200ms ease-in, opacity 200ms ease-in',
        }}
      >
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: '#FFFFFF',
            border: `1px solid ${C.successLight}`,
            boxShadow: '0 16px 32px -8px rgba(15,40,28,0.18), 0 4px 8px rgba(15,40,28,0.08)',
          }}
        >
          {/* Soft green tint stripe on the trailing edge — matches the
              AppUpdateGate "update available" green palette without
              the full gradient (which would compete with content). */}
          <div className="flex items-stretch">
            <div
              style={{
                width: 4,
                background: `linear-gradient(180deg, ${C.successBright} 0%, ${C.successMid} 100%)`,
              }}
            />
            <div className="flex-1 flex items-center gap-3 px-3 py-2.5">
              {/* Icon chip. Sparkles communicates "new" without the
                  alarm energy of an arrow or refresh icon. */}
              <div
                className="flex items-center justify-center shrink-0"
                style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: C.successSubtle,
                  color: C.successDark,
                }}
              >
                <Sparkles size={18} strokeWidth={2.5} />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-right leading-tight" style={{ color: C.primaryDark }}>
                  גרסה חדשה זמינה
                </p>
                <p className="text-[11px] text-right leading-tight mt-0.5" style={{ color: C.textAlt }}>
                  שדרגו לגרסה האחרונה כדי ליהנות משיפורים וכלים חדשים.
                  {latestVersion && currentVersion && (
                    <>
                      {' '}
                      <span dir="ltr" className="tabular-nums" style={{ color: '#7A6E58' }}>
                        ({currentVersion} → {latestVersion})
                      </span>
                    </>
                  )}
                </p>
              </div>

              {/* CTAs stacked tight on the leading edge. Primary first
                  (RTL: rightmost = primary; visual order matches the
                  thumb's natural reach on a Hebrew phone). */}
              <div className="flex flex-col gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleUpdate}
                  className="text-white font-bold text-[12px] active:scale-[0.97] transition-transform"
                  style={{
                    height: 30,
                    padding: '0 12px',
                    borderRadius: 10,
                    background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
                    boxShadow: '0 4px 10px rgba(16,185,129,0.28)',
                  }}
                >
                  עדכן עכשיו
                </button>
                <button
                  type="button"
                  onClick={handleSnooze}
                  className="font-bold text-[11px]"
                  style={{ color: C.gray400, height: 26 }}
                >
                  אחר כך
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

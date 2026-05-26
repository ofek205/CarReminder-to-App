import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Sparkles, Wrench } from 'lucide-react';
import {
  onAiScanDisabled,
  hasShownAiScanGateThisSession,
  markAiScanGateShown,
} from '@/lib/aiScanGate';
import { C } from '@/lib/designTokens';

/**
 * AiScanUnavailableDialog
 *
 * Singleton modal shown when the user triggers an AI document-scan
 * flow while the `scan_extraction_enabled` flag in `app_config` is
 * false. Mounted once at Layout level — the gate fires via the
 * subscription API in `src/lib/aiScanGate.js`.
 *
 * UX rules (from the ux skill review for v4.5.0):
 *  • Show at most ONCE per browser session. After the user dismisses
 *    it the first time, subsequent gated scans are silent — they
 *    already know the feature is off and the form's manual fields
 *    remain usable.
 *  • Two CTAs of unequal weight: primary green button "המשך למילוי
 *    ידני" closes the modal and lets the user fill the form manually
 *    (which works exactly the same in every scan surface). Secondary
 *    text link "סגור" lets them bail without ceremony.
 *  • Amber accent (same as MileageReminderPopup) — signals "action
 *    needed, not error". This is a temporary state, not a failure.
 *  • No retry button. The flag is admin-controlled; a per-user retry
 *    cannot un-gate the feature, and offering one would mislead.
 */
export default function AiScanUnavailableDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Subscribe to gate fires. The unsubscribe in the return value
    // covers HMR + StrictMode double-mount in dev.
    return onAiScanDisabled(() => {
      if (hasShownAiScanGateThisSession()) return;
      markAiScanGateShown();
      setOpen(true);
    });
  }, []);

  const handleClose = () => setOpen(false);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent
        dir="rtl"
        className="max-w-sm w-[calc(100vw-32px)] p-0 overflow-hidden rounded-3xl border-0"
        style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
        <VisuallyHidden.Root>
          <DialogTitle>סריקת AI אינה זמינה כרגע</DialogTitle>
        </VisuallyHidden.Root>

        {/* Hero — amber gradient (same family as MileageReminderPopup).
            Communicates "temporary state, action needed" rather than
            "error / something broke". */}
        <div className="relative overflow-hidden"
          style={{
            background: `linear-gradient(165deg, ${C.warnDark} 0%, ${C.warn} 50%, ${C.warnIcon} 100%)`,
            padding: '28px 24px 24px',
          }}>
          <div className="absolute pointer-events-none rounded-full"
            style={{ top: -40, right: -40, width: 140, height: 140, background: 'rgba(255,255,255,0.08)' }} />
          <div className="absolute pointer-events-none rounded-full"
            style={{ bottom: -30, left: -30, width: 100, height: 100, background: 'rgba(255,255,255,0.05)' }} />

          <div className="flex justify-center relative z-10">
            <div className="flex items-center justify-center"
              style={{
                width: 56, height: 56, borderRadius: 18,
                background: 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                border: '1.5px solid rgba(255,255,255,0.2)',
              }}>
              <Sparkles className="w-7 h-7 text-white" strokeWidth={2} />
            </div>
          </div>

          <p className="text-center mt-3 text-[11px] font-bold relative z-10"
            style={{ letterSpacing: '0.25em', color: 'rgba(255,255,255,0.85)' }}>
            הודעה
          </p>
          <h2 className="text-center mt-1.5 text-xl font-bold text-white leading-tight relative z-10">
            סריקת AI אינה זמינה כרגע
          </h2>
        </div>

        {/* Body. Explains both that AI is paused AND that manual entry
            keeps working — the two pieces of information the user
            needs to keep moving. */}
        <div className="px-6 pt-5 pb-5">
          <p className="text-sm text-gray-700 text-center leading-relaxed">
            שירות חילוץ הפרטים האוטומטי מושבת זמנית לתחזוקה.
          </p>
          <p className="text-sm text-gray-700 text-center leading-relaxed mt-2">
            אפשר להמשיך ולמלא את הפרטים ידנית — כל שאר הפעולות בטופס פעילות כרגיל.
          </p>

          {/* Reassurance chip — mirrors the MileageReminderPopup tone. */}
          <div className="flex items-center gap-2 justify-center mt-4 rounded-xl px-3 py-2"
            style={{ background: C.warnSubtle, border: `1px solid ${C.warnBorder}` }}>
            <Wrench className="h-3.5 w-3.5" style={{ color: C.warn }} />
            <span className="text-[11px] font-bold" style={{ color: C.warnDark }}>
              השירות יחזור בקרוב
            </span>
          </div>

          <button onClick={handleClose}
            className="w-full text-white font-bold transition-all active:translate-y-px mt-5"
            style={{
              height: 52, borderRadius: 16,
              background: `linear-gradient(135deg, ${C.primary} 0%, #4A8C5C 100%)`,
              boxShadow: '0 12px 24px -6px rgba(45,82,51,0.4), 0 4px 8px rgba(45,82,51,0.15)',
              fontSize: 16,
            }}>
            המשך למילוי ידני
          </button>
          {/* Secondary — text link, deliberately quiet. The primary
              button does the useful thing; this lets the user bail
              without committing to "manual" if they want to come back
              to the scan later. */}
          <button onClick={handleClose}
            className="w-full font-bold transition-all hover:bg-gray-50 mt-2"
            style={{ height: 44, borderRadius: 12, color: C.gray400, fontSize: 13 }}>
            סגור
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

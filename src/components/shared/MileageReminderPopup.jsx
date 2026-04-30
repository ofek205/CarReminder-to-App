import React, { useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Gauge, Clock } from "lucide-react";
import { SYSTEM_POPUP_IDS, logSystemPopupEvent } from "@/lib/popups/systemPopups";

/**
 * MileageReminderPopup
 * Shown to authenticated users once per ~30 days. Uses the amber "reminder"
 * variant of the shared popup hero (vs the green "welcome" variant) to
 * signal this is an action prompt, not a celebration.
 *
 * Persistence: localStorage key `mileage_reminder_next_at` = timestamp (ms)
 * Both buttons snooze for 30 days from dismissal.
 */

const NEXT_AT_KEY = 'mileage_reminder_next_at';

export function shouldShowMileageReminder() {
  try {
    const next = localStorage.getItem(NEXT_AT_KEY);
    if (!next) return true;
    return Date.now() >= Number(next);
  } catch {
    return false;
  }
}

export function dismissMileageReminder() {
  try {
    localStorage.setItem(NEXT_AT_KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000));
  } catch {}
}

export default function MileageReminderPopup({ open, onClose }) {
  useEffect(() => {
    if (open) logSystemPopupEvent(SYSTEM_POPUP_IDS.mileageReminder, 'shown');
  }, [open]);
  const handleClose = (intent = 'dismissed') => {
    logSystemPopupEvent(SYSTEM_POPUP_IDS.mileageReminder, intent);
    dismissMileageReminder();
    onClose?.();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent
        dir="rtl"
        className="max-w-sm w-[calc(100vw-32px)] max-h-[90vh] p-0 overflow-y-auto overflow-x-hidden rounded-3xl border-0"
        style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
        <VisuallyHidden.Root>
          <DialogTitle>עדכון קילומטראז׳</DialogTitle>
        </VisuallyHidden.Root>

        {/*  Hero (amber variant. signals action needed)  */}
        <div className="relative overflow-hidden"
          style={{
            background: 'linear-gradient(165deg, #92400E 0%, #D97706 50%, #F59E0B 100%)',
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
              <Gauge className="w-7 h-7 text-white" strokeWidth={2} />
            </div>
          </div>

          <p className="text-center mt-3 text-[11px] font-bold relative z-10"
            style={{ letterSpacing: '0.25em', color: 'rgba(255,255,255,0.85)' }}>
            תזכורת
          </p>
          <h2 className="text-center mt-1.5 text-xl font-bold text-white leading-tight relative z-10">
            עדכן קילומטראז׳ או שעות מנוע
          </h2>
        </div>

        {/*  Content  */}
        <div className="px-6 pt-5 pb-5">
          <p className="text-sm text-gray-700 text-center leading-relaxed">
            הנתון העדכני עוזר לנו לתזמן לך תזכורות טיפול מדויקות יותר.
          </p>

          <div className="flex items-center gap-2 justify-center mt-3 rounded-xl px-3 py-2"
            style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
            <Clock className="h-3.5 w-3.5" style={{ color: '#D97706' }} />
            <span className="text-[11px] font-bold" style={{ color: '#92400E' }}>
              מספיק פעם בחודש
            </span>
          </div>

          <p className="text-[11px] text-gray-400 text-center mt-3">
            אפשר לעדכן בכל עת בדף הרכב
          </p>

          <button onClick={() => handleClose('clicked')}
            className="w-full text-white font-bold transition-all active:translate-y-px mt-5"
            style={{
              height: 52, borderRadius: 16,
              background: 'linear-gradient(135deg, #2D5233 0%, #4A8C5C 100%)',
              boxShadow: '0 12px 24px -6px rgba(45,82,51,0.4), 0 4px 8px rgba(45,82,51,0.15)',
              fontSize: 16,
            }}>
            אעדכן עכשיו
          </button>
          <button onClick={() => handleClose('dismissed')}
            className="w-full font-bold transition-all hover:bg-gray-50 mt-2"
            style={{ height: 44, borderRadius: 12, color: '#9CA3AF', fontSize: 13 }}>
            תזכיר לי בחודש הבא
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

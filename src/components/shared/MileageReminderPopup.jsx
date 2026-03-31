import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Gauge } from "lucide-react";

/**
 * MileageReminderPopup
 * Shown to authenticated users once per ~30 days, but only after their first vehicle
 * has been in the system for at least 30 days.
 *
 * Persistence: localStorage key `mileage_reminder_next_at` = timestamp (ms)
 * Both buttons snooze for 30 days from the moment of dismissal.
 */

const NEXT_AT_KEY = 'mileage_reminder_next_at';

export function shouldShowMileageReminder() {
  try {
    const next = localStorage.getItem(NEXT_AT_KEY);
    if (!next) return true; // never dismissed before
    return Date.now() >= Number(next);
  } catch {
    return false;
  }
}

export function dismissMileageReminder() {
  try {
    // Snooze for exactly 30 days from now
    localStorage.setItem(NEXT_AT_KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000));
  } catch { /* ignore */ }
}

export default function MileageReminderPopup({ open, onClose }) {
  const handleClose = () => {
    dismissMileageReminder();
    onClose?.();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
              <Gauge className="h-6 w-6 text-amber-600" />
            </div>
          </div>
          <DialogTitle className="text-center text-lg">עדכון ק״מ / שעות מנוע</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-gray-600 text-center leading-relaxed">
          עדכון הק״מ או שעות המנוע הנוכחיות מאפשר למערכת לעקוב אחר השימוש ברכב ולשלוח לך תזכורות טיפול מדויקות יותר.
        </p>

        <p className="text-xs text-gray-400 text-center mt-1">
          ניתן לעדכן ישירות מדף הרכב
        </p>

        <div className="flex flex-col gap-2 mt-2">
          <Button
            onClick={handleClose}
            className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white"
          >
            הבנתי, אעדכן עכשיו
          </Button>
          <Button
            variant="ghost"
            onClick={handleClose}
            className="w-full text-gray-500 text-sm"
          >
            תזכיר לי בחודש הבא
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

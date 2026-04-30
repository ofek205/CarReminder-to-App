import React from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";

/**
 * ConfirmDeleteDialog. destructive confirmation with the same premium
 * hero treatment as the other popups, but in the red "danger" palette
 * to make the consequence visually unmissable.
 */
export default function ConfirmDeleteDialog({
  open,
  onConfirm,
  onCancel,
  title = "למחוק את הפריט?",
  description = "המחיקה סופית ולא ניתנת לביטול.",
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <AlertDialogContent
        dir="rtl"
        className="max-w-sm w-[calc(100vw-32px)] max-h-[90vh] p-0 overflow-y-auto overflow-x-hidden rounded-3xl border-0"
        style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>

        {/*  Hero (red "danger" variant)  */}
        <div className="relative overflow-hidden"
          style={{
            background: 'linear-gradient(165deg, #7F1D1D 0%, #B91C1C 50%, #DC2626 100%)',
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
              <AlertTriangle className="w-7 h-7 text-white" strokeWidth={2} />
            </div>
          </div>

          <AlertDialogHeader className="space-y-1.5 relative z-10 mt-3">
            <p className="text-center text-[11px] font-bold"
              style={{ letterSpacing: '0.25em', color: 'rgba(255,255,255,0.85)' }}>
              פעולה סופית
            </p>
            <AlertDialogTitle className="text-center text-xl font-bold text-white leading-tight">
              {title}
            </AlertDialogTitle>
          </AlertDialogHeader>
        </div>

        {/*  Content  */}
        <div className="px-6 pt-5 pb-5">
          <AlertDialogDescription className="text-sm text-gray-700 text-center leading-relaxed">
            {description}
          </AlertDialogDescription>

          <AlertDialogFooter className="flex-col-reverse sm:flex-col-reverse gap-2 mt-5">
            <AlertDialogCancel
              onClick={onCancel}
              className="w-full m-0 font-bold"
              style={{ height: 44, borderRadius: 12, fontSize: 14 }}>
              ביטול
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              className="w-full m-0 text-white font-bold transition-all active:translate-y-px"
              style={{
                height: 52, borderRadius: 16,
                background: 'linear-gradient(135deg, #B91C1C 0%, #DC2626 100%)',
                boxShadow: '0 12px 24px -6px rgba(220,38,38,0.4), 0 4px 8px rgba(220,38,38,0.15)',
                fontSize: 16,
              }}>
              מחק
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

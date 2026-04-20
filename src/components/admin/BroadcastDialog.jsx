import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Megaphone, Info, CheckCircle2, AlertCircle, Users } from 'lucide-react';
import { useRunBroadcast } from '@/hooks/useEmailAdmin';
import { toast } from 'sonner';

/**
 * BroadcastDialog — "send to all opted-in users" for a marketing /
 * announcement notification. Two-step flow:
 *
 *   1. Dry run (default) — counts eligible recipients without sending.
 *   2. Confirm + send.
 *
 * Safeguards:
 *   - Dry run is shown first; admin must explicitly choose to send.
 *   - Real send needs a second confirmation (the X users number is
 *     displayed in the confirm text so accidental clicks on 0-recipient
 *     sends are still obvious).
 *   - Kill switch and per-user preferences are enforced server-side.
 */
export default function BroadcastDialog({ notification, open, onClose }) {
  const run = useRunBroadcast();
  const [step, setStep] = useState('intro');     // intro | previewing | confirm | sending | done
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  // Reset when dialog opens.
  useEffect(() => {
    if (open) {
      setStep('intro');
      setPreview(null);
      setResult(null);
    }
  }, [open, notification?.key]);

  if (!notification) return null;

  const runDryRun = async () => {
    setStep('previewing');
    try {
      const res = await run.mutateAsync({ notificationKey: notification.key, dryRun: true });
      setPreview(res);
      if (res.paused)       { toast.error('Kill switch פעיל'); setStep('intro'); return; }
      if (res.disabled)     { toast.error('ההתראה מושבתת — הפעל/י אותה קודם'); setStep('intro'); return; }
      setStep('confirm');
    } catch (e) {
      toast.error(`בדיקה נכשלה: ${e.message}`);
      setStep('intro');
    }
  };

  const send = async () => {
    setStep('sending');
    try {
      const res = await run.mutateAsync({ notificationKey: notification.key, dryRun: false });
      setResult(res);
      setStep('done');
      if (res.totals) {
        toast.success(`נשלח ל-${res.totals.sent} נמענים. ${res.totals.skipped} דולגו, ${res.totals.errors} שגיאות.`);
      }
    } catch (e) {
      toast.error(`שליחה נכשלה: ${e.message}`);
      setResult({ ok: false, error: e.message });
      setStep('done');
    }
  };

  const eligible = preview?.totals?.matched ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="w-4 h-4" />
            שליחה לכל המשתמשים — {notification.display_name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">

          {step === 'intro' && (
            <>
              <p className="text-sm text-gray-700">
                הפעולה תשלח את המייל <strong>{notification.display_name}</strong> לכל המשתמשים הרשומים שלא ביקשו להחריג את סוג ההתראה הזה.
              </p>
              <div className="rounded-xl p-3 text-xs flex gap-2" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
                <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#1E3A8A' }} />
                <div style={{ color: '#1E3A8A' }}>
                  <strong>מומלץ לבדוק קודם</strong> ב-Dry run כמה נמענים יקבלו ומה התוכן שייצא, לפני שליחה בפועל. Send Test ליצירת תצוגת "מייל אחד אלי" נשאר זמין ב-UI הראשי.
                </div>
              </div>
            </>
          )}

          {step === 'previewing' && (
            <div className="py-6 flex items-center justify-center gap-2 text-sm text-gray-600">
              <Loader2 className="w-5 h-5 animate-spin" />
              בודק כמה נמענים...
            </div>
          )}

          {step === 'confirm' && preview && (
            <>
              <div className="rounded-2xl p-4" style={{ background: '#F4F7F3', border: '1.5px solid #D8E5D9' }}>
                <div className="flex items-center gap-2 mb-1" style={{ color: '#1C3620' }}>
                  <Users className="w-5 h-5" />
                  <span className="text-lg font-black">{eligible}</span>
                  <span className="text-sm">נמענים זכאים</span>
                </div>
                <p className="text-[11px]" style={{ color: '#3A6B42' }}>
                  המייל יישלח לכולם. נמענים שכבר קיבלו את ההודעה הזו היום ידולגו אוטומטית.
                </p>
              </div>
              {eligible === 0 && (
                <div className="rounded-xl p-3 text-xs flex gap-2"
                  style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E' }}>
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  אין נמענים זכאים כרגע. ודא/י שיש משתמשים עם email מאומת שלא ביטלו את ההתראה הזו בהעדפות שלהם.
                </div>
              )}
            </>
          )}

          {step === 'sending' && (
            <div className="py-8 flex flex-col items-center gap-2 text-sm text-gray-600">
              <Loader2 className="w-6 h-6 animate-spin" />
              שולח — נא להמתין...
              <span className="text-[11px] text-gray-400">שליחה ב-rate של ~8 מיילים לשנייה, כדי לא להעמיס על Resend</span>
            </div>
          )}

          {step === 'done' && result && (
            <div className="rounded-2xl p-4 space-y-2"
              style={{
                background: result.ok !== false ? '#ECFDF5' : '#FEF2F2',
                border: `1.5px solid ${result.ok !== false ? '#A7F3D0' : '#FCA5A5'}`,
              }}>
              <div className="flex items-center gap-2 font-bold text-sm" style={{ color: result.ok !== false ? '#064E3B' : '#991B1B' }}>
                {result.ok !== false ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {result.ok !== false ? 'ההפצה הושלמה' : 'ההפצה נכשלה'}
              </div>
              {result.totals && (
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <Stat label="נמענים" value={result.totals.matched} />
                  <Stat label="נשלחו"  value={result.totals.sent} />
                  <Stat label="דולגו"  value={result.totals.skipped} />
                  <Stat label="שגיאות" value={result.totals.errors} warn={result.totals.errors > 0} />
                </div>
              )}
              {result.error && <p className="text-xs text-red-800">{result.error}</p>}
            </div>
          )}

        </div>

        <DialogFooter className="gap-2">
          {step === 'intro' && (
            <>
              <Button variant="outline" onClick={onClose} className="rounded-xl">ביטול</Button>
              <Button onClick={runDryRun} className="rounded-xl gap-2" style={{ background: '#2D5233', color: 'white' }}>
                <Info className="w-4 h-4" />
                בדיקת נמענים (Dry run)
              </Button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <Button variant="outline" onClick={onClose} className="rounded-xl">ביטול</Button>
              <Button
                onClick={send}
                disabled={eligible === 0}
                className="rounded-xl gap-2"
                style={{ background: eligible > 0 ? '#DC2626' : '#9CA3AF', color: 'white' }}>
                <Megaphone className="w-4 h-4" />
                שלח ל-{eligible} נמענים
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button onClick={onClose} className="rounded-xl" style={{ background: '#2D5233', color: 'white' }}>סגירה</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, warn }) {
  return (
    <div className="rounded-lg p-2" style={{ background: warn ? '#FECACA' : 'rgba(255,255,255,0.6)' }}>
      <div className="text-lg font-bold leading-none">{Number(value || 0)}</div>
      <div className="text-[10px] text-gray-600">{label}</div>
    </div>
  );
}

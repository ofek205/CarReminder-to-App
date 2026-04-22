import React, { useState } from 'react';
import { AlertTriangle, Pause, Play, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useEmailSettings, useToggleKillSwitch } from '@/hooks/useEmailAdmin';
import { toast } from 'sonner';

/**
 * KillSwitchBanner — global pause control for all outgoing emails.
 *
 * Shows a red "paused" banner when emails_paused=true, with the reason
 * and a resume button. When emails are flowing, shows a muted green
 * "active" card with a "pause all" button behind a confirmation dialog
 * (destructive action, must not be click-away-able).
 */
export default function KillSwitchBanner() {
  const { data: settings, isLoading } = useEmailSettings();
  const toggle = useToggleKillSwitch();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (isLoading) return null;

  const paused = !!settings?.emails_paused;

  const handlePause = async () => {
    try {
      await toggle.mutateAsync({ paused: true, reason: reason.trim() || 'הושבת ידנית' });
      toast.success('שליחת המיילים הושעתה');
      setConfirmOpen(false);
      setReason('');
    } catch (e) {
      toast.error(`נכשל: ${e.message}`);
    }
  };

  const handleResume = async () => {
    try {
      await toggle.mutateAsync({ paused: false, reason: null });
      toast.success('שליחת המיילים חזרה לפעול');
    } catch (e) {
      toast.error(`נכשל: ${e.message}`);
    }
  };

  if (paused) {
    return (
      <div dir="rtl"
        className="rounded-2xl p-4 mb-6 flex items-start gap-3"
        style={{ background: '#FEF2F2', border: '2px solid #FCA5A5' }}>
        <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: '#FEE2E2' }}>
          <AlertTriangle className="w-5 h-5" style={{ color: '#DC2626' }} />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-base mb-1" style={{ color: '#991B1B' }}>
            שליחת המיילים מושעת
          </h3>
          {settings?.pause_reason && (
            <p className="text-sm mb-2" style={{ color: '#991B1B' }}>
              סיבה: {settings.pause_reason}
            </p>
          )}
          <p className="text-xs mb-3" style={{ color: '#7F1D1D' }}>
            אף מייל לא יוצא כרגע. ניתן לחדש שליחה בלחיצה אחת.
          </p>
          <Button
            onClick={handleResume}
            disabled={toggle.isPending}
            className="gap-2 h-9 rounded-xl font-bold"
            style={{ background: '#DC2626', color: 'white' }}>
            {toggle.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            חידוש שליחה
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div dir="rtl"
        className="rounded-2xl p-4 mb-6 flex items-center gap-3"
        style={{ background: '#ECFDF5', border: '1.5px solid #A7F3D0' }}>
        <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: '#D1FAE5' }}>
          <Play className="w-5 h-5" style={{ color: '#047857' }} />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-sm" style={{ color: '#064E3B' }}>
            שליחת מיילים פעילה
          </h3>
          <p className="text-xs" style={{ color: '#065F46' }}>
            כל המיילים יוצאים כרגיל דרך Resend.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setConfirmOpen(true)}
          className="gap-2 h-9 rounded-xl text-sm">
          <Pause className="w-4 h-4" />
          השעיית שליחה
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>השעיית שליחת כל המיילים</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-600">
              פעולה זו עוצרת מיידית שליחה של <strong>כל</strong> המיילים מהאפליקציה:
              הזמנות, תזכורות, אימות וכל היתר. מומלץ רק בעת בעיה דחופה.
            </p>
            <div>
              <label className="text-xs font-semibold mb-1 block text-gray-700">
                סיבה (תוצג ב-UI האדמין)
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="לדוגמה: דיבאג של באג Resend, ספאם, שינויי dns..."
                rows={3}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} className="rounded-xl">
              ביטול
            </Button>
            <Button
              onClick={handlePause}
              disabled={toggle.isPending}
              className="rounded-xl gap-2"
              style={{ background: '#DC2626', color: 'white' }}>
              {toggle.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              השעה עכשיו
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

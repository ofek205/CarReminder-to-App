import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import PinLock from './PinLock';
import ConfirmDeleteDialog from './ConfirmDeleteDialog';
import { isPinEnabled, clearPin } from '@/lib/pinLock';
import { C } from '@/lib/designTokens';

/**
 * PinLockCard. PIN-lock toggle + change-code button.
 *
 * Lives in the Settings hub's Profile tab (security belongs with the
 * user's identity, not with notification timing). Used to live inside
 * ReminderSettingsPage.
 */
export default function PinLockCard() {
  const [enabled, setEnabled] = useState(() => isPinEnabled());
  const [setupOpen, setSetupOpen] = useState(false);
  // In-app confirm (native confirm() renders broken on Android Capacitor).
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);

  const handleToggle = () => {
    if (enabled) {
      setConfirmDisableOpen(true);
    } else {
      setSetupOpen(true);
    }
  };

  const doDisable = () => {
    setConfirmDisableOpen(false);
    clearPin();
    setEnabled(false);
    toast.success('נעילת הקוד בוטלה');
  };

  return (
    <>
      <div className="mb-3 rounded-2xl p-4" style={{ background: '#fff', border: `1.5px solid ${C.gray200}` }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: enabled ? C.light : C.gray100 }}>
              <Lock className="w-5 h-5" style={{ color: enabled ? C.primary : C.gray400 }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm" style={{ color: C.text }}>נעילת קוד</p>
              <p className="text-xs mt-0.5" style={{ color: C.gray500 }}>
                {enabled ? 'מופעל. קוד 4 ספרות בכניסה' : 'הזן קוד בכל פתיחה של האפליקציה'}
              </p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggle} aria-label="נעילת קוד" />
        </div>
        {enabled && (
          <button onClick={() => setSetupOpen(true)}
            className="w-full mt-3 py-2 text-xs font-bold rounded-lg transition-colors"
            style={{ background: C.gray50, color: C.primary, border: `1px solid ${C.gray200}` }}>
            החלף קוד
          </button>
        )}
      </div>
      {setupOpen && (
        <PinLock mode="setup"
          onSuccess={() => { setEnabled(true); setSetupOpen(false); }}
          onCancel={() => setSetupOpen(false)} />
      )}
      {/* In-app confirm (native confirm() breaks on Android Capacitor) */}
      <ConfirmDeleteDialog
        open={confirmDisableOpen}
        onConfirm={doDisable}
        onCancel={() => setConfirmDisableOpen(false)}
        title="לבטל את נעילת הקוד?"
        description="בפעם הבאה תיכנס ישר בלי קוד."
        confirmLabel="בטל נעילה"
      />
    </>
  );
}

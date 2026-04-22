import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import PinLock from './PinLock';
import { isPinEnabled, clearPin } from '@/lib/pinLock';

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

  const handleToggle = () => {
    if (enabled) {
      if (!confirm('לבטל את נעילת הקוד? בפעם הבאה תיכנס ישר בלי קוד.')) return;
      clearPin();
      setEnabled(false);
      toast.success('נעילת הקוד בוטלה');
    } else {
      setSetupOpen(true);
    }
  };

  return (
    <>
      <div className="mb-3 rounded-2xl p-4" style={{ background: '#fff', border: '1.5px solid #E5E7EB' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: enabled ? '#E8F2EA' : '#F3F4F6' }}>
              <Lock className="w-5 h-5" style={{ color: enabled ? '#2D5233' : '#9CA3AF' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm" style={{ color: '#1C2E20' }}>נעילת קוד</p>
              <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>
                {enabled ? 'מופעל. קוד 4 ספרות בכניסה' : 'הזן קוד בכל פתיחה של האפליקציה'}
              </p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggle} aria-label="נעילת קוד" />
        </div>
        {enabled && (
          <button onClick={() => setSetupOpen(true)}
            className="w-full mt-3 py-2 text-xs font-bold rounded-lg transition-colors"
            style={{ background: '#F9FAFB', color: '#2D5233', border: '1px solid #E5E7EB' }}>
            החלף קוד
          </button>
        )}
      </div>
      {setupOpen && (
        <PinLock mode="setup"
          onSuccess={() => { setEnabled(true); setSetupOpen(false); }}
          onCancel={() => setSetupOpen(false)} />
      )}
    </>
  );
}

/**
 * ChangePasswordCard — in-place password change for authenticated users.
 *
 * Uses supabase.auth.updateUser({ password }). The user's current
 * session is enough proof; Supabase doesn't require the old password
 * to be re-entered. We still ask for confirmation of the new password
 * to catch typos.
 */

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Eye, EyeOff, Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

const MIN_LEN = 8;

export default function ChangePasswordCard() {
  const [open, setOpen] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setNewPass(''); setConfirmPass('');
    setShowNew(false); setShowConfirm(false);
    setError('');
  };

  const validate = () => {
    if (newPass.length < MIN_LEN) return `הסיסמה חייבת להיות לפחות ${MIN_LEN} תווים`;
    if (!/[A-Za-z]/.test(newPass)) return 'הסיסמה חייבת לכלול לפחות אות אחת';
    if (!/[0-9]/.test(newPass))     return 'הסיסמה חייבת לכלול לפחות ספרה אחת';
    if (newPass !== confirmPass)    return 'הסיסמאות לא זהות';
    return '';
  };

  const handleSave = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    setError('');
    setSaving(true);
    try {
      const { error: apiError } = await supabase.auth.updateUser({ password: newPass });
      if (apiError) throw apiError;
      toast.success('הסיסמה עודכנה');
      reset();
      setOpen(false);
    } catch (e) {
      const msg = e?.message || 'העדכון נכשל';
      // Supabase returns this when the user is technically "AAL1" and needs
      // a fresh sign-in before updating the password.
      if (/reauth|again/i.test(msg)) {
        setError('יש להתחבר מחדש לפני שינוי הסיסמה. התנתק וחזור.');
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="rounded-2xl overflow-hidden" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 transition-colors text-right">
        <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
          <Lock className="w-4 h-4 text-slate-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-800">שינוי סיסמה</p>
          <p className="text-[11px] text-slate-500 mt-0.5">עדכון הסיסמה לחשבון</p>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-slate-400" />
          : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
          {/* New password */}
          <div>
            <Label className="text-xs font-bold text-slate-700 mb-1.5 block">סיסמה חדשה</Label>
            <div className="relative">
              <Input
                type={showNew ? 'text' : 'password'}
                value={newPass}
                onChange={(e) => { setNewPass(e.target.value); setError(''); }}
                placeholder="לפחות 8 תווים, אות וספרה"
                dir="ltr"
                className="pe-10"
                autoComplete="new-password"
              />
              <button type="button"
                onClick={() => setShowNew(s => !s)}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                aria-label={showNew ? 'הסתר סיסמה' : 'הצג סיסמה'}>
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm */}
          <div>
            <Label className="text-xs font-bold text-slate-700 mb-1.5 block">אישור סיסמה חדשה</Label>
            <div className="relative">
              <Input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPass}
                onChange={(e) => { setConfirmPass(e.target.value); setError(''); }}
                placeholder="הקלד/י שוב לאימות"
                dir="ltr"
                className="pe-10"
                autoComplete="new-password"
              />
              <button type="button"
                onClick={() => setShowConfirm(s => !s)}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                aria-label={showConfirm ? 'הסתר סיסמה' : 'הצג סיסמה'}>
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1"
              onClick={() => { reset(); setOpen(false); }}
              disabled={saving}>
              ביטול
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !newPass || !confirmPass}
              className="flex-1 bg-[#2D5233] hover:bg-[#1E3D24] text-white gap-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? 'שומר…' : 'עדכן סיסמה'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * TransferOwnershipDialog — owner-only, two-step ownership handoff.
 *
 * Step 1 (pick): choose an ACTIVE non-owner member as the heir. A viewer
 * (צופה) heir shows an explicit "צופה → בעלים" jump warning.
 * Step 2 (confirm): irreversible-action gate — the owner must type the
 * account name, exactly like account deletion, before the transfer fires.
 *
 * Calls transfer_ownership(p_account_id, p_new_owner_user_id) which is atomic
 * (FOR UPDATE), enforces a single owner, and demotes the previous owner to
 * 'מנהל'. Spec: docs/spec-business-personal-membership-separation.md §4(ג).
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Crown, Shield, Eye, Loader2, AlertTriangle, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import { toastError } from '@/lib/userErrorReport';
import { C } from '@/lib/designTokens';

const ROLE_LABEL = { 'מנהל': 'מנהל', 'שותף': 'צופה', 'driver': 'נהג' };
const ROLE_ICON  = { 'מנהל': Shield, 'שותף': Eye, 'driver': Crown };

const ERR = {
  heir_not_active_member: 'האדם שנבחר כבר אינו חבר פעיל. בחר/י אחר.',
  not_authorized:         'רק בעל החשבון יכול להעביר בעלות.',
  cannot_transfer_to_self:'אי אפשר להעביר בעלות לעצמך.',
  account_not_found:      'החשבון לא נמצא.',
};
const errText = (e) => {
  const code = (e?.message || '').match(/[a-z_]+/)?.[0] || '';
  return ERR[code] || 'העברת הבעלות נכשלה. נסה/י שוב.';
};

export default function TransferOwnershipDialog({ open, onOpenChange, accountId, accountName }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState('pick');       // 'pick' | 'confirm'
  const [heir, setHeir] = useState(null);          // selected member row
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: members = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['transfer-candidates', accountId],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.rpc('workspace_team_directory', { p_account_id: accountId }),
        'transfer_candidates'
      );
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!accountId,
    staleTime: 30 * 1000,
    retry: 1,
  });

  const candidates = useMemo(
    () => members.filter(m => m.status === 'פעיל' && m.role !== 'בעלים'),
    [members]
  );

  const reset = () => { setStep('pick'); setHeir(null); setConfirmText(''); setSubmitting(false); };
  const close = (next) => { if (!next) reset(); onOpenChange(next); };

  const submit = async () => {
    if (!heir) return;
    setSubmitting(true);
    try {
      const { error } = await withTimeout(
        supabase.rpc('transfer_ownership', {
          p_account_id: accountId,
          p_new_owner_user_id: heir.user_id,
        }),
        'transfer_ownership'
      );
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['user-workspaces'] });
      await queryClient.invalidateQueries({ queryKey: ['team-management', accountId] });
      toast.success(`הבעלות הועברה ל${heir.display_name || 'החבר'}`);
      close(false);
    } catch (e) {
      const msg = e?.message || '';
      // If the heir went inactive mid-flow, send the owner back to re-pick.
      if (msg.includes('heir_not_active_member')) { setStep('pick'); setHeir(null); }
      toastError(errText(e), { action: 'transfer_ownership', err: e });
      setSubmitting(false);
    }
  };

  const heirIsViewer = heir?.role === 'שותף';
  const confirmOk = confirmText.trim() === (accountName || '').trim() && !!accountName;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md mx-4" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Crown className="w-5 h-5" style={{ color: '#A855F7' }} />
            העברת בעלות
          </DialogTitle>
        </DialogHeader>

        {step === 'pick' ? (
          <div className="space-y-4 pt-1">
            <p className="text-xs leading-relaxed" style={{ color: C.mutedAlt }}>
              בחר/י את הבעלים החדש של "{accountName || 'החשבון'}". רק חברים פעילים מוצגים.
              אתה תרד לתפקיד "מנהל".
            </p>

            {isLoading ? (
              <div className="text-center py-8"><Loader2 className="h-6 w-6 mx-auto animate-spin" style={{ color: C.successBright }} /></div>
            ) : isError ? (
              <div className="rounded-xl p-3 text-center text-sm" style={{ background: C.errorBg, color: C.error }}>
                טעינת החברים נכשלה.{' '}
                <button type="button" onClick={() => refetch()} className="font-bold underline">נסה שוב</button>
              </div>
            ) : candidates.length === 0 ? (
              <div className="rounded-xl p-4 text-center" style={{ background: C.warnSubtle }}>
                <p className="text-sm font-bold" style={{ color: C.warnDark }}>אין חברים פעילים אחרים</p>
                <p className="text-xs mt-1" style={{ color: C.warnMid }}>
                  כדי להעביר בעלות צריך לפחות איש צוות פעיל אחד נוסף בחשבון.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {candidates.map(m => {
                  const Icon = ROLE_ICON[m.role] || Eye;
                  const active = heir?.user_id === m.user_id;
                  const isViewer = m.role === 'שותף';
                  return (
                    <button key={m.user_id} type="button" onClick={() => setHeir(m)}
                      className="w-full rounded-2xl p-3 text-right border-2 flex items-center gap-3 transition-all"
                      style={{ borderColor: active ? '#A855F7' : C.gray200, background: active ? '#FAF5FF' : C.grayBg }}>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: active ? '#A855F722' : C.gray100 }}>
                        <Icon className="w-4 h-4" style={{ color: active ? '#A855F7' : C.gray500 }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate" style={{ color: C.gray800 }}>{m.display_name || m.email}</p>
                        <p className="text-[11px]" style={{ color: C.gray400 }}>
                          {ROLE_LABEL[m.role] || m.role}{isViewer ? ' · יקפוץ ישירות לבעלים' : ''}
                        </p>
                      </div>
                      {active && <Check className="w-5 h-5 shrink-0" style={{ color: '#A855F7' }} />}
                    </button>
                  );
                })}
              </div>
            )}

            <button type="button" disabled={!heir} onClick={() => setStep('confirm')}
              className="w-full h-12 rounded-2xl font-bold text-base disabled:opacity-50"
              style={{ background: '#A855F7', color: '#fff' }}>
              המשך
            </button>
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: C.errorBg, border: `1.5px solid ${C.errorBorder}` }}>
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: C.error }} />
              <div className="text-sm leading-relaxed" style={{ color: C.errorDark }}>
                הבעלות על "<strong>{accountName}</strong>" תועבר ל<strong>{heir?.display_name || 'החבר'}</strong>.
                אתה תרד לתפקיד "מנהל". הפעולה אינה הפיכה.
              </div>
            </div>

            {heirIsViewer && (
              <div className="rounded-xl p-3 text-xs leading-relaxed" style={{ background: C.warnSubtle, color: C.warnDark }}>
                שים/י לב: <strong>{heir?.display_name || 'החבר'}</strong> הוא כיום <strong>צופה</strong> ויהפוך ישירות ל<strong>בעלים</strong> — דילוג על דרגת מנהל.
              </div>
            )}

            <div>
              <label className="block text-xs font-bold mb-1.5" style={{ color: C.gray700 }}>
                להמשך, הקלד/י את שם החשבון: <span dir="rtl" style={{ color: C.gray500 }}>"{accountName}"</span>
              </label>
              <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border text-sm font-medium outline-none"
                style={{ background: '#fff', borderColor: C.gray200, color: C.gray800 }}
                placeholder={accountName} autoFocus />
            </div>

            <div className="flex gap-2">
              <button type="button" disabled={!confirmOk || submitting} onClick={submit}
                className="flex-1 h-12 rounded-2xl font-bold text-sm text-white disabled:opacity-50 inline-flex items-center justify-center gap-2"
                style={{ background: '#A855F7' }}>
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> מעביר...</> : 'העבר בעלות'}
              </button>
              <button type="button" onClick={() => setStep('pick')} disabled={submitting}
                className="px-5 h-12 rounded-2xl font-bold text-sm" style={{ background: C.gray100, color: C.gray500 }}>
                חזרה
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * TransferVehicleDialog — the seller's side of a digital ownership transfer.
 *
 * Deliberately the same shape as ShareVehicleDialog: enter an email, submit,
 * then get a link to pass along by WhatsApp or copy. Ofek's instruction was
 * that this be built "באותו אופן ועל אותו בסיס" as vehicle sharing, so the
 * two dialogs look and behave alike, and the recipient approves either way.
 *
 * Three things are different, and each follows from what a transfer IS:
 *
 *   1. A MANIFEST instead of a role picker. A share grants access to
 *      everything; a transfer hands over a copy, and the seller decides what
 *      travels. Ofek's product decision 1: "שיהיה ניתן למשתמש שמעביר להחליט".
 *
 *   2. A CONFIRMATION STEP. Sharing is reversible with one tap on revoke.
 *      A transfer freezes this vehicle's history while the offer is open and,
 *      once accepted, archives it here permanently. That earns one screen
 *      that says so plainly before the email goes out.
 *
 *   3. ONE open offer per vehicle. The database enforces it with a partial
 *      unique index; this dialog translates the refusal
 *      (`transfer_already_pending`) rather than letting the raw code surface.
 */

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dal } from '@/lib/dal';
import { COPY_FEEDBACK_DURATION_MS } from '@/lib/timingConstants';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Loader2, Copy, Check, Mail, ArrowLeftRight, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { rpcErrorCode } from '@/lib/rpcErrors';
import { C } from '@/lib/designTokens';
import { useAuth } from '@/components/shared/GuestContext';
import { rememberShareEmail } from '@/lib/recentShareEmails';
import { MANIFEST_ITEMS, defaultManifest } from '@/services/vehicleTransfer/manifest';
import { reportUserError } from '@/lib/crashReporter';

const WhatsAppIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

// MANIFEST_ITEMS lives in its own module so manifest.test.js can pin its key
// set against the SQL that reads it. See the note there.


const TRANSFER_ERROR_COPY = {
  not_authenticated:         'צריך להתחבר כדי להעביר רכב',
  not_vehicle_owner:         'רק בעלי הרכב יכולים להעביר אותו',
  vehicle_not_found:         'הרכב לא נמצא',
  invalid_email:             'כתובת מייל לא תקינה',
  cannot_transfer_to_yourself: 'זו כתובת המייל שלך. אפשר להעביר רק למישהו אחר.',
  transfer_already_pending:  'כבר יש הצעת העברה פתוחה לרכב הזה. צריך לבטל אותה לפני שליחת חדשה.',
};

export default function TransferVehicleDialog({ open, onOpenChange, vehicle }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState('compose'); // compose | confirm | done
  const [email, setEmail] = useState('');
  const [manifest, setManifest] = useState(defaultManifest);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setStep('compose');
    setEmail('');
    setManifest(defaultManifest());
    setSubmitting(false);
    setResult(null);
    setCopied(false);
  };

  const handleClose = (next) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const vehicleName = vehicle?.nickname
    || `${vehicle?.manufacturer || ''} ${vehicle?.model || ''}`.trim()
    || 'הרכב';

  const cleanEmail = email.trim();
  const emailLooksValid = cleanEmail.includes('@') && cleanEmail.length > 3;

  const submit = async () => {
    if (!vehicle?.id) {
      toastError('רכב לא נמצא', { action: 'transfer_vehicle_not_found' });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await dal.run('vehicleTransfer.offer', {
        vehicleId: vehicle.id,
        email: cleanEmail,
        manifest,
      });
      if (error) {
        const code = rpcErrorCode(error);
        const msg = TRANSFER_ERROR_COPY[code] || `שגיאה בהעברה: ${error.message}`;
        toastError(msg, { action: 'transfer_vehicle_send', err: error });
        if (import.meta.env.DEV) console.warn('transfer_vehicle_to_email error:', error);
        setSubmitting(false);
        return;
      }
      setResult(data);
      rememberShareEmail(user?.id, cleanEmail);
      // The vehicle is frozen from this moment. PendingTransferBanner is what
      // tells the seller so, and without this it would not appear until the
      // next refetch — leaving a window where the freeze is in force and
      // nothing on screen says why a save was refused.
      queryClient.invalidateQueries({ queryKey: ['vehicle-transfers', vehicle.id] });
      setStep('done');
      toast.success('ההצעה נשלחה');
      sendTransferEmail(cleanEmail, data?.invite_token, vehicleName).catch(() => {});
    } catch (e) {
      toastError(`שגיאה בהעברה: ${e?.message || 'נסה שוב'}`, { action: 'transfer_vehicle_exception', err: e });
      reportUserError('transfer_vehicle', e);
    } finally {
      setSubmitting(false);
    }
  };

  const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_APP_URL || 'https://car-reminder.app';
  const transferLink = result?.invite_token
    ? `${PUBLIC_DOMAIN}/VehicleTransfer?token=${result.invite_token}`
    : '';

  const copyLink = async () => {
    if (!transferLink) return;
    try {
      await navigator.clipboard.writeText(transferLink);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
      toast.success('הקישור הועתק');
    } catch {
      toastError('לא ניתן להעתיק. סמן ידנית', { action: 'transfer_vehicle_copy_link' });
    }
  };

  const openWhatsApp = () => {
    const text = `אני מעביר אליך את ${vehicleName} יחד עם היסטוריית הטיפולים. אשר/י בקישור:\n${transferLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const toggle = (key) => setManifest(m => ({ ...m, [key]: !m[key] }));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-md mx-4 overflow-y-auto"
        style={{
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px)',
        }}
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5" style={{ color: C.primary }} />
            העברת {vehicleName}
          </DialogTitle>
        </DialogHeader>

        {step === 'compose' && (
          <div className="space-y-5 pt-2">
            <p className="text-sm leading-relaxed" style={{ color: C.gray500 }}>
              מוכר/ת את הרכב? במקום למחוק אותו, אפשר להעביר את ההיסטוריה לבעלים הבאים.
              אצלך הוא יעבור לארכיון ויישאר לקריאה בלבד.
            </p>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">מה עובר יחד עם הרכב</label>
              <div className="space-y-2">
                {MANIFEST_ITEMS.map(item => {
                  const active = !!manifest[item.key];
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => toggle(item.key)}
                      aria-pressed={active}
                      className="w-full rounded-2xl p-4 text-right transition-all border-2 flex items-start gap-3"
                      style={{
                        borderColor: active ? C.primary : C.gray200,
                        background: active ? C.successBg : C.grayBg,
                      }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: active ? `${C.primary}20` : C.gray100 }}>
                        <Icon className="w-5 h-5" style={{ color: active ? C.primary : C.gray500 }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm" style={{ color: active ? C.primary : C.gray700 }}>{item.label}</p>
                        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: C.gray500 }}>{item.description}</p>
                      </div>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1 border-2"
                        style={{
                          background: active ? C.primary : 'transparent',
                          borderColor: active ? C.primary : C.gray200,
                        }}>
                        {active && <Check className="w-4 h-4 text-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">המייל של מי שמקבל את הרכב</label>
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && emailLooksValid) setStep('confirm'); }}
                  placeholder="name@example.com"
                  dir="ltr"
                  autoFocus
                  className="w-full h-11 pr-9 pl-3 rounded-xl border text-sm font-medium outline-none transition-all focus:ring-2"
                  style={{ background: '#fff', borderColor: C.gray200, color: C.gray800, '--tw-ring-color': C.primary }}
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                ההצעה בתוקף ל-7 ימים ומחכה לאישור שלו/ה. גם אם עדיין אין לו/ה חשבון, הקישור יוביל להרשמה.
              </p>
            </div>

            <Button
              onClick={() => setStep('confirm')}
              disabled={!emailLooksValid}
              className="w-full h-14 rounded-2xl font-bold text-base"
              style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
              המשך
            </Button>
          </div>
        )}

        {/* The confirmation. Sharing has no equivalent because revoking a share
            undoes it; nothing here undoes an accepted transfer. */}
        {step === 'confirm' && (
          <div className="space-y-5 pt-2">
            <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: C.warnBg }}>
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: C.warn }} />
              <div className="space-y-2 text-sm leading-relaxed" style={{ color: C.gray800 }}>
                <p className="font-bold">לפני ששולחים</p>
                <p>
                  כל עוד ההצעה פתוחה, אי אפשר להוסיף או לערוך טיפולים ברכב הזה, כדי שמה שהובטח
                  יהיה בדיוק מה שיתקבל.
                </p>
                <p>
                  ברגע ש<span className="font-bold" dir="ltr">{cleanEmail}</span> יאשר/תאשר, הרכב יעבור
                  אצלך לארכיון לקריאה בלבד. אפשר לבטל את ההצעה עד לרגע האישור.
                </p>
              </div>
            </div>

            <div className="rounded-2xl p-4 space-y-2" style={{ background: C.grayBg }}>
              <p className="text-xs font-bold" style={{ color: C.gray500 }}>מה נשלח</p>
              {MANIFEST_ITEMS.filter(i => manifest[i.key]).map(i => (
                <div key={i.key} className="flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0" style={{ color: C.primary }} />
                  <span className="text-sm font-bold" style={{ color: C.gray800 }}>{i.label}</span>
                </div>
              ))}
              {MANIFEST_ITEMS.filter(i => !manifest[i.key]).map(i => (
                <div key={i.key} className="flex items-center gap-2">
                  <span className="w-4 h-4 shrink-0 text-center text-xs" style={{ color: C.gray400 }}>—</span>
                  <span className="text-sm" style={{ color: C.gray400 }}>{i.label} (לא נשלח)</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <Button onClick={submit} disabled={submitting}
                className="w-full h-14 rounded-2xl font-bold text-base gap-2"
                style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowLeftRight className="h-5 w-5" />}
                שלח הצעת העברה
              </Button>
              <Button onClick={() => setStep('compose')} disabled={submitting}
                variant="ghost" className="w-full h-12 rounded-2xl font-bold text-sm">
                חזרה
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-5 pt-2">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
                style={{ background: C.successBg }}>
                <Check className="h-8 w-8" style={{ color: C.primary }} />
              </div>
              <h3 className="font-bold text-lg text-gray-900">ההצעה בדרך</h3>
              <p className="text-sm leading-relaxed" style={{ color: C.gray500 }}>
                {result?.recipient_existing_user
                  ? 'שלחנו מייל והתראה באפליקציה. הרכב יעבור רק אחרי האישור.'
                  : 'שלחנו מייל עם קישור. אין לו/ה עדיין חשבון, אז הקישור יוביל להרשמה ואז לאישור.'}
              </p>
            </div>

            {transferLink && (
              <>
                <div className="rounded-2xl p-3 flex items-center gap-2" style={{ background: C.grayBg }}>
                  <input
                    readOnly
                    value={transferLink}
                    dir="ltr"
                    onFocus={e => e.target.select()}
                    className="flex-1 min-w-0 bg-transparent text-xs outline-none"
                    style={{ color: C.gray500 }}
                  />
                  <button type="button" onClick={copyLink} aria-label="העתק קישור"
                    className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-[0.95]"
                    style={{ background: '#fff', border: `1px solid ${C.gray200}` }}>
                    {copied
                      ? <Check className="w-4 h-4" style={{ color: C.primary }} />
                      : <Copy className="w-4 h-4" style={{ color: C.gray500 }} />}
                  </button>
                </div>
                <Button onClick={openWhatsApp} variant="outline"
                  className="w-full rounded-2xl h-12 gap-2 text-sm font-bold"
                  style={{ color: '#25D366', borderColor: '#25D36640' }}>
                  <WhatsAppIcon size={18} />
                  שלח ב־WhatsApp
                </Button>
              </>
            )}

            <Button onClick={() => handleClose(false)} variant="ghost" className="w-full rounded-2xl">
              סגירה
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Best-effort email, exactly as ShareVehicleDialog does it: the RPC writes the
// in-app notification, the client sends the mail. Failure here never fails the
// transfer — the offer exists either way and the link is on screen.
async function sendTransferEmail(toEmail, inviteToken, vehicleName) {
  if (!toEmail || !inviteToken) return;
  try {
    const { sendEmail } = await import('@/lib/sendEmail');
    if (typeof sendEmail !== 'function') return;
    const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_APP_URL || 'https://car-reminder.app';
    const link = `${PUBLIC_DOMAIN}/VehicleTransfer?token=${inviteToken}`;
    await sendEmail({
      to: toEmail,
      subject: 'מעבירים אליך רכב ב-CarReminder',
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 16px;">
          <h2 style="color: ${C.primary};">מעבירים אליך רכב</h2>
          <p>מישהו מעביר אליך את ${vehicleName || 'הרכב'} ב-CarReminder, יחד עם היסטוריית הטיפולים שלו.</p>
          <p>ההעברה מחכה לאישור שלך:</p>
          <p><a href="${link}" style="display: inline-block; padding: 12px 24px; background: ${C.primary}; color: white; text-decoration: none; border-radius: 12px; font-weight: bold;">צפייה באישור ההעברה</a></p>
          <p style="color: ${C.gray500}; font-size: 13px;">ההצעה תקפה ל-7 ימים. אם אין לך עדיין חשבון, הקישור יוביל להרשמה מהירה.</p>
        </div>
      `,
    });
  } catch { /* best-effort */ }
}

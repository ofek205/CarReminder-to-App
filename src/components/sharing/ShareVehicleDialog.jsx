/**
 * ShareVehicleDialog — per-vehicle email-based sharing.
 *
 * Replaces the legacy account-wide invite flow for the new
 * "share THIS vehicle with someone" flow on VehicleDetail.
 *
 * Flow:
 *   1. Caller (vehicle owner) opens the dialog with `vehicle` prop
 *   2. Picks role (viewer / editor) + enters recipient email
 *   3. Submit calls `share_vehicle_with_email` RPC
 *   4. On success: show the share link + WhatsApp / Email / Copy buttons
 *      so the owner can ping the recipient via any channel
 *   5. The recipient also gets an in-app notification (created server-side
 *      by the RPC) and a Resend email (sent client-side from here)
 *
 * The DB enforces:
 *   - Caller must own the vehicle (account_members role='בעלים')
 *   - No duplicate active invite for same (vehicle, email)
 *   - Cap of 3 ACCEPTED users per vehicle (pending unlimited)
 *   - 7-day TTL on pending invites
 */

import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Copy, Check, Eye, Edit, Share2, Clock, UserPlus, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { C } from '@/lib/designTokens';
import { useAuth } from '@/components/shared/GuestContext';
import { getRecentShareEmails, rememberShareEmail } from '@/lib/recentShareEmails';

// WhatsApp icon — kept inline so we don't add an asset dependency.
const WhatsAppIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

// Map our DB role values to friendly Hebrew labels + descriptions.
// 'editor' / 'viewer' are stored in the DB; we never expose them to the
// user verbatim because they don't communicate the actual permission.
const ROLES = [
  {
    value: 'editor',
    label: 'עורך',
    description: 'מוסיף ועורך הכל, חוץ ממחיקת הרכב',
    icon: Edit,
    color: '#2D5233',
    bg: '#E8F5E9',
  },
  {
    value: 'viewer',
    label: 'צופה',
    description: 'רואה הכל, בלי אפשרות לערוך',
    icon: Eye,
    color: '#1565C0',
    bg: '#E3F2FD',
  },
];

// Errors raised by share_vehicle_with_email — translate to Hebrew so we
// don't dump raw codes in the UI. Anything not on the list falls back
// to a generic message; we still surface the raw error in DEV console.
const ERROR_COPY = {
  not_authenticated:    'צריך להתחבר כדי לשתף רכב',
  not_vehicle_owner:    'רק בעלי הרכב יכולים לשתף אותו',
  vehicle_not_found:    'הרכב לא נמצא',
  share_already_exists: 'הרכב כבר משותף עם המייל הזה',
  vehicle_share_cap_exceeded: 'הרכב כבר משותף עם 3 משתמשים — המקסימום. כדי להוסיף חדש, צריך לבטל אחד קיים.',
  invalid_email:        'כתובת מייל לא תקינה',
  invalid_role:         'הרשאה לא תקינה',
};

export default function ShareVehicleDialog({ open, onOpenChange, vehicle }) {
  const { user } = useAuth();
  const [role, setRole] = useState('editor');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [shareResult, setShareResult] = useState(null); // { invite_token, expires_at, recipient_existing_user }
  const [copied, setCopied] = useState(false);
  // List of emails the current user has shared with before — read once
  // when the dialog opens. We don't refresh during the open lifetime
  // (the user wouldn't expect a chip to appear/disappear mid-flow).
  const [recents, setRecents] = useState([]);

  useEffect(() => {
    if (open) setRecents(getRecentShareEmails(user?.id));
  }, [open, user?.id]);

  // Filter recents by what the user has typed so far. Helps when
  // they remember the start of a name and want quick narrowing.
  const filteredRecents = useMemo(() => {
    const q = email.trim().toLowerCase();
    if (!q) return recents;
    return recents.filter(r => r.email.includes(q));
  }, [recents, email]);

  const reset = () => {
    setRole('editor');
    setEmail('');
    setSubmitting(false);
    setShareResult(null);
    setCopied(false);
  };

  const handleClose = (next) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      toast.error('המייל לא תקין, נסה/י שוב');
      return;
    }
    if (!vehicle?.id) {
      toast.error('רכב לא נמצא');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('share_vehicle_with_email', {
        p_vehicle_id: vehicle.id,
        p_email:      cleanEmail,
        p_role:       role,
      });
      if (error) {
        // The DB raises exception with a known code; the JS-SDK exposes
        // it on error.message. Match the ones we have specific copy for.
        const code = (error.message || '').match(/[a-z_]+/)?.[0] || '';
        const msg = ERROR_COPY[code] || `שגיאה בשיתוף: ${error.message}`;
        toast.error(msg);
        if (import.meta.env.DEV) console.warn('share_vehicle_with_email error:', error);
        setSubmitting(false);
        return;
      }
      setShareResult(data);
      toast.success('ההזמנה נשלחה');

      // Cache for the next share. Stored locally per-user — see
      // src/lib/recentShareEmails.js for rationale.
      rememberShareEmail(user?.id, cleanEmail);

      // Background email send via existing Resend pipeline. Best-effort —
      // even if the email fails, the in-app notification + the share
      // link surfaced below are usable channels.
      sendShareEmail(cleanEmail, data?.invite_token).catch(() => {});
    } catch (e) {
      toast.error(`שגיאה בשיתוף: ${e?.message || 'נסה שוב'}`);
      if (import.meta.env.DEV) console.warn('share dialog exception:', e);
    } finally {
      setSubmitting(false);
    }
  };

  // Build the invite link. Always production domain so WhatsApp /
  // Capacitor / preview deployments don't break the link for the
  // recipient.
  const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_APP_URL || 'https://car-reminder.app';
  const inviteLink = shareResult?.invite_token
    ? `${PUBLIC_DOMAIN}/JoinInvite?token=${shareResult.invite_token}&type=vehicle`
    : '';

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('הקישור הועתק');
    } catch {
      toast.error('לא ניתן להעתיק. סמן ידנית');
    }
  };

  const openWhatsApp = () => {
    const vName = vehicle?.nickname || `${vehicle?.manufacturer || ''} ${vehicle?.model || ''}`.trim() || 'הרכב';
    const text = `שיתפתי איתך את ${vName}. אשר/י את השיתוף בקישור:\n${inviteLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  // openEmailClient was the manual "open mailto:" handler the success
  // state used to expose. Removed because share emails are sent
  // automatically on submit and a second manual button confused users
  // ("did the email actually go out, do I need to click this?").
  // WhatsApp + Copy still cover the unregistered-recipient flow.

  const vehicleName = vehicle?.nickname
    || `${vehicle?.manufacturer || ''} ${vehicle?.model || ''}`.trim()
    || 'הרכב';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md mx-4 max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Share2 className="w-5 h-5" style={{ color: C.primary }} />
            שיתוף הרכב {vehicleName}
          </DialogTitle>
        </DialogHeader>

        {!shareResult ? (
          //  Step 1: pick role + enter email
          <div className="space-y-5 pt-2">
            {/* Role picker */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">סוג הרשאה</label>
              <div className="space-y-2">
                {ROLES.map(opt => {
                  const active = role === opt.value;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRole(opt.value)}
                      className="w-full rounded-2xl p-4 text-right transition-all border-2 flex items-start gap-3"
                      style={{
                        borderColor: active ? opt.color : '#E5E7EB',
                        background: active ? opt.bg : '#FAFAFA',
                      }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: active ? `${opt.color}20` : '#F3F4F6' }}>
                        <Icon className="w-5 h-5" style={{ color: opt.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm" style={{ color: active ? opt.color : '#374151' }}>{opt.label}</p>
                        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#6B7280' }}>{opt.description}</p>
                      </div>
                      {active && (
                        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1"
                          style={{ background: opt.color }}>
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">המייל של מי שמקבל את השיתוף</label>
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !submitting) submit(); }}
                  placeholder="name@example.com"
                  dir="ltr"
                  autoFocus
                  className="w-full h-11 pr-9 pl-3 rounded-xl border text-sm font-medium outline-none transition-all focus:ring-2"
                  style={{ background: '#fff', borderColor: '#E5E7EB', color: '#1F2937', '--tw-ring-color': C.primary }}
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                ההזמנה בתוקף ל-7 ימים. אם המייל רשום אצלנו, תישלח גם התראה באפליקציה.
              </p>

              {/* Recent contacts — shown only when there are any AND
                  what the user typed (or hasn't typed) doesn't already
                  match the only candidate. Tap a chip to fill the
                  input; saves a re-typing cycle for repeat sharees. */}
              {filteredRecents.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] font-bold text-gray-500 mb-1.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    נמענים אחרונים
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {filteredRecents.slice(0, 5).map(r => (
                      <button
                        key={r.email}
                        type="button"
                        onClick={() => setEmail(r.email)}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-full transition-all active:scale-95"
                        style={{
                          background: email === r.email ? C.light : '#F9FAFB',
                          color: email === r.email ? C.primary : '#374151',
                          border: `1px solid ${email === r.email ? C.primary + '60' : '#E5E7EB'}`,
                        }}>
                        {r.email}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Button
              onClick={submit}
              disabled={submitting || !email.trim()}
              className="w-full h-12 rounded-2xl font-bold text-base gap-2"
              style={{ background: C.grad, color: 'white', opacity: !email.trim() ? 0.5 : 1 }}>
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                <>
                  <Share2 className="h-5 w-5" />
                  שליחת הזמנה
                </>
              )}
            </Button>
          </div>
        ) : (
          //  Step 2: success — show link + share buttons
          <div className="space-y-4 pt-2">
            {/* Success banner — copy switches based on whether the
                recipient already has an account. The "needs to register"
                case is called out explicitly so the owner knows to
                expect a registration delay before the recipient can
                accept. Without this hint, owners reported "I shared with
                X 30 minutes ago, why isn't it showing up on their side?"
                — answer: X hasn't created an account yet. */}
            {shareResult.recipient_existing_user ? (
              // Registered recipient → email goes out automatically + a
              // realtime app_notification + bell ping fires for them.
              // No manual share buttons needed; just confirm and close.
              // Showing the recipient's name closes the loop ("did it
              // really go to that person?").
              <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: '#E8F5E9', border: '1.5px solid #A5D6A7' }}>
                <Check className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#2E7D32' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: '#1B5E20' }}>
                    {shareResult.recipient_name
                      ? <>ההזמנה נשלחה ל־<strong>{shareResult.recipient_name}</strong></>
                      : 'ההזמנה נשלחה'}
                  </p>
                  <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#2E7D32' }}>
                    מייל נשלח אוטומטית. ההתראה תופיע גם בפעמון שלו באפליקציה.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: '#FFF8E1', border: '1.5px solid #FDE68A' }}>
                <UserPlus className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#B45309' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: '#92400E' }}>המייל הזה לא רשום אצלנו עדיין</p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: '#B45309' }}>
                    שלחנו מייל עם קישור הצטרפות. <strong>הוא יצטרך להירשם תחילה</strong> (עם אותה כתובת מייל). אחרי ההרשמה ההזמנה תחכה לו ויוכל לאשר אותה.
                  </p>
                  <p className="text-[11px] mt-1.5" style={{ color: '#B45309' }}>
                    אפשר גם לשתף את הקישור ב־WhatsApp או להעתיק כדי לזרז.
                  </p>
                </div>
              </div>
            )}

            {/* Link + manual-share channels. Shown ONLY when the
                recipient isn't registered yet — registered users get
                everything via the auto-email + realtime path and don't
                need the link surface. Removing it for the registered
                case keeps the success state focused. */}
            {!shareResult.recipient_existing_user && (
              <>
                <div className="min-w-0">
                  <label className="block text-sm font-bold text-gray-700 mb-2">קישור הזמנה</label>
                  <div className="flex gap-2 items-stretch">
                    <div className="flex-1 min-w-0 rounded-xl border px-3 py-2 text-[10px] font-mono break-all leading-relaxed"
                      dir="ltr"
                      style={{
                        background: '#F9FAFB',
                        borderColor: '#E5E7EB',
                        color: '#374151',
                        maxHeight: '64px',
                        overflowY: 'auto',
                      }}>
                      {inviteLink}
                    </div>
                    <Button onClick={copyLink} variant="outline" size="sm"
                      className="shrink-0 rounded-xl px-3"
                      aria-label={copied ? 'הועתק' : 'העתק קישור'}>
                      {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                {/* WhatsApp only — the dedicated "Email" channel button
                    was removed because the email is sent automatically
                    on submit (line 149 in submit()); a second manual
                    button confused users into thinking they needed to
                    click it for the email to actually go out. */}
                <Button onClick={openWhatsApp} variant="outline" className="w-full rounded-2xl h-12 gap-2 text-sm font-bold"
                  style={{ color: '#25D366', borderColor: '#25D36640' }}>
                  <WhatsAppIcon size={18} />
                  שתף ב־WhatsApp
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

// Best-effort email send. Mirrors AccountSettings.jsx invite-email flow —
// uses the existing Resend-backed pipeline if available, no-ops otherwise.
async function sendShareEmail(toEmail, inviteToken) {
  if (!toEmail || !inviteToken) return;
  try {
    const { sendEmail } = await import('@/lib/sendEmail');
    if (typeof sendEmail !== 'function') return;
    const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_APP_URL || 'https://car-reminder.app';
    const link = `${PUBLIC_DOMAIN}/JoinInvite?token=${inviteToken}&type=vehicle`;
    await sendEmail({
      to: toEmail,
      subject: 'הזמנה לשיתוף רכב ב-CarReminder',
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; padding: 16px;">
          <h2 style="color: #2D5233;">הוזמנת לשיתוף רכב</h2>
          <p>מישהו שיתף איתך רכב ב-CarReminder.</p>
          <p>לחץ על הקישור כדי לאשר את השיתוף ולהוסיף את הרכב לרשימה שלך:</p>
          <p><a href="${link}" style="display: inline-block; padding: 12px 24px; background: #2D5233; color: white; text-decoration: none; border-radius: 12px; font-weight: bold;">פתח אישור שיתוף</a></p>
          <p style="color: #6B7280; font-size: 13px;">הקישור תקף ל-7 ימים.</p>
        </div>
      `,
    });
  } catch { /* best-effort */ }
}

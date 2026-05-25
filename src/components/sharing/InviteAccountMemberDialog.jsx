/**
 * InviteAccountMemberDialog — account-level email-based invite.
 *
 * Mirrors ShareVehicleDialog's UX: email is primary input, registered
 * users get a pending in-app invite (accept/decline via notification),
 * unregistered users get a token link to share via WhatsApp / Copy.
 *
 * Calls the `invite_account_member_by_email` RPC which handles both
 * paths server-side (SECURITY DEFINER).
 */

import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { COPY_FEEDBACK_DURATION_MS } from '@/lib/timingConstants';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Copy, Check, Eye, Shield, Share2, Clock, UserPlus, Mail, Users, Car } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { C } from '@/lib/designTokens';
import { useAuth } from '@/components/shared/GuestContext';
import { getRecentShareEmails, rememberShareEmail } from '@/lib/recentShareEmails';
import { isNative } from '@/lib/capacitor';
import VehicleImage, { hasVehiclePhoto } from '@/components/shared/VehicleImage';

const WhatsAppIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const ROLES = [
  {
    value: 'מנהל',
    label: 'שותף עורך',
    description: 'מוסיף ועורך הכל, חוץ ממחיקת רכבים וניהול חברים',
    icon: Shield,
    color: '#2563EB',
    bg: '#DBEAFE',
  },
  {
    value: 'שותף',
    label: 'שותף צופה',
    description: 'צפייה בלבד, ללא עריכה או מחיקה',
    icon: Eye,
    color: '#6B7280',
    bg: '#F3F4F6',
  },
];

const ERROR_COPY = {
  not_authenticated:  'צריך להתחבר כדי להזמין',
  not_authorized:     'רק בעלים או מנהלים יכולים להזמין',
  invalid_role:       'תפקיד לא תקין',
  invalid_email:      'כתובת מייל לא תקינה',
  cannot_invite_self: 'לא ניתן להזמין את עצמך',
  already_member:     'המשתמש כבר חבר בחשבון או שיש הזמנה ממתינה',
};

export default function InviteAccountMemberDialog({ open, onOpenChange, accountId, vehicles = [] }) {
  const { user } = useAuth();
  const [role, setRole] = useState('שותף');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [shareAll, setShareAll] = useState(true);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState([]);
  const [recents, setRecents] = useState([]);

  useEffect(() => {
    if (open) setRecents(getRecentShareEmails(user?.id));
  }, [open, user?.id]);

  const filteredRecents = useMemo(() => {
    const q = email.trim().toLowerCase();
    if (!q) return recents;
    return recents.filter(r => r.email.includes(q));
  }, [recents, email]);

  const reset = () => {
    setRole('שותף');
    setEmail('');
    setSubmitting(false);
    setResult(null);
    setCopied(false);
    setShareAll(true);
    setSelectedVehicleIds([]);
  };

  const handleClose = (next) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const toggleVehicle = (vId) => {
    setSelectedVehicleIds(prev =>
      prev.includes(vId) ? prev.filter(id => id !== vId) : [...prev, vId]
    );
  };

  const submit = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      toastError('המייל לא תקין, נסה/י שוב', { action: 'invite_member_invalid_email' });
      return;
    }
    if (!shareAll && selectedVehicleIds.length === 0) {
      toastError('בחר/י לפחות רכב אחד', { action: 'invite_member_no_vehicles' });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('invite_account_member_by_email', {
        p_email: cleanEmail,
        p_role: role,
        p_vehicle_ids: shareAll ? null : selectedVehicleIds,
      });
      if (error) {
        const code = (error.message || '').match(/[a-z_]+/)?.[0] || '';
        const msg = ERROR_COPY[code] || `שגיאה בהזמנה: ${error.message}`;
        toastError(msg, { action: 'invite_member_rpc', err: error });
        if (import.meta.env.DEV) console.warn('invite_account_member_by_email error:', error);
        setSubmitting(false);
        return;
      }
      setResult(data);
      rememberShareEmail(user?.id, cleanEmail);

      if (data?.recipient_existing_user) {
        toast.success('ההזמנה נשלחה — ממתין לאישור');
      } else {
        toast.success('קישור הזמנה נוצר');
        if (data?.invite_token) {
          sendInviteEmail(cleanEmail, data.invite_token).catch(() => {});
        }
      }
    } catch (e) {
      toastError(`שגיאה בהזמנה: ${e?.message || 'נסה שוב'}`, { action: 'invite_member_exception', err: e });
      if (import.meta.env.DEV) console.warn('invite dialog exception:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_APP_URL || 'https://car-reminder.app';
  const inviteLink = result?.invite_token
    ? `${PUBLIC_DOMAIN}/JoinInvite?token=${result.invite_token}&type=account`
    : '';

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
      toast.success('הקישור הועתק');
    } catch {
      toastError('לא ניתן להעתיק. סמן ידנית', { action: 'invite_member_copy_link' });
    }
  };

  const openWhatsApp = () => {
    const roleLabel = role === 'מנהל' ? 'שותף עורך' : 'שותף צופה';
    const text = `הצטרף/י לחשבון הרכבים שלי ב-CarReminder כ${roleLabel}. לחץ להצטרפות:\n${inviteLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareNative = async () => {
    if (isNative) {
      try {
        const { shareContent } = await import('@/lib/capacitor');
        await shareContent({
          title: 'הזמנה ל-CarReminder',
          text: 'הצטרף/י לחשבון הרכבים שלי ב-CarReminder',
          url: inviteLink,
        });
      } catch { /* cancelled */ }
    } else if (navigator.share) {
      try {
        await navigator.share({
          title: 'הזמנה ל-CarReminder',
          text: 'הצטרף/י לחשבון הרכבים שלי',
          url: inviteLink,
        });
      } catch { /* cancelled */ }
    }
  };

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
            <UserPlus className="w-5 h-5" style={{ color: C.primary }} />
            הזמנת חבר לחשבון
          </DialogTitle>
        </DialogHeader>

        {!result ? (
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

            {/* Vehicle selection */}
            {vehicles.length > 0 && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">אילו רכבים לשתף?</label>
                <div className="space-y-2">
                  <button type="button" onClick={() => { setShareAll(true); setSelectedVehicleIds([]); }}
                    className="w-full rounded-2xl p-3 text-right transition-all border-2 flex items-center gap-3"
                    style={{
                      borderColor: shareAll ? C.primary : '#E5E7EB',
                      background: shareAll ? C.light : '#FAFAFA',
                    }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: shareAll ? C.primary : '#F3F4F6' }}>
                      <Users className="w-4 h-4" style={{ color: shareAll ? 'white' : '#9CA3AF' }} />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-sm" style={{ color: shareAll ? C.primary : '#6B7280' }}>כל הרכבים</p>
                      <p className="text-xs" style={{ color: '#9CA3AF' }}>גישה לכל הרכבים בחשבון</p>
                    </div>
                    {shareAll && <Check className="w-5 h-5" style={{ color: C.primary }} />}
                  </button>

                  <button type="button" onClick={() => setShareAll(false)}
                    className="w-full rounded-2xl p-3 text-right transition-all border-2 flex items-center gap-3"
                    style={{
                      borderColor: !shareAll ? C.primary : '#E5E7EB',
                      background: !shareAll ? C.light : '#FAFAFA',
                    }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: !shareAll ? C.primary : '#F3F4F6' }}>
                      <Car className="w-4 h-4" style={{ color: !shareAll ? 'white' : '#9CA3AF' }} />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-sm" style={{ color: !shareAll ? C.primary : '#6B7280' }}>רכבים ספציפיים</p>
                      <p className="text-xs" style={{ color: '#9CA3AF' }}>בחר אילו רכבים לשתף</p>
                    </div>
                    {!shareAll && <Check className="w-5 h-5" style={{ color: C.primary }} />}
                  </button>
                </div>

                {!shareAll && (
                  <div className="mt-2 space-y-1.5 rounded-2xl p-2"
                    style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                    {vehicles.map(v => {
                      const vName = v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ') || 'רכב';
                      const selected = selectedVehicleIds.includes(v.id);
                      return (
                        <button key={v.id} type="button" onClick={() => toggleVehicle(v.id)}
                          className="w-full rounded-xl p-2.5 flex items-center gap-3 transition-all"
                          style={{
                            background: selected ? '#E8F5E9' : 'white',
                            border: `1.5px solid ${selected ? '#4CAF50' : '#E5E7EB'}`,
                          }}>
                          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 bg-gray-100">
                            {hasVehiclePhoto(v) ? (
                              <VehicleImage vehicle={v} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Car className="w-4 h-4 text-gray-400" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 text-right min-w-0">
                            <p className="font-bold text-sm text-gray-900 truncate">{vName}</p>
                            <p className="text-xs text-gray-500">{v.license_plate || ''}</p>
                          </div>
                          <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0"
                            style={{
                              borderColor: selected ? '#4CAF50' : '#D1D5DB',
                              background: selected ? '#4CAF50' : 'white',
                            }}>
                            {selected && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </button>
                      );
                    })}
                    {selectedVehicleIds.length === 0 && (
                      <p className="text-xs text-center text-red-500 font-medium py-1">בחר לפחות רכב אחד</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">המייל של מי שמוזמן</label>
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
                אם המייל רשום אצלנו, תישלח הזמנה ישירות באפליקציה. אחרת, ייווצר קישור הצטרפות.
              </p>

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
              disabled={submitting || !email.trim() || (!shareAll && selectedVehicleIds.length === 0)}
              className="w-full h-12 rounded-2xl font-bold text-base gap-2"
              style={{ background: C.grad, color: 'white', opacity: (!email.trim() || (!shareAll && selectedVehicleIds.length === 0)) ? 0.5 : 1 }}>
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                <>
                  <UserPlus className="h-5 w-5" />
                  שליחת הזמנה
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {result.recipient_existing_user ? (
              <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: '#E8F5E9', border: '1.5px solid #A5D6A7' }}>
                <Check className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#2E7D32' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: '#1B5E20' }}>
                    {result.recipient_name
                      ? <>ההזמנה נשלחה ל־<strong>{result.recipient_name}</strong></>
                      : 'ההזמנה נשלחה'}
                  </p>
                  <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#2E7D32' }}>
                    ההתראה תופיע בפעמון שלו באפליקציה. ההזמנה ממתינה לאישור.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: '#FFF8E1', border: '1.5px solid #FDE68A' }}>
                <UserPlus className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#B45309' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: '#92400E' }}>המייל הזה לא רשום אצלנו עדיין</p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: '#B45309' }}>
                    שלחנו מייל עם קישור הצטרפות. <strong>הוא יצטרך להירשם תחילה</strong> (עם אותה כתובת מייל). אחרי ההרשמה ההזמנה תחכה לו.
                  </p>
                  <p className="text-[11px] mt-1.5" style={{ color: '#B45309' }}>
                    אפשר גם לשתף את הקישור ב־WhatsApp או להעתיק כדי לזרז.
                  </p>
                </div>
              </div>
            )}

            {!result.recipient_existing_user && (
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

                <Button onClick={openWhatsApp} variant="outline" className="w-full rounded-2xl h-12 gap-2 text-sm font-bold"
                  style={{ color: '#25D366', borderColor: '#25D36640' }}>
                  <WhatsAppIcon size={18} />
                  שתף ב־WhatsApp
                </Button>

                {(isNative || typeof navigator.share === 'function') && (
                  <Button onClick={shareNative} variant="outline" className="w-full rounded-2xl h-12 gap-2 text-sm font-bold">
                    <Share2 className="h-5 w-5" />
                    שתף באפליקציה אחרת
                  </Button>
                )}
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

async function sendInviteEmail(toEmail, inviteToken) {
  if (!toEmail || !inviteToken) return;
  try {
    const { sendEmail, sendTemplatedEmail } = await import('@/lib/sendEmail');
    const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_APP_URL || 'https://car-reminder.app';
    const link = `${PUBLIC_DOMAIN}/JoinInvite?token=${inviteToken}&type=account`;
    try {
      await sendTemplatedEmail('invite', {
        to: toEmail,
        vars: { inviterName: 'משתמש CarReminder', roleLabel: 'חבר', inviteLink: link },
      });
    } catch (e) {
      if (e.name === 'EmailsPausedError') throw e;
      const { buildInviteEmail, buildInviteText } = await import('@/lib/emailTemplates');
      const subject = 'הוזמנת להצטרף לחשבון ב-CarReminder';
      const html = buildInviteEmail({ inviterName: 'משתמש', roleLabel: 'חבר', inviteLink: link });
      const text = buildInviteText({ inviterName: 'משתמש', roleLabel: 'חבר', inviteLink: link });
      await sendEmail({ to: toEmail, subject, html, text, notificationKey: 'invite' });
    }
  } catch { /* best-effort */ }
}

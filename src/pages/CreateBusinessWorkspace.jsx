/**
 * Create Business Workspace — admin-approval REQUEST flow.
 *
 * Every business account now goes through an admin-reviewed request (the old
 * "first one is free" self-create path was removed). The page:
 *   - shows what a business account gives you (benefits block),
 *   - collects company name, contact phone (required), approximate vehicle &
 *     user counts (ranges), optional ח.פ./email, and free-text notes,
 *   - submits via request_business_workspace (status=pending). An admin
 *     Telegram alert fires server-side (admin_alerts pipeline).
 *   - pending → shows the pending state; denied → shows the denial note and
 *     lets the user submit again.
 *
 * Server-side, create_business_workspace is (at the coordinated production
 * promotion) blocked for non-admins, so the request flow is the only path.
 */
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase, Loader2, ArrowRight, Clock, AlertTriangle,
  Truck, Users, Map, NotebookPen,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createPageUrl } from '@/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import useUserProfile from '@/hooks/useUserProfile';
// Living Dashboard system - shared with all B2B pages.
import { PageShell, Card } from '@/components/business/system';
import { C } from '@/lib/designTokens';

const MAX_NAME = 120;
const VEHICLE_RANGES = ['1-5', '6-20', '21-50', '50+'];
const USER_RANGES    = ['1-3', '4-10', '11-25', '25+'];

// What a business account unlocks — grounded in the real B2B pages
// (Fleet/BusinessDashboard, Drivers/Team, Routes/FleetMap, DrivingLog).
const BENEFITS = [
  { Icon: Truck,       t: 'ניהול צי מרוכז', d: 'כל רכבי החברה במסך אחד, עם דשבורד ו-KPIs.' },
  { Icon: Users,       t: 'נהגים וצוות',     d: 'הוספת עובדים, שיוך רכבים והרשאות.' },
  { Icon: Map,         t: 'משימות ומפה',     d: 'תכנון משימות, שיוך לנהגים ומעקב גיאוגרפי.' },
  { Icon: NotebookPen, t: 'יומן נסיעות',     d: 'מי נהג, איפה ומתי — תיעוד מלא.' },
];

const fmtDate = (d) => d ? new Date(d).toLocaleString('he-IL', { hour12: false }) : '';

// Lenient Israeli phone check: 9-10 digits after stripping separators.
function phoneDigits(v) { return String(v || '').replace(/\D/g, ''); }
function isValidPhone(v) { const d = phoneDigits(v); return d.length >= 9 && d.length <= 10; }

export default function CreateBusinessWorkspace() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { switchTo } = useWorkspace();
  const prevStatusRef = useRef();

  // Latest request from this user (RLS scopes to own rows). Polls every 15s
  // so a user waiting on the pending screen sees the approval the moment it
  // lands (and the effect below auto-switches into the new workspace).
  const { data: latestRequest, isLoading: requestLoading } = useQuery({
    queryKey: ['my-latest-business-request', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_workspace_requests')
        .select('*')
        .eq('requesting_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && isAuthenticated,
    staleTime: 30 * 1000,
    refetchInterval: 15 * 1000,
  });

  // When the request the user is WAITING on flips pending → approved, open the
  // new business workspace for them (switch + navigate). Guarded on the
  // pending→approved transition so an old approved request on a later visit
  // doesn't yank an unrelated session into the workspace.
  useEffect(() => {
    const st = latestRequest?.status;
    const prev = prevStatusRef.current;
    prevStatusRef.current = st;
    if (prev === 'pending' && st === 'approved' && latestRequest?.created_account_id) {
      (async () => {
        try {
          await queryClient.invalidateQueries({ queryKey: ['user-workspaces'] });
          await new Promise((r) => setTimeout(r, 50));
          await switchTo(latestRequest.created_account_id);
          toast.success('החשבון העסקי אושר ונפתח! 🎉');
          navigate(createPageUrl('Vehicles'));
        } catch {
          toast.success('החשבון העסקי אושר! רענן/י את הדף כדי להיכנס.');
        }
      })();
    }
  }, [latestRequest?.status, latestRequest?.created_account_id, queryClient, switchTo, navigate]);

  // Every business account now goes through an admin-approved request —
  // there is no self-service "free create" path anymore.
  const mode = useMemo(() => {
    if (requestLoading) return 'loading';
    if (latestRequest?.status === 'pending') return 'pending';
    if (latestRequest?.status === 'denied')  return 'request_after_denial';
    return 'request';
  }, [latestRequest, requestLoading]);

  if (authLoading || mode === 'loading') {
    return (
      <div dir="rtl" className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-[#2D5233]" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div dir="rtl" className="max-w-md mx-auto py-16 text-center">
        <p className="text-sm text-gray-600">צריך להיות מחובר כדי לבקש חשבון עסקי.</p>
      </div>
    );
  }

  if (mode === 'pending') {
    return <PendingState request={latestRequest} />;
  }

  return (
    <RequestForm
      mode={mode}
      latestRequest={latestRequest}
      onRequested={async () => {
        await queryClient.invalidateQueries({ queryKey: ['my-latest-business-request'] });
        toast.success('הבקשה נשלחה לאדמין. נעדכן אותך כשתאושר.');
      }}
    />
  );
}

// ----------------------------------------------------------------------

function RequestForm({ mode, latestRequest, onRequested }) {
  const { profile } = useUserProfile();
  const [name, setName]               = useState('');
  const [phone, setPhone]             = useState('');
  const [vehiclesRange, setVehicles]  = useState('');
  const [usersRange, setUsersRange]   = useState('');
  const [businessId, setBusinessId]   = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [notes, setNotes]             = useState('');
  const [submitting, setSubmitting]   = useState(false);

  // Prefill the phone from the saved profile (only while the user hasn't
  // typed their own). If the profile has none, the field stays required.
  useEffect(() => {
    if (profile?.phone) setPhone((cur) => cur || profile.phone);
  }, [profile?.phone]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      toastError('יש להזין שם לחברה / לעסק', { action: 'biz_req_name_required' });
      return;
    }
    if (cleanName.length > MAX_NAME) {
      toastError(`השם ארוך מדי. מקסימום ${MAX_NAME} תווים.`, { action: 'biz_req_name_too_long' });
      return;
    }
    if (!isValidPhone(phone)) {
      toastError('יש להזין מספר טלפון תקין ליצירת קשר', { action: 'biz_req_phone_invalid' });
      return;
    }
    if (!vehiclesRange) {
      toastError('בחר/י כמה רכבים בערך', { action: 'biz_req_vehicles_required' });
      return;
    }
    if (!usersRange) {
      toastError('בחר/י כמה משתמשים בערך', { action: 'biz_req_users_required' });
      return;
    }

    setSubmitting(true);
    try {
      const meta = {
        phone:          phone.trim(),
        vehicles_range: vehiclesRange,
        users_range:    usersRange,
      };
      if (businessId.trim())   meta.business_id   = businessId.trim();
      if (contactEmail.trim()) meta.contact_email = contactEmail.trim();

      const { error } = await supabase.rpc('request_business_workspace', {
        p_name:          cleanName,
        p_business_meta: meta,
        p_reason:        notes.trim() || null,
      });
      if (error) throw error;
      onRequested?.();
    } catch (err) {
      const code = err?.message || err?.code || '';
      if      (code.includes('name_required'))         toastError('שם החברה חובה', { action: 'biz_req_name_required_srv', err });
      else if (code.includes('name_too_long'))         toastError(`שם ארוך מדי (עד ${MAX_NAME} תווים)`, { action: 'biz_req_name_too_long_srv', err });
      else if (code.includes('not_authenticated'))     toastError('פג תוקף ההתחברות. התחבר מחדש ונסה שוב.', { action: 'biz_req_auth_expired', err });
      else if (code.includes('pending_request_exists')) toastError('כבר יש לך בקשה ממתינה. אי אפשר להגיש שתיים בו זמנית.', { action: 'biz_req_pending', err });
      else                                             toastError('שליחת הבקשה נכשלה. נסה שוב, או פנה לתמיכה.', { action: 'biz_req_save', err });
      console.error('request business workspace failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell
      title="פתיחת חשבון עסקי"
      subtitle="לניהול צי רכבים של חברה או עסק. הפתיחה דורשת אישור צוות."
    >
      {/* Identity hero — amber "needs approval" tone. */}
      <Card accent="amber" className="mb-4">
        <div className="flex items-center gap-3">
          <div
            className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${C.warnDark} 0%, ${C.warnIcon} 80%, #FCD34D 100%)`,
              color: '#FFFFFF',
              boxShadow: '0 8px 20px rgba(245,158,11,0.32)',
            }}
          >
            <Briefcase className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-[11px] font-bold inline-flex items-center gap-1 px-2 py-0.5 rounded-md"
              style={{ background: C.warnSubtle, color: C.warnDark }}
            >
              דורש אישור צוות
            </p>
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: C.textAlt }}>
              מילוי קצר ונחזור אליך אחרי אישור. הרכבים האישיים שלך נשארים פרטיים.
            </p>
          </div>
        </div>
      </Card>

      {mode === 'request_after_denial' && latestRequest && (
        <DeniedBanner request={latestRequest} />
      )}

      {/* Benefits — what a business account unlocks. */}
      <Card className="mb-4">
        <p className="text-[11px] font-bold mb-3 flex items-center gap-2" style={{ color: C.primaryDark }}>
          <span className="inline-block w-1 h-3.5 rounded-full"
            style={{ background: `linear-gradient(180deg, ${C.successDark} 0%, ${C.successMid} 100%)` }} />
          מה מקבלים בחשבון עסקי
        </p>
        <div className="space-y-2">
          {BENEFITS.map(({ Icon, t, d }) => (
            <div key={t} className="flex items-start gap-3 p-2.5 rounded-xl"
              style={{ background: '#FAFCF9', borderInlineStart: `3px solid ${C.primary}` }}>
              <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: C.successLight, color: C.successDark }}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold" style={{ color: C.primaryDark }}>{t}</p>
                <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: '#5A6B5D' }}>{d}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Request form */}
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="שם החברה / העסק" required>
            <Input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="לדוגמה: הובלות כהן בע&quot;מ"
              maxLength={MAX_NAME}
              className="h-11 rounded-xl"
              style={{ background: '#FFFFFF', borderColor: C.successLight }}
              required
            />
          </Field>

          <Field label="טלפון ליצירת קשר" required hint="מילאנו מהפרופיל שלך אם קיים. אם אין — חובה להזין.">
            <Input
              type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="050-1234567"
              className="h-11 rounded-xl"
              style={{ background: '#FFFFFF', borderColor: C.successLight }}
              dir="ltr"
              required
            />
          </Field>

          <Field label="כמה רכבים בערך?" required>
            <ChipRow options={VEHICLE_RANGES} value={vehiclesRange} onChange={setVehicles} />
          </Field>

          <Field label="כמה משתמשים (נהגים / עובדים)?" required>
            <ChipRow options={USER_RANGES} value={usersRange} onChange={setUsersRange} />
          </Field>

          {/* Optional identifiers — grouped so the form doesn't feel long. */}
          <div className="rounded-xl p-3 space-y-3" style={{ background: '#FCFEFB', border: `1px dashed ${C.border}` }}>
            <p className="text-[11px] font-bold" style={{ color: C.muted }}>פרטים נוספים (לא חובה)</p>
            <Field label="ח.פ. / מספר עוסק">
              <Input
                type="text" value={businessId} onChange={(e) => setBusinessId(e.target.value)}
                placeholder="לא חובה" className="h-11 rounded-xl"
                style={{ background: '#FFFFFF', borderColor: C.successLight }} dir="ltr"
              />
            </Field>
            <Field label="אימייל ליצירת קשר">
              <Input
                type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                placeholder="לא חובה" className="h-11 rounded-xl"
                style={{ background: '#FFFFFF', borderColor: C.successLight }} dir="ltr"
              />
            </Field>
          </div>

          <Field label="הערות">
            <Textarea
              value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder="ספר/י על הצורך — סוג הצי, תחום הפעילות, וכל מה שיעזור לנו לאשר מהר."
              className="rounded-xl"
              style={{ background: '#FFFFFF', borderColor: C.successLight }}
            />
          </Field>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.98] disabled:opacity-60"
            style={{
              background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
              color: '#FFFFFF',
              boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
            }}
          >
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> שולח...</>
              : <>שלח בקשה לאישור <ArrowRight className="h-4 w-4 rotate-180" /></>
            }
          </button>
          <p className="text-[10px] text-center" style={{ color: C.muted }}>נחזור אליך בטלפון או בהתראה.</p>
        </form>
      </Card>
    </PageShell>
  );
}

// ----------------------------------------------------------------------

function Field({ label, required, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-bold mb-1.5" style={{ color: C.primaryDark }}>
        {label} {required && <span style={{ color: C.error }}>*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] mt-1" style={{ color: C.muted }}>{hint}</p>}
    </div>
  );
}

function ChipRow({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const on = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className="flex-1 min-w-[64px] h-11 rounded-xl text-sm font-bold transition-all active:scale-[0.97]"
            style={on
              ? { background: C.light, border: `1.5px solid ${C.successBright}`, color: C.successDark }
              : { background: '#FFFFFF', border: `1.5px solid ${C.border}`, color: C.text }}
            dir="ltr"
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------

function PendingState({ request }) {
  return (
    <PageShell
      title="הבקשה ממתינה לאישור"
      subtitle="האדמין יעבור על הפרטים ויחזור אליך"
    >
      <Card accent="amber" className="mb-4 text-center">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
          style={{
            background: `linear-gradient(135deg, ${C.warnDark} 0%, ${C.warnIcon} 80%, #FCD34D 100%)`,
            color: '#FFFFFF',
            boxShadow: '0 8px 20px rgba(245,158,11,0.32)',
          }}
        >
          <Clock className="h-6 w-6" />
        </div>
        <p className="text-sm font-bold mb-1" style={{ color: C.primaryDark }}>הבקשה בדרך לאישור</p>
        <p className="text-[11px] leading-relaxed" style={{ color: C.textAlt }}>
          ברגע שהבקשה תאושר, החשבון העסקי החדש ייפתח אוטומטית ויופיע במחליף הסביבות.
        </p>
      </Card>

      <Card accent="emerald">
        <p
          className="text-[11px] font-bold mb-2 flex items-center gap-2"
          style={{ color: C.primaryDark }}
        >
          <span
            className="inline-block w-1 h-3.5 rounded-full"
            style={{ background: `linear-gradient(180deg, ${C.successDark} 0%, ${C.successMid} 100%)` }}
          />
          פרטי הבקשה
        </p>
        <Detail label="שם מבוקש" value={request.requested_name} />
        {request.business_meta?.phone && (
          <Detail label="טלפון" value={request.business_meta.phone} />
        )}
        {request.business_meta?.vehicles_range && (
          <Detail label="כמות רכבים" value={request.business_meta.vehicles_range} />
        )}
        {request.business_meta?.users_range && (
          <Detail label="כמות משתמשים" value={request.business_meta.users_range} />
        )}
        {request.business_meta?.business_id && (
          <Detail label="ח.פ." value={request.business_meta.business_id} />
        )}
        {request.business_meta?.contact_email && (
          <Detail label="אימייל ליצירת קשר" value={request.business_meta.contact_email} />
        )}
        {request.reason && <Detail label="הערות" value={request.reason} multiline />}
        <Detail label="הוגשה" value={fmtDate(request.created_at)} />
      </Card>
    </PageShell>
  );
}

function DeniedBanner({ request }) {
  return (
    <Card accent="red" className="mb-4" padding="px-3.5 py-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: C.errorDark }} />
        <div className="text-[11px] leading-relaxed flex-1" style={{ color: C.errorDark }}>
          <p className="font-bold mb-0.5">הבקשה הקודמת נדחתה</p>
          {request.review_note && <p className="mb-1">{request.review_note}</p>}
          <p className="text-[10px]" style={{ color: 'rgba(153,27,27,0.7)' }}>{fmtDate(request.reviewed_at)}</p>
        </div>
      </div>
    </Card>
  );
}

function Detail({ label, value, multiline }) {
  return (
    <div className="py-1.5 first:pt-0 last:pb-0" style={{ borderBottom: `1px solid ${C.bgSubtle}` }}>
      <p className="text-[10px] mb-0.5" style={{ color: C.mutedAlt }}>{label}</p>
      <p
        className={`text-xs font-bold ${multiline ? 'whitespace-pre-line' : 'truncate'}`}
        style={{ color: C.primaryDark }}
      >
        {value}
      </p>
    </div>
  );
}

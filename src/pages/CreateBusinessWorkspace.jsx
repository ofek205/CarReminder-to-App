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
  Truck, Users, Map, NotebookPen, Receipt, FileSpreadsheet, RefreshCw, Plus, X, HelpCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import { sendAccountInviteEmail } from '@/lib/inviteEmail';
import { useAuth } from '@/components/shared/GuestContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createPageUrl } from '@/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import useUserProfile from '@/hooks/useUserProfile';
// Living Dashboard system - shared with all B2B pages.
import { PageShell, Card } from '@/components/business/system';
import { C } from '@/lib/designTokens';
import { BUSINESS_WELCOME_FEATURES, BUSINESS_WELCOME_THEME } from '@/lib/businessWelcome';

const MAX_NAME = 120;
const VEHICLE_RANGES = ['1-5', '6-20', '21-50', '50+'];
const USER_RANGES    = ['1-3', '4-10', '11-25', '25+'];

// What a business account unlocks — grounded in the real B2B pages
// (Fleet/BusinessDashboard, Drivers/Team, Routes/FleetMap, DrivingLog).
// Consistent 3-tone palette: green = core value, teal = secondary,
// orange RESERVED for alerts/tasks (here: the map/tasks tile).
const TILE_GRADIENT = {
  green:  'linear-gradient(135deg,#047857,#10B981)',
  teal:   'linear-gradient(135deg,#0E7490,#22B8CF)',
  orange: 'linear-gradient(135deg,#C2710C,#F6A93B)',
};
const BENEFITS = [
  { Icon: Truck,           tone: 'green',  t: 'צי מאוחד',       d: 'כל הרכבים בדשבורד אחד' },
  { Icon: Users,           tone: 'teal',   t: 'צוות והרשאות',   d: 'נהגים, עובדים, שיוך רכבים' },
  { Icon: Map,             tone: 'orange', t: 'משימות על המפה', d: 'תכנון ומעקב גיאוגרפי' },
  { Icon: NotebookPen,     tone: 'teal',   t: 'יומן נסיעות',    d: 'מי נהג, איפה ומתי' },
  { Icon: Receipt,         tone: 'green',  t: 'הוצאות ודוחות',  d: 'מעקב לפי רכב, הפקת דוחות' },
  { Icon: FileSpreadsheet, tone: 'teal',   t: 'ייבוא מאקסל',    d: 'עדכון צי מקובץ קיים' },
];

const fmtDate = (d) => d ? new Date(d).toLocaleString('he-IL', { hour12: false }) : '';

// Lenient Israeli phone check: 9-10 digits after stripping separators.
function phoneDigits(v) { return String(v || '').replace(/\D/g, ''); }
function isValidPhone(v) { const d = phoneDigits(v); return d.length >= 9 && d.length <= 10; }

// Team members the requester can pre-attach to the business account. Roles
// match invite_account_member_by_email's whitelist; labels are the canonical
// account vocabulary (מנהל/צופה) + the driver operational layer.
const INVITEE_ROLES = [
  { value: 'מנהל',   label: 'מנהל' },
  { value: 'שותף',   label: 'צופה' },
  { value: 'driver', label: 'נהג' },
];
const inviteeRoleLabel = (r) => INVITEE_ROLES.find(o => o.value === r)?.label || r;

// Fire the pre-attached invites once the account exists (the requester is now
// its owner). Reuses the normal invite RPC: registered → pending + bell;
// unregistered → token + email. Best-effort per invitee — one bad row never
// blocks the others or the workspace entry.
async function autoInviteOnApproval(accountId, invitees) {
  if (!accountId || !Array.isArray(invitees) || invitees.length === 0) return;
  for (const inv of invitees) {
    const email = (inv?.email || '').trim();
    const role  = inv?.role;
    const nm    = (inv?.name || '').trim() || null;
    if (!email || !email.includes('@') || !['מנהל', 'שותף', 'driver'].includes(role)) continue;
    try {
      const { data, error } = await supabase.rpc('invite_account_member_by_email', {
        p_email: email, p_role: role, p_vehicle_ids: null, p_account_id: accountId, p_name: nm,
      });
      if (error) continue;  // already_member / transient — skip, keep going
      if (data && !data.recipient_existing_user && data.invite_token) {
        sendAccountInviteEmail(email, data.invite_token, inviteeRoleLabel(role)).catch(() => {});
      }
    } catch { /* best-effort per invitee */ }
  }
}

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
      const { data, error } = await withTimeout(supabase
        .from('business_workspace_requests')
        .select('*')
        .eq('requesting_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(), 'latest_business_request');
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
          // Fire the pre-attached team invites now that the account exists and
          // the requester is its owner. Best-effort — never blocks entry.
          await autoInviteOnApproval(latestRequest.created_account_id, latestRequest.business_meta?.invitees);
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
  const [invitees, setInvitees]       = useState([]);  // [{ email, role }]
  const [showHelp, setShowHelp]       = useState(false);
  const [sentOpen, setSentOpen]       = useState(false);
  // After a successful submit we celebrate with a premium "request sent +
  // here's what's coming" modal, THEN run onRequested (which flips the page to
  // its pending state) once the user dismisses it.
  const closeSent = () => { setSentOpen(false); onRequested?.(); };
  const addInvitee    = () => setInvitees((p) => [...p, { email: '', role: 'שותף', name: '' }]);
  const updateInvitee = (i, patch) => setInvitees((p) => p.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const removeInvitee = (i) => setInvitees((p) => p.filter((_, idx) => idx !== i));

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

      // Pre-attached team invitees ride inside business_meta; they are fired
      // automatically when the account is approved (autoInviteOnApproval).
      const seen = new Set();
      const cleanInvitees = [];
      for (const v of invitees) {
        const em = (v.email || '').trim().toLowerCase();
        if (!em || !em.includes('@') || seen.has(em)) continue;
        if (!['מנהל', 'שותף', 'driver'].includes(v.role)) continue;
        seen.add(em);
        cleanInvitees.push({ email: em, role: v.role, name: (v.name || '').trim() });
      }
      if (cleanInvitees.length) meta.invitees = cleanInvitees.slice(0, 25);

      const { error } = await supabase.rpc('request_business_workspace', {
        p_name:          cleanName,
        p_business_meta: meta,
        p_reason:        notes.trim() || null,
      });
      if (error) throw error;
      setSentOpen(true);
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

      {/* Value showcase — premium-SaaS feel. Soft green-tinted panel with
          white cards floating on it for depth; brand-framed header; a refined
          dark-green hero for the automatic-vehicle-data superpower; then a
          breathable 2-col grid. Friendly for private users, professional for
          fleets. Approved design (mockup v6). */}
      <div
        className="mb-4 rounded-3xl p-4 overflow-hidden"
        style={{ background: '#F6FAF7', border: `1px solid ${C.border}`, boxShadow: '0 2px 12px rgba(28,46,32,0.05)' }}
      >
        {/* Header — brand kicker + title + subtitle */}
        <span
          className="inline-flex items-center gap-1.5 text-[10.5px] font-bold px-2.5 py-1 rounded-full"
          style={{ background: '#E7F5EC', border: '1px solid #CDE9D7', color: C.successDark }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.successBright }} />
          CarReminder לעסק
        </span>
        <h3 className="text-[18px] font-extrabold mt-2" style={{ color: C.primaryDark, letterSpacing: '-0.01em' }}>
          ניהול צי חכם, במקום אחד
        </h3>
        <p className="text-[12.5px] mt-0.5" style={{ color: '#46564A' }}>פשוט לשימוש פרטי, מקצועי לצי שלם.</p>

        {/* Hero — automatic vehicle data (recalls / test / public MoT data) */}
        <div
          className="relative mt-3 mb-3 rounded-2xl p-3.5 flex items-center gap-3 text-white"
          style={{ background: 'linear-gradient(125deg,#1E3D28 0%,#2D5233 70%,#3C7A4D 100%)', boxShadow: '0 10px 24px -10px rgba(28,54,32,0.4)' }}
        >
          <span className="absolute top-2.5 left-3 text-[9.5px] font-bold flex items-center gap-1.5" style={{ color: '#D6FBE4' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> בלייב
          </span>
          <div
            className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}
          >
            <RefreshCw className="w-[22px] h-[22px]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-extrabold">עדכונים אוטומטיים על הרכב</p>
            <p className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.9)' }}>
              ריקולים, מועדי טסט ונתונים ממאגרי משרד התחבורה, אוטומטית.
            </p>
          </div>
        </div>

        {/* Breathable 2-col grid */}
        <div className="grid grid-cols-2 gap-3">
          {BENEFITS.map(({ Icon, tone, t, d }) => (
            <div
              key={t}
              className="bg-white rounded-2xl p-3.5"
              style={{ border: `1px solid ${C.border}`, boxShadow: '0 3px 12px rgba(45,82,51,0.06)' }}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 text-white"
                style={{ background: TILE_GRADIENT[tone] }}
              >
                <Icon className="w-[19px] h-[19px]" />
              </div>
              <p className="text-[13.5px] font-bold leading-tight" style={{ color: C.text }}>{t}</p>
              <p className="text-[11.5px] mt-1 leading-relaxed" style={{ color: '#46564A' }}>{d}</p>
            </div>
          ))}
        </div>
      </div>

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

          {/* Team invitees — optional. Stored in business_meta.invitees and
              fired automatically (invite → pending/bell, or link+email) the
              moment the account is approved and the requester enters it. */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="block text-xs font-bold" style={{ color: C.primaryDark }}>
                הזמנת אנשי צוות (לא חובה)
              </label>
              <button
                type="button"
                onClick={() => setShowHelp((h) => !h)}
                aria-label="איך זה עובד"
                aria-expanded={showHelp}
                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors"
                style={{ background: showHelp ? C.successLight : C.bgSubtle, color: C.successDark }}
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </div>

            {showHelp && (
              <div
                className="rounded-xl p-3 mb-2 text-[11px] leading-relaxed space-y-2"
                style={{ background: '#F6FAF7', border: `1px solid ${C.successLight}`, color: C.textAlt }}
              >
                <p>
                  <strong style={{ color: C.primaryDark }}>איך זה עובד?</strong>{' '}
                  הזן/י את המייל של מי שתרצה/י לשתף בחשבון. אם כבר יש לו משתמש אצלנו — תישלח אליו הזמנה,
                  וברגע שיאשר הוא יצורף לחשבון. אם עדיין אין לו משתמש — יישלח אליו מייל עם קישור לפתיחת
                  חשבון אצלנו, ואחרי שייפתח ויאשר, הוא יצורף.
                </p>
                <div>
                  <p className="font-bold mb-1" style={{ color: C.primaryDark }}>מה כל הרשאה נותנת:</p>
                  <ul className="space-y-1 pr-1">
                    <li><strong>מנהל</strong> — מוסיף ועורך רכבים, מסמכים ומשימות, ומזמין אנשי צוות. לא מוחק רכבים ולא מנהל בעלות.</li>
                    <li><strong>צופה</strong> — רואה את כל החשבון בקריאה בלבד, בלי אפשרות לערוך.</li>
                    <li><strong>נהג</strong> — רואה רק את הרכבים והמשימות שמשויכים אליו. שיוך הרכב נעשה אחרי פתיחת החשבון, במסך "נהגים".</li>
                  </ul>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {invitees.map((inv, i) => (
                <div
                  key={i}
                  className="rounded-xl p-2.5 space-y-2"
                  style={{ background: '#FFFFFF', border: `1px solid ${C.successLight}` }}
                >
                  <Input
                    type="text" dir="rtl"
                    value={inv.name || ''}
                    onChange={(e) => updateInvitee(i, { name: e.target.value })}
                    placeholder="שם (לא חובה)"
                    className="h-10 rounded-lg w-full"
                    style={{ background: '#FFFFFF', borderColor: C.successLight }}
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      type="email" inputMode="email" dir="ltr"
                      value={inv.email}
                      onChange={(e) => updateInvitee(i, { email: e.target.value })}
                      placeholder="name@example.com"
                      className="h-10 rounded-lg flex-1"
                      style={{ background: '#FFFFFF', borderColor: C.successLight }}
                    />
                    <button
                      type="button" onClick={() => removeInvitee(i)} aria-label="הסר איש צוות"
                      className="shrink-0 p-2 rounded-lg hover:bg-red-50 transition-colors"
                      style={{ color: C.error }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    {INVITEE_ROLES.map((r) => {
                      const on = inv.role === r.value;
                      return (
                        <button
                          key={r.value} type="button"
                          onClick={() => updateInvitee(i, { role: r.value })}
                          className="flex-1 h-9 rounded-lg text-xs font-bold border transition-all active:scale-[0.97]"
                          style={on
                            ? { background: C.light, borderColor: C.successBright, color: C.successDark }
                            : { background: '#FFFFFF', borderColor: C.border, color: C.text }}
                        >
                          {r.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button
                type="button" onClick={addInvitee}
                className="w-full h-10 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                style={{ background: '#F6FAF7', border: `1px dashed ${C.successLight}`, color: C.successDark }}
              >
                <Plus className="h-4 w-4" /> הוסף איש צוות
              </button>
            </div>
            <p className="text-[10px] mt-1.5" style={{ color: C.muted }}>
              יישלחו הזמנות אוטומטית כשהחשבון יאושר. תמיד אפשר להוסיף גם אחר כך ב"ניהול הצוות".
            </p>
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

      {/* Request-sent celebration — premium modal matching the welcome email.
          Shows on submit success; closing it runs onRequested (→ pending state). */}
      {sentOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(10,20,12,0.55)' }}
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-label="הבקשה נשלחה"
          onClick={closeSent}
        >
          <div
            className="w-full max-w-md rounded-3xl overflow-hidden bg-white shadow-2xl"
            style={{ maxHeight: '92vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-7 text-center" style={{ background: BUSINESS_WELCOME_THEME.heroBg, color: '#fff' }}>
              <div className="text-[11px] font-bold" style={{ color: BUSINESS_WELCOME_THEME.goldSoft, letterSpacing: '.2em' }}>בקשה התקבלה</div>
              <h2 className="text-2xl font-extrabold mt-2">בקשתך בדרך! 🎉</h2>
              <p className="text-sm mt-1.5" style={{ color: 'rgba(255,255,255,0.85)' }}>
                <span style={{ color: BUSINESS_WELCOME_THEME.goldSoft, fontWeight: 700 }}>ממכונית ועד גנרטור.</span> נבדוק ונאשר בקרוב, והנה מה שמחכה לך:
              </p>
            </div>
            <div className="px-5 pt-2 pb-5">
              {BUSINESS_WELCOME_FEATURES.map(([title, desc], i) => (
                <div
                  key={i}
                  className="flex gap-3 py-3"
                  style={{ borderBottom: i < BUSINESS_WELCOME_FEATURES.length - 1 ? `1px solid ${BUSINESS_WELCOME_THEME.hairline}` : 'none' }}
                >
                  <div className="shrink-0 w-8 text-2xl font-extrabold leading-none" dir="ltr" style={{ color: BUSINESS_WELCOME_THEME.gold }}>
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[15px]" style={{ color: BUSINESS_WELCOME_THEME.title }}>{title}</div>
                    <div className="text-xs leading-relaxed mt-0.5" style={{ color: BUSINESS_WELCOME_THEME.body }}>{desc}</div>
                  </div>
                </div>
              ))}
              <button
                onClick={closeSent}
                className="w-full h-12 rounded-2xl font-bold text-sm mt-4 transition-all active:scale-[0.98]"
                style={{ background: BUSINESS_WELCOME_THEME.cta, color: '#fff' }}
              >
                מצוין, הבנתי
              </button>
            </div>
          </div>
        </div>
      )}
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
        {Array.isArray(request.business_meta?.invitees) && request.business_meta.invitees.length > 0 && (
          <Detail
            label="אנשי צוות שיוזמנו עם האישור"
            multiline
            value={request.business_meta.invitees.map(v => `${v.name ? v.name + ' · ' : ''}${v.email} · ${inviteeRoleLabel(v.role)}`).join('\n')}
          />
        )}
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

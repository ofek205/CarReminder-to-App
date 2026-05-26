/**
 * Phase 9, Step 3.5 — Create Business Workspace, with admin-approval gate.
 *
 * Behavior:
 *   - User has 0 self-created business workspaces → regular create form
 *     (calls create_business_workspace, becomes owner immediately).
 *   - User has 1+ → must submit a request that an admin reviews. The
 *     form looks similar but adds a "reason" field, and submission
 *     calls request_business_workspace instead.
 *   - User has a pending request → page shows the pending state,
 *     form is hidden until the request is resolved.
 *   - User's last request was denied → shows the denial note + lets
 *     them submit a new request.
 *
 * The 1-per-user limit is also enforced server-side by the RPC; the
 * frontend mirroring is just UX. Admins bypass the limit at both
 * layers.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase, Loader2, ArrowRight, Clock, AlertTriangle, ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createPageUrl } from '@/utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
// Living Dashboard system - shared with all B2B pages.
import { PageShell, Card } from '@/components/business/system';
import { C } from '@/lib/designTokens';

const MAX_NAME = 120;

const fmtDate = (d) => d ? new Date(d).toLocaleString('he-IL', { hour12: false }) : '';

export default function CreateBusinessWorkspace() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { switchTo } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // How many business workspaces did this user self-create?
  const { data: selfCount = 0, isLoading: countLoading } = useQuery({
    queryKey: ['self-created-business-count', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('user_self_created_business_count', {
        p_user_id: user.id,
      });
      if (error) throw error;
      return Number(data) || 0;
    },
    enabled: !!user?.id && isAuthenticated,
    staleTime: 30 * 1000,
  });

  // Latest request from this user (RLS scopes to own rows).
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
  });

  const mode = useMemo(() => {
    if (countLoading || requestLoading) return 'loading';
    if (selfCount < 1) return 'free_create';
    if (latestRequest?.status === 'pending') return 'pending';
    if (latestRequest?.status === 'denied')  return 'request_after_denial';
    return 'request';
  }, [selfCount, latestRequest, countLoading, requestLoading]);

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
        <p className="text-sm text-gray-600">צריך להיות מחובר כדי ליצור חשבון עסקי.</p>
      </div>
    );
  }

  if (mode === 'pending') {
    return <PendingState request={latestRequest} />;
  }

  return (
    <CreateOrRequestForm
      mode={mode}
      latestRequest={latestRequest}
      onCreated={async (newAccountId) => {
        await queryClient.invalidateQueries({ queryKey: ['user-workspaces'] });
        await new Promise(r => setTimeout(r, 50));
        const ok = await switchTo(newAccountId);
        if (!ok) {
          await queryClient.invalidateQueries({ queryKey: ['user-workspaces'] });
          await new Promise(r => setTimeout(r, 200));
          await switchTo(newAccountId);
        }
        toast.success('החשבון העסקי נוצר. עברנו אליו אוטומטית.');
        navigate(createPageUrl('Vehicles'));
      }}
      onRequested={async () => {
        await queryClient.invalidateQueries({ queryKey: ['my-latest-business-request'] });
        toast.success('הבקשה נשלחה לאדמין. נעדכן אותך כשתאושר.');
      }}
    />
  );
}

// ----------------------------------------------------------------------

function CreateOrRequestForm({ mode, latestRequest, onCreated, onRequested }) {
  const isRequest = mode === 'request' || mode === 'request_after_denial';
  const [name, setName]             = useState('');
  const [businessId, setBusinessId] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [reason, setReason]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      toastError('יש להזין שם לחשבון העסקי', { action: 'create_workspace_name_required' });
      return;
    }
    if (cleanName.length > MAX_NAME) {
      toastError(`השם ארוך מדי. מקסימום ${MAX_NAME} תווים.`, { action: 'create_workspace_name_too_long' });
      return;
    }
    if (isRequest && !reason.trim()) {
      toastError('יש להזין סיבה לבקשה. האדמין צריך הקשר כדי לאשר', { action: 'create_workspace_reason_required' });
      return;
    }

    setSubmitting(true);
    try {
      const businessMeta = {};
      if (businessId.trim())   businessMeta.business_id   = businessId.trim();
      if (contactEmail.trim()) businessMeta.contact_email = contactEmail.trim();
      const meta = Object.keys(businessMeta).length ? businessMeta : null;

      if (isRequest) {
        const { error } = await supabase.rpc('request_business_workspace', {
          p_name:          cleanName,
          p_business_meta: meta,
          p_reason:        reason.trim(),
        });
        if (error) throw error;
        onRequested?.();
      } else {
        const { data: newAccountId, error } = await supabase.rpc('create_business_workspace', {
          p_name: cleanName,
          p_business_meta: meta,
        });
        if (error) throw error;
        if (!newAccountId) throw new Error('no_id_returned');
        onCreated?.(newAccountId);
      }
    } catch (err) {
      const code = err?.message || err?.code || '';
      if      (code.includes('name_required'))               toastError('שם החשבון העסקי חובה', { action: 'create_workspace_name_required_srv', err });
      else if (code.includes('name_too_long'))               toastError(`שם ארוך מדי (עד ${MAX_NAME} תווים)`, { action: 'create_workspace_name_too_long_srv', err });
      else if (code.includes('not_authenticated'))           toastError('פג תוקף ההתחברות. התחבר מחדש ונסה שוב.', { action: 'create_workspace_auth_expired', err });
      else if (code.includes('business_workspace_limit_reached')) toastError('כבר יש לך חשבון עסקי. רענן את הדף ותקבל את טופס הבקשה.', { action: 'create_workspace_limit_reached', err });
      else if (code.includes('no_existing_business_workspace'))   toastError('עוד אין לך חשבון עסקי. השתמש בטופס הרגיל.', { action: 'create_workspace_no_existing', err });
      else if (code.includes('pending_request_exists'))           toastError('כבר יש לך בקשה ממתינה. אי אפשר להגיש שתיים בו זמנית.', { action: 'create_workspace_pending', err });
      else                                                         toastError('הפעולה נכשלה. נסה שוב, או פנה לתמיכה.', { action: 'create_workspace_save', err });
       
      console.error('CreateBusinessWorkspace failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell
      title={isRequest ? 'בקשת חשבון עסקי נוסף' : 'חשבון עסקי חדש'}
      subtitle={isRequest
        ? 'כבר יש לך חשבון עסקי. בקשה לחשבון נוסף דורשת אישור אדמין.'
        : 'לניהול צי רכבים של חברה או עסק'}
    >
      {/* Identity hero — same family as BusinessSettings's hero. The
          left avatar tone shifts amber when this is a request flow,
          emerald when it's a free-create. */}
      <Card accent={isRequest ? 'amber' : 'emerald'} className="mb-4">
        <div className="flex items-center gap-3">
          <div
            className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
            style={isRequest
              ? {
                  background: `linear-gradient(135deg, ${C.warnDark} 0%, ${C.warnIcon} 80%, #FCD34D 100%)`,
                  color: '#FFFFFF',
                  boxShadow: '0 8px 20px rgba(245,158,11,0.32)',
                }
              : {
                  background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
                  color: '#FFFFFF',
                  boxShadow: '0 8px 20px rgba(16,185,129,0.32)',
                }}
          >
            {isRequest ? <ShieldAlert className="h-6 w-6" /> : <Briefcase className="h-6 w-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-[11px] font-bold inline-flex items-center gap-1 px-2 py-0.5 rounded-md"
              style={isRequest
                ? { background: C.warnSubtle, color: C.warnDark }
                : { background: C.successLight, color: C.successDark }}
            >
              {isRequest ? 'דורש אישור' : 'יצירה מיידית'}
            </p>
            <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: C.textAlt }}>
              {isRequest
                ? 'מילוי טופס וקבלת תשובה מהאדמין תוך זמן קצר.'
                : 'תיווצר סביבת עבודה נפרדת. הרכבים האישיים שלך נשארים פרטיים.'}
            </p>
          </div>
        </div>
      </Card>

      {mode === 'request_after_denial' && latestRequest && (
        <DeniedBanner request={latestRequest} />
      )}

      {isRequest && (
        <Card accent="amber" className="mb-4" padding="px-3.5 py-2.5">
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 shrink-0 mt-0.5" style={{ color: C.warnDark }} />
            <div className="text-[11px] leading-relaxed" style={{ color: C.warnDark }}>
              הבקשה תישלח לבדיקת אדמין. מומלץ לפרט את הסיבה ואת התפקיד של החשבון השני (סניף נוסף, פעילות נפרדת, וכד׳).
            </div>
          </div>
        </Card>
      )}

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: C.primaryDark }}>
              שם החשבון העסקי <span style={{ color: C.error }}>*</span>
            </label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="לדוגמה: יצור פלסטיק בע&quot;מ"
              maxLength={MAX_NAME}
              className="h-11 rounded-xl"
              style={{ background: '#FFFFFF', borderColor: C.successLight }}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: C.primaryDark }}>
              ח.פ. / מספר עוסק
            </label>
            <Input
              type="text"
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
              placeholder="לא חובה"
              className="h-11 rounded-xl"
              style={{ background: '#FFFFFF', borderColor: C.successLight }}
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1.5" style={{ color: C.primaryDark }}>
              אימייל ליצירת קשר
            </label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="לא חובה"
              className="h-11 rounded-xl"
              style={{ background: '#FFFFFF', borderColor: C.successLight }}
              dir="ltr"
            />
          </div>

          {isRequest && (
            <div>
              <label className="block text-xs font-bold mb-1.5" style={{ color: C.primaryDark }}>
                סיבת הבקשה <span style={{ color: C.error }}>*</span>
              </label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="לדוגמה: סניף שני בעיר אחרת, פעילות נפרדת לחברת בת, או צרכים אחרים"
                className="rounded-xl"
                style={{ background: '#FFFFFF', borderColor: C.successLight }}
                required
              />
            </div>
          )}

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
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {isRequest ? 'שולח...' : 'יוצר...'}</>
              : <>{isRequest ? 'שלח בקשה לאישור' : 'צור חשבון עסקי'} <ArrowRight className="h-4 w-4 rotate-180" /></>
            }
          </button>
        </form>
      </Card>
    </PageShell>
  );
}

// ----------------------------------------------------------------------

function PendingState({ request }) {
  return (
    <PageShell
      title="הבקשה ממתינה לאישור"
      subtitle="האדמין יעבור על הפרטים ויחזור אליך"
    >
      {/* Pending hero — soft amber bath, gentle clock animation hinting
          that something is in motion behind the scenes. */}
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
        {request.business_meta?.business_id && (
          <Detail label="ח.פ." value={request.business_meta.business_id} />
        )}
        {request.business_meta?.contact_email && (
          <Detail label="אימייל ליצירת קשר" value={request.business_meta.contact_email} />
        )}
        <Detail label="סיבה" value={request.reason || 'לא צוינה'} multiline />
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

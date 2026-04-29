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
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createPageUrl } from '@/utils';
import MobileBackButton from '@/components/shared/MobileBackButton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

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
      toast.error('יש להזין שם לחשבון העסקי');
      return;
    }
    if (cleanName.length > MAX_NAME) {
      toast.error(`השם ארוך מדי. מקסימום ${MAX_NAME} תווים.`);
      return;
    }
    if (isRequest && !reason.trim()) {
      toast.error('יש להזין סיבה לבקשה. האדמין צריך הקשר כדי לאשר');
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
      if      (code.includes('name_required'))               toast.error('שם החשבון העסקי חובה');
      else if (code.includes('name_too_long'))               toast.error(`שם ארוך מדי (עד ${MAX_NAME} תווים)`);
      else if (code.includes('not_authenticated'))           toast.error('פג תוקף ההתחברות. התחבר מחדש ונסה שוב.');
      else if (code.includes('business_workspace_limit_reached')) toast.error('כבר יש לך חשבון עסקי. רענן את הדף ותקבל את טופס הבקשה.');
      else if (code.includes('no_existing_business_workspace'))   toast.error('עוד אין לך חשבון עסקי. השתמש בטופס הרגיל.');
      else if (code.includes('pending_request_exists'))           toast.error('כבר יש לך בקשה ממתינה. אי אפשר להגיש שתיים בו זמנית.');
      else                                                         toast.error('הפעולה נכשלה. נסה שוב, או פנה לתמיכה.');
      // eslint-disable-next-line no-console
      console.error('CreateBusinessWorkspace failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div dir="rtl" className="max-w-md mx-auto py-6 px-2">
      <MobileBackButton />
      <div className="flex items-center gap-3 mb-5">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${isRequest ? 'bg-yellow-50' : 'bg-[#E8F2EA]'}`}>
          {isRequest
            ? <ShieldAlert className="h-5 w-5 text-yellow-700" />
            : <Briefcase  className="h-5 w-5 text-[#2D5233]" />}
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {isRequest ? 'בקשת חשבון עסקי נוסף' : 'חשבון עסקי חדש'}
          </h1>
          <p className="text-xs text-gray-500">
            {isRequest
              ? 'כבר יש לך חשבון עסקי. בקשה לחשבון נוסף דורשת אישור אדמין.'
              : 'לניהול צי רכבים של חברה או עסק'}
          </p>
        </div>
      </div>

      {mode === 'request_after_denial' && latestRequest && (
        <DeniedBanner request={latestRequest} />
      )}

      {isRequest && (
        <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 mb-4 flex items-start gap-2">
          <Clock className="h-4 w-4 text-yellow-700 shrink-0 mt-0.5" />
          <div className="text-[11px] text-yellow-900 leading-relaxed">
            הבקשה תישלח לבדיקת אדמין. מומלץ לפרט את הסיבה ואת התפקיד של החשבון השני (סניף נוסף, פעילות נפרדת, וכד׳).
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1.5">
            שם החשבון העסקי <span className="text-red-500">*</span>
          </label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמה: יצור פלסטיק בע&quot;מ"
            maxLength={MAX_NAME}
            className="h-11 rounded-xl"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1.5">
            ח.פ. / מספר עוסק
          </label>
          <Input
            type="text"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            placeholder="לא חובה"
            className="h-11 rounded-xl"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1.5">
            אימייל ליצירת קשר
          </label>
          <Input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="לא חובה"
            className="h-11 rounded-xl"
          />
        </div>

        {isRequest && (
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              סיבת הבקשה <span className="text-red-500">*</span>
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="לדוגמה: סניף שני בעיר אחרת, פעילות נפרדת לחברת בת, או צרכים אחרים"
              className="rounded-xl"
              required
            />
          </div>
        )}

        {!isRequest && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[11px] text-blue-900 leading-relaxed">
            תיווצר סביבת עבודה נפרדת לחלוטין. הרכבים האישיים שלך נשארים פרטיים. הם לא יופיעו בחשבון העסקי, ולהיפך.
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl font-bold text-sm bg-[#2D5233] text-white flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60"
        >
          {submitting
            ? <><Loader2 className="h-4 w-4 animate-spin" /> {isRequest ? 'שולח...' : 'יוצר...'}</>
            : <>{isRequest ? 'שלח בקשה לאישור' : 'צור חשבון עסקי'} <ArrowRight className="h-4 w-4 rotate-180" /></>
          }
        </button>
      </form>
    </div>
  );
}

// ----------------------------------------------------------------------

function PendingState({ request }) {
  return (
    <div dir="rtl" className="max-w-md mx-auto py-10 px-3">
      <MobileBackButton />
      <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-5 text-center">
        <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-3">
          <Clock className="h-6 w-6 text-yellow-700" />
        </div>
        <h1 className="text-lg font-bold text-yellow-900 mb-1">הבקשה ממתינה לאישור</h1>
        <p className="text-xs text-yellow-900/80 leading-relaxed">
          האדמין יעבור על הפרטים ויחזור אליך. ברגע שהבקשה תאושר, החשבון העסקי החדש ייפתח אוטומטית ויופיע במחליף הסביבות.
        </p>
      </div>

      <div className="mt-5 bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">פרטי הבקשה</p>
        <Detail label="שם מבוקש" value={request.requested_name} />
        {request.business_meta?.business_id && (
          <Detail label="ח.פ." value={request.business_meta.business_id} />
        )}
        {request.business_meta?.contact_email && (
          <Detail label="אימייל ליצירת קשר" value={request.business_meta.contact_email} />
        )}
        <Detail label="סיבה" value={request.reason || 'לא צוינה'} multiline />
        <Detail label="הוגשה" value={fmtDate(request.created_at)} />
      </div>
    </div>
  );
}

function DeniedBanner({ request }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
      <div className="text-[11px] text-red-900 leading-relaxed flex-1">
        <p className="font-bold mb-0.5">הבקשה הקודמת נדחתה</p>
        {request.review_note && <p className="mb-1">{request.review_note}</p>}
        <p className="text-[10px] text-red-900/70">{fmtDate(request.reviewed_at)}</p>
      </div>
    </div>
  );
}

function Detail({ label, value, multiline }) {
  return (
    <div className="py-1.5 border-b border-gray-50 last:border-0">
      <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
      <p className={`text-xs text-gray-900 ${multiline ? 'whitespace-pre-line' : 'truncate'}`}>{value}</p>
    </div>
  );
}

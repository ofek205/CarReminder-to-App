/**
 * Phase 9, Step 3.5b — Admin: business workspace approval queue.
 *
 * Lists every business_workspace_requests row (RLS allows admin to
 * read all). Admin can approve (which actually creates the new
 * workspace owned by the requester) or deny (with optional note).
 *
 * Server-side guards:
 *   - admin_list_business_workspace_requests checks is_admin()
 *   - approve_business_workspace_request / deny_business_workspace_request
 *     also check is_admin()
 * Frontend guard: useIsAdmin hook gates the entire page.
 */
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShieldAlert, CheckCircle2, XCircle, Loader2, Filter,
  Briefcase, Mail, Clock, X, AlertTriangle, Phone,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import useIsAdmin from '@/hooks/useIsAdmin';
import { BUSINESS_WELCOME_FEATURES } from '@/lib/businessWelcome';

const STATUS_META = {
  pending:  { label: 'ממתינה',   cls: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'אושרה',    cls: 'bg-green-100  text-green-800' },
  denied:   { label: 'נדחתה',    cls: 'bg-red-100    text-red-800' },
};
const statusMeta = (s) => STATUS_META[s] || { label: s, cls: 'bg-gray-100 text-gray-700' };

const fmtDate = (d) => d ? new Date(d).toLocaleString('he-IL', { hour12: false }) : '';

export default function AdminBusinessRequests() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('pending');
  const [resolving, setResolving]       = useState(null); // { request, mode: 'approve' | 'deny' }

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['admin-business-requests', statusFilter],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_business_workspace_requests', {
        p_status: statusFilter || null,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin === true,
    staleTime: 30 * 1000,
  });

  if (authLoading || isAdmin === null) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }

  if (!isAuthenticated || isAdmin !== true) {
    return (
      <div dir="rtl" className="max-w-md mx-auto py-16 text-center">
        <ShieldAlert className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-bold text-gray-700 mb-1">אין הרשאה</p>
        <p className="text-xs text-gray-500">דף זה זמין למנהלי מערכת בלבד.</p>
      </div>
    );
  }

  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">בקשות חשבון עסקי</h1>
        <p className="text-xs text-gray-500">אישור או דחייה של בקשות לפתיחת חשבונות עסקיים נוספים</p>
      </div>

      <div className="bg-gray-50 rounded-xl p-3 mb-4 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-[11px] font-bold text-gray-600 mr-1">
          <Filter className="h-3 w-3" /> סינון:
        </div>
        {[
          { value: 'pending',  label: 'ממתינות', count: pendingCount },
          { value: 'approved', label: 'אושרו' },
          { value: 'denied',   label: 'נדחו' },
          { value: '',         label: 'הכל' },
        ].map(opt => {
          const active = statusFilter === opt.value;
          return (
            <button
              key={opt.value || 'all'}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                active ? 'bg-[#2D5233] text-white' : 'bg-white border border-gray-200 text-gray-700'
              }`}
            >
              {opt.label}
              {opt.count != null && opt.count > 0 && (
                <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/20' : 'bg-gray-100'}`}>
                  {opt.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <p className="text-center text-xs text-gray-400 py-6">טוען בקשות...</p>
      ) : requests.length === 0 ? (
        <Empty
          icon={<CheckCircle2 className="h-10 w-10 text-gray-300" />}
          title="אין בקשות בסטטוס הזה"
          text={statusFilter === 'pending' ? 'כל הבקשות טופלו. תודה.' : 'אין רשומות תואמות לסינון הנוכחי.'}
          embedded
        />
      ) : (
        <ul className="space-y-2">
          {requests.map(r => (
            <RequestCard
              key={r.id}
              req={r}
              onApprove={() => setResolving({ request: r, mode: 'approve' })}
              onDeny={() => setResolving({ request: r, mode: 'deny' })}
            />
          ))}
        </ul>
      )}

      {resolving && (
        <ResolveDialog
          request={resolving.request}
          mode={resolving.mode}
          onClose={() => setResolving(null)}
          onResolved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['admin-business-requests'] });
            setResolving(null);
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------

function RequestCard({ req, onApprove, onDeny }) {
  const status = statusMeta(req.status);
  return (
    <li className="bg-white border border-gray-100 rounded-xl p-3">
      <div className="flex items-start gap-3 mb-2">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-yellow-50 flex items-center justify-center">
          <Briefcase className="h-4 w-4 text-yellow-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-bold text-gray-900 truncate">{req.requested_name}</p>
            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${status.cls}`}>
              {status.label}
            </span>
          </div>
          <p className="text-[11px] text-gray-700 truncate">
            <span className="font-bold">{req.display_name}</span>
            <span className="text-gray-400"> · </span>
            {req.email}
          </p>
          <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
            <Clock className="h-3 w-3" /> תאריך הגשה: {fmtDate(req.created_at)}
          </p>
        </div>
      </div>

      <div className="space-y-1.5 text-[11px] mt-2 pt-2 border-t border-gray-50">
        {req.business_meta?.phone && (
          <Detail label="טלפון" value={req.business_meta.phone} icon={<Phone className="h-3 w-3" />} />
        )}
        {req.business_meta?.vehicles_range && (
          <Detail label="כמות רכבים" value={req.business_meta.vehicles_range} />
        )}
        {req.business_meta?.users_range && (
          <Detail label="כמות משתמשים" value={req.business_meta.users_range} />
        )}
        {req.reason && (
          <Detail label="הערות" value={req.reason} multiline />
        )}
        {req.business_meta?.business_id && (
          <Detail label="ח.פ." value={req.business_meta.business_id} />
        )}
        {req.business_meta?.contact_email && (
          <Detail label="אימייל ליצירת קשר" value={req.business_meta.contact_email} icon={<Mail className="h-3 w-3" />} />
        )}
      </div>

      {req.status === 'pending' && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onApprove}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#2D5233] text-white text-xs font-bold active:scale-[0.98]"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> אשר ופתח חשבון
          </button>
          <button
            type="button"
            onClick={onDeny}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-red-200 text-red-700 text-xs font-bold active:scale-[0.98]"
          >
            <XCircle className="h-3.5 w-3.5" /> דחה
          </button>
        </div>
      )}

      {req.status !== 'pending' && req.review_note && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[10px] text-gray-400 mb-0.5">הערת אדמין</p>
          <p className="text-[11px] text-gray-700 whitespace-pre-line">{req.review_note}</p>
          {req.reviewed_at && (
            <p className="text-[10px] text-gray-400 mt-1">{fmtDate(req.reviewed_at)}</p>
          )}
        </div>
      )}
    </li>
  );
}

function Detail({ label, value, multiline, icon }) {
  return (
    <div>
      <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1">{icon}{label}</p>
      <p className={`text-xs text-gray-900 ${multiline ? 'whitespace-pre-line' : 'truncate'}`}>{value}</p>
    </div>
  );
}

// ----------------------------------------------------------------------

// Branded RTL "welcome to your business account" email. Sent once, when an
// admin approves a business-workspace request. Kept inline (one-off) rather
// than in the shared DB template registry. `name` is the business name from
// our own DB (not user-controlled HTML). No em-dashes per house style.
// Premium numbered-editorial layout (gold numbers on white). The feature list
// itself lives in @/lib/businessWelcome — shared with the request-sent modal
// in CreateBusinessWorkspace so the two never drift.
function buildApprovalEmail(name) {
  const safe = String(name || 'העסק שלך').slice(0, 120);
  const last = BUSINESS_WELCOME_FEATURES.length - 1;
  const rows = BUSINESS_WELCOME_FEATURES.map(([title, desc], i) => {
    const num = String(i + 1).padStart(2, '0');
    const border = i === last ? '' : 'border-bottom:1px solid #EEF1EE;';
    return `
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="${border}"><tr>
          <td style="width:46px;vertical-align:top;padding:15px 0 15px 14px">
            <div dir="ltr" style="font-size:26px;font-weight:bold;color:#B5872E;line-height:1">${num}</div>
          </td>
          <td style="vertical-align:top;padding:15px 0">
            <div style="font-weight:bold;color:#1C3620;font-size:16px;line-height:1.3">${title}</div>
            <div style="color:#4B5563;font-size:13px;line-height:1.65;margin-top:3px">${desc}</div>
          </td>
        </tr></table>`;
  }).join('');
  return `
  <div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;background:#F4F5F7;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;border:1px solid #E5EBE6">
      <div style="background:linear-gradient(135deg,#122A19,#1F3D26);padding:36px 26px;color:#fff;text-align:center">
        <div style="font-size:12.5px;font-weight:bold;letter-spacing:.02em;color:#D9B85C">CarReminder &middot; חשבון עסקי</div>
        <h1 style="margin:14px 0 8px;font-size:28px;line-height:1.2;color:#fff">כל הצי שלך, בשליטה אחת.</h1>
        <p style="margin:0;font-size:14px;line-height:1.6;color:rgba(255,255,255,.85)"><span style="color:#D9B85C;font-weight:bold">ממכונית ועד גנרטור.</span> החשבון של <b>${safe}</b> פעיל ומוכן.</p>
      </div>
      <div style="padding:8px 26px 26px">
        ${rows}
        <div style="text-align:center;margin:26px 0 6px;border-top:1px solid #EEF1EE;padding-top:24px">
          <a href="https://car-reminder.app" style="background:#2D5233;color:#fff;text-decoration:none;padding:15px 36px;border-radius:14px;font-weight:bold;font-size:16px;display:inline-block">כניסה לחשבון העסקי</a>
        </div>
        <p style="color:#6B7280;font-size:12px;margin:12px 0 0;text-align:center;line-height:1.7">אפשר לעבור לחשבון ממחליף הסביבות. צריך עזרה? אנחנו כאן ב-support@car-reminder.app</p>
      </div>
    </div>
  </div>`;
}

function ResolveDialog({ request, mode, onClose, onResolved }) {
  const isApprove = mode === 'approve';
  const [note, setNote]             = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!isApprove && !note.trim()) {
      toast.error('יש להזין סיבת דחייה. המבקש יראה אותה');
      return;
    }
    setSubmitting(true);
    try {
      if (isApprove) {
        const { error } = await supabase.rpc('approve_business_workspace_request', {
          p_request_id: request.id,
          p_review_note: note.trim() || null,
        });
        if (error) throw error;
        // Approval email to the requester. Best-effort — the in-app + push
        // notification (fired server-side by the RPC) is the reliable channel;
        // a failed email must never block or undo the approval.
        if (request.email) {
          supabase.functions.invoke('send-email', {
            body: {
              to: request.email,
              subject: 'ברוכים הבאים לחשבון העסקי ב-CarReminder 🎉',
              html: buildApprovalEmail(request.requested_name),
              notification_key: 'welcome_business',
            },
          }).catch(() => {});
        }
        toast.success(`החשבון "${request.requested_name}" נפתח עבור ${request.display_name}`);
      } else {
        const { error } = await supabase.rpc('deny_business_workspace_request', {
          p_request_id: request.id,
          p_review_note: note.trim(),
        });
        if (error) throw error;
        toast.success('הבקשה נדחתה. המבקש יראה את הסיבה.');
      }
      onResolved?.();
    } catch (err) {
      const msg = err?.message || '';
      if      (msg.includes('forbidden_not_admin'))    toast.error('אין לך הרשאת אדמין');
      else if (msg.includes('request_not_found'))      toast.error('הבקשה לא נמצאה');
      else if (msg.includes('request_already_resolved')) toast.error('הבקשה כבר טופלה. רענן את הדף');
      else                                               toast.error('הפעולה נכשלה. נסה שוב.');
       
      console.error('resolve request failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div dir="rtl" className="fixed inset-0 z-[10000] bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900">
            {isApprove ? 'אישור הבקשה' : 'דחיית הבקשה'}
          </h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          {isApprove
            ? `יווצר חשבון עסקי "${request.requested_name}" עבור ${request.display_name}.`
            : `הבקשה של ${request.display_name} תיסגר. ניתן יהיה להגיש בקשה חדשה.`}
        </p>

        {!isApprove && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-3 mb-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-900 leading-relaxed">
              ההסבר שתכתוב יוצג למבקש בדף יצירת חשבון עסקי. נסה להיות ענייני.
            </p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              {isApprove ? 'הערה (לא חובה)' : 'סיבת הדחייה'} {!isApprove && <span className="text-red-500">*</span>}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={isApprove ? 'אישרתי בעקבות פנייה בטלפון, וכד׳' : 'הסבר ענייני שהמבקש יראה'}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
              required={!isApprove}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={`w-full py-2.5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60 ${
              isApprove ? 'bg-[#2D5233]' : 'bg-red-600'
            }`}
          >
            {submitting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : isApprove
                ? <><CheckCircle2 className="h-4 w-4" /> אשר ופתח חשבון</>
                : <><XCircle className="h-4 w-4" /> דחה בקשה</>
            }
          </button>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------

function Empty({ icon, title, text, embedded }) {
  return (
    <div dir="rtl" className={embedded ? 'py-10' : 'max-w-md mx-auto py-16'}>
      <div className="text-center px-6">
        {icon && <div className="flex justify-center mb-3">{icon}</div>}
        {title && <p className="text-sm font-bold text-gray-700 mb-1">{title}</p>}
        <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

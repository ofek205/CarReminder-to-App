/**
 * AdminPlans — every account whose plan is NOT standard.
 *
 * Monetization phase 2b, §3.5.7. This is the screen that stops revenue
 * leaking, and the reason it matters is not granting but FORGETTING: a free
 * grant nobody revisits produces no alert anywhere, ever. So the list is
 * ordered by how soon each exception lapses, and the ones that never lapse
 * are called out rather than buried.
 *
 * ⚠️ An EXPIRED row is not a live leak. account_plan() evaluates expiry at
 * read time, so a lapsed grant is already being ignored by the server. It
 * shows here as stale bookkeeping to clean up, and the copy must not imply
 * the account is still getting something for free, which would send an
 * admin chasing a problem that does not exist.
 *
 * Server-side guards: every RPC checks is_admin() itself, and every write is
 * written to admin_audit_log. The useIsAdmin gate below is convenience, not
 * security.
 *
 * @see docs/plan-monetization-implementation.md §3.5
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShieldAlert, ShieldCheck, AlertTriangle, Clock, Infinity as InfinityIcon,
  Loader2, RotateCw, CheckCircle2, X, Car,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import { useAuth } from '@/components/shared/GuestContext';
import useIsAdmin from '@/hooks/useIsAdmin';
import {
  describeOverrides, exceptionUrgency, daysUntil, isOverCap, summarise,
} from '@/lib/planExceptions';

const URGENCY_BADGE = {
  never:   { label: 'ללא תפוגה', cls: 'bg-amber-100 text-amber-800',   Icon: InfinityIcon },
  soon:    { label: 'פג בקרוב',  cls: 'bg-orange-100 text-orange-800', Icon: Clock },
  expired: { label: 'פג',        cls: 'bg-gray-200 text-gray-600',     Icon: Clock },
  active:  { label: 'בתוקף',     cls: 'bg-green-100 text-green-800',   Icon: CheckCircle2 },
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('he-IL') : '');

export default function AdminPlans() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();

  // { row, mode: 'clear' | 'revoke' } — the note is mandatory server-side,
  // so the UI collects it rather than letting the RPC reject the call.
  const [acting, setActing] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-plan-exceptions'],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.rpc('admin_list_plan_exceptions', { p_limit: 500, p_offset: 0 }),
        'admin_plan_exceptions',
      );
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin === true,
    staleTime: 30 * 1000,
    retry: 1,
    retryDelay: 500,
  });

  // plan_limits is world-readable, and we need it to say "15 instead of 10".
  // Without the base plan an override is a number with no context.
  const { data: plans = [] } = useQuery({
    queryKey: ['plan-limits'],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.from('plan_limits').select('*').order('sort_order'),
        'plan_limits',
      );
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin === true,
    staleTime: 5 * 60 * 1000,
  });

  const planByCode = useMemo(
    () => Object.fromEntries(plans.map((p) => [p.plan, p])),
    [plans],
  );
  const stats = useMemo(() => summarise(rows), [rows]);

  const runAction = async () => {
    if (!acting || busy) return;
    if (!note.trim()) {
      toast.error('חייבת להיות סיבה כתובה. זה מה שיאפשר להצדיק את הפעולה בעוד שנה.');
      return;
    }
    setBusy(true);
    try {
      const fn = acting.mode === 'revoke' ? 'admin_revoke_plan' : 'admin_clear_account_overrides';
      const { error } = await withTimeout(
        supabase.rpc(fn, { p_account_id: acting.row.account_id, p_note: note.trim() }),
        fn,
      );
      if (error) throw error;
      toast.success(acting.mode === 'revoke' ? 'החשבון הוחזר למסלול החינמי' : 'החריגה בוטלה');
      setActing(null);
      setNote('');
      await qc.invalidateQueries({ queryKey: ['admin-plan-exceptions'] });
    } catch (e) {
      toast.error(e?.message || 'הפעולה נכשלה. נסה שוב.');
    } finally {
      setBusy(false);
    }
  };

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

  return (
    <div dir="rtl" className="max-w-4xl mx-auto py-2">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">מסלולים וחריגים</h1>
        <p className="text-xs text-gray-500">
          כל חשבון שמצבו אינו סטנדרטי: מענק אדמין או מגבלות מותאמות
        </p>
      </div>

      {/* Summary. "ללא תפוגה" leads, because that is the number that leaks. */}
      {!isLoading && !isError && rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {[
            { label: 'ללא תפוגה', value: stats.never,   cls: 'text-amber-700 bg-amber-50 border-amber-200' },
            { label: 'פג בקרוב',  value: stats.soon,    cls: 'text-orange-700 bg-orange-50 border-orange-200' },
            { label: 'מעל התקרה', value: stats.overCap, cls: 'text-red-700 bg-red-50 border-red-200' },
            { label: 'סך חריגים', value: stats.total,   cls: 'text-gray-700 bg-gray-50 border-gray-200' },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border p-3 ${s.cls}`}>
              <p className="text-2xl font-bold leading-none" dir="ltr">{s.value}</p>
              <p className="text-[11px] font-semibold mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {isError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <AlertTriangle className="h-6 w-6 text-red-500 mx-auto mb-2" />
          <p className="text-sm font-bold text-gray-800">לא הצלחנו לטעון את החריגים</p>
          <p className="text-xs text-gray-500 mt-1">
            לא נציג רשימה חלקית, כי רשימה חלקית נראית כמו „אין חריגים”.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 mt-3 px-3.5 h-11 rounded-xl bg-gray-900 text-white text-xs font-bold"
          >
            <RotateCw className="h-3.5 w-3.5" /> נסה שוב
          </button>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-gray-100 rounded-xl" style={{ height: 88 }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        /* The empty state is GOOD NEWS, and reads like it. Nothing is
           leaking and no grant has been forgotten. */
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <ShieldCheck className="h-8 w-8 text-green-600 mx-auto mb-2" />
          <p className="text-sm font-bold text-gray-800">אין חריגים</p>
          <p className="text-xs text-gray-600 mt-1">
            כל החשבונות על המסלולים הרגילים, בלי מענקים ובלי מגבלות מותאמות.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const urgency = exceptionUrgency(row);
            const badge = URGENCY_BADGE[urgency];
            const overrides = describeOverrides(row, planByCode[row.base_plan]);
            const days = daysUntil(row.ovr_expires_at);
            const overCap = isOverCap(row);

            return (
              <div key={row.account_id} className="bg-white border border-gray-200 rounded-xl p-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-gray-900">{row.account_name || '(ללא שם)'}</p>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {row.account_type === 'personal' ? 'אישי' : 'עסקי'}
                      </span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1 ${badge.cls}`}>
                        <badge.Icon className="h-2.5 w-2.5" />
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">
                      מסלול אפקטיבי:{' '}
                      <strong className="text-gray-700">{row.effective_plan}</strong>
                      {row.effective_plan !== row.base_plan && (
                        <span> (הרשום: {row.base_plan})</span>
                      )}
                      {' · '}
                      <span dir="ltr">{row.source}</span>
                    </p>
                  </div>

                  <div className="text-left shrink-0">
                    {urgency === 'never' ? (
                      <p className="text-[11px] font-bold text-amber-700">אין תאריך סיום</p>
                    ) : urgency === 'expired' ? (
                      /* Explicitly says the server already ignores it, so
                         nobody chases a leak that is not happening. */
                      <p className="text-[11px] text-gray-500">
                        פג ב-<span dir="ltr">{fmtDate(row.ovr_expires_at)}</span>
                        <br />
                        <span className="text-[10px]">כבר לא בתוקף</span>
                      </p>
                    ) : (
                      <p className="text-[11px] text-gray-600">
                        נותרו <strong dir="ltr">{days}</strong> ימים
                        <br />
                        <span className="text-[10px]" dir="ltr">{fmtDate(row.ovr_expires_at)}</span>
                      </p>
                    )}
                  </div>
                </div>

                {overrides.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {overrides.map((o) => (
                      <span key={o.label} className="text-[11px] bg-indigo-50 text-indigo-800 rounded-lg px-2 py-1">
                        {o.label}: <strong>{o.now}</strong>
                        {o.was !== null && <span className="text-indigo-500"> (במקום {o.was})</span>}
                      </span>
                    ))}
                  </div>
                )}

                {overCap && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-700">
                    <Car className="h-3 w-3 shrink-0" />
                    מחזיק <span dir="ltr">{row.vehicle_count}</span> כלי תחבורה מעל תקרה של{' '}
                    <span dir="ltr">{row.eff_max_vehicles}</span>. לא נמחק דבר, אך אין הוספה.
                  </div>
                )}

                <p className="text-[11px] text-gray-600 mt-2 bg-gray-50 rounded-lg px-2 py-1.5">
                  <span className="font-bold">סיבה: </span>{row.ovr_note || '(לא נרשמה)'}
                </p>

                <p className="text-[10px] text-gray-400 mt-1.5">
                  {row.granted_by_email ? <span dir="ltr">{row.granted_by_email}</span> : 'לא ידוע'}
                  {row.granted_at && <> · <span dir="ltr">{fmtDate(row.granted_at)}</span></>}
                </p>

                <div className="flex gap-2 mt-2.5">
                  {overrides.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setActing({ row, mode: 'clear' }); setNote(''); }}
                      className="h-11 px-3 rounded-xl border border-gray-300 text-xs font-bold text-gray-700"
                    >
                      בטל מגבלות מותאמות
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setActing({ row, mode: 'revoke' }); setNote(''); }}
                    className="h-11 px-3 rounded-xl border border-red-300 text-xs font-bold text-red-700"
                  >
                    החזר לחינם
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action confirm. The note field is required because the RPC rejects
          a blank one, and because a plan change nobody explained is one
          nobody can justify later. */}
      {acting && (
        <div className="fixed inset-0 z-[10005] flex items-end sm:items-center justify-center bg-black/40 p-3">
          <div dir="rtl" className="bg-white rounded-2xl w-full max-w-md p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold text-gray-900">
                {acting.mode === 'revoke' ? 'החזרה למסלול החינמי' : 'ביטול מגבלות מותאמות'}
              </p>
              <button type="button" onClick={() => setActing(null)} className="p-1 text-gray-400">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-gray-600 mt-1.5">
              {acting.row.account_name || '(ללא שם)'}
            </p>

            {/* ⚠️ §3.5.9: revoking here does NOT stop a real charge at the
                payment provider. Warn only when there actually is one, so
                the warning keeps its meaning. */}
            {acting.mode === 'revoke' && acting.row.source !== 'admin_grant' && (
              <div className="mt-2.5 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                <p className="text-[11px] font-bold text-amber-900">
                  למנוי הזה יש מקור חיוב חיצוני (<span dir="ltr">{acting.row.source}</span>)
                </p>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  הפעולה הזו משנה רק את ההרשאה אצלנו. <strong>החיוב אצל ספק התשלומים ימשיך</strong> עד שיבוטל שם בנפרד.
                </p>
              </div>
            )}

            <label className="block text-[11px] font-bold text-gray-700 mt-3 mb-1">
              סיבה (חובה)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="למשל: תום תקופת הפיילוט, הלקוח עבר לתשלום"
              className="w-full text-xs border border-gray-300 rounded-xl p-2 resize-none"
            />

            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={runAction}
                disabled={busy || !note.trim()}
                className="flex-1 h-12 rounded-xl bg-gray-900 text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                אישור
              </button>
              <button
                type="button"
                onClick={() => setActing(null)}
                disabled={busy}
                className="h-12 px-4 rounded-xl border border-gray-300 text-sm font-bold text-gray-700"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

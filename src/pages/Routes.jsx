/**
 * Phase 6 — Routes list page.
 *
 * Two views in one page (server-side RLS does the actual filtering):
 *   - Manager: sees all routes in active workspace.
 *   - Driver:  sees only routes whose assigned_driver_user_id is them.
 *
 * Private workspace users see an "available only in business workspace"
 * empty state — the page never crashes, but isn't useful outside B2B.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Briefcase, Calendar, Truck, ChevronLeft, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { createPageUrl } from '@/utils';

const STATUS_LABEL = {
  pending:     { label: 'מתוזמן',  cls: 'bg-gray-100  text-gray-700' },
  in_progress: { label: 'בביצוע',  cls: 'bg-blue-100  text-blue-700' },
  completed:   { label: 'הושלם',   cls: 'bg-green-100 text-green-700' },
  cancelled:   { label: 'בוטל',    cls: 'bg-red-100   text-red-700' },
};

export default function Routes() {
  const { isAuthenticated } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, canManageRoutes, canDriveRoutes, isLoading: roleLoading } = useWorkspaceRole();

  const { data: routes = [], isLoading } = useQuery({
    queryKey: ['routes', accountId],
    queryFn: async () => {
      // RLS already restricts visibility — we just SELECT *.
      // Joining vehicles for the display label.
      const { data, error } = await supabase
        .from('routes')
        .select('id, title, status, scheduled_for, vehicle_id, assigned_driver_user_id, created_at')
        .eq('account_id', accountId)
        .order('scheduled_for', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && isAuthenticated && isBusiness,
    staleTime: 60 * 1000,
  });

  if (!isAuthenticated) {
    return <EmptyShell text="צריך להתחבר כדי לראות מסלולים." />;
  }

  if (roleLoading) return <EmptyShell text="טוען..." />;

  if (!isBusiness) {
    return (
      <EmptyShell
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="ניהול מסלולים זמין בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש כדי להתחיל."
      />
    );
  }

  if (!canManageRoutes && !canDriveRoutes) {
    return (
      <EmptyShell
        icon={<AlertCircle className="h-10 w-10 text-gray-300" />}
        title="אין הרשאה למסלולים"
        text="פנה למנהל החשבון כדי לקבל גישה."
      />
    );
  }

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {canManageRoutes ? 'ניהול מסלולים' : 'המשימות שלי'}
          </h1>
          <p className="text-xs text-gray-500">
            {canManageRoutes ? 'תכנון, שיוך ומעקב אחרי מסלולי הצי' : 'מסלולים שהוקצו לך לביצוע'}
          </p>
        </div>
        {canManageRoutes && (
          <Link
            to={createPageUrl('CreateRoute')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#2D5233] text-white text-xs font-bold active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            מסלול חדש
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="text-center text-xs text-gray-400 py-8">טוען מסלולים...</div>
      ) : routes.length === 0 ? (
        <EmptyShell
          icon={<Truck className="h-10 w-10 text-gray-300" />}
          title={canManageRoutes ? 'עוד אין מסלולים בחשבון' : 'אין לך מסלולים פעילים'}
          text={canManageRoutes
            ? 'צור מסלול ראשון כדי לתאם בין נהגים, רכבים ותחנות.'
            : 'כשהמנהל ישייך לך מסלול, הוא יופיע כאן.'}
          embedded
        />
      ) : (
        <div className="space-y-2">
          {routes.map(r => {
            const status = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
            return (
              <Link
                key={r.id}
                to={createPageUrl('RouteDetail') + '?id=' + r.id}
                className="block bg-white border border-gray-100 rounded-xl p-3 active:bg-gray-50"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{r.title}</p>
                    {r.scheduled_for && (
                      <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(r.scheduled_for).toLocaleDateString('he-IL')}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${status.cls}`}>
                    {status.label}
                  </span>
                  <ChevronLeft className="h-4 w-4 text-gray-300 shrink-0 mt-0.5" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyShell({ icon, title, text, embedded }) {
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

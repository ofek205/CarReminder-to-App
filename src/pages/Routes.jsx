/**
 * Phase 6 + 9 — Routes list page.
 *
 * One page, two views (server-side RLS does the actual data filtering):
 *   - Manager: flat chronological list of every route in the workspace
 *     with a "create route" CTA.
 *   - Driver: task-board layout grouped by status + date —
 *       בביצוע (highlighted active task), מתוזמן להיום, מתוזמן בעתיד,
 *       הושלמו השבוע. Each card shows progress (X of Y stops) and a
 *       primary action ("התחל" / "המשך משימה").
 *
 * Private workspace users see an "available only in business workspace"
 * empty state — the page never crashes, but isn't useful outside B2B.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import {
  Plus, Briefcase, Calendar, Truck, ChevronLeft, AlertCircle,
  CheckCircle2, Play, Clock,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
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

const todayISO = () => new Date().toISOString().slice(0, 10);
const oneWeekAgoISO = () => {
  const d = new Date(); d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('he-IL') : '';

// ---------- main component --------------------------------------------

export default function Routes() {
  const { isAuthenticated } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, canManageRoutes, canDriveRoutes, isLoading: roleLoading } = useWorkspaceRole();

  const enabled = !!accountId && isAuthenticated && isBusiness;
  const driverOnly = canDriveRoutes && !canManageRoutes;

  // Manager view paginates with keyset on created_at (30 per page).
  // Driver view fetches all visible routes (RLS scopes to own routes —
  // bounded naturally) so grouping into Active / Today / Future / Done
  // can be done across the full set.
  const PAGE_SIZE = 30;
  const useManagerPaginated = enabled && !driverOnly;

  const {
    data: routePages, isLoading: managerLoading,
    hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['routes-paged', accountId],
    enabled: useManagerPaginated,
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      let q = supabase
        .from('routes')
        .select('id, title, status, scheduled_for, vehicle_id, assigned_driver_user_id, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) q = q.lt('created_at', pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE ? undefined : lastPage[lastPage.length - 1]?.created_at,
    staleTime: 60 * 1000,
  });

  // Driver view — unbounded, RLS-scoped fetch.
  const { data: driverRoutes = [], isLoading: driverLoading } = useQuery({
    queryKey: ['routes-driver', accountId],
    enabled: enabled && driverOnly,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routes')
        .select('id, title, status, scheduled_for, vehicle_id, assigned_driver_user_id, created_at')
        .eq('account_id', accountId)
        .order('scheduled_for', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    staleTime: 60 * 1000,
  });

  const routes = driverOnly
    ? driverRoutes
    : (routePages?.pages || []).flat();
  const isLoading = driverOnly ? driverLoading : managerLoading;

  // Driver view shows progress per route, so we fetch stops too.
  // Done client-side to avoid yet another database view migration.
  const routeIds = routes.map(r => r.id);
  const { data: stops = [] } = useQuery({
    queryKey: ['routes-stops', accountId, routeIds.join(',')],
    queryFn: async () => {
      if (routeIds.length === 0) return [];
      const { data, error } = await supabase
        .from('route_stops')
        .select('id, route_id, status')
        .eq('account_id', accountId)
        .in('route_id', routeIds);
      if (error) throw error;
      return data || [];
    },
    enabled: enabled && routeIds.length > 0,
    staleTime: 60 * 1000,
  });

  // Vehicle labels for richer cards.
  const { data: vehicles = [] } = useQuery({
    queryKey: ['routes-vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  // Build per-route stop stats.
  const stopsByRoute = useMemo(() => {
    const m = {};
    for (const s of stops) {
      if (!m[s.route_id]) m[s.route_id] = { total: 0, completed: 0 };
      m[s.route_id].total++;
      if (s.status === 'completed') m[s.route_id].completed++;
    }
    return m;
  }, [stops]);

  const vehicleById = useMemo(() => {
    const m = {};
    for (const v of vehicles) m[v.id] = v;
    return m;
  }, [vehicles]);

  const vehicleLabel = (id) => {
    const v = vehicleById[id];
    if (!v) return null;
    return v.nickname || v.license_plate || `${v.manufacturer || ''} ${v.model || ''}`.trim() || null;
  };

  // ---------- guards --------------------------------------------------

  if (!isAuthenticated) {
    return <EmptyShell text="צריך להתחבר כדי לראות משימות." />;
  }
  if (roleLoading) return <EmptyShell text="טוען..." />;
  if (!isBusiness) {
    return (
      <EmptyShell
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="ניהול משימות זמין בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש כדי להתחיל."
      />
    );
  }
  if (!canManageRoutes && !canDriveRoutes) {
    return (
      <EmptyShell
        icon={<AlertCircle className="h-10 w-10 text-gray-300" />}
        title="אין הרשאה למשימות"
        text="פנה למנהל החשבון כדי לקבל גישה."
      />
    );
  }

  // ---------- render: driver mode -------------------------------------

  if (driverOnly) {
    return (
      <DriverView
        routes={routes}
        isLoading={isLoading}
        stopsByRoute={stopsByRoute}
        vehicleLabel={vehicleLabel}
      />
    );
  }

  // ---------- render: manager mode (default) --------------------------

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">משימות</h1>
          <p className="text-xs text-gray-500">תכנון, שיוך ומעקב אחרי משימות הצי</p>
        </div>
        <Link
          to={createPageUrl('CreateRoute')}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#2D5233] text-white text-xs font-bold active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          משימה חדשה
        </Link>
      </div>

      {isLoading ? (
        <div className="text-center text-xs text-gray-400 py-8">טוען משימות...</div>
      ) : routes.length === 0 ? (
        <EmptyShell
          icon={<Truck className="h-10 w-10 text-gray-300" />}
          title="עוד אין משימות בחשבון"
          text="צור משימה ראשונה ושייך לה רכב, נהג ותחנות."
          embedded
        />
      ) : (
        <>
          <div className="space-y-2">
            {routes.map(r => {
              const status = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
              const stats  = stopsByRoute[r.id];
              return (
                <Link
                  key={r.id}
                  to={createPageUrl('RouteDetail') + '?id=' + r.id}
                  className="block bg-white border border-gray-100 rounded-xl p-3 active:bg-gray-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{r.title}</p>
                      <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-1">
                        {r.scheduled_for && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {fmtDate(r.scheduled_for)}
                          </span>
                        )}
                        {vehicleLabel(r.vehicle_id) && (
                          <span className="flex items-center gap-1">
                            <Truck className="h-3 w-3" />
                            {vehicleLabel(r.vehicle_id)}
                          </span>
                        )}
                        {stats && (
                          <span className="text-gray-400">
                            {stats.completed}/{stats.total} תחנות
                          </span>
                        )}
                      </div>
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

          {hasNextPage && (
            <button
              type="button"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
              className="w-full mt-3 py-2.5 rounded-xl bg-gray-100 text-xs font-bold text-gray-700 disabled:opacity-60"
            >
              {isFetchingNextPage ? 'טוען...' : 'טען עוד משימות'}
            </button>
          )}
          {!hasNextPage && routes.length >= PAGE_SIZE && (
            <p className="text-center text-[10px] text-gray-400 mt-3">סוף הרשימה</p>
          )}
        </>
      )}
    </div>
  );
}

// ---------- driver view -----------------------------------------------

function DriverView({ routes, isLoading, stopsByRoute, vehicleLabel }) {
  const today = todayISO();
  const weekAgo = oneWeekAgoISO();

  const grouped = useMemo(() => {
    const out = { active: [], todayPending: [], future: [], completedRecent: [] };
    for (const r of routes) {
      if (r.status === 'in_progress') {
        out.active.push(r);
      } else if (r.status === 'pending') {
        if (r.scheduled_for && r.scheduled_for <= today) out.todayPending.push(r);
        else                                              out.future.push(r);
      } else if (r.status === 'completed') {
        const ref = r.scheduled_for || (r.created_at ? r.created_at.slice(0, 10) : null);
        if (ref && ref >= weekAgo) out.completedRecent.push(r);
      }
    }
    return out;
  }, [routes, today, weekAgo]);

  if (isLoading) {
    return (
      <div dir="rtl" className="max-w-3xl mx-auto py-2">
        <div className="text-center text-xs text-gray-400 py-8">טוען את המשימות שלך...</div>
      </div>
    );
  }

  const totalActiveOrPending = grouped.active.length + grouped.todayPending.length + grouped.future.length;

  if (totalActiveOrPending === 0 && grouped.completedRecent.length === 0) {
    return (
      <div dir="rtl" className="max-w-3xl mx-auto py-2">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">המשימות שלי</h1>
          <p className="text-xs text-gray-500">משימות שהוקצו לך לביצוע</p>
        </div>
        <EmptyShell
          icon={<Truck className="h-10 w-10 text-gray-300" />}
          title="אין לך משימות פעילות"
          text="כשהמנהל ישייך לך משימה, היא תופיע כאן ותוכל להתחיל בביצוע."
          embedded
        />
      </div>
    );
  }

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">המשימות שלי</h1>
        <p className="text-xs text-gray-500">
          {todayHebrewLabel()}
          {totalActiveOrPending > 0 && <> · {totalActiveOrPending} משימות פתוחות</>}
        </p>
      </div>

      {grouped.active.length > 0 && (
        <Section icon={<Play className="h-4 w-4 text-blue-700" />} title="בביצוע עכשיו" tone="blue">
          {grouped.active.map(r => (
            <DriverRouteCard
              key={r.id}
              route={r}
              stats={stopsByRoute[r.id]}
              vehicle={vehicleLabel(r.vehicle_id)}
              variant="active"
            />
          ))}
        </Section>
      )}

      {grouped.todayPending.length > 0 && (
        <Section icon={<Calendar className="h-4 w-4 text-[#2D5233]" />} title="להיום" tone="green">
          {grouped.todayPending.map(r => (
            <DriverRouteCard
              key={r.id}
              route={r}
              stats={stopsByRoute[r.id]}
              vehicle={vehicleLabel(r.vehicle_id)}
              variant="today"
            />
          ))}
        </Section>
      )}

      {grouped.future.length > 0 && (
        <Section icon={<Clock className="h-4 w-4 text-gray-500" />} title="מתוזמן בהמשך" tone="gray">
          {grouped.future.map(r => (
            <DriverRouteCard
              key={r.id}
              route={r}
              stats={stopsByRoute[r.id]}
              vehicle={vehicleLabel(r.vehicle_id)}
              variant="future"
            />
          ))}
        </Section>
      )}

      {grouped.completedRecent.length > 0 && (
        <Section icon={<CheckCircle2 className="h-4 w-4 text-green-700" />} title={`הושלמו השבוע (${grouped.completedRecent.length})`} tone="green" muted>
          {grouped.completedRecent.map(r => (
            <DriverRouteCard
              key={r.id}
              route={r}
              stats={stopsByRoute[r.id]}
              vehicle={vehicleLabel(r.vehicle_id)}
              variant="completed"
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function todayHebrewLabel() {
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const d = new Date();
  return `יום ${days[d.getDay()]} · ${d.toLocaleDateString('he-IL')}`;
}

// ---------- subcomponents --------------------------------------------

function Section({ icon, title, children, muted }) {
  return (
    <section className={`mb-4 ${muted ? 'opacity-90' : ''}`}>
      <div className="flex items-center gap-2 mb-2 px-1">
        {icon}
        <h2 className="text-sm font-bold text-gray-700">{title}</h2>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function DriverRouteCard({ route, stats, vehicle, variant }) {
  const total     = stats?.total || 0;
  const completed = stats?.completed || 0;
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;

  const isActive    = variant === 'active';
  const isToday     = variant === 'today';
  const isFuture    = variant === 'future';
  const isCompleted = variant === 'completed';

  const cardCls = isActive
    ? 'bg-blue-50 border-blue-200'
    : isCompleted
      ? 'bg-gray-50 border-gray-100 opacity-90'
      : 'bg-white border-gray-100';

  const cta = isActive   ? 'המשך משימה'
            : isToday    ? 'התחל'
            : isFuture   ? 'פרטים'
            : 'צפה בפרטים';

  return (
    <Link
      to={createPageUrl('RouteDetail') + '?id=' + route.id}
      className={`block ${cardCls} border rounded-2xl p-4 active:scale-[0.99] transition-transform`}
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <p className={`font-bold truncate ${isActive ? 'text-base text-blue-900' : 'text-sm text-gray-900'}`}>
            {route.title}
          </p>
          <div className="flex items-center gap-2 text-[11px] text-gray-600 mt-1 flex-wrap">
            {vehicle && (
              <span className="flex items-center gap-1">
                <Truck className="h-3 w-3" />
                {vehicle}
              </span>
            )}
            {route.scheduled_for && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {fmtDate(route.scheduled_for)}
              </span>
            )}
          </div>
        </div>
      </div>

      {total > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className={`${isActive ? 'text-blue-900 font-bold' : 'text-gray-600'}`}>
              {isCompleted ? 'הושלמו' : 'התקדמות'}
            </span>
            <span className="text-gray-500">{completed} מתוך {total} תחנות</span>
          </div>
          <div className="h-2 bg-white rounded-full overflow-hidden border border-gray-100">
            <div
              className={`h-full transition-all duration-300 ${isActive ? 'bg-blue-600' : isCompleted ? 'bg-green-600' : 'bg-[#2D5233]'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {!isCompleted && (
        <div className="mt-3 flex items-center justify-between">
          <span className={`flex-1 text-center py-2 rounded-xl text-xs font-bold ${
            isActive
              ? 'bg-blue-600 text-white'
              : isToday
                ? 'bg-[#2D5233] text-white'
                : 'bg-gray-100 text-gray-700'
          }`}>
            {cta} ←
          </span>
        </div>
      )}
    </Link>
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

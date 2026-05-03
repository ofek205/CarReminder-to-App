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
  CheckCircle2, Clock, MapPin, Map as MapIcon,
} from 'lucide-react';
// MapIcon is still used by the manager "מפת משימות" entry — keep the import.
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { createPageUrl } from '@/utils';
import NavigateButton from '@/components/map/NavigateButton';
import { findNextStopIndex, isStopTerminal } from '@/components/map/stopColors';
// Shared Living Dashboard system. Same components the BusinessDashboard
// uses so every B2B page reads as one product.
import {
  PageShell,
  Card,
  KpiTile,
  AnimatedCount,
} from '@/components/business/system';

// Status palette aligned with the system's color → meaning convention:
//   pending = gray (waiting), in_progress = blue (active),
//   completed = emerald (done), cancelled = red (problem).
const STATUS_LABEL = {
  pending:     { label: 'מתוזמן',  cls: 'bg-gray-100   text-gray-700',   tone: 'gray' },
  in_progress: { label: 'בביצוע',  cls: 'bg-blue-100   text-blue-700',   tone: 'blue' },
  completed:   { label: 'הושלם',   cls: 'bg-emerald-100 text-emerald-700', tone: 'emerald' },
  cancelled:   { label: 'בוטל',    cls: 'bg-red-100    text-red-700',    tone: 'red' },
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
        .order('created_at', { ascending: false })
        .limit(100);
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
  // Extended in phase 12 to include sequence + title + address +
  // coordinates so each card can show the next stop and offer a
  // direct "navigate to next stop" CTA.
  const routeIds = routes.map(r => r.id);
  const { data: stops = [] } = useQuery({
    queryKey: ['routes-stops', accountId, routeIds.join(',')],
    queryFn: async () => {
      if (routeIds.length === 0) return [];
      const { data, error } = await supabase
        .from('route_stops')
        .select('id, route_id, status, sequence, title, address_text, latitude, longitude')
        .eq('account_id', accountId)
        .in('route_id', routeIds)
        .order('sequence', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: enabled && routeIds.length > 0,
    staleTime: 60 * 1000,
  });

  // Vehicle labels for richer cards.
  const { data: vehicles = [] } = useQuery({
    queryKey: ['routes-vehicles', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, nickname, manufacturer, model, license_plate')
        .eq('account_id', accountId);
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  // Build per-route stop stats + next-stop summary. The driver card uses
  // both: progress bar from {total, completed}, and the "next stop"
  // block + navigate CTA from the next-uncompleted entry.
  const stopsByRoute = useMemo(() => {
    const grouped = {};
    for (const s of stops) {
      if (!grouped[s.route_id]) grouped[s.route_id] = [];
      grouped[s.route_id].push(s);
    }
    const m = {};
    for (const [rid, list] of Object.entries(grouped)) {
      // Already ordered by sequence from the query, but defensive sort
      // in case React Query merges in stale entries.
      list.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
      const total = list.length;
      const completed = list.filter(s => s.status === 'completed').length;
      const nextIdx = findNextStopIndex(list);
      const next = nextIdx >= 0 ? list[nextIdx] : null;
      const allTerminal = total > 0 && list.every(s => isStopTerminal(s.status));
      m[rid] = { total, completed, next, allTerminal };
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

  // Aggregate counts per status for the KPI strip. Computed off the
  // currently-loaded pages — close enough for the at-a-glance view;
  // the deeper dashboard already has authoritative counts.
  const counts = {
    inProgress: routes.filter(r => r.status === 'in_progress').length,
    pending:    routes.filter(r => r.status === 'pending').length,
    completed:  routes.filter(r => r.status === 'completed').length,
  };

  return (
    <PageShell
      title="משימות"
      subtitle="תכנון, שיוך ומעקב אחרי משימות הצי"
      live
      actions={(
        <div className="flex items-center gap-2">
          <Link
            to={createPageUrl('FleetMap')}
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98] border border-[#2D5233]/20 bg-white text-[#2D5233]"
          >
            <MapIcon className="h-4 w-4" />
            מפת משימות
          </Link>
          <Link
            to={createPageUrl('CreateRoute')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
              color: '#FFFFFF',
              boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
            }}
          >
            <Plus className="h-4 w-4" />
            צור משימה
          </Link>
        </div>
      )}
    >
      {/* KPI Strip: 3-up status counters, color = meaning. */}
      <section className="grid grid-cols-3 gap-3 mb-5">
        <KpiTile
          label="בביצוע עכשיו"
          value={<AnimatedCount value={counts.inProgress} />}
          sub={counts.inProgress === 0 ? 'אין משימה פתוחה' : 'בעבודה'}
          tone="blue"
        />
        <KpiTile
          label="מתוזמנות"
          value={<AnimatedCount value={counts.pending} />}
          sub={counts.pending === 0 ? 'אין מתוזמן' : 'ממתינות'}
          tone="amber"
        />
        <KpiTile
          label="הושלמו"
          value={<AnimatedCount value={counts.completed} />}
          sub={counts.completed === 0 ? 'אין' : 'בהיסטוריה'}
          tone="emerald"
        />
      </section>

      {/* List of routes */}
      {isLoading ? (
        <Card className="text-center py-8">
          <p className="text-xs" style={{ color: '#6B7C72' }}>טוען משימות...</p>
        </Card>
      ) : routes.length === 0 ? (
        <Card className="text-center py-12">
          <Truck className="h-10 w-10 mx-auto mb-3" style={{ color: '#A7F3D0' }} />
          <p className="text-sm font-bold mb-1" style={{ color: '#0B2912' }}>
            עוד אין משימות בחשבון
          </p>
          <p className="text-xs leading-relaxed" style={{ color: '#6B7C72' }}>
            צור משימה ראשונה ושייך לה רכב, נהג ותחנות.
          </p>
        </Card>
      ) : (
        <>
          <h2 className="text-sm font-bold mb-2.5" style={{ color: '#0B2912' }}>
            כל המשימות ({routes.length})
          </h2>
          <div className="space-y-2">
            {routes.map(r => (
              <ManagerRouteCard
                key={r.id}
                route={r}
                stats={stopsByRoute[r.id]}
                vehicleLabel={vehicleLabel(r.vehicle_id)}
              />
            ))}
          </div>

          {hasNextPage && (
            <button
              type="button"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
              className="w-full mt-3 py-2.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.01] active:scale-[0.98] disabled:opacity-60"
              style={{
                background: '#FFFFFF',
                color: '#10B981',
                border: '1.5px solid #D1FAE5',
              }}
            >
              {isFetchingNextPage ? 'טוען...' : 'טען עוד משימות'}
            </button>
          )}
          {!hasNextPage && routes.length >= PAGE_SIZE && (
            <p className="text-center text-[10px] mt-3" style={{ color: '#6B7C72' }}>סוף הרשימה</p>
          )}
        </>
      )}
    </PageShell>
  );
}

// ManagerRouteCard: list-row variant for the manager flat view.
// Uses the system's white Card with a status accent stripe so the
// row reads as part of the design family without screaming.
function ManagerRouteCard({ route, stats, vehicleLabel }) {
  const status = STATUS_LABEL[route.status] || STATUS_LABEL.pending;
  // Map status tone to a Card accent color (top stripe).
  const accent = status.tone === 'blue' ? 'blue'
    : status.tone === 'emerald' ? 'emerald'
    : status.tone === 'red' ? 'red'
    : null;
  return (
    <Link
      to={createPageUrl('RouteDetail') + '?id=' + route.id}
      className="block transition-all hover:scale-[1.005] active:scale-[0.998]"
    >
      <Card accent={accent} padding="p-3.5">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: '#0B2912' }}>{route.title}</p>
            <div className="flex items-center gap-3 text-[11px] mt-1.5 flex-wrap" style={{ color: '#4B5D52' }}>
              {route.scheduled_for && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {fmtDate(route.scheduled_for)}
                </span>
              )}
              {vehicleLabel && (
                <span className="flex items-center gap-1">
                  <Truck className="h-3 w-3" />
                  {vehicleLabel}
                </span>
              )}
              {stats && (
                <span style={{ color: '#6B7C72' }}>
                  {stats.completed}/{stats.total} תחנות
                </span>
              )}
            </div>
          </div>
          <span
            className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-black ${status.cls}`}
          >
            {status.label}
          </span>
          <ChevronLeft className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#A7F3D0' }} />
        </div>
      </Card>
    </Link>
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
      <PageShell title="המשימות שלי" subtitle="טוען...">
        <Card className="text-center py-8">
          <p className="text-xs" style={{ color: '#6B7C72' }}>טוען את המשימות שלך...</p>
        </Card>
      </PageShell>
    );
  }

  const totalActiveOrPending = grouped.active.length + grouped.todayPending.length + grouped.future.length;

  if (totalActiveOrPending === 0 && grouped.completedRecent.length === 0) {
    return (
      <PageShell title="המשימות שלי" subtitle="משימות שהוקצו לך לביצוע">
        <Card className="text-center py-12">
          <Truck className="h-10 w-10 mx-auto mb-3" style={{ color: '#A7F3D0' }} />
          <p className="text-sm font-bold mb-1" style={{ color: '#0B2912' }}>
            אין לך משימות פעילות
          </p>
          <p className="text-xs leading-relaxed" style={{ color: '#6B7C72' }}>
            כשהמנהל ישייך לך משימה, היא תופיע כאן ותוכל להתחיל בביצוע.
          </p>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="המשימות שלי"
      subtitle={`${todayHebrewLabel()}${totalActiveOrPending > 0 ? ` · ${totalActiveOrPending} משימות פתוחות` : ''}`}
      live={grouped.active.length > 0}
    >
      {/* Active task as a vivid hero card — that's the one the driver
          is actively working. Gradient blue draws the eye instantly. */}
      {grouped.active.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs uppercase tracking-[0.15em] font-bold mb-2.5" style={{ color: '#1D4ED8' }}>
            בביצוע עכשיו
          </h2>
          <div className="space-y-3">
            {grouped.active.map(r => (
              <DriverRouteCard
                key={r.id}
                route={r}
                stats={stopsByRoute[r.id]}
                vehicle={vehicleLabel(r.vehicle_id)}
                variant="active"
              />
            ))}
          </div>
        </section>
      )}

      {grouped.todayPending.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs uppercase tracking-[0.15em] font-bold mb-2.5 flex items-center gap-2" style={{ color: '#047857' }}>
            <Calendar className="h-3.5 w-3.5" />
            להיום
          </h2>
          <div className="space-y-2">
            {grouped.todayPending.map(r => (
              <DriverRouteCard
                key={r.id}
                route={r}
                stats={stopsByRoute[r.id]}
                vehicle={vehicleLabel(r.vehicle_id)}
                variant="today"
              />
            ))}
          </div>
        </section>
      )}

      {grouped.future.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs uppercase tracking-[0.15em] font-bold mb-2.5 flex items-center gap-2" style={{ color: '#6B7C72' }}>
            <Clock className="h-3.5 w-3.5" />
            מתוזמן בהמשך
          </h2>
          <div className="space-y-2">
            {grouped.future.map(r => (
              <DriverRouteCard
                key={r.id}
                route={r}
                stats={stopsByRoute[r.id]}
                vehicle={vehicleLabel(r.vehicle_id)}
                variant="future"
              />
            ))}
          </div>
        </section>
      )}

      {grouped.completedRecent.length > 0 && (
        <section className="mb-5 opacity-90">
          <h2 className="text-xs uppercase tracking-[0.15em] font-bold mb-2.5 flex items-center gap-2" style={{ color: '#047857' }}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            הושלמו השבוע ({grouped.completedRecent.length})
          </h2>
          <div className="space-y-2">
            {grouped.completedRecent.map(r => (
              <DriverRouteCard
                key={r.id}
                route={r}
                stats={stopsByRoute[r.id]}
                vehicle={vehicleLabel(r.vehicle_id)}
                variant="completed"
              />
            ))}
          </div>
        </section>
      )}
    </PageShell>
  );
}

function todayHebrewLabel() {
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const d = new Date();
  return `יום ${days[d.getDay()]} · ${d.toLocaleDateString('he-IL')}`;
}

// ---------- subcomponents --------------------------------------------

// DriverRouteCard: variant-driven card for the driver task board.
// Active = vivid blue gradient (the page's most important card).
// Today  = mint outline, emerald CTA.
// Future = neutral white, muted CTA.
// Completed = subtle gray-tinted, no CTA.
//
// Progress bar color matches the variant tone so the visual rhythm
// stays consistent: blue active, emerald today, gray future, emerald
// completed (subdued).
function DriverRouteCard({ route, stats, vehicle, variant }) {
  const total     = stats?.total || 0;
  const completed = stats?.completed || 0;
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
  const next      = stats?.next || null;
  const allTerminal = !!stats?.allTerminal;

  const isActive    = variant === 'active';
  const isToday     = variant === 'today';
  const isCompleted = variant === 'completed';

  const cta = isActive   ? 'המשך משימה ←'
            : isToday    ? 'התחל ←'
            : 'פרטים ←';

  // Destination for "נווט לתחנה הבאה". Coordinates win when present;
  // address is the fallback so Waze / Google can still navigate.
  const navDest = next && (next.address_text || (next.latitude && next.longitude))
    ? {
        lat: next.latitude,
        lng: next.longitude,
        address: next.address_text || '',
      }
    : null;
  const detailHref = createPageUrl('RouteDetail') + '?id=' + route.id;

  // Active task = full gradient hero with white text. Hits like a CTA
  // by itself. Wraps the inner content in a div (not the Link) so the
  // action buttons inside don't accidentally trigger the parent
  // navigation when the driver taps "נווט לתחנה הבאה".
  if (isActive) {
    return (
      <div
        className="rounded-2xl p-4 relative overflow-hidden group"
        style={{
          background: 'linear-gradient(135deg, #1E3A8A 0%, #3B82F6 70%, #60A5FA 100%)',
          boxShadow: '0 12px 28px -8px rgba(59,130,246,0.4), 0 4px 10px -2px rgba(59,130,246,0.2)',
        }}
      >
        <div
          aria-hidden
          className="absolute pointer-events-none transition-transform group-hover:scale-110"
          style={{
            top: '-30%', left: '-10%',
            width: '200px', height: '200px', borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 70%)',
          }}
        />
        <div className="relative">
          <Link to={detailHref} className="block">
            <p className="text-base font-black text-white truncate mb-1.5">{route.title}</p>
            <div className="flex items-center gap-3 text-[12px] text-white/85 flex-wrap">
              {vehicle && (
                <span className="flex items-center gap-1">
                  <Truck className="h-3.5 w-3.5" />
                  {vehicle}
                </span>
              )}
              {route.scheduled_for && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {fmtDate(route.scheduled_for)}
                </span>
              )}
            </div>
            {total > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] mb-1 text-white">
                  <span className="font-bold">התקדמות</span>
                  <span className="opacity-85 tabular-nums">{completed} מתוך {total} תחנות</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden bg-white/20">
                  <div
                    className="h-full transition-all duration-300 rounded-full"
                    style={{ width: `${pct}%`, background: '#FFFFFF' }}
                  />
                </div>
              </div>
            )}
            {next && (
              <div className="mt-3 rounded-xl px-3 py-2 bg-white/15 backdrop-blur-sm border border-white/20">
                <p className="text-[10px] font-bold text-white/80 mb-0.5">תחנה הבאה</p>
                <p className="text-sm font-bold text-white truncate">{next.title}</p>
                {next.address_text && (
                  <p className="text-[11px] text-white/85 flex items-center gap-1 mt-0.5 truncate">
                    <MapPin className="h-3 w-3 shrink-0" /> {next.address_text}
                  </p>
                )}
              </div>
            )}
            {allTerminal && total > 0 && (
              <div className="mt-3 rounded-xl px-3 py-2 bg-white/15 backdrop-blur-sm border border-white/20 text-center">
                <p className="text-sm font-bold text-white">כל התחנות הושלמו</p>
              </div>
            )}
          </Link>
          <div className="mt-3 flex items-center gap-2">
            <Link
              to={detailHref}
              className="flex-1 flex items-center justify-center py-2 rounded-xl bg-white/25 backdrop-blur-sm font-bold text-sm text-white active:scale-[0.98]"
            >
              {cta}
            </Link>
            {navDest && !allTerminal && (
              <NavigateButton
                destination={navDest}
                variant="pill"
                label="לתחנה הבאה"
                className="!bg-white !text-[#1E3A8A] shrink-0"
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Non-active variants — standard system Card with tone accent.
  const accent = isCompleted ? 'emerald' : isToday ? 'emerald' : null;
  const ctaStyle = isToday
    ? { background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)', color: '#FFFFFF' }
    : { background: '#F0FDF4', color: '#047857', border: '1.5px solid #D1FAE5' };

  return (
    <Card accent={accent} padding="p-3.5" className={isCompleted ? 'opacity-90' : ''}>
      <Link to={detailHref} className="block">
        <div className="flex items-start gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: '#0B2912' }}>{route.title}</p>
            <div className="flex items-center gap-3 text-[11px] mt-1 flex-wrap" style={{ color: '#4B5D52' }}>
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
              <span className="font-bold" style={{ color: '#0B2912' }}>
                {isCompleted ? 'הושלמו' : 'התקדמות'}
              </span>
              <span style={{ color: '#6B7C72' }} className="tabular-nums">
                {completed} מתוך {total} תחנות
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#F0FDF4' }}>
              <div
                className="h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${pct}%`,
                  background: isCompleted
                    ? 'linear-gradient(90deg, #047857 0%, #10B981 100%)'
                    : 'linear-gradient(90deg, #047857 0%, #34D399 100%)',
                }}
              />
            </div>
          </div>
        )}

        {/* Next stop preview — only for non-completed cards. */}
        {!isCompleted && next && (
          <div className="mt-2.5 rounded-xl px-2.5 py-2 border border-gray-100 bg-gray-50">
            <p className="text-[10px] font-bold text-gray-500 mb-0.5">תחנה הבאה</p>
            <p className="text-[12px] font-bold text-gray-900 truncate">{next.title}</p>
            {next.address_text && (
              <p className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5 truncate">
                <MapPin className="h-2.5 w-2.5 shrink-0" /> {next.address_text}
              </p>
            )}
          </div>
        )}

        {!isCompleted && allTerminal && total > 0 && (
          <p className="mt-2 text-[11px] font-bold text-emerald-700 text-center">
            כל התחנות הושלמו
          </p>
        )}
      </Link>

      {/* Action row — sits outside the Link so taps don't bubble up. */}
      {!isCompleted && (
        <div className="mt-3 flex items-center gap-2">
          <Link
            to={detailHref}
            className="flex-1 text-center py-2 rounded-xl text-xs font-bold active:scale-[0.98]"
            style={ctaStyle}
          >
            {cta}
          </Link>
          {navDest && !allTerminal && (
            <NavigateButton
              destination={navDest}
              variant="compact"
              label="נווט"
            />
          )}
        </div>
      )}
    </Card>
  );
}

// EmptyShell: kept as a thin fallback for guard-state renders that
// don't go through PageShell (auth/permission gates above).
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

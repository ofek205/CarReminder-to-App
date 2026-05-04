/**
 * Phase 13 — Fleet Map.
 *
 * Manager-only dashboard that plots every route stop in the workspace
 * on a single OpenStreetMap canvas, with date / driver / vehicle /
 * status / stop-type / overdue / unassigned filters and a side list
 * of the matching tasks.
 *
 * Default load: today's active tasks (status in pending|in_progress).
 * Anything wider has to be opted into via the filters — keeps the page
 * fast even in workspaces with hundreds of historical routes.
 *
 * Coloring:
 *   - When more than one driver is visible → color by driver.
 *   - When the manager filters down to one driver → color by route, so
 *     the manager can tell that driver's tasks apart at a glance.
 *
 * Performance:
 *   - Routes query uses the existing (account_id, scheduled_for) index.
 *   - Stops query uses the (route_id, sequence) index added in phase 6
 *     and the geo + status indexes added in phase 10.
 *   - MapCore is lazy-loaded; the page works as a list-only view while
 *     the heavy Leaflet bundle streams in.
 */
import React, { useState, useMemo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Filter, Calendar, Truck, User as UserIcon, MapPin, Map as MapIcon,
  ChevronLeft, AlertCircle, Briefcase, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { createPageUrl } from '@/utils';
import { DateInput } from '@/components/ui/date-input';
import {
  colorForStop, labelForStop, isStopTerminal,
} from '@/components/map/stopColors';
import { iconSvgForStopType, STOP_TYPE_LABEL } from '@/components/map/stopTypeIcons';
import { colorFromKey } from '@/lib/colorPalette';
import NavigateButton from '@/components/map/NavigateButton';
// Living Dashboard system - shared with all B2B pages.
import { PageShell, Card } from '@/components/business/system';

// Map a route status to a Living Dashboard accent for the side-list
// task card stripe. Keeps the map's per-route colored polylines as the
// visual key for "which route is which" while the system accent gives
// a quick read on completion state.
const ROUTE_STATUS_ACCENT = {
  pending:     'amber',
  in_progress: 'blue',
  completed:   'emerald',
  cancelled:   'red',
};

// Lazy MapCore — keeps the initial bundle lean. Filters + side list
// remain usable while Leaflet streams in.
const MapCore = lazy(() => import('@/components/map/MapCore'));

// ---------- date helpers --------------------------------------------------

function isoDate(d) { return d.toISOString().slice(0, 10); }
function todayISO()    { return isoDate(new Date()); }
function tomorrowISO() {
  const d = new Date(); d.setDate(d.getDate() + 1); return isoDate(d);
}
function weekFromTodayISO() {
  const d = new Date(); d.setDate(d.getDate() + 7); return isoDate(d);
}

function dateRangeFor(mode, customStart, customEnd) {
  if (mode === 'today')    return { start: todayISO(), end: todayISO() };
  if (mode === 'tomorrow') return { start: tomorrowISO(), end: tomorrowISO() };
  if (mode === 'week')     return { start: todayISO(), end: weekFromTodayISO() };
  if (mode === 'custom')   return { start: customStart || todayISO(), end: customEnd || todayISO() };
  return { start: todayISO(), end: todayISO() };
}

// ---------- main page ----------------------------------------------------

const STATUS_OPTIONS = [
  { value: 'pending',     label: 'מתוזמנות' },
  { value: 'in_progress', label: 'בביצוע' },
  { value: 'completed',   label: 'הושלמו' },
];
const STOP_TYPE_OPTIONS = [
  { value: '',                label: 'הכל' },
  { value: 'pickup',          label: 'איסוף' },
  { value: 'delivery',        label: 'מסירה' },
  { value: 'meeting',         label: 'פגישה' },
  { value: 'inspection',      label: 'בדיקה' },
  { value: 'vehicle_service', label: 'טיפול ברכב' },
  { value: 'other',           label: 'אחר' },
];

export default function FleetMap() {
  const { isAuthenticated } = useAuth();
  const { accountId } = useAccountRole();
  const { canManageRoutes, isBusiness, isLoading: roleLoading } = useWorkspaceRole();

  // ---------- filter state ----------------------------------------------
  const [dateMode, setDateMode]     = useState('today');
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd]     = useState(todayISO());
  const [driverId, setDriverId]       = useState('');
  const [vehicleId, setVehicleId]     = useState('');
  const [statusFilter, setStatusFilter] = useState(['pending', 'in_progress']);
  const [stopType, setStopType]       = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile-only

  const enabled = isAuthenticated && isBusiness && canManageRoutes && !!accountId;
  const { start, end } = dateRangeFor(dateMode, customStart, customEnd);

  // ---------- routes query (date + status server-side) -------------------
  const {
    data: routes = [], isLoading: routesLoading,
  } = useQuery({
    queryKey: ['fleet-map-routes', accountId, start, end, statusFilter.join(',')],
    queryFn: async () => {
      let q = supabase
        .from('routes')
        .select('id, title, status, scheduled_for, vehicle_id, assigned_driver_user_id')
        .eq('account_id', accountId)
        .gte('scheduled_for', start)
        .lte('scheduled_for', end)
        .order('scheduled_for', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(200);
      if (statusFilter.length > 0) q = q.in('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 60 * 1000,
  });

  // Apply post-fetch filters that don't translate cleanly to server-side:
  //   driverId, vehicleId, unassignedOnly. These run on a small array
  //   (already capped to 200), so the cost is negligible.
  const filteredRoutes = useMemo(() => {
    return routes.filter(r => {
      if (driverId       && r.assigned_driver_user_id !== driverId) return false;
      if (vehicleId      && r.vehicle_id              !== vehicleId) return false;
      if (unassignedOnly && r.assigned_driver_user_id) return false;
      return true;
    });
  }, [routes, driverId, vehicleId, unassignedOnly]);

  const routeIds = filteredRoutes.map(r => r.id);

  // ---------- stops query (only for filtered routes) ---------------------
  const {
    data: stops = [], isLoading: stopsLoading,
  } = useQuery({
    queryKey: ['fleet-map-stops', accountId, routeIds.join(',')],
    queryFn: async () => {
      if (routeIds.length === 0) return [];
      const { data, error } = await supabase
        .from('route_stops')
        .select('id, route_id, sequence, title, address_text, latitude, longitude, status, planned_time, stop_type')
        .in('route_id', routeIds)
        .order('sequence', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: enabled && routeIds.length > 0,
    staleTime: 60 * 1000,
  });

  // Stop-level filters
  const filteredStops = useMemo(() => {
    return stops.filter(s => {
      if (stopType    && s.stop_type !== stopType) return false;
      if (overdueOnly && s.status    !== 'overdue') return false;
      return true;
    });
  }, [stops, stopType, overdueOnly]);

  // ---------- vehicles + team for labels --------------------------------
  const { data: vehicles = [] } = useQuery({
    queryKey: ['fleet-map-vehicles', accountId],
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
  const vehicleById = useMemo(() => {
    const m = {};
    for (const v of vehicles) m[v.id] = v;
    return m;
  }, [vehicles]);
  const vehicleLabel = (id) => {
    const v = vehicleById[id];
    if (!v) return '—';
    return v.nickname || v.license_plate || `${v.manufacturer || ''} ${v.model || ''}`.trim() || '—';
  };

  const { data: team = [] } = useQuery({
    queryKey: ['fleet-map-team', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('workspace_team_directory', {
        p_account_id: accountId,
      });
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
  const teamById = useMemo(() => {
    const m = {};
    for (const t of team) m[t.user_id] = t;
    return m;
  }, [team]);
  const driverLabel = (id) => {
    if (!id) return 'ללא נהג';
    return teamById[id]?.display_name || 'נהג משויך';
  };

  // ---------- coloring strategy -----------------------------------------
  // Distinct drivers in the filtered set. When 1 → color by route, the
  // manager wants to tell that driver's stops apart. Otherwise → color
  // by driver, so the manager can read driver coverage at a glance.
  const distinctDriverIds = useMemo(() => {
    const s = new Set();
    for (const r of filteredRoutes) {
      if (r.assigned_driver_user_id) s.add(r.assigned_driver_user_id);
    }
    return [...s];
  }, [filteredRoutes]);
  const colorByRoute = distinctDriverIds.length <= 1;

  const routeColor = (route) =>
    colorByRoute
      ? colorFromKey(route.id)
      : colorFromKey(route.assigned_driver_user_id || `unassigned-${route.id}`);

  // Per-route precomputed color so both markers and polylines use the
  // same value without recomputing per stop.
  const colorByRouteId = useMemo(() => {
    const m = {};
    for (const r of filteredRoutes) m[r.id] = routeColor(r);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRoutes, colorByRoute]);

  // Stops by route (for popup "stop X of Y" + polyline ordering).
  const stopsByRoute = useMemo(() => {
    const m = {};
    for (const s of stops) {
      if (!m[s.route_id]) m[s.route_id] = [];
      m[s.route_id].push(s);
    }
    for (const list of Object.values(m)) {
      list.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    }
    return m;
  }, [stops]);

  // ---------- map data --------------------------------------------------
  // Markers: only stops that have coordinates. Stops without coords still
  // appear in the side list with a "כתובת לא אומתה במפה" badge.
  //
  // Marker symbol is driven by stop_type — pickup/delivery/meeting/
  // inspection/vehicle_service map to inline SVG icons; "other" or
  // unset stop_type gets a neutral dot so the marker always shows an
  // icon (no confusing number/icon mix). The stop's sequence is still
  // shown inside the popup ("תחנה X מתוך Y").
  const mapMarkers = useMemo(() => {
    return filteredStops
      .filter(s => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
      .map(s => {
        const route = filteredRoutes.find(r => r.id === s.route_id);
        if (!route) return null;
        return {
          id: s.id,
          lat: s.latitude,
          lng: s.longitude,
          iconSvg: iconSvgForStopType(s.stop_type),
          color: colorByRouteId[s.route_id] || '#1565C0',
          stop: s,
          route,
        };
      })
      .filter(Boolean);
  }, [filteredStops, filteredRoutes, colorByRouteId]);

  const mapRoutes = useMemo(() => {
    return filteredRoutes.map(r => {
      const list = (stopsByRoute[r.id] || [])
        .filter(s => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
      if (list.length < 2) return null;
      return {
        id: r.id,
        color: colorByRouteId[r.id],
        points: list.map(s => ({ lat: s.latitude, lng: s.longitude })),
      };
    }).filter(Boolean);
  }, [filteredRoutes, stopsByRoute, colorByRouteId]);

  // ---------- guards ----------------------------------------------------
  if (!isAuthenticated) {
    return <Empty text="צריך להתחבר כדי לראות את מפת המשימות." />;
  }
  if (roleLoading) return <Empty text="טוען..." />;
  if (!isBusiness) {
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="זמין בחשבון עסקי"
        text="עבור לחשבון עסקי כדי לראות את מפת המשימות."
      />
    );
  }
  if (!canManageRoutes) {
    return (
      <Empty
        icon={<AlertCircle className="h-10 w-10 text-gray-300" />}
        title="הדף הזה למנהלים"
        text="המפה זמינה רק למנהלי החשבון. נהגים יכולים לראות את המפה של המשימות שלהם דרך 'פרטי משימה'."
      />
    );
  }

  // ---------- render ----------------------------------------------------
  const isLoading = routesLoading || stopsLoading;
  const totalStops    = filteredStops.length;
  const mappableStops = mapMarkers.length;
  const missingCoords = totalStops - mappableStops;

  // Active filter count for the mobile filter button badge.
  const activeFilters = [
    dateMode !== 'today',
    !!driverId,
    !!vehicleId,
    statusFilter.length !== 2 || !statusFilter.includes('pending') || !statusFilter.includes('in_progress'),
    !!stopType,
    overdueOnly,
    unassignedOnly,
  ].filter(Boolean).length;

  return (
    <PageShell
      title="מפת משימות"
      subtitle="תצוגה גיאוגרפית של תחנות הצי לפי מסננים. ברירת מחדל: משימות פעילות להיום."
      actions={(
        <button
          type="button"
          onClick={() => setFiltersOpen(o => !o)}
          className="md:hidden flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98] border"
          style={activeFilters > 0
            ? {
                background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
                color: '#FFFFFF',
                borderColor: '#065F46',
                boxShadow: '0 8px 20px rgba(16,185,129,0.32)',
              }
            : { background: '#FFFFFF', color: '#10B981', borderColor: '#D1FAE5' }}
        >
          <Filter className="h-3.5 w-3.5" />
          מסננים
          {activeFilters > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.25)' }}
            >
              {activeFilters}
            </span>
          )}
          {filtersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      )}
    >
      <div className={`md:block ${filtersOpen ? 'block' : 'hidden'} mb-3`}>
        <FilterBar
          dateMode={dateMode} setDateMode={setDateMode}
          customStart={customStart} setCustomStart={setCustomStart}
          customEnd={customEnd} setCustomEnd={setCustomEnd}
          driverId={driverId} setDriverId={setDriverId}
          vehicleId={vehicleId} setVehicleId={setVehicleId}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          stopType={stopType} setStopType={setStopType}
          overdueOnly={overdueOnly} setOverdueOnly={setOverdueOnly}
          unassignedOnly={unassignedOnly} setUnassignedOnly={setUnassignedOnly}
          team={team}
          vehicles={vehicles}
        />
      </div>

      {/* Status strip — quick read of what's plotted right now. Pill
          chips read better than dot-separated text on a colored canvas. */}
      <div className="mb-3 flex items-center gap-1.5 flex-wrap">
        <span
          className="px-2 py-1 rounded-md text-[11px] font-bold inline-flex items-center gap-1 tabular-nums"
          style={{ background: '#D1FAE5', color: '#065F46' }}
          dir="ltr"
        >
          <MapIcon className="h-3 w-3" />
          {filteredRoutes.length} משימות
        </span>
        <span
          className="px-2 py-1 rounded-md text-[11px] font-bold inline-flex items-center gap-1 tabular-nums"
          style={{ background: '#DBEAFE', color: '#1E40AF' }}
          dir="ltr"
        >
          <MapPin className="h-3 w-3" />
          {mappableStops} תחנות במפה
        </span>
        {missingCoords > 0 && (
          <span
            className="px-2 py-1 rounded-md text-[11px] font-bold inline-flex items-center gap-1 tabular-nums"
            style={{ background: '#FEF3C7', color: '#92400E' }}
            dir="ltr"
          >
            <AlertTriangle className="h-3 w-3" />
            {missingCoords} ללא קואורדינטות
          </span>
        )}
        <span
          className="px-2 py-1 rounded-md text-[11px] font-bold"
          style={{ background: '#F0F7F4', color: '#4B5D52' }}
        >
          צביעה לפי {colorByRoute ? 'משימה' : 'נהג'}
        </span>
      </div>

      {/* Layout: map on top, list below on mobile; map + list side-by-side on desktop */}
      <div className="md:grid md:grid-cols-[1fr_360px] md:gap-3">
        {/* Map */}
        <div className="rounded-2xl overflow-hidden border" style={{ borderColor: '#E5EDE8' }}>
          <Suspense fallback={
            <div
              className="h-[40vh] min-h-[280px] flex items-center justify-center text-xs"
              style={{ background: '#F0F7F4', color: '#6B7C72' }}
            >
              טוען מפה...
            </div>
          }>
            <MapCore
              markers={mapMarkers}
              routes={mapRoutes}
              fitToMarkers={true}
              center={mapMarkers.length === 0 ? [32.0853, 34.7818] : undefined}
              emptyStateMessage={
                isLoading
                  ? 'טוען נתוני משימות...'
                  : 'לא נמצאו תחנות לפי המסננים'
              }
              mapHeight="50vh"
              mapMinHeight="320px"
              mapMaxHeight="600px"
              renderPopup={(m) => (
                <FleetMarkerPopup
                  stop={m.stop}
                  route={m.route}
                  totalStops={(stopsByRoute[m.route.id] || []).length}
                  driverName={driverLabel(m.route.assigned_driver_user_id)}
                  vehicleName={vehicleLabel(m.route.vehicle_id)}
                />
              )}
            />
          </Suspense>
        </div>

        {/* Side / Bottom list */}
        <div className="mt-3 md:mt-0">
          <h2
            className="text-sm font-bold mb-2.5 flex items-center gap-2"
            style={{ color: '#0B2912' }}
          >
            <span
              className="inline-block w-1 h-4 rounded-full"
              style={{ background: 'linear-gradient(180deg, #065F46 0%, #34D399 100%)' }}
            />
            משימות מסוננות
          </h2>
          {isLoading ? (
            <Card className="text-center py-8">
              <p className="text-xs" style={{ color: '#6B7C72' }}>טוען...</p>
            </Card>
          ) : filteredRoutes.length === 0 ? (
            <Card className="text-center py-8">
              <p className="text-xs" style={{ color: '#A7B3AB' }}>לא נמצאו משימות לפי המסננים.</p>
            </Card>
          ) : (
            <div className="space-y-2 md:max-h-[55vh] md:overflow-y-auto md:pr-1">
              {filteredRoutes.map(r => (
                <FleetTaskCard
                  key={r.id}
                  route={r}
                  stops={stopsByRoute[r.id] || []}
                  driverName={driverLabel(r.assigned_driver_user_id)}
                  vehicleName={vehicleLabel(r.vehicle_id)}
                  color={colorByRouteId[r.id]}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

// ---------- FilterBar ----------------------------------------------------

function FilterBar({
  dateMode, setDateMode,
  customStart, setCustomStart, customEnd, setCustomEnd,
  driverId, setDriverId,
  vehicleId, setVehicleId,
  statusFilter, setStatusFilter,
  stopType, setStopType,
  overdueOnly, setOverdueOnly,
  unassignedOnly, setUnassignedOnly,
  team, vehicles,
}) {
  const toggleStatus = (val) => {
    setStatusFilter(prev =>
      prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]
    );
  };

  // Pill style helpers — reused across the date / status / stop-type
  // chip rows so all three have identical visual rhythm.
  const activePillStyle = {
    background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
    color: '#FFFFFF',
    borderColor: '#065F46',
    boxShadow: '0 4px 12px rgba(16,185,129,0.25)',
  };
  const inactivePillStyle = {
    background: '#FFFFFF',
    color: '#4B5D52',
    borderColor: '#E5EDE8',
  };
  const labelStyle = { color: '#0B2912' };
  const inputStyle = { background: '#FFFFFF', borderColor: '#D1FAE5', color: '#0B2912' };

  return (
    <Card accent="emerald" className="space-y-3">
      {/* Date range */}
      <div>
        <p className="text-[11px] font-bold mb-1.5" style={labelStyle}>
          <Calendar className="inline h-3 w-3 ms-0 me-1" style={{ color: '#10B981' }} />
          טווח תאריכים
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {[
            { v: 'today',    label: 'היום' },
            { v: 'tomorrow', label: 'מחר' },
            { v: 'week',     label: 'השבוע' },
            { v: 'custom',   label: 'מותאם' },
          ].map(opt => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setDateMode(opt.v)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-[1.03] active:scale-[0.97] border"
              style={dateMode === opt.v ? activePillStyle : inactivePillStyle}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {dateMode === 'custom' && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <DateInput value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-9 rounded-xl text-xs" style={inputStyle} />
            <DateInput value={customEnd}   onChange={(e) => setCustomEnd(e.target.value)}   className="h-9 rounded-xl text-xs" style={inputStyle} />
          </div>
        )}
      </div>

      {/* Driver / Vehicle */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <p className="text-[11px] font-bold mb-1" style={labelStyle}>
            <UserIcon className="inline h-3 w-3 ms-0 me-1" style={{ color: '#10B981' }} />
            נהג
          </p>
          <select
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            className="w-full h-10 rounded-xl border text-sm px-3"
            style={inputStyle}
            dir="rtl"
          >
            <option value="">כל הנהגים</option>
            {team.map(t => (
              <option key={t.user_id} value={t.user_id}>{t.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-[11px] font-bold mb-1" style={labelStyle}>
            <Truck className="inline h-3 w-3 ms-0 me-1" style={{ color: '#10B981' }} />
            רכב
          </p>
          <select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="w-full h-10 rounded-xl border text-sm px-3"
            style={inputStyle}
            dir="rtl"
          >
            <option value="">כל הרכבים</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.id}>
                {v.nickname || v.license_plate || `${v.manufacturer || ''} ${v.model || ''}`.trim()}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Status */}
      <div>
        <p className="text-[11px] font-bold mb-1.5" style={labelStyle}>סטטוס משימה</p>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_OPTIONS.map(opt => {
            const on = statusFilter.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleStatus(opt.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-[1.03] active:scale-[0.97] border"
                style={on ? activePillStyle : inactivePillStyle}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Stop type + flags */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <p className="text-[11px] font-bold mb-1" style={labelStyle}>סוג תחנה</p>
          <select
            value={stopType}
            onChange={(e) => setStopType(e.target.value)}
            className="w-full h-10 rounded-xl border text-sm px-3"
            style={inputStyle}
            dir="rtl"
          >
            {STOP_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <label
            className="flex-1 flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer"
            style={overdueOnly
              ? { background: '#FFFBEB', color: '#92400E', borderColor: '#FCD34D' }
              : { background: '#FFFFFF', color: '#4B5D52', borderColor: '#E5EDE8' }}
          >
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="accent-[#F59E0B]"
            />
            <span>באיחור בלבד</span>
          </label>
          <label
            className="flex-1 flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer"
            style={unassignedOnly
              ? { background: '#EFF6FF', color: '#1E40AF', borderColor: '#BFDBFE' }
              : { background: '#FFFFFF', color: '#4B5D52', borderColor: '#E5EDE8' }}
          >
            <input
              type="checkbox"
              checked={unassignedOnly}
              onChange={(e) => setUnassignedOnly(e.target.checked)}
              className="accent-[#3B82F6]"
            />
            <span>ללא נהג בלבד</span>
          </label>
        </div>
      </div>
    </Card>
  );
}

// ---------- FleetMarkerPopup --------------------------------------------

function FleetMarkerPopup({ stop, route, totalStops, driverName, vehicleName }) {
  const dest = stop.address_text || (stop.latitude && stop.longitude)
    ? { lat: stop.latitude, lng: stop.longitude, address: stop.address_text || '' }
    : null;
  const stopTypeLabel = stop.stop_type ? STOP_TYPE_LABEL[stop.stop_type] : null;
  return (
    <div dir="rtl" className="min-w-[220px]">
      <p className="text-[10px] font-bold text-gray-500 mb-0.5">משימה</p>
      <p className="text-sm font-bold text-gray-900 truncate mb-1.5">{route.title}</p>
      <div className="space-y-0.5 mb-2 text-[11px] text-gray-600">
        <p className="flex items-center gap-1"><UserIcon className="h-3 w-3" /> {driverName}</p>
        <p className="flex items-center gap-1"><Truck className="h-3 w-3" /> {vehicleName}</p>
        <p className="flex items-center gap-1">
          <span className="inline-block w-4 h-4 rounded-full bg-gray-200 text-[9px] font-bold leading-4 text-center text-gray-700">
            {stop.sequence}
          </span>
          תחנה {stop.sequence} מתוך {totalStops}
          {stopTypeLabel && (
            <span className="text-[10px] font-bold text-[#2D5233] bg-[#E8F2EA] px-1.5 py-0.5 rounded-md mr-1">
              {stopTypeLabel}
            </span>
          )}
        </p>
        {stop.address_text && (
          <p className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {stop.address_text}</p>
        )}
        {stop.planned_time && (
          <p>⏱ {new Date(stop.planned_time).toLocaleString('he-IL')}</p>
        )}
        <p className="flex items-center gap-1">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: colorForStop(stop.status) }}
          />
          {labelForStop(stop.status)}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Link
          to={createPageUrl('RouteDetail') + '?id=' + route.id}
          className="text-center px-2 py-1.5 rounded-lg bg-[#2D5233] text-white text-xs font-bold"
        >
          פתח משימה
        </Link>
        {dest && (
          <NavigateButton destination={dest} variant="solid" label="נווט עם Waze / Google Maps" />
        )}
      </div>
    </div>
  );
}

// ---------- FleetTaskCard ------------------------------------------------

function FleetTaskCard({ route, stops, driverName, vehicleName, color }) {
  const total     = stops.length;
  const completed = stops.filter(s => s.status === 'completed').length;
  const allDone   = total > 0 && stops.every(s => isStopTerminal(s.status));
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
  // Card accent ties to route status (matches RouteDetail / DrivingLog
  // vocabulary). The map's per-route color is preserved as a thicker
  // right-edge stripe on top of the accent so the manager can still
  // read "this card = this colored line on the map".
  const accent = ROUTE_STATUS_ACCENT[route.status] || 'amber';
  return (
    <Card
      accent={accent}
      padding="p-3"
      // The system Card already paints a 2px accent-tone stripe at top.
      // Add a 4px right-edge stripe in the route's polyline color so
      // matching the side-list row to its line on the map stays a one-
      // glance affordance. The color comes from the parent's
      // colorByRouteId map (driver-keyed or route-keyed).
      style={{ borderRight: `4px solid ${color}` }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: '#0B2912' }}>{route.title}</p>
          <div className="flex items-center gap-2 text-[10px] flex-wrap mt-1" style={{ color: '#6B7C72' }}>
            <span className="flex items-center gap-1"><UserIcon className="h-2.5 w-2.5" /> {driverName}</span>
            <span className="flex items-center gap-1"><Truck className="h-2.5 w-2.5" /> {vehicleName}</span>
            {route.scheduled_for && (
              <span className="flex items-center gap-1 tabular-nums" dir="ltr">
                <Calendar className="h-2.5 w-2.5" />
                {new Date(route.scheduled_for).toLocaleDateString('he-IL')}
              </span>
            )}
          </div>
        </div>
      </div>
      {total > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="font-bold" style={{ color: '#0B2912' }}>
              {allDone ? 'הושלמה' : 'התקדמות'}
            </span>
            <span className="tabular-nums" style={{ color: '#4B5D52' }} dir="ltr">
              {completed}/{total} תחנות
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#F0F7F4' }}>
            <div
              className="h-full transition-all duration-300"
              style={{ width: `${pct}%`, background: color }}
            />
          </div>
        </div>
      )}
      <Link
        to={createPageUrl('RouteDetail') + '?id=' + route.id}
        className="flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-[11px] font-bold transition-all hover:scale-[1.01] active:scale-[0.99]"
        style={{
          background: '#FFFFFF',
          color: '#10B981',
          border: '1.5px solid #D1FAE5',
        }}
      >
        פתח משימה
        <ChevronLeft className="h-3 w-3" />
      </Link>
    </Card>
  );
}

// ---------- Empty --------------------------------------------------------

function Empty({ icon, title, text }) {
  return (
    <div dir="rtl" className="max-w-md mx-auto py-16 text-center">
      {icon && <div className="flex justify-center mb-3">{icon}</div>}
      {title && <p className="text-sm font-bold text-gray-700 mb-1">{title}</p>}
      <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
    </div>
  );
}


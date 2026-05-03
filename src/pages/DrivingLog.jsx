/**
 * DrivingLog — read-only history of every task in the workspace.
 *
 * Manager-only page. Answers "who drove what / where / when" so the
 * fleet has a searchable record. Filters: date range, vehicle, driver.
 * Each row is clickable and opens RouteDetail with the full timeline.
 *
 * Backend: queries the routes table joined client-side with team
 * directory + vehicles for display names. Driver assignments are
 * implied via routes.assigned_driver_user_id; ad-hoc assignments
 * (manager picks a different driver per task) appear correctly
 * because the row records who actually got the task.
 */
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase, User as UserIcon, Calendar, Search, ChevronLeft,
  AlertCircle, FileText,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { createPageUrl } from '@/utils';
import VehicleLabel, { vehicleDisplayText } from '@/components/shared/VehicleLabel';
import VehiclePicker from '@/components/shared/VehiclePicker';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
// Living Dashboard system - shared with all B2B pages.
import {
  PageShell,
  Card,
  KpiTile,
  AnimatedCount,
} from '@/components/business/system';

// Status mapping keyed to the Living Dashboard accent palette so each
// route row's Card stripe matches the inline status pill. The chip
// colors mirror Routes.jsx (manager jumping between the two doesn't
// have to re-learn the code).
const STATUS_LABEL = {
  pending:     { label: 'ממתין',  accent: 'amber',   chipBg: '#FEF3C7', chipFg: '#92400E' },
  in_progress: { label: 'בביצוע', accent: 'blue',    chipBg: '#DBEAFE', chipFg: '#1E40AF' },
  completed:   { label: 'הושלם',  accent: 'emerald', chipBg: '#D1FAE5', chipFg: '#065F46' },
  cancelled:   { label: 'בוטל',   accent: 'red',     chipBg: '#FEE2E2', chipFg: '#991B1B' },
};
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('he-IL') : '';

export default function DrivingLog() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, canManageRoutes, isLoading: roleLoading } = useWorkspaceRole();

  const [filterDriver, setFilterDriver] = useState('');
  const [filterVehicle, setFilterVehicle] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [search, setSearch] = useState('');

  const enabled = !!accountId && isAuthenticated && isBusiness && canManageRoutes;

  // Routes for this workspace — recent first. We pull the last 500
  // and filter client-side; for very large fleets we'd switch to
  // keyset pagination but the manager use case is mostly "what
  // happened this month / quarter".
  const { data: routes = [], isLoading: routesLoading } = useQuery({
    queryKey: ['driving-log-routes', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routes')
        .select('id, title, status, scheduled_for, vehicle_id, assigned_driver_user_id, created_at, updated_at')
        .eq('account_id', accountId)
        .order('scheduled_for', { ascending: false, nullsFirst: false })
        .order('created_at',   { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 60 * 1000,
  });

  // Team for driver labels.
  const { data: team = [] } = useQuery({
    queryKey: ['driving-log-team', accountId],
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

  // Vehicles for vehicle labels + the picker.
  const { data: vehicles = [] } = useQuery({
    queryKey: ['driving-log-vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const memberById  = useMemo(() => Object.fromEntries(team.map(m => [m.user_id, m])), [team]);
  const vehicleById = useMemo(() => Object.fromEntries(vehicles.map(v => [v.id, v])), [vehicles]);

  const driverName = (id) => memberById[id]?.display_name || '—';
  // Plain-text label for the dropdown, the search haystack, and any
  // place that can't host JSX. The visual list rows use the rich
  // VehicleLabel component below.
  const vehicleLabel = (id) => vehicleDisplayText(vehicleById[id]);

  // Filter routes per active filters. Simple AND across fields.
  const filtered = useMemo(() => {
    const sNorm = search.trim().toLowerCase();
    return routes.filter(r => {
      if (filterDriver  && r.assigned_driver_user_id !== filterDriver) return false;
      if (filterVehicle && r.vehicle_id !== filterVehicle) return false;
      // Date range tested against scheduled_for if present, else created_at.
      const ref = r.scheduled_for || r.created_at?.slice(0, 10);
      if (filterFrom && ref < filterFrom) return false;
      if (filterTo   && ref > filterTo)   return false;
      if (sNorm) {
        const haystack = [
          r.title || '',
          driverName(r.assigned_driver_user_id),
          vehicleLabel(r.vehicle_id),
        ].join(' ').toLowerCase();
        if (!haystack.includes(sNorm)) return false;
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, filterDriver, filterVehicle, filterFrom, filterTo, search, memberById, vehicleById]);

  // KPI counts — derived from the FILTERED set, not the raw list, so
  // toggling filters narrows the headline numbers in step with the
  // visible rows. Hooks order is preserved by computing this BEFORE
  // any guard returns.
  const counts = useMemo(() => {
    const c = { total: filtered.length, in_progress: 0, completed: 0, pending: 0, cancelled: 0 };
    for (const r of filtered) {
      if (c[r.status] !== undefined) c[r.status]++;
    }
    return c;
  }, [filtered]);

  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated) return <Empty text="צריך להתחבר כדי לראות את היומן." />;
  if (!isBusiness) {
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="היומן זמין בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש."
      />
    );
  }
  if (!canManageRoutes) {
    return (
      <Empty
        icon={<AlertCircle className="h-10 w-10 text-gray-300" />}
        title="אין הרשאה ליומן"
        text="הצפייה ביומן הנסיעות שמורה למנהלי החשבון."
      />
    );
  }

  const drivers = team.filter(m => m.role === 'driver' || m.role === 'בעלים' || m.role === 'מנהל');

  return (
    <PageShell
      title="יומן נסיעות"
      subtitle="תיעוד מלא של מי נהג, איפה ומתי"
    >
      {/* KPI Strip — driving log at a glance. Counts reflect the active
          filter so the headline numbers always match the rows below. */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <KpiTile
          label="בתצוגה"
          value={<AnimatedCount value={counts.total} />}
          sub={`${routes.length} סה״כ במאגר`}
          tone="emerald"
        />
        <KpiTile
          label="בביצוע"
          value={<AnimatedCount value={counts.in_progress} />}
          sub={counts.in_progress === 0 ? 'אין נסיעות פעילות' : 'משימות בדרך'}
          tone="blue"
        />
        <KpiTile
          label="הושלמו"
          value={<AnimatedCount value={counts.completed} />}
          sub={counts.completed === 0 ? 'אין השלמות בתצוגה' : 'הסתיימו בהצלחה'}
          tone="purple"
        />
        <KpiTile
          label="ממתינות"
          value={<AnimatedCount value={counts.pending} />}
          sub={counts.pending === 0 ? 'אין משימות פתוחות' : 'מחכות לנהג'}
          tone="amber"
        />
      </section>

      {/* Filters */}
      <Card className="mb-4 space-y-2.5">
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: '#7A6E58' }} />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חפש לפי כותרת, נהג או רכב"
            className="h-11 rounded-xl pr-8 pl-3 text-sm"
            style={{ background: '#FFFFFF', borderColor: '#D1FAE5' }}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <FilterSelect
            label="נהג"
            icon={<UserIcon className="h-3.5 w-3.5" style={{ color: '#7A6E58' }} />}
            value={filterDriver}
            onChange={setFilterDriver}
            options={[{ value: '', label: 'כל הנהגים' }, ...drivers.map(d => ({ value: d.user_id, label: d.display_name }))]}
          />
          {/* Rich, searchable vehicle picker — used to be a native
              <select> that could only show plate text. */}
          <VehiclePicker
            vehicles={vehicles}
            value={filterVehicle}
            onChange={setFilterVehicle}
            placeholder="כל הרכבים"
            allowClear
            size="sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <DateField label="מתאריך" value={filterFrom} onChange={setFilterFrom} />
          <DateField label="עד תאריך" value={filterTo}   onChange={setFilterTo} />
        </div>
      </Card>

      {/* Results */}
      {routesLoading ? (
        <Card className="text-center py-8">
          <p className="text-xs" style={{ color: '#6B7C72' }}>טוען נסיעות...</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-12">
          <FileText className="h-10 w-10 mx-auto mb-3" style={{ color: '#A7F3D0' }} />
          <p className="text-sm font-bold mb-1" style={{ color: '#0B2912' }}>
            {routes.length === 0 ? 'עוד אין נסיעות מתועדות' : 'לא נמצאו נסיעות תואמות'}
          </p>
          <p className="text-xs leading-relaxed" style={{ color: '#6B7C72' }}>
            {routes.length === 0
              ? 'עם יצירת המשימה הראשונה עם נהג, היא תופיע כאן ביומן.'
              : 'נסה לשנות את הסינון או לנקות את החיפוש.'}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {filtered.map(r => {
            const status = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
            return (
              <li key={r.id}>
                <Link
                  to={createPageUrl('RouteDetail') + '?id=' + r.id}
                  className="block transition-transform hover:scale-[1.005] active:scale-[0.995]"
                >
                  <Card accent={status.accent} padding="p-3.5">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="text-sm font-bold truncate" style={{ color: '#0B2912' }}>{r.title}</p>
                          <span
                            className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold"
                            style={{ background: status.chipBg, color: status.chipFg }}
                          >
                            {status.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] flex-wrap mb-1.5" style={{ color: '#6B7C72' }}>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {fmtDate(r.scheduled_for) || fmtDate(r.created_at)}
                          </span>
                          <span className="flex items-center gap-1">
                            <UserIcon className="h-3 w-3" />
                            {driverName(r.assigned_driver_user_id) || 'ללא שיוך'}
                          </span>
                        </div>
                        {/* Vehicle row gets its own line — the VehicleLabel
                            component is taller than the inline date/driver
                            chips and looks cramped wedged between them.
                            interactive=false here because the parent <Link>
                            already navigates to RouteDetail; clicking the
                            inner vehicle would steal the click and bounce
                            the manager to a different page. */}
                        <VehicleLabel
                          vehicle={vehicleById[r.vehicle_id]}
                          size="sm"
                          interactive={false}
                          showSubtitle={false}
                        />
                      </div>
                      <ChevronLeft className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#A7B3AB' }} />
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}

// ---------- helpers ---------------------------------------------------

function FilterSelect({ label, icon, value, onChange, options }) {
  return (
    <div className="space-y-1">
      <span className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500">
        {icon}
        {label}
      </span>
      <Select value={value || 'all'} onValueChange={(v) => onChange(v === 'all' ? '' : v)}>
        <SelectTrigger className="h-10 rounded-xl text-sm">
          <SelectValue placeholder={options[0]?.label || label} />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => (
            <SelectItem key={o.value || 'all'} value={o.value || 'all'}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] font-bold text-gray-500">{label}</span>
      <DateInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-xl text-sm"
      />
    </div>
  );
}

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

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

// Status pills mirror Routes.jsx exactly so a manager who jumps
// between the two pages doesn't have to re-learn the colour code.
const STATUS_LABEL = {
  pending:     { label: 'ממתין',    cls: 'bg-gray-100 text-gray-600' },
  in_progress: { label: 'בביצוע',  cls: 'bg-blue-100 text-blue-700' },
  completed:   { label: 'הושלם',   cls: 'bg-green-100 text-green-700' },
  cancelled:   { label: 'בוטל',    cls: 'bg-red-100 text-red-700' },
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
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">יומן נסיעות</h1>
        <p className="text-xs text-gray-500">
          תיעוד מלא של מי נהג, איפה ומתי. {filtered.length} {filtered.length === 1 ? 'נסיעה' : 'נסיעות'} בתצוגה.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-100 rounded-2xl p-3 mb-4 space-y-2.5">
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חפש לפי כותרת, נהג או רכב"
            className="w-full pr-8 pl-3 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5233]/30"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <FilterSelect
            label="נהג"
            icon={<UserIcon className="h-3.5 w-3.5 text-gray-400" />}
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
      </div>

      {/* Results */}
      {routesLoading ? (
        <p className="text-center text-xs text-gray-400 py-8">טוען נסיעות...</p>
      ) : filtered.length === 0 ? (
        <Empty
          icon={<FileText className="h-10 w-10 text-gray-300" />}
          title={routes.length === 0 ? 'עוד אין נסיעות מתועדות' : 'לא נמצאו נסיעות תואמות'}
          text={routes.length === 0
            ? 'עם יצירת המשימה הראשונה עם נהג, היא תופיע כאן ביומן.'
            : 'נסה לשנות את הסינון או לנקות את החיפוש.'}
          embedded
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map(r => {
            const status = STATUS_LABEL[r.status] || STATUS_LABEL.pending;
            return (
              <li key={r.id}>
                <Link
                  to={createPageUrl('RouteDetail') + '?id=' + r.id}
                  className="block bg-white border border-gray-100 rounded-xl p-3 active:bg-gray-50 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="text-sm font-bold text-gray-900 truncate">{r.title}</p>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${status.cls}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-500 flex-wrap mb-1.5">
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
                    <ChevronLeft className="h-4 w-4 text-gray-300 shrink-0 mt-0.5" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- helpers ---------------------------------------------------

function FilterSelect({ label, icon, value, onChange, options }) {
  return (
    <label className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-gray-200 bg-white cursor-pointer">
      {icon}
      <span className="text-[11px] font-bold text-gray-500 shrink-0">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-sm bg-transparent focus:outline-none truncate"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-gray-200 bg-white cursor-pointer">
      <span className="text-[11px] font-bold text-gray-500 shrink-0">{label}:</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-sm bg-transparent focus:outline-none"
      />
    </label>
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

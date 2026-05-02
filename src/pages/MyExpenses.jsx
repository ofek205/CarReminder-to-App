/**
 * MyExpenses — vehicle expenses screen for PRIVATE accounts.
 *
 * The B2B managers' /Expenses page is separate. This one is built for
 * a single-owner / few-vehicles use case: pick a vehicle, see the
 * yearly summary, scan a receipt, log fuel, etc.
 *
 * Reads via the v_vehicle_expense_feed view + fn_list_vehicle_expenses
 * RPC — the feed merges manual expenses with maintenance_logs.cost and
 * repair_logs.cost so the user sees ALL their costs without us
 * duplicating the value into a second table.
 *
 * Edit/delete: only manual rows (source_type='expense'). Maintenance
 * and repair rows route the user to their dedicated dialogs on the
 * VehicleDetail page (deep-link).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, ScanLine, Receipt, Loader2, Wallet, ChevronDown } from 'lucide-react';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';

import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import useVehicleExpenses, { defaultYearPeriod } from '@/hooks/useVehicleExpenses';
import { getExpenseDateBounds } from '@/services/expenses';
import { C, getTheme } from '@/lib/designTokens';
import { createPageUrl } from '@/utils';

import VehicleIcon from '@/components/shared/VehicleIcon';
import VehicleImage, { hasVehiclePhoto } from '@/components/shared/VehicleImage';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

import PeriodFilter from '@/components/expenses/PeriodFilter';
import CategoryFilter from '@/components/expenses/CategoryFilter';
import ExpenseRow from '@/components/expenses/ExpenseRow';
import ExpenseFormDialog from '@/components/expenses/ExpenseFormDialog';

const fmtMoney = (n, currency = 'ILS') => new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency,
  maximumFractionDigits: 0,
}).format(Number(n) || 0);

function periodLabel(period) {
  if (!period) return '';
  if (period.type === 'year')  return period.year;
  if (period.type === 'month') return `${HEBREW_MONTHS[period.month - 1]} ${period.year}`;
  if (period.type === 'range') return 'בטווח שנבחר';
  return '';
}

// Title for the "no rows" card. Composed carefully so the result reads
// naturally in Hebrew — no "ב2026" (missing dash), no "בבטווח" (double
// preposition), and a separate variant when a category filter is active.
function emptyListTitle(period, categories) {
  if (categories && categories.length > 0) {
    return 'אין הוצאות שמתאימות לסינון הנוכחי';
  }
  if (!period) return 'אין הוצאות';
  if (period.type === 'year')  return `אין הוצאות בשנת ${period.year}`;
  if (period.type === 'month') return `אין הוצאות ב${HEBREW_MONTHS[period.month - 1]} ${period.year}`;
  if (period.type === 'range') return 'אין הוצאות בטווח שנבחר';
  return 'אין הוצאות';
}
const HEBREW_MONTHS = [
  'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר',
];

/**
 * Vehicle pick — shown only when the user has more than one vehicle.
 * Single-vehicle accounts auto-select and the picker is hidden.
 */
function VehiclePicker({ vehicles, selectedId, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = vehicles.find(v => v.id === selectedId) || vehicles[0];
  if (!selected) return null;
  const T = getTheme(selected.vehicle_type, selected.nickname, selected.manufacturer);
  const hasPhoto = hasVehiclePhoto(selected);
  const name = selected.nickname || [selected.manufacturer, selected.model].filter(Boolean).join(' ');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-3 p-3 rounded-2xl transition-all active:scale-[0.99]"
          style={{
            background: `linear-gradient(135deg, ${T.light} 0%, #ffffff 100%)`,
            border: `1.5px solid ${T.primary}40`,
          }}
          dir="rtl"
        >
          <div className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center shrink-0" style={{ background: T.light }}>
            {hasPhoto
              ? <VehicleImage vehicle={selected} alt="" className="w-full h-full object-cover" />
              : <VehicleIcon vehicle={selected} className="w-5 h-5" style={{ color: T.primary }} />}
          </div>
          <div className="flex-1 text-right min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: T.text }}>{name}</p>
            {selected.license_plate && (
              <p className="text-[10px] mt-0.5" style={{ color: T.muted }} dir="ltr">
                {selected.license_plate}
              </p>
            )}
          </div>
          <ChevronDown className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: T.primary }} />
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" align="start" className="w-[calc(100vw-32px)] max-w-sm p-2 rounded-2xl">
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {vehicles.map(v => {
            const Tv = getTheme(v.vehicle_type, v.nickname, v.manufacturer);
            const sel = v.id === selectedId;
            const photo = hasVehiclePhoto(v);
            const n = v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ');
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => { onChange(v.id); setOpen(false); }}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl text-right transition-all hover:bg-gray-50"
                style={sel ? { background: Tv.light } : {}}
              >
                <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center shrink-0" style={{ background: Tv.light }}>
                  {photo
                    ? <VehicleImage vehicle={v} alt="" className="w-full h-full object-cover" />
                    : <VehicleIcon vehicle={v} className="w-4 h-4" style={{ color: Tv.primary }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: Tv.text }}>{n}</p>
                  {v.license_plate && (
                    <p className="text-[10px]" style={{ color: Tv.muted }} dir="ltr">{v.license_plate}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function MyExpenses() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, isLoading: roleLoading } = useWorkspaceRole();

  const [period, setPeriod]         = useState(defaultYearPeriod());
  const [categories, setCategories] = useState([]);
  const [vehicleId, setVehicleId]   = useState(null);
  const [dialog, setDialog]         = useState(null); // null | {mode, initial?, scanFirst?}

  // Vehicles for the picker
  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ['my-expenses-vehicles', accountId],
    queryFn:  () => db.vehicles.filter({ account_id: accountId }),
    enabled:  !!accountId,
    staleTime: 5 * 60 * 1000,
  });

  // Auto-select when there's exactly one vehicle, or after vehicles load.
  // If the user switches to a workspace where the previously-selected
  // vehicle doesn't exist, fall back to the first one in the new list.
  useEffect(() => {
    if (vehicles.length === 0) return;
    const stillExists = vehicleId && vehicles.some(v => v.id === vehicleId);
    if (!stillExists) setVehicleId(vehicles[0].id);
  }, [vehicles, vehicleId]);

  // When vehicle changes, reset the category filter — categories are
  // a "narrow my view" tool that's almost always vehicle-specific
  // ("show me only fuel"). Carrying it over to a different vehicle
  // hides rows the user expects to see and confuses the empty state.
  // Date period intentionally stays — that's a temporal preference,
  // not vehicle-specific.
  const prevVehicleIdRef = useRef(vehicleId);
  useEffect(() => {
    if (prevVehicleIdRef.current && prevVehicleIdRef.current !== vehicleId) {
      setCategories([]);
    }
    prevVehicleIdRef.current = vehicleId;
  }, [vehicleId]);

  // Read expenses
  const {
    rows, totals, isLoading, hasMore, fetchMore, isFetchingMore, invalidate,
  } = useVehicleExpenses({ vehicleId, period, categories });

  // Date bounds — feeds the year picker so the user only sees years
  // that actually have data. Cheap query (single MIN/MAX), refetched
  // when vehicle changes.
  const { data: dateBounds } = useQuery({
    queryKey: ['my-expenses-bounds', vehicleId],
    queryFn:  () => getExpenseDateBounds({ vehicleId }),
    enabled:  !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
  const earliestYear = dateBounds?.earliest
    ? Number(String(dateBounds.earliest).slice(0, 4))
    : null;

  const monthsInPeriod = useMemo(() => {
    if (period?.type === 'year')  return 12;
    if (period?.type === 'month') return 1;
    if (period?.type === 'range') {
      const f = new Date(period.from), t = new Date(period.to);
      const d = (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()) + 1;
      return Math.max(1, d);
    }
    return 1;
  }, [period]);
  const monthlyAvg = totals.total / monthsInPeriod;

  // Row click — manual rows open the edit dialog; treatment/repair
  // rows are read-only here, so we deep-link to VehicleDetail with a
  // hash that scrolls to the maintenance log section. Both
  // 'maintenance' and 'repair' source types share the same target —
  // MaintenanceSection on VehicleDetail covers both maintenance_logs
  // entries (maintenance_logs.type='תיקון' for repairs).
  const onRowClick = (row) => {
    if (row.source_type === 'expense') {
      setDialog({ mode: 'edit', initial: row });
      return;
    }
    navigate(`${createPageUrl('VehicleDetail')}?id=${row.vehicle_id}#vd-maintenance`);
  };

  if (authLoading || roleLoading) return <LoadingSpinner />;

  // Guard: not signed in → tell user to sign in
  if (!isAuthenticated) {
    return (
      <EmptyCard
        icon={<Wallet className="w-10 h-10" style={{ color: C.muted }} />}
        title="צריך להתחבר"
        text="התחבר כדי לראות את ההוצאות של הרכבים שלך"
      />
    );
  }

  // Guard: no account_id yet (still bootstrapping). Show spinner instead
  // of flashing "no vehicles" before the data lands.
  if (!accountId) return <LoadingSpinner />;

  // Guard: B2B context — /MyExpenses is the personal flow. Business
  // users have their own /Expenses with manager controls. Redirect
  // them rather than confusing two parallel UIs.
  if (isBusiness) {
    return (
      <EmptyCard
        icon={<Wallet className="w-10 h-10" style={{ color: C.muted }} />}
        title="המסך הזה לחשבון פרטי"
        text="בחשבון עסקי, ניהול ההוצאות נמצא בלשונית הוצאות בתפריט העסק."
        actionLabel="פתח הוצאות עסקי"
        onAction={() => navigate(createPageUrl('Expenses'))}
      />
    );
  }

  // Guard: still loading vehicles → spinner. Without this the user
  // sees a flash of "no vehicles" while the query hasn't returned.
  if (vehiclesLoading) return <LoadingSpinner />;

  // Guard: no vehicles in this private account
  if (vehicles.length === 0) {
    return (
      <EmptyCard
        icon={<Wallet className="w-10 h-10" style={{ color: C.muted }} />}
        title="אין רכב בחשבון"
        text="הוסף רכב כדי להתחיל לעקוב אחר ההוצאות"
        actionLabel="הוסף רכב"
        onAction={() => navigate(createPageUrl('AddVehicle'))}
      />
    );
  }

  return (
    <div dir="rtl" className="-mx-4 -mt-4 px-4 py-5 sm:px-6 lg:px-8" style={{ minHeight: '100dvh' }}>
      <div className="max-w-3xl mx-auto space-y-3">

        {/* Header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2" style={{ color: C.text }}>
            <Wallet className="w-5 h-5" style={{ color: C.primary }} />
            הוצאות רכב
          </h1>
          <p className="text-xs sm:text-sm mt-0.5" style={{ color: C.muted }}>
            נהל את כל ההוצאות של הרכב במקום אחד
          </p>
        </div>

        {/* Vehicle picker — only when the user has 2+ vehicles */}
        {vehicles.length > 1 && (
          <VehiclePicker
            vehicles={vehicles}
            selectedId={vehicleId}
            onChange={setVehicleId}
          />
        )}

        {/* Summary card */}
        <SummaryCard
          period={period}
          total={totals.total}
          count={totals.count}
          monthlyAvg={monthlyAvg}
          loading={isLoading}
        />

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodFilter period={period} onChange={setPeriod} earliestYear={earliestYear} />
          <CategoryFilter value={categories} onChange={setCategories} />
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDialog({ mode: 'add' })}
            disabled={!vehicleId}
            className="h-12 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: C.primary, color: '#fff', boxShadow: `0 4px 14px ${C.primary}30` }}
          >
            <Plus className="w-4 h-4" />
            הוסף הוצאה
          </button>
          <button
            type="button"
            onClick={() => setDialog({ mode: 'add', scanFirst: true })}
            disabled={!vehicleId}
            className="h-12 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 border bg-white transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ borderColor: C.border, color: C.primary }}
          >
            <ScanLine className="w-4 h-4" />
            סרוק חשבונית
          </button>
        </div>

        {/* List */}
        <div className="space-y-2">
          {isLoading && rows.length === 0 && (
            <div className="py-12 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin" style={{ color: C.primary }} /></div>
          )}
          {!isLoading && rows.length === 0 && (
            <EmptyCard
              icon={<Receipt className="w-10 h-10" style={{ color: C.muted }} />}
              title={emptyListTitle(period, categories)}
              text="הוסף הוצאה ידנית או סרוק חשבונית כדי להתחיל"
            />
          )}
          {rows.map(row => (
            <ExpenseRow
              key={`${row.source_type}-${row.id}`}
              row={row}
              onClick={onRowClick}
            />
          ))}

          {hasMore && (
            <button
              type="button"
              onClick={() => fetchMore()}
              disabled={isFetchingMore}
              className="w-full h-11 rounded-xl text-sm font-bold border bg-white transition-all active:scale-[0.99] disabled:opacity-60"
              style={{ borderColor: C.border, color: C.primary }}
            >
              {isFetchingMore ? 'טוען...' : 'טען עוד'}
            </button>
          )}
        </div>
      </div>

      {/* Add / Edit / Scan dialog */}
      {dialog && (
        <ExpenseFormDialog
          open={!!dialog}
          onClose={() => setDialog(null)}
          onSaved={() => { invalidate(); }}
          accountId={accountId}
          userId={user?.id}
          vehicleId={vehicleId}
          initial={dialog.mode === 'edit' ? dialog.initial : null}
          scanFirst={!!dialog.scanFirst}
        />
      )}
    </div>
  );
}

/** Summary card — total + count + monthly average. */
function SummaryCard({ period, total, count, monthlyAvg, loading }) {
  const label = period?.type === 'year'  ? `סך ההוצאות בשנת ${period.year}`
              : period?.type === 'month' ? `סך ההוצאות ב${HEBREW_MONTHS[period.month - 1]} ${period.year}`
              : 'סך ההוצאות בטווח שנבחר';
  return (
    <div
      className="rounded-3xl p-4 sm:p-5"
      style={{
        background: 'linear-gradient(135deg, #2D5233 0%, #4B7A53 100%)',
        boxShadow: '0 8px 24px rgba(45,82,51,0.18)',
        color: '#fff',
      }}
    >
      <p className="text-[11px] font-medium opacity-90">{label}</p>
      <p className="text-3xl sm:text-4xl font-black tabular-nums mt-1" dir="ltr">
        {loading ? '—' : fmtMoney(total)}
      </p>
      <p className="text-xs opacity-90 mt-1">
        {count > 0
          ? <>{count} הוצאות{period?.type !== 'month' ? <> · ממוצע {fmtMoney(monthlyAvg)} לחודש</> : null}</>
          : 'אין הוצאות בתקופה'}
      </p>
    </div>
  );
}

function EmptyCard({ icon, title, text, actionLabel, onAction }) {
  return (
    <div className="text-center py-10 px-4 rounded-3xl" style={{ background: '#F9FAFB', border: `1px dashed ${C.border}` }}>
      <div className="flex justify-center mb-3">{icon}</div>
      <p className="text-sm font-bold" style={{ color: C.text }}>{title}</p>
      <p className="text-xs mt-1" style={{ color: C.muted }}>{text}</p>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 h-10 px-5 rounded-xl text-sm font-bold text-white"
          style={{ background: C.primary }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

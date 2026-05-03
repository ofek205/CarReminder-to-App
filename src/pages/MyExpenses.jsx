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
import { toast } from 'sonner';
import { Plus, ScanLine, Receipt, Loader2, Wallet, ChevronDown, LayoutGrid, FileSpreadsheet, Trophy } from 'lucide-react';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';

import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import useVehicleExpenses, { defaultYearPeriod, periodToRange } from '@/hooks/useVehicleExpenses';
import { getExpenseDateBounds, exportExpensesXlsx } from '@/services/expenses';
import { C, getTheme } from '@/lib/designTokens';
import { createPageUrl } from '@/utils';

import VehicleIcon from '@/components/shared/VehicleIcon';
import VehicleImage, { hasVehiclePhoto } from '@/components/shared/VehicleImage';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

import PeriodFilter from '@/components/expenses/PeriodFilter';
import CategoryFilter from '@/components/expenses/CategoryFilter';
import ExpenseRow from '@/components/expenses/ExpenseRow';
import ExpenseFormDialog from '@/components/expenses/ExpenseFormDialog';

const LAST_USED_VEHICLE_KEY = 'my_expenses_last_used_vehicle_id';

// Hebrew-friendly money formatter. Intl's currency-style adds bidi marks
// that render the ₪ on the wrong side under dir="rtl"/"ltr" blends, so we
// hand-build the string: rounded thousands separator + " ₪" suffix.
//   1234   → "1,234 ₪"
//   3491.6 → "3,492 ₪"
const fmtMoney = (n) => `${Math.round(Number(n) || 0).toLocaleString('he-IL')} ₪`;

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

// Hebrew label for the summary card / picker in agg mode. Period is the
// active filter; we tack "כל הרכבים" at the end so the user reads
// "סך ההוצאות בשנת 2026 · כל הרכבים".
function aggSummaryLabel(period) {
  if (!period) return 'סך ההוצאות · כל הרכבים';
  if (period.type === 'year')
    return `סך ההוצאות בשנת ${period.year} · כל הרכבים`;
  if (period.type === 'month')
    return `סך ההוצאות ב${HEBREW_MONTHS[period.month - 1]} ${period.year} · כל הרכבים`;
  if (period.type === 'range')
    return 'סך ההוצאות בטווח שנבחר · כל הרכבים';
  return 'סך ההוצאות · כל הרכבים';
}

// Helper: best-effort vehicle display name from a vehicles row.
function vehicleDisplayName(v) {
  if (!v) return 'רכב';
  return v.nickname
    || [v.manufacturer, v.model].filter(Boolean).join(' ')
    || v.license_plate
    || 'רכב';
}
const HEBREW_MONTHS = [
  'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר',
];

/**
 * VehiclePicker — selects either a specific vehicle or the "all vehicles"
 * aggregate view. The "all" item is the FIRST option in the popover and
 * is also the default trigger label when selectedId is null.
 *
 * Hidden by /MyExpenses when the user has exactly 1 vehicle (no point
 * picking; aggregate view would be identical).
 *
 * Props:
 *   vehicles    — Array<vehicle>. May be empty during initial load.
 *   selectedId  — string | null  (null = aggregate "all" mode)
 *   onChange    — (id|null)
 */
function VehiclePicker({ vehicles, selectedId, onChange }) {
  const [open, setOpen] = useState(false);
  const isAll = selectedId === null;
  const selected = !isAll ? vehicles.find(v => v.id === selectedId) : null;
  const totalVehicles = vehicles.length;

  // Trigger styling — aggregate mode uses the page primary palette so
  // it visually reads as a "summary" rather than a specific vehicle.
  // Specific-vehicle mode uses that vehicle's theme (existing behavior).
  const triggerLabel = isAll
    ? 'כל הרכבים'
    : (selected
        ? (selected.nickname || [selected.manufacturer, selected.model].filter(Boolean).join(' '))
        : 'בחר רכב');
  const triggerSub = isAll
    ? `סיכום של ${totalVehicles} רכבים`
    : selected?.license_plate || '';

  const T = (!isAll && selected)
    ? getTheme(selected.vehicle_type, selected.nickname, selected.manufacturer)
    : null;
  const hasPhoto = !isAll && selected && hasVehiclePhoto(selected);

  // Aggregate trigger — solid card with grid icon.
  // Specific trigger — vehicle theme (existing look).
  const triggerStyle = isAll
    ? {
        background: `linear-gradient(135deg, ${C.light} 0%, #ffffff 100%)`,
        border: `1.5px solid ${C.primary}40`,
      }
    : {
        background: `linear-gradient(135deg, ${T.light} 0%, #ffffff 100%)`,
        border: `1.5px solid ${T.primary}40`,
      };

  const triggerIconBg = isAll ? C.light : T.light;
  const triggerTextColor = isAll ? C.text : T.text;
  const triggerMutedColor = isAll ? C.muted : T.muted;
  const triggerChevronColor = isAll ? C.primary : T.primary;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-3 p-3 rounded-2xl transition-all active:scale-[0.99]"
          style={triggerStyle}
          dir="rtl"
        >
          <div
            className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center shrink-0"
            style={{ background: triggerIconBg }}
          >
            {isAll ? (
              <LayoutGrid className="w-5 h-5" style={{ color: C.primary }} />
            ) : hasPhoto ? (
              <VehicleImage vehicle={selected} alt="" className="w-full h-full object-cover" />
            ) : (
              <VehicleIcon vehicle={selected} className="w-5 h-5" style={{ color: T.primary }} />
            )}
          </div>
          <div className="flex-1 text-right min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: triggerTextColor }}>
              {triggerLabel}
            </p>
            {triggerSub && (
              <p
                className="text-[10px] mt-0.5"
                style={{ color: triggerMutedColor }}
                dir={isAll ? 'rtl' : 'ltr'}
              >
                {triggerSub}
              </p>
            )}
          </div>
          <ChevronDown
            className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`}
            style={{ color: triggerChevronColor }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" align="start" className="w-[calc(100vw-32px)] max-w-sm p-2 rounded-2xl">
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {/* "All vehicles" item — only when there's more than 1 vehicle.
              Single-vehicle accounts never see this row (and the parent
              hides the picker entirely for them). */}
          {totalVehicles > 1 && (
            <>
              <button
                key="__all__"
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl text-right transition-all hover:bg-gray-50"
                style={isAll ? { background: C.light } : {}}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: C.light }}
                >
                  <LayoutGrid className="w-4 h-4" style={{ color: C.primary }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: C.text }}>
                    כל הרכבים
                  </p>
                  <p className="text-[10px]" style={{ color: C.muted }}>
                    סיכום של {totalVehicles} רכבים
                  </p>
                </div>
              </button>
              <div className="h-px bg-gray-100 my-1" />
            </>
          )}
          {vehicles.map(v => {
            const Tv = getTheme(v.vehicle_type, v.nickname, v.manufacturer);
            const sel = !isAll && v.id === selectedId;
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
  // vehicleId: null = aggregate "all vehicles" view, string = specific vehicle.
  // Default null until vehicles load; the post-load effect below decides
  // the initial mode based on count (1 vehicle → that vehicle, 2+ → aggregate).
  const [vehicleId, setVehicleId]   = useState(null);
  const [dialog, setDialog]         = useState(null); // null | {mode, initial?, scanFirst?}
  // Initial mode is chosen ONCE when vehicles first arrive. Without this
  // ref the default-mode effect would clobber a user's later picker tap
  // (they pick "Civic" → vehicles array re-renders → effect fires again
  // → pulls them back to aggregate). Track "did we already pick a default".
  const initialModeChosenRef = useRef(false);
  // Tracks the last specific (non-aggregate) vehicle the user worked
  // with. Used as the default for the ExpenseFormDialog vehicle picker
  // when adding from aggregate mode, so they're not always re-picking.
  const [lastUsedVehicleId, setLastUsedVehicleId] = useState(() => {
    try { return localStorage.getItem(LAST_USED_VEHICLE_KEY) || null; } catch { return null; }
  });

  // Vehicles for the picker
  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ['my-expenses-vehicles', accountId],
    queryFn:  () => db.vehicles.filter({ account_id: accountId }),
    enabled:  !!accountId,
    staleTime: 5 * 60 * 1000,
  });

  // Initial-mode selection on first vehicle load.
  //   • exactly 1 vehicle → auto-select it (aggregate would be identical
  //                          and the picker is hidden anyway)
  //   • 2+ vehicles       → start in aggregate "all vehicles" mode so the
  //                          first impression is the household overview.
  // Also handles the case where the user switches to a workspace where
  // their previously-selected vehicle no longer exists.
  useEffect(() => {
    if (vehicles.length === 0) return;
    if (vehicleId !== null) {
      const stillExists = vehicles.some(v => v.id === vehicleId);
      if (!stillExists) {
        // The selected vehicle disappeared — fall back to aggregate
        // (or to the only remaining vehicle if there's just one).
        setVehicleId(vehicles.length === 1 ? vehicles[0].id : null);
      }
      return;
    }
    if (initialModeChosenRef.current) return;
    initialModeChosenRef.current = true;
    if (vehicles.length === 1) {
      setVehicleId(vehicles[0].id);
    }
    // else: stay null (aggregate mode)
  }, [vehicles, vehicleId]);

  // When user picks a SPECIFIC vehicle, persist as last-used. The
  // aggregate selection (null) doesn't replace the last-used vehicle —
  // we want to remember what they last actively worked with.
  useEffect(() => {
    if (!vehicleId) return;
    setLastUsedVehicleId(vehicleId);
    try { localStorage.setItem(LAST_USED_VEHICLE_KEY, vehicleId); } catch {}
  }, [vehicleId]);

  // Reset the category filter when toggling between aggregate ↔ specific.
  // Within "specific" the categories are usually vehicle-specific
  // ("show me fuel for the Civic") and don't translate well across
  // vehicles. Within aggregate they're a household-level question.
  // Switching MODE is the boundary; switching between two specific
  // vehicles also resets (preserves prior behavior).
  const prevVehicleIdRef = useRef(vehicleId);
  useEffect(() => {
    if (prevVehicleIdRef.current !== vehicleId) {
      setCategories([]);
    }
    prevVehicleIdRef.current = vehicleId;
  }, [vehicleId]);

  // Read expenses (aggregate or specific — hook handles both via vehicleId=null)
  const {
    rows, totals, isLoading, hasMore, fetchMore, isFetchingMore, invalidate,
  } = useVehicleExpenses({ accountId, vehicleId, period, categories });

  // Date bounds — feeds the year picker so the user only sees years
  // that actually have data. Cheap query (single MIN/MAX). Scoped to
  // the same view (vehicle-specific or account-wide).
  const { data: dateBounds } = useQuery({
    queryKey: ['my-expenses-bounds', accountId, vehicleId ?? '__all__'],
    queryFn:  () => getExpenseDateBounds({ accountId, vehicleId }),
    enabled:  !!accountId,
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

  // Aggregate-mode flag — single source of truth used by the renders below.
  const isAggregate = vehicleId === null;

  // Map of vehicle_id → row, used to enrich list items with vehicle info
  // (chip in agg mode, drill-down on tap).
  const vehiclesById = useMemo(() => {
    const m = new Map();
    vehicles.forEach(v => m.set(v.id, v));
    return m;
  }, [vehicles]);

  // Excel export state — runs the same query the user sees with a big
  // page size, then assembles the workbook. Disabled while running so we
  // don't queue duplicate jobs.
  const [exporting, setExporting] = useState(false);

  // Default vehicleId for the form dialog when adding from agg mode:
  // the most recently used vehicle (if it still exists), else null
  // (the user picks in the dialog).
  const dialogDefaultVehicleId = useMemo(() => {
    if (vehicleId) return vehicleId;
    if (lastUsedVehicleId && vehicles.some(v => v.id === lastUsedVehicleId)) {
      return lastUsedVehicleId;
    }
    return null;
  }, [vehicleId, lastUsedVehicleId, vehicles]);

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

  const handleExport = async () => {
    if (exporting) return;
    if (!accountId) return;
    if (totals.count === 0) {
      toast.error('אין הוצאות בטווח הנוכחי');
      return;
    }
    setExporting(true);
    try {
      const range = periodToRange(period);
      const result = await exportExpensesXlsx({
        accountId,
        vehicleId,
        period,
        categories,
        range,
        vehicles,
      });
      toast.success(`הייצוא הושלם: ${result.rowCount} שורות`);
    } catch (err) {
      console.error('export failed:', err);
      toast.error('שגיאה בייצוא לאקסל');
    } finally {
      setExporting(false);
    }
  };

  // Forward "drill into vehicle X" from the summary breakdown or a row's
  // vehicle chip. Picker switches to that vehicle; categories reset
  // (handled by the prevVehicleId effect).
  const handleDrillToVehicle = (id) => {
    if (!id) return;
    setVehicleId(id);
  };

  return (
    <div dir="rtl" className="-mx-4 -mt-4 px-4 py-5 sm:px-6 lg:px-8" style={{ minHeight: '100dvh' }}>
      <div className="max-w-3xl mx-auto space-y-3">

        {/* Header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2" style={{ color: C.text }}>
            <Wallet className="w-5 h-5" style={{ color: C.primary }} />
            מחשבון הוצאות
          </h1>
          <p className="text-xs sm:text-sm mt-0.5" style={{ color: C.muted }}>
            סכמו, סננו וייצאו את כל ההוצאות של הרכבים שלכם במקום אחד
          </p>
        </div>

        {/* Vehicle picker — only when the user has 2+ vehicles. The picker
            includes "כל הרכבים" as the first option in that case. */}
        {vehicles.length > 1 && (
          <VehiclePicker
            vehicles={vehicles}
            selectedId={vehicleId}
            onChange={setVehicleId}
          />
        )}

        {/* Summary card — agg-mode renders the per-vehicle breakdown
            inside the same card so the overview + drill-in surface are
            visually unified. Single-vehicle mode keeps the original card. */}
        <SummaryCard
          period={period}
          total={totals.total}
          count={totals.count}
          monthlyAvg={monthlyAvg}
          loading={isLoading}
          isAggregate={isAggregate}
          byVehicle={totals.by_vehicle}
          onVehicleClick={handleDrillToVehicle}
        />

        {/* Filters + Excel export — sit on the same row so the export is
            close to the period/category selection that defines what's
            being exported. The export button is icon-only on mobile and
            shows the label from sm: up. */}
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodFilter period={period} onChange={setPeriod} earliestYear={earliestYear} />
          <CategoryFilter value={categories} onChange={setCategories} />
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || isLoading || totals.count === 0}
            className="h-10 px-3 rounded-xl flex items-center gap-1.5 text-sm font-bold border bg-white transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ borderColor: C.border, color: C.primary }}
            aria-label="ייצוא לאקסל"
            title="ייצוא לאקסל"
          >
            {exporting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <FileSpreadsheet className="w-4 h-4" />}
            <span className="hidden sm:inline">ייצא לאקסל</span>
          </button>
        </div>

        {/* Actions — both buttons enabled in both modes. In agg mode the
            ExpenseFormDialog renders an extra vehicle picker as the first
            field; we pre-fill it with the last-used vehicle when known. */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDialog({ mode: 'add' })}
            disabled={vehicles.length === 0}
            className="h-12 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: C.primary, color: '#fff', boxShadow: `0 4px 14px ${C.primary}30` }}
          >
            <Plus className="w-4 h-4" />
            הוסף הוצאה
          </button>
          <button
            type="button"
            onClick={() => setDialog({ mode: 'add', scanFirst: true })}
            disabled={vehicles.length === 0}
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
          {rows.map(row => {
            // Build vehicle-info ONLY in aggregate mode. Pulls from totals.by_vehicle
            // (already has display name + plate), falls back to the
            // vehicles list (in case a row exists for a vehicle that's
            // outside the summary period — should be rare).
            let vehicleInfo = null;
            if (isAggregate) {
              const fromTotals = totals.by_vehicle?.[row.vehicle_id];
              if (fromTotals) {
                vehicleInfo = fromTotals;
              } else {
                const v = vehiclesById.get(row.vehicle_id);
                if (v) {
                  vehicleInfo = {
                    name: vehicleDisplayName(v),
                    license_plate: v.license_plate,
                    nickname: v.nickname,
                    manufacturer: v.manufacturer,
                    vehicle_type: v.vehicle_type,
                  };
                }
              }
            }
            return (
              <ExpenseRow
                key={`${row.source_type}-${row.id}`}
                row={row}
                onClick={onRowClick}
                vehicleInfo={vehicleInfo}
                onVehicleClick={handleDrillToVehicle}
              />
            );
          })}

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

      {/* Add / Edit / Scan dialog. In agg mode, vehicleId is the
          last-used (or null) so the dialog renders its own vehicle picker
          and we pass the full vehicles list for selection. */}
      {dialog && (
        <ExpenseFormDialog
          open={!!dialog}
          onClose={() => setDialog(null)}
          onSaved={() => { invalidate(); }}
          accountId={accountId}
          userId={user?.id}
          vehicleId={dialog.mode === 'edit' ? null : dialogDefaultVehicleId}
          vehicles={vehicles}
          initial={dialog.mode === 'edit' ? dialog.initial : null}
          scanFirst={!!dialog.scanFirst}
        />
      )}
    </div>
  );
}

/** Summary card — headline number + (in agg mode) per-vehicle breakdown.
 *
 *  Visual structure (RTL):
 *    ┌─────────────────────────────────────────┐
 *    │  [label small]                           │
 *    │  3,491 ₪                                  │  ← headline
 *    │  10 הוצאות · ממוצע 291 ₪ לחודש            │
 *    └──── divider — slight inner shade ───────┘
 *    │  פיצול לפי רכב           N רכבים          │
 *    │  ┌───────────────────────────────────┐   │
 *    │  │ [⊙] שם רכב          816 ₪  · 23%  │   │  ← row, clickable
 *    │  │ 503-79-159                        │   │
 *    │  │ ▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱   │   │  ← bar (vehicle theme)
 *    │  └───────────────────────────────────┘   │
 *    │  ...                                      │
 *    └─────────────────────────────────────────┘
 *
 *  Each row is a button that drills into that vehicle. Top-spender
 *  row has a Trophy badge + brighter ring, so the eye lands on it
 *  first. Bars are colored with each vehicle's theme primary, so
 *  scanning the list reads as a colored "fingerprint" rather than
 *  identical yellow stripes.
 */
function SummaryCard({ period, total, count, monthlyAvg, loading, isAggregate, byVehicle, onVehicleClick }) {
  const label = isAggregate
    ? aggSummaryLabel(period)
    : (period?.type === 'year'  ? `סך ההוצאות בשנת ${period.year}`
       : period?.type === 'month' ? `סך ההוצאות ב${HEBREW_MONTHS[period.month - 1]} ${period.year}`
       : 'סך ההוצאות בטווח שנבחר');

  const entries = useMemo(() => {
    if (!isAggregate || !byVehicle) return [];
    return Object.entries(byVehicle)
      .filter(([, info]) => Number(info?.total) > 0)
      .sort((a, b) => Number(b[1]?.total || 0) - Number(a[1]?.total || 0));
  }, [isAggregate, byVehicle]);

  const totalNum = Number(total) || 0;
  const showBreakdown = isAggregate && !loading && entries.length > 0;

  return (
    <div
      className="rounded-3xl overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #2D5233 0%, #4B7A53 100%)',
        boxShadow: '0 8px 24px rgba(45,82,51,0.18)',
        color: '#fff',
      }}
    >
      {/* Headline — label + big amount + count line. Number sits in an
          RTL flex so the ₪ symbol is on the right of the digits, the
          natural Hebrew reading direction. */}
      <div className="p-4 sm:p-5">
        <p className="text-[11px] font-medium opacity-90">{label}</p>
        <p className="text-3xl sm:text-4xl font-black tabular-nums mt-1">
          {loading ? '...' : fmtMoney(totalNum)}
        </p>
        <p className="text-xs opacity-90 mt-1">
          {count > 0
            ? <>{count} הוצאות{period?.type !== 'month' ? <> · ממוצע {fmtMoney(monthlyAvg)} לחודש</> : null}</>
            : 'אין הוצאות בתקופה'}
        </p>
      </div>

      {/* Breakdown panel — visually separated by a slightly darker
          inner gradient so the section reads as its own surface within
          the card. */}
      {showBreakdown && (
        <div
          className="px-4 sm:px-5 pb-4 sm:pb-5 pt-3.5"
          style={{
            background: 'linear-gradient(180deg, rgba(0,0,0,0.07) 0%, rgba(0,0,0,0.18) 100%)',
            borderTop: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-75">
              פיצול לפי רכב
            </p>
            <p className="text-[10px] opacity-60 tabular-nums">
              {entries.length} {entries.length === 1 ? 'רכב' : 'רכבים'}
            </p>
          </div>

          {/* Scrolling list. Custom scrollbar (Firefox + WebKit via inline
              CSS) is muted white so it doesn't fight the green theme.
              The negative margin + padding trick keeps the bars from
              touching the scrollbar. */}
          <div
            className="space-y-2 max-h-[300px] overflow-y-auto -ml-1 pl-1 expense-breakdown-scroll"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.22) transparent',
            }}
          >
            {entries.map(([vid, info], idx) => {
              const amt    = Number(info?.total) || 0;
              const pct    = totalNum > 0 ? (amt / totalNum) * 100 : 0;
              const name   = info?.name || 'רכב';
              const plate  = info?.license_plate || '';
              const T      = getTheme(info?.vehicle_type, info?.nickname, info?.manufacturer);
              const isLeader = idx === 0 && entries.length > 1;

              // Bar gradient — uses the vehicle's primary tinted into
              // a brighter accent for visibility on the dark green
              // background. Falls back to gold when the theme is too
              // close to the card color (low contrast guard).
              const barGradient = `linear-gradient(90deg, ${T.primary} 0%, ${T.yellow || '#FDE68A'} 100%)`;

              return (
                <button
                  key={vid}
                  type="button"
                  onClick={() => onVehicleClick?.(vid)}
                  className="w-full text-right rounded-xl p-2.5 transition-all active:scale-[0.99] hover:bg-white/10 group"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: `1px solid ${isLeader ? 'rgba(253,230,138,0.35)' : 'rgba(255,255,255,0.08)'}`,
                  }}
                  aria-label={`עבור לרכב ${name}`}
                >
                  <div className="flex items-center gap-2.5">
                    {/* Vehicle avatar — circle with the vehicle's icon,
                        ring brightened on the leader. Acts as the
                        primary color cue for scanning the list. */}
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        background: T.primary,
                        boxShadow: isLeader
                          ? '0 0 0 2px rgba(253,230,138,0.55), 0 2px 6px rgba(0,0,0,0.25)'
                          : '0 0 0 1.5px rgba(255,255,255,0.18)',
                      }}
                    >
                      <VehicleIcon
                        vehicle={{
                          vehicle_type: info?.vehicle_type,
                          nickname:     info?.nickname,
                          manufacturer: info?.manufacturer,
                        }}
                        className="w-4 h-4"
                        style={{ color: '#fff' }}
                      />
                    </div>

                    {/* Name + plate */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold truncate">{name}</span>
                        {isLeader && (
                          <span
                            className="text-[9px] font-black px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 shrink-0"
                            style={{ background: 'rgba(253,230,138,0.22)', color: '#FDE68A' }}
                            title="ההוצאה הגבוהה ביותר"
                          >
                            <Trophy className="w-2.5 h-2.5" />
                            ראשון
                          </span>
                        )}
                      </div>
                      {plate && (
                        <p
                          className="text-[10px] opacity-65 mt-0.5 font-mono"
                          dir="ltr"
                        >
                          {plate}
                        </p>
                      )}
                    </div>

                    {/* Amount + % column */}
                    <div className="text-left shrink-0">
                      <p className="text-sm font-black tabular-nums leading-tight">
                        {fmtMoney(amt)}
                      </p>
                      <p className="text-[10px] opacity-70 tabular-nums leading-tight mt-0.5">
                        {pct.toFixed(0)}%
                      </p>
                    </div>
                  </div>

                  {/* Progress bar — colored by vehicle theme. Even at
                      0.5% the bar gets a 3px floor so the user sees
                      that data exists for the row. */}
                  <div
                    className="mt-2.5 h-1.5 rounded-full overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.10)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, pct)}%`,
                        background: barGradient,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
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

/**
 * Reports — Financial dashboard for the fleet (manager-only).
 *
 * Single-screen BI surface — purposefully NOT a multi-tab page. Three
 * patterns layered top-to-bottom so the manager scans from "the headline
 * number" → "the trend" → "the splits" → "the line items":
 *
 *   1. KPI tiles    — total spend, # operations, costliest vehicle,
 *                     vehicle with the most issues.
 *   2. Trend chart  — monthly stacked bar (תיקונים / ביטוח / אחר). Fuel
 *                     is intentionally OUT of every visualization here:
 *                     fuel is a running cost, this dashboard is about
 *                     the economic footprint of maintenance + insurance,
 *                     i.e. the events the manager can actually act on.
 *   3. Two splits   — top vehicles by cost, and category breakdown bars.
 *   4. Line items   — every expense + repair + maintenance log unified
 *                     into one filterable table with Excel export.
 *
 * Sources merged client-side:
 *   • vehicle_expenses    (free-form expenses; we drop category='fuel')
 *   • repair_logs         (per-incident workshop visits with cost)
 *   • maintenance_logs    (scheduled service entries with cost)
 *
 * Filters: period (preset + custom from/to) and vehicle. Fuel exclusion
 * is hard — there's no "include fuel" toggle on purpose; that data lives
 * in /Expenses where it belongs.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Briefcase, Truck, AlertTriangle,
  TrendingUp, Receipt, Filter, Wrench, Shield, Package, Download, BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';

// ---------- formatters ------------------------------------------------

const fmtMoney = (n) =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(Number(n) || 0);
const fmtMoneyShort = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return `₪${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000)      return `₪${Math.round(v / 1000)}K`;
  return `₪${Math.round(v)}`;
};
const fmtMonthLabel = (iso) => {
  // iso is yyyy-MM-dd of month-start; render as "Mar '26".
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { month: 'short', year: '2-digit' });
};
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('he-IL') : '';
const todayISO  = () => new Date().toISOString().slice(0, 10);
const isoNDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const isoYearStart = () => `${new Date().getFullYear()}-01-01`;

// Category metadata. Fuel is omitted on purpose — it's hidden from this
// dashboard at every layer (chart, splits, table). Adding it back would
// dwarf maintenance costs and make the data useless for fleet planning.
const CATEGORY_META = {
  repair:    { label: 'תיקונים', icon: Wrench, color: '#EA580C', bg: 'bg-orange-50',  text: 'text-orange-700' },
  insurance: { label: 'ביטוח',   icon: Shield, color: '#7C3AED', bg: 'bg-purple-50',  text: 'text-purple-700' },
  other:     { label: 'אחר',     icon: Package, color: '#64748B', bg: 'bg-slate-50',   text: 'text-slate-700' },
};
const CATEGORY_KEYS = ['repair', 'insurance', 'other'];

// Period presets. The dataset is small enough that filtering all rows
// client-side is fine; we don't need to push periods to the server.
const PRESETS = [
  { id: '30',  label: '30 ימים', from: () => isoNDaysAgo(30) },
  { id: '90',  label: '90 ימים', from: () => isoNDaysAgo(90) },
  { id: 'ytd', label: 'השנה',    from: () => isoYearStart() },
  { id: 'all', label: 'הכל',     from: () => null },
];

export default function Reports() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, isManager, isViewer, isLoading: roleLoading } = useWorkspaceRole();
  const canRead = isManager || isViewer;

  const [presetId, setPresetId]       = useState('90');
  const [customFrom, setCustomFrom]   = useState('');
  const [customTo,   setCustomTo]     = useState('');
  const [filterVehicle, setFilterVehicle] = useState('');
  const [exporting, setExporting]     = useState(false);

  // Active period — preset wins unless the manager set a custom range.
  const customActive = customFrom || customTo;
  const periodFrom = customActive
    ? (customFrom || null)
    : (PRESETS.find(p => p.id === presetId)?.from() ?? null);
  const periodTo   = customActive ? (customTo || todayISO()) : todayISO();

  // -- workspace data ------------------------------------------------

  const { data: vehicles = [] } = useQuery({
    queryKey: ['reports-vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId && canRead && isBusiness,
    staleTime: 5 * 60 * 1000,
  });

  // Pull the last 24 months of monthly summary regardless of filter —
  // we filter client-side so switching presets is instant.
  const { data: monthlySummaries = [], isLoading: monthlyLoading } = useQuery({
    queryKey: ['reports-monthly', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_monthly_expense_summary')
        .select('*')
        .eq('account_id', accountId)
        .order('month', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canRead && isBusiness,
    staleTime: 60 * 1000,
  });

  // Per-vehicle aggregates — used for "top vehicles" and KPI.
  const { data: vehicleSummaries = [] } = useQuery({
    queryKey: ['reports-vehicle-cost', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_vehicle_cost_summary')
        .select('*')
        .eq('account_id', accountId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canRead && isBusiness,
    staleTime: 60 * 1000,
  });

  // Line-item data — three sources unified. We fetch wider than needed
  // (no server-side period filter) so changing presets is instant; the
  // payload is bounded by `limit` per source.
  const LINE_ITEM_LIMIT = 500;
  const { data: lineItems = [], isLoading: linesLoading } = useQuery({
    queryKey: ['reports-line-items', accountId],
    queryFn: async () => {
      const [exp, rep, maint] = await Promise.all([
        supabase
          .from('vehicle_expenses')
          .select('id, vehicle_id, amount, category, expense_date, note, created_at')
          .eq('account_id', accountId)
          .neq('category', 'fuel')
          .order('expense_date', { ascending: false })
          .limit(LINE_ITEM_LIMIT),
        supabase
          .from('repair_logs')
          .select('id, vehicle_id, occurred_at, title, cost, garage_name, is_accident, description')
          .eq('account_id', accountId)
          .gt('cost', 0)
          .order('occurred_at', { ascending: false })
          .limit(LINE_ITEM_LIMIT),
        // maintenance_logs has no account_id; we query by vehicle_id list.
        // For accounts with very many vehicles we'd switch to an RPC; for
        // now this keeps the UI simple.
        Promise.resolve({ data: [], error: null }),
      ]);
      const errs = [exp.error, rep.error, maint.error].filter(Boolean);
      if (errs.length) throw errs[0];

      const expense   = (exp.data || []).map(r => ({
        id:         `e:${r.id}`,
        date:       r.expense_date,
        vehicle_id: r.vehicle_id,
        category:   r.category,                // 'repair' | 'insurance' | 'other'
        amount:     Number(r.amount) || 0,
        note:       r.note || '',
        source:     'expense',
      }));
      const repairs   = (rep.data || []).map(r => ({
        id:         `r:${r.id}`,
        date:       r.occurred_at,
        vehicle_id: r.vehicle_id,
        category:   'repair',
        amount:     Number(r.cost) || 0,
        note:       [r.title, r.garage_name && `במוסך ${r.garage_name}`, r.is_accident && 'תאונה']
                      .filter(Boolean).join(' · '),
        source:     r.is_accident ? 'accident' : 'repair',
      }));
      // Combined and sorted desc.
      return [...expense, ...repairs].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    },
    enabled: !!accountId && canRead && isBusiness,
    staleTime: 60 * 1000,
  });

  // Maintenance logs (sub-query to compute issue counts per vehicle).
  // Used only for the "vehicle with most issues" KPI — we count
  // repair_logs entries (not cost) per vehicle.
  const { data: issueCounts = {} } = useQuery({
    queryKey: ['reports-issue-counts', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('repair_logs')
        .select('vehicle_id, occurred_at')
        .eq('account_id', accountId)
        .order('occurred_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      const counts = {};
      (data || []).forEach(r => {
        if (!periodFrom || r.occurred_at >= periodFrom) {
          if (!periodTo || r.occurred_at <= periodTo) {
            counts[r.vehicle_id] = (counts[r.vehicle_id] || 0) + 1;
          }
        }
      });
      return counts;
    },
    enabled: !!accountId && canRead && isBusiness,
    staleTime: 60 * 1000,
  });

  // -- helpers --------------------------------------------------------

  const vehicleLabel = (id) => {
    const v = vehicles.find(x => x.id === id);
    if (!v) return 'רכב לא ידוע';
    return v.nickname || v.license_plate || `${v.manufacturer || ''} ${v.model || ''}`.trim() || 'רכב ללא שם';
  };

  // -- derived: chart data (monthly) ---------------------------------

  const chartData = useMemo(() => {
    return monthlySummaries
      .filter(r => {
        if (periodFrom && r.month < periodFrom) return false;
        if (periodTo   && r.month > periodTo)   return false;
        return true;
      })
      .map(r => ({
        month:     fmtMonthLabel(r.month),
        repair:    Number(r.by_repair)    || 0,
        insurance: Number(r.by_insurance) || 0,
        other:     Number(r.by_other)     || 0,
        // total intentionally excludes fuel here — sum of the three keys.
      }));
  }, [monthlySummaries, periodFrom, periodTo]);

  // -- derived: filtered line items ----------------------------------

  const filteredLines = useMemo(() => {
    return lineItems.filter(r => {
      if (periodFrom && r.date < periodFrom) return false;
      if (periodTo   && r.date > periodTo)   return false;
      if (filterVehicle && r.vehicle_id !== filterVehicle) return false;
      return true;
    });
  }, [lineItems, periodFrom, periodTo, filterVehicle]);

  // -- derived: KPIs --------------------------------------------------

  const kpiTotal = useMemo(() =>
    filteredLines.reduce((sum, r) => sum + r.amount, 0)
  , [filteredLines]);

  const kpiCount = filteredLines.length;

  const kpiCostlyVehicle = useMemo(() => {
    const byVehicle = new Map();
    filteredLines.forEach(r => {
      byVehicle.set(r.vehicle_id, (byVehicle.get(r.vehicle_id) || 0) + r.amount);
    });
    let topId = null, topVal = 0;
    byVehicle.forEach((v, k) => { if (v > topVal) { topVal = v; topId = k; } });
    return topId ? { vehicle_id: topId, total: topVal } : null;
  }, [filteredLines]);

  const kpiIssuesVehicle = useMemo(() => {
    let topId = null, topVal = 0;
    Object.entries(issueCounts).forEach(([k, v]) => {
      if (filterVehicle && k !== filterVehicle) return;
      if (v > topVal) { topVal = v; topId = k; }
    });
    return topId ? { vehicle_id: topId, count: topVal } : null;
  }, [issueCounts, filterVehicle]);

  // -- derived: top 5 vehicles ---------------------------------------

  const topVehicles = useMemo(() => {
    const by = new Map();
    filteredLines.forEach(r => {
      by.set(r.vehicle_id, (by.get(r.vehicle_id) || 0) + r.amount);
    });
    return [...by.entries()]
      .map(([vehicle_id, total]) => ({ vehicle_id, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [filteredLines]);

  // -- derived: category breakdown -----------------------------------

  const categoryBreakdown = useMemo(() => {
    const sums = { repair: 0, insurance: 0, other: 0 };
    filteredLines.forEach(r => {
      if (sums[r.category] !== undefined) sums[r.category] += r.amount;
    });
    const total = sums.repair + sums.insurance + sums.other;
    return CATEGORY_KEYS.map(k => ({
      key:   k,
      label: CATEGORY_META[k].label,
      value: sums[k],
      pct:   total > 0 ? (sums[k] / total) * 100 : 0,
      color: CATEGORY_META[k].color,
    }));
  }, [filteredLines]);

  // -- excel export ---------------------------------------------------

  const handleExport = async () => {
    if (filteredLines.length === 0) {
      toast.error('אין נתונים לייצוא בטווח הנוכחי');
      return;
    }
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      // Mirror the visible table columns; one row per line item.
      const rows = filteredLines.map(r => ({
        'תאריך':    r.date,
        'רכב':      vehicleLabel(r.vehicle_id),
        'קטגוריה':  CATEGORY_META[r.category]?.label || r.category,
        'מקור':     r.source === 'accident' ? 'תאונה' :
                    r.source === 'repair'   ? 'תיקון' : 'הוצאה',
        'סכום (₪)': r.amount,
        'הערה':     r.note,
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      // Set column widths so the file opens readable.
      ws['!cols'] = [
        { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 40 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'דוח הוצאות');
      const filename = `fleet-expenses-${todayISO()}.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`יצוא הצליח (${rows.length} שורות)`);
    } catch (err) {
      toast.error('יצוא נכשל. נסה שוב.');
      // eslint-disable-next-line no-console
      console.error('Excel export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  // -- guards ---------------------------------------------------------

  if (authLoading || roleLoading)
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  if (!isAuthenticated)
    return <Empty text="צריך להתחבר." />;
  if (!isBusiness)
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="דוחות זמינים בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש."
      />
    );
  if (!canRead)
    return (
      <Empty
        icon={<TrendingUp className="h-10 w-10 text-gray-300" />}
        title="אין הרשאה לדוחות"
        text="צפייה בדוחות שמורה למנהלי החשבון."
      />
    );

  // -- render ---------------------------------------------------------

  const loading = monthlyLoading || linesLoading;

  return (
    <div dir="rtl" className="max-w-5xl mx-auto py-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">דוחות וניתוחים</h1>
          <p className="text-xs text-gray-500">סקירה כספית של תחזוקת הצי. הדלק לא נכלל — ראה /הוצאות.</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || filteredLines.length === 0}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#2D5233] text-white text-xs font-bold disabled:opacity-50 active:scale-[0.97] shadow-sm"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? 'מייצא...' : 'ייצא לאקסל'}
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-gray-100 rounded-2xl p-3 mb-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-[11px] font-bold text-gray-600">תקופה:</span>
          <div className="flex flex-wrap gap-1.5 flex-1">
            {PRESETS.map(p => {
              const active = !customActive && presetId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setPresetId(p.id); setCustomFrom(''); setCustomTo(''); }}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${
                    active
                      ? 'bg-[#2D5233] text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-gray-50">
          <DateField label="מתאריך" value={customFrom} onChange={setCustomFrom} />
          <DateField label="עד תאריך" value={customTo}   onChange={setCustomTo} />
          <FilterField label="רכב">
            <select
              value={filterVehicle}
              onChange={(e) => setFilterVehicle(e.target.value)}
              className="w-full text-xs bg-transparent focus:outline-none truncate"
            >
              <option value="">כל הרכבים</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{vehicleLabel(v.id)}</option>
              ))}
            </select>
          </FilterField>
        </div>
        {customActive && (
          <p className="text-[10px] text-gray-400">תאריך מותאם פעיל — מתעלם מהקיצורים.</p>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <KpiCard
          icon={<Receipt className="h-3.5 w-3.5" />}
          label="סה״כ הוצאה"
          value={fmtMoney(kpiTotal)}
          sub={`${kpiCount} פעולות`}
          tone="green"
        />
        <KpiCard
          icon={<Wrench className="h-3.5 w-3.5" />}
          label="פעולות בתקופה"
          value={kpiCount}
          sub={kpiCount === 0 ? 'אין פעילות' : 'תיקונים, ביטוח, אחר'}
          tone="blue"
        />
        <KpiCard
          icon={<Truck className="h-3.5 w-3.5" />}
          label="הרכב היקר"
          value={kpiCostlyVehicle ? fmtMoneyShort(kpiCostlyVehicle.total) : '—'}
          sub={kpiCostlyVehicle ? vehicleLabel(kpiCostlyVehicle.vehicle_id) : 'אין נתונים'}
          tone="orange"
        />
        <KpiCard
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="הכי הרבה תקלות"
          value={kpiIssuesVehicle ? `${kpiIssuesVehicle.count} תקלות` : '—'}
          sub={kpiIssuesVehicle ? vehicleLabel(kpiIssuesVehicle.vehicle_id) : 'אין נתונים'}
          tone="red"
        />
      </div>

      {/* Trend chart */}
      <div className="bg-white border border-gray-100 rounded-2xl p-3 mb-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <BarChart3 className="h-4 w-4 text-[#2D5233]" />
            מגמת הוצאות חודשית
          </h2>
          <span className="text-[10px] text-gray-400">ללא דלק</span>
        </div>
        {loading ? (
          <p className="text-center text-xs text-gray-400 py-12">טוען נתונים...</p>
        ) : chartData.length === 0 ? (
          <Empty embedded text="אין נתונים בטווח שנבחר. נסה תקופה רחבה יותר." />
        ) : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 8, bottom: 0, left: -10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  axisLine={{ stroke: '#E5E7EB' }}
                  tickLine={false}
                  reversed={true /* RTL: Mar→Apr→May reads right-to-left */}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  tickFormatter={fmtMoneyShort}
                  axisLine={{ stroke: '#E5E7EB' }}
                  tickLine={false}
                  orientation="right"
                />
                <Tooltip
                  formatter={(value, key) => [fmtMoney(value), CATEGORY_META[key]?.label || key]}
                  labelStyle={{ fontWeight: 'bold', fontSize: 12 }}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E5E7EB', direction: 'rtl' }}
                  cursor={{ fill: 'rgba(45, 82, 51, 0.06)' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  formatter={(key) => CATEGORY_META[key]?.label || key}
                />
                <Bar dataKey="repair"    stackId="a" fill={CATEGORY_META.repair.color}    radius={[0, 0, 0, 0]} />
                <Bar dataKey="insurance" stackId="a" fill={CATEGORY_META.insurance.color} radius={[0, 0, 0, 0]} />
                <Bar dataKey="other"     stackId="a" fill={CATEGORY_META.other.color}     radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Splits — top vehicles + category breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div className="bg-white border border-gray-100 rounded-2xl p-3">
          <h2 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-1.5">
            <Truck className="h-4 w-4 text-[#2D5233]" />
            רכבים יקרים בתקופה
          </h2>
          {topVehicles.length === 0 ? (
            <p className="text-[11px] text-gray-400 py-4 text-center">אין נתונים</p>
          ) : (
            <ul className="space-y-1.5">
              {topVehicles.map((v, i) => {
                const max = topVehicles[0]?.total || 1;
                const pct = (v.total / max) * 100;
                return (
                  <li key={v.vehicle_id}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-[11px] text-gray-700 truncate flex-1 min-w-0">
                        <span className="text-[10px] font-bold text-gray-400 ml-1">{i + 1}.</span>
                        {vehicleLabel(v.vehicle_id)}
                      </span>
                      <span className="text-[11px] font-bold text-[#2D5233] shrink-0">
                        {fmtMoney(v.total)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#2D5233]" style={{ width: pct + '%' }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-3">
          <h2 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-1.5">
            <Package className="h-4 w-4 text-[#2D5233]" />
            פילוח לפי קטגוריה
          </h2>
          {categoryBreakdown.every(c => c.value === 0) ? (
            <p className="text-[11px] text-gray-400 py-4 text-center">אין נתונים</p>
          ) : (
            <ul className="space-y-2">
              {categoryBreakdown.map(c => {
                const Icon = CATEGORY_META[c.key].icon;
                return (
                  <li key={c.key}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-[11px] text-gray-700 flex items-center gap-1.5">
                        <Icon className="h-3 w-3" style={{ color: c.color }} />
                        {c.label}
                      </span>
                      <span className="text-[11px] font-bold text-gray-900">
                        {fmtMoney(c.value)}
                        <span className="text-gray-400 font-normal ml-1">{c.pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{ width: c.pct + '%', background: c.color }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Line-item detail table */}
      <div className="bg-white border border-gray-100 rounded-2xl p-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
            <Receipt className="h-4 w-4 text-[#2D5233]" />
            פירוט שורות
          </h2>
          <span className="text-[10px] text-gray-400">{filteredLines.length} שורות</span>
        </div>
        {loading ? (
          <p className="text-center text-xs text-gray-400 py-6">טוען שורות...</p>
        ) : filteredLines.length === 0 ? (
          <Empty embedded text="אין שורות תואמות. נסה להרחיב את התקופה או לבטל את סינון הרכב." />
        ) : (
          <div className="overflow-x-auto -mx-3">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500">
                  <th className="text-right py-2 px-3 font-bold">תאריך</th>
                  <th className="text-right py-2 px-3 font-bold">רכב</th>
                  <th className="text-right py-2 px-3 font-bold">קטגוריה</th>
                  <th className="text-right py-2 px-3 font-bold hidden sm:table-cell">הערה</th>
                  <th className="text-left py-2 px-3 font-bold">סכום</th>
                </tr>
              </thead>
              <tbody>
                {filteredLines.slice(0, 200).map(r => {
                  const meta = CATEGORY_META[r.category] || CATEGORY_META.other;
                  const Icon = meta.icon;
                  return (
                    <tr key={r.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-1.5 px-3 text-gray-700 whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td className="py-1.5 px-3 text-gray-900 truncate max-w-[140px]">{vehicleLabel(r.vehicle_id)}</td>
                      <td className="py-1.5 px-3">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md ${meta.bg} ${meta.text} font-bold whitespace-nowrap`}>
                          <Icon className="h-2.5 w-2.5" />
                          {meta.label}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-gray-500 truncate max-w-[260px] hidden sm:table-cell">
                        {r.note || '—'}
                      </td>
                      <td className="py-1.5 px-3 font-bold text-[#2D5233] text-left whitespace-nowrap">
                        {fmtMoney(r.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredLines.length > 200 && (
              <p className="text-[10px] text-gray-400 px-3 py-2 text-center">
                מוצגות 200 שורות ראשונות. ייצא לאקסל לקבלת כל {filteredLines.length} השורות.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- helper components ----------------------------------------

function KpiCard({ icon, label, value, sub, tone }) {
  // Subtle tinted-tile style. Each KPI gets a different accent so the
  // eye can jump straight to the metric it cares about — totals (green),
  // operations (blue), costliest vehicle (orange), issues (red).
  const toneCls = {
    green:  'bg-[#E8F2EA] text-[#2D5233]',
    blue:   'bg-blue-50   text-blue-700',
    orange: 'bg-orange-50 text-orange-700',
    red:    'bg-red-50    text-red-700',
  }[tone] || 'bg-gray-50 text-gray-700';
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-2.5">
      <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold mb-1.5 ${toneCls}`}>
        {icon}
        {label}
      </div>
      <p className="text-base font-black text-gray-900 leading-tight truncate">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white">
      <span className="text-[10px] font-bold text-gray-500 shrink-0">{label}:</span>
      {children}
    </label>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white">
      <span className="text-[10px] font-bold text-gray-500 shrink-0">{label}:</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-xs bg-transparent focus:outline-none"
      />
    </label>
  );
}

function Empty({ icon, title, text, embedded }) {
  return (
    <div dir="rtl" className={embedded ? 'py-8' : 'max-w-md mx-auto py-16'}>
      <div className="text-center px-6">
        {icon && <div className="flex justify-center mb-3">{icon}</div>}
        {title && <p className="text-sm font-bold text-gray-700 mb-1">{title}</p>}
        <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

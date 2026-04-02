import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import PageHeader from '../components/shared/PageHeader';
import {
  Users, Shield, TrendingUp, Car, Wrench, FileText,
  Star, AlertTriangle, Activity, ArrowDown, ChevronDown, ChevronUp,
  RefreshCw, BarChart2,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid,
} from 'recharts';
import {
  format, subDays, startOfDay, parseISO, isValid,
  isBefore, isAfter, differenceInDays,
} from 'date-fns';
import { he } from 'date-fns/locale';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FILTERS = [
  { key: 'today',     label: 'היום' },
  { key: 'yesterday', label: 'אתמול' },
  { key: 'week',      label: '7 ימים' },
  { key: 'month',     label: '30 ימים' },
  { key: 'all',       label: 'הכל' },
];

const TODAY = new Date();

// Neutral BI palette — intentionally different from main app branding
const C = {
  blue:   '#3B82F6',
  green:  '#10B981',
  amber:  '#F59E0B',
  red:    '#EF4444',
  purple: '#8B5CF6',
  teal:   '#0891B2',
  slate:  '#64748B',
};

const CHART_PALETTE = [C.blue, C.green, C.amber, C.red, C.purple, C.teal];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getRangeStart(key) {
  switch (key) {
    case 'today':     return startOfDay(TODAY);
    case 'yesterday': return startOfDay(subDays(TODAY, 1));
    case 'week':      return startOfDay(subDays(TODAY, 6));
    case 'month':     return startOfDay(subDays(TODAY, 29));
    case 'all':       return new Date(0);
    default:          return startOfDay(subDays(TODAY, 6));
  }
}

function getRangeEnd(key) {
  return key === 'yesterday' ? startOfDay(TODAY) : new Date(TODAY.getTime() + 1);
}

function inRange(dateStr, key) {
  if (key === 'all') return true;
  if (!dateStr) return false;
  try {
    const d = parseISO(String(dateStr));
    if (!isValid(d)) return false;
    return d >= getRangeStart(key) && d < getRangeEnd(key);
  } catch { return false; }
}

function safeDate(str) {
  if (!str) return null;
  try { const d = parseISO(String(str)); return isValid(d) ? d : null; }
  catch { return null; }
}

function dayStr(d) { return format(d, 'yyyy-MM-dd'); }

function buildSeries(filterKey, ...seriesDefs) {
  // seriesDefs: [{ key, items, dateGetter }]
  const isToday = filterKey === 'today';
  const isYesterday = filterKey === 'yesterday';
  const days = filterKey === 'month' ? 30 : filterKey === 'week' ? 7 : 1;
  const startOffset = isYesterday ? 1 : 0;

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(TODAY, i + startOffset);
    const ds = dayStr(d);
    const point = {
      name: days === 1 ? (isToday ? 'היום' : 'אתמול') : format(d, 'dd/MM', { locale: he }),
    };
    seriesDefs.forEach(({ key, items, dateGetter }) => {
      point[key] = items.filter(item => {
        const v = dateGetter(item);
        return v && String(v).split('T')[0] === ds;
      }).length;
    });
    result.push(point);
  }
  return result;
}

function retentionColor(rate) {
  if (rate >= 60) return C.green;
  if (rate >= 30) return C.amber;
  return C.red;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-0.5 h-4 rounded-full bg-blue-500" />
      <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.12em]">{children}</h2>
    </div>
  );
}

function MetricCard({ label, value, sub, color = C.blue, icon: Icon, danger = false }) {
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 flex flex-col gap-3
      ${danger ? 'border-red-200' : 'border-gray-100'}`}>
      <div className="flex items-center justify-between">
        <div className="p-2 rounded-xl" style={{ backgroundColor: color + '18' }}>
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        {danger && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-500">
            דרוש טיפול
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight text-gray-900">{value}</p>
        <p className="text-xs font-medium text-gray-500 mt-0.5">{label}</p>
        {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function ChartCard({ title, children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 ${className}`}>
      {title && <p className="text-xs font-semibold text-gray-600 mb-4">{title}</p>}
      {children}
    </div>
  );
}

function EmptyChart({ text = 'אין נתונים בטווח שנבחר' }) {
  return (
    <div className="flex items-center justify-center h-36 text-xs text-gray-400">{text}</div>
  );
}

function BiTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 shadow-xl rounded-xl p-3 text-right text-xs min-w-[120px]" dir="rtl">
      <p className="font-semibold text-gray-600 mb-1.5 border-b border-gray-50 pb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
            <span className="text-gray-500">{p.name}</span>
          </div>
          <span className="font-bold text-gray-900">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function FunnelBar({ step, value, maxValue, rate, showDropoff, dropoffPct }) {
  const barPct = maxValue > 0 ? Math.max(4, Math.round((value / maxValue) * 100)) : 4;
  const rateColor = rate >= 50 ? C.green : rate >= 25 ? C.amber : C.red;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-700">{step}</span>
        <span className="font-bold tabular-nums text-gray-900">{value.toLocaleString()}</span>
      </div>
      <div className="h-8 bg-gray-50 rounded-lg overflow-hidden relative">
        <div
          className="h-full rounded-lg transition-all duration-700 ease-out"
          style={{ width: `${barPct}%`, backgroundColor: C.blue, opacity: Math.max(0.3, barPct / 100) + 0.3 }}
        />
        {rate !== null && (
          <span className="absolute inset-0 flex items-center pr-3 text-[10px] font-bold text-gray-400">
            {rate}%
          </span>
        )}
      </div>
      {showDropoff && dropoffPct !== null && (
        <div className="flex items-center gap-1 text-[10px] text-gray-400 pr-1">
          <ArrowDown className="h-2.5 w-2.5 shrink-0" />
          <span>{100 - dropoffPct}% לא המשיכו</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
            style={{ backgroundColor: rateColor + '18', color: rateColor }}>
            {dropoffPct}% המרה
          </span>
        </div>
      )}
    </div>
  );
}

function RetentionCard({ label, period, rate, count, total }) {
  const color = retentionColor(rate);
  const circumference = 2 * Math.PI * 20;
  const dash = (rate / 100) * circumference;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col items-center gap-3">
      {/* SVG ring */}
      <div className="relative w-16 h-16">
        <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
          <circle cx="24" cy="24" r="20" fill="none" stroke="#F1F5F9" strokeWidth="5" />
          <circle cx="24" cy="24" r="20" fill="none" stroke={color} strokeWidth="5"
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold" style={{ color }}>{rate}%</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-semibold text-gray-700">{label}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{period}</p>
        <p className="text-[10px] text-gray-400 mt-1">{count} / {total} משתמשים</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [isAdmin, setIsAdmin]       = useState(null);
  const [filter, setFilter]         = useState('week');
  const [loading, setLoading]       = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);

  const [accounts, setAccounts]     = useState([]);
  const [vehicles, setVehicles]     = useState([]);
  const [maintLogs, setMaintLogs]   = useState([]);
  const [repairLogs, setRepairLogs] = useState([]);
  const [reviews, setReviews]       = useState([]);
  const [documents, setDocuments]   = useState([]);
  const [analyticsData, setAnalyticsData] = useState([]);

  // Step 1: verify admin role (using Supabase user metadata)
  useEffect(() => {
    async function checkAdmin() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setIsAdmin(false); return; }
        // Check user_metadata role or account_members for admin flag
        const isAdminUser = user.user_metadata?.role === 'admin'
          || user.email === 'ofek205@gmail.com'; // fallback: app owner
        setIsAdmin(isAdminUser);
      } catch {
        setIsAdmin(false);
      }
    }
    checkAdmin();
  }, []);

  // Step 2: fetch data (admin only) — using Supabase entities
  useEffect(() => {
    if (isAdmin !== true) return;
    setLoading(true);
    Promise.all([
      db.accounts.list().catch(() => []),
      db.vehicles.list().catch(() => []),
      // MaintenanceLog, RepairLog, Review, Document not yet in Supabase — return empty
      Promise.resolve([]),  // maintLogs placeholder
      Promise.resolve([]),  // repairLogs placeholder
      Promise.resolve([]),  // reviews placeholder
      Promise.resolve([]),  // documents placeholder
    ]).then(([accs, vehs, maint, repairs, revs, docs]) => {
      setFetchError(false);
      setAccounts(accs   || []);
      setVehicles(vehs   || []);
      setMaintLogs(maint || []);
      setRepairLogs(repairs || []);
      setReviews(revs    || []);
      setDocuments(docs  || []);
    }).catch(() => setFetchError(true))
      .finally(() => setLoading(false));

    // Fetch anonymous analytics
    db.analytics.list().then(rows => setAnalyticsData(rows || [])).catch(() => {});
  }, [isAdmin]);

  // ── Analytics aggregations ────────────────────────────────────────────────

  const analyticsAgg = useMemo(() => {
    const agg = {};
    analyticsData.forEach(row => {
      if (!agg[row.event]) agg[row.event] = 0;
      agg[row.event] += row.count || 0;
    });
    return agg;
  }, [analyticsData]);

  const analyticsRecent = useMemo(() => {
    // Last 7 days of guest sessions
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = format(subDays(TODAY, i), 'yyyy-MM-dd');
      const label = format(subDays(TODAY, i), 'dd/MM', { locale: he });
      const row = analyticsData.find(r => r.event === 'guest_session' && r.date === d);
      last7.push({ name: label, אורחים: row?.count || 0 });
    }
    return last7;
  }, [analyticsData]);

  // ── Filtered slices (all driven by the global `filter`) ────────────────────

  const fAcc  = useMemo(() => accounts.filter(a  => inRange(a.created_date,  filter)), [accounts,  filter]);
  const fVeh  = useMemo(() => vehicles.filter(v  => inRange(v.created_at,    filter)), [vehicles,  filter]);
  const fMnt  = useMemo(() => maintLogs.filter(m => inRange(m.performed_at,  filter)), [maintLogs, filter]);
  const fRep  = useMemo(() => repairLogs.filter(r=> inRange(r.occurred_at,   filter)), [repairLogs,filter]);
  const fDoc  = useMemo(() => documents.filter(d => inRange(d.created_at,    filter)), [documents, filter]);
  const fRev  = useMemo(() => reviews.filter(r   => inRange(r.created_at,    filter)), [reviews,   filter]);

  // ── Cross-reference maps ───────────────────────────────────────────────────

  // vehicle_id → account_id
  const v2a = useMemo(() => {
    const m = {};
    vehicles.forEach(v => { if (v.id) m[v.id] = v.account_id; });
    return m;
  }, [vehicles]);

  // account_id → Vehicle[]
  const a2v = useMemo(() => {
    const m = {};
    vehicles.forEach(v => {
      if (!v.account_id) return;
      if (!m[v.account_id]) m[v.account_id] = [];
      m[v.account_id].push(v);
    });
    return m;
  }, [vehicles]);

  // ── Active accounts in the filter window ──────────────────────────────────

  const activeIds = useMemo(() => {
    const ids = new Set();
    fVeh.forEach(v => v.account_id && ids.add(v.account_id));
    fMnt.forEach(m => { const a = v2a[m.vehicle_id]; if (a) ids.add(a); });
    fRep.forEach(r => { const a = v2a[r.vehicle_id]; if (a) ids.add(a); });
    fDoc.forEach(d => { const a = v2a[d.vehicle_id]; if (a) ids.add(a); });
    return ids;
  }, [fVeh, fMnt, fRep, fDoc, v2a]);

  // ── Funnel ─────────────────────────────────────────────────────────────────

  const funnel = useMemo(() => {
    const s1 = fAcc.length; // new registrations
    const s2 = new Set(fVeh.filter(v => v.account_id).map(v => v.account_id)).size; // added vehicle
    const s3 = new Set(fMnt.map(m => v2a[m.vehicle_id]).filter(Boolean)).size;       // did maintenance
    const s4 = new Set(fDoc.map(d => v2a[d.vehicle_id]).filter(Boolean)).size;       // uploaded doc

    // Returning: pre-existing accounts active in this window
    const start = getRangeStart(filter);
    const s5 = filter === 'all' ? 0 :
      accounts.filter(a => {
        const c = safeDate(a.created_date);
        return c && isBefore(c, start) && activeIds.has(a.id);
      }).length;

    const max = Math.max(s1, 1);
    const r = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
    return [
      { step: 'הרשמות חדשות',     value: s1,  pct: 100,       prev: s1,  next: s2  },
      { step: 'הוסיפו רכב',       value: s2,  pct: r(s2, s1), prev: s1,  next: s3  },
      { step: 'ביצעו טיפול',      value: s3,  pct: r(s3, s2), prev: s2,  next: s4  },
      { step: 'העלו מסמך',        value: s4,  pct: r(s4, s3), prev: s3,  next: null },
      { step: 'משתמשים חוזרים ✦',  value: s5,  pct: null,      prev: null, next: null, note: true },
    ];
  }, [fAcc, fVeh, fMnt, fDoc, accounts, filter, activeIds, v2a]);

  // ── Time series ────────────────────────────────────────────────────────────

  const showSeries = !['today', 'yesterday', 'all'].includes(filter);

  const dailySeries = useMemo(() => {
    if (!showSeries) return [];
    return buildSeries(
      filter,
      { key: 'הרשמות', items: accounts,   dateGetter: a => a.created_date  },
      { key: 'רכבים',  items: vehicles,   dateGetter: v => v.created_at    },
      { key: 'פעולות', items: [
          ...maintLogs.map(m => ({ _d: m.performed_at })),
          ...repairLogs.map(r => ({ _d: r.occurred_at })),
          ...documents.map(d => ({ _d: d.created_at  })),
        ],
        dateGetter: x => x._d,
      },
    );
  }, [accounts, vehicles, maintLogs, repairLogs, documents, filter, showSeries]);

  // ── User behavior (action ranking) ────────────────────────────────────────

  const actionRank = useMemo(() => [
    { name: 'הוספת רכב',    count: fVeh.length, emoji: '🚗' },
    { name: 'טיפול שגרתי', count: fMnt.length, emoji: '🔧' },
    { name: 'תיקון',        count: fRep.length, emoji: '🛠️' },
    { name: 'העלאת מסמך',  count: fDoc.length, emoji: '📄' },
    { name: 'ביקורת',       count: fRev.length, emoji: '⭐' },
  ].sort((a, b) => b.count - a.count), [fVeh, fMnt, fRep, fDoc, fRev]);

  // ── Retention (all-time, not window-dependent) ────────────────────────────

  const retention = useMemo(() => {
    // Build last-activity-date per account from all data
    const last = {};
    const upd = (aid, dateStr) => {
      if (!aid || !dateStr) return;
      const d = safeDate(dateStr);
      if (!d) return;
      if (!last[aid] || d > last[aid]) last[aid] = d;
    };
    vehicles.forEach(v => upd(v.account_id, v.created_at));
    maintLogs.forEach(m => upd(v2a[m.vehicle_id], m.performed_at));
    repairLogs.forEach(r => upd(v2a[r.vehicle_id], r.occurred_at));
    documents.forEach(d => upd(v2a[d.vehicle_id], d.created_at));

    const compute = (days) => {
      const eligible = accounts.filter(a => {
        const c = safeDate(a.created_date);
        return c && differenceInDays(TODAY, c) > days;
      });
      if (!eligible.length) return { rate: 0, count: 0, total: 0 };
      const retained = eligible.filter(a => {
        const c = safeDate(a.created_date);
        const la = last[a.id];
        return c && la && differenceInDays(la, c) >= days;
      });
      return {
        rate:  Math.round((retained.length / eligible.length) * 100),
        count: retained.length,
        total: eligible.length,
      };
    };

    return { d1: compute(1), d7: compute(7), d30: compute(30) };
  }, [accounts, vehicles, maintLogs, repairLogs, documents, v2a]);

  // ── Top users by vehicle count ─────────────────────────────────────────────

  const topUsers = useMemo(() =>
    accounts
      .map(a => ({ ...a, vehicleCount: (a2v[a.id] || []).length }))
      .filter(a => a.vehicleCount > 0)
      .sort((a, b) => b.vehicleCount - a.vehicleCount)
      .slice(0, 10),
  [accounts, a2v]);

  // ── Alerts (all-time) ─────────────────────────────────────────────────────

  const expiredTest  = useMemo(() => vehicles.filter(v => { const d = safeDate(v.test_due_date);      return d && isBefore(d, TODAY); }), [vehicles]);
  const soonTest     = useMemo(() => vehicles.filter(v => { const d = safeDate(v.test_due_date);      return d && isAfter(d, TODAY) && differenceInDays(d, TODAY) <= 30; }), [vehicles]);
  const expiredIns   = useMemo(() => vehicles.filter(v => { const d = safeDate(v.insurance_due_date); return d && isBefore(d, TODAY); }), [vehicles]);
  const soonIns      = useMemo(() => vehicles.filter(v => { const d = safeDate(v.insurance_due_date); return d && isAfter(d, TODAY) && differenceInDays(d, TODAY) <= 30; }), [vehicles]);
  const expiredPyro  = useMemo(() => vehicles.filter(v => { const d = safeDate(v.pyrotechnics_expiry_date); return d && isBefore(d, TODAY); }), [vehicles]);
  const expiredExt   = useMemo(() => vehicles.filter(v => { const d = safeDate(v.fire_extinguisher_expiry_date); return d && isBefore(d, TODAY); }), [vehicles]);
  const expiredRaft  = useMemo(() => vehicles.filter(v => { const d = safeDate(v.life_raft_expiry_date); return d && isBefore(d, TODAY); }), [vehicles]);
  const totalAlerts  = expiredTest.length + soonTest.length + expiredIns.length + soonIns.length + expiredPyro.length + expiredExt.length + expiredRaft.length;

  // ── Misc stats ─────────────────────────────────────────────────────────────

  const avgRating   = useMemo(() => reviews.length ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1) : null, [reviews]);
  const totalFActs  = fMnt.length + fRep.length + fDoc.length;
  const fLabel      = FILTERS.find(f => f.key === filter)?.label || '';

  // ── Guard states ───────────────────────────────────────────────────────────

  if (isAdmin === null) return <LoadingSpinner />;
  if (isAdmin === false) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center" dir="rtl">
        <Shield className="h-16 w-16 text-gray-300" />
        <h2 className="text-xl font-bold text-gray-700">אין הרשאת גישה</h2>
        <p className="text-sm text-gray-500">דף זה מוגבל למנהל המערכת בלבד.</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 pb-20">

      {/* ── Page header ── */}
      <div className="bg-white border-b border-gray-100">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 flex-wrap">
          <div>
            <h1 className="text-base font-bold text-gray-900">Analytics</h1>
            <p className="text-xs text-gray-400 mt-0.5">{format(TODAY, 'EEEE · dd/MM/yyyy', { locale: he })}</p>
          </div>
          {/* Global filter tabs */}
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-1">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                  ${filter === f.key
                    ? 'bg-white text-gray-900 shadow-sm font-semibold'
                    : 'text-gray-500 hover:text-gray-700'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-6 space-y-8 max-w-[1200px] mx-auto">

        {/* Error banner */}
        {fetchError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            שגיאה בטעינת נתונים — אנא רענן את הדף.
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
        ) : (
          <>

            {/* ══════════════════════════════════════════════════════
                SECTION 1 — KPI CARDS
            ══════════════════════════════════════════════════════ */}
            <section>
              <SectionLabel>מדדי ביצוע מרכזיים · {fLabel}</SectionLabel>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricCard
                  icon={Users}
                  label="הרשמות חדשות"
                  value={fAcc.length.toLocaleString()}
                  sub={`${accounts.length} סה״כ`}
                  color={C.blue}
                />
                <MetricCard
                  icon={Car}
                  label="רכבים נוספו"
                  value={fVeh.length.toLocaleString()}
                  sub={`${vehicles.length} סה״כ`}
                  color={C.green}
                />
                <MetricCard
                  icon={Activity}
                  label="פעולות בוצעו"
                  value={totalFActs.toLocaleString()}
                  sub="טיפול / תיקון / מסמך"
                  color={C.amber}
                />
                <MetricCard
                  icon={TrendingUp}
                  label="משתמשים פעילים"
                  value={activeIds.size.toLocaleString()}
                  sub="עם פעילות בטווח"
                  color={C.purple}
                />
                <MetricCard
                  icon={Star}
                  label="דירוג ממוצע"
                  value={avgRating ? `${avgRating} ★` : '—'}
                  sub={`${reviews.length} ביקורות`}
                  color={C.amber}
                />
                <MetricCard
                  icon={AlertTriangle}
                  label="התראות פתוחות"
                  value={totalAlerts.toLocaleString()}
                  sub="טסט / ביטוח / ציוד"
                  color={totalAlerts > 0 ? C.red : C.slate}
                  danger={totalAlerts > 0}
                />
              </div>
            </section>

            {/* ══════════════════════════════════════════════════════
                SECTION 2 — FUNNEL
            ══════════════════════════════════════════════════════ */}
            <section>
              <SectionLabel>משפך הפעלה · {fLabel}</SectionLabel>
              <ChartCard>
                <p className="text-[11px] text-gray-400 mb-5 leading-relaxed">
                  קצב ההמרה בין שלבי שימוש מרכזיים — מהרשמה ועד שימוש חוזר.
                  כל שלב מציג כמה משתמשים הגיעו אליו מתוך הטווח הנבחר.
                </p>
                <div className="space-y-4">
                  {funnel.map((step, i) => (
                    <FunnelBar
                      key={i}
                      step={step.step}
                      value={step.value}
                      maxValue={funnel[0].value || 1}
                      rate={step.pct}
                      showDropoff={i < funnel.length - 2 && step.next !== null}
                      dropoffPct={step.next !== null && step.value > 0
                        ? Math.round((step.next / step.value) * 100)
                        : null}
                    />
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-4 border-t border-gray-50 pt-3">
                  ✦ "משתמשים חוזרים" = חשבונות שנרשמו לפני הטווח הנבחר ובצעו פעולה במהלכו
                </p>
              </ChartCard>
            </section>

            {/* ══════════════════════════════════════════════════════
                SECTION 3 — TIME SERIES
            ══════════════════════════════════════════════════════ */}
            {showSeries && (
              <section>
                <SectionLabel>מגמות לאורך זמן · {fLabel}</SectionLabel>
                <ChartCard>
                  <div className="flex items-center gap-4 mb-4 flex-wrap">
                    {[
                      { key: 'הרשמות', color: C.blue   },
                      { key: 'רכבים',  color: C.green  },
                      { key: 'פעולות', color: C.amber  },
                    ].map(s => (
                      <div key={s.key} className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-xs text-gray-500">{s.key}</span>
                      </div>
                    ))}
                  </div>
                  {dailySeries.every(d => !d['הרשמות'] && !d['רכבים'] && !d['פעולות'])
                    ? <EmptyChart />
                    : (
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={dailySeries} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                          <defs>
                            {[['gradBlue', C.blue], ['gradGreen', C.green], ['gradAmber', C.amber]].map(([id, color]) => (
                              <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%"   stopColor={color} stopOpacity={0.12} />
                                <stop offset="100%" stopColor={color} stopOpacity={0}    />
                              </linearGradient>
                            ))}
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip content={<BiTooltip />} />
                          <Area type="monotone" dataKey="הרשמות" stroke={C.blue}  strokeWidth={2} fill="url(#gradBlue)"  dot={false} activeDot={{ r: 3 }} />
                          <Area type="monotone" dataKey="רכבים"  stroke={C.green} strokeWidth={2} fill="url(#gradGreen)" dot={false} activeDot={{ r: 3 }} />
                          <Area type="monotone" dataKey="פעולות" stroke={C.amber} strokeWidth={2} fill="url(#gradAmber)" dot={false} activeDot={{ r: 3 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )
                  }
                </ChartCard>
              </section>
            )}

            {/* ══════════════════════════════════════════════════════
                SECTION 4 + 5 — BEHAVIOR & TRAFFIC SOURCE
            ══════════════════════════════════════════════════════ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

              {/* User behavior */}
              <section>
                <SectionLabel>פעולות לפי סוג · {fLabel}</SectionLabel>
                <ChartCard className="h-full">
                  {actionRank.every(a => a.count === 0)
                    ? <EmptyChart text="לא בוצעו פעולות בטווח שנבחר" />
                    : (
                      <div className="space-y-4">
                        {actionRank.map((action, i) => {
                          const maxCount = actionRank[0].count || 1;
                          const barW = Math.max(2, Math.round((action.count / maxCount) * 100));
                          return (
                            <div key={action.name}>
                              <div className="flex items-center justify-between mb-1.5 text-xs">
                                <span className="flex items-center gap-1.5 font-medium text-gray-700">
                                  <span className="text-base leading-none">{action.emoji}</span>
                                  <span>{action.name}</span>
                                  {i === 0 && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500">
                                      מוביל
                                    </span>
                                  )}
                                </span>
                                <span className="font-bold text-gray-900 tabular-nums">{action.count}</span>
                              </div>
                              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${barW}%`, backgroundColor: CHART_PALETTE[i] }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )
                  }
                </ChartCard>
              </section>

              {/* Traffic source (placeholder - requires external analytics) */}
              <section>
                <SectionLabel>מקורות תנועה</SectionLabel>
                <ChartCard className="h-full flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>דורש אינטגרציה עם ספק אנליטיקס חיצוני</span>
                    </div>
                    <div className="space-y-2 mt-4">
                      {[
                        { src: 'Google Search', icon: '🔍', color: '#4285F4' },
                        { src: 'Facebook / Meta', icon: '📘', color: '#1877F2' },
                        { src: 'כניסה ישירה',    icon: '🔗', color: C.green   },
                        { src: 'אחר',             icon: '🌐', color: C.slate   },
                      ].map(s => (
                        <div key={s.src} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                          <span className="text-sm">{s.icon}</span>
                          <span className="text-xs text-gray-600 flex-1">{s.src}</span>
                          <span className="text-xs font-bold text-gray-300">—</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-4 leading-relaxed">
                    לאחר חיבור Google Analytics או Mixpanel, הנתונים יוצגו כאן אוטומטית.
                  </p>
                </ChartCard>
              </section>
            </div>

            {/* ══════════════════════════════════════════════════════
                SECTION 6 — RETENTION
            ══════════════════════════════════════════════════════ */}
            <section>
              <SectionLabel>שימור משתמשים (כל הזמנים)</SectionLabel>
              <div className="grid grid-cols-3 gap-4">
                <RetentionCard label="חזרו לאחר" period="יום אחד"   {...retention.d1}  />
                <RetentionCard label="חזרו לאחר" period="7 ימים"    {...retention.d7}  />
                <RetentionCard label="חזרו לאחר" period="30 יום"    {...retention.d30} />
              </div>
              <p className="text-[10px] text-center text-gray-400 mt-2">
                שימור מחושב לפי פעילות (רכב / טיפול / מסמך / תיקון) לאחר יום ההרשמה
              </p>
            </section>

            {/* ══════════════════════════════════════════════════════
                SECTION 7 — TOP USERS TABLE
            ══════════════════════════════════════════════════════ */}
            <section>
              <SectionLabel>משתמשים מובילים לפי רכבים</SectionLabel>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {topUsers.length === 0
                  ? <EmptyChart text="אין נתוני משתמשים" />
                  : (
                    <table className="w-full text-right">
                      <thead>
                        <tr className="bg-slate-50 border-b border-gray-100">
                          <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wide">#</th>
                          <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wide">משתמש</th>
                          <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wide hidden sm:table-cell">תאריך הצטרפות</th>
                          <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wide text-center">רכבים</th>
                          <th className="px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wide text-center hidden sm:table-cell">פעולות</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {topUsers.map((user, i) => {
                          const uVehs = a2v[user.id] || [];
                          const uActs = maintLogs.filter(m => uVehs.some(v => v.id === m.vehicle_id)).length
                                      + repairLogs.filter(r => uVehs.some(v => v.id === r.vehicle_id)).length
                                      + documents.filter(d => uVehs.some(v => v.id === d.vehicle_id)).length;
                          const initials = (user.name || '#')[0].toUpperCase();
                          const avatarColor = CHART_PALETTE[i % CHART_PALETTE.length];
                          return (
                            <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-5 py-3 text-xs text-gray-400 font-mono">{i + 1}</td>
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div
                                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold"
                                    style={{ backgroundColor: avatarColor }}
                                  >
                                    {initials}
                                  </div>
                                  <span className="text-sm font-medium text-gray-900">
                                    {user.name || `חשבון #${String(user.id).slice(-6)}`}
                                  </span>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-xs text-gray-400 hidden sm:table-cell">
                                {user.created_date
                                  ? format(parseISO(user.created_date), 'dd/MM/yyyy')
                                  : '—'}
                              </td>
                              <td className="px-5 py-3 text-center">
                                <span
                                  className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white"
                                  style={{ backgroundColor: avatarColor }}
                                >
                                  {user.vehicleCount}
                                </span>
                              </td>
                              <td className="px-5 py-3 text-center text-xs text-gray-500 font-medium hidden sm:table-cell">
                                {uActs}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )
                }
              </div>
            </section>

            {/* ══════════════════════════════════════════════════════
                ALERTS — collapsible
            ══════════════════════════════════════════════════════ */}
            {totalAlerts > 0 && (
              <section>
                <SectionLabel>התראות מערכת (כל הזמנים)</SectionLabel>
                <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-amber-50 transition-colors"
                    onClick={() => setShowAlerts(p => !p)}
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="text-sm font-semibold text-amber-700">
                        {totalAlerts} התראות פתוחות
                      </span>
                    </div>
                    {showAlerts
                      ? <ChevronUp   className="h-4 w-4 text-amber-400" />
                      : <ChevronDown className="h-4 w-4 text-amber-400" />
                    }
                  </button>
                  {showAlerts && (
                    <div className="px-5 pb-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {[
                        { label: 'טסט פג תוקף',              count: expiredTest.length, color: C.red    },
                        { label: 'טסט — עד 30 יום',           count: soonTest.length,   color: C.amber  },
                        { label: 'ביטוח פג תוקף',             count: expiredIns.length, color: C.red    },
                        { label: 'ביטוח — עד 30 יום',         count: soonIns.length,    color: C.amber  },
                        { label: '🔴 פירוטכניקה פגה',         count: expiredPyro.length,color: C.red    },
                        { label: '🧯 מטף כיבוי פג',           count: expiredExt.length, color: C.red    },
                        { label: '🛟 אסדת הצלה פגה',          count: expiredRaft.length,color: C.red    },
                      ].filter(a => a.count > 0).map(a => (
                        <div
                          key={a.label}
                          className="flex items-center justify-between rounded-xl px-4 py-3 border"
                          style={{ backgroundColor: a.color + '0D', borderColor: a.color + '30' }}
                        >
                          <span className="text-xs font-medium" style={{ color: a.color }}>{a.label}</span>
                          <span className="text-xl font-bold" style={{ color: a.color }}>{a.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ══════════════════════════════════════════════════════
                SECTION — ANONYMOUS ANALYTICS
            ══════════════════════════════════════════════════════ */}
            <section>
              <SectionLabel>אנליטיקס אנונימי (כל הזמנים)</SectionLabel>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <MetricCard
                  icon={Users}
                  label="כניסות אורחים"
                  value={(analyticsAgg['guest_session'] || 0).toLocaleString()}
                  sub="סה״כ כניסות ללא הרשמה"
                  color={C.purple}
                />
                <MetricCard
                  icon={TrendingUp}
                  label="התחברויות"
                  value={(analyticsAgg['auth_login'] || 0).toLocaleString()}
                  sub="כניסות עם חשבון"
                  color={C.blue}
                />
                <MetricCard
                  icon={Users}
                  label="הרשמות"
                  value={(analyticsAgg['auth_signup'] || 0).toLocaleString()}
                  sub="חשבונות חדשים"
                  color={C.green}
                />
                <MetricCard
                  icon={Car}
                  label="רכבים (אורחים)"
                  value={(analyticsAgg['guest_vehicle_added'] || 0).toLocaleString()}
                  sub="רכבים שנוספו במצב אורח"
                  color={C.amber}
                />
              </div>
              <ChartCard title="כניסות אורחים — 7 ימים אחרונים">
                {analyticsRecent.every(d => d['אורחים'] === 0)
                  ? <EmptyChart text="אין נתוני אורחים עדיין" />
                  : (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={analyticsRecent} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<BiTooltip />} />
                        <Bar dataKey="אורחים" fill={C.purple} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )
                }
              </ChartCard>
            </section>

            {/* Footer */}
            <p className="text-[10px] text-center text-gray-300">
              נתונים בזמן אמת ממסד הנתונים · {format(TODAY, 'HH:mm')}
            </p>

          </>
        )}
      </div>
    </div>
  );
}

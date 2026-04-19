import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import PageHeader from '../components/shared/PageHeader';
import {
  Users, Shield, TrendingUp, Car, Wrench, FileText,
  Star, AlertTriangle, Activity, ArrowDown, ChevronDown, ChevronUp,
  RefreshCw, BarChart2, Trash2, Download, Copy, Mail, Check, AlertCircle,
  UserCog, ShieldCheck,
} from 'lucide-react';
import ConfirmDeleteDialog from '../components/shared/ConfirmDeleteDialog';
import { toast } from 'sonner';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid,
  LineChart, Line, ComposedChart, Legend,
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

// Neutral BI palette - intentionally different from main app branding
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
  const [adminTab, setAdminTab]     = useState('stats'); // stats | users | messages | bugs
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

  // Step 2: fetch data (admin only) - using Supabase entities
  useEffect(() => {
    if (isAdmin !== true) return;
    setLoading(true);
    Promise.all([
      db.accounts.list().catch(() => []),
      db.vehicles.list().catch(() => []),
      db.maintenance_logs.list().catch(() => []),
      Promise.resolve([]),  // repairLogs merged into maintenance_logs
      Promise.resolve([]),  // reviews placeholder
      db.documents.list().catch(() => []),
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

  // ── BI metrics ─────────────────────────────────────────────────────────────
  // Everything from here powers the redesigned stats dashboard.

  // Helper: sum a specific event's count over a date range.
  const sumEvent = (event, fromDate, toDate) => {
    return analyticsData
      .filter(r => r.event === event)
      .filter(r => {
        const d = r.date;
        return d >= fromDate && d <= toDate;
      })
      .reduce((s, r) => s + (r.count || 0), 0);
  };

  // 14-day trend: logins, signups, guest sessions, page views — one point per day.
  const engagementTrend = useMemo(() => {
    const days = 14;
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(TODAY, i), 'yyyy-MM-dd');
      const label = format(subDays(TODAY, i), 'dd/MM', { locale: he });
      const login = analyticsData.find(r => r.event === 'auth_login' && r.date === d)?.count || 0;
      const signup = analyticsData.find(r => r.event === 'auth_signup' && r.date === d)?.count || 0;
      const guest = analyticsData.find(r => r.event === 'guest_session' && r.date === d)?.count || 0;
      out.push({ name: label, date: d, 'התחברויות': login, 'הרשמות': signup, 'אורחים': guest });
    }
    return out;
  }, [analyticsData]);

  // Conversion: guest→signup ratio per day with a 7-day rolling mean to smooth
  // out weekday noise. A row is only kept if the denominator is non-zero.
  const conversionTrend = useMemo(() => {
    const days = 30;
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(TODAY, i), 'yyyy-MM-dd');
      const signup = analyticsData.find(r => r.event === 'auth_signup' && r.date === d)?.count || 0;
      const guest = analyticsData.find(r => r.event === 'guest_session' && r.date === d)?.count || 0;
      daily.push({ d, signup, guest });
    }
    return daily.map((p, idx) => {
      // 7-day rolling window ending at p
      const window = daily.slice(Math.max(0, idx - 6), idx + 1);
      const sS = window.reduce((s, w) => s + w.signup, 0);
      const sG = window.reduce((s, w) => s + w.guest, 0);
      const rate = sG > 0 ? Math.round((sS / sG) * 100) : null;
      return {
        name: format(parseISO(p.d), 'dd/MM', { locale: he }),
        'המרה %': rate,
        'אורחים': p.guest,
        'הרשמות': p.signup,
      };
    });
  }, [analyticsData]);

  // Feature engagement — sum of page_view:<path> events per page, all-time.
  const featureRanking = useMemo(() => {
    const byPage = {};
    const PAGE_LABELS = {
      'Dashboard': 'בית',
      'Vehicles': 'רכבים',
      'VehicleDetail': 'פרטי רכב',
      'AddVehicle': 'הוספת רכב',
      'EditVehicle': 'עריכת רכב',
      'Documents': 'מסמכים',
      'FindGarage': 'מצא מוסך',
      'AiAssistant': 'מומחה AI',
      'Accidents': 'תאונות',
      'AddAccident': 'הוספת תאונה',
      'Notifications': 'התראות',
      'UserProfile': 'פרופיל',
      'AccountSettings': 'הגדרות',
      'Community': 'קהילה',
      'AdminReviews': 'ביקורות',
      'ReminderSettingsPage': 'הגדרות תזכורות',
      'Invites': 'הזמנות',
    };
    analyticsData.forEach(r => {
      if (!r.event?.startsWith('page_view:')) return;
      const page = r.event.slice('page_view:'.length);
      const label = PAGE_LABELS[page] || page;
      byPage[label] = (byPage[label] || 0) + (r.count || 0);
    });
    return Object.entries(byPage)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [analyticsData]);

  // Week-over-week deltas — powers the "insights" callouts.
  const insights = useMemo(() => {
    const today = format(TODAY, 'yyyy-MM-dd');
    const d7Ago = format(subDays(TODAY, 7), 'yyyy-MM-dd');
    const d14Ago = format(subDays(TODAY, 14), 'yyyy-MM-dd');
    const d1Ago = format(subDays(TODAY, 1), 'yyyy-MM-dd');

    // Signups this week vs previous week
    const signup7 = sumEvent('auth_signup', d7Ago, today);
    const signup7prev = sumEvent('auth_signup', d14Ago, d7Ago);
    const signupDelta = signup7prev > 0
      ? Math.round(((signup7 - signup7prev) / signup7prev) * 100)
      : (signup7 > 0 ? 100 : 0);

    // Logins this week vs previous week
    const login7 = sumEvent('auth_login', d7Ago, today);
    const login7prev = sumEvent('auth_login', d14Ago, d7Ago);
    const loginDelta = login7prev > 0
      ? Math.round(((login7 - login7prev) / login7prev) * 100)
      : (login7 > 0 ? 100 : 0);

    // Conversion rate 7-day vs previous 7-day
    const guest7 = sumEvent('guest_session', d7Ago, today);
    const guest7prev = sumEvent('guest_session', d14Ago, d7Ago);
    const conv7 = guest7 > 0 ? Math.round((signup7 / guest7) * 100) : 0;
    const conv7prev = guest7prev > 0 ? Math.round((signup7prev / guest7prev) * 100) : 0;
    const convDelta = conv7 - conv7prev; // absolute percentage points

    // Top feature in the last 7 days
    const weeklyFeatures = {};
    analyticsData.forEach(r => {
      if (!r.event?.startsWith('page_view:')) return;
      if (r.date < d7Ago || r.date > today) return;
      const page = r.event.slice('page_view:'.length);
      weeklyFeatures[page] = (weeklyFeatures[page] || 0) + (r.count || 0);
    });
    const topFeature = Object.entries(weeklyFeatures)
      .sort((a, b) => b[1] - a[1])[0];

    // Login today (proxy for DAU)
    const loginToday = sumEvent('auth_login', today, today);
    const loginYesterday = sumEvent('auth_login', d1Ago, d1Ago);

    return {
      signup7,
      signupDelta,
      login7,
      loginDelta,
      conv7,
      convDelta,
      topFeature: topFeature ? { page: topFeature[0], count: topFeature[1] } : null,
      loginToday,
      loginYesterday,
      guest7,
    };
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
            <h1 className="text-base font-bold text-gray-900">לוח ניהול</h1>
            <p className="text-xs text-gray-400 mt-0.5">{format(TODAY, 'EEEE · dd/MM/yyyy', { locale: he })}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.location.reload()}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all">
              <RefreshCw className="w-3 h-3" />
              רענן
            </button>
            {adminTab === 'stats' && (
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
            )}
          </div>
        </div>
        {/* Admin tabs */}
        <div className="flex gap-1 px-4 sm:px-6 pb-3 overflow-x-auto">
          {[
            { key: 'stats', label: '📊 סטטיסטיקה' },
            { key: 'users', label: '👥 משתמשים' },
            { key: 'messages', label: '📬 הודעות' },
            { key: 'bugs', label: '🐛 באגים' },
          ].map(t => (
            <button key={t.key} onClick={() => setAdminTab(t.key)}
              className={`px-4 py-2 rounded-lg text-xs font-bold shrink-0 transition-all ${
                adminTab === t.key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 sm:px-6 py-6 space-y-8 max-w-[1200px] mx-auto">

        {/* Non-stats tabs */}
        {adminTab === 'users' && <AdminUsersTab />}
        {adminTab === 'messages' && <AdminMessagesTab />}
        {adminTab === 'bugs' && <AdminBugsTab />}

        {adminTab === 'stats' && <>

        {/* Error banner */}
        {fetchError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            שגיאה בטעינת נתונים - אנא רענן את הדף.
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>
        ) : (
          <>

            {/* ══════════════════════════════════════════════════════
                SECTION 1 - KPI CARDS
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
                  value={avgRating ? `${avgRating} ★` : '-'}
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
                BI — תובנות מרכזיות (auto-generated week-over-week)
            ══════════════════════════════════════════════════════ */}
            <section>
              <SectionLabel>תובנות מרכזיות (7 ימים אחרונים)</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <InsightCard
                  label="הרשמות חדשות השבוע"
                  value={insights.signup7.toLocaleString()}
                  delta={insights.signupDelta}
                  deltaSuffix="% משבוע שעבר"
                  tone="green"
                />
                <InsightCard
                  label="התחברויות השבוע"
                  value={insights.login7.toLocaleString()}
                  delta={insights.loginDelta}
                  deltaSuffix="% משבוע שעבר"
                  tone="blue"
                />
                <InsightCard
                  label="המרה אורחים → רישום"
                  value={`${insights.conv7}%`}
                  delta={insights.convDelta}
                  deltaSuffix=" נק' אחוז"
                  tone="purple"
                  sub={`${insights.guest7.toLocaleString()} אורחים, ${insights.signup7.toLocaleString()} הרשמות`}
                />
                <InsightCard
                  label="התחברויות היום"
                  value={insights.loginToday.toLocaleString()}
                  delta={insights.loginYesterday > 0
                    ? Math.round(((insights.loginToday - insights.loginYesterday) / insights.loginYesterday) * 100)
                    : null}
                  deltaSuffix="% מאתמול"
                  tone="amber"
                  sub={`אתמול: ${insights.loginYesterday}`}
                />
              </div>
              {insights.topFeature && (
                <div className="mt-3 bg-gradient-to-l from-purple-50 to-blue-50 border border-purple-100 rounded-2xl px-4 py-3 flex items-center gap-3">
                  <span className="text-2xl">🔥</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-purple-700">הפיצ'ר הפופולרי השבוע</p>
                    <p className="text-sm text-gray-700">
                      <span className="font-bold">{insights.topFeature.page}</span>
                      {' '}עם {insights.topFeature.count} צפיות
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* ══════════════════════════════════════════════════════
                BI — מגמת כניסות ורישומים (14 ימים)
            ══════════════════════════════════════════════════════ */}
            <section>
              <SectionLabel>מגמת כניסות ורישומים · 14 ימים אחרונים</SectionLabel>
              <ChartCard>
                {engagementTrend.every(d => !d['התחברויות'] && !d['הרשמות'] && !d['אורחים'])
                  ? <EmptyChart text="עדיין אין אירועי כניסה מתוצפים" />
                  : (
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={engagementTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<BiTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="התחברויות" stroke={C.blue} strokeWidth={2.5} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                        <Line type="monotone" dataKey="הרשמות" stroke={C.green} strokeWidth={2.5} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                        <Line type="monotone" dataKey="אורחים" stroke={C.purple} strokeWidth={2.5} strokeDasharray="4 3" dot={{ r: 2 }} activeDot={{ r: 5 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )
                }
                <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
                  כל נקודה = מספר אירועים ביום. קו מקווקו (אורחים) מאפשר להשוות מי פותח את האפליקציה בלי להירשם.
                </p>
              </ChartCard>
            </section>

            {/* ══════════════════════════════════════════════════════
                BI — אחוז המרה אורחים → משתמשים (30 יום, 7-day rolling)
            ══════════════════════════════════════════════════════ */}
            <section>
              <SectionLabel>אחוז המרה אורחים → רישום · 30 יום</SectionLabel>
              <ChartCard>
                {conversionTrend.every(d => d['המרה %'] === null)
                  ? <EmptyChart text="אין מספיק נתונים לחישוב המרה" />
                  : (
                    <ResponsiveContainer width="100%" height={240}>
                      <ComposedChart data={conversionTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <YAxis yAxisId="right" orientation="left" tick={{ fontSize: 11, fill: '#A855F7' }} axisLine={false} tickLine={false} unit="%" />
                        <Tooltip content={<BiTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="left" dataKey="אורחים" fill={C.slate} opacity={0.5} radius={[4, 4, 0, 0]} />
                        <Bar yAxisId="left" dataKey="הרשמות" fill={C.green} radius={[4, 4, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="המרה %" stroke={C.purple} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )
                }
                <p className="text-[10px] text-gray-400 mt-3 leading-relaxed">
                  קו המרה = ממוצע נע של 7 ימים (חלק מרעשי סופי־שבוע). עלייה עקבית = יחס המרה משתפר.
                </p>
              </ChartCard>
            </section>

            {/* ══════════════════════════════════════════════════════
                BI — דירוג פיצ'רים (page view events, כל הזמנים)
            ══════════════════════════════════════════════════════ */}
            <section>
              <SectionLabel>דירוג פיצ'רים — איפה המשתמשים מבלים</SectionLabel>
              <ChartCard>
                {featureRanking.length === 0
                  ? <EmptyChart text="עדיין אין נתוני page_view (טרקר הופעל זה עתה)" />
                  : (
                    <div className="space-y-3">
                      {featureRanking.map((f, i) => {
                        const max = featureRanking[0].count || 1;
                        const pct = Math.round((f.count / max) * 100);
                        return (
                          <div key={f.name}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="font-medium text-gray-700 flex items-center gap-1.5">
                                <span className="text-[10px] font-bold text-gray-400 w-4">#{i + 1}</span>
                                {f.name}
                              </span>
                              <span className="font-bold text-gray-900 tabular-nums">{f.count.toLocaleString()}</span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                }
                <p className="text-[10px] text-gray-400 mt-4 leading-relaxed">
                  הצפייה נספרת פעם אחת לכל משתמש בכל פתיחת אפליקציה. פיצ'ר בתחתית הרשימה = מועמד לשיפור UX או להבלטה.
                </p>
              </ChartCard>
            </section>

            {/* ══════════════════════════════════════════════════════
                SECTION 2 - FUNNEL
            ══════════════════════════════════════════════════════ */}
            <section>
              <SectionLabel>משפך הפעלה · {fLabel}</SectionLabel>
              <ChartCard>
                <p className="text-[11px] text-gray-400 mb-5 leading-relaxed">
                  קצב ההמרה בין שלבי שימוש מרכזיים - מהרשמה ועד שימוש חוזר.
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
                SECTION 3 - TIME SERIES
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
                SECTION 4 + 5 - BEHAVIOR & TRAFFIC SOURCE
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
                          <span className="text-xs font-bold text-gray-300">-</span>
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
                SECTION 6 - RETENTION
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
                SECTION 7 - TOP USERS TABLE
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
                                  : '-'}
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
                ALERTS - collapsible
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
                        { label: 'טסט - עד 30 יום',           count: soonTest.length,   color: C.amber  },
                        { label: 'ביטוח פג תוקף',             count: expiredIns.length, color: C.red    },
                        { label: 'ביטוח - עד 30 יום',         count: soonIns.length,    color: C.amber  },
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
                SECTION - ANONYMOUS ANALYTICS
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
              <ChartCard title="כניסות אורחים - 7 ימים אחרונים">
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
        </>}
      </div>
    </div>
  );
}

// ── Admin Tabs ────────────────────────────────────────────────────────────

function AdminUsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rpcMissing, setRpcMissing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load accounts via the admin RPC when it's available; gracefully fall back
  // to client-side joins (accounts + account_members + vehicles + documents)
  // when the RPC hasn't been deployed yet. That way the richer table still
  // renders — just without emails and role info.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('admin_list_accounts');
        if (cancelled) return;
        if (error) throw error;
        setRpcMissing(false);
        setUsers(
          (data || []).map(r => ({
            id: r.account_id,
            name: r.account_name,
            created_at: r.account_created_at,
            owner_user_id: r.owner_user_id,
            email: r.owner_email,
            owner_name: r.owner_name,
            role: r.owner_role || 'user',
            memberCount: r.member_count || 0,
            vehicleCount: r.vehicle_count || 0,
            documentCount: r.document_count || 0,
            last_sign_in_at: r.last_sign_in_at,
            email_confirmed_at: r.email_confirmed_at,
          }))
        );
      } catch (e) {
        if (cancelled) return;
        // RPC not deployed yet — fall back to whatever we can see client-side.
        setRpcMissing(true);
        try {
          const [accounts, members, vehicles, documents] = await Promise.all([
            db.accounts.list().catch(() => []),
            db.account_members.list().catch(() => []),
            db.vehicles.list().catch(() => []),
            db.documents.list().catch(() => []),
          ]);
          if (cancelled) return;
          setUsers(
            accounts.map(a => ({
              id: a.id,
              name: a.name,
              created_at: a.created_at,
              owner_user_id: null,
              email: null,
              owner_name: '',
              role: 'user',
              memberCount: members.filter(m => m.account_id === a.id).length,
              vehicleCount: vehicles.filter(v => v.account_id === a.id).length,
              documentCount: documents.filter(d => d.account_id === a.id).length,
              last_sign_in_at: null,
              email_confirmed_at: null,
            }))
          );
        } catch {
          setUsers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // ── Search + sort + pagination ─────────────────────────────────────────
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('created');   // created | vehicles | lastLogin | name
  const [sortDir, setSortDir] = useState('desc');
  const PAGE_SIZE = 50;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? users
      : users.filter(u =>
          (u.name || '').toLowerCase().includes(q)
          || (u.email || '').toLowerCase().includes(q)
          || (u.owner_name || '').toLowerCase().includes(q)
          || u.id.toLowerCase().includes(q)
        );
    const arr = [...base];
    const mul = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'vehicles':  return mul * ((a.vehicleCount || 0) - (b.vehicleCount || 0));
        case 'lastLogin': return mul * (new Date(a.last_sign_in_at || 0) - new Date(b.last_sign_in_at || 0));
        case 'name':      return mul * String(a.name || '').localeCompare(String(b.name || ''), 'he');
        case 'created':
        default:          return mul * (new Date(a.created_at || 0) - new Date(b.created_at || 0));
      }
    });
    return arr;
  }, [users, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageUsers = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(() => { setPage(0); }, [search, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // ── Actions ────────────────────────────────────────────────────────────
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const doDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('admin_delete_account', { p_account_id: pendingDelete.id });
      if (error) throw error;
      toast.success('החשבון נמחק');
      setPendingDelete(null);
      setRefreshKey(k => k + 1);
    } catch (e) {
      toast.error('שגיאה במחיקה: ' + (e?.message || 'unknown'));
    } finally {
      setDeleting(false);
    }
  };

  const toggleAdmin = async (u) => {
    if (!u.owner_user_id) { toast.error('אין בעלים לחשבון'); return; }
    const nextRole = u.role === 'admin' ? 'user' : 'admin';
    try {
      const { error } = await supabase.rpc('admin_set_role', { p_user_id: u.owner_user_id, p_role: nextRole });
      if (error) throw error;
      toast.success(nextRole === 'admin' ? 'הוגדר כאדמין' : 'הוסר מנהל');
      setRefreshKey(k => k + 1);
    } catch (e) {
      toast.error('שגיאה: ' + (e?.message || 'unknown'));
    }
  };

  const copyEmail = async (email) => {
    try { await navigator.clipboard.writeText(email); toast.success('הועתק'); } catch {}
  };

  const exportCsv = () => {
    const header = ['שם חשבון', 'אימייל', 'תפקיד', 'רכבים', 'מסמכים', 'חברים', 'התחברות אחרונה', 'נוצר', 'אומת', 'ID'];
    const rows = filtered.map(u => [
      u.name || '',
      u.email || '',
      u.role || '',
      u.vehicleCount,
      u.documentCount,
      u.memberCount,
      u.last_sign_in_at ? format(parseISO(u.last_sign_in_at), 'yyyy-MM-dd HH:mm') : '',
      u.created_at ? format(parseISO(u.created_at), 'yyyy-MM-dd') : '',
      u.email_confirmed_at ? 'כן' : 'לא',
      u.id,
    ]);
    const escape = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '\uFEFF' + [header, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `accounts-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Summary stats for the quick pills above the table ──────────────────
  const stats = useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    return {
      total: users.length,
      withVehicle: users.filter(u => u.vehicleCount > 0).length,
      activeLast7d: users.filter(u => u.last_sign_in_at && now - new Date(u.last_sign_in_at).getTime() < 7 * day).length,
      unverified: users.filter(u => u.email && !u.email_confirmed_at).length,
      admins: users.filter(u => u.role === 'admin').length,
    };
  }, [users]);

  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner /></div>;

  const SortHead = ({ label, k }) => (
    <th className="text-right py-2 px-2 cursor-pointer select-none" onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k && <span className="text-gray-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  );

  return (
    <div className="space-y-4">
      {rpcMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800">
            <p className="font-bold mb-1">פונקציות אדמין לא פרוסות</p>
            <p>הטבלה מציגה מידע חלקי (ללא אימייל / התחברות אחרונה / מחיקה). הרץ את <code className="bg-amber-100 px-1.5 py-0.5 rounded">supabase-admin-functions.sql</code> ב-Supabase Dashboard → SQL Editor כדי להפעיל את כל היכולות.</p>
          </div>
        </div>
      )}

      {/* Stat pills */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatPill label="חשבונות" value={stats.total} tone="blue" />
        <StatPill label="עם רכב" value={stats.withVehicle} tone="green" />
        <StatPill label="פעילים (7 ימים)" value={stats.activeLast7d} tone="emerald" />
        <StatPill label="לא אומתו" value={stats.unverified} tone="amber" />
        <StatPill label="אדמינים" value={stats.admins} tone="purple" />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-3 sm:p-4">
        {/* Toolbar — stacks on mobile, row on desktop. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <h2 className="font-bold text-gray-900 text-sm sm:text-base">
            כל החשבונות ({filtered.length}{search && ` / ${users.length}`})
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="שם / אימייל / ID..."
              className="flex-1 sm:flex-none text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 sm:min-w-[200px]"
              aria-label="חיפוש חשבונות"
            />
            <button onClick={exportCsv}
              className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 flex items-center gap-1.5 font-bold">
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">CSV</span>
            </button>
            <button onClick={() => setRefreshKey(k => k + 1)}
              className="shrink-0 text-xs p-1.5 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200" aria-label="רענן">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Mobile sort control — the table's click-to-sort doesn't exist in card view. */}
        <div className="sm:hidden mb-3">
          <select value={`${sortKey}:${sortDir}`}
            onChange={(e) => { const [k, d] = e.target.value.split(':'); setSortKey(k); setSortDir(d); }}
            className="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 font-bold">
            <option value="created:desc">נוצר — חדש לישן</option>
            <option value="created:asc">נוצר — ישן לחדש</option>
            <option value="lastLogin:desc">התחברות אחרונה — חדש לישן</option>
            <option value="vehicles:desc">רכבים — הרבה למעט</option>
            <option value="vehicles:asc">רכבים — מעט להרבה</option>
            <option value="name:asc">שם — א–ת</option>
          </select>
        </div>

        {/* Mobile card list ── one account per card. */}
        <div className="sm:hidden space-y-2">
          {pageUsers.map(u => (
            <div key={u.id} className="border border-gray-100 rounded-xl p-3 bg-white">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm text-gray-900 truncate">{u.name || 'ללא שם'}</p>
                  {u.email ? (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[11px] text-gray-600 truncate">{u.email}</span>
                      {!u.email_confirmed_at && (
                        <span title="אימייל לא אומת" className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold shrink-0">!</span>
                      )}
                      <button onClick={() => copyEmail(u.email)} className="text-gray-400 shrink-0" aria-label="העתק">
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  ) : <p className="text-[11px] text-gray-300 mt-0.5">—</p>}
                </div>
                {u.role === 'admin' && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 shrink-0">
                    <ShieldCheck className="w-3 h-3" /> אדמין
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-gray-500 mb-2">
                <span><span className="font-bold text-gray-700">{u.vehicleCount}</span> רכבים</span>
                <span><span className="font-bold text-gray-700">{u.documentCount}</span> מסמכים</span>
                <span><span className="font-bold text-gray-700">{u.memberCount}</span> חברים</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-gray-50 gap-2">
                <div className="text-[10px] text-gray-400 min-w-0">
                  <div className="truncate">נוצר: {u.created_at ? format(parseISO(u.created_at), 'dd/MM/yy') : '-'}</div>
                  <div className="truncate">כניסה: {u.last_sign_in_at ? format(parseISO(u.last_sign_in_at), 'dd/MM/yy HH:mm') : '—'}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleAdmin(u)}
                    disabled={!u.owner_user_id}
                    title={u.role === 'admin' ? 'הסר אדמין' : 'הפוך לאדמין'}
                    className="p-2 rounded-lg bg-purple-50 text-purple-600 disabled:opacity-30"
                    aria-label="שנה תפקיד">
                    <UserCog className="w-4 h-4" />
                  </button>
                  <button onClick={() => setPendingDelete(u)}
                    className="p-2 rounded-lg bg-red-50 text-red-600"
                    aria-label="מחק">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {pageUsers.length === 0 && (
            <div className="py-8 text-center text-gray-400 text-xs">לא נמצאו תוצאות</div>
          )}
        </div>

        {/* Desktop table ── hidden on mobile. */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="text-gray-500 border-b border-gray-100">
              <tr>
                <SortHead label="שם חשבון" k="name" />
                <th className="text-right py-2 px-2">אימייל</th>
                <th className="text-right py-2 px-2">תפקיד</th>
                <SortHead label="רכבים" k="vehicles" />
                <th className="text-right py-2 px-2">מסמכים</th>
                <th className="text-right py-2 px-2">חברים</th>
                <SortHead label="התחברות אחרונה" k="lastLogin" />
                <SortHead label="נוצר" k="created" />
                <th className="text-right py-2 px-2">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {pageUsers.map(u => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 px-2 font-medium max-w-[140px] truncate" title={u.name}>{u.name || '-'}</td>
                  <td className="py-2 px-2">
                    {u.email ? (
                      <div className="flex items-center gap-1.5">
                        <span className="truncate max-w-[180px]" title={u.email}>{u.email}</span>
                        {!u.email_confirmed_at && (
                          <span title="אימייל לא אומת" className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">!</span>
                        )}
                        <button onClick={() => copyEmail(u.email)} className="text-gray-400 hover:text-gray-700" aria-label="העתק">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-2 px-2">
                    {u.role === 'admin' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-700">
                        <ShieldCheck className="w-3 h-3" /> אדמין
                      </span>
                    ) : <span className="text-gray-400 text-[10px]">משתמש</span>}
                  </td>
                  <td className="py-2 px-2 font-bold">{u.vehicleCount}</td>
                  <td className="py-2 px-2">{u.documentCount}</td>
                  <td className="py-2 px-2">{u.memberCount}</td>
                  <td className="py-2 px-2 text-gray-500">
                    {u.last_sign_in_at ? format(parseISO(u.last_sign_in_at), 'dd/MM/yy HH:mm') : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-2 px-2 text-gray-500">{u.created_at ? format(parseISO(u.created_at), 'dd/MM/yy') : '-'}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleAdmin(u)}
                        disabled={!u.owner_user_id}
                        title={u.role === 'admin' ? 'הסר הרשאות אדמין' : 'הפוך לאדמין'}
                        className="p-1.5 rounded-md hover:bg-purple-50 disabled:opacity-30 disabled:cursor-not-allowed text-purple-600"
                        aria-label="שנה תפקיד">
                        <UserCog className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setPendingDelete(u)}
                        title="מחק חשבון"
                        className="p-1.5 rounded-md hover:bg-red-50 text-red-600"
                        aria-label="מחק">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {pageUsers.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-gray-400">לא נמצאו תוצאות</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100" aria-label="ניווט דפים">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1.5 text-xs rounded-lg bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed font-bold">
              ← הקודם
            </button>
            <span className="text-xs text-gray-500 font-medium">דף {page + 1} מתוך {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs rounded-lg bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed font-bold">
              הבא →
            </button>
          </div>
        )}
      </div>

      <ConfirmDeleteDialog
        open={!!pendingDelete}
        title="מחיקת חשבון"
        description={pendingDelete
          ? `פעולה זו תמחק את חשבון "${pendingDelete.name || 'ללא שם'}" וכל הנתונים שלו (${pendingDelete.vehicleCount} רכבים, ${pendingDelete.documentCount} מסמכים). לא ניתן לשחזר.`
          : ''}
        onConfirm={doDelete}
        onCancel={() => !deleting && setPendingDelete(null)}
      />
    </div>
  );
}

// Headline metric card used at the top of the BI stats tab. Shows a big
// value + a delta chip (colored green/red/gray based on direction).
function InsightCard({ label, value, sub, delta, deltaSuffix = '%', tone = 'blue' }) {
  const tones = {
    blue:   { bg: 'from-blue-50 to-white',    dot: '#3B82F6' },
    green:  { bg: 'from-emerald-50 to-white', dot: '#10B981' },
    purple: { bg: 'from-purple-50 to-white',  dot: '#A855F7' },
    amber:  { bg: 'from-amber-50 to-white',   dot: '#F59E0B' },
  };
  const t = tones[tone] || tones.blue;
  const hasDelta = delta !== null && delta !== undefined && !Number.isNaN(delta);
  const positive = hasDelta && delta > 0;
  const negative = hasDelta && delta < 0;
  const neutral = hasDelta && delta === 0;
  const deltaBg = positive ? 'bg-emerald-50 text-emerald-700'
                 : negative ? 'bg-red-50 text-red-700'
                 : 'bg-gray-100 text-gray-500';
  return (
    <div className={`rounded-2xl border border-gray-100 p-4 bg-gradient-to-br ${t.bg} shadow-sm`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[11px] font-bold text-gray-500">{label}</p>
        <span className="w-1.5 h-1.5 rounded-full mt-1" style={{ background: t.dot }} />
      </div>
      <p className="text-2xl font-black text-gray-900 tracking-tight">{value}</p>
      <div className="flex items-center justify-between gap-2 mt-2">
        {sub && <p className="text-[10px] text-gray-400 truncate">{sub}</p>}
        {hasDelta && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${deltaBg}`}>
            {positive ? '↑ ' : negative ? '↓ ' : ''}{Math.abs(delta)}{deltaSuffix}
            {neutral ? ' ללא שינוי' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

// Small pill used in the Users tab summary bar.
function StatPill({ label, value, tone = 'blue' }) {
  const bg = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    purple: 'bg-purple-50 text-purple-700 border-purple-100',
  }[tone] || 'bg-gray-50 text-gray-700 border-gray-100';
  return (
    <div className={`rounded-xl border px-3 py-2 ${bg}`}>
      <p className="text-[10px] font-bold opacity-80">{label}</p>
      <p className="text-lg font-black leading-tight">{value}</p>
    </div>
  );
}

function AdminMessagesTab() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const msgs = await db.contact_messages.list().catch(() => []);
        setMessages((msgs || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      } catch {}
      setLoading(false);
    })();
  }, []);
  if (loading) return <div className="flex justify-center py-16"><LoadingSpinner /></div>;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h2 className="font-bold text-gray-900 mb-3">הודעות צור קשר ({messages.length})</h2>
        {messages.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">אין הודעות חדשות</p>
        ) : (
          <div className="space-y-2">
            {messages.map(m => (
              <div key={m.id} className="border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">{m.name}</span>
                    <span className="text-xs text-gray-500">{m.email}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    m.status === 'new' ? 'bg-blue-100 text-blue-700' :
                    m.status === 'replied' ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>{m.status}</span>
                </div>
                {m.subject && <p className="text-sm font-medium text-gray-700">{m.subject}</p>}
                <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{m.message}</p>
                <p className="text-[10px] text-gray-400 mt-2">
                  {m.created_at ? format(parseISO(m.created_at), 'dd/MM/yyyy HH:mm') : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminBugsTab() {
  // Bugs from localStorage (app-side logged) + placeholder for Sentry/crash reports
  const [bugs, setBugs] = useState([]);
  useEffect(() => {
    try {
      const logged = JSON.parse(localStorage.getItem('app_error_log') || '[]');
      setBugs(logged.slice(-50).reverse());
    } catch {}
  }, []);
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <h2 className="font-bold text-gray-900 mb-3">קראשים ובאגים ({bugs.length})</h2>
        {bugs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-gray-400">אין באגים רשומים כרגע</p>
            <p className="text-[11px] text-gray-300 mt-1">באגים שנוצרו בזמן שימוש יופיעו כאן</p>
          </div>
        ) : (
          <div className="space-y-2">
            {bugs.map((b, i) => (
              <div key={i} className="border border-red-100 bg-red-50/30 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm text-red-800">{b.type || 'Error'}</span>
                  <span className="text-[10px] text-gray-500">
                    {b.timestamp ? format(new Date(b.timestamp), 'dd/MM HH:mm') : ''}
                  </span>
                </div>
                <p className="text-xs text-gray-700">{b.message || JSON.stringify(b).slice(0, 150)}</p>
                {b.url && <p className="text-[10px] text-gray-400 mt-1">{b.url}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

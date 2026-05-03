/**
 * Phase 9, Step 5 + 10 — Business workspace dashboard.
 *
 * Manager's at-a-glance view: greeting + workspace identity, KPIs,
 * spotlight card showing fleet health, "needs attention" alerts,
 * recent activity feed (with real names via workspace_members_directory),
 * quick actions.
 *
 * Routing: when active workspace is business, /Dashboard auto-redirects
 * here. Manual /BusinessDashboard route also works.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Truck, Briefcase, MapPin, AlertTriangle, Receipt,
  CheckCircle2, FileText, TrendingUp, TrendingDown, ArrowLeft,
  Plus, Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import MobileBackButton from '@/components/shared/MobileBackButton';
import { createPageUrl } from '@/utils';

// ---------- helpers ---------------------------------------------------

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - new Date().getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

const fmtMoney = (n, c = 'ILS') =>
  new Intl.NumberFormat('he-IL', {
    style: 'currency', currency: c, maximumFractionDigits: 0,
  }).format(n || 0);

const fmtNumber = (n) => new Intl.NumberFormat('he-IL').format(n || 0);

const fmtTimeShort = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1)   return 'הרגע';
  if (diffMin < 60)  return `לפני ${diffMin} דק׳`;
  if (diffHr  < 24)  return `לפני ${diffHr} שעות`;
  if (diffDay < 7)   return `לפני ${diffDay} ימים`;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
};

const monthStartISO = () => {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
};

function greetingFor(date = new Date()) {
  const h = date.getHours();
  if (h >= 5  && h < 12) return 'בוקר טוב';
  if (h >= 12 && h < 17) return 'צהריים טובים';
  if (h >= 17 && h < 22) return 'ערב טוב';
  return 'לילה טוב';
}

function hebrewDate(date = new Date()) {
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  return `יום ${days[date.getDay()]}, ${date.toLocaleDateString('he-IL', {
    day: '2-digit', month: 'long', year: 'numeric',
  })}`;
}

const ACTION_LABEL = {
  'workspace.create':           'נוצרה סביבת עבודה עסקית',
  'workspace.create_approved':  'אושרה בקשה לחשבון עסקי',
  'driver.assign':              'נהג שויך לרכב',
  'route.create':               'נוצרה משימה',
  'route.start':                'משימה יצאה לדרך',
  'route.complete':             'משימה הושלמה',
  'route.reopen':               'משימה נפתחה מחדש',
  'stop.complete':              'תחנה הושלמה',
  'stop.skip':                  'תחנה דולגה',
  'stop.issue':                 'תקלה דווחה בתחנה',
  'stop.reopen':                'תחנה נפתחה מחדש',
  'stop.note_added':            'נוספה הערה לתחנה',
  'stop.photo_added':           'נוספה תמונה לתחנה',
  'stop.issue_documented':      'תיעוד תקלה',
  'expense.add':                'נרשמה הוצאה',
  'expense.update':             'הוצאה עודכנה',
  'expense.delete':             'הוצאה נמחקה',
  'member.add':                 'נוסף חבר חדש',
  'vehicle.mileage_update':     'עודכן קילומטראז׳',
  'vehicle.maintenance_logged': 'תועד טיפול',
  'vehicle.issue_reported':     'דווחה תקלה ברכב',
};

const ACTION_TONE = {
  'route.complete':             'green',
  'stop.complete':              'green',
  'route.start':                'blue',
  'stop.issue':                 'red',
  'stop.issue_documented':      'red',
  'vehicle.issue_reported':     'red',
  'expense.add':                'purple',
  'expense.delete':             'gray',
  'driver.assign':              'blue',
  'member.add':                 'blue',
  'route.create':               'green',
};

const TONE_DOT = {
  green:  'bg-green-500',
  red:    'bg-red-500',
  blue:   'bg-blue-500',
  purple: 'bg-purple-500',
  gray:   'bg-gray-300',
};

// ---------- main ------------------------------------------------------

export default function BusinessDashboard() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { activeWorkspace } = useWorkspace();
  const { isBusiness, canManageRoutes, isLoading: roleLoading } = useWorkspaceRole();

  const enabled = !!accountId && isBusiness && canManageRoutes;

  const { data: vehicles = [] } = useQuery({
    queryKey: ['biz-dash-vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled, staleTime: 60 * 1000,
  });

  const { data: activeRoutes = [] } = useQuery({
    queryKey: ['biz-dash-active-routes', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routes')
        .select('id, status, title, scheduled_for, vehicle_id')
        .eq('account_id', accountId)
        .in('status', ['pending', 'in_progress']);
      if (error) throw error;
      return data || [];
    },
    enabled, staleTime: 60 * 1000,
  });

  const { data: openIssues = [] } = useQuery({
    queryKey: ['biz-dash-open-issues', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('route_stops')
        .select('id, route_id, title, completion_note, route:routes!inner(status, title)')
        .eq('account_id', accountId)
        .eq('status', 'issue');
      if (error) throw error;
      return (data || []).filter((s) => {
        const routeRow = Array.isArray(s.route) ? s.route[0] : s.route;
        return routeRow?.status !== 'completed';
      });
    },
    enabled, staleTime: 60 * 1000,
  });

  const { data: monthly = [] } = useQuery({
    queryKey: ['biz-dash-monthly', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_monthly_expense_summary')
        .select('month, total')
        .eq('account_id', accountId)
        .order('month', { ascending: false })
        .limit(12);
      if (error) throw error;
      return data || [];
    },
    enabled, staleTime: 60 * 1000,
  });

  const { data: recentLogs = [] } = useQuery({
    queryKey: ['biz-dash-activity', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_activity_log')
        .select('id, action, actor_user_id, actor_label, note, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(6);
      if (error) throw error;
      return data || [];
    },
    enabled, staleTime: 30 * 1000,
  });

  // Workspace member directory: real names for the activity feed.
  const { data: directory = [] } = useQuery({
    queryKey: ['biz-dash-directory', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('workspace_members_directory', {
        p_account_id: accountId,
      });
      if (error) throw error;
      return data || [];
    },
    enabled, staleTime: 5 * 60 * 1000,
  });

  // External-driver licenses about to expire (≤ 30 days) or already
  // expired. Drives the attention list. Only pulls fields we actually
  // surface so the network roundtrip stays small.
  const { data: licenseAlerts = [] } = useQuery({
    queryKey: ['biz-dash-license-alerts', accountId],
    queryFn: async () => {
      const today = new Date();
      const cutoff = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      const { data, error } = await supabase
        .from('external_drivers')
        .select('id, full_name, license_expiry_date')
        .eq('account_id', accountId)
        .eq('status', 'active')
        .not('license_expiry_date', 'is', null)
        .lte('license_expiry_date', cutoff.toISOString().slice(0, 10));
      if (error) throw error;
      return data || [];
    },
    enabled, staleTime: 5 * 60 * 1000,
  });

  // Split licenses into expired vs expiring-soon.
  const licenseExpired = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    return licenseAlerts.filter(d => d.license_expiry_date < todayISO);
  }, [licenseAlerts]);
  const licenseSoon = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    return licenseAlerts.filter(d => d.license_expiry_date >= todayISO);
  }, [licenseAlerts]);

  const nameByUserId = useMemo(() => {
    const m = {};
    for (const row of directory) m[row.user_id] = row.display_name;
    return m;
  }, [directory]);

  const monthStart = monthStartISO();
  const thisMonthTotal = useMemo(() => {
    const r = monthly.find(x => x.month === monthStart);
    return Number(r?.total || 0);
  }, [monthly, monthStart]);

  const prevMonthTotal = useMemo(() => {
    if (monthly.length < 2) return null;
    const idx = monthly.findIndex(x => x.month === monthStart);
    const prev = idx >= 0 ? monthly[idx + 1] : monthly[1];
    return prev ? Number(prev.total || 0) : null;
  }, [monthly, monthStart]);

  const monthDeltaPct = useMemo(() => {
    if (!prevMonthTotal || prevMonthTotal === 0) return null;
    return Math.round(((thisMonthTotal - prevMonthTotal) / prevMonthTotal) * 100);
  }, [thisMonthTotal, prevMonthTotal]);

  // Vehicles needing attention.
  const overdueVehicles = useMemo(() => {
    return vehicles
      .map(v => {
        const vehicle = /** @type {any} */ (v);
        const testD = daysUntil(vehicle.test_due_date);
        const insD  = daysUntil(vehicle.insurance_due_date);
        const worst = Math.min(testD ?? 999, insD ?? 999);
        return { v, worst, testD, insD };
      })
      .filter(x => x.worst <= 30)
      .sort((a, b) => a.worst - b.worst);
  }, [vehicles]);

  const overdueCount = overdueVehicles.filter(x => x.worst < 0).length;
  const soonCount    = overdueVehicles.filter(x => x.worst >= 0 && x.worst <= 30).length;
  const unassigned   = useMemo(() => {
    // Vehicles in the fleet without an active route or assignment proxy.
    // For v1 we only check by 'no active route' as proxy for "idle".
    return null; // placeholder for future use
  }, []);

  // ---------- guards --------------------------------------------------

  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated) {
    return <Empty text="צריך להתחבר כדי לראות את הדשבורד העסקי." />;
  }
  if (!isBusiness) {
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="הדשבורד זמין בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש."
      />
    );
  }
  if (!canManageRoutes) {
    return (
      <Empty
        icon={<TrendingUp className="h-10 w-10 text-gray-300" />}
        title="אין הרשאה לדשבורד"
        text="הדשבורד שמור למנהלי החשבון. נסה את 'המשימות שלי' אם הוקצו לך משימות."
      />
    );
  }

  // ---------- render --------------------------------------------------

  const workspaceName = activeWorkspace?.account_name || 'החשבון העסקי';
  const userFirstName = (nameByUserId[user?.id] || user?.user_metadata?.full_name || '').split(' ')[0];
  const greeting = greetingFor();
  const attentionItems = buildAttentionItems({
    overdueCount,
    soonCount,
    openIssuesCount: openIssues.length,
    monthDeltaPct,
    licenseExpiredCount: licenseExpired.length,
    licenseSoonCount:    licenseSoon.length,
  });
  const fleetHealthy = overdueCount === 0 && openIssues.length === 0;

  return (
    <div dir="rtl" className="max-w-5xl mx-auto pb-8">
      <MobileBackButton />

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <header className="mb-5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-sm text-gray-500">{greeting}{userFirstName ? `, ${userFirstName}` : ''}.</p>
          <p className="text-sm text-gray-400">{hebrewDate()}</p>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-1 truncate">{workspaceName}</h1>
        <p className="text-xs text-gray-500 mt-0.5">תמונת מצב יומית של הצי</p>
      </header>

      {/* ── Quick Actions ────────────────────────────────────────── */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
        <QuickAction icon={<Plus className="h-3.5 w-3.5" />}     label="צור משימה"     to={createPageUrl('CreateRoute')} primary />
        <QuickAction icon={<Truck className="h-3.5 w-3.5" />}    label="הוסף רכב"      to={createPageUrl('AddVehicle')} />
        <QuickAction icon={<Users className="h-3.5 w-3.5" />}    label="נהל נהגים"     to={createPageUrl('Drivers')} />
        <QuickAction icon={<Receipt className="h-3.5 w-3.5" />}  label="הוסף הוצאה"    to={createPageUrl('Expenses')} />
      </div>

      {/* ── KPI Cards ────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
        <Kpi
          icon={<Truck className="h-5 w-5" />}
          label="רכבים בצי"
          value={fmtNumber(vehicles.length)}
          to={createPageUrl('Fleet')}
          tone="primary"
        />
        <Kpi
          icon={<MapPin className="h-5 w-5" />}
          label="משימות פעילות"
          value={fmtNumber(activeRoutes.length)}
          sub={activeRoutes.length === 0 ? 'אין משימה פתוחה' : null}
          to={createPageUrl('Routes')}
          tone="primary"
        />
        <Kpi
          icon={<Receipt className="h-5 w-5" />}
          label="הוצאות החודש"
          value={fmtMoney(thisMonthTotal)}
          delta={monthDeltaPct}
          to={createPageUrl('Reports')}
          tone="primary"
        />
        <Kpi
          icon={<AlertTriangle className="h-5 w-5" />}
          label="תקלות פתוחות"
          value={fmtNumber(openIssues.length)}
          to={createPageUrl('ActivityLog')}
          tone={openIssues.length > 0 ? 'danger' : 'neutral'}
        />
      </section>

      {/* ── Health Spotlight ─────────────────────────────────────── */}
      <section className="mb-5">
        {fleetHealthy ? (
          <HealthCard
            tone="green"
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="הצי במצב תקין"
            sub="אין רכבים שדורשים טיפול דחוף ואין תקלות פתוחות."
          />
        ) : (
          <HealthCard
            tone={overdueCount > 0 ? 'red' : 'yellow'}
            icon={<AlertTriangle className="h-5 w-5" />}
            title={overdueCount > 0
              ? `${overdueCount} רכבים דורשים טיפול דחוף`
              : `${soonCount} רכבים דורשים טיפול בקרוב`}
            sub={openIssues.length > 0
              ? `יש גם ${openIssues.length} תקלות מדווחות שטרם טופלו`
              : 'מומלץ לבדוק את הצי בלשונית "צי הרכבים"'}
            to={createPageUrl('Fleet')}
          />
        )}
      </section>

      {/* ── Two-column area ──────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* Needs attention */}
        <section className="bg-white border border-gray-100 rounded-2xl p-4">
          <SectionHeader
            icon={<AlertTriangle className="h-4 w-4 text-yellow-700" />}
            title="דורש תשומת לב"
          />
          {attentionItems.length === 0 ? (
            <p className="text-xs text-gray-500 py-4 text-center">
              הכל תחת שליטה. שום דבר לא דחוף עכשיו.
            </p>
          ) : (
            <ul className="space-y-3">
              {attentionItems.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className={`shrink-0 w-1 self-stretch rounded-full ${item.barCls}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{item.text}</p>
                    {item.sub && <p className="text-[11px] text-gray-500 leading-relaxed">{item.sub}</p>}
                  </div>
                  {item.to && (
                    <Link to={item.to} className="shrink-0 text-[11px] font-bold text-[#2D5233] flex items-center gap-0.5 mt-0.5">
                      לפרטים
                      <ArrowLeft className="h-3 w-3" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent activity */}
        <section className="bg-white border border-gray-100 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <SectionHeader
              icon={<FileText className="h-4 w-4 text-gray-500" />}
              title="פעילות אחרונה"
              tight
            />
            <Link
              to={createPageUrl('ActivityLog')}
              className="text-[11px] font-bold text-[#2D5233] flex items-center gap-0.5"
            >
              לכל הפעילות
              <ArrowLeft className="h-3 w-3" />
            </Link>
          </div>
          {recentLogs.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">
              עוד לא נרשמה פעילות. כל פעולה בחשבון תופיע כאן אוטומטית.
            </p>
          ) : (
            <ol className="relative space-y-3">
              <span className="absolute right-1 top-2 bottom-2 w-px bg-gray-100" aria-hidden />
              {recentLogs.map(log => {
                const tone = ACTION_TONE[log.action] || 'gray';
                const actorName = nameByUserId[log.actor_user_id] || log.actor_label;
                return (
                  <li key={log.id} className="relative flex items-start gap-3 pr-3">
                    <span className={`absolute right-0 top-1.5 w-2 h-2 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-900">
                        <span className="font-bold">{actorName}</span>
                        <span className="text-gray-400">{` · `}</span>
                        {ACTION_LABEL[log.action] || log.action}
                      </p>
                      {log.note && <p className="text-[11px] text-gray-500 truncate">{log.note}</p>}
                      <p className="text-[10px] text-gray-400 mt-0.5">{fmtTimeShort(log.created_at)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

      </div>
    </div>
  );
}

// ---------- subcomponents --------------------------------------------

function QuickAction({ icon, label, to, primary = false }) {
  return (
    <Link
      to={to}
      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-[0.98] ${
        primary
          ? 'bg-[#2D5233] text-white'
          : 'bg-white border border-gray-200 text-gray-700 hover:border-gray-300'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function Kpi({ icon, label, value, sub = null, delta = null, to, tone = 'primary' }) {
  const iconWrap = {
    primary: 'bg-[#E8F2EA] text-[#2D5233]',
    danger:  'bg-red-50    text-red-600',
    neutral: 'bg-gray-100  text-gray-500',
  }[tone] || 'bg-gray-100 text-gray-500';

  const inner = (
    <div className="bg-white border border-gray-100 rounded-2xl p-3.5 hover:border-gray-200 hover:shadow-sm transition-all h-full">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${iconWrap}`}>
        {icon}
      </div>
      <p className="text-[11px] text-gray-500 font-medium mb-0.5">{label}</p>
      <p className="text-2xl font-bold text-gray-900 leading-tight tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-1.5 truncate">{sub}</p>}
      {delta != null && (
        <div className={`mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold ${
          delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-500'
        }`}>
          {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : null}
          <span>{delta > 0 ? '+' : ''}{delta}% מהחודש שעבר</span>
        </div>
      )}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function HealthCard({ tone, icon, title, sub, to = null }) {
  const wrap = {
    green:  'bg-gradient-to-l from-green-50 to-white border-green-100',
    yellow: 'bg-gradient-to-l from-yellow-50 to-white border-yellow-100',
    red:    'bg-gradient-to-l from-red-50 to-white border-red-100',
  }[tone] || 'bg-white border-gray-100';

  const iconCls = {
    green:  'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-800',
    red:    'bg-red-100 text-red-700',
  }[tone];

  const Wrapper = ({ children }) => to
    ? <Link to={to} className="block">{children}</Link>
    : <div>{children}</div>;

  return (
    <Wrapper>
      <div className={`border rounded-2xl p-4 flex items-center gap-3 transition-shadow ${wrap} ${to ? 'hover:shadow-sm' : ''}`}>
        <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${iconCls}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{title}</p>
          <p className="text-[11px] text-gray-600 mt-0.5">{sub}</p>
        </div>
        {to && <ArrowLeft className="h-4 w-4 text-gray-400 shrink-0" />}
      </div>
    </Wrapper>
  );
}

function SectionHeader({ icon, title, tight = false }) {
  return (
    <div className={`flex items-center gap-2 ${tight ? '' : 'mb-3'}`}>
      {icon}
      <h2 className="text-sm font-bold text-gray-900">{title}</h2>
    </div>
  );
}

function buildAttentionItems({
  overdueCount,
  soonCount,
  openIssuesCount,
  monthDeltaPct,
  licenseExpiredCount = 0,
  licenseSoonCount = 0,
}) {
  const items = [];

  if (overdueCount > 0) {
    items.push({
      barCls: 'bg-red-500',
      text: `${overdueCount} רכבים עם טסט או ביטוח שפג`,
      sub: 'מומלץ לטפל בהקדם כדי להימנע מקנסות',
      to: createPageUrl('Fleet'),
    });
  }
  if (licenseExpiredCount > 0) {
    items.push({
      barCls: 'bg-red-500',
      text: `${licenseExpiredCount} ${licenseExpiredCount === 1 ? 'נהג' : 'נהגים'} עם רישיון נהיגה שפג`,
      sub: 'אסור להעלות לרכב עד חידוש הרישיון',
      to: createPageUrl('Drivers'),
    });
  }
  if (soonCount > 0) {
    items.push({
      barCls: 'bg-yellow-500',
      text: `${soonCount} רכבים שיפוגו בחודש הקרוב`,
      sub: 'מומלץ לתאם טיפול מבעוד מועד',
      to: createPageUrl('Fleet'),
    });
  }
  if (licenseSoonCount > 0) {
    items.push({
      barCls: 'bg-orange-500',
      text: `${licenseSoonCount} ${licenseSoonCount === 1 ? 'רישיון נהיגה' : 'רישיונות נהיגה'} פוגגים בחודש הקרוב`,
      sub: 'תזכר את הנהגים לחדש',
      to: createPageUrl('Drivers'),
    });
  }
  if (openIssuesCount > 0) {
    items.push({
      barCls: 'bg-red-500',
      text: `${openIssuesCount} תקלות מדווחות שטרם טופלו`,
      sub: 'נהגים דיווחו על תקלות במשימות פעילות',
      to: createPageUrl('Routes'),
    });
  }
  if (monthDeltaPct != null && monthDeltaPct > 15) {
    items.push({
      barCls: 'bg-orange-500',
      text: `הוצאות החודש גבוהות ב ${monthDeltaPct}% מהחודש שעבר`,
      sub: 'בדוק לפי קטגוריה: דלק, תיקונים או אחר',
      to: createPageUrl('Reports'),
    });
  }
  return items;
}

function Empty({ icon = null, title = null, text }) {
  return (
    <div dir="rtl" className="max-w-md mx-auto py-16">
      <div className="text-center px-6">
        {icon && <div className="flex justify-center mb-3">{icon}</div>}
        {title && <p className="text-sm font-bold text-gray-700 mb-1">{title}</p>}
        <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

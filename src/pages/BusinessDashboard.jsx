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
  Truck, Briefcase, AlertTriangle, Receipt,
  CheckCircle2, TrendingUp, ArrowLeft, Plus, Users,
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

  // ── Render — "Living Dashboard" ───────────────────────────────────
  // Vibrant, breathing aesthetic. Mint-tinted background, gradient
  // emerald hero number, colored KPI surfaces (not flat hairlines),
  // pulsing live dot, soft colored shadows, smooth hover transitions.
  // Replaces the previous "Boardroom Brief" cream/hairline look that
  // read as too editorial-static for an active fleet management tool.
  return (
    <div
      dir="rtl"
      className="max-w-5xl mx-auto pb-12 px-4 sm:px-6 pt-3"
      style={{
        // Soft mint→white gradient with a subtle radial highlight at top.
        // Gives the page warmth and depth without committing to a heavy
        // theme color.
        background: `
          radial-gradient(ellipse at 70% -10%, rgba(16,185,129,0.08) 0%, transparent 50%),
          linear-gradient(180deg, #F0F7F4 0%, #FFFFFF 60%)
        `,
        minHeight: '100vh',
      }}
    >
      <MobileBackButton />

      {/* ── A. Header ──────────────────────────────────────────── */}
      <header className="mb-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {/* Live indicator chip */}
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide"
            style={{ background: '#10B981', color: '#FFFFFF' }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span
                className="absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: '#FFFFFF', animation: 'cr-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
              />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
            </span>
            LIVE
          </div>
          {/* Date pill */}
          <div
            className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium"
            style={{ background: 'rgba(31,61,36,0.06)', color: '#1F3D24' }}
          >
            {hebrewDate()}
          </div>
        </div>

        <h1
          className="font-black leading-none tracking-tight truncate"
          style={{
            color: '#0B2912',
            fontWeight: 900,
            fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
            letterSpacing: '-0.025em',
          }}
        >
          {workspaceName}
        </h1>

        <p className="text-sm mt-2" style={{ color: '#4B5D52' }}>
          {greeting}{userFirstName ? `, ${userFirstName}` : ''} 👋
        </p>
      </header>

      {/* ── B. Hero Card — gradient emerald ─────────────────────── */}
      <section className="mb-4">
        <Link
          to={fleetHealthy ? createPageUrl('Fleet') : createPageUrl('Fleet')}
          className="block rounded-3xl p-5 sm:p-6 transition-all hover:scale-[1.005] active:scale-[0.998] relative overflow-hidden group"
          style={{
            background: fleetHealthy
              ? 'linear-gradient(135deg, #065F46 0%, #10B981 60%, #34D399 100%)'
              : overdueCount > 0
                ? 'linear-gradient(135deg, #7F1D1D 0%, #DC2626 60%, #F87171 100%)'
                : 'linear-gradient(135deg, #92400E 0%, #F59E0B 60%, #FBBF24 100%)',
            boxShadow: fleetHealthy
              ? '0 20px 50px -12px rgba(16,185,129,0.4), 0 8px 16px -4px rgba(16,185,129,0.2)'
              : overdueCount > 0
                ? '0 20px 50px -12px rgba(220,38,38,0.4), 0 8px 16px -4px rgba(220,38,38,0.2)'
                : '0 20px 50px -12px rgba(245,158,11,0.4), 0 8px 16px -4px rgba(245,158,11,0.2)',
          }}
        >
          {/* Decorative blob */}
          <div
            aria-hidden
            className="absolute pointer-events-none transition-transform group-hover:scale-110"
            style={{
              top: '-30%',
              left: '-10%',
              width: '300px',
              height: '300px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%)',
            }}
          />

          <div className="relative grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 sm:gap-8 items-center">
            {/* Big number */}
            <div className="flex items-end gap-3 leading-none">
              <span
                className="font-black tabular-nums"
                style={{
                  color: '#FFFFFF',
                  fontSize: 'clamp(4rem, 11vw, 6.5rem)',
                  fontWeight: 900,
                  letterSpacing: '-0.05em',
                  lineHeight: 0.85,
                  textShadow: '0 2px 20px rgba(0,0,0,0.15)',
                }}
                dir="ltr"
              >
                {fmtNumber(vehicles.length)}
              </span>
              <div className="pb-2">
                <p className="text-xs uppercase tracking-[0.15em] font-bold opacity-90 text-white">
                  רכבים
                </p>
                <p className="text-sm font-bold mt-0.5 text-white">
                  בצי הפעיל
                </p>
              </div>
            </div>

            {/* Status block */}
            <div className="sm:border-r sm:pr-6 border-white/25">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-full bg-white/25 backdrop-blur-sm flex items-center justify-center shrink-0">
                  {fleetHealthy
                    ? <CheckCircle2 className="w-4 h-4 text-white" />
                    : <AlertTriangle className="w-4 h-4 text-white" />}
                </div>
                <p className="text-base font-black text-white">
                  {fleetHealthy
                    ? 'הצי במצב תקין'
                    : overdueCount > 0
                      ? `${overdueCount} רכבים דחופים`
                      : `${soonCount} רכבים בקרוב`}
                </p>
              </div>
              <p className="text-sm leading-relaxed text-white/85">
                {fleetHealthy
                  ? 'אין רכבים שדורשים טיפול דחוף ואין תקלות פתוחות.'
                  : openIssues.length > 0
                    ? `יש גם ${openIssues.length} תקלות מדווחות שטרם טופלו.`
                    : 'מומלץ לבדוק את צי הרכבים.'}
              </p>
            </div>
          </div>
        </Link>
      </section>

      {/* ── C. KPI Trio — vivid colored surfaces ────────────────── */}
      <section className="grid grid-cols-3 gap-3 mb-5">
        <KpiTile
          label="משימות פעילות"
          value={fmtNumber(activeRoutes.length)}
          sub={activeRoutes.length === 0 ? 'אין פתוחה' : 'בעבודה'}
          tone="emerald"
          to={createPageUrl('Routes')}
        />
        <KpiTile
          label="הוצאות החודש"
          value={fmtMoney(thisMonthTotal)}
          sub={monthDeltaPct != null
            ? `${monthDeltaPct > 0 ? '↑' : '↓'} ${Math.abs(monthDeltaPct)}% מהחודש שעבר`
            : 'אין נתון'}
          subTone={monthDeltaPct > 0 ? 'red' : monthDeltaPct < 0 ? 'green' : 'neutral'}
          tone="amber"
          to={createPageUrl('Reports')}
        />
        <KpiTile
          label="תקלות פתוחות"
          value={fmtNumber(openIssues.length)}
          sub={openIssues.length > 0 ? 'דורשות טיפול' : 'הכל סגור'}
          tone={openIssues.length > 0 ? 'red' : 'blue'}
          to={createPageUrl('ActivityLog')}
        />
      </section>

      {/* ── D. Attention banner — only when needed ──────────────── */}
      {attentionItems.length > 0 && (
        <section
          className="mb-5 rounded-2xl p-4 border"
          style={{
            background: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
            borderColor: '#FCD34D',
            boxShadow: '0 4px 12px rgba(245,158,11,0.12)',
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: '#F59E0B' }}>
              <AlertTriangle className="w-4 h-4 text-white" />
            </div>
            <h2 className="font-bold text-base" style={{ color: '#78350F' }}>
              דורש תשומת לב
            </h2>
            <span
              className="ml-auto inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-black"
              style={{ background: '#F59E0B', color: '#FFFFFF' }}
            >
              {attentionItems.length}
            </span>
          </div>
          <ul className="space-y-2.5">
            {attentionItems.map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-xl bg-white/60 p-2.5 transition-colors hover:bg-white/90"
              >
                <div className={`shrink-0 w-1 self-stretch rounded-full ${item.barCls}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold leading-snug" style={{ color: '#78350F' }}>
                    {item.text}
                  </p>
                  {item.sub && (
                    <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: '#92400E' }}>
                      {item.sub}
                    </p>
                  )}
                </div>
                {item.to && (
                  <Link
                    to={item.to}
                    className="shrink-0 text-[11px] font-bold flex items-center gap-0.5 mt-0.5 px-2 py-1 rounded-full transition-colors hover:bg-amber-200/40"
                    style={{ color: '#92400E' }}
                  >
                    לפרטים
                    <ArrowLeft className="h-3 w-3" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── E. Quick Actions — vibrant grid ─────────────────────── */}
      <section className="mb-6">
        <h2 className="text-sm font-bold mb-2.5" style={{ color: '#0B2912' }}>פעולות מהירות</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <ActionTile to={createPageUrl('CreateRoute')} icon={Plus}    label="צור משימה" primary />
          <ActionTile to={createPageUrl('AddVehicle')}  icon={Truck}   label="הוסף רכב" />
          <ActionTile to={createPageUrl('Drivers')}     icon={Users}   label="נהל נהגים" />
          <ActionTile to={createPageUrl('Expenses')}    icon={Receipt} label="הוסף הוצאה" />
        </div>
      </section>

      {/* ── F. Activity feed ─────────────────────────────────────── */}
      <section
        className="rounded-2xl p-4 sm:p-5 border"
        style={{
          background: '#FFFFFF',
          borderColor: '#E5EDE8',
          boxShadow: '0 4px 16px rgba(15,40,28,0.04)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold" style={{ color: '#0B2912' }}>פעילות אחרונה</h2>
          <Link
            to={createPageUrl('ActivityLog')}
            className="text-[11px] font-bold flex items-center gap-0.5 px-2 py-1 rounded-full transition-colors"
            style={{ color: '#10B981', background: 'rgba(16,185,129,0.08)' }}
          >
            לכל הפעילות
            <ArrowLeft className="h-3 w-3" />
          </Link>
        </div>
        {recentLogs.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: '#6B7C72' }}>
            עוד לא נרשמה פעילות. כל פעולה בחשבון תופיע כאן אוטומטית.
          </p>
        ) : (
          <ol className="relative space-y-3 pr-5">
            <span
              className="absolute right-[7px] top-2 bottom-2 w-px"
              style={{ background: '#E5EDE8' }}
              aria-hidden
            />
            {recentLogs.map(log => {
              const tone = ACTION_TONE[log.action] || 'gray';
              const actorName = nameByUserId[log.actor_user_id] || log.actor_label;
              return (
                <li key={log.id} className="relative flex items-start gap-3">
                  <span
                    className={`absolute right-[2px] top-2 w-2.5 h-2.5 rounded-full ring-2 ring-white ${TONE_DOT[tone]}`}
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0 mr-2">
                    <p className="text-sm" style={{ color: '#0B2912' }}>
                      <span className="font-bold">{actorName}</span>
                      <span style={{ color: '#6B7C72' }}>{` · `}</span>
                      {ACTION_LABEL[log.action] || log.action}
                    </p>
                    {log.note && (
                      <p className="text-[12px] truncate" style={{ color: '#4B5D52' }}>
                        {log.note}
                      </p>
                    )}
                    <p className="text-[11px] mt-0.5" style={{ color: '#6B7C72' }}>
                      {fmtTimeShort(log.created_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Live pulse animation keyframe — scoped global so the live
          indicator chip has a visible breath. CSS variable form keeps
          it overridable from theme later. */}
      <style>{`
        @keyframes cr-pulse {
          0%, 100% { transform: scale(1); opacity: 0.75; }
          50%      { transform: scale(2.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ---------- subcomponents --------------------------------------------
// "Living Dashboard" components: vibrant colored surfaces, soft shadows,
// smooth hover transitions. Each KPI tile carries its own theme color
// (emerald / amber / blue / red) so the page reads as a colored data
// arrangement rather than a monochrome list.

// KpiTile: vivid colored surface for each KPI. The `tone` prop drives
// background gradient, text, and shadow color so the eye instantly
// connects color → meaning (emerald = healthy/active, amber = financial,
// red = problem, blue = info).
function KpiTile({ label, value, sub = null, subTone = 'neutral', tone = 'emerald', to }) {
  // Each tone is a triplet: surface gradient + dark text + shadow.
  // Surfaces are LIGHT-tinted (10-20% saturation) so the page stays
  // bright without screaming neon.
  const TONES = {
    emerald: {
      surface: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
      border:  '#A7F3D0',
      label:   '#047857',
      value:   '#065F46',
      shadow:  '0 4px 12px rgba(16,185,129,0.12)',
      hover:   '0 8px 20px rgba(16,185,129,0.20)',
    },
    amber: {
      surface: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
      border:  '#FCD34D',
      label:   '#B45309',
      value:   '#78350F',
      shadow:  '0 4px 12px rgba(245,158,11,0.12)',
      hover:   '0 8px 20px rgba(245,158,11,0.20)',
    },
    blue: {
      surface: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
      border:  '#93C5FD',
      label:   '#1D4ED8',
      value:   '#1E3A8A',
      shadow:  '0 4px 12px rgba(59,130,246,0.12)',
      hover:   '0 8px 20px rgba(59,130,246,0.20)',
    },
    red: {
      surface: 'linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)',
      border:  '#FCA5A5',
      label:   '#B91C1C',
      value:   '#7F1D1D',
      shadow:  '0 4px 12px rgba(239,68,68,0.12)',
      hover:   '0 8px 20px rgba(239,68,68,0.20)',
    },
  };
  const t = TONES[tone] || TONES.emerald;

  // sub-line color — independent of tile tone so a green tile can
  // still flag a red sub-stat (e.g. "expenses up 15%" with amber tile
  // body but red trend).
  const subColor = {
    neutral: t.label,
    red:     '#B91C1C',
    green:   '#047857',
  }[subTone] || t.label;

  const inner = (
    <div
      className="rounded-2xl p-3.5 transition-all hover:scale-[1.02] active:scale-[0.99] border h-full"
      style={{
        background: t.surface,
        borderColor: t.border,
        boxShadow: t.shadow,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = t.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = t.shadow; }}
    >
      <p
        className="text-[10px] uppercase tracking-[0.12em] font-bold mb-1.5"
        style={{ color: t.label }}
      >
        {label}
      </p>
      <p
        className="font-black tabular-nums leading-none"
        style={{
          color: t.value,
          fontSize: 'clamp(1.5rem, 3.5vw, 2rem)',
          fontWeight: 900,
          letterSpacing: '-0.02em',
        }}
        dir={typeof value === 'string' && /[֐-׿]/.test(value) ? 'rtl' : 'ltr'}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[10px] mt-1.5 font-bold" style={{ color: subColor }}>
          {sub}
        </p>
      )}
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

// ActionTile: vibrant action button. Primary = gradient emerald with
// glow shadow. Secondary = mint-tinted surface with emerald icon.
// Bigger touch target than the old pill, designed for quick recognition
// from the hero's gravitational pull.
function ActionTile({ to, icon: Icon, label, primary = false }) {
  if (primary) {
    return (
      <Link
        to={to}
        className="rounded-2xl p-3 flex flex-col items-start gap-2 transition-all hover:scale-[1.03] active:scale-[0.98] group"
        style={{
          background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
          boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
        }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform group-hover:rotate-3"
          style={{ background: 'rgba(255,255,255,0.25)', backdropFilter: 'blur(4px)' }}
        >
          <Icon className="w-4.5 h-4.5 text-white" />
        </div>
        <span className="text-sm font-bold text-white">{label}</span>
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className="rounded-2xl p-3 flex flex-col items-start gap-2 border transition-all hover:scale-[1.03] active:scale-[0.98] group"
      style={{
        background: '#FFFFFF',
        borderColor: '#D1FAE5',
        boxShadow: '0 2px 8px rgba(15,40,28,0.04)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#10B981';
        e.currentTarget.style.boxShadow = '0 6px 16px rgba(16,185,129,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#D1FAE5';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(15,40,28,0.04)';
      }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
        style={{ background: '#ECFDF5', color: '#10B981' }}
      >
        <Icon className="w-4.5 h-4.5" />
      </div>
      <span className="text-sm font-bold" style={{ color: '#0B2912' }}>{label}</span>
    </Link>
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

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

  // ── Render — "Boardroom Brief" ────────────────────────────────────
  // Editorial-newspaper aesthetic: cream paper background, masthead with
  // dotted leader date line, large tabular hero numeral, hairline rules
  // between sections, and lettered section markers (A / B / C / D).
  // Avoids the generic AI dashboard pattern of "icon-card × N in grid".
  return (
    <div
      dir="rtl"
      className="max-w-5xl mx-auto pb-12"
      style={{
        // Subtle warm cream — feels like a printed brief vs. pure white.
        background: 'linear-gradient(180deg, #FAF7F0 0%, #FAF7F0 60%, #FFFFFF 100%)',
        minHeight: '100vh',
      }}
    >
      <MobileBackButton />

      {/* ── A. Masthead ──────────────────────────────────────────── */}
      <header className="px-4 sm:px-6 pt-4">
        {/* Date strip with dotted leader */}
        <div className="flex items-baseline gap-3 text-[11px] uppercase tracking-[0.18em] mb-3" style={{ color: '#7A6E58' }}>
          <span className="font-bold">סקירה יומית</span>
          <span className="flex-1 border-b border-dotted" style={{ borderColor: '#C9BBA0' }} />
          <span className="tabular-nums" dir="rtl">{hebrewDate()}</span>
        </div>

        {/* Workspace name as masthead — heavy display weight */}
        <h1
          className="font-black leading-none tracking-tight truncate"
          style={{
            color: '#1F3D24',
            fontWeight: 900,
            fontSize: 'clamp(2rem, 4.5vw, 3rem)',
            letterSpacing: '-0.02em',
          }}
        >
          {workspaceName}
        </h1>

        <p className="text-sm mt-2" style={{ color: '#5C5240' }}>
          {greeting}{userFirstName ? `, ${userFirstName}` : ''}. תמונת מצב יומית של הצי.
        </p>

        {/* Hairline rule */}
        <hr className="border-0 border-t mt-5" style={{ borderColor: '#C9BBA0', opacity: 0.5 }} />
      </header>

      {/* ── B. Hero KPI: the headline number ─────────────────────── */}
      <section className="px-4 sm:px-6 pt-7 pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 lg:gap-10 items-start">
          {/* The big number — fleet count */}
          <Link
            to={createPageUrl('Fleet')}
            className="block group"
            aria-label="צי הרכבים"
          >
            <div className="flex items-end gap-4 leading-none">
              <span
                className="font-black tabular-nums tracking-tight transition-colors group-hover:opacity-80"
                style={{
                  color: '#1F3D24',
                  fontSize: 'clamp(4.5rem, 12vw, 7.5rem)',
                  fontWeight: 900,
                  letterSpacing: '-0.04em',
                  lineHeight: 0.85,
                }}
                dir="ltr"
              >
                {fmtNumber(vehicles.length)}
              </span>
              <div className="pb-2">
                <p className="text-xs uppercase tracking-[0.15em] font-bold" style={{ color: '#7A6E58' }}>רכבים</p>
                <p className="text-xs mt-0.5" style={{ color: '#1F3D24' }}>
                  בצי הפעיל
                </p>
              </div>
            </div>
          </Link>

          {/* Status panel — narrative summary */}
          <div className="lg:border-r lg:pr-8" style={{ borderColor: '#C9BBA0' }}>
            <p className="text-[11px] uppercase tracking-[0.18em] font-bold mb-3" style={{ color: '#7A6E58' }}>
              מצב נוכחי
            </p>
            {fleetHealthy ? (
              <div className="flex items-start gap-3">
                <div
                  className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5"
                  style={{ background: '#1F3D24', color: '#FAF7F0' }}
                >
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-base font-bold" style={{ color: '#1F3D24' }}>הצי במצב תקין</p>
                  <p className="text-sm mt-0.5 leading-relaxed" style={{ color: '#5C5240' }}>
                    אין רכבים שדורשים טיפול דחוף ואין תקלות פתוחות.
                  </p>
                </div>
              </div>
            ) : (
              <Link to={createPageUrl('Fleet')} className="flex items-start gap-3 group">
                <div
                  className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5"
                  style={{
                    background: overdueCount > 0 ? '#8B1A1A' : '#B8860B',
                    color: '#FAF7F0',
                  }}
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-base font-bold group-hover:underline" style={{ color: '#1F3D24' }}>
                    {overdueCount > 0
                      ? `${overdueCount} רכבים דורשים טיפול דחוף`
                      : `${soonCount} רכבים דורשים טיפול בקרוב`}
                  </p>
                  <p className="text-sm mt-0.5 leading-relaxed" style={{ color: '#5C5240' }}>
                    {openIssues.length > 0
                      ? `יש גם ${openIssues.length} תקלות מדווחות שטרם טופלו.`
                      : 'מומלץ לבדוק את צי הרכבים.'}
                  </p>
                </div>
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Hairline rule */}
      <hr className="border-0 border-t mx-4 sm:mx-6" style={{ borderColor: '#C9BBA0', opacity: 0.5 }} />

      {/* ── C. KPI Strip — supporting cast ───────────────────────── */}
      <section className="px-4 sm:px-6 py-6">
        <div className="grid grid-cols-3 gap-0">
          <KpiCell
            label="משימות פעילות"
            value={fmtNumber(activeRoutes.length)}
            sub={activeRoutes.length === 0 ? 'אין משימה פתוחה' : null}
            to={createPageUrl('Routes')}
          />
          <KpiCell
            label="הוצאות החודש"
            value={fmtMoney(thisMonthTotal)}
            sub={monthDeltaPct != null
              ? `${monthDeltaPct > 0 ? '+' : ''}${monthDeltaPct}% מהחודש שעבר`
              : null}
            subTone={monthDeltaPct > 0 ? 'red' : monthDeltaPct < 0 ? 'green' : 'neutral'}
            to={createPageUrl('Reports')}
            withBorder
          />
          <KpiCell
            label="תקלות פתוחות"
            value={fmtNumber(openIssues.length)}
            sub={openIssues.length > 0 ? 'דורשות טיפול' : 'הכל סגור'}
            subTone={openIssues.length > 0 ? 'red' : 'neutral'}
            to={createPageUrl('ActivityLog')}
            withBorder
          />
        </div>
      </section>

      {/* Hairline rule */}
      <hr className="border-0 border-t mx-4 sm:mx-6" style={{ borderColor: '#C9BBA0', opacity: 0.5 }} />

      {/* ── D. Attention + Activity ─────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-6 lg:gap-10 px-4 sm:px-6 pt-6">

        {/* Quick Actions + Attention list */}
        <section>
          <SectionMarker letter="ד" title="פעולות מהירות" />
          <div className="grid grid-cols-2 gap-2 mb-6">
            <ActionLink to={createPageUrl('CreateRoute')} icon={Plus}    label="צור משימה" primary />
            <ActionLink to={createPageUrl('AddVehicle')}  icon={Truck}   label="הוסף רכב" />
            <ActionLink to={createPageUrl('Drivers')}     icon={Users}   label="נהל נהגים" />
            <ActionLink to={createPageUrl('Expenses')}    icon={Receipt} label="הוסף הוצאה" />
          </div>

          <SectionMarker letter="ה" title="דורש תשומת לב" />
          {attentionItems.length === 0 ? (
            <p
              className="text-sm py-3 leading-relaxed border-r-2 pr-3"
              style={{ color: '#5C5240', borderColor: '#1F3D24' }}
            >
              הכל תחת שליטה. שום דבר לא דחוף עכשיו.
            </p>
          ) : (
            <ul className="space-y-3">
              {attentionItems.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className={`shrink-0 w-1 self-stretch ${item.barCls}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold leading-snug" style={{ color: '#1F3D24' }}>
                      {item.text}
                    </p>
                    {item.sub && (
                      <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: '#5C5240' }}>
                        {item.sub}
                      </p>
                    )}
                  </div>
                  {item.to && (
                    <Link
                      to={item.to}
                      className="shrink-0 text-[11px] font-bold flex items-center gap-0.5 mt-0.5 hover:underline"
                      style={{ color: '#1F3D24' }}
                    >
                      לפרטים
                      <ArrowLeft className="h-3 w-3" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Activity feed */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <SectionMarker letter="ו" title="פעילות אחרונה" tight />
            <Link
              to={createPageUrl('ActivityLog')}
              className="text-[11px] font-bold flex items-center gap-0.5 hover:underline"
              style={{ color: '#1F3D24' }}
            >
              לכל הפעילות
              <ArrowLeft className="h-3 w-3" />
            </Link>
          </div>
          {recentLogs.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: '#7A6E58' }}>
              עוד לא נרשמה פעילות. כל פעולה בחשבון תופיע כאן אוטומטית.
            </p>
          ) : (
            <ol className="relative space-y-4 pr-4">
              <span
                className="absolute right-[3px] top-2 bottom-2 w-px"
                style={{ background: '#C9BBA0' }}
                aria-hidden
              />
              {recentLogs.map(log => {
                const tone = ACTION_TONE[log.action] || 'gray';
                const actorName = nameByUserId[log.actor_user_id] || log.actor_label;
                return (
                  <li key={log.id} className="relative flex items-start gap-3">
                    <span
                      className={`absolute right-[-1.5px] top-2 w-2 h-2 rounded-full ${TONE_DOT[tone]}`}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0 mr-2">
                      <p className="text-sm" style={{ color: '#1F3D24' }}>
                        <span className="font-bold">{actorName}</span>
                        <span style={{ color: '#7A6E58' }}>{` · `}</span>
                        {ACTION_LABEL[log.action] || log.action}
                      </p>
                      {log.note && (
                        <p className="text-[12px] truncate" style={{ color: '#5C5240' }}>
                          {log.note}
                        </p>
                      )}
                      <p className="text-[11px] mt-0.5" style={{ color: '#7A6E58' }}>
                        {fmtTimeShort(log.created_at)}
                      </p>
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
// "Boardroom Brief" components — restraint over decoration. Hairlines
// instead of shadows. Tabular figures everywhere. Border-right column
// dividers between KPI cells (replacing the four-card grid). All built
// against the cream/forest/charcoal palette set on the page wrapper.

// KpiCell: column in the 3-up KPI strip beneath the hero.
// `withBorder` adds a hairline divider on the right (the SECOND and
// THIRD cells). The first cell has none — it's flush with the hero.
function KpiCell({ label, value, sub = null, subTone = 'neutral', to, withBorder = false }) {
  const subColor = {
    neutral: '#7A6E58',
    red:     '#8B1A1A',
    green:   '#2D5233',
  }[subTone] || '#7A6E58';

  const inner = (
    <div
      className={`px-4 py-2 transition-opacity hover:opacity-80 ${withBorder ? 'border-r' : ''}`}
      style={withBorder ? { borderColor: '#C9BBA0', borderRightWidth: '1px' } : {}}
    >
      <p
        className="text-[10px] uppercase tracking-[0.15em] font-bold mb-2"
        style={{ color: '#7A6E58' }}
      >
        {label}
      </p>
      <p
        className="font-black tabular-nums leading-none"
        style={{
          color: '#1F3D24',
          fontSize: 'clamp(1.6rem, 3.5vw, 2.25rem)',
          fontWeight: 900,
          letterSpacing: '-0.02em',
        }}
        dir={typeof value === 'string' && /[֐-׿]/.test(value) ? 'rtl' : 'ltr'}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[11px] mt-1.5 font-medium" style={{ color: subColor }}>
          {sub}
        </p>
      )}
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

// ActionLink: replaces the old pill-style QuickAction. Bigger, more
// confident card with text-only hierarchy + icon as accent.
// `primary` = filled forest, `secondary` = outlined cream.
function ActionLink({ to, icon: Icon, label, primary = false }) {
  const baseStyle = primary
    ? { background: '#1F3D24', color: '#FAF7F0', border: '1.5px solid #1F3D24' }
    : { background: '#FFFFFF', color: '#1F3D24', border: '1.5px solid #1F3D24' };
  return (
    <Link
      to={to}
      className="rounded-md py-3 px-3 flex items-center gap-2 text-sm font-bold transition-all active:scale-[0.98] hover:opacity-90"
      style={baseStyle}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}

// SectionMarker: lettered prefix (א, ב, ג, ד, ה, ו) + section title.
// Adds the editorial-newspaper feel — every section is a numbered
// chapter rather than an arbitrary card.
function SectionMarker({ letter, title, tight = false }) {
  return (
    <div className={`flex items-baseline gap-2 ${tight ? 'mb-0' : 'mb-3'}`}>
      <span
        className="font-black text-xs"
        style={{
          color: '#B8860B',
          letterSpacing: '0.05em',
        }}
      >
        {letter}.
      </span>
      <h2
        className="font-bold text-base"
        style={{ color: '#1F3D24' }}
      >
        {title}
      </h2>
    </div>
  );
}

// Legacy components removed — replaced by the inline status panel in
// the hero (HealthCard), the lettered SectionMarker (SectionHeader),
// and pill-based QuickAction → ActionLink. The redesign uses hairlines
// and typography for hierarchy instead of card-based grouping.

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

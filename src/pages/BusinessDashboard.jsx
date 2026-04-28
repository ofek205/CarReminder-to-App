/**
 * Phase 9, Step 5 — Business workspace dashboard.
 *
 * Manager's at-a-glance view: 4 KPI cards, "needs attention" alerts,
 * recent activity feed. Designed to surface what's wrong (or worth
 * acting on) without scrolling.
 *
 * Routing: when the active workspace is business, /Dashboard
 * auto-redirects here. The manual /BusinessDashboard route also works.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Truck, Briefcase, MapPin, AlertTriangle, Receipt,
  CheckCircle2, ChevronLeft, FileText, TrendingUp, ArrowLeft,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createPageUrl } from '@/utils';

// ---------- helpers ----------------------------------------------------

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

const fmtMoney = (n, c = 'ILS') =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n || 0);

const fmtTimeShort = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr  = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1)   return 'הרגע';
  if (diffMin < 60)  return `לפני ${diffMin} דקות`;
  if (diffHr  < 24)  return `לפני ${diffHr} שעות`;
  if (diffDay < 7)   return `לפני ${diffDay} ימים`;
  return d.toLocaleDateString('he-IL');
};

const monthStartISO = () => {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
};

// Mirror the labels from /ActivityLog so the timeline reads consistently.
const ACTION_LABEL = {
  'workspace.create':       'נוצרה סביבת עבודה עסקית',
  'workspace.create_approved': 'אושרה בקשה לחשבון עסקי',
  'driver.assign':          'נהג שויך לרכב',
  'route.create':           'נוצר מסלול',
  'route.start':            'מסלול יצא לדרך',
  'route.complete':         'מסלול הושלם',
  'route.reopen':           'מסלול נפתח מחדש',
  'stop.complete':          'תחנה הושלמה',
  'stop.skip':              'תחנה דולגה',
  'stop.issue':             'תקלה דווחה בתחנה',
  'stop.reopen':            'תחנה נפתחה מחדש',
  'stop.note_added':        'נוספה הערה לתחנה',
  'stop.photo_added':       'נוספה תמונה לתחנה',
  'stop.issue_documented':  'תיעוד תקלה',
  'expense.add':            'נרשמה הוצאה',
  'expense.update':         'הוצאה עודכנה',
  'expense.delete':         'הוצאה נמחקה',
};

// ---------- main ------------------------------------------------------

export default function BusinessDashboard() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { activeWorkspace } = useWorkspace();
  const { isBusiness, canManageRoutes, isLoading: roleLoading } = useWorkspaceRole();

  const enabled = !!accountId && isBusiness && canManageRoutes;

  // Vehicles — for total count + urgent-status detection.
  const { data: vehicles = [] } = useQuery({
    queryKey: ['biz-dash-vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled,
    staleTime: 60 * 1000,
  });

  // Active routes — pending or in_progress.
  const { data: activeRoutes = [] } = useQuery({
    queryKey: ['biz-dash-active-routes', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routes')
        .select('id, status, title, scheduled_for')
        .eq('account_id', accountId)
        .in('status', ['pending', 'in_progress']);
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 60 * 1000,
  });

  // Open stop issues — stops with status='issue' on routes that aren't completed.
  const { data: openIssues = [] } = useQuery({
    queryKey: ['biz-dash-open-issues', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('route_stops')
        .select('id, route_id, title, completion_note, completed_at, route:routes!inner(status, title)')
        .eq('account_id', accountId)
        .eq('status', 'issue');
      if (error) throw error;
      return (data || []).filter(s => s.route?.status !== 'completed');
    },
    enabled,
    staleTime: 60 * 1000,
  });

  // Monthly expense summary — current and previous month for trend.
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
    enabled,
    staleTime: 60 * 1000,
  });

  // Latest 5 activity log entries.
  const { data: recentLogs = [] } = useQuery({
    queryKey: ['biz-dash-activity', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_activity_log')
        .select('id, action, actor_label, note, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 30 * 1000,
  });

  // Derived metrics.
  const monthStart = monthStartISO();
  const thisMonthTotal = useMemo(() => {
    const row = monthly.find(r => r.month === monthStart);
    return Number(row?.total || 0);
  }, [monthly, monthStart]);

  const prevMonthTotal = useMemo(() => {
    if (monthly.length < 2) return null;
    const idx = monthly.findIndex(r => r.month === monthStart);
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
        const testD = daysUntil(v.test_due_date);
        const insD  = daysUntil(v.insurance_due_date);
        const worst = Math.min(testD ?? 999, insD ?? 999);
        return { v, worst, testD, insD };
      })
      .filter(x => x.worst < 0 || x.worst <= 30)
      .sort((a, b) => a.worst - b.worst)
      .slice(0, 5);
  }, [vehicles]);

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
        text="הדשבורד שמור למנהלי החשבון. נסה את דף 'המשימות שלי' אם הוקצו לך מסלולים."
      />
    );
  }

  // ---------- render --------------------------------------------------

  const workspaceName = activeWorkspace?.account_name || 'החשבון העסקי';
  const attentionItems = buildAttentionItems({ overdueVehicles, openIssues, monthDeltaPct });

  return (
    <div dir="rtl" className="max-w-4xl mx-auto py-2">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">{workspaceName}</h1>
        <p className="text-xs text-gray-500">תמונת מצב יומית של הצי</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <KpiCard
          icon={<Truck className="h-4 w-4" />}
          label="רכבים בצי"
          value={vehicles.length}
          to={createPageUrl('Fleet')}
          tone="green"
        />
        <KpiCard
          icon={<MapPin className="h-4 w-4" />}
          label="במסלול פעיל"
          value={activeRoutes.length}
          to={createPageUrl('Routes')}
          tone="blue"
        />
        <KpiCard
          icon={<Receipt className="h-4 w-4" />}
          label="הוצאות החודש"
          value={fmtMoney(thisMonthTotal)}
          sub={monthDeltaPct != null
            ? (monthDeltaPct > 0
                ? `+${monthDeltaPct}% מהחודש שעבר`
                : `${monthDeltaPct}% מהחודש שעבר`)
            : null}
          to={createPageUrl('Reports')}
          tone="purple"
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="תקלות פתוחות"
          value={openIssues.length}
          to={createPageUrl('ActivityLog')}
          tone={openIssues.length > 0 ? 'red' : 'gray'}
        />
      </div>

      {/* Needs attention */}
      {attentionItems.length > 0 && (
        <section className="bg-white border border-gray-100 rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-yellow-700" />
            <h2 className="text-sm font-bold text-gray-900">דורש תשומת לב</h2>
          </div>
          <ul className="space-y-2">
            {attentionItems.map((item, i) => (
              <AttentionRow key={i} item={item} />
            ))}
          </ul>
        </section>
      )}

      {/* Recent activity */}
      <section className="bg-white border border-gray-100 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-gray-500" />
            <h2 className="text-sm font-bold text-gray-900">פעילות אחרונה</h2>
          </div>
          <Link
            to={createPageUrl('ActivityLog')}
            className="text-[11px] font-bold text-[#2D5233] flex items-center gap-0.5"
          >
            ראה הכל
            <ArrowLeft className="h-3 w-3" />
          </Link>
        </div>
        {recentLogs.length === 0 ? (
          <p className="text-center text-xs text-gray-400 py-4">
            עוד לא נרשמה פעילות. כל פעולה בחשבון תופיע כאן אוטומטית.
          </p>
        ) : (
          <ul className="space-y-2">
            {recentLogs.map(log => (
              <li key={log.id} className="flex items-start gap-3 py-1.5 border-b border-gray-50 last:border-0">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-900">
                    <span className="font-bold">{log.actor_label}</span>
                    {' · '}
                    {ACTION_LABEL[log.action] || log.action}
                  </p>
                  {log.note && (
                    <p className="text-[11px] text-gray-500 truncate">{log.note}</p>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 shrink-0 whitespace-nowrap">
                  {fmtTimeShort(log.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- subcomponents --------------------------------------------

function KpiCard({ icon, label, value, sub, to, tone }) {
  const toneCls = {
    green:  'text-[#2D5233] bg-[#E8F2EA]',
    blue:   'text-blue-700 bg-blue-50',
    purple: 'text-purple-700 bg-purple-50',
    red:    'text-red-700 bg-red-50',
    gray:   'text-gray-700 bg-gray-100',
  }[tone] || 'text-gray-700 bg-gray-100';

  const inner = (
    <div className="bg-white border border-gray-100 rounded-xl p-3 hover:shadow-sm transition-shadow h-full">
      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold mb-2 ${toneCls}`}>
        {icon}{label}
      </div>
      <p className="text-base font-bold text-gray-900 leading-tight">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-1 truncate">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function AttentionRow({ item }) {
  const Icon = item.icon || AlertTriangle;
  return (
    <li className="flex items-start gap-3">
      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${item.iconCls || 'text-yellow-700'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-900">{item.text}</p>
        {item.sub && <p className="text-[11px] text-gray-500 truncate">{item.sub}</p>}
      </div>
      {item.to && (
        <Link to={item.to} className="text-[11px] font-bold text-[#2D5233] flex items-center gap-0.5 shrink-0">
          לפרטים
          <ChevronLeft className="h-3 w-3" />
        </Link>
      )}
    </li>
  );
}

function buildAttentionItems({ overdueVehicles, openIssues, monthDeltaPct }) {
  const items = [];

  // Vehicles with imminent or overdue test/insurance.
  if (overdueVehicles.length > 0) {
    const overdueOnly = overdueVehicles.filter(x => x.worst < 0).length;
    const soonOnly    = overdueVehicles.filter(x => x.worst >= 0 && x.worst <= 30).length;
    const summary = [
      overdueOnly > 0 ? `${overdueOnly} עם טסט או ביטוח שפג` : null,
      soonOnly    > 0 ? `${soonOnly} שיפוגו בחודש הקרוב`     : null,
    ].filter(Boolean).join(' · ');
    items.push({
      icon: AlertTriangle,
      iconCls: overdueOnly > 0 ? 'text-red-700' : 'text-yellow-700',
      text: 'רכבים דורשים טיפול',
      sub: summary,
      to: createPageUrl('Fleet'),
    });
  }

  if (openIssues.length > 0) {
    items.push({
      icon: AlertTriangle,
      iconCls: 'text-red-700',
      text: `${openIssues.length} תקלות מדווחות שטרם טופלו`,
      sub: 'נהגים דיווחו על תקלות במסלולים פעילים',
      to: createPageUrl('Routes'),
    });
  }

  if (monthDeltaPct != null && monthDeltaPct > 15) {
    items.push({
      icon: TrendingUp,
      iconCls: 'text-orange-700',
      text: `הוצאות החודש גבוהות ב־ ${monthDeltaPct}% מהחודש שעבר`,
      sub: 'בדוק לפי קטגוריה — דלק, תיקונים או אחר',
      to: createPageUrl('Reports'),
    });
  }

  if (items.length === 0) {
    items.push({
      icon: CheckCircle2,
      iconCls: 'text-green-700',
      text: 'הכל תקין. אין פריטים שדורשים טיפול עכשיו.',
    });
  }

  return items;
}

function Empty({ icon, title, text }) {
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

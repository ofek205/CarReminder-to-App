import React, { useState, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/supabaseQuery";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import useIsAdmin from "@/hooks/useIsAdmin";
import {
  Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Line, ComposedChart, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import {
  AlertCircle, RefreshCw, Users, Car, FileText,
  Mail, Bug, TrendingUp, Cake, Download, Loader2,
  Target, Zap, Star, Flame, Phone,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { C } from '@/lib/designTokens';

const BI = {
  blue: C.info, green: C.successBright, amber: C.warnIcon,
  red: "#EF4444", purple: "#8B5CF6", teal: "#0891B2", slate: "#64748B",
};
const PALETTE = [BI.purple, BI.blue, BI.teal, BI.green, BI.amber, BI.red, BI.slate];

function fmtDate(d) {
  try { return format(parseISO(d), "dd/MM"); } catch { return d; }
}

// Vehicle family taxonomy — groups the flat DB vehicle_type values into
// Tier-1 marketing segments (private cars / two-wheelers / commercial /
// boats / aviation / heavy machinery / other). The SAME map is duplicated
// in supabase-admin-analytics-drilldown.sql for the vehicle_family
// drill-down branch — keep both in sync if you add a new subtype.
const VEHICLE_FAMILY_MAP = {
  'רכבים פרטיים':   ['רכב','רכב פרטי','רכב אספנות'],
  'דו-גלגלי':        ['אופנוע','אופנוע כביש','קטנוע','אנדורו','מוטוקרוס'],
  'מסחרי / מקצועי': ['משאית','אוטובוס','רכב תפעולי','נגרר','קרוואן','מחרשה','טרקטור','רכב מסחרי','גרור','נתמך'],
  'כלי שייט':        ['מפרשית','סירה מנועית','אופנוע ים','סירת גומי'],
  'כלי טיס':         ['מטוס פרטי','רחפן'],
  'כלי צמ"ה':        ['מחפר','מחפר זחלי','מחפר אופני','מיני מחפר','מחפרון','דחפור','דחפור זחלי','שופל','מעמיס אופני','מעמיס זחלי','מלגזה','מלגזת שטח','טלהנדלר','גלגלת','גלגלת אספלט','גלגלת רטט','משאבת בטון','מערבל בטון','עגלת מערבל','עגורן','עגורן צריח','מנוף','מנוף שטח','מקדח','מקדח שטח','רכב צמ"ה'],
};

// Reverse lookup: subtype → family. Used to aggregate the raw
// vehicle_types data (subtype-keyed) into family buckets on the client
// when the chart toggle is set to "משפחה".
const VEHICLE_SUBTYPE_TO_FAMILY = Object.entries(VEHICLE_FAMILY_MAP).reduce(
  (acc, [family, subtypes]) => {
    for (const st of subtypes) acc[st] = family;
    return acc;
  },
  {},
);

function aggregateByFamily(rawData) {
  const buckets = new Map();
  for (const row of rawData) {
    const family = VEHICLE_SUBTYPE_TO_FAMILY[row.vehicle_type] || 'אחר';
    buckets.set(family, (buckets.get(family) || 0) + (row.count || 0));
  }
  return [...buckets.entries()]
    .map(([family, count]) => ({ vehicle_type: family, count, _isFamily: true }))
    .sort((a, b) => b.count - a.count);
}

export default function AdminAnalytics() {
  const isAdmin = useIsAdmin();
  // The current drill-down segment (null when sheet is closed). The
  // shape mirrors what admin_analytics_drilldown expects: {type, ...extra}.
  // Each chart's onClick handler sets this; the DrillSheet at the bottom
  // queries and renders when it's non-null.
  const [drillSegment, setDrillSegment] = useState(null);

  // ─── Filter Bar state (URL-persisted) ──────────────────────────────
  // All filters live in the URL so the page is shareable and the back
  // button works. Defaults mirror the SQL defaults (30d, all, all).
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => ({
    date_range:    searchParams.get('range')    || '30d',
    account_type:  searchParams.get('account')  || 'all',
    vehicle_types: searchParams.get('vtypes')
      ? searchParams.get('vtypes').split(',').filter(Boolean)
      : [],
  }), [searchParams]);

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    const paramKey = key === 'date_range' ? 'range'
                   : key === 'account_type' ? 'account'
                   : key === 'vehicle_types' ? 'vtypes'
                   : key;
    const isDefault = (key === 'date_range' && value === '30d')
                   || (key === 'account_type' && value === 'all')
                   || (key === 'vehicle_types' && Array.isArray(value) && value.length === 0);
    if (isDefault) {
      next.delete(paramKey);
    } else {
      next.set(paramKey, Array.isArray(value) ? value.join(',') : value);
    }
    setSearchParams(next, { replace: false });
  };

  const resetFilters = () => setSearchParams(new URLSearchParams(), { replace: false });

  const filtersForRpc = useMemo(() => ({
    date_range: filters.date_range,
    account_type: filters.account_type,
    vehicle_types: filters.vehicle_types,
  }), [filters]);

  const { data, isLoading, isError, error: queryError, refetch, isFetching } = useQuery({
    queryKey: ["admin-analytics", filtersForRpc],
    queryFn: async () => {
      const { data: result, error } = await withTimeout(
        supabase.rpc("admin_analytics_summary", { p_filters: filtersForRpc }),
        "admin_analytics_summary"
      );
      if (error) throw error;
      return result;
    },
    enabled: isAdmin === true,
    retry: 1,
    retryDelay: 500,
    staleTime: 60_000,
  });

  if (isAdmin === false) {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-gray-600">אזור זה זמין למנהלי מערכת בלבד.</p>
      </div>
    );
  }
  if (isAdmin === null || isLoading) {
    return <div className="flex justify-center py-16"><LoadingSpinner /></div>;
  }
  if (isError) {
    const errMsg = queryError?.message || queryError?.code || JSON.stringify(queryError);
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto" dir="rtl">
        <PageHeader title="אנליטיקה" />
        <Card className="p-6 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500" />
          <p className="font-bold mb-2">לא הצלחנו לטעון את הנתונים</p>
          <p className="text-xs text-gray-400 mb-3 font-mono" dir="ltr">{errMsg}</p>
          <Button onClick={() => refetch()}>נסה שוב</Button>
        </Card>
      </div>
    );
  }

  const {
    signups_daily = [], wau_weekly = [], vehicles_weekly = [],
    vehicle_types = [], documents_weekly = [], errors_daily = [],
    email_stats = {}, cohorts = [], age_distribution = [],
    activation_funnel = [],
    kpi_north_star_pct = 0,
    kpi_activation_rate_pct = 0,
    kpi_power_users = 0,
    kpi_churn_risk = 0,
    retention_insights = {},
  } = data || {};

  const totalSignups = signups_daily.reduce((s, r) => s + (r.count || 0), 0);
  const latestWau = wau_weekly.length ? wau_weekly[wau_weekly.length - 1]?.active_users || 0 : 0;
  const totalVehicles = vehicle_types.reduce((s, r) => s + (r.count || 0), 0);
  const totalErrors = errors_daily.reduce((s, r) => s + (r.count || 0), 0);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto" dir="rtl" style={{ fontVariantNumeric: "tabular-nums" }}>
      <PageHeader title="אנליטיקה" subtitle="נתוני שימוש, צמיחה ומעורבות." />

      <FilterBar
        filters={filters}
        updateFilter={updateFilter}
        resetFilters={resetFilters}
        availableVehicleTypes={vehicle_types}
        onRefresh={() => refetch()}
        isFetching={isFetching}
      />

      {/* Row 1: CarReminder-specific KPIs (the ones that actually drive product decisions).
          Reminder-to-Return is the North Star — keep it first.
          Activation rate measures onboarding success.
          Power users + Churn risk are the two action lists the admin works from. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <KpiCard label="חזרו אחרי תזכורת (48ש)" value={`${kpi_north_star_pct}%`} icon={Target} color={BI.purple}
          onClick={() => setDrillSegment({ type: 'kpi_north_star' })} />
        <KpiCard label="אקטיבציה מלאה (30י)"    value={`${kpi_activation_rate_pct}%`} icon={Zap}  color={BI.amber}
          onClick={() => setDrillSegment({ type: 'kpi_activation_rate' })} />
        <KpiCard label="Power users"             value={kpi_power_users} icon={Star} color={BI.green}
          onClick={() => setDrillSegment({ type: 'kpi_power_users' })} />
        <KpiCard label="בסכנת נטישה"             value={kpi_churn_risk}  icon={Flame} color={BI.red}
          onClick={() => setDrillSegment({ type: 'kpi_churn_risk' })} />
      </div>

      {/* Row 2: Standard KPIs (growth + health) — the existing four. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <KpiCard label="הרשמות (30 ימים)" value={totalSignups} icon={Users}      color={BI.blue}  onClick={() => setDrillSegment({ type: 'kpi_total_users' })} />
        <KpiCard label="פעילים השבוע"     value={latestWau}    icon={TrendingUp} color={BI.green} onClick={() => setDrillSegment({ type: 'kpi_active_week' })} />
        <KpiCard label='סה"כ רכבים'        value={totalVehicles} icon={Car}      color={BI.teal}  onClick={() => setDrillSegment({ type: 'kpi_total_vehicles' })} />
        <KpiCard label="שגיאות (14 ימים)"  value={totalErrors}  icon={Bug}        color={totalErrors > 50 ? BI.red : BI.slate} onClick={() => setDrillSegment({ type: 'kpi_errors_14d' })} />
      </div>

      {/* Row 3: Retention Insights (Phase 3) — head-to-head comparisons.
          Reuses KpiCard primitive (no new component). The pair-wise
          color: GREEN for the higher of each pair, SLATE for the lower —
          a quick visual cue answering "האם זה עוזר לשימור?".
          Hint prop shows "(returned/total)" so the % is interpretable
          on a 13-user cohort (without context "100% (2/2)" reads very
          differently from "100% (200/200)"). */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 font-medium">תובנות שימור D30</span>
          <span className="text-[10px] text-gray-400">— מתוך {retention_insights?.cohort_size || 0} משתמשים שנרשמו 30-90 ימים אחורה</span>
        </div>
        <div className="text-[10px] text-gray-400 mt-0.5">
          האחוז = כמה מתוך הקטגוריה חזרו לאפליקציה אחרי יום 30 מההרשמה. ירוק = המנצח בכל זוג.
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="חזרו D30 — עם 2+ חברים"
          value={`${retention_insights?.sharing?.multi_pct ?? 0}%`}
          hint={`${retention_insights?.sharing?.multi_returned ?? 0}/${retention_insights?.sharing?.multi_total ?? 0}`}
          icon={Users}
          color={(retention_insights?.sharing?.multi_pct ?? 0) >= (retention_insights?.sharing?.single_pct ?? 0) ? BI.green : BI.slate}
          onClick={() => setDrillSegment({ type: 'retention_segment', bucket: 'multi' })}
        />
        <KpiCard
          label="חזרו D30 — חבר יחיד"
          value={`${retention_insights?.sharing?.single_pct ?? 0}%`}
          hint={`${retention_insights?.sharing?.single_returned ?? 0}/${retention_insights?.sharing?.single_total ?? 0}`}
          icon={Users}
          color={(retention_insights?.sharing?.single_pct ?? 0) > (retention_insights?.sharing?.multi_pct ?? 0) ? BI.green : BI.slate}
          onClick={() => setDrillSegment({ type: 'retention_segment', bucket: 'single' })}
        />
        <KpiCard
          label="חזרו D30 — 3+ מסמכים"
          value={`${retention_insights?.docs?.rich_pct ?? 0}%`}
          hint={`${retention_insights?.docs?.rich_returned ?? 0}/${retention_insights?.docs?.rich_total ?? 0}`}
          icon={FileText}
          color={(retention_insights?.docs?.rich_pct ?? 0) >= (retention_insights?.docs?.poor_pct ?? 0) ? BI.green : BI.slate}
          onClick={() => setDrillSegment({ type: 'retention_segment', bucket: 'docrich' })}
        />
        <KpiCard
          label="חזרו D30 — 0 מסמכים"
          value={`${retention_insights?.docs?.poor_pct ?? 0}%`}
          hint={`${retention_insights?.docs?.poor_returned ?? 0}/${retention_insights?.docs?.poor_total ?? 0}`}
          icon={FileText}
          color={(retention_insights?.docs?.poor_pct ?? 0) > (retention_insights?.docs?.rich_pct ?? 0) ? BI.green : BI.slate}
          onClick={() => setDrillSegment({ type: 'retention_segment', bucket: 'docpoor' })}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <ChartCard title="הרשמות יומיות (30 ימים)" icon={Users} color={BI.blue}>
          <MiniChart data={signups_daily} dataKey="count" xKey="day" color={BI.blue} label="הרשמות"
            onPointClick={(row) => setDrillSegment({ type: 'signup_day', day: row.day })} />
        </ChartCard>

        <ChartCard title="משתמשים פעילים שבועיים" icon={TrendingUp} color={BI.green}>
          <MiniChart data={wau_weekly} dataKey="active_users" xKey="week_start" color={BI.green} type="line" label="פעילים"
            onPointClick={(row) => setDrillSegment({ type: 'wau_week', week_start: row.week_start })} />
        </ChartCard>

        <ChartCard title="רכבים חדשים לשבוע" icon={Car} color={BI.teal}>
          <MiniChart data={vehicles_weekly} dataKey="count" xKey="week_start" color={BI.teal} label="רכבים"
            onPointClick={(row) => setDrillSegment({ type: 'vehicles_week', week_start: row.week_start })} />
        </ChartCard>

        <ChartCard title="התפלגות סוגי רכב" icon={Car} color={BI.purple}>
          <TypesChartWithToggle data={vehicle_types}
            onFamilyClick={(family) => setDrillSegment({ type: 'vehicle_family', family })}
            onSubtypeClick={(row)   => setDrillSegment({ type: 'vehicle_type', vehicle_type: row.vehicle_type })} />
        </ChartCard>

        <VehicleCountChart />

        <ZeroVehicleTrendChart />

        <PhoneCoverageChart />

        <ChartCard title="מסמכים שהועלו לשבוע" icon={FileText} color={BI.amber}>
          <MiniChart data={documents_weekly} dataKey="count" xKey="week_start" color={BI.amber} label="מסמכים"
            onPointClick={(row) => setDrillSegment({ type: 'docs_week', week_start: row.week_start })} />
        </ChartCard>

        <ChartCard title="שגיאות יומיות (14 ימים)" icon={Bug} color={BI.red}>
          <MiniChart data={errors_daily} dataKey="count" xKey="day" color={BI.red} label="שגיאות"
            onPointClick={(row) => setDrillSegment({ type: 'errors_day', day: row.day })} />
        </ChartCard>

        <ChartCard title="התפלגות גילאים" icon={Cake} color={BI.purple}>
          <AgeChart data={age_distribution}
            onPointClick={(row) => setDrillSegment({ type: 'age_bucket', bucket: row.bucket })} />
        </ChartCard>

        <ChartCard title="משפך אקטיבציה (30 ימים)" icon={Target} color={BI.amber}>
          <FunnelChart data={activation_funnel}
            onPointClick={(row) => setDrillSegment({ type: 'funnel_stage', stage: row.stage })} />
        </ChartCard>
      </div>

      <DrillSheet segment={drillSegment} onClose={() => setDrillSegment(null)} />

      <EmailCard stats={email_stats} />
      <CohortCard cohorts={cohorts} />
      <AiUsageCard />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// AiUsageCard — folds AI usage analytics into the analytics hub (Phase 3).
// Own lightweight query on ai_usage_logs (last 30d) so it stays isolated
// from the main admin_analytics_summary fetch. Shows headline usage KPIs +
// a per-feature breakdown, and links to /AdminAiUsage for the full detail
// (heavy-user list, hourly histogram, quota) and the kill-switch flags.
// ──────────────────────────────────────────────────────────────────
const AI_FEATURE_LABEL = {
  yossi_chat:       'מומחה AI',
  community_expert: 'תגובות קהילה',
  scan_extraction:  'סריקת מסמכים',
};

function AiUsageCard() {
  const navigate = useNavigate();
  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-analytics-ai-usage'],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: result, error } = await withTimeout(
        supabase
          .from('ai_usage_logs')
          .select('user_id, feature, total_tokens, had_attachment, created_at')
          .gte('created_at', since)
          .limit(5000),
        'ai_usage_logs_summary'
      );
      if (error) throw error;
      return result || [];
    },
    retry: 1,
    retryDelay: 500,
    staleTime: 120_000,
  });

  const summary = useMemo(() => {
    const users = new Set();
    let tokens = 0, withAttach = 0;
    const byFeature = new Map();
    for (const r of rows) {
      if (r.user_id) users.add(r.user_id);
      tokens += r.total_tokens || 0;
      if (r.had_attachment) withAttach += 1;
      const f = r.feature || 'אחר';
      byFeature.set(f, (byFeature.get(f) || 0) + 1);
    }
    const features = [...byFeature.entries()]
      .map(([feature, count]) => ({ feature, count }))
      .sort((a, b) => b.count - a.count);
    return {
      requests: rows.length,
      tokens,
      users: users.size,
      attachPct: rows.length ? Math.round((withAttach / rows.length) * 100) : 0,
      features,
    };
  }, [rows]);

  return (
    <Card className="p-4 mt-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4" style={{ color: BI.purple }} />
          <h3 className="text-sm font-bold text-gray-800">שימוש ב-AI (30 ימים)</h3>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate('/AdminAiUsage')} className="gap-1 text-xs">
          לפירוט מלא
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-400 text-center py-6">טוען…</p>
      ) : isError ? (
        <div className="text-center py-6">
          <p className="text-xs text-gray-400 mb-2">לא הצלחנו לטעון נתוני AI</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>נסה שוב</Button>
        </div>
      ) : summary.requests === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">אין שימוש ב-AI בתקופה זו</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: BI.purple }} dir="ltr">{summary.requests}</p>
              <p className="text-[11px] text-gray-500">בקשות</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: BI.blue }} dir="ltr">{summary.tokens.toLocaleString()}</p>
              <p className="text-[11px] text-gray-500">טוקנים</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: BI.green }} dir="ltr">{summary.users}</p>
              <p className="text-[11px] text-gray-500">משתמשים</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold" style={{ color: BI.amber }} dir="ltr">{summary.attachPct}%</p>
              <p className="text-[11px] text-gray-500">עם קובץ</p>
            </div>
          </div>
          <div className="space-y-1.5">
            {summary.features.map(({ feature, count }) => {
              const pct = summary.requests ? Math.round((count / summary.requests) * 100) : 0;
              return (
                <div key={feature}>
                  <div className="flex items-center justify-between text-[11px] mb-0.5">
                    <span className="text-gray-700">{AI_FEATURE_LABEL[feature] || feature}</span>
                    <span className="tabular-nums text-gray-500" dir="ltr">{count} · {pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#F1F5F9' }}>
                    <div className="h-full" style={{ width: `${pct}%`, background: BI.purple }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────
// FilterBar — sticky top filter strip (Power-BI-style global filter).
// All filters live in URL params so the view is shareable; default
// values are not serialised (clean URL).
//
// Three filters wired to the RPC:
//   • range      → date_range  (7d / 30d / 90d / 12w / all)
//   • account    → account_type (all / personal / business)
//   • vtypes     → vehicle_types (multi, comma-separated)
//
// The bar mirrors how Tableau/Looker present global filters: chips
// for the active selections + reset link. No "Apply" button — every
// change triggers a React Query refetch instantly (~100ms for 184 users).
// ──────────────────────────────────────────────────────────────────
function FilterBar({ filters, updateFilter, resetFilters, availableVehicleTypes, onRefresh, isFetching }) {
  const dateOptions = [
    { value: '7d',  label: '7 ימים'  },
    { value: '30d', label: '30 ימים' },
    { value: '90d', label: '90 ימים' },
    { value: '12w', label: '12 שבועות' },
    { value: 'all', label: 'הכל'    },
  ];
  const accountOptions = [
    { value: 'all',      label: 'הכל'    },
    { value: 'personal', label: 'פרטי'   },
    { value: 'business', label: 'עסקי'   },
  ];

  const hasActiveFilters =
    filters.date_range !== '30d'
    || filters.account_type !== 'all'
    || (filters.vehicle_types && filters.vehicle_types.length > 0);

  // ── Vehicle FAMILIES (Tier-1) for the filter chips ──
  // The chart has its own family/subtype toggle (v5.2.1). Here, the
  // filter bar shows ONLY families — keeps the chip count manageable
  // (~6 vs 30+) and matches the way Ofek thinks about audience segments.
  // Clicking a family chip writes the FULL subtype list into the
  // vehicle_types filter so the existing SQL (which accepts a flat
  // subtype list) keeps working unchanged.
  const availableSubtypes = new Set(
    (availableVehicleTypes || []).map((v) => v.vehicle_type)
  );
  const availableFamilies = useMemo(() => {
    const families = new Set();
    for (const st of availableSubtypes) {
      families.add(VEHICLE_SUBTYPE_TO_FAMILY[st] || 'אחר');
    }
    // Stable order: main families first, then "אחר" if present.
    const order = Object.keys(VEHICLE_FAMILY_MAP).concat('אחר');
    return order.filter((f) => families.has(f));
     
  }, [availableVehicleTypes]);

  // Returns the subtype list for a given family (all members of the
  // family that are actually present in the data, so toggling never
  // adds dead subtypes to the URL).
  const subtypesForFamily = (family) => {
    if (family === 'אחר') {
      const mapped = new Set(Object.values(VEHICLE_FAMILY_MAP).flat());
      return [...availableSubtypes].filter((st) => !mapped.has(st));
    }
    const familyList = VEHICLE_FAMILY_MAP[family] || [];
    return familyList.filter((st) => availableSubtypes.has(st));
  };

  // Family chip is fully active when ALL its present subtypes are in
  // the filter. Treats the family chip as a binary toggle for the UX
  // simplicity ("on/off") even though the underlying state is a list.
  const isFamilyActive = (family) => {
    const subs = subtypesForFamily(family);
    if (subs.length === 0) return false;
    const current = new Set(filters.vehicle_types || []);
    return subs.every((st) => current.has(st));
  };

  const toggleFamily = (family) => {
    const subs = subtypesForFamily(family);
    const current = new Set(filters.vehicle_types || []);
    const allOn = subs.every((st) => current.has(st));
    if (allOn) {
      for (const st of subs) current.delete(st);
    } else {
      for (const st of subs) current.add(st);
    }
    updateFilter('vehicle_types', [...current]);
  };

  return (
    <Card className="p-3 mb-4 sticky top-2 z-20 bg-white/95 backdrop-blur shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        {/* Date range — segmented pill */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-500 font-medium">תקופה</span>
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
            {dateOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => updateFilter('date_range', o.value)}
                className={`px-2.5 py-1 text-xs rounded-md transition ${
                  filters.date_range === o.value
                    ? 'bg-white shadow-sm font-bold text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Account type — segmented pill */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-gray-500 font-medium">סוג חשבון</span>
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
            {accountOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => updateFilter('account_type', o.value)}
                className={`px-2.5 py-1 text-xs rounded-md transition ${
                  filters.account_type === o.value
                    ? 'bg-white shadow-sm font-bold text-gray-900'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Vehicle families — Tier-1 chips (multi-select). Each chip
            represents a family of subtypes (e.g. "דו-גלגלי" = אופנוע
            כביש + קטנוע + אנדורו + מוטוקרוס). Clicking toggles ALL
            subtypes of that family in/out of the underlying flat
            vehicle_types filter — so the SQL stays unchanged and the
            URL is shareable. For drilling into a specific subtype,
            use the family/subtype toggle inside the chart card. */}
        {availableFamilies.length > 0 && (
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[10px] text-gray-500 font-medium">משפחות רכב</span>
            <div className="flex flex-wrap gap-1 max-w-md">
              {availableFamilies.map((family) => {
                const isOn = isFamilyActive(family);
                const subCount = subtypesForFamily(family).length;
                return (
                  <button
                    key={family}
                    type="button"
                    onClick={() => toggleFamily(family)}
                    title={`${subCount} תתי-סוגים`}
                    className={`px-2 py-0.5 text-[11px] rounded-full transition border ${
                      isOn
                        ? 'bg-blue-50 border-blue-400 text-blue-700 font-bold'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {family}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Spacer + Reset + Refresh */}
        <div className="ms-auto flex items-center gap-2">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2"
            >
              איפוס
            </button>
          )}
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={isFetching} className="gap-1">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            רענן
          </Button>
        </div>
      </div>
    </Card>
  );
}

function KpiCard({ label, value, icon: Icon, color, onClick, hint }) {
  return (
    <Card
      className={`p-3 text-center transition ${onClick ? 'cursor-pointer hover:shadow-md hover:scale-[1.02]' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <Icon className="w-5 h-5 mx-auto mb-1" style={{ color }} />
      <p className="text-2xl font-bold" style={{ color }} dir="ltr">{value}</p>
      {hint && (
        <p className="text-[10px] text-gray-400 tabular-nums" dir="ltr">{hint}</p>
      )}
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
    </Card>
  );
}

function ChartCard({ title, icon: Icon, color, children }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4" style={{ color }} />
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
      </div>
      {children}
    </Card>
  );
}

function MiniChart({ data, dataKey, xKey, color, type = "bar", label, onPointClick }) {
  if (!data.length) return <p className="text-xs text-gray-400 text-center py-10">אין נתונים</p>;

  // recharts onClick on the chart itself bubbles per-element clicks via
  // `activePayload`. For both Bar and Line charts the payload index is
  // most reliable — recharts hands us the data row directly.
  const handleClick = onPointClick
    ? (state) => {
        const row = state?.activePayload?.[0]?.payload;
        if (row && (row[dataKey] || 0) > 0) onPointClick(row);
      }
    : undefined;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }} onClick={handleClick}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
        <XAxis dataKey={xKey} tickFormatter={fmtDate} tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip formatter={(v) => [v, label || ""]} labelFormatter={fmtDate} contentStyle={{ fontSize: 12, direction: "rtl" }} />
        {type === "bar"
          ? <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} cursor={onPointClick ? 'pointer' : undefined} />
          : <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={{ r: 2 }} activeDot={{ r: 5, cursor: onPointClick ? 'pointer' : undefined }} />
        }
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// Histogram: how many users own 0 / 1 / 2 / … vehicles. A "user" is a
// personal account; the 0-bucket counts people who signed up but never added
// a vehicle (an activation signal). Self-contained — own RPC + own query, so
// it doesn't bloat the main admin_analytics_summary payload. The long tail
// (>= 10 vehicles — rare fleets/collectors) is folded into a "10+" bucket so
// the axis stays readable. X is categorical, so we do NOT date-format it
// (which is why MiniChart, whose X axis is hardcoded to dates, isn't reused).
function VehicleCountChart() {
  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-vehicle-count-distribution"],
    queryFn: async () => {
      const { data: result, error } = await withTimeout(
        supabase.rpc("admin_vehicle_count_distribution"),
        "admin_vehicle_count_distribution"
      );
      if (error) throw error;
      return Array.isArray(result) ? result : [];
    },
    retry: 1,
    retryDelay: 500,
    staleTime: 60_000,
  });

  const TAIL = 10;
  const counts = [];
  let tail = 0;
  for (const r of rows) {
    const vc = Number(r.vehicle_count);
    const users = Number(r.user_count) || 0;
    if (!Number.isFinite(vc)) continue;
    if (vc >= TAIL) tail += users;
    else counts[vc] = (counts[vc] || 0) + users;
  }
  const maxBucket = counts.length ? counts.length - 1 : 0;
  const chartData = [];
  for (let i = 0; i <= maxBucket; i++) chartData.push({ bucket: String(i), users: counts[i] || 0 });
  if (tail > 0) chartData.push({ bucket: `${TAIL}+`, users: tail });
  const totalUsers = chartData.reduce((s, d) => s + d.users, 0);

  return (
    <ChartCard title="התפלגות רכבים למשתמש" icon={Car} color={BI.teal}>
      {isLoading ? (
        <p className="text-xs text-gray-400 text-center py-10">טוען…</p>
      ) : isError ? (
        <div className="text-center py-8">
          <p className="text-xs text-gray-400 mb-2">לא הצלחנו לטעון</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>נסה שוב</Button>
        </div>
      ) : chartData.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-10">אין נתונים</p>
      ) : (
        <>
          {(() => {
            const zeroUsers = chartData.find((d) => d.bucket === "0")?.users || 0;
            const zeroPct = totalUsers ? Math.round((zeroUsers / totalUsers) * 100) : 0;
            return (
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="text-2xl font-bold leading-none" dir="ltr"
                  style={{ color: zeroPct >= 40 ? BI.red : zeroPct >= 25 ? BI.amber : BI.green }}>
                  {zeroPct}%
                </span>
                <span className="text-[11px] text-gray-500">
                  ללא רכב ({zeroUsers.toLocaleString("he-IL")} מתוך {totalUsers.toLocaleString("he-IL")})
                </span>
              </div>
            );
          })()}
          <p className="text-[10px] text-gray-400 mb-1">
            לפי משתמשים עם חשבון אישי. העמודה 0 = נרשמו ללא רכב — שאיפה: שהאחוז ירד עם הזמן.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                formatter={(v) => [v, "משתמשים"]}
                labelFormatter={(l) => `${l} רכבים`}
                contentStyle={{ fontSize: 12, direction: "rtl" }}
              />
              <Bar dataKey="users" fill={BI.teal} radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </>
      )}
    </ChartCard>
  );
}

// Cohort trend: for each signup WEEK, the share of users who still had 0
// vehicles 7 days after THEIR signup. Time-normalised (every cohort measured
// at the same maturity), so a falling line = onboarding is improving — unlike
// the raw global %, which is dragged down by old inactive accounts. X is a
// real date so MiniChart's date axis is reused as-is.
function ZeroVehicleTrendChart() {
  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-zero-vehicle-cohort"],
    queryFn: async () => {
      const { data: result, error } = await withTimeout(
        supabase.rpc("admin_zero_vehicle_cohort_trend"),
        "admin_zero_vehicle_cohort_trend"
      );
      if (error) throw error;
      return Array.isArray(result) ? result : [];
    },
    retry: 1,
    retryDelay: 500,
    staleTime: 60_000,
  });

  // numeric() comes back as a string over JSON — coerce for the Y axis.
  const chartData = rows.map((r) => ({
    week_start: r.week_start,
    zero_pct: Number(r.zero_pct) || 0,
    cohort_size: Number(r.cohort_size) || 0,
  }));

  return (
    <ChartCard title="% ללא רכב לפי שבוע הרשמה (7 ימים)" icon={TrendingUp} color={BI.red}>
      {isLoading ? (
        <p className="text-xs text-gray-400 text-center py-10">טוען…</p>
      ) : isError ? (
        <div className="text-center py-8">
          <p className="text-xs text-gray-400 mb-2">לא הצלחנו לטעון</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>נסה שוב</Button>
        </div>
      ) : chartData.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-10">אין נתונים</p>
      ) : (
        <>
          <p className="text-[10px] text-gray-400 mb-1">
            לכל קבוצת נרשמים: % שעדיין ללא רכב 7 ימים אחרי ההרשמה. קו יורד = אקטיבציה משתפרת. (קבוצות קטנות רועשות.)
          </p>
          <MiniChart data={chartData} dataKey="zero_pct" xKey="week_start" color={BI.red} type="line" label="% ללא רכב" />
        </>
      )}
    </ChartCard>
  );
}

// Phone-number coverage: how many users have a phone on file vs not. A clean
// binary split — two big counts + a single ratio bar (no pie; a 2-slice pie
// reads worse than a bar for "X% vs Y%"). Same population as the vehicle chart
// (personal accounts) so the two widgets are comparable.
function PhoneCoverageChart() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-phone-coverage"],
    queryFn: async () => {
      const { data: result, error } = await withTimeout(
        supabase.rpc("admin_phone_coverage"),
        "admin_phone_coverage"
      );
      if (error) throw error;
      return Array.isArray(result) ? result[0] : result;
    },
    retry: 1,
    retryDelay: 500,
    staleTime: 60_000,
  });

  const withPhone = Number(data?.with_phone) || 0;
  const without = Number(data?.without_phone) || 0;
  const total = Number(data?.total) || withPhone + without;
  const withPct = total ? Math.round((withPhone / total) * 100) : 0;
  const withoutPct = total ? 100 - withPct : 0;

  return (
    <ChartCard title="מספר טלפון במערכת" icon={Phone} color={BI.blue}>
      {isLoading ? (
        <p className="text-xs text-gray-400 text-center py-10">טוען…</p>
      ) : isError ? (
        <div className="text-center py-8">
          <p className="text-xs text-gray-400 mb-2">לא הצלחנו לטעון</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>נסה שוב</Button>
        </div>
      ) : total === 0 ? (
        <p className="text-xs text-gray-400 text-center py-10">אין נתונים</p>
      ) : (
        <>
          <div className="flex gap-3 mb-3">
            <div className="flex-1 rounded-xl p-3 bg-emerald-50">
              <p className="text-2xl font-bold leading-none" dir="ltr" style={{ color: BI.green }}>
                {withPhone.toLocaleString("he-IL")}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">עם טלפון · {withPct}%</p>
            </div>
            <div className="flex-1 rounded-xl p-3 bg-slate-100">
              <p className="text-2xl font-bold leading-none" dir="ltr" style={{ color: BI.slate }}>
                {without.toLocaleString("he-IL")}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">ללא טלפון · {withoutPct}%</p>
            </div>
          </div>
          {/* Single ratio bar — green = share with a phone, fills from the
              start (dir=ltr so the width maps to the % intuitively). */}
          <div className="h-2.5 w-full rounded-full overflow-hidden bg-slate-200" dir="ltr">
            <div className="h-full" style={{ width: `${withPct}%`, background: BI.green }} />
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            לפי {total.toLocaleString("he-IL")} משתמשים (חשבון אישי).
          </p>
        </>
      )}
    </ChartCard>
  );
}

function FunnelChart({ data, onPointClick }) {
  if (!data.length) return <p className="text-xs text-gray-400 text-center py-10">אין נתונים</p>;

  // Funnel as horizontal bars sorted top→bottom, signup at top.
  // Each row shows: label · count · % of top · drop-off arrow.
  // The Hebrew stage labels live here (single source of truth).
  const STAGE_LABEL = {
    signup:         'הרשמה',
    email_verified: 'אימות אימייל',
    first_vehicle:  'רכב ראשון',
    first_reminder: 'תזכורת ראשונה',
    first_document: 'מסמך ראשון',
  };
  const top = data[0]?.count || 1;

  return (
    <div className="space-y-1.5 py-2 text-xs">
      {data.map((row, i) => {
        const pct      = Math.round((row.count / top) * 100);
        const prev     = i > 0 ? data[i - 1].count : null;
        const dropPct  = prev != null && prev > 0
          ? Math.round(((prev - row.count) / prev) * 100)
          : null;
        const dropBad  = dropPct != null && dropPct >= 30;
        return (
          <button
            key={row.stage}
            type="button"
            onClick={onPointClick ? () => onPointClick(row) : undefined}
            className={`w-full text-right ${onPointClick ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'} rounded-lg p-1.5 transition`}
          >
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className="text-gray-700 font-medium">{STAGE_LABEL[row.stage] || row.stage}</span>
              <span className="flex items-center gap-2">
                {dropPct != null && dropPct > 0 && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{
                      background: dropBad ? BI.red + '15' : BI.slate + '15',
                      color: dropBad ? BI.red : BI.slate,
                    }}
                    title={`drop-off: ${dropPct}%`}
                    dir="ltr"
                  >
                    −{dropPct}%
                  </span>
                )}
                <span className="text-gray-900 font-bold tabular-nums" dir="ltr">{row.count}</span>
                <span className="text-gray-400 text-[10px] tabular-nums" dir="ltr">({pct}%)</span>
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#F1F5F9' }}>
              <div
                className="h-full transition-all"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${BI.amber} 0%, ${BI.purple} 100%)`,
                }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AgeChart({ data, onPointClick }) {
  if (!data.length) return <p className="text-xs text-gray-400 text-center py-10">אין נתונים</p>;

  // "לא הוזן" (unknown) deserves a distinct neutral gray — the rest of
  // the buckets use the BI palette in age-order so the visual reads
  // young→old left-to-right in the legend.
  const COLORS = {
    "18-24": C.info,
    "25-34": C.successBright,
    "35-44": C.warnIcon,
    "45-54": "#8B5CF6",
    "55-64": "#0891B2",
    "65+":   "#EF4444",
    "לא הוזן": "#94A3B8",
  };

  const total = data.reduce((s, r) => s + (r.count || 0), 0) || 1;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="bucket"
          cx="50%"
          cy="50%"
          outerRadius={70}
          innerRadius={36}
          paddingAngle={2}
          isAnimationActive={false}
          label={({ count }) => `${Math.round((count / total) * 100)}%`}
          labelLine={false}
          onClick={onPointClick ? (entry) => onPointClick(entry.payload || entry) : undefined}
          cursor={onPointClick ? 'pointer' : undefined}
        >
          {data.map((row, i) => (
            <Cell key={i} fill={COLORS[row.bucket] || PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v, name) => [`${v} (${Math.round((v / total) * 100)}%)`, name]}
          contentStyle={{ fontSize: 12, direction: "rtl" }}
        />
        <Legend
          verticalAlign="bottom"
          align="center"
          iconType="circle"
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// Wrapper that lets the admin flip between Tier-1 family view ("משפחה")
// and the flat subtype view ("תת-סוג"). Family is default = better for
// audience segmentation; subtype is one click away for deep-dives.
// State lives here so the toggle survives parent re-renders (filter
// changes refresh `data` but the mode persists).
function TypesChartWithToggle({ data, onFamilyClick, onSubtypeClick }) {
  const [mode, setMode] = useState('family');
  const familyData = useMemo(() => aggregateByFamily(data || []), [data]);
  const isFamily = mode === 'family';
  return (
    <div>
      <div className="flex justify-end mb-2 -mt-1">
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
          <button
            type="button"
            onClick={() => setMode('family')}
            className={`px-2.5 py-0.5 text-[11px] rounded-md transition ${
              isFamily ? 'bg-white shadow-sm font-bold text-gray-900'
                       : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            משפחה
          </button>
          <button
            type="button"
            onClick={() => setMode('subtype')}
            className={`px-2.5 py-0.5 text-[11px] rounded-md transition ${
              !isFamily ? 'bg-white shadow-sm font-bold text-gray-900'
                        : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            תת-סוג
          </button>
        </div>
      </div>
      <TypesChart
        data={isFamily ? familyData : data}
        onPointClick={isFamily
          ? (row) => onFamilyClick(row.vehicle_type)
          : onSubtypeClick}
      />
    </div>
  );
}

function TypesChart({ data, onPointClick }) {
  if (!data.length) return <p className="text-xs text-gray-400 text-center py-10">אין נתונים</p>;

  const handleClick = onPointClick
    ? (state) => {
        const row = state?.activePayload?.[0]?.payload;
        if (row) onPointClick(row);
      }
    : undefined;

  // RTL layout vertical bar: in Hebrew the category labels sit at the
  // RIGHT side of the chart, the bars grow to the LEFT. Recharts doesn't
  // have a built-in RTL mode, so we expose the y-axis on the right via
  // `orientation="right"` and widen it to ~120px so the longest Hebrew
  // labels ("רכב מסחרי", "אוטובוס") have room — previously the 80px
  // width truncated everything to 1-3 characters.
  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} layout="vertical" margin={{ top: 5, right: 0, left: 8, bottom: 0 }} onClick={handleClick}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="vehicle_type"
          orientation="right"
          tick={{ fontSize: 11, fill: "#64748B", textAnchor: "start" }}
          axisLine={false}
          tickLine={false}
          width={120}
          interval={0}
        />
        <Tooltip contentStyle={{ fontSize: 12, direction: "rtl" }} />
        <Bar dataKey="count" radius={[4, 0, 0, 4]} cursor={onPointClick ? 'pointer' : undefined}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function EmailCard({ stats }) {
  const sent = stats.sent || 0;
  const base = sent || 1;
  const items = [
    { label: "נשלחו",  value: sent,                 color: BI.blue },
    { label: "נמסרו",  value: stats.delivered || 0,  color: BI.teal },
    { label: "נפתחו",  value: stats.opened || 0,     color: BI.green },
    { label: "נלחצו",  value: stats.clicked || 0,    color: BI.amber },
    { label: "חזרו",   value: stats.bounced || 0,    color: BI.red },
  ];

  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Mail className="w-4 h-4" style={{ color: BI.blue }} />
        <h3 className="text-sm font-bold text-gray-800">מיילים (30 ימים)</h3>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        {items.map((it) => (
          <div key={it.label} className="text-center">
            <p className="text-xl font-bold" style={{ color: it.color }} dir="ltr">{it.value}</p>
            <p className="text-[11px] text-gray-500">{it.label}</p>
            {it.label !== "נשלחו" && (
              <p className="text-[10px] text-gray-400" dir="ltr">{Math.round((it.value / base) * 100)}%</p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function CohortCard({ cohorts }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4" style={{ color: BI.purple }} />
        <h3 className="text-sm font-bold text-gray-800">שימור קוהורטות (12 שבועות)</h3>
      </div>
      {!cohorts.length ? (
        <p className="text-xs text-gray-400 text-center py-4">אין נתוני קוהורטות</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="text-right py-2 pr-2 font-medium">שבוע</th>
                <th className="text-center py-2 font-medium">גודל</th>
                <th className="text-center py-2 font-medium">D1</th>
                <th className="text-center py-2 font-medium">D7</th>
                <th className="text-center py-2 font-medium">D30</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => {
                const sz = c.cohort_size || 1;
                return (
                  <tr key={c.cohort_week} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 pr-2 text-gray-700 font-mono" dir="ltr">{fmtDate(c.cohort_week)}</td>
                    <td className="text-center text-gray-700 font-medium" dir="ltr">{c.cohort_size}</td>
                    <td className="text-center"><Pct v={c.returned_d1} t={sz} /></td>
                    <td className="text-center"><Pct v={c.returned_d7} t={sz} /></td>
                    <td className="text-center"><Pct v={c.returned_d30} t={sz} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Pct({ v, t }) {
  const pct = Math.round((v / t) * 100);
  const color = pct >= 50 ? BI.green : pct >= 25 ? BI.amber : BI.red;
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium" dir="ltr"
      style={{ color, background: `${color}15` }}>
      {pct}%
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────
// DrillSheet — generic side-sheet that opens when any chart, KPI, or
// pie slice on this page is clicked. Queries admin_analytics_drilldown
// with the segment object the click handler passed, then renders a
// dynamic table from the {title, columns, rows} response. Reused for
// every drill-down so adding a new chart later only needs:
//   1. A new branch in admin_analytics_drilldown SQL
//   2. A new setDrillSegment({type: '...'}) call on the chart's onClick
// No new sheet code needed.
// ──────────────────────────────────────────────────────────────────
function DrillSheet({ segment, onClose }) {
  const open = !!segment;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-analytics-drilldown', segment],
    queryFn: async () => {
      const { data: result, error } = await withTimeout(
        supabase.rpc('admin_analytics_drilldown', { p_segment: segment }),
        'admin_analytics_drilldown'
      );
      if (error) throw error;
      return result;
    },
    enabled: open,
    staleTime: 30_000,
  });

  const title   = data?.title   || 'פירוט';
  const columns = data?.columns || [];
  const rows    = data?.rows    || [];
  const total   = data?.total   ?? 0;

  const exportCsv = () => {
    if (!rows.length) return;
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n\r]/.test(s) ? `"${s}"` : s;
    };
    const header = columns.map((c) => c.label).join(',');
    const body   = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n');
    const csv    = '﻿' + header + '\n' + body;
    const blob   = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href = url;
    a.download = `${title}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto" dir="rtl">
        <SheetHeader className="text-right">
          <SheetTitle className="flex items-center justify-between gap-2 pr-7">
            <span className="text-base">{title}</span>
            <span className="text-xs text-gray-400 font-normal" dir="ltr">
              {total} {total === 1 ? 'רשומה' : 'רשומות'}
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4">
          {isLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          )}

          {isError && (
            <p className="text-center text-sm text-red-500 py-12">לא הצלחנו לטעון את הפרטים</p>
          )}

          {!isLoading && !isError && rows.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-12">אין רשומות לתצוגה</p>
          )}

          {!isLoading && !isError && rows.length > 0 && (
            <>
              <div className="flex justify-end mb-3">
                <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1">
                  <Download className="w-3.5 h-3.5" />
                  ייצוא CSV
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-gray-500">
                      {columns.map((c) => (
                        <th key={c.key} className="text-right py-2 px-2 font-medium whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        {columns.map((c) => (
                          <td key={c.key} className="py-1.5 px-2 text-gray-700 max-w-[220px] truncate" title={String(r[c.key] ?? '')}>
                            {formatCell(r[c.key], c.key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Light cell formatter — turns ISO timestamps into local Israeli date+time
// and leaves everything else as-is. Date detection is by key name to
// avoid mis-parsing license plates or other digits.
function formatCell(val, key) {
  if (val === null || val === undefined || val === '') return '—';
  const dateKeys = ['signup_at', 'last_sign_in_at', 'created_at'];
  if (dateKeys.includes(key) && typeof val === 'string') {
    try { return format(parseISO(val), 'dd/MM/yyyy HH:mm'); } catch { return val; }
  }
  return String(val);
}

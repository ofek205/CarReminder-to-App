import React, { useState } from "react";
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
} from "lucide-react";
import { format, parseISO } from "date-fns";

const BI = {
  blue: "#3B82F6", green: "#10B981", amber: "#F59E0B",
  red: "#EF4444", purple: "#8B5CF6", teal: "#0891B2", slate: "#64748B",
};
const PALETTE = [BI.purple, BI.blue, BI.teal, BI.green, BI.amber, BI.red, BI.slate];

function fmtDate(d) {
  try { return format(parseISO(d), "dd/MM"); } catch { return d; }
}

export default function AdminAnalytics() {
  const isAdmin = useIsAdmin();
  // The current drill-down segment (null when sheet is closed). The
  // shape mirrors what admin_analytics_drilldown expects: {type, ...extra}.
  // Each chart's onClick handler sets this; the DrillSheet at the bottom
  // queries and renders when it's non-null.
  const [drillSegment, setDrillSegment] = useState(null);

  const { data, isLoading, isError, error: queryError, refetch, isFetching } = useQuery({
    queryKey: ["admin-analytics"],
    queryFn: async () => {
      const { data: result, error } = await withTimeout(
        supabase.rpc("admin_analytics_summary"),
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
  } = data || {};

  const totalSignups = signups_daily.reduce((s, r) => s + (r.count || 0), 0);
  const latestWau = wau_weekly.length ? wau_weekly[wau_weekly.length - 1]?.active_users || 0 : 0;
  const totalVehicles = vehicle_types.reduce((s, r) => s + (r.count || 0), 0);
  const totalErrors = errors_daily.reduce((s, r) => s + (r.count || 0), 0);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto" dir="rtl" style={{ fontVariantNumeric: "tabular-nums" }}>
      <PageHeader title="אנליטיקה" subtitle="נתוני שימוש, צמיחה ומעורבות." />

      <div className="flex justify-end mb-4">
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          רענן
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <KpiCard label="הרשמות (30 ימים)" value={totalSignups} icon={Users}      color={BI.blue}  onClick={() => setDrillSegment({ type: 'kpi_total_users' })} />
        <KpiCard label="פעילים השבוע"     value={latestWau}    icon={TrendingUp} color={BI.green} onClick={() => setDrillSegment({ type: 'kpi_active_week' })} />
        <KpiCard label='סה"כ רכבים'        value={totalVehicles} icon={Car}      color={BI.teal}  onClick={() => setDrillSegment({ type: 'kpi_total_vehicles' })} />
        <KpiCard label="שגיאות (14 ימים)"  value={totalErrors}  icon={Bug}        color={totalErrors > 50 ? BI.red : BI.slate} onClick={() => setDrillSegment({ type: 'kpi_errors_14d' })} />
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
          <TypesChart data={vehicle_types}
            onPointClick={(row) => setDrillSegment({ type: 'vehicle_type', vehicle_type: row.vehicle_type })} />
        </ChartCard>

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
      </div>

      <DrillSheet segment={drillSegment} onClose={() => setDrillSegment(null)} />

      <EmailCard stats={email_stats} />
      <CohortCard cohorts={cohorts} />
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, color, onClick }) {
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

function AgeChart({ data, onPointClick }) {
  if (!data.length) return <p className="text-xs text-gray-400 text-center py-10">אין נתונים</p>;

  // "לא הוזן" (unknown) deserves a distinct neutral gray — the rest of
  // the buckets use the BI palette in age-order so the visual reads
  // young→old left-to-right in the legend.
  const COLORS = {
    "18-24": "#3B82F6",
    "25-34": "#10B981",
    "35-44": "#F59E0B",
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

function TypesChart({ data, onPointClick }) {
  if (!data.length) return <p className="text-xs text-gray-400 text-center py-10">אין נתונים</p>;

  const handleClick = onPointClick
    ? (state) => {
        const row = state?.activePayload?.[0]?.payload;
        if (row) onPointClick(row);
      }
    : undefined;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 0 }} onClick={handleClick}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="vehicle_type" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} width={80} />
        <Tooltip contentStyle={{ fontSize: 12, direction: "rtl" }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor={onPointClick ? 'pointer' : undefined}>
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

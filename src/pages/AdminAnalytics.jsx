import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/supabaseQuery";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import useIsAdmin from "@/hooks/useIsAdmin";
import {
  Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Line, ComposedChart, Cell,
} from "recharts";
import {
  AlertCircle, RefreshCw, Users, Car, FileText,
  Mail, Bug, TrendingUp,
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
    email_stats = {}, cohorts = [],
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
        <KpiCard label="הרשמות (30 ימים)" value={totalSignups} icon={Users} color={BI.blue} />
        <KpiCard label="פעילים השבוע" value={latestWau} icon={TrendingUp} color={BI.green} />
        <KpiCard label='סה"כ רכבים' value={totalVehicles} icon={Car} color={BI.teal} />
        <KpiCard label="שגיאות (14 ימים)" value={totalErrors} icon={Bug} color={totalErrors > 50 ? BI.red : BI.slate} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <ChartCard title="הרשמות יומיות (30 ימים)" icon={Users} color={BI.blue}>
          <MiniChart data={signups_daily} dataKey="count" xKey="day" color={BI.blue} label="הרשמות" />
        </ChartCard>

        <ChartCard title="משתמשים פעילים שבועיים" icon={TrendingUp} color={BI.green}>
          <MiniChart data={wau_weekly} dataKey="active_users" xKey="week_start" color={BI.green} type="line" label="פעילים" />
        </ChartCard>

        <ChartCard title="רכבים חדשים לשבוע" icon={Car} color={BI.teal}>
          <MiniChart data={vehicles_weekly} dataKey="count" xKey="week_start" color={BI.teal} label="רכבים" />
        </ChartCard>

        <ChartCard title="התפלגות סוגי רכב" icon={Car} color={BI.purple}>
          <TypesChart data={vehicle_types} />
        </ChartCard>

        <ChartCard title="מסמכים שהועלו לשבוע" icon={FileText} color={BI.amber}>
          <MiniChart data={documents_weekly} dataKey="count" xKey="week_start" color={BI.amber} label="מסמכים" />
        </ChartCard>

        <ChartCard title="שגיאות יומיות (14 ימים)" icon={Bug} color={BI.red}>
          <MiniChart data={errors_daily} dataKey="count" xKey="day" color={BI.red} label="שגיאות" />
        </ChartCard>
      </div>

      <EmailCard stats={email_stats} />
      <CohortCard cohorts={cohorts} />
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, color }) {
  return (
    <Card className="p-3 text-center">
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

function MiniChart({ data, dataKey, xKey, color, type = "bar", label }) {
  if (!data.length) return <p className="text-xs text-gray-400 text-center py-10">אין נתונים</p>;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
        <XAxis dataKey={xKey} tickFormatter={fmtDate} tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip formatter={(v) => [v, label || ""]} labelFormatter={fmtDate} contentStyle={{ fontSize: 12, direction: "rtl" }} />
        {type === "bar"
          ? <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
          : <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} dot={{ r: 2 }} activeDot={{ r: 5 }} />
        }
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function TypesChart({ data }) {
  if (!data.length) return <p className="text-xs text-gray-400 text-center py-10">אין נתונים</p>;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="vehicle_type" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} width={80} />
        <Tooltip contentStyle={{ fontSize: 12, direction: "rtl" }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
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

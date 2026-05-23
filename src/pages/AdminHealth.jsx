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
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Zap,
  Mail,
  Clock,
  HardDrive,
  Bell,
} from "lucide-react";
import { C } from "@/lib/designTokens";

const PROBE_META = {
  db_latency:     { label: "מסד נתונים",      icon: Database,   description: "זמן תגובה של DB" },
  error_rate_24h: { label: "שגיאות (24 שעות)", icon: Zap,        description: "שגיאות אפליקציה ביממה האחרונה" },
  email_webhook:  { label: "Resend Webhook",   icon: Mail,       description: "אירועי מייל שהתקבלו" },
  pg_cron:        { label: "pg_cron",          icon: Clock,      description: "משימות מתוזמנות" },
  storage:        { label: "נפח נתונים",       icon: HardDrive,  description: "גודל טבלאות מרכזיות" },
  unack_alerts:   { label: "התראות פתוחות",    icon: Bell,       description: "התראות שלא טופלו" },
};

const STATUS_STYLE = {
  green:  { icon: CheckCircle2,  color: C.success, bg: C.successBg, label: "תקין"  },
  yellow: { icon: AlertTriangle, color: C.warn,    bg: C.warnBg,    label: "אזהרה" },
  red:    { icon: XCircle,       color: C.error,   bg: C.errorBg,   label: "בעיה"  },
};

export default function AdminHealth() {
  const isAdmin = useIsAdmin();

  const { data: probes = [], isLoading, isError, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["admin-health"],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.rpc("admin_health_status"),
        "admin_health_status"
      );
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin === true,
    retry: 1,
    retryDelay: 500,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const overallStatus = probes.some((p) => p.status === "red")
    ? "red"
    : probes.some((p) => p.status === "yellow")
      ? "yellow"
      : "green";

  if (isAdmin === false) {
    return <div className="p-6 text-center" dir="rtl"><p className="text-gray-600">אזור זה זמין למנהלי מערכת בלבד.</p></div>;
  }
  if (isAdmin === null || isLoading) {
    return <div className="flex justify-center py-16"><LoadingSpinner /></div>;
  }
  if (isError) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto" dir="rtl">
        <PageHeader title="בריאות מערכת" />
        <Card className="p-6 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500" />
          <p className="font-bold mb-2">לא הצלחנו לטעון את סטטוס המערכת</p>
          <Button onClick={() => refetch()}>נסה שוב</Button>
        </Card>
      </div>
    );
  }

  const overallStyle = STATUS_STYLE[overallStatus];
  const OverallIcon = overallStyle.icon;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto" dir="rtl">
      <PageHeader
        title="בריאות מערכת"
        subtitle="מבט אחד — הכל חי?"
      />

      {/* Overall status hero */}
      <Card className="p-5 mb-5 text-center" style={{ borderColor: overallStyle.color, borderWidth: 2 }}>
        <OverallIcon className="w-12 h-12 mx-auto mb-2" style={{ color: overallStyle.color }} />
        <h2 className="text-xl font-bold" style={{ color: overallStyle.color }}>
          {overallStatus === "green" ? "הכל תקין" : overallStatus === "yellow" ? "יש אזהרות" : "יש בעיות"}
        </h2>
        <div className="flex items-center justify-center gap-2 mt-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-1">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            רענן
          </Button>
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-gray-400">
              נבדק לאחרונה {new Date(dataUpdatedAt).toLocaleTimeString("he-IL")}
            </span>
          )}
        </div>
      </Card>

      {/* Probe cards */}
      <div className="space-y-3">
        {probes.map((probe) => (
          <ProbeCard key={probe.probe} probe={probe} />
        ))}
      </div>
    </div>
  );
}

function ProbeCard({ probe }) {
  const meta = PROBE_META[probe.probe] || { label: probe.probe, icon: AlertCircle, description: "" };
  const statusStyle = STATUS_STYLE[probe.status] || STATUS_STYLE.green;
  const ProbeIcon = meta.icon;
  const StatusIcon = statusStyle.icon;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full p-2.5 shrink-0" style={{ background: statusStyle.bg }}>
          <ProbeIcon className="w-5 h-5" style={{ color: statusStyle.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-bold text-gray-900">{meta.label}</h3>
            <StatusIcon className="w-4 h-4 shrink-0" style={{ color: statusStyle.color }} />
          </div>

          <p className="text-sm text-gray-700 mb-1">{probe.message}</p>

          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-medium" dir="ltr">{probe.value}</span>
            {meta.description && (
              <>
                <span>·</span>
                <span>{meta.description}</span>
              </>
            )}
          </div>
        </div>

        <span
          className="text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 mt-1"
          style={{ background: statusStyle.bg, color: statusStyle.color }}
        >
          {statusStyle.label}
        </span>
      </div>
    </Card>
  );
}

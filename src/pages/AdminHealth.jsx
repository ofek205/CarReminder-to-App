import React, { useState } from "react";
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
  ChevronDown,
  ChevronUp,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import { C } from "@/lib/designTokens";
import { formatDistanceToNow, parseISO } from "date-fns";
import { he } from "date-fns/locale";

const PROBE_META = {
  db_latency:     { label: "מסד נתונים",      icon: Database,   description: "זמן תגובה של DB",              drillable: false },
  error_rate_24h: { label: "שגיאות (24 שעות)", icon: Zap,        description: "שגיאות אפליקציה ביממה האחרונה", drillable: true  },
  email_webhook:  { label: "Resend Webhook",   icon: Mail,       description: "אירועי מייל שהתקבלו",          drillable: true  },
  pg_cron:        { label: "pg_cron",          icon: Clock,      description: "משימות מתוזמנות",               drillable: true  },
  storage:        { label: "נפח נתונים",       icon: HardDrive,  description: "גודל טבלאות מרכזיות",           drillable: true  },
  unack_alerts:   { label: "התראות פתוחות",    icon: Bell,       description: "התראות שלא טופלו",              drillable: true  },
};

const STATUS_STYLE = {
  green:  { icon: CheckCircle2,  color: C.success, bg: C.successBg, label: "תקין"  },
  yellow: { icon: AlertTriangle, color: C.warn,    bg: C.warnBg,    label: "אזהרה" },
  red:    { icon: XCircle,       color: C.error,   bg: C.errorBg,   label: "בעיה"  },
};

export default function AdminHealth() {
  const isAdmin = useIsAdmin();

  const { data: probes = [], isLoading, isError, error: queryError, refetch, isFetching, dataUpdatedAt } = useQuery({
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
          <p className="text-xs text-gray-400 mb-3 font-mono" dir="ltr">{queryError?.message || queryError?.code || JSON.stringify(queryError)}</p>
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
  const meta = PROBE_META[probe.probe] || { label: probe.probe, icon: AlertCircle, description: "", drillable: false };
  const statusStyle = STATUS_STYLE[probe.status] || STATUS_STYLE.green;
  const ProbeIcon = meta.icon;
  const StatusIcon = statusStyle.icon;
  const [open, setOpen] = useState(false);

  const canDrill = meta.drillable;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => canDrill && setOpen((v) => !v)}
        className={`w-full p-4 text-right ${canDrill ? "cursor-pointer hover:bg-gray-50 transition" : "cursor-default"}`}
        disabled={!canDrill}
      >
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

          <div className="flex items-center gap-2 shrink-0 mt-1">
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: statusStyle.bg, color: statusStyle.color }}
            >
              {statusStyle.label}
            </span>
            {canDrill && (
              open
                ? <ChevronUp className="w-4 h-4 text-gray-400" />
                : <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </div>
        </div>
      </button>

      {open && <DrillDown probe={probe.probe} />}
    </Card>
  );
}

const DRILL_RENDERERS = {
  error_rate_24h: errorRenderer,
  pg_cron:        cronRenderer,
  email_webhook:  webhookRenderer,
  storage:        storageRenderer,
  unack_alerts:   alertsRenderer,
};

function DrillDown({ probe }) {
  const { data: rows = [], isLoading, isError } = useQuery({
    queryKey: ["admin-health-drilldown", probe],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.rpc("admin_health_drilldown", { p_probe: probe }),
        "admin_health_drilldown"
      );
      if (error) throw error;
      return data || [];
    },
    staleTime: 30 * 1000,
  });

  if (isLoading) {
    return (
      <div className="border-t bg-gray-50 p-4 flex justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="border-t bg-gray-50 p-4 text-center text-xs text-red-500">
        שגיאה בטעינת פרטים
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="border-t bg-gray-50 p-4 text-center text-xs text-gray-400">
        אין נתונים נוספים
      </div>
    );
  }

  const renderer = DRILL_RENDERERS[probe] || defaultRenderer;
  return (
    <div className="border-t bg-gray-50 p-4">
      {renderer(rows)}
    </div>
  );
}

function defaultRenderer(rows) {
  return (
    <div className="space-y-1.5 text-xs">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-2 bg-white rounded-lg border px-3 py-2">
          <span className="text-gray-700 truncate">{r.item_label}</span>
          <span className="text-gray-500 shrink-0 font-medium" dir="ltr">{r.item_value}</span>
        </div>
      ))}
    </div>
  );
}

function CopyErrorsButton({ rows }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const text = rows.map(r =>
      `[${r.item_key || ''}] ${r.item_label} (×${r.item_value})${r.item_extra ? ` — ${r.item_extra}` : ''}${r.item_time ? ` @ ${r.item_time}` : ''}`
    ).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition">
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      {copied ? 'הועתק' : 'העתק הכל'}
    </button>
  );
}

function errorRenderer(rows) {
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-bold text-gray-600">שגיאות נפוצות (24 שעות אחרונות)</div>
        <CopyErrorsButton rows={rows} />
      </div>
      {rows.map((r, i) => (
        <div key={i} className="bg-white rounded-lg border px-3 py-2">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="font-medium text-gray-800 truncate">{r.item_label}</span>
            <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">
              {r.item_value}×
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{r.item_key}</span>
            {r.item_extra && <span className="truncate">{r.item_extra}</span>}
            {r.item_time && (
              <span className="shrink-0">
                {formatDistanceToNow(parseISO(r.item_time), { addSuffix: true, locale: he })}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function cronRenderer(rows) {
  const statusColors = {
    succeeded: { bg: "#D1FAE5", fg: "#047857" },
    failed:    { bg: "#FEE2E2", fg: "#991B1B" },
    starting:  { bg: "#FEF3C7", fg: "#92400E" },
  };
  return (
    <div className="space-y-1.5 text-xs">
      <div className="text-[11px] font-bold text-gray-600 mb-2">ריצות אחרונות</div>
      {rows.map((r, i) => {
        const sc = statusColors[r.item_value] || statusColors.starting;
        return (
          <div key={i} className="bg-white rounded-lg border px-3 py-2 flex items-center gap-3">
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: sc.bg, color: sc.fg }}
            >
              {r.item_value}
            </span>
            <span className="text-gray-700 font-medium truncate">{r.item_label}</span>
            {r.item_time && (
              <span className="text-[10px] text-gray-400 shrink-0 mr-auto" dir="ltr">
                {formatDistanceToNow(parseISO(r.item_time), { addSuffix: true, locale: he })}
              </span>
            )}
            {r.item_extra && r.item_value === "failed" && (
              <span className="text-[10px] text-red-500 truncate max-w-[200px]" title={r.item_extra}>
                {r.item_extra}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function webhookRenderer(rows) {
  return (
    <div className="space-y-1.5 text-xs">
      <div className="text-[11px] font-bold text-gray-600 mb-2">אירועי webhook אחרונים</div>
      {rows.map((r, i) => (
        <div key={i} className="bg-white rounded-lg border px-3 py-2 flex items-center gap-3">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 shrink-0">
            {r.item_key}
          </span>
          <span className="text-gray-700 truncate">{r.item_label}</span>
          {r.item_time && (
            <span className="text-[10px] text-gray-400 shrink-0 mr-auto" dir="ltr">
              {formatDistanceToNow(parseISO(r.item_time), { addSuffix: true, locale: he })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function storageRenderer(rows) {
  return (
    <div className="space-y-1.5 text-xs">
      <div className="text-[11px] font-bold text-gray-600 mb-2">פירוט טבלאות</div>
      {rows.map((r, i) => (
        <div key={i} className="bg-white rounded-lg border px-3 py-2 flex items-center justify-between">
          <span className="text-gray-700 font-medium">{r.item_label}</span>
          <span className="font-bold text-gray-900" dir="ltr">{Number(r.item_value).toLocaleString("he-IL")}</span>
        </div>
      ))}
    </div>
  );
}

function alertsRenderer(rows) {
  const sevColors = {
    critical: { bg: "#FEE2E2", fg: "#991B1B" },
    warning:  { bg: "#FEF3C7", fg: "#92400E" },
    info:     { bg: "#DBEAFE", fg: "#1E40AF" },
  };
  return (
    <div className="space-y-1.5 text-xs">
      <div className="text-[11px] font-bold text-gray-600 mb-2">התראות פתוחות</div>
      {rows.map((r, i) => {
        const sc = sevColors[r.item_value] || sevColors.info;
        return (
          <div key={i} className="bg-white rounded-lg border px-3 py-2">
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                style={{ background: sc.bg, color: sc.fg }}
              >
                {r.item_value}
              </span>
              <span className="text-gray-800 font-medium truncate">{r.item_label}</span>
              {r.item_time && (
                <span className="text-[10px] text-gray-400 shrink-0 mr-auto">
                  {formatDistanceToNow(parseISO(r.item_time), { addSuffix: true, locale: he })}
                </span>
              )}
            </div>
            {r.item_extra && (
              <p className="text-[10px] text-gray-500 mt-1 truncate">{r.item_extra}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

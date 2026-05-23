/**
 * AdminAlerts — Stream 7 v1 UI. Lists all admin alerts (the rows in
 * `admin_alerts`), lets the admin acknowledge them, filter by status
 * and kind, and inspect the raw context JSON.
 *
 * Alerts are *received* via Telegram (per project feedback memory:
 * admin alerts route only through Telegram). This page is the visual
 * passive complement — historical log + acknowledgment workflow.
 *
 * Backed by:
 *   - `public.admin_alerts` table (RLS-gated to public.is_admin())
 *   - `public.admin_acknowledge_alert(uuid)` RPC
 *
 * Routed from Layout.jsx under "ניהול מערכת" section.
 */
import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/supabaseQuery";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import useIsAdmin from "@/hooks/useIsAdmin";
import {
  Bell,
  Check,
  AlertTriangle,
  AlertCircle,
  Mail,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { he } from "date-fns/locale";
import { toast } from "sonner";
import { C } from "@/lib/designTokens";
import { buildEmailHtml, escapeHtml } from "@/lib/emailTemplates";
import { Send } from "lucide-react";

//  Kind / severity visual mapping. Pulls from the project design tokens
//  (C.error/warn/success) so admin pages stay consistent. New kinds added
//  to check_admin_alerts() should also get an entry here — fallback is
//  generic bell.
const KIND_META = {
  error_storm:         { label: "סופת שגיאות",     icon: AlertTriangle, color: C.error,   bg: C.errorBg },
  new_support:         { label: "פנייה חדשה",       icon: Mail,          color: C.primary, bg: C.light   },
  email_failure_spike: { label: "כשל מיילים",       icon: Mail,          color: C.error,   bg: C.errorBg },
  webhook_silent:      { label: "Webhook שקט",      icon: AlertCircle,   color: C.warn,    bg: C.warnBg  },
  smoke_test:          { label: "בדיקת מערכת",      icon: Bell,          color: C.accent,  bg: C.light   },
};

const SEVERITY_META = {
  high:   { label: "גבוה",   color: C.error,   bg: C.errorBg },
  medium: { label: "בינוני", color: C.warn,    bg: C.warnBg  },
  low:    { label: "נמוך",   color: C.muted,   bg: "#F3F4F6" },
};

export default function AdminAlerts() {
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();

  const [filterStatus, setFilterStatus] = useState("unack"); // unack | ack | all
  const [filterKind, setFilterKind]     = useState("all");

  const { data: alerts = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-alerts"],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase
          .from("admin_alerts")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
        "admin_alerts_list"
      );
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin === true,
    retry: 1,
    retryDelay: 500,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // ux ask: surface new alerts without manual refresh (pg_cron runs every 5min)
    refetchOnWindowFocus: true,
  });

  const ackMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc("admin_acknowledge_alert", { p_alert_id: id });
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-alerts"] });
      qc.invalidateQueries({ queryKey: ["admin-alerts-unack-count"] });
    },
    onError: (err) => {
      toast.error("לא הצלחנו לסמן את ההתראה. נסה שוב.", { description: err?.message });
    },
  });

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (filterStatus === "unack" && a.acknowledged_at) return false;
      if (filterStatus === "ack"   && !a.acknowledged_at) return false;
      if (filterKind !== "all" && a.kind !== filterKind) return false;
      return true;
    });
  }, [alerts, filterStatus, filterKind]);

  const stats = useMemo(
    () => ({
      total: alerts.length,
      unack: alerts.filter((a) => !a.acknowledged_at).length,
      ack:   alerts.filter((a) =>  a.acknowledged_at).length,
    }),
    [alerts]
  );

  const distinctKinds = useMemo(() => Array.from(new Set(alerts.map((a) => a.kind))), [alerts]);

  if (isAdmin === false) {
    return (
      <div className="p-6 text-center" dir="rtl">
        <p className="text-gray-600">אזור זה זמין למנהלי מערכת בלבד.</p>
      </div>
    );
  }

  if (isAdmin === null || isLoading) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto" dir="rtl">
        <PageHeader title="התראות מערכת" subtitle="פעולות שצריך את תשומת ליבך" />
        <Card className="p-6 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500" />
          <p className="font-bold mb-2">לא הצלחנו לטעון את ההתראות</p>
          <Button onClick={() => refetch()}>נסה שוב</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto" dir="rtl">
      <PageHeader
        title="התראות מערכת"
        subtitle="כל ההתראות נשלחות אליך גם בטלגרם. כאן ההיסטוריה המלאה וסימון 'טופל'."
      />

      {/* Stat pills */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <StatPill label="סה״כ"      value={stats.total} tone="blue"          />
        <StatPill label="לא טופלו" value={stats.unack} tone="red"   hero    />
        <StatPill label="טופלו"    value={stats.ack}   tone="green"         />
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל ההתראות</SelectItem>
            <SelectItem value="unack">לא טופלו</SelectItem>
            <SelectItem value="ack">טופלו</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterKind} onValueChange={setFilterKind}>
          <SelectTrigger className="w-40"><SelectValue placeholder="סוג" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסוגים</SelectItem>
            {distinctKinds.map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_META[k]?.label || k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => refetch()} className="mr-auto gap-1">
          <RefreshCw className="w-3.5 h-3.5" />
          רענן
        </Button>
      </div>

      {/* Alerts list */}
      {filtered.length === 0 ? (
        <EmptyState filterStatus={filterStatus} filterKind={filterKind} />
      ) : (
        <div className="space-y-3">
          {filtered.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onAcknowledge={() => ackMutation.mutate(alert.id)}
              isAcknowledging={
                ackMutation.isPending && ackMutation.variables === alert.id
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

//  ────────────────────────────────────────────────────────────────────
//  Subcomponents
//  ────────────────────────────────────────────────────────────────────

function StatPill({ label, value, tone, hero }) {
  const tones = {
    blue:  { bg: C.light,   color: C.primary, ring: C.accent  },
    red:   { bg: C.errorBg, color: C.error,   ring: C.error   },
    green: { bg: C.successBg, color: C.success, ring: C.success },
  };
  const t = tones[tone] || tones.blue;
  // designer ask: hero only when value > 0 — empty hero is misleading
  const active = hero && value > 0;
  return (
    <div
      className={`rounded-xl p-3 text-center ${active ? "ring-2 shadow-sm" : ""}`}
      style={{
        background: t.bg,
        ...(active ? { ringColor: t.ring, boxShadow: `0 0 0 2px ${t.ring}` } : {}),
      }}
    >
      <div className={`font-bold ${active ? "text-3xl" : "text-2xl"}`} style={{ color: t.color }}>
        {value}
      </div>
      <div className="text-xs text-gray-600 mt-0.5">{label}</div>
    </div>
  );
}

function AlertCard({ alert, onAcknowledge, isAcknowledging }) {
  const kindMeta = KIND_META[alert.kind] || {
    label: alert.kind,
    icon:  Bell,
    color: "#6B7280",
    bg:    "#F3F4F6",
  };
  const sevMeta = SEVERITY_META[alert.severity] || SEVERITY_META.low;
  const Icon = kindMeta.icon;
  const acknowledged = !!alert.acknowledged_at;

  const [replyOpen, setReplyOpen] = useState(false);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);

  const contactEmail = alert.context?.email;

  const handleSendReply = async () => {
    if (!replySubject.trim() || !replyBody.trim() || !contactEmail) return;
    setSending(true);
    try {
      const bodyHtml = `<p style="font-size:15px;line-height:1.75;color:#1F2937;margin:0">${escapeHtml(replyBody).replace(/\n/g, '<br/>')}</p>`;
      const html = buildEmailHtml({
        preheader: replySubject.trim(),
        title: replySubject.trim(),
        bodyHtml,
        footerNote: 'הודעה זו נשלחה אליך מצוות Car Reminder בתגובה לפנייתך',
      });
      const { error } = await supabase.functions.invoke('send-email', {
        body: {
          to: contactEmail,
          subject: replySubject.trim(),
          html,
          notification_key: 'admin_direct',
        },
      });
      if (error) throw error;
      toast.success(`התגובה נשלחה ל-${contactEmail}`);
      setReplySubject("");
      setReplyBody("");
      setReplyOpen(false);
    } catch {
      toast.error("שליחת התגובה נכשלה");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className={`p-4 ${acknowledged ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="rounded-full p-2 shrink-0" style={{ background: kindMeta.bg }}>
          <Icon className="w-5 h-5" style={{ color: kindMeta.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-bold text-gray-900 break-words">{alert.title}</h3>
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: sevMeta.bg, color: sevMeta.color }}
            >
              {sevMeta.label}
            </span>
            {alert.count > 1 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
                ×{alert.count}
              </span>
            )}
          </div>

          <p className="text-sm text-gray-700 mb-2 break-words">{alert.message}</p>

          <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
            <span>{kindMeta.label}</span>
            <span>·</span>
            <span title={format(new Date(alert.created_at), "dd/MM/yyyy HH:mm")}>
              {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: he })}
            </span>
            {alert.notified_via?.length > 0 && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  {alert.notified_via.join(", ")}
                </span>
              </>
            )}
          </div>

          {acknowledged && (
            <div className="mt-2 text-xs text-green-700 inline-flex items-center gap-1">
              <Check className="w-3 h-3" />
              טופל {formatDistanceToNow(new Date(alert.acknowledged_at), { addSuffix: true, locale: he })}
            </div>
          )}

          {/* Context expandable */}
          {alert.context && Object.keys(alert.context).length > 0 && (
            <details className="mt-3 text-xs text-gray-600">
              <summary className="cursor-pointer hover:text-gray-900 select-none">
                פרטים טכניים
              </summary>
              <pre
                className="mt-2 p-2 bg-gray-50 rounded overflow-x-auto"
                style={{ direction: "ltr" }}
              >
                {JSON.stringify(alert.context, null, 2)}
              </pre>
            </details>
          )}

          {contactEmail && replyOpen && (
            <div className="mt-3 space-y-2 p-3 rounded-xl" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <Mail className="w-3.5 h-3.5" style={{ color: '#3B82F6' }} />
                <span className="text-[11px] font-bold" style={{ color: '#1E40AF' }}>תגובה ל-{contactEmail}</span>
              </div>
              <input
                className="w-full text-xs border rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
                placeholder="נושא"
                value={replySubject}
                onChange={(e) => setReplySubject(e.target.value)}
                dir="rtl"
              />
              <textarea
                className="w-full text-xs border rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300"
                rows={3}
                placeholder="תוכן התגובה..."
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                dir="rtl"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setReplyOpen(false)}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg transition text-gray-500 hover:bg-gray-100"
                >
                  ביטול
                </button>
                <button
                  onClick={handleSendReply}
                  disabled={!replySubject.trim() || !replyBody.trim() || sending}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-40"
                  style={{ background: '#DBEAFE', color: '#1E40AF' }}
                >
                  {sending ? 'שולח...' : 'שלח תגובה'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5 shrink-0">
          {contactEmail && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReplyOpen(!replyOpen)}
              className="gap-1"
            >
              <Send className="w-4 h-4" />
              שלח מייל
            </Button>
          )}
          {!acknowledged && (
            <Button
              size="sm"
              variant="outline"
              onClick={onAcknowledge}
              disabled={isAcknowledging}
              className="gap-1"
            >
              <Check className="w-4 h-4" />
              סמן כטופל
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function EmptyState({ filterStatus, filterKind }) {
  if (filterStatus === "unack" && filterKind === "all") {
    return (
      <Card className="p-8 text-center">
        <div className="text-5xl mb-3">🎉</div>
        <p className="font-bold mb-1">אין התראות פתוחות</p>
        <p className="text-sm text-gray-600">המערכת שקטה. כל הכבוד.</p>
      </Card>
    );
  }
  if (filterKind !== "all") {
    return (
      <Card className="p-8 text-center text-gray-600">
        אין התראות בסינון זה.
      </Card>
    );
  }
  return (
    <Card className="p-8 text-center text-gray-600">
      אין התראות עדיין. כשהמערכת תזהה משהו שדורש את תשומת לבך — זה יופיע פה ובטלגרם.
    </Card>
  );
}

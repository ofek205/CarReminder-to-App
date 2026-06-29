/**
 * AdminHome — the "בית" (Today) landing for the admin area.
 *
 * Direction (pm → ux → designer): turn the admin area from "a pile of
 * dashboards you look at" into "a system that makes actions happen". This
 * screen answers ONE question: "what needs me right now, and is the product
 * healthy?". Hierarchy: the action inbox is the hero, the health strip is
 * second, product KPIs are demoted, quick actions close.
 *
 * Visual language: the editorial-ledger / console system established by
 * AdminUsers — light surface, tabular figures, restrained color. Urgency is
 * signalled by accent (amber/red) ONLY on queues that actually need action;
 * an empty queue reads green/✓, not red.
 *
 * Data:
 *   - admin_action_inbox()   RPC → one payload with every queue count + KPIs
 *   - admin_health_status()  RPC → the same probes the AdminHealth page uses
 * Both wrapped in withTimeout so the screen can never hang on a spinner; any
 * failure surfaces a "נסה שוב" retry per the Query Timeout Gate rule.
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/supabaseQuery";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import useIsAdmin from "@/hooks/useIsAdmin";
import {
  Briefcase, MessageSquare, Bell, Bug, HeartPulse, Users, Send, Search,
  AlertCircle, Check, ChevronLeft, RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { C } from "@/lib/designTokens";

//  ──────────────────────────────────────────────────────────────────────
//  Helpers
//  ──────────────────────────────────────────────────────────────────────

function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return "בוקר טוב";
  if (h < 18) return "צהריים טובים";
  return "ערב טוב";
}

// Short labels for the health strip (full descriptions live on AdminHealth).
const PROBE_LABEL = {
  db_latency:     "DB",
  error_rate_24h: "שגיאות",
  email_webhook:  "מיילים",
  pg_cron:        "cron",
  storage:        "אחסון",
  unack_alerts:   "התראות",
  gov_sync:       "משרד התחבורה",
};

const STATUS_DOT = {
  green:  C.success,
  yellow: C.warn,
  red:    C.error,
};

//  ──────────────────────────────────────────────────────────────────────
//  Main page
//  ──────────────────────────────────────────────────────────────────────

export default function AdminHome() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();

  const { data: inbox, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin-action-inbox"],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.rpc("admin_action_inbox"),
        "admin_action_inbox"
      );
      if (error) throw error;
      return data || {};
    },
    enabled: isAdmin === true,
    retry: 1,
    retryDelay: 500,
    staleTime: 60 * 1000,
  });

  // Health strip — reuses the AdminHealth probe RPC. Failure here is
  // non-fatal: the strip simply hides rather than blocking the whole home.
  const { data: probes = [] } = useQuery({
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
    staleTime: 120 * 1000,
  });

  //  Guards
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
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto" dir="rtl">
        <PageHeader title="בית" />
        <Card className="p-6 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500" />
          <p className="font-bold mb-2">לא הצלחנו לטעון את לוח הבית</p>
          <Button onClick={() => refetch()}>נסה שוב</Button>
        </Card>
      </div>
    );
  }

  //  Action queues — each tile taps through to its page, pre-scoped.
  const queues = [
    { key: "biz",   label: "בקשות עסקים",   count: inbox?.business_requests_pending ?? 0, icon: Briefcase,     to: "/AdminBusinessRequests",      tone: "amber" },
    { key: "msg",   label: "הודעות חדשות",  count: inbox?.messages_new            ?? 0, icon: MessageSquare, to: "/EmailCenter?tab=messages", tone: "amber" },
    { key: "alert", label: "התראות פתוחות", count: inbox?.alerts_unack            ?? 0, icon: Bell,          to: "/AdminAlerts",                tone: "red"   },
    { key: "bug",   label: "באגים פתוחים",  count: inbox?.bugs_open               ?? 0, icon: Bug,           to: "/AdminDashboard?tab=bugs",    tone: "yellow" },
  ];
  const totalPending = queues.reduce((s, q) => s + q.count, 0);

  const kpis = [
    { label: "סה״כ משתמשים", value: inbox?.total_users   ?? 0 },
    { label: "הרשמות היום",  value: inbox?.signups_today ?? 0 },
    { label: "הרשמות השבוע", value: inbox?.signups_7d    ?? 0 },
  ];

  const overall = probes.some(p => p.status === "red") ? "red"
    : probes.some(p => p.status === "yellow") ? "yellow" : "green";

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto" dir="rtl" style={{ fontVariantNumeric: "tabular-nums" }}>
      {/* Greeting */}
      <div className="flex items-end justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{greetingForNow()}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{format(new Date(), "EEEE · dd/MM", { locale: he })}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} className="gap-1 shrink-0" disabled={isFetching}>
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          רענן
        </Button>
      </div>

      {/* ── HERO: action inbox ──────────────────────────────────────── */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-700">דורש אותך עכשיו</h2>
          {totalPending > 0 && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: C.errorBg, color: C.error }} dir="ltr">
              {totalPending}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {queues.map((q) => (
            <ActionTile key={q.key} queue={q} onClick={() => navigate(q.to)} />
          ))}
        </div>

        {totalPending === 0 && (
          <div className="flex items-center justify-center gap-2 mt-3 py-2 rounded-xl" style={{ background: C.successBg }}>
            <Check className="w-4 h-4" style={{ color: C.success }} />
            <span className="text-sm font-medium" style={{ color: C.success }}>אין משימות פתוחות, הכל מטופל</span>
          </div>
        )}
      </section>

      {/* ── Health strip ────────────────────────────────────────────── */}
      {probes.length > 0 && (
        <button
          type="button"
          onClick={() => navigate("/AdminHealth")}
          className="w-full mb-6 rounded-2xl p-3 flex items-center gap-3 text-right transition hover:bg-gray-50"
          style={{ border: `1px solid ${C.border}` }}
        >
          <div className="rounded-full p-1.5 shrink-0" style={{ background: `${STATUS_DOT[overall]}1A` }}>
            <HeartPulse className="w-4 h-4" style={{ color: STATUS_DOT[overall] }} />
          </div>
          <span className="text-[13px] font-bold text-gray-700 shrink-0">בריאות מערכת</span>
          <div className="flex items-center gap-2.5 flex-wrap flex-1 min-w-0">
            {probes.map((p) => (
              <span key={p.probe} className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_DOT[p.status] || C.muted }} />
                {PROBE_LABEL[p.probe] || p.probe}
              </span>
            ))}
          </div>
          <ChevronLeft className="w-4 h-4 text-gray-300 shrink-0" />
        </button>
      )}

      {/* ── Product KPIs (demoted) ──────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="text-sm font-bold text-gray-700 mb-2">המוצר היום</h2>
        <div className="grid grid-cols-3 gap-2.5">
          {kpis.map((k) => (
            <Card key={k.label} className="p-3 text-center">
              <div className="text-2xl font-bold text-gray-900" dir="ltr">{k.value}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{k.label}</div>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Quick actions ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-bold text-gray-700 mb-2">פעולות מהירות</h2>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={() => navigate("/EmailCenter")}>
            <Send className="w-4 h-4" /> שלח ברודקאסט
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => navigate("/AdminUsers")}>
            <Search className="w-4 h-4" /> חפש משתמש
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => navigate("/AdminAnalytics")}>
            <Users className="w-4 h-4" /> אנליטיקה
          </Button>
        </div>
      </section>
    </div>
  );
}

//  ──────────────────────────────────────────────────────────────────────
//  Action tile — count>0 reads in its urgency tone; count===0 reads green ✓
//  ──────────────────────────────────────────────────────────────────────

function ActionTile({ queue, onClick }) {
  const Icon = queue.icon;
  const active = queue.count > 0;
  const tones = {
    amber:  { color: C.warn,  bg: C.warnBg },
    red:    { color: C.error, bg: C.errorBg },
    yellow: { color: C.warn,  bg: C.warnBg },
  };
  const t = tones[queue.tone] || tones.amber;

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl p-3 text-right transition active:scale-[0.98] hover:shadow-sm"
      style={{
        background: active ? t.bg : "#FFFFFF",
        border: `1px solid ${active ? t.color : C.border}`,
      }}
      aria-label={`${queue.label}: ${queue.count}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <Icon className="w-4 h-4" style={{ color: active ? t.color : C.muted }} />
        {active ? (
          <span className="text-2xl font-bold leading-none" style={{ color: t.color }} dir="ltr">{queue.count}</span>
        ) : (
          <Check className="w-5 h-5" style={{ color: C.success }} />
        )}
      </div>
      <p className="text-[12px] font-medium" style={{ color: active ? C.text || "#1f2937" : C.muted }}>
        {queue.label}
      </p>
    </button>
  );
}

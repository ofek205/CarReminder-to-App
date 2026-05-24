import React, { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/supabaseQuery";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Search,
  AlertCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Trash2,
  UserCog,
  CheckCircle,
  Shield,
  Activity,
  Download,
} from "lucide-react";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { he } from "date-fns/locale";
import { C } from "@/lib/designTokens";

const PAGE_SIZE = 50;

const ACTION_META = {
  delete_account:    { label: "מחיקת חשבון",   icon: Trash2,      color: C.error,   bg: C.errorBg   },
  set_role:          { label: "שינוי הרשאה",   icon: UserCog,     color: C.warn,    bg: C.warnBg    },
  acknowledge_alert: { label: "סימון התראה",   icon: CheckCircle, color: C.success, bg: C.successBg },
};

const FALLBACK_META = { label: "פעולה",  icon: Activity,  color: C.muted, bg: "#F3F4F6" };

function escCsv(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

function exportAuditLogCsv(rows) {
  const headers = ["פעולה", "מבצע", "סוג יעד", "מזהה יעד", "פרטים", "תאריך"];
  const dataRows = rows.map((r) => {
    const meta = ACTION_META[r.action] || FALLBACK_META;
    const detailStr = r.detail && Object.keys(r.detail).length > 0
      ? Object.entries(r.detail).map(([k, v]) => `${k}: ${v}`).join("; ")
      : "";
    return [
      meta.label || r.action,
      r.actor_email || "",
      r.target_type || "",
      r.target_id || "",
      detailStr,
      r.created_at ? format(parseISO(r.created_at), "dd/MM/yyyy HH:mm:ss") : "",
    ];
  });
  const lines = [headers.join(","), ...dataRows.map((row) => row.map(escCsv).join(","))];
  const csv = "﻿" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `audit-log-${format(new Date(), "yyyy-MM-dd")}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AdminAuditLog() {
  const isAdmin = useIsAdmin();

  const [searchActor, setSearchActor] = useState("");
  const [filterAction, setFilterAction] = useState("all");
  const [page, setPage] = useState(1);

  const debouncedActor = useDebounced(searchActor, 300);

  const rpcAction = filterAction === "all" ? null : filterAction;
  const rpcActor  = debouncedActor.trim() || null;
  const offset    = (page - 1) * PAGE_SIZE;

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin-audit-log", rpcAction, rpcActor, offset],
    queryFn: async () => {
      const { data: rows, error } = await withTimeout(
        supabase.rpc("admin_audit_log_list", {
          p_limit:  PAGE_SIZE,
          p_offset: offset,
          p_action: rpcAction,
          p_actor:  rpcActor,
        }),
        "admin_audit_log_list"
      );
      if (error) throw error;
      return rows || [];
    },
    enabled: isAdmin === true,
    retry: 1,
    retryDelay: 500,
    staleTime: 30 * 1000,
    keepPreviousData: true,
  });

  const rows = data || [];
  const totalCount = rows[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => { setPage(1); }, [debouncedActor, filterAction]);

  const distinctActions = useMemo(() => {
    return Object.keys(ACTION_META);
  }, []);

  if (isAdmin === false) {
    return <div className="p-6 text-center" dir="rtl"><p className="text-gray-600">אזור זה זמין למנהלי מערכת בלבד.</p></div>;
  }
  if (isAdmin === null || isLoading) {
    return <div className="flex justify-center py-16"><LoadingSpinner /></div>;
  }
  if (isError) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto" dir="rtl">
        <PageHeader title="יומן פעולות" />
        <Card className="p-6 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500" />
          <p className="font-bold mb-2">לא הצלחנו לטעון את היומן</p>
          <Button onClick={() => refetch()}>נסה שוב</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto" dir="rtl" style={{ fontVariantNumeric: "tabular-nums" }}>
      <PageHeader
        title="יומן פעולות"
        subtitle="כל פעולה שביצע מנהל מערכת — מתועדת ובלתי ניתנת למחיקה."
      />

      {/* Toolbar */}
      <Card className="p-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="חיפוש לפי אימייל מבצע"
              value={searchActor}
              onChange={(e) => setSearchActor(e.target.value)}
              className="pr-9"
            />
          </div>

          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הפעולות</SelectItem>
              {distinctActions.map((k) => (
                <SelectItem key={k} value={k}>{ACTION_META[k]?.label || k}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {rows.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => exportAuditLogCsv(rows)} className="shrink-0 gap-1">
              <Download className="w-3.5 h-3.5" />
              CSV
            </Button>
          )}

          <Button size="sm" variant="outline" onClick={() => refetch()} className="shrink-0 gap-1" disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            רענן
          </Button>
        </div>

        <div className="mt-2 text-xs text-gray-500">
          {totalCount > 0
            ? <>מציג <span dir="ltr">{rows.length}</span> מתוך <span dir="ltr">{totalCount}</span> רשומות</>
            : "אין רשומות ביומן"}
        </div>
      </Card>

      {/* Timeline */}
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-gray-600">
          <Shield className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p>אין פעולות ביומן{filterAction !== "all" || rpcActor ? " בסינון זה" : " עדיין"}.</p>
          <p className="text-xs text-gray-400 mt-1">כשתבצע פעולת ניהול — היא תופיע כאן אוטומטית.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <span className="text-sm text-gray-600">
            עמ׳ <span dir="ltr">{page}</span> / <span dir="ltr">{totalPages}</span>
          </span>
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function AuditRow({ row }) {
  const meta = ACTION_META[row.action] || { ...FALLBACK_META, label: row.action };
  const Icon = meta.icon;
  const detail = row.detail || {};
  const detailKeys = Object.keys(detail);

  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        <div className="rounded-full p-2 shrink-0 mt-0.5" style={{ background: meta.bg }}>
          <Icon className="w-4 h-4" style={{ color: meta.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-bold text-sm text-gray-900">{meta.label}</span>
            {row.target_type && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                {row.target_type}
              </span>
            )}
          </div>

          <p className="text-xs text-gray-600 mb-1 truncate" title={row.actor_email}>
            {row.actor_email || "—"}
          </p>

          {detailKeys.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 mb-1">
              {detailKeys.map((k) => (
                <span key={k}>
                  <span className="text-gray-400">{k}:</span>{" "}
                  <span className="text-gray-700">{String(detail[k])}</span>
                </span>
              ))}
            </div>
          )}

          <div className="text-[11px] text-gray-400" dir="ltr">
            <span title={format(parseISO(row.created_at), "dd/MM/yyyy HH:mm:ss")}>
              {formatDistanceToNow(parseISO(row.created_at), { addSuffix: true, locale: he })}
            </span>
            {row.target_id && (
              <span className="text-gray-300 mx-1">·</span>
            )}
            {row.target_id && (
              <span className="text-gray-400 font-mono text-[10px]" title={row.target_id}>
                {row.target_id.slice(0, 8)}…
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

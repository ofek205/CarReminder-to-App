import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/supabaseQuery";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import useIsAdmin from "@/hooks/useIsAdmin";
import { toast } from "sonner";
import { AlertCircle, RefreshCw, Shield, Briefcase, User as UserIcon, X, Clock } from "lucide-react";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { he } from "date-fns/locale";
import { C } from "@/lib/designTokens";

function fmtRemaining(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "פג";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AdminViewSessions() {
  const isAdmin = useIsAdmin();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin-view-sessions"],
    queryFn: async () => {
      const { data: rows, error } = await withTimeout(
        supabase.rpc("admin_list_view_sessions", { p_limit: 100 }),
        "admin_list_view_sessions"
      );
      if (error) throw error;
      return rows || [];
    },
    enabled: isAdmin === true,
    retry: 1,
    retryDelay: 500,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000, // keep "active" state + countdowns fresh
  });

  const rows = data || [];
  // Active sessions first, then the RPC's started_at-desc order.
  const sorted = [...rows].sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0));
  const activeCount = rows.filter((r) => r.is_active).length;

  if (isAdmin === false) {
    return <div className="p-6 text-center" dir="rtl"><p className="text-gray-600">אזור זה זמין למנהלי מערכת בלבד.</p></div>;
  }
  if (isAdmin === null || isLoading) {
    return <div className="flex justify-center py-16"><LoadingSpinner /></div>;
  }
  if (isError) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto" dir="rtl">
        <PageHeader title="ניהול צפייה בחשבונות" />
        <Card className="p-6 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500" />
          <p className="font-bold mb-2">לא הצלחנו לטעון את רשימת הצפיות</p>
          <Button onClick={() => refetch()}>נסה שוב</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto" dir="rtl" style={{ fontVariantNumeric: "tabular-nums" }}>
      <PageHeader
        title="ניהול צפייה בחשבונות"
        subtitle="מי נכנס לצפות בחשבון של משתמש, מתי, והאם הצפייה עדיין פעילה. כל גישה מתועדת."
      />

      <Card className="p-3 mb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-gray-500">
            {activeCount > 0
              ? <><span dir="ltr">{activeCount}</span> צפיות פעילות כעת · <span dir="ltr">{rows.length}</span> בסך הכל</>
              : <>אין צפיות פעילות · <span dir="ltr">{rows.length}</span> בהיסטוריה</>}
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} className="shrink-0 gap-1" disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            רענן
          </Button>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-gray-600">
          <Shield className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p>עדיין לא נכנסת לאף חשבון.</p>
          <p className="text-xs text-gray-400 mt-1">כשתלחץ "צפה בחשבון" ב-CRM — הצפייה תופיע כאן.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {sorted.map((row) => <SessionRow key={row.id} row={row} onChanged={refetch} />)}
        </div>
      )}
    </div>
  );
}

function SessionRow({ row, onChanged }) {
  const [confirming, setConfirming] = useState(false);
  const [ending, setEnding] = useState(false);
  const isBiz = row.target_type === "business";
  const Icon = isBiz ? Briefcase : UserIcon;

  const handleEnd = async () => {
    setEnding(true);
    try {
      const { error } = await supabase.rpc("admin_force_end_view", { p_session_id: row.id });
      if (error) throw error;
      toast.success("הצפייה הסתיימה");
      onChanged?.();
    } catch (e) {
      toast.error("שגיאה בסיום הצפייה", { description: e?.message });
      setEnding(false);
      setConfirming(false);
    }
  };

  return (
    <Card className="p-3" style={row.is_active ? { borderColor: C.orange } : undefined}>
      <div className="flex items-start gap-3">
        <div className="rounded-full p-2 shrink-0 mt-0.5" style={{ background: row.is_active ? C.orangeBg : C.gray100 }}>
          <Icon className="w-4 h-4" style={{ color: row.is_active ? C.orange : C.muted }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-bold text-sm text-gray-900 truncate">{row.target_name || "—"}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{isBiz ? "עסקי" : "פרטי"}</span>
            {row.is_active
              ? <span className="text-[11px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: C.orangeBg, color: C.orange }}>פעיל</span>
              : <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400">הסתיים</span>}
          </div>

          <p className="text-xs text-gray-600 mb-0.5 truncate" title={row.target_owner_email}>בעל החשבון: {row.target_owner_email || "—"}</p>
          <p className="text-xs text-gray-500 mb-1 truncate">צפה: {row.admin_email || "—"}{row.reason ? ` · ${row.reason}` : ""}</p>

          <div className="text-[11px] text-gray-400" dir="ltr">
            {row.is_active ? (
              <span style={{ color: C.orange }}><Clock className="w-3 h-3 inline -mt-0.5" /> {fmtRemaining(row.expires_at)}</span>
            ) : (
              row.ended_at && (
                <span title={format(parseISO(row.ended_at), "dd/MM/yyyy HH:mm")}>
                  הסתיים {formatDistanceToNow(parseISO(row.ended_at), { addSuffix: true, locale: he })}
                </span>
              )
            )}
            <span className="text-gray-300 mx-1">·</span>
            <span title={format(parseISO(row.started_at), "dd/MM/yyyy HH:mm:ss")}>
              {formatDistanceToNow(parseISO(row.started_at), { addSuffix: true, locale: he })}
            </span>
          </div>
        </div>

        {row.is_active && (
          <div className="shrink-0">
            {confirming ? (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="destructive" onClick={handleEnd} disabled={ending}>{ending ? "..." : "סיים"}</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={ending}>ביטול</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setConfirming(true)}>
                <X className="w-3.5 h-3.5" /> סיים צפייה
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

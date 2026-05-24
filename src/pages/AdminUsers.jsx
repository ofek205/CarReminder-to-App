/**
 * AdminUsers — Stream 4 page. The system's "book of record" for users.
 *
 * Direction (from designer review): editorial-ledger. Tabular figures,
 * hairline rules, restrained color. Different feel from AdminAlerts
 * (which is operational) — this is analytical/investigative.
 *
 * Direction (from ux review): land on the most actionable view (active
 * users in last 7d isn't the default — the FULL list is, sorted by
 * recent signup). Search debounce 300ms, mobile = stacked cards, status
 * pill needs tooltip because "active" definition is non-obvious.
 *
 * Backed by:
 *   - public.admin_user_list() RPC  → one row per auth.users entry
 *   - public.is_admin() gate
 *
 * Drills into existing AdminUserDrawer (account-centric). Users without
 * an owned account get a disabled drill-in (edge case: drivers-only).
 */
import React, { useState, useMemo, useEffect, useCallback } from "react";
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
import AdminUserDrawer from "../components/admin/AdminUserDrawer";
import useIsAdmin from "@/hooks/useIsAdmin";
import {
  Search,
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  AlertCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format, parseISO, differenceInYears } from "date-fns";
import { he } from "date-fns/locale";
import { C } from "@/lib/designTokens";
import { toast } from "sonner";

//  ──────────────────────────────────────────────────────────────────────
//  Constants
//  ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// Activity thresholds (must match supabase-admin-user-list.sql):
//   active_7d  : last sign-in within 7 days
//   active_30d : last sign-in 8-30 days ago
//   inactive   : last sign-in 31-90 days ago (didn't visit in the last month)
//   dormant    : last sign-in over 90 days ago (truly inactive)
//   never      : last_sign_in_at is null
const STATUS_META = {
  active_7d:  { label: "פעיל",         color: C.success, bg: C.successBg },
  active_30d: { label: "פעיל בחודש",   color: C.primary, bg: C.light    },
  inactive:   { label: "לא פעיל",      color: C.warn,    bg: C.warnBg   },
  dormant:    { label: "דורם",         color: C.error,   bg: C.errorBg  },
  never:      { label: "לא חיבר",      color: C.muted,   bg: "#F3F4F6"  },
};

const STATUS_OPTIONS = [
  { value: "all",        label: "כל הסטטוסים" },
  { value: "active_7d",  label: "פעילים (7י׳)"          },
  { value: "active_30d", label: "פעילים בחודש"           },
  { value: "inactive",   label: "לא פעילים (חודש-3 ח׳)" },
  { value: "dormant",    label: "דורמים (3 ח׳+)"        },
  { value: "never",      label: "לא התחברו"              },
];

const ASSET_OPTIONS = [
  { value: "all",          label: "כל הנכסים"          },
  { value: "has_vehicles", label: "עם כלי תחבורה"       },
  { value: "no_vehicles",  label: "ללא כלי תחבורה"       },
  { value: "shared_only",  label: "שותפים בלבד"         },
];

const SIGNUP_OPTIONS = [
  { value: "all",  label: "כל התאריכים"  },
  { value: "1d",   label: "מהיום"        },
  { value: "7d",   label: "שבוע אחרון"   },
  { value: "30d",  label: "חודש אחרון"   },
  { value: "90d",  label: "3 חודשים"     },
];

//  ──────────────────────────────────────────────────────────────────────
//  Helpers
//  ──────────────────────────────────────────────────────────────────────

const fmtDate = (d) => (d ? format(parseISO(d), "dd/MM/yy", { locale: he }) : "—");

const calcAge = (birth) => {
  if (!birth) return null;
  try { return differenceInYears(new Date(), parseISO(birth)); }
  catch { return null; }
};

const initials = (name, email) => {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const hueFromName = (name) => {
  if (!name) return 120;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return h % 360;
};

// CSV helper. UTF-8 BOM so Excel opens it correctly with Hebrew.
function escCsv(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}
function downloadCsv(headers, dataRows, filename) {
  const lines = [
    headers.join(","),
    ...dataRows.map((row) => row.map(escCsv).join(",")),
  ];
  const csv = "﻿" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportUsersCsv(rows) {
  const headers = [
    "שם", "אימייל", "טלפון", "גיל", "תאריך לידה",
    "כלי תחבורה (בעלות)", "כלי תחבורה (משותפים)",
    "מסמכים", "חברים",
    "חשבון עסקי", "נהג",
    "סטטוס", "תאריך הרשמה", "התחברות אחרונה", "ימים מהרשמה",
  ];
  const dataRows = rows.map((u) => [
    u.full_name, u.email, u.phone,
    calcAge(u.birth_date) ?? "",
    u.birth_date ? format(parseISO(u.birth_date), "dd/MM/yyyy") : "",
    u.vehicles_owned ?? 0, u.vehicles_shared ?? 0,
    u.documents_total ?? 0, u.members_total ?? 0,
    u.has_business ? "כן" : "לא",
    u.is_driver ? "כן" : "לא",
    STATUS_META[u.activity_status]?.label || u.activity_status || "",
    u.signup_at ? format(parseISO(u.signup_at), "dd/MM/yyyy") : "",
    u.last_sign_in_at ? format(parseISO(u.last_sign_in_at), "dd/MM/yyyy HH:mm") : "",
    u.days_since_signup ?? "",
  ]);
  downloadCsv(headers, dataRows, `users-export-${format(new Date(), "yyyy-MM-dd")}.csv`);
}

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

//  ──────────────────────────────────────────────────────────────────────
//  Main page
//  ──────────────────────────────────────────────────────────────────────

export default function AdminUsers() {
  const isAdmin = useIsAdmin();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);

  const [filterStatus, setFilterStatus] = useState("all");
  const [filterAsset,  setFilterAsset]  = useState("all");
  const [filterSignup, setFilterSignup] = useState("all");

  const [sortKey, setSortKey] = useState("signup_at");
  const [sortDir, setSortDir] = useState("desc");

  const [page, setPage] = useState(1);

  const [drawerAccount, setDrawerAccount] = useState(null);

  const { data: users = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin-user-list"],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.rpc("admin_user_list"),
        "admin_user_list"
      );
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin === true,
    retry: 1,
    retryDelay: 500,
    staleTime: 60 * 1000,
  });

  const { data: guestStats } = useQuery({
    queryKey: ["admin-guest-stats"],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await withTimeout(
        supabase
          .from("anonymous_analytics")
          .select("event, count")
          .in("event", ["guest_session", "auth_signup"])
          .gte("date", cutoff),
        "guest_stats"
      );
      if (error) throw error;
      const rows = data || [];
      const guests  = rows.filter((r) => r.event === "guest_session").reduce((s, r) => s + (r.count || 0), 0);
      const signups = rows.filter((r) => r.event === "auth_signup").reduce((s, r) => s + (r.count || 0), 0);
      return { guests, signups, rate: guests > 0 ? Math.round((signups / guests) * 100) : 0 };
    },
    enabled: isAdmin === true,
    staleTime: 120_000,
  });

  //  Filter pipeline
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const now = Date.now();
    const day = 86_400_000;
    const signupCutoff = {
      "1d": now - 1   * day,
      "7d": now - 7   * day,
      "30d": now - 30 * day,
      "90d": now - 90 * day,
    }[filterSignup];

    // Normalize search query: strip dashes/spaces for phone matching.
    const qNorm = q.replace(/[\s-]/g, "");
    return users.filter((u) => {
      if (q) {
        const phoneNorm = (u.phone || "").replace(/[\s-]/g, "");
        const haystack = `${u.full_name || ""} ${u.email || ""} ${u.phone || ""} ${phoneNorm}`.toLowerCase();
        if (!haystack.includes(q) && !haystack.includes(qNorm)) return false;
      }
      if (filterStatus !== "all" && u.activity_status !== filterStatus) return false;

      if (filterAsset === "has_vehicles" && (u.vehicles_owned + u.vehicles_shared) === 0) return false;
      if (filterAsset === "no_vehicles"  && (u.vehicles_owned + u.vehicles_shared) > 0) return false;
      if (filterAsset === "shared_only"  && (u.vehicles_owned > 0 || u.vehicles_shared === 0)) return false;

      if (signupCutoff && new Date(u.signup_at).getTime() < signupCutoff) return false;

      return true;
    });
  }, [users, debouncedSearch, filterStatus, filterAsset, filterSignup]);

  //  Sort
  const sorted = useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number") return sortDir === "asc" ? av - bv : bv - av;
      const cmp = String(av).localeCompare(String(bv), "he");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [filtered, sortKey, sortDir]);

  //  Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  //  Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [debouncedSearch, filterStatus, filterAsset, filterSignup]);

  const toggleSort = useCallback((key) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }, [sortKey]);

  const clearFilters = () => {
    setSearch(""); setFilterStatus("all"); setFilterAsset("all"); setFilterSignup("all");
  };

  const handleRowClick = (user) => {
    if (!user.primary_account_id) return; // disabled — driver-only user
    setDrawerAccount({ id: user.primary_account_id, name: user.primary_account_name || user.full_name });
  };

  const handleExport = () => {
    exportUsersCsv(sorted);
    toast.success(`יוצא ${sorted.length} משתמשים ל-CSV`);
  };

  //  Guards
  if (isAdmin === false) {
    return <div className="p-6 text-center" dir="rtl"><p className="text-gray-600">אזור זה זמין למנהלי מערכת בלבד.</p></div>;
  }
  if (isAdmin === null || isLoading) {
    return <div className="flex justify-center py-16"><LoadingSpinner /></div>;
  }
  if (isError) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
        <PageHeader title="ניהול משתמשים" />
        <Card className="p-6 text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500" />
          <p className="font-bold mb-2">לא הצלחנו לטעון את רשימת המשתמשים</p>
          <Button onClick={() => refetch()}>נסה שוב</Button>
        </Card>
      </div>
    );
  }

  //  Stats
  const stats = {
    total:      users.length,
    active_7d:  users.filter((u) => u.activity_status === "active_7d").length,
    inactive:   users.filter((u) => u.activity_status === "inactive").length,
    dormant:    users.filter((u) => u.activity_status === "dormant").length,
    never:      users.filter((u) => u.activity_status === "never").length,
    unverified: users.filter((u) => u.email && !u.email_confirmed_at).length,
  };

  return (
    <div
      className="p-3 sm:p-6 max-w-7xl mx-auto"
      dir="rtl"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <PageHeader title="ניהול משתמשים" subtitle="כל החשבונות הרשומים במערכת" />

      {/* Guest conversion banner */}
      {guestStats && guestStats.guests > 0 && (
        <Card className="p-3 mb-3 flex items-center justify-between flex-wrap gap-2" style={{ borderRight: `3px solid ${C.warn}`, background: C.warnBg }}>
          <div className="text-xs text-gray-700">
            <span className="font-bold" style={{ color: C.warn }}>ביקורי אורחים (30 ימים):</span>{" "}
            <span dir="ltr" className="font-bold">{guestStats.guests}</span> ביקורים →{" "}
            <span dir="ltr" className="font-bold">{guestStats.signups}</span> הרשמות
          </div>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FFF", color: C.warn }}>
            המרה <span dir="ltr">{guestStats.rate}%</span>
          </span>
        </Card>
      )}

      {/* Hero — total count + supporting stats. The "184" is the headline. */}
      <div className="mb-5 grid grid-cols-2 sm:grid-cols-6 gap-2">
        <HeroPill label="סה״כ"        value={stats.total}      isHero />
        <SubPill  label="פעילים (7י׳)" value={stats.active_7d} tone="green" />
        <SubPill  label="לא פעילים"    value={stats.inactive}   tone="amber" />
        <SubPill  label="דורמים"       value={stats.dormant}    tone="amber" />
        <SubPill  label="לא התחברו"    value={stats.never}      tone="gray" />
        <SubPill  label="לא אומתו"     value={stats.unverified} tone="amber" />
      </div>

      {/* Toolbar */}
      <Card className="p-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="חיפוש שם / אימייל / טלפון"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterAsset} onValueChange={setFilterAsset}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASSET_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSignup} onValueChange={setFilterSignup}>
            <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SIGNUP_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={clearFilters} className="shrink-0">נקה</Button>
          <Button size="sm" variant="outline" onClick={() => refetch()} className="shrink-0 gap-1" disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            רענן
          </Button>
          <Button size="sm" onClick={handleExport} className="shrink-0 gap-1">
            <Download className="w-3.5 h-3.5" />
            CSV
          </Button>
        </div>

        {/* Result count line */}
        <div className="mt-2 text-xs text-gray-500" dir="rtl">
          מציג <span dir="ltr">{paged.length}</span> מתוך <span dir="ltr">{sorted.length}</span>
          {sorted.length !== users.length && <> (מסונן מ-<span dir="ltr">{users.length}</span>)</>}
        </div>
      </Card>

      {/* Desktop table */}
      <div className="hidden md:block">
        <UsersTable
          users={paged}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
          onRowClick={handleRowClick}
        />
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {paged.length === 0 ? (
          <EmptyState />
        ) : (
          paged.map((u) => <UserCardMobile key={u.user_id} user={u} onClick={() => handleRowClick(u)} />)
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <span className="text-sm text-gray-600">
            עמ׳ <span dir="ltr">{safePage}</span> / <span dir="ltr">{totalPages}</span>
          </span>
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Drawer */}
      <AdminUserDrawer
        account={drawerAccount}
        onClose={() => setDrawerAccount(null)}
        onAccountDeleted={() => { setDrawerAccount(null); refetch(); }}
      />
    </div>
  );
}

//  ──────────────────────────────────────────────────────────────────────
//  Stat pills — hero + supporting
//  ──────────────────────────────────────────────────────────────────────

function HeroPill({ label, value, isHero }) {
  return (
    <Card className="col-span-2 sm:col-span-1 p-3 text-center" style={{ borderColor: C.primary, borderWidth: 1.5 }}>
      <div className="text-4xl font-bold" style={{ color: C.primary }} dir="ltr">{value}</div>
      <div className="text-xs text-gray-600 mt-0.5">{label}</div>
    </Card>
  );
}

function SubPill({ label, value, tone }) {
  const tones = {
    green: { bg: C.successBg, color: C.success },
    amber: { bg: C.warnBg,    color: C.warn    },
    gray:  { bg: "#F3F4F6",   color: C.muted   },
  };
  const t = tones[tone] || tones.gray;
  return (
    <div className="rounded-xl p-3 text-center" style={{ background: t.bg }}>
      <div className="text-2xl font-bold" style={{ color: t.color }} dir="ltr">{value}</div>
      <div className="text-[11px] text-gray-600 mt-0.5">{label}</div>
    </div>
  );
}

//  ──────────────────────────────────────────────────────────────────────
//  Desktop table
//  ──────────────────────────────────────────────────────────────────────

function UsersTable({ users, sortKey, sortDir, onSort, onRowClick }) {
  if (users.length === 0) return <EmptyState />;

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: C.border, background: "#FAFAF9" }}>
            <Th name="full_name"      label="שם"         sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <Th name="email"          label="אימייל"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <Th name="phone"          label="טלפון"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <Th name="birth_date"     label="גיל"        sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left" />
            <Th name="vehicles_owned" label="כלי תחבורה" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left"
                tooltip="בעלות / משותף" />
            <Th name="documents_total"label="מסמכים"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left" />
            <Th name="members_total"  label="חברים"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left" />
            <th className="py-2 px-2 font-medium text-gray-600 text-xs text-right whitespace-nowrap">תגים</th>
            <Th name="activity_status"label="סטטוס"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <Th name="signup_at"      label="הרשמה"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left" />
            <Th name="last_sign_in_at" label="אחרון"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left" />
            <th className="text-right py-2 px-2 font-medium text-gray-500 text-xs"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => <UserRowDesktop key={u.user_id} user={u} onClick={() => onRowClick(u)} />)}
        </tbody>
      </table>
    </Card>
  );
}

function Th({ name, label, sortKey, sortDir, onSort, align = "right", tooltip }) {
  const active = sortKey === name;
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      className={`py-2 px-2 font-medium text-gray-600 text-xs cursor-pointer select-none whitespace-nowrap ${align === "left" ? "text-left" : "text-right"}`}
      onClick={() => onSort(name)}
      title={tooltip}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <Icon className={`w-3 h-3 ${active ? "text-gray-700" : "text-gray-300"}`} />
      </span>
    </th>
  );
}

function UserRowDesktop({ user, onClick }) {
  const age = calcAge(user.birth_date);
  const clickable = !!user.primary_account_id;
  return (
    <tr
      className={`border-b transition-colors ${clickable ? "cursor-pointer hover:bg-gray-50" : "opacity-60"}`}
      style={{ borderColor: C.border }}
      onClick={onClick}
    >
      <td className="py-2 px-2">
        <div className="flex items-center gap-2">
          <Avatar name={user.full_name || user.email} size={28} />
          <span className="font-medium text-gray-900">{user.full_name || <span className="text-gray-400">—</span>}</span>
        </div>
      </td>
      <td className="py-2 px-2 text-gray-700 max-w-[200px] truncate" title={user.email}>{user.email}</td>
      <td className="py-2 px-2 text-gray-700" dir="ltr">{user.phone || <span className="text-gray-400">—</span>}</td>
      <td className="py-2 px-2 text-left text-gray-700" dir="ltr">{age ?? <span className="text-gray-400">—</span>}</td>
      <td className="py-2 px-2 text-left text-gray-700" dir="ltr">
        {user.vehicles_owned}{user.vehicles_shared > 0 && <span className="text-gray-400"> / {user.vehicles_shared}</span>}
      </td>
      <td className="py-2 px-2 text-left text-gray-700" dir="ltr">{user.documents_total}</td>
      <td className="py-2 px-2 text-left text-gray-700" dir="ltr">{user.members_total}</td>
      <td className="py-2 px-2">
        <div className="flex gap-1 flex-wrap">
          {user.has_business && <TagBadge label="עסקי" tone="purple" />}
          {user.is_driver && <TagBadge label="נהג" tone="teal" />}
          {!user.has_business && !user.is_driver && <span className="text-gray-300 text-[10px]">—</span>}
        </div>
      </td>
      <td className="py-2 px-2"><StatusPill status={user.activity_status} /></td>
      <td className="py-2 px-2 text-left text-gray-500 text-xs" dir="ltr">{fmtDate(user.signup_at)}</td>
      <td className="py-2 px-2 text-left text-gray-500 text-xs" dir="ltr">{fmtDate(user.last_sign_in_at)}</td>
      <td className="py-2 px-2 text-left">
        {clickable ? (
          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="text-[11px] font-medium px-2 py-1 rounded-lg transition hover:opacity-80"
            style={{ background: C.light, color: C.primary }}
          >
            <Eye className="w-3 h-3 inline ml-1" />
            הצג
          </button>
        ) : (
          <span className="text-[10px] text-gray-400">אין חשבון</span>
        )}
      </td>
    </tr>
  );
}

//  ──────────────────────────────────────────────────────────────────────
//  Mobile card
//  ──────────────────────────────────────────────────────────────────────

function UserCardMobile({ user, onClick }) {
  const age = calcAge(user.birth_date);
  const clickable = !!user.primary_account_id;
  return (
    <Card
      className={`p-3 ${clickable ? "active:bg-gray-50" : "opacity-60"}`}
      onClick={clickable ? onClick : undefined}
    >
      <div className="flex items-start gap-3">
        <Avatar name={user.full_name || user.email} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <h3 className="font-bold text-gray-900 truncate">
              {user.full_name || <span className="text-gray-400 font-normal">ללא שם</span>}
            </h3>
            <StatusPill status={user.activity_status} compact />
          </div>
          <p className="text-xs text-gray-600 truncate" title={user.email}>{user.email}</p>
          <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500" dir="rtl">
            {user.phone && <span dir="ltr">{user.phone}</span>}
            {age !== null && <span>גיל <span dir="ltr">{age}</span></span>}
            <span>כלי תחבורה <span dir="ltr">{user.vehicles_owned}{user.vehicles_shared > 0 && ` / ${user.vehicles_shared}`}</span></span>
            <span>מסמכים <span dir="ltr">{user.documents_total}</span></span>
          </div>
          {(user.has_business || user.is_driver) && (
            <div className="flex gap-1 mt-1.5">
              {user.has_business && <TagBadge label="עסקי" tone="purple" />}
              {user.is_driver && <TagBadge label="נהג" tone="teal" />}
            </div>
          )}
          <div className="text-[10px] text-gray-400 mt-1" dir="ltr">{fmtDate(user.signup_at)}</div>
        </div>
      </div>
    </Card>
  );
}

//  ──────────────────────────────────────────────────────────────────────
//  Misc atoms
//  ──────────────────────────────────────────────────────────────────────

function StatusPill({ status, compact }) {
  const meta = STATUS_META[status] || STATUS_META.dormant;
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${compact ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-0.5"}`}
      style={{ background: meta.bg, color: meta.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full ml-1" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

function TagBadge({ label, tone }) {
  const tones = {
    purple: { bg: "#F3E8FF", color: "#7C3AED" },
    teal:   { bg: "#E0F7FA", color: "#0891B2" },
  };
  const t = tones[tone] || tones.purple;
  return (
    <span
      className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full"
      style={{ background: t.bg, color: t.color }}
    >
      {label}
    </span>
  );
}

function Avatar({ name, size = 32 }) {
  const hue = hueFromName(name);
  return (
    <div
      className="flex items-center justify-center rounded-full font-bold text-white shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hue}, 55%, 45%), hsl(${(hue + 30) % 360}, 55%, 35%))`,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="p-8 text-center text-gray-600">
      <p>אין משתמשים בסינון זה. נסה לנקות פילטרים או לשנות חיפוש.</p>
    </Card>
  );
}

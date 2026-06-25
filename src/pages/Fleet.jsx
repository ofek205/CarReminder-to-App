/**
 * Phase 9, Step 4 — Fleet vehicles page (manager-only).
 *
 * Dedicated business view of every vehicle in the workspace, designed
 * to scale to dozens or hundreds of rows. Replaces the personal
 * /Vehicles card grid for managers who need to find a specific vehicle
 * fast and triage urgent items.
 *
 * Features:
 *   - Search: license plate / nickname / manufacturer / model
 *   - Status chips: overdue / soon / ok / unassigned (with counts)
 *   - Filters: driver, vehicle type
 *   - Sort: urgency (default), license plate, nickname, year, recent
 *   - Pagination: 25 rows per page (client-side)
 *   - Quick actions per row: open details, assigned driver name
 *
 * The personal /Vehicles page is unaffected and still listed for
 * personal users.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search, Plus, ChevronLeft, Truck, Briefcase, X, Upload,
  Trash2, CheckSquare, Square, Loader2, ListChecks, SlidersHorizontal, ArrowUpDown,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { useAuth } from '@/components/shared/GuestContext';
import SystemErrorBanner from '@/components/shared/SystemErrorBanner';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { createPageUrl } from '@/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
// Living Dashboard system - shared with all B2B pages.
import {
  PageShell,
  Card,
  KpiTile,
  AnimatedCount,
} from '@/components/business/system';
import { C } from '@/lib/designTokens';

const PAGE_SIZE = 25;

// ---------- helpers ----------------------------------------------------

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Status returns the row's domain accent (matches Card accent palette)
// plus a self-contained chip style so the row can render a status pill
// without needing access to a separate map.
function vehicleStatus(v) {
  const testD = daysUntil(v.test_due_date);
  const insD  = daysUntil(v.insurance_due_date);
  const worst = Math.min(testD ?? 999, insD ?? 999);
  if (worst < 0) {
    return {
      key: 'overdue', label: 'דחוף', accent: 'red',
      chipBg: C.errorLight, chipFg: C.errorDark,
    };
  }
  if (worst <= 60) {
    return {
      key: 'soon', label: 'בקרוב', accent: 'amber',
      chipBg: C.warnBg, chipFg: C.warnDark,
    };
  }
  return {
    key: 'ok', label: 'תקין', accent: 'emerald',
    chipBg: C.successLight, chipFg: C.successDark,
  };
}

function statusReason(v) {
  const testD = daysUntil(v.test_due_date);
  const insD  = daysUntil(v.insurance_due_date);
  const out = [];
  if (testD !== null) {
    if (testD < 0)    out.push(`טסט פג לפני ${Math.abs(testD)} ימים`);
    else if (testD <= 60) out.push(`טסט בעוד ${testD} ימים`);
  }
  if (insD !== null) {
    if (insD < 0)    out.push(`ביטוח פג לפני ${Math.abs(insD)} ימים`);
    else if (insD <= 60) out.push(`ביטוח בעוד ${insD} ימים`);
  }
  return out.join(' · ');
}

const STATUS_PRIORITY = { overdue: 0, soon: 1, ok: 2 };
const SORT_OPTIONS = [
  { value: 'status',    label: 'דחיפות' },
  { value: 'plate',     label: 'מספר רישוי' },
  { value: 'nickname',  label: 'שם הרכב' },
  { value: 'year_desc', label: 'שנה (חדש לישן)' },
  { value: 'recent',    label: 'עדכון אחרון' },
];

// ---------- main component --------------------------------------------

export default function Fleet() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, canManageRoutes, isOwner, isLoading: roleLoading } = useWorkspaceRole();

  const [search, setSearch]             = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [typeFilter, setTypeFilter]     = useState('');
  const [leasingFilter, setLeasingFilter] = useState('');
  const [sort, setSort]                 = useState('status');
  const [filtersOpen, setFiltersOpen]   = useState(false);
  const [page, setPage]                 = useState(0);
  // Bulk select + delete (owner only). Opt-in mode so normal browsing is untouched.
  const queryClient = useQueryClient();
  const [selectMode, setSelectMode]         = useState(false);
  const [selectedIds, setSelectedIds]       = useState(() => new Set());
  const [confirmOpen, setConfirmOpen]       = useState(false);
  const [deleting, setDeleting]             = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ done: 0, total: 0 });

  const enabled = !!accountId && canManageRoutes && isBusiness;

  const { data: vehicles = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['fleet-vehicles', accountId],
    queryFn: async () => {
      const { data, error } = await withTimeout(supabase
        .from('vehicles')
        // created_at/updated_at are needed by the 'עדכון אחרון' sort option —
        // without them that sort was a no-op (sorted on undefined) (audit ב-4).
        .select('id, nickname, manufacturer, model, year, license_plate, vehicle_type, test_due_date, insurance_due_date, leasing_company, created_at, updated_at')
        .eq('account_id', accountId), 'fleet_vehicles');
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 60 * 1000,
  });

  const { data: assignments = [], isError: assignmentsError, refetch: refetchAssignments } = useQuery({
    queryKey: ['driver-assignments', accountId],
    queryFn: async () => {
      const { data, error } = await withTimeout(supabase
        .from('driver_assignments')
        .select('id, driver_user_id, vehicle_id, status')
        .eq('account_id', accountId)
        .eq('status', 'active'), 'fleet_driver_assignments');
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 60 * 1000,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['workspace-members-directory', accountId],
    queryFn: async () => {
      const { data, error } = await withTimeout(supabase.rpc('workspace_members_directory', {
        p_account_id: accountId,
      }), 'fleet_members_directory');
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  // Driver lookup maps.
  const driversByVehicle = useMemo(() => {
    const map = {};
    for (const a of assignments) {
      if (!map[a.vehicle_id]) map[a.vehicle_id] = [];
      map[a.vehicle_id].push(a.driver_user_id);
    }
    return map;
  }, [assignments]);

  const memberById = useMemo(() => {
    const m = {};
    for (const x of members) m[x.user_id] = x;
    return m;
  }, [members]);

  const driverLabel = (vid) => {
    const ids = driversByVehicle[vid] || [];
    if (ids.length === 0) return null;
    if (ids.length === 1) return memberById[ids[0]]?.display_name || 'נהג לא ידוע';
    return `${ids.length} נהגים`;
  };

  // Distinct vehicle types currently in fleet (for the type filter).
  const types = useMemo(() => {
    const s = new Set();
    for (const v of vehicles) if (v.vehicle_type) s.add(v.vehicle_type);
    return Array.from(s).sort();
  }, [vehicles]);

  // Distinct leasing companies currently in fleet (for the leasing filter).
  const leasingOptions = useMemo(() => {
    const s = new Set();
    for (const v of vehicles) if (v.leasing_company) s.add(v.leasing_company);
    return Array.from(s).sort();
  }, [vehicles]);

  // Counts per status, plus unassigned count.
  const counts = useMemo(() => {
    const c = { overdue: 0, soon: 0, ok: 0, unassigned: 0 };
    for (const v of vehicles) {
      c[vehicleStatus(v).key]++;
      if (!(driversByVehicle[v.id]?.length)) c.unassigned++;
    }
    return c;
  }, [vehicles, driversByVehicle]);

  // Filter + sort pipeline.
  const filtered = useMemo(() => {
    let rows = vehicles;

    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(v => {
        const fields = [v.license_plate, v.nickname, v.manufacturer, v.model]
          .map(x => (x || '').toString().toLowerCase());
        return fields.some(f => f.includes(q));
      });
    }

    if (statusFilter === 'unassigned') {
      rows = rows.filter(v => !(driversByVehicle[v.id]?.length));
    } else if (statusFilter) {
      rows = rows.filter(v => vehicleStatus(v).key === statusFilter);
    }

    if (driverFilter) {
      rows = rows.filter(v => driversByVehicle[v.id]?.includes(driverFilter));
    }

    if (typeFilter) {
      rows = rows.filter(v => v.vehicle_type === typeFilter);
    }

    if (leasingFilter) {
      rows = rows.filter(v => v.leasing_company === leasingFilter);
    }

    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'plate':     return (a.license_plate || '').localeCompare(b.license_plate || '');
        case 'nickname':  return (a.nickname || '').localeCompare(b.nickname || '');
        case 'year_desc': return (b.year || 0) - (a.year || 0);
        case 'recent':    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
        case 'status':
        default:
          return STATUS_PRIORITY[vehicleStatus(a).key] - STATUS_PRIORITY[vehicleStatus(b).key];
      }
    });
  }, [vehicles, search, statusFilter, driverFilter, typeFilter, leasingFilter, sort, driversByVehicle]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedRows = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );

  // Reset page when filters change so the user doesn't land on an empty page.
  useEffect(() => { setPage(0); }, [search, statusFilter, driverFilter, typeFilter, leasingFilter, sort]);

  // Clamp the page if the result set shrinks (e.g. after a bulk delete) so we
  // never sit on a page past the end with an empty list and no way back (ב-7).
  useEffect(() => {
    if (page > totalPages - 1) setPage(totalPages - 1);
  }, [page, totalPages]);

  // Prune the bulk-select set to what's currently visible under the active
  // filter, so "select … then change filter … then delete" can't delete
  // vehicles the user can no longer see (audit ב-5).
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set(filtered.map(v => v.id));
      const next = new Set([...prev].filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  // ---------- guards ----------------------------------------------------

  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated) {
    return <Empty text="צריך להתחבר כדי לראות את הצי." />;
  }
  if (!isBusiness) {
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="צי הרכבים זמין בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש."
      />
    );
  }
  if (!canManageRoutes) {
    return (
      <Empty
        icon={<Truck className="h-10 w-10 text-gray-300" />}
        title="אין הרשאה לניהול הצי"
        text="ניהול הצי שמור לבעלים ולמנהלים בלבד."
      />
    );
  }

  // ---------- render ---------------------------------------------------

  const hasFilters = search || statusFilter || driverFilter || typeFilter || leasingFilter;
  // Only the dropdown filters (driver/type/leasing) feed the "filters" badge —
  // status lives in the cards, search has its own field.
  const advancedFilterCount = [driverFilter, typeFilter, leasingFilter].filter(Boolean).length;
  // Clicking the active status card again clears it (toggle).
  const toggleStatus = (key) => setStatusFilter(prev => (prev === key ? '' : key));
  const clearAll = () => {
    setSearch(''); setStatusFilter(''); setDriverFilter(''); setTypeFilter(''); setLeasingFilter('');
  };

  // ---------- bulk select / delete (owner only) ---------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const selectedCount = selectedIds.size;
  // "Select all" operates on the FILTERED set (all pages of the current
  // filter), matching the user's mental model ("delete all these").
  const allFilteredSelected = filtered.length > 0 && filtered.every(v => selectedIds.has(v.id));

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = () => setSelectedIds(
    allFilteredSelected ? new Set() : new Set(filtered.map(v => v.id)),
  );
  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const runBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setDeleting(true);
    setDeleteProgress({ done: 0, total: ids.length });
    let ok = 0, failed = 0;
    // Throttle to 3 concurrent deletes — same gentle pacing as the lookup,
    // so a big delete doesn't hammer the backend. delete_vehicle_with_share_choice
    // notifies sharees + cascade-deletes documents/maintenance/shares.
    for (let i = 0; i < ids.length; i += 3) {
      const chunk = ids.slice(i, i + 3);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(chunk.map(async (id) => {
        try {
          const { error } = await supabase.rpc('delete_vehicle_with_share_choice', { p_vehicle_id: id, p_mode: 'both' });
          if (error) throw error;
          ok += 1;
        } catch { failed += 1; }
        finally { setDeleteProgress(p => ({ ...p, done: p.done + 1 })); }
      }));
      // eslint-disable-next-line no-await-in-loop
      if (i + 3 < ids.length) await sleep(150);
    }
    setDeleting(false);
    setConfirmOpen(false);
    exitSelect();
    ['fleet-vehicles', 'vehicles', 'my-vehicles', 'vehicles-list'].forEach(k =>
      queryClient.invalidateQueries({ queryKey: [k] }));
    if (failed === 0) toast.success(`${ok} רכבים נמחקו`);
    else toastError(`נמחקו ${ok}, נכשלו ${failed}. נסה שוב את הנכשלים.`, { action: 'fleet_bulk_delete_partial' });
  };

  return (
    <PageShell
      title="צי הרכבים"
      subtitle={(
        <span>
          <span dir="ltr" className="tabular-nums font-bold" style={{ color: C.primaryDark }}>
            <AnimatedCount value={vehicles.length} />
          </span>{' '}רכבים בצי
        </span>
      )}
      actions={(
        <div className="flex items-center gap-2">
          <Link
            to={createPageUrl('BulkAddVehicles')}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: '#FFFFFF',
              color: C.successBright,
              border: `1.5px solid ${C.successLight}`,
            }}
          >
            <Upload className="h-4 w-4" />
            ייבוא
          </Link>
          <Link
            to={createPageUrl('AddVehicle')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
              color: '#FFFFFF',
              boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
            }}
          >
            <Plus className="h-4 w-4" />
            הוסף רכב
          </Link>
        </div>
      )}
    >
      {/* Status filter cards — each tile IS the status filter (click to
          toggle). Colored by meaning: red=overdue, amber=soon,
          emerald=ok, blue=unassigned. A card with count 0 is neutral and
          disabled, so a healthy fleet never offers a dead-end click. */}
      <section
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4"
        role="group"
        aria-label="סינון לפי סטטוס"
      >
        <KpiTile
          label="דחוף"
          labelClassName="text-[11px] font-bold mb-1.5"
          value={<AnimatedCount value={counts.overdue} />}
          sub={counts.overdue === 0 ? 'הכל תקין' : 'דורש טיפול'}
          tone="red"
          onClick={() => toggleStatus('overdue')}
          active={statusFilter === 'overdue'}
          disabled={counts.overdue === 0}
        />
        <KpiTile
          label="בקרוב"
          labelClassName="text-[11px] font-bold mb-1.5"
          value={<AnimatedCount value={counts.soon} />}
          sub={counts.soon === 0 ? 'אין תזכורות' : '60 ימים קרובים'}
          tone="amber"
          onClick={() => toggleStatus('soon')}
          active={statusFilter === 'soon'}
          disabled={counts.soon === 0}
        />
        <KpiTile
          label="תקין"
          labelClassName="text-[11px] font-bold mb-1.5"
          value={<AnimatedCount value={counts.ok} />}
          sub={counts.ok === 0 ? 'אין רכב תקין' : 'ללא תזכורת קרובה'}
          tone="emerald"
          onClick={() => toggleStatus('ok')}
          active={statusFilter === 'ok'}
          disabled={counts.ok === 0}
        />
        <KpiTile
          label="ללא נהג"
          labelClassName="text-[11px] font-bold mb-1.5"
          value={<AnimatedCount value={counts.unassigned} />}
          sub={counts.unassigned === 0 ? 'הכל משובץ' : 'ממתין שיבוץ'}
          tone="blue"
          onClick={() => toggleStatus('unassigned')}
          active={statusFilter === 'unassigned'}
          disabled={counts.unassigned === 0}
        />
      </section>

      {/* Search + filters toggle on one row — keeps the list above the fold. */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: '#7A6E58' }} />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חפש לפי מספר רישוי, שם, יצרן או דגם"
            className="h-11 rounded-xl pr-10 pl-9 text-sm w-full"
            style={{ background: '#FFFFFF', borderColor: C.successLight }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="נקה חיפוש"
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-900"
            >
              <X className="h-3.5 w-3.5 text-gray-400" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen(o => !o)}
          aria-expanded={filtersOpen}
          aria-controls="fleet-filters"
          className="relative flex items-center gap-1.5 h-11 px-3 rounded-xl text-xs font-bold shrink-0 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-900"
          style={{
            background: '#FFFFFF',
            color: C.primaryDark,
            border: `1.5px solid ${advancedFilterCount > 0 ? C.successBright : C.successLight}`,
          }}
        >
          <SlidersHorizontal className="h-4 w-4" />
          מסננים ומיון
          {advancedFilterCount > 0 && (
            <span
              className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black text-white tabular-nums"
              style={{ background: C.successBright }}
              aria-label={`${advancedFilterCount} מסננים פעילים`}
            >
              {advancedFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Collapsible. Two DISTINCT concepts, visually separated:
          "סינון" narrows WHICH vehicles show; "מיון" reorders the same set.
          Keeping them in one undifferentiated grid made sort look like just
          another filter — so each gets its own labeled section + divider. */}
      {filtersOpen && (
        <div id="fleet-filters" className="mb-5 rounded-xl p-3" style={{ background: '#FFFFFF', border: `1px solid ${C.successLight}` }}>
          {/* Filter group */}
          <p className="text-[11px] font-bold mb-2" style={{ color: C.mutedAlt }}>סינון</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Select value={driverFilter || 'all-drivers'} onValueChange={(v) => setDriverFilter(v === 'all-drivers' ? '' : v)}>
              <SelectTrigger className="h-10 rounded-xl text-xs font-bold">
                <SelectValue placeholder="כל הנהגים" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-drivers">כל הנהגים</SelectItem>
              {members.map(m => (
                  <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>
              ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter || 'all-types'} onValueChange={(v) => setTypeFilter(v === 'all-types' ? '' : v)}>
              <SelectTrigger className="h-10 rounded-xl text-xs font-bold">
                <SelectValue placeholder="כל הסוגים" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-types">כל הסוגים</SelectItem>
                {types.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {leasingOptions.length > 0 && (
              <Select value={leasingFilter || 'all-leasing'} onValueChange={(v) => setLeasingFilter(v === 'all-leasing' ? '' : v)}>
                <SelectTrigger className="h-10 rounded-xl text-xs font-bold">
                  <SelectValue placeholder="כל חברות הליסינג" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all-leasing">כל חברות הליסינג</SelectItem>
                  {leasingOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Sort group — separated: reorders the list, not a filter. */}
          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.gray100}` }}>
            <p className="text-[11px] font-bold mb-2 flex items-center gap-1" style={{ color: C.mutedAlt }}>
              <ArrowUpDown className="h-3 w-3" /> מיון
            </p>
            <div className="sm:max-w-[220px]">
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="h-10 rounded-xl text-xs font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Driver data failed but the fleet loaded — warn instead of silently
          showing every vehicle as "ללא נהג" and inflating that count (audit ב-6). */}
      {assignmentsError && !isError && (
        <div className="mb-3">
          <SystemErrorBanner
            message="נתוני הנהגים לא נטענו. השיוך לנהגים עשוי להיות חסר."
            onRetry={() => refetchAssignments()}
          />
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <Card className="text-center py-8">
          <p className="text-xs" style={{ color: C.mutedAlt }}>טוען רכבים...</p>
        </Card>
      ) : isError ? (
        /* C2: load failure → retry banner, not a misleading empty fleet. */
        <SystemErrorBanner message="טעינת הצי נכשלה. בדוק את החיבור ונסה שוב." onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <Card className="text-center py-12">
          <Truck className="h-10 w-10 mx-auto mb-3" style={{ color: C.successLighter }} />
          <p className="text-sm font-bold mb-1" style={{ color: C.primaryDark }}>
            {vehicles.length === 0 ? 'הצי שלך עוד ריק' : 'אין רכבים תואמים לסינון'}
          </p>
          <p className="text-xs leading-relaxed" style={{ color: C.mutedAlt }}>
            {vehicles.length === 0
              ? 'התחל בהוספת הרכב הראשון. ניתן לחפש לפי מספר רישוי דרך משרד התחבורה.'
              : hasFilters
                ? 'נסה להסיר חלק מהמסננים, או לחפש מונח אחר.'
                : 'לא נמצאו רכבים.'}
          </p>
          {vehicles.length > 0 && hasFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-900"
              style={{ background: '#FFFFFF', color: C.successBright, border: `1.5px solid ${C.successLight}` }}
            >
              <X className="h-3.5 w-3.5" /> נקה את כל המסננים
            </button>
          )}
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-bold truncate" style={{ color: C.primaryDark }}>
                {filtered.length === vehicles.length
                  ? `כל הצי (${vehicles.length})`
                  : `מציג ${filtered.length} מתוך ${vehicles.length}`}
              </h2>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-[11px] font-bold underline shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-gray-900"
                  style={{ color: C.successBright }}
                >
                  נקה הכל
                </button>
              )}
            </div>
            {isOwner && (selectMode ? (
              <button type="button" onClick={exitSelect}
                className="flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg shrink-0"
                style={{ color: C.textAlt, background: '#FFFFFF', border: `1px solid ${C.bgSage}` }}>
                <X className="h-3.5 w-3.5" /> בטל בחירה
              </button>
            ) : (
              <button type="button" onClick={() => setSelectMode(true)}
                className="flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg shrink-0"
                style={{ color: C.primary, background: '#FFFFFF', border: `1px solid ${C.successLight}` }}>
                <ListChecks className="h-3.5 w-3.5" /> בחירה
              </button>
            ))}
          </div>
          {selectMode && (
            <button type="button" onClick={toggleSelectAll}
              className="flex items-center gap-2 text-xs font-bold mb-2 px-1"
              style={{ color: C.primaryDark }}>
              {allFilteredSelected
                ? <CheckSquare className="h-4 w-4" style={{ color: C.primary }} />
                : <Square className="h-4 w-4" style={{ color: C.borderAlt }} />}
              בחר הכל ({filtered.length})
            </button>
          )}
          <ul className="space-y-2">
            {pagedRows.map(v => (
              <FleetRow
                key={v.id}
                vehicle={v}
                driverName={driverLabel(v.id)}
                selectMode={selectMode}
                selected={selectedIds.has(v.id)}
                onToggle={() => toggleSelect(v.id)}
              />
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-5 text-xs">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
                className="px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: '#FFFFFF',
                  color: C.successBright,
                  border: `1.5px solid ${C.successLight}`,
                }}
              >
                הקודם
              </button>
              <span style={{ color: C.textAlt }}>
                עמוד {page + 1} מתוך {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                className="px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: '#FFFFFF',
                  color: C.successBright,
                  border: `1.5px solid ${C.successLight}`,
                }}
              >
                הבא
              </button>
            </div>
          )}
        </>
      )}
      {selectMode && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 px-3"
          style={{
            paddingTop: '0.75rem',
            paddingBottom: 'calc(0.75rem + var(--inset-bottom, 0px))',
            background: '#FFFFFF',
            borderTop: `1px solid ${C.gray100}`,
            boxShadow: '0 -4px 16px rgba(0,0,0,0.08)',
          }}
        >
          <div className="max-w-md mx-auto flex items-center justify-between gap-3">
            <span className="text-sm font-bold" style={{ color: C.primaryDark }}>נבחרו {selectedCount}</span>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => setConfirmOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-[0.98]"
              style={{ background: C.error }}
            >
              <Trash2 className="h-4 w-4" /> מחק{selectedCount > 0 ? ` ${selectedCount}` : ''}
            </button>
          </div>
        </div>
      )}
      {confirmOpen && (
        <BulkDeleteConfirm
          count={selectedCount}
          deleting={deleting}
          progress={deleteProgress}
          onCancel={() => { if (!deleting) setConfirmOpen(false); }}
          onConfirm={runBulkDelete}
        />
      )}
    </PageShell>
  );
}

// ---------- subcomponents ---------------------------------------------

function FleetRow({ vehicle, driverName, selectMode = false, selected = false, onToggle }) {
  const status = vehicleStatus(vehicle);
  const reason = statusReason(vehicle);
  const label  = vehicle.nickname
    || `${vehicle.manufacturer || ''} ${vehicle.model || ''}`.trim()
    || 'רכב ללא שם';

  const inner = (
    <Card accent={status.accent} padding="p-3.5">
      <div className="flex items-center gap-3">
        {selectMode && (
          selected
            ? <CheckSquare className="h-5 w-5 shrink-0" style={{ color: C.primary }} />
            : <Square className="h-5 w-5 shrink-0" style={{ color: C.borderAlt }} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="text-sm font-bold truncate" style={{ color: C.primaryDark }}>{label}</p>
            {vehicle.license_plate && (
              <span
                className="text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded tabular-nums"
                dir="ltr"
                style={{ background: C.bgSubtle, color: C.textAlt }}
              >
                {vehicle.license_plate}
              </span>
            )}
          </div>
          <p className="text-[11px] truncate leading-relaxed" style={{ color: C.mutedAlt }}>
            {driverName
              ? <>נהג: <span className="font-bold" style={{ color: C.primaryDark }}>{driverName}</span></>
              : <span style={{ color: C.borderAlt }}>ללא נהג משויך</span>}
            {reason && <>{` · ${reason}`}</>}
          </p>
        </div>
        <span
          className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ background: status.chipBg, color: status.chipFg }}
        >
          {status.label}
        </span>
        {!selectMode && <ChevronLeft className="h-4 w-4 shrink-0" style={{ color: C.borderAlt }} />}
      </div>
    </Card>
  );

  // In selection mode the whole row toggles selection (thumb-friendly) and
  // does NOT navigate. Otherwise it's the usual link to the detail page.
  if (selectMode) {
    return (
      <li>
        <button
          type="button"
          onClick={onToggle}
          className="block w-full text-right transition-transform active:scale-[0.995] rounded-2xl"
          style={selected ? { boxShadow: `0 0 0 2px ${C.primary}` } : undefined}
        >
          {inner}
        </button>
      </li>
    );
  }
  return (
    <li>
      <Link
        to={createPageUrl('VehicleDetail') + '?id=' + vehicle.id}
        className="block transition-transform hover:scale-[1.005] active:scale-[0.995]"
      >
        {inner}
      </Link>
    </li>
  );
}

// Destructive confirm for bulk delete. For 10+ vehicles it requires the
// user to type "מחק" — a deliberate friction gate against an accidental
// fleet-wide wipe. Shows live progress while deleting.
function BulkDeleteConfirm({ count, deleting, progress, onCancel, onConfirm }) {
  const needsType = count >= 10;
  const [txt, setTxt] = useState('');
  const canConfirm = !deleting && count > 0 && (!needsType || txt.trim() === 'מחק');
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-3"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !deleting) onCancel(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl">
        <div className="flex items-center gap-2 mb-1">
          <Trash2 className="h-5 w-5 shrink-0" style={{ color: C.error }} />
          <h2 className="text-lg font-bold" style={{ color: C.primaryDark }}>למחוק {count} רכבים?</h2>
        </div>
        <p className="text-sm leading-relaxed mb-4" style={{ color: C.textAlt }}>
          הפעולה תמחק לצמיתות את הרכבים ואת כל המסמכים, הטיפולים והשיתופים שלהם. לא ניתן לבטל.
        </p>
        {needsType && !deleting && (
          <div className="mb-4">
            <label className="text-xs font-bold block mb-1.5" style={{ color: C.gray700 }}>
              למחיקה של כמות גדולה — הקלד <b>מחק</b> לאישור:
            </label>
            <Input value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="מחק" className="h-10 rounded-xl" />
          </div>
        )}
        {deleting && (
          <div className="mb-4">
            <p className="text-xs font-bold mb-1" style={{ color: C.error }}>מוחק... {progress.done} מתוך {progress.total}</p>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: C.bgSubtle }}>
              <div className="h-full transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`, background: C.error }} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="h-11 rounded-xl text-sm font-bold disabled:opacity-50"
            style={{ background: '#FFFFFF', color: C.gray700, border: `1px solid ${C.gray200}` }}
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="h-11 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: C.error }}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <>מחק {count} רכבים</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function Empty({ icon, title, text, embedded }) {
  return (
    <div dir="rtl" className={embedded ? 'py-10' : 'max-w-md mx-auto py-16'}>
      <div className="text-center px-6">
        {icon && <div className="flex justify-center mb-3">{icon}</div>}
        {title && <p className="text-sm font-bold text-gray-700 mb-1">{title}</p>}
        <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

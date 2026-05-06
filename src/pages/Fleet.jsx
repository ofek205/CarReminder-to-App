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
import { useQuery } from '@tanstack/react-query';
import {
  Search, Plus, ChevronLeft, Truck, Briefcase, X, Upload,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
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
      chipBg: '#FEE2E2', chipFg: '#991B1B',
    };
  }
  if (worst <= 60) {
    return {
      key: 'soon', label: 'בקרוב', accent: 'amber',
      chipBg: '#FEF3C7', chipFg: '#92400E',
    };
  }
  return {
    key: 'ok', label: 'תקין', accent: 'emerald',
    chipBg: '#D1FAE5', chipFg: '#065F46',
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
  const { isBusiness, canManageRoutes, isLoading: roleLoading } = useWorkspaceRole();

  const [search, setSearch]             = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [typeFilter, setTypeFilter]     = useState('');
  const [sort, setSort]                 = useState('status');
  const [page, setPage]                 = useState(0);

  const enabled = !!accountId && canManageRoutes && isBusiness;

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['fleet-vehicles', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, nickname, manufacturer, model, year, license_plate, vehicle_type, test_due_date, insurance_due_date')
        .eq('account_id', accountId);
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 60 * 1000,
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ['driver-assignments', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_assignments')
        .select('id, driver_user_id, vehicle_id, status')
        .eq('account_id', accountId)
        .eq('status', 'active');
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 60 * 1000,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['workspace-members-directory', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('workspace_members_directory', {
        p_account_id: accountId,
      });
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
  }, [vehicles, search, statusFilter, driverFilter, typeFilter, sort, driversByVehicle]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedRows = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page]
  );

  // Reset page when filters change so the user doesn't land on an empty page.
  useEffect(() => { setPage(0); }, [search, statusFilter, driverFilter, typeFilter, sort]);

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

  const hasFilters = search || statusFilter || driverFilter || typeFilter;

  return (
    <PageShell
      title="צי הרכבים"
      subtitle={`${vehicles.length} רכבים בצי`}
      actions={(
        <div className="flex items-center gap-2">
          <Link
            to={createPageUrl('BulkAddVehicles')}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: '#FFFFFF',
              color: '#10B981',
              border: '1.5px solid #D1FAE5',
            }}
          >
            <Upload className="h-4 w-4" />
            ייבוא
          </Link>
          <Link
            to={createPageUrl('AddVehicle')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
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
      {/* KPI Strip — fleet at a glance. Each tile colored by meaning:
          emerald = total / healthy
          red     = overdue
          amber   = expiring soon
          blue    = unassigned (info, not problem) */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <KpiTile
          label="סה״כ בצי"
          value={<AnimatedCount value={vehicles.length} />}
          sub="רכבים פעילים"
          tone="emerald"
        />
        <KpiTile
          label="דחוף"
          value={<AnimatedCount value={counts.overdue} />}
          sub={counts.overdue === 0 ? 'הכל תקין' : 'דורש טיפול'}
          tone={counts.overdue > 0 ? 'red' : 'emerald'}
        />
        <KpiTile
          label="בקרוב"
          value={<AnimatedCount value={counts.soon} />}
          sub={counts.soon === 0 ? 'אין תזכורות' : '60 ימים קרובים'}
          tone="amber"
        />
        <KpiTile
          label="ללא נהג"
          value={<AnimatedCount value={counts.unassigned} />}
          sub={counts.unassigned === 0 ? 'הכל משובץ' : 'ממתין שיבוץ'}
          tone="blue"
        />
      </section>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: '#7A6E58' }} />
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חפש לפי מספר רישוי, שם, יצרן או דגם"
          className="h-11 rounded-xl pr-10 pl-9 text-sm"
          style={{ background: '#FFFFFF', borderColor: '#D1FAE5' }}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="נקה חיפוש"
            className="absolute left-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded"
          >
            <X className="h-3.5 w-3.5 text-gray-400" />
          </button>
        )}
      </div>

      {/* Status chips — system tones */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <Chip active={!statusFilter}                 onClick={() => setStatusFilter('')}>הכל ({vehicles.length})</Chip>
        <Chip active={statusFilter === 'overdue'}    onClick={() => setStatusFilter('overdue')}    tone="red">דחוף ({counts.overdue})</Chip>
        <Chip active={statusFilter === 'soon'}       onClick={() => setStatusFilter('soon')}       tone="amber">בקרוב ({counts.soon})</Chip>
        <Chip active={statusFilter === 'ok'}         onClick={() => setStatusFilter('ok')}         tone="emerald">תקין ({counts.ok})</Chip>
        <Chip active={statusFilter === 'unassigned'} onClick={() => setStatusFilter('unassigned')} tone="blue">ללא נהג ({counts.unassigned})</Chip>
      </div>

      {/* Driver / Type / Sort row */}
      <div className="grid grid-cols-3 gap-2 mb-5">
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
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="h-10 rounded-xl text-xs font-bold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>מיון: {o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <Card className="text-center py-8">
          <p className="text-xs" style={{ color: '#6B7C72' }}>טוען רכבים...</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-12">
          <Truck className="h-10 w-10 mx-auto mb-3" style={{ color: '#A7F3D0' }} />
          <p className="text-sm font-bold mb-1" style={{ color: '#0B2912' }}>
            {vehicles.length === 0 ? 'הצי שלך עוד ריק' : 'אין רכבים תואמים לסינון'}
          </p>
          <p className="text-xs leading-relaxed" style={{ color: '#6B7C72' }}>
            {vehicles.length === 0
              ? 'התחל בהוספת הרכב הראשון. ניתן לחפש לפי מספר רישוי דרך משרד התחבורה.'
              : hasFilters
                ? 'נסה להסיר חלק מהמסננים, או לחפש מונח אחר.'
                : 'לא נמצאו רכבים.'}
          </p>
        </Card>
      ) : (
        <>
          <h2 className="text-sm font-bold mb-2.5" style={{ color: '#0B2912' }}>
            {filtered.length === vehicles.length
              ? `כל הצי (${vehicles.length})`
              : `מציג ${filtered.length} מתוך ${vehicles.length}`}
          </h2>
          <ul className="space-y-2">
            {pagedRows.map(v => (
              <FleetRow
                key={v.id}
                vehicle={v}
                driverName={driverLabel(v.id)}
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
                  color: '#10B981',
                  border: '1.5px solid #D1FAE5',
                }}
              >
                הקודם
              </button>
              <span style={{ color: '#4B5D52' }}>
                עמוד {page + 1} מתוך {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                className="px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: '#FFFFFF',
                  color: '#10B981',
                  border: '1.5px solid #D1FAE5',
                }}
              >
                הבא
              </button>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

// ---------- subcomponents ---------------------------------------------

function FleetRow({ vehicle, driverName }) {
  const status = vehicleStatus(vehicle);
  const reason = statusReason(vehicle);
  const label  = vehicle.nickname
    || `${vehicle.manufacturer || ''} ${vehicle.model || ''}`.trim()
    || 'רכב ללא שם';
  return (
    <li>
      <Link
        to={createPageUrl('VehicleDetail') + '?id=' + vehicle.id}
        className="block transition-transform hover:scale-[1.005] active:scale-[0.995]"
      >
        <Card accent={status.accent} padding="p-3.5">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <p className="text-sm font-bold truncate" style={{ color: '#0B2912' }}>{label}</p>
                {vehicle.license_plate && (
                  <span
                    className="text-[10px] font-mono shrink-0 px-1.5 py-0.5 rounded tabular-nums"
                    dir="ltr"
                    style={{ background: '#F0F7F4', color: '#4B5D52' }}
                  >
                    {vehicle.license_plate}
                  </span>
                )}
              </div>
              <p className="text-[11px] truncate leading-relaxed" style={{ color: '#6B7C72' }}>
                {driverName
                  ? <>נהג: <span className="font-bold" style={{ color: '#0B2912' }}>{driverName}</span></>
                  : <span style={{ color: '#A7B3AB' }}>ללא נהג משויך</span>}
                {reason && <>{` · ${reason}`}</>}
              </p>
            </div>
            <span
              className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold"
              style={{ background: status.chipBg, color: status.chipFg }}
            >
              {status.label}
            </span>
            <ChevronLeft className="h-4 w-4 shrink-0" style={{ color: '#A7B3AB' }} />
          </div>
        </Card>
      </Link>
    </li>
  );
}

// Chip — filter pill matching the system tones used in KpiTile / Card
// accents. Active state uses the deep emerald gradient base; inactive
// state uses a soft tint of the same tone (or a neutral white).
const CHIP_INACTIVE_BY_TONE = {
  red:     { background: '#FEF2F2', color: '#991B1B', borderColor: '#FECACA' },
  amber:   { background: '#FFFBEB', color: '#92400E', borderColor: '#FCD34D' },
  emerald: { background: '#ECFDF5', color: '#065F46', borderColor: '#A7F3D0' },
  blue:    { background: '#EFF6FF', color: '#1E40AF', borderColor: '#BFDBFE' },
};

function Chip({ active, onClick, children, tone }) {
  const inactive = CHIP_INACTIVE_BY_TONE[tone] || {
    background: '#FFFFFF', color: '#4B5D52', borderColor: '#E5EDE8',
  };
  const style = active
    ? {
        background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
        color: '#FFFFFF',
        borderColor: '#065F46',
        boxShadow: '0 4px 12px rgba(16,185,129,0.25)',
      }
    : inactive;
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap border transition-all hover:scale-[1.03] active:scale-[0.97]"
      style={style}
    >
      {children}
    </button>
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

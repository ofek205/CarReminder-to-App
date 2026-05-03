/**
 * Phase 9, Step 3 — Drivers / Members management page.
 *
 * Manager-only page that lists every member of the active business
 * workspace, shows real names (via workspace_members_directory RPC
 * added in Phase 9 step 1), and lets the manager assign a vehicle
 * to any active member via the existing assign_driver RPC.
 *
 * What this page deliberately does NOT do (deferred):
 *   - inviting brand-new members (Phase 5)
 *   - changing a member's role (no RPC yet)
 *   - removing a member (no RPC yet)
 *   - revoking an assignment (no RPC yet)
 *
 * For v1, the page surfaces what's already possible at the data layer
 * and gives the manager a clean directory + assignment workflow.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase, UserPlus, Truck, Loader2, Plus, X,
  Crown, Shield, Eye, User as UserIcon, Calendar, Mail, IdCard, ChevronDown, Phone, ChevronLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import MobileBackButton from '@/components/shared/MobileBackButton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { listExternalDrivers, categoryShortLabel } from '@/services/drivers';
import ExternalDriverFormDialog from '@/components/drivers/ExternalDriverFormDialog';
import AssignDriverDialog from '@/components/drivers/AssignDriverDialog';
import { createPageUrl } from '@/utils';

// Visual treatment per role. Order also defines display priority.
const ROLE_META = {
  'בעלים':  { label: 'בעלים',  icon: Crown,    cls: 'text-purple-700 bg-purple-50' },
  'מנהל':   { label: 'מנהל',   icon: Shield,   cls: 'text-[#2D5233] bg-[#E8F2EA]' },
  'שותף':   { label: 'צופה',   icon: Eye,      cls: 'text-blue-700 bg-blue-50' },
  'driver': { label: 'נהג',    icon: Truck,    cls: 'text-orange-700 bg-orange-50' },
};
const roleMeta = (role) => ROLE_META[role] || { label: role, icon: UserIcon, cls: 'text-gray-700 bg-gray-100' };

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('he-IL') : '';

export default function Drivers() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, canManageRoutes, isLoading: roleLoading } = useWorkspaceRole();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Unified assignment-dialog state. shape: null | { kind, id, displayName }
  // kind = 'registered' | 'external'. Drives the single AssignDriverDialog.
  const [assigning, setAssigning]      = useState(null);
  const [adding,    setAdding]         = useState(false);
  const [addingExternal, setAddingExternal] = useState(false);
  const [editingExternal, setEditingExternal] = useState(null); // null | external_drivers row
  // Filter chip: 'all' | 'registered' | 'external'
  const [filter, setFilter] = useState('all');

  // Member directory — names via the SECURITY DEFINER RPC.
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['workspace-members-directory', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('workspace_members_directory', {
        p_account_id: accountId,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canManageRoutes && isBusiness,
    staleTime: 60 * 1000,
  });

  // External (non-account) drivers — roster entries that don't have
  // an auth.users row but the manager still wants to track + assign.
  const { data: externalDrivers = [], isLoading: externalLoading } = useQuery({
    queryKey: ['external-drivers', accountId],
    queryFn:  () => listExternalDrivers({ accountId, includeArchived: false }),
    enabled:  !!accountId && canManageRoutes && isBusiness,
    staleTime: 60 * 1000,
  });

  // Active driver assignments — now includes both kinds. We pull both
  // id columns so the row renderer can group by either.
  const { data: assignments = [] } = useQuery({
    queryKey: ['driver-assignments', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_assignments')
        .select('id, driver_user_id, external_driver_id, vehicle_id, valid_from, valid_to, status')
        .eq('account_id', accountId)
        .eq('status', 'active');
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canManageRoutes && isBusiness,
    staleTime: 60 * 1000,
  });

  // Vehicles in the workspace — used to render assignment labels and
  // populate the assign dialog dropdown.
  const { data: vehicles = [] } = useQuery({
    queryKey: ['drivers-vehicle-list', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, nickname, manufacturer, model, year, license_plate')
        .eq('account_id', accountId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canManageRoutes && isBusiness,
    staleTime: 5 * 60 * 1000,
  });

  // Group assignments by driver for fast lookup. Two maps: one keyed
  // by driver_user_id (registered) and one by external_driver_id, so
  // each row renderer can hit O(1) lookup.
  const assignmentsByUserId = useMemo(() => {
    const map = {};
    for (const a of assignments) {
      if (!a.driver_user_id) continue;
      (map[a.driver_user_id] ||= []).push(a);
    }
    return map;
  }, [assignments]);
  const assignmentsByExternalId = useMemo(() => {
    const map = {};
    for (const a of assignments) {
      if (!a.external_driver_id) continue;
      (map[a.external_driver_id] ||= []).push(a);
    }
    return map;
  }, [assignments]);

  const vehicleById = useMemo(() => {
    const map = {};
    for (const v of vehicles) map[v.id] = v;
    return map;
  }, [vehicles]);

  const vehicleLabel = (id) => {
    const v = vehicleById[id];
    if (!v) return 'רכב לא ידוע';
    return v.nickname || v.license_plate || `${v.manufacturer || ''} ${v.model || ''}`.trim() || 'רכב ללא שם';
  };

  // Build the unified entries list — registered + external — with a
  // common shape so the renderer can iterate one array. Lives BEFORE
  // any early returns so the hooks order stays stable across renders.
  const entries = useMemo(() => {
    const r = members.map(m => ({
      kind: 'registered',
      id: m.user_id,
      name: m.display_name,
      email: m.email,
      role: m.role,
      joined_at: m.joined_at,
      assignments: assignmentsByUserId[m.user_id] || [],
      raw: m,
    }));
    const e = externalDrivers.map(d => ({
      kind: 'external',
      id: d.id,
      name: d.full_name,
      email: d.email,
      phone: d.phone,
      license_categories: d.license_categories || [],
      license_expiry_date: d.license_expiry_date,
      assignments: assignmentsByExternalId[d.id] || [],
      raw: d,
    }));
    let combined = [...r, ...e];
    if (filter === 'registered') combined = r;
    else if (filter === 'external') combined = e;
    return combined;
  }, [members, externalDrivers, assignmentsByUserId, assignmentsByExternalId, filter]);

  const isLoading = membersLoading || externalLoading;
  const totalCount = members.length + externalDrivers.length;

  const openDriverDetail = (entry) => {
    if (entry.kind === 'external') {
      navigate(`${createPageUrl('DriverDetail')}?type=external&id=${entry.id}`);
    } else {
      navigate(`${createPageUrl('DriverDetail')}?type=user&id=${entry.id}`);
    }
  };

  // Guards run AFTER all hooks so the hooks order is stable.
  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated) {
    return <Empty text="צריך להתחבר כדי לראות את הצוות." />;
  }
  if (!isBusiness) {
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="ניהול נהגים זמין בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש."
      />
    );
  }
  if (!canManageRoutes) {
    return (
      <Empty
        icon={<UserIcon className="h-10 w-10 text-gray-300" />}
        title="אין הרשאה לניהול נהגים"
        text="ניהול נהגים והקצאות שמור לבעלים ולמנהלים בלבד."
      />
    );
  }

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <MobileBackButton />
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">נהגים</h1>
          <p className="text-xs text-gray-500 truncate">
            ניהול נהגים, רישיונות ושיבוצים
            <span className="text-gray-400">{` · ${totalCount} ${totalCount === 1 ? 'נהג' : 'נהגים'}`}</span>
          </p>
        </div>
        {/* "+ הוסף נהג" — popover with two paths: invite-with-email
            (existing flow) or roster entry without account (new). */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#2D5233] text-white text-xs font-bold active:scale-[0.98]"
            >
              <UserPlus className="h-4 w-4" />
              הוסף נהג
              <ChevronDown className="h-3 w-3 opacity-80" />
            </button>
          </PopoverTrigger>
          <PopoverContent dir="rtl" align="end" className="w-72 p-1.5 rounded-2xl">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-full text-right px-3 py-2.5 rounded-xl hover:bg-gray-50 active:scale-[0.99] flex items-start gap-2.5"
            >
              <Mail className="h-4 w-4 mt-0.5 text-[#2D5233]" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">הזמן נהג עם חשבון</p>
                <p className="text-[11px] text-gray-500 leading-tight mt-0.5">
                  משתמש שכבר רשום באפליקציה. הוא יקבל גישה לרכב המשובץ ולמשימות.
                </p>
              </div>
            </button>
            <div className="h-px bg-gray-100 my-1" />
            <button
              type="button"
              onClick={() => setAddingExternal(true)}
              className="w-full text-right px-3 py-2.5 rounded-xl hover:bg-gray-50 active:scale-[0.99] flex items-start gap-2.5"
            >
              <IdCard className="h-4 w-4 mt-0.5 text-[#2D5233]" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900">הוסף נהג ללא חשבון</p>
                <p className="text-[11px] text-gray-500 leading-tight mt-0.5">
                  עובד פיזי שלא משתמש באפליקציה. תרשום פרטי קשר ורישיון.
                </p>
              </div>
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {/* Filter chips — visible only when there's at least one of each kind */}
      {(members.length > 0 && externalDrivers.length > 0) && (
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
          <FilterChip active={filter === 'all'}        onClick={() => setFilter('all')}>
            הכל ({totalCount})
          </FilterChip>
          <FilterChip active={filter === 'registered'} onClick={() => setFilter('registered')}>
            עם חשבון ({members.length})
          </FilterChip>
          <FilterChip active={filter === 'external'}   onClick={() => setFilter('external')}>
            ללא חשבון ({externalDrivers.length})
          </FilterChip>
        </div>
      )}

      {isLoading ? (
        <p className="text-center text-xs text-gray-400 py-6">טוען נהגים...</p>
      ) : entries.length === 0 ? (
        <Empty
          icon={<UserPlus className="h-10 w-10 text-gray-300" />}
          title="עוד אין נהגים בחשבון"
          text="הוסף נהג עם חשבון רשום, או רשום נהג ללא חשבון לעקיבה ושיבוץ"
          embedded
        />
      ) : (
        <ul className="space-y-2">
          {entries.map(entry => (
            entry.kind === 'registered' ? (
              <MemberRow
                key={`u-${entry.id}`}
                member={entry.raw}
                assignments={entry.assignments}
                vehicleLabel={vehicleLabel}
                onAssign={(e) => {
                  e?.stopPropagation?.();
                  setAssigning({ kind: 'registered', id: entry.id, displayName: entry.name });
                }}
                onOpen={() => openDriverDetail(entry)}
              />
            ) : (
              <ExternalDriverRow
                key={`x-${entry.id}`}
                driver={entry.raw}
                assignments={entry.assignments}
                vehicleLabel={vehicleLabel}
                onAssign={(e) => {
                  e?.stopPropagation?.();
                  setAssigning({ kind: 'external', id: entry.id, displayName: entry.name });
                }}
                onOpen={() => openDriverDetail(entry)}
              />
            )
          ))}
        </ul>
      )}

      {assigning && (
        <AssignDriverDialog
          open
          driver={assigning}
          vehicles={vehicles}
          accountId={accountId}
          existingAssignments={
            assigning.kind === 'external'
              ? (assignmentsByExternalId[assigning.id] || [])
              : (assignmentsByUserId[assigning.id] || [])
          }
          onClose={() => setAssigning(null)}
          onAssigned={async () => {
            await queryClient.invalidateQueries({ queryKey: ['driver-assignments'] });
            setAssigning(null);
          }}
        />
      )}

      {adding && (
        <AddMemberDialog
          accountId={accountId}
          onClose={() => setAdding(false)}
          onAdded={async (added) => {
            await queryClient.invalidateQueries({ queryKey: ['workspace-members'] });
            setAdding(false);
            if (added?.role === 'driver' && added?.user_id) {
              setAssigning({
                kind: 'registered',
                id: added.user_id,
                displayName: added.display_name || added.email,
              });
            }
          }}
        />
      )}

      {(addingExternal || editingExternal) && (
        <ExternalDriverFormDialog
          open={true}
          accountId={accountId}
          initial={editingExternal}
          onClose={() => { setAddingExternal(false); setEditingExternal(null); }}
          onSaved={async (driverId, driverName) => {
            await queryClient.invalidateQueries({ queryKey: ['external-drivers'] });
            const wasCreate = addingExternal && !editingExternal;
            setAddingExternal(false);
            setEditingExternal(null);
            // Chain: after CREATING a brand-new external driver, the
            // most likely next action is to assign them to a vehicle.
            // Auto-open the assignment dialog so the manager doesn't
            // need to find the row in the list and tap "+ שייך רכב".
            // Edits skip this chain (the driver already has whatever
            // assignments they need).
            if (wasCreate && driverId) {
              setAssigning({
                kind: 'external',
                id: driverId,
                displayName: driverName || 'נהג חדש',
              });
            }
          }}
        />
      )}
    </div>
  );
}

// Filter chip used at top of the list when there's data of both kinds.
function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
        active
          ? 'bg-[#2D5233] border-[#2D5233] text-white'
          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  );
}

// ----------------------------------------------------------------------

function AddMemberDialog({ accountId, onClose, onAdded }) {
  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState('driver');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) { toast.error('יש להזין אימייל'); return; }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('add_workspace_member_by_email', {
        p_account_id: accountId,
        p_email:      cleanEmail,
        p_role:       role,
      });
      if (error) throw error;
      // Refetch the directory and look up the user_id we just added by
      // email. The RPC only returns the membership row id; the parent
      // dialog needs user_id + display_name to chain into the
      // assign-vehicle step. Doing the lookup here keeps the contract
      // for onAdded simple — caller gets either everything or nothing.
      let added = { role, email: cleanEmail };
      try {
        const { data: dir } = await supabase.rpc('workspace_members_directory', {
          p_account_id: accountId,
        });
        const match = (dir || []).find(m => (m.email || '').toLowerCase() === cleanEmail.toLowerCase());
        if (match) {
          added = { ...added, user_id: match.user_id, display_name: match.display_name };
        }
      } catch { /* fall through with email only */ }
      toast.success('החבר נוסף לחשבון בהצלחה');
      onAdded?.(added);
    } catch (err) {
      const msg = err?.message || '';
      if      (msg.includes('forbidden_not_manager')) toast.error('אין לך הרשאת מנהל');
      else if (msg.includes('email_required'))        toast.error('יש להזין אימייל');
      else if (msg.includes('user_not_registered'))   toast.error('אין משתמש רשום עם האימייל הזה. שלח לו קישור להרשמה לאפליקציה ונסה שוב.');
      else if (msg.includes('already_member'))        toast.error('המשתמש כבר חבר בחשבון הזה');
      else if (msg.includes('invalid_role'))          toast.error('תפקיד לא תקין');
      else                                             toast.error('הוספת החבר נכשלה. נסה שוב.');
      // eslint-disable-next-line no-console
      console.error('add_workspace_member_by_email failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div dir="rtl" className="fixed inset-0 z-[10000] bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900">הוסף חבר לצוות</h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          המשתמש חייב להיות רשום באפליקציה. בקש ממנו להירשם דרך CarReminder ואז הזן כאן את האימייל.
        </p>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              אימייל המשתמש <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="driver@example.com"
                className="h-10 rounded-xl pr-10 text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              תפקיד <span className="text-red-500">*</span>
            </label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="h-10 rounded-xl text-sm">
                <SelectValue placeholder="בחר תפקיד" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="driver">נהג. רואה את הרכב שלו ואת המשימות שלו בלבד</SelectItem>
                <SelectItem value="שותף">צופה. רואה הכל בקריאה בלבד</SelectItem>
                <SelectItem value="מנהל">מנהל. אחראי על צי, נהגים ומשימות</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-2.5 text-[11px] text-blue-900 leading-relaxed">
            לאחר ההוספה, המשתמש יראה את החשבון העסקי במחליף הסביבות שלו בכניסה הבאה לאפליקציה.
          </div>

          <button
            type="submit"
            disabled={submitting || !email.trim()}
            className="w-full py-2.5 rounded-xl font-bold text-sm bg-[#2D5233] text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
          >
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> מוסיף...</>
              : <><UserPlus className="h-4 w-4" /> הוסף לצוות</>}
          </button>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------

function MemberRow({ member, assignments, vehicleLabel, onAssign, onOpen }) {
  const meta = roleMeta(member.role);
  const RoleIcon = meta.icon;
  // Whole row is tappable → detail page. The "שייך רכב" button still
  // works in-place for the manager's quick-action shortcut; its
  // handler stops propagation so it doesn't trigger the row open.
  return (
    <li
      onClick={onOpen}
      className="bg-white border border-gray-100 rounded-xl p-3 cursor-pointer transition-all hover:border-gray-200 active:scale-[0.99]"
    >
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${meta.cls}`}>
          <RoleIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <p className="text-sm font-bold text-gray-900 truncate">{member.display_name}</p>
            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.cls}`}>
              {meta.label}
            </span>
            <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">
              עם חשבון
            </span>
          </div>
          <p className="text-[11px] text-gray-500 truncate">{member.email}</p>
          {member.joined_at && (
            <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
              <Calendar className="h-3 w-3" />
              תאריך הצטרפות: {fmtDate(member.joined_at)}
            </p>
          )}

          {assignments.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <p className="text-[10px] font-bold text-gray-500 mb-1">רכבים מוקצים</p>
              <div className="flex flex-wrap gap-1">
                {assignments.map(a => (
                  <span key={a.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-[10px] text-gray-700">
                    <Truck className="h-3 w-3" />
                    {vehicleLabel(a.vehicle_id)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-stretch gap-1">
          <button
            type="button"
            onClick={onAssign}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#2D5233] text-white text-[11px] font-bold active:scale-[0.98]"
          >
            <Plus className="h-3.5 w-3.5" />
            שייך רכב
          </button>
        </div>
        <ChevronLeft className="h-4 w-4 text-gray-300 shrink-0 mt-2" />
      </div>
    </li>
  );
}

// External-driver row. Same visual rhythm as MemberRow: avatar +
// header line + meta + assigned-vehicles strip + inline "+ שייך רכב"
// shortcut on the side. The whole row is tappable to drill into
// /DriverDetail; the action button stops propagation so it opens the
// shared AssignDriverDialog instead of navigating.
function ExternalDriverRow({ driver, assignments, vehicleLabel, onAssign, onOpen }) {
  const expDate = driver.license_expiry_date;
  const expiringSoon = expDate
    ? (new Date(expDate) - new Date()) / (1000 * 60 * 60 * 24) < 30
    : false;
  const expired = expDate ? new Date(expDate) < new Date() : false;
  return (
    <li
      onClick={onOpen}
      className="bg-white border border-gray-100 rounded-xl p-3 cursor-pointer transition-all hover:border-gray-200 active:scale-[0.99]"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-amber-50 text-amber-700">
          <IdCard className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <p className="text-sm font-bold text-gray-900 truncate">{driver.full_name}</p>
            <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">
              ללא חשבון
            </span>
            {expired && (
              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700">
                רישיון פג
              </span>
            )}
            {!expired && expiringSoon && (
              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 text-orange-700">
                רישיון פוגג
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 flex items-center gap-1 truncate" dir="ltr">
            <Phone className="h-3 w-3 shrink-0 text-gray-400" />
            <span className="truncate">{driver.phone}</span>
          </p>
          {Array.isArray(driver.license_categories) && driver.license_categories.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {driver.license_categories.slice(0, 6).map(c => (
                <span key={c} className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-gray-50 text-[10px] text-gray-700">
                  {categoryShortLabel(c)}
                </span>
              ))}
              {driver.license_categories.length > 6 && (
                <span className="text-[10px] text-gray-400">+{driver.license_categories.length - 6}</span>
              )}
            </div>
          )}
          {expDate && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              רישיון תקף עד: {fmtDate(expDate)}
            </p>
          )}

          {assignments.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <p className="text-[10px] font-bold text-gray-500 mb-1">רכבים מוקצים</p>
              <div className="flex flex-wrap gap-1">
                {assignments.map(a => (
                  <span key={a.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-50 text-[10px] text-gray-700">
                    <Truck className="h-3 w-3" />
                    {vehicleLabel(a.vehicle_id)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-stretch gap-1">
          <button
            type="button"
            onClick={onAssign}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#2D5233] text-white text-[11px] font-bold active:scale-[0.98]"
          >
            <Plus className="h-3.5 w-3.5" />
            שייך רכב
          </button>
        </div>
        <ChevronLeft className="h-4 w-4 text-gray-300 shrink-0 mt-2" />
      </div>
    </li>
  );
}

// AssignVehicleDialog removed — replaced by the shared
// components/drivers/AssignDriverDialog component which handles both
// kinds of drivers (registered + external) with a single 3-state
// (permanent/temporary/future) toggle.

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

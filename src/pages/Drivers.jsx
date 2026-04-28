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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase, UserPlus, Truck, Loader2, Plus, X,
  Crown, Shield, Eye, User as UserIcon, Calendar, Mail,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';

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

  const [assigning, setAssigning] = useState(null); // null | { user_id, display_name }
  const [adding,    setAdding]    = useState(false);

  // Member directory — names via the SECURITY DEFINER RPC.
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['workspace-members', accountId],
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

  // Active driver assignments for the workspace.
  const { data: assignments = [] } = useQuery({
    queryKey: ['driver-assignments', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_assignments')
        .select('id, driver_user_id, vehicle_id, valid_from, valid_to, status')
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
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId && canManageRoutes && isBusiness,
    staleTime: 5 * 60 * 1000,
  });

  // Group assignments by driver for fast lookup in the row renderer.
  const assignmentsByDriver = useMemo(() => {
    const map = {};
    for (const a of assignments) {
      if (!map[a.driver_user_id]) map[a.driver_user_id] = [];
      map[a.driver_user_id].push(a);
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

  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }

  if (!isAuthenticated) {
    return <Empty text="צריך להתחבר כדי לראות את חברי הסביבה." />;
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
        title="אין הרשאה לניהול חברי הסביבה"
        text="ניהול חברים והקצאות שמור לבעלים ולמנהלים בלבד."
      />
    );
  }

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">נהגים וחברי הסביבה</h1>
          <p className="text-xs text-gray-500 truncate">
            ניהול תפקידים והקצאת רכבים לנהגים
            <span className="text-gray-400">{` · ${members.length} ${members.length === 1 ? 'חבר' : 'חברים'}`}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#2D5233] text-white text-xs font-bold active:scale-[0.98]"
        >
          <UserPlus className="h-4 w-4" />
          הוסף נהג
        </button>
      </div>

      {membersLoading ? (
        <p className="text-center text-xs text-gray-400 py-6">טוען חברים...</p>
      ) : members.length === 0 ? (
        <Empty
          icon={<UserPlus className="h-10 w-10 text-gray-300" />}
          title="עוד אין חברים בסביבה"
          text='הוסף נהג קיים לפי כתובת אימייל. הנהג חייב להיות רשום באפליקציה.'
          embedded
        />
      ) : (
        <ul className="space-y-2">
          {members.map(m => (
            <MemberRow
              key={m.user_id}
              member={m}
              assignments={assignmentsByDriver[m.user_id] || []}
              vehicleLabel={vehicleLabel}
              onAssign={() => setAssigning({ user_id: m.user_id, display_name: m.display_name })}
            />
          ))}
        </ul>
      )}

      {assigning && (
        <AssignVehicleDialog
          driver={assigning}
          vehicles={vehicles}
          accountId={accountId}
          existingAssignments={assignmentsByDriver[assigning.user_id] || []}
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
          onAdded={async () => {
            await queryClient.invalidateQueries({ queryKey: ['workspace-members'] });
            setAdding(false);
          }}
        />
      )}
    </div>
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
      toast.success('החבר נוסף לחשבון בהצלחה');
      onAdded?.();
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
          <h2 className="text-lg font-bold text-gray-900">הוסף חבר לחשבון</h2>
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
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="driver@example.com"
                className="w-full pr-10 pl-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              תפקיד <span className="text-red-500">*</span>
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
            >
              <option value="driver">נהג. רואה את הרכב שלו ומסלולים שלו בלבד</option>
              <option value="שותף">צופה. רואה הכל בקריאה בלבד</option>
              <option value="מנהל">מנהל. אחראי על צי, נהגים ומסלולים</option>
            </select>
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
              : <><UserPlus className="h-4 w-4" /> הוסף לחשבון</>}
          </button>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------

function MemberRow({ member, assignments, vehicleLabel, onAssign }) {
  const meta = roleMeta(member.role);
  const RoleIcon = meta.icon;
  return (
    <li className="bg-white border border-gray-100 rounded-xl p-3">
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${meta.cls}`}>
          <RoleIcon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-bold text-gray-900 truncate">{member.display_name}</p>
            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.cls}`}>
              {meta.label}
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
        <button
          type="button"
          onClick={onAssign}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#2D5233] text-white text-[11px] font-bold active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" />
          שייך רכב
        </button>
      </div>
    </li>
  );
}

// ----------------------------------------------------------------------

function AssignVehicleDialog({ driver, vehicles, accountId, existingAssignments, onClose, onAssigned }) {
  const [vehicleId, setVehicleId] = useState('');
  const [validTo, setValidTo]     = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Vehicles already assigned to this driver — not shown in the dropdown
  // to avoid trivial double-assignment. The RPC handles upsert anyway.
  const assignedIds = new Set(existingAssignments.map(a => a.vehicle_id));
  const available = vehicles.filter(v => !assignedIds.has(v.id));

  const submit = async (e) => {
    e.preventDefault();
    if (!vehicleId) { toast.error('יש לבחור רכב'); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('assign_driver', {
        p_account_id:     accountId,
        p_vehicle_id:     vehicleId,
        p_driver_user_id: driver.user_id,
        p_valid_from:     new Date().toISOString(),
        p_valid_to:       validTo || null,
      });
      if (error) throw error;
      toast.success(`הרכב שויך ל-${driver.display_name}`);
      onAssigned?.();
    } catch (err) {
      const msg = err?.message || '';
      if      (msg.includes('forbidden_not_manager'))    toast.error('אין לך הרשאת מנהל בחשבון הזה');
      else if (msg.includes('vehicle_not_in_workspace')) toast.error('הרכב שנבחר לא שייך לחשבון העסקי');
      else if (msg.includes('driver_not_workspace_member')) toast.error('הנהג שנבחר אינו חבר פעיל בחשבון');
      else                                                 toast.error('השיוך נכשל. נסה שוב.');
      // eslint-disable-next-line no-console
      console.error('assign_driver failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div dir="rtl" className="fixed inset-0 z-[10000] bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900">שיוך רכב לנהג</h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">{driver.display_name}</p>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">רכב לשיוך <span className="text-red-500">*</span></label>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
            >
              <option value="">בחר רכב...</option>
              {available.map(v => (
                <option key={v.id} value={v.id}>
                  {v.nickname || v.license_plate || `${v.manufacturer || ''} ${v.model || ''}`.trim()}
                </option>
              ))}
            </select>
            {available.length === 0 && (
              <p className="text-[11px] text-gray-500 mt-1">
                כל רכבי הצי כבר משויכים לנהג הזה.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">תוקף עד (לא חובה)</label>
            <input
              type="date"
              value={validTo}
              onChange={(e) => setValidTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              ללא תאריך, השיוך נשאר פתוח עד שתסיים אותו ידנית.
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting || !vehicleId || available.length === 0}
            className="w-full py-2.5 rounded-xl font-bold text-sm bg-[#2D5233] text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'שייך רכב'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------

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

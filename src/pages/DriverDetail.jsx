/**
 * DriverDetail — manager-only screen reachable by tapping a row in
 * /Drivers. Two URL shapes drive what's shown:
 *
 *   /DriverDetail?type=external&id=<external_drivers.id>
 *   /DriverDetail?type=user&id=<auth.users.id>
 *
 * For external drivers the page shows the full roster record + license
 * + active/historical assignments + edit/archive/assign actions.
 *
 * For registered (account-member) drivers the page is intentionally
 * thinner for now — name, email, role, current assignments, and the
 * existing "שייך רכב" action. We can expand later when there's more
 * to show (driving log, etc.).
 *
 * NOT in the side menu — this page is opened from the Drivers list
 * only. (Layout.jsx doesn't expose it.)
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IdCard, Phone, Mail, Calendar, Truck, Pencil, Archive, Plus,
  Image as ImageIcon, ExternalLink, AlertTriangle, X, Crown, Shield, Eye, User as UserIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import MobileBackButton from '@/components/shared/MobileBackButton';
import {
  getExternalDriver,
  archiveExternalDriver,
  endDriverAssignment,
  listAssignmentsForExternalDriver,
  categoryShortLabel,
  categoryEmoji,
} from '@/services/drivers';
import { refreshSignedUrl } from '@/lib/supabaseStorage';
import ExternalDriverFormDialog from '@/components/drivers/ExternalDriverFormDialog';
import AssignDriverDialog from '@/components/drivers/AssignDriverDialog';
import { createPageUrl } from '@/utils';

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('he-IL') : '';

// Status of license expiry — drives the chip + banner on the page.
function expiryStatus(date) {
  if (!date) return null;
  const days = (new Date(date) - new Date()) / (1000 * 60 * 60 * 24);
  if (days < 0)  return { kind: 'expired',  label: 'הרישיון פג', cls: 'bg-red-50 text-red-700 border-red-200' };
  if (days < 30) return { kind: 'soon',     label: 'הרישיון פוגג בקרוב', cls: 'bg-orange-50 text-orange-700 border-orange-200' };
  return null;
}

const ROLE_META = {
  'בעלים':  { label: 'בעלים', icon: Crown,  cls: 'text-purple-700 bg-purple-50' },
  'מנהל':   { label: 'מנהל',  icon: Shield, cls: 'text-[#2D5233] bg-[#E8F2EA]' },
  'שותף':   { label: 'צופה',  icon: Eye,    cls: 'text-blue-700 bg-blue-50' },
  'driver': { label: 'נהג',   icon: Truck,  cls: 'text-orange-700 bg-orange-50' },
};

export default function DriverDetail() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type');  // 'external' | 'user'
  const id   = params.get('id');
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, canManageRoutes, isLoading: roleLoading } = useWorkspaceRole();

  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated) {
    return <Centered text="צריך להתחבר" />;
  }
  if (!isBusiness || !canManageRoutes) {
    return <Centered text="הצפייה בנתוני נהג שמורה למנהלי החשבון העסקי" />;
  }
  if (!type || !id) {
    return <Centered text="חסרים פרטים בקישור. חזור לרשימת הנהגים." />;
  }

  return type === 'external'
    ? <ExternalDriverDetail externalDriverId={id} accountId={accountId} navigate={navigate} />
    : <RegisteredDriverDetail userId={id} accountId={accountId} navigate={navigate} />;
}

// ─────────────────────────────────────────────────────────────────────
// External driver detail
// ─────────────────────────────────────────────────────────────────────

function ExternalDriverDetail({ externalDriverId, accountId, navigate }) {
  const queryClient = useQueryClient();
  const [editing, setEditing]   = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(null); // assignment_id | null

  const { data: driver, isLoading } = useQuery({
    queryKey: ['external-driver', externalDriverId],
    queryFn:  () => getExternalDriver(externalDriverId),
    enabled:  !!externalDriverId,
    staleTime: 30 * 1000,
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery({
    queryKey: ['external-driver-assignments', externalDriverId, accountId],
    queryFn:  () => listAssignmentsForExternalDriver({ accountId, externalDriverId }),
    enabled:  !!externalDriverId && !!accountId,
    staleTime: 30 * 1000,
  });

  // Vehicle metadata — feed the assignment rows + the assign dialog dropdown.
  const { data: vehicles = [] } = useQuery({
    queryKey: ['drivers-vehicle-list', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, nickname, manufacturer, model, year, license_plate, vehicle_type')
        .eq('account_id', accountId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000,
  });

  const vehicleById = useMemo(() => Object.fromEntries(vehicles.map(v => [v.id, v])), [vehicles]);

  const vehicleLabel = (vid) => {
    const v = vehicleById[vid];
    if (!v) return 'רכב לא ידוע';
    return v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ') || v.license_plate || 'רכב';
  };

  const activeAssignments = assignments.filter(a => a.status === 'active');
  const historyAssignments = assignments.filter(a => a.status !== 'active').slice(0, 10);

  if (isLoading) return <Centered text="טוען..." />;
  if (!driver)   return <Centered text="הנהג לא נמצא" />;

  const expStatus = expiryStatus(driver.license_expiry_date);
  const isArchived = driver.status === 'archived';

  const openLicensePhoto = async () => {
    if (!driver.license_photo_url && !driver.license_photo_storage_path) return;
    let url = driver.license_photo_url;
    if (driver.license_photo_storage_path) {
      try {
        const fresh = await refreshSignedUrl(driver.license_photo_storage_path);
        if (fresh) url = fresh;
      } catch { /* fall through */ }
    }
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const doArchive = async () => {
    setArchiving(false);
    try {
      await archiveExternalDriver(externalDriverId);
      await queryClient.invalidateQueries({ queryKey: ['external-drivers'] });
      await queryClient.invalidateQueries({ queryKey: ['external-driver', externalDriverId] });
      await queryClient.invalidateQueries({ queryKey: ['driver-assignments'] });
      toast.success('הנהג הועבר לארכיון');
      navigate(createPageUrl('Drivers'));
    } catch (err) {
      console.error('archive failed:', err);
      toast.error('שגיאה בארכוב הנהג');
    }
  };

  const doEndAssignment = async () => {
    const assignmentId = confirmEnd;
    setConfirmEnd(null);
    if (!assignmentId) return;
    try {
      await endDriverAssignment(assignmentId);
      await queryClient.invalidateQueries({ queryKey: ['external-driver-assignments', externalDriverId] });
      await queryClient.invalidateQueries({ queryKey: ['driver-assignments'] });
      toast.success('השיבוץ הסתיים');
    } catch (err) {
      console.error('end assignment failed:', err);
      toast.error('שגיאה בסיום השיבוץ');
    }
  };

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2 pb-10">
      <MobileBackButton />

      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center bg-amber-50 text-amber-700">
          <IdCard className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h1 className="text-xl font-bold text-gray-900 truncate">{driver.full_name}</h1>
            <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700">
              ללא חשבון
            </span>
            {isArchived && (
              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">
                בארכיון
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">נהג בצי, ללא יוזר באפליקציה</p>
        </div>
        {!isArchived && (
          <div className="shrink-0 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="h-9 px-3 rounded-xl bg-white border border-gray-200 text-[#2D5233] text-xs font-bold flex items-center gap-1.5"
              aria-label="ערוך"
            >
              <Pencil className="h-3.5 w-3.5" />
              ערוך
            </button>
            <button
              type="button"
              onClick={() => setArchiving(true)}
              className="h-9 px-3 rounded-xl bg-white border border-red-200 text-red-700 text-xs font-bold flex items-center gap-1.5"
              aria-label="העבר לארכיון"
            >
              <Archive className="h-3.5 w-3.5" />
              ארכיון
            </button>
          </div>
        )}
      </div>

      {expStatus && (
        <div className={`rounded-xl px-3 py-2 mb-3 flex items-center gap-2 text-xs font-bold border ${expStatus.cls}`}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {expStatus.label} ({fmtDate(driver.license_expiry_date)})
        </div>
      )}

      {/* Contact info */}
      <Card title="פרטי קשר">
        <Row icon={Phone} label="טלפון" value={driver.phone} dir="ltr" />
        <Row icon={Mail} label="אימייל" value={driver.email || 'לא הוזן'} dir="ltr" />
        <Row icon={Calendar} label="תאריך לידה" value={fmtDate(driver.birth_date) || 'לא הוזן'} />
      </Card>

      {/* License */}
      <Card title="רישיון נהיגה">
        <Row icon={IdCard} label="מספר רישיון" value={driver.license_number || 'לא הוזן'} dir="ltr" />
        <Row icon={Calendar} label="תוקף עד" value={fmtDate(driver.license_expiry_date) || 'לא הוזן'} />
        {Array.isArray(driver.license_categories) && driver.license_categories.length > 0 ? (
          <div className="mt-1">
            <p className="text-[10px] font-bold text-gray-500 mb-1">קטגוריות</p>
            <div className="flex flex-wrap gap-1.5">
              {driver.license_categories.map(c => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 text-[11px] text-gray-700 border border-gray-200"
                >
                  <span>{categoryEmoji(c) || '•'}</span>
                  <span className="font-medium">{categoryShortLabel(c)}</span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-gray-400 mt-1">לא הוזנו קטגוריות רישיון</p>
        )}

        {(driver.license_photo_url || driver.license_photo_storage_path) ? (
          <button
            type="button"
            onClick={openLicensePhoto}
            className="mt-3 w-full h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 bg-white border border-gray-200 text-[#2D5233] active:scale-[0.99]"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            צפה בתמונת הרישיון
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : (
          <p className="text-[11px] text-gray-400 mt-3 text-center">תמונת רישיון לא הועלתה</p>
        )}
      </Card>

      {/* Active assignments */}
      <Card
        title="שיבוצים פעילים"
        right={
          !isArchived && (
            <button
              type="button"
              onClick={() => setAssigning(true)}
              className="h-8 px-3 rounded-lg bg-[#2D5233] text-white text-[11px] font-bold flex items-center gap-1 active:scale-[0.98]"
            >
              <Plus className="h-3 w-3" />
              שבץ לרכב
            </button>
          )
        }
      >
        {assignmentsLoading ? (
          <p className="text-center text-xs text-gray-400 py-2">טוען...</p>
        ) : activeAssignments.length === 0 ? (
          <p className="text-[11px] text-gray-400 py-2 text-center">אין שיבוצים פעילים כרגע</p>
        ) : (
          <ul className="space-y-2">
            {activeAssignments.map(a => (
              <AssignmentItem
                key={a.id}
                assignment={a}
                vehicleLabel={vehicleLabel}
                onEnd={() => setConfirmEnd(a.id)}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* History */}
      {historyAssignments.length > 0 && (
        <Card title="היסטוריית שיבוצים">
          <ul className="space-y-1.5">
            {historyAssignments.map(a => (
              <li key={a.id} className="text-[11px] text-gray-500 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Truck className="h-3 w-3" />
                  {vehicleLabel(a.vehicle_id)}
                </span>
                <span className="text-gray-400">
                  {fmtDate(a.valid_from)}{a.valid_to ? ` - ${fmtDate(a.valid_to)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {driver.notes && (
        <Card title="הערות">
          <p className="text-xs text-gray-700 whitespace-pre-wrap">{driver.notes}</p>
        </Card>
      )}

      {/* Edit dialog */}
      {editing && (
        <ExternalDriverFormDialog
          open={true}
          accountId={accountId}
          initial={driver}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['external-driver', externalDriverId] });
            await queryClient.invalidateQueries({ queryKey: ['external-drivers'] });
            setEditing(false);
          }}
        />
      )}

      {/* Assign dialog — shared between Drivers list and detail screen */}
      {assigning && (
        <AssignDriverDialog
          open
          accountId={accountId}
          driver={{ kind: 'external', id: driver.id, displayName: driver.full_name }}
          vehicles={vehicles}
          existingAssignments={activeAssignments}
          onClose={() => setAssigning(false)}
          onAssigned={async () => {
            await queryClient.invalidateQueries({ queryKey: ['external-driver-assignments', externalDriverId] });
            await queryClient.invalidateQueries({ queryKey: ['driver-assignments'] });
            setAssigning(false);
          }}
        />
      )}

      {/* Confirm archive */}
      <AlertDialog open={archiving} onOpenChange={setArchiving}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>להעביר לארכיון את {driver.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              הנהג יוסר מהרשימה הפעילה וכל השיבוצים הפעילים שלו יסתיימו אוטומטית.
              ההיסטוריה תישמר. ניתן לראות נהגים מארכיון בעתיד דרך פילטר.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={doArchive} className="bg-red-600 hover:bg-red-700 text-white">
              העבר לארכיון
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm end-assignment */}
      <AlertDialog open={!!confirmEnd} onOpenChange={(v) => { if (!v) setConfirmEnd(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>לסיים את השיבוץ?</AlertDialogTitle>
            <AlertDialogDescription>
              השיבוץ ייסגר עכשיו. ההיסטוריה תישמר וניתן יהיה לשבץ את הנהג מחדש לאותו רכב.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={doEndAssignment} className="bg-red-600 hover:bg-red-700 text-white">
              סיים שיבוץ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Registered (account-member) driver detail — thin wrapper for now
// ─────────────────────────────────────────────────────────────────────

function RegisteredDriverDetail({ userId, accountId, navigate }) {
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(null);

  // Get the member from workspace_members_directory.
  const { data: member, isLoading } = useQuery({
    queryKey: ['workspace-member', accountId, userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('workspace_members_directory', {
        p_account_id: accountId,
      });
      if (error) throw error;
      return (data || []).find(m => m.user_id === userId) || null;
    },
    enabled: !!accountId && !!userId,
    staleTime: 60 * 1000,
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ['user-driver-assignments', accountId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_assignments')
        .select('id, vehicle_id, valid_from, valid_to, status, created_at')
        .eq('account_id', accountId)
        .eq('driver_user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && !!userId,
    staleTime: 30 * 1000,
  });

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
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000,
  });

  const vehicleById = useMemo(() => Object.fromEntries(vehicles.map(v => [v.id, v])), [vehicles]);
  const vehicleLabel = (vid) => {
    const v = vehicleById[vid];
    if (!v) return 'רכב לא ידוע';
    return v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ') || v.license_plate || 'רכב';
  };

  const active  = assignments.filter(a => a.status === 'active');
  const history = assignments.filter(a => a.status !== 'active').slice(0, 10);

  const doEndAssignment = async () => {
    const aid = confirmEnd;
    setConfirmEnd(null);
    if (!aid) return;
    try {
      await endDriverAssignment(aid);
      await queryClient.invalidateQueries({ queryKey: ['user-driver-assignments', accountId, userId] });
      await queryClient.invalidateQueries({ queryKey: ['driver-assignments'] });
      toast.success('השיבוץ הסתיים');
    } catch (err) {
      console.error('end assignment failed:', err);
      toast.error('שגיאה בסיום השיבוץ');
    }
  };

  if (isLoading) return <Centered text="טוען..." />;
  if (!member)   return <Centered text="המשתמש לא נמצא" />;

  const meta = ROLE_META[member.role] || { label: member.role, icon: UserIcon, cls: 'text-gray-700 bg-gray-100' };
  const RoleIcon = meta.icon;

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2 pb-10">
      <MobileBackButton />

      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center ${meta.cls}`}>
          <RoleIcon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h1 className="text-xl font-bold text-gray-900 truncate">{member.display_name}</h1>
            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.cls}`}>
              {meta.label}
            </span>
            <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">
              עם חשבון
            </span>
          </div>
          <p className="text-xs text-gray-500">{member.email}</p>
        </div>
      </div>

      <Card title="פרטים">
        <Row icon={Mail} label="אימייל" value={member.email} dir="ltr" />
        {member.joined_at && (
          <Row icon={Calendar} label="הצטרף" value={fmtDate(member.joined_at)} />
        )}
      </Card>

      <Card
        title="שיבוצים פעילים"
        right={
          <button
            type="button"
            onClick={() => setAssigning(true)}
            className="h-8 px-3 rounded-lg bg-[#2D5233] text-white text-[11px] font-bold flex items-center gap-1 active:scale-[0.98]"
          >
            <Plus className="h-3 w-3" />
            שייך רכב
          </button>
        }
      >
        {active.length === 0 ? (
          <p className="text-[11px] text-gray-400 py-2 text-center">אין שיבוצים פעילים</p>
        ) : (
          <ul className="space-y-2">
            {active.map(a => (
              <AssignmentItem
                key={a.id}
                assignment={a}
                vehicleLabel={vehicleLabel}
                onEnd={() => setConfirmEnd(a.id)}
              />
            ))}
          </ul>
        )}
      </Card>

      {history.length > 0 && (
        <Card title="היסטוריית שיבוצים">
          <ul className="space-y-1.5">
            {history.map(a => (
              <li key={a.id} className="text-[11px] text-gray-500 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Truck className="h-3 w-3" />
                  {vehicleLabel(a.vehicle_id)}
                </span>
                <span className="text-gray-400">
                  {fmtDate(a.valid_from)}{a.valid_to ? ` - ${fmtDate(a.valid_to)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {assigning && (
        <AssignDriverDialog
          open
          accountId={accountId}
          driver={{ kind: 'registered', id: userId, displayName: member.display_name }}
          vehicles={vehicles}
          existingAssignments={active}
          onClose={() => setAssigning(false)}
          onAssigned={async () => {
            await queryClient.invalidateQueries({ queryKey: ['user-driver-assignments', accountId, userId] });
            await queryClient.invalidateQueries({ queryKey: ['driver-assignments'] });
            setAssigning(false);
          }}
        />
      )}

      <AlertDialog open={!!confirmEnd} onOpenChange={(v) => { if (!v) setConfirmEnd(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>לסיים את השיבוץ?</AlertDialogTitle>
            <AlertDialogDescription>השיבוץ ייסגר עכשיו, ההיסטוריה תישמר.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={doEndAssignment} className="bg-red-600 hover:bg-red-700 text-white">
              סיים שיבוץ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function Card({ title, right, children }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-3.5 mb-3">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}

function Row({ icon: Icon, label, value, dir }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-gray-50 last:border-b-0">
      <Icon className="h-3.5 w-3.5 text-gray-400 shrink-0" />
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-gray-900 font-medium mr-auto truncate" dir={dir}>{value}</span>
    </div>
  );
}

function AssignmentItem({ assignment, vehicleLabel, onEnd }) {
  const isTemp = !!assignment.valid_to;
  const isFuture = assignment.valid_from && new Date(assignment.valid_from) > new Date();
  return (
    <li className="bg-gray-50 rounded-xl p-2.5 flex items-center gap-2">
      <Truck className="h-4 w-4 text-[#2D5233] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 truncate">{vehicleLabel(assignment.vehicle_id)}</p>
        <p className="text-[10px] text-gray-500">
          {isFuture
            ? `מתחיל ${fmtDate(assignment.valid_from)}`
            : isTemp
              ? `זמני · עד ${fmtDate(assignment.valid_to)}`
              : 'שיבוץ קבוע'}
        </p>
      </div>
      <button
        type="button"
        onClick={onEnd}
        className="shrink-0 h-8 w-8 rounded-lg bg-white border border-gray-200 text-red-600 flex items-center justify-center"
        aria-label="סיים שיבוץ"
        title="סיים שיבוץ"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function Centered({ text }) {
  return (
    <div dir="rtl" className="max-w-md mx-auto py-16 px-6 text-center">
      <p className="text-sm text-gray-500">{text}</p>
    </div>
  );
}

// Assign dialogs were extracted into the shared
// components/drivers/AssignDriverDialog component (used here AND in
// the /Drivers list). Keeps the two flows visually + behaviorally
// identical with one source of truth for validation, error mapping,
// and the 3-state (permanent/temporary/future) toggle.

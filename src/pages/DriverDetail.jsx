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
import {
  getExternalDriver,
  archiveExternalDriver,
  endDriverAssignment,
  listAssignmentsForExternalDriver,
  categoryShortLabel,
  categoryEmoji,
} from '@/services/drivers';
// Living Dashboard system - shared with all B2B pages.
// We import Card as SystemCard because this file already declares a
// local <Card> helper (now renamed InfoSection) for the per-section
// surface. Using SystemCard for the page-level wrappers keeps the
// distinction clear at every call site.
import {
  PageShell,
  Card as SystemCard,
  KpiTile,
  AnimatedCount,
} from '@/components/business/system';
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

  // Days until / since the license expiry — drives the KPI tile and
  // the alert banner. null when no expiry was recorded.
  const expiryDays = driver.license_expiry_date
    ? Math.ceil((new Date(driver.license_expiry_date) - new Date()) / (1000 * 60 * 60 * 24))
    : null;
  // Tone for the expiry KPI: red when negative, amber under 30, emerald otherwise.
  const expiryTone = expiryDays === null
    ? 'blue'
    : expiryDays < 0 ? 'red'
    : expiryDays < 30 ? 'amber'
    : 'emerald';

  return (
    <PageShell
      title={driver.full_name}
      subtitle="נהג בצי, ללא יוזר באפליקציה"
      actions={!isArchived && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="h-10 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: '#FFFFFF', color: '#10B981', border: '1.5px solid #D1FAE5' }}
            aria-label="ערוך"
          >
            <Pencil className="h-3.5 w-3.5" />
            ערוך
          </button>
          <button
            type="button"
            onClick={() => setArchiving(true)}
            className="h-10 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: '#FFFFFF', color: '#991B1B', border: '1.5px solid #FECACA' }}
            aria-label="העבר לארכיון"
          >
            <Archive className="h-3.5 w-3.5" />
            ארכיון
          </button>
        </div>
      )}
    >
      {/* Identity hero — avatar + name + status chips. The driver's name
          already reads as the page H1 (rendered by PageShell), so the
          hero leans on the chips and avatar to set the visual identity. */}
      <SystemCard accent="amber" className="mb-4">
        <div className="flex items-center gap-3">
          <div
            className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #92400E 0%, #F59E0B 80%, #FCD34D 100%)',
              color: '#FFFFFF',
              boxShadow: '0 8px 20px rgba(245,158,11,0.32)',
            }}
          >
            <IdCard className="h-7 w-7" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: '#FFFBEB', color: '#92400E' }}
              >
                ללא חשבון
              </span>
              {isArchived && (
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ background: '#F0F7F4', color: '#4B5D52' }}
                >
                  בארכיון
                </span>
              )}
              {driver.phone && (
                <a
                  href={`tel:${driver.phone}`}
                  dir="ltr"
                  className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md inline-flex items-center gap-1 hover:bg-emerald-50/60"
                  style={{ background: '#F0F7F4', color: '#0B2912' }}
                >
                  <Phone className="h-3 w-3" style={{ color: '#10B981' }} />
                  {driver.phone}
                </a>
              )}
            </div>
          </div>
        </div>
      </SystemCard>

      {/* KPI Strip — quick health snapshot for this driver */}
      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <KpiTile
          label="שיבוצים פעילים"
          value={<AnimatedCount value={activeAssignments.length} />}
          sub={activeAssignments.length === 0 ? 'אין שיבוץ פעיל' : 'רכבים מוקצים כעת'}
          tone="emerald"
        />
        <KpiTile
          label={expiryDays === null ? 'תוקף רישיון' : expiryDays < 0 ? 'הרישיון פג' : 'ימים לפקיעה'}
          value={
            expiryDays === null
              ? '—'
              : expiryDays < 0
                ? <AnimatedCount value={Math.abs(expiryDays)} />
                : <AnimatedCount value={expiryDays} />
          }
          sub={fmtDate(driver.license_expiry_date) || 'לא הוזן תוקף'}
          tone={expiryTone}
        />
        <KpiTile
          label="היסטוריה"
          value={<AnimatedCount value={historyAssignments.length} />}
          sub={historyAssignments.length === 0 ? 'אין שיבוצים קודמים' : 'שיבוצים שהסתיימו'}
          tone="purple"
        />
      </section>

      {expStatus && (
        <SystemCard
          accent={expStatus.kind === 'expired' ? 'red' : 'amber'}
          className="mb-4"
          padding="px-3.5 py-2.5"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="h-4 w-4 shrink-0"
              style={{ color: expStatus.kind === 'expired' ? '#991B1B' : '#92400E' }}
            />
            <p
              className="text-xs font-bold"
              style={{ color: expStatus.kind === 'expired' ? '#991B1B' : '#92400E' }}
            >
              {expStatus.label} ({fmtDate(driver.license_expiry_date)})
            </p>
          </div>
        </SystemCard>
      )}

      {/* Contact info */}
      <InfoSection title="פרטי קשר" accent="emerald">
        <Row icon={Phone} label="טלפון" value={driver.phone} dir="ltr" />
        <Row icon={Mail} label="אימייל" value={driver.email || 'לא הוזן'} dir="ltr" />
        <Row icon={Calendar} label="תאריך לידה" value={fmtDate(driver.birth_date) || 'לא הוזן'} />
      </InfoSection>

      {/* License — accent escalates to red when expired */}
      <InfoSection
        title="רישיון נהיגה"
        accent={expStatus?.kind === 'expired' ? 'red' : 'amber'}
      >
        <Row icon={IdCard} label="מספר רישיון" value={driver.license_number || 'לא הוזן'} dir="ltr" />
        <Row icon={Calendar} label="תוקף עד" value={fmtDate(driver.license_expiry_date) || 'לא הוזן'} />
        {Array.isArray(driver.license_categories) && driver.license_categories.length > 0 ? (
          <div className="mt-2">
            <p className="text-[10px] font-bold mb-1.5" style={{ color: '#6B7C72' }}>קטגוריות</p>
            <div className="flex flex-wrap gap-1.5">
              {driver.license_categories.map(c => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold"
                  style={{ background: '#F0F7F4', color: '#0B2912' }}
                >
                  <span>{categoryEmoji(c) || '•'}</span>
                  <span>{categoryShortLabel(c)}</span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[11px] mt-1" style={{ color: '#A7B3AB' }}>לא הוזנו קטגוריות רישיון</p>
        )}

        {(driver.license_photo_url || driver.license_photo_storage_path) ? (
          <button
            type="button"
            onClick={openLicensePhoto}
            className="mt-3 w-full h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: '#FFFFFF', color: '#10B981', border: '1.5px solid #D1FAE5' }}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            צפה בתמונת הרישיון
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : (
          <p className="text-[11px] mt-3 text-center" style={{ color: '#A7B3AB' }}>תמונת רישיון לא הועלתה</p>
        )}
      </InfoSection>

      {/* Active assignments */}
      <InfoSection
        title="שיבוצים פעילים"
        accent="blue"
        right={
          !isArchived && (
            <button
              type="button"
              onClick={() => setAssigning(true)}
              className="h-9 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all hover:scale-[1.03] active:scale-[0.97]"
              style={{
                background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
                color: '#FFFFFF',
                boxShadow: '0 4px 12px rgba(16,185,129,0.25)',
              }}
            >
              <Plus className="h-3 w-3" />
              שבץ לרכב
            </button>
          )
        }
      >
        {assignmentsLoading ? (
          <p className="text-center text-xs py-2" style={{ color: '#6B7C72' }}>טוען...</p>
        ) : activeAssignments.length === 0 ? (
          <p className="text-[11px] py-2 text-center" style={{ color: '#A7B3AB' }}>אין שיבוצים פעילים כרגע</p>
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
      </InfoSection>

      {/* History */}
      {historyAssignments.length > 0 && (
        <InfoSection title="היסטוריית שיבוצים" accent="purple">
          <ul className="space-y-1.5">
            {historyAssignments.map(a => (
              <li
                key={a.id}
                className="text-[11px] flex items-center justify-between py-1"
                style={{ color: '#6B7C72' }}
              >
                <span className="flex items-center gap-1.5">
                  <Truck className="h-3 w-3" />
                  {vehicleLabel(a.vehicle_id)}
                </span>
                <span className="tabular-nums" style={{ color: '#A7B3AB' }} dir="ltr">
                  {fmtDate(a.valid_from)}{a.valid_to ? ` - ${fmtDate(a.valid_to)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </InfoSection>
      )}

      {driver.notes && (
        <InfoSection title="הערות" accent="emerald">
          <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: '#0B2912' }}>
            {driver.notes}
          </p>
        </InfoSection>
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
    </PageShell>
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
  // Map the role to a Card accent — same vocabulary as the Drivers
  // listing screen, so visual identity carries across.
  const accent = member.role === 'בעלים' ? 'purple'
    : member.role === 'מנהל'  ? 'emerald'
    : member.role === 'שותף'  ? 'blue'
    : 'amber';

  return (
    <PageShell
      title={member.display_name}
      subtitle={member.email}
    >
      {/* Identity hero — role-keyed avatar gradient + status chips */}
      <SystemCard accent={accent} className="mb-4">
        <div className="flex items-center gap-3">
          <div className={`shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center ${meta.cls}`}>
            <RoleIcon className="h-7 w-7" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.cls}`}>
                {meta.label}
              </span>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: '#EFF6FF', color: '#1E40AF' }}
              >
                עם חשבון
              </span>
            </div>
          </div>
        </div>
      </SystemCard>

      {/* KPI Strip — quick read on assignment activity */}
      <section className="grid grid-cols-2 gap-3 mb-4">
        <KpiTile
          label="שיבוצים פעילים"
          value={<AnimatedCount value={active.length} />}
          sub={active.length === 0 ? 'אין שיבוץ פעיל' : 'רכבים מוקצים'}
          tone="emerald"
        />
        <KpiTile
          label="היסטוריה"
          value={<AnimatedCount value={history.length} />}
          sub={history.length === 0 ? 'אין שיבוצים קודמים' : 'שיבוצים שהסתיימו'}
          tone="purple"
        />
      </section>

      <InfoSection title="פרטים" accent="emerald">
        <Row icon={Mail} label="אימייל" value={member.email} dir="ltr" />
        {member.joined_at && (
          <Row icon={Calendar} label="הצטרף" value={fmtDate(member.joined_at)} />
        )}
      </InfoSection>

      <InfoSection
        title="שיבוצים פעילים"
        accent="blue"
        right={
          <button
            type="button"
            onClick={() => setAssigning(true)}
            className="h-9 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all hover:scale-[1.03] active:scale-[0.97]"
            style={{
              background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
              color: '#FFFFFF',
              boxShadow: '0 4px 12px rgba(16,185,129,0.25)',
            }}
          >
            <Plus className="h-3 w-3" />
            שייך רכב
          </button>
        }
      >
        {active.length === 0 ? (
          <p className="text-[11px] py-2 text-center" style={{ color: '#A7B3AB' }}>אין שיבוצים פעילים</p>
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
      </InfoSection>

      {history.length > 0 && (
        <InfoSection title="היסטוריית שיבוצים" accent="purple">
          <ul className="space-y-1.5">
            {history.map(a => (
              <li
                key={a.id}
                className="text-[11px] flex items-center justify-between py-1"
                style={{ color: '#6B7C72' }}
              >
                <span className="flex items-center gap-1.5">
                  <Truck className="h-3 w-3" />
                  {vehicleLabel(a.vehicle_id)}
                </span>
                <span className="tabular-nums" style={{ color: '#A7B3AB' }} dir="ltr">
                  {fmtDate(a.valid_from)}{a.valid_to ? ` - ${fmtDate(a.valid_to)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </InfoSection>
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
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

// Per-section surface used inside the driver detail body. Wraps the
// system <SystemCard> with a header row that keeps the title + an
// optional right-aligned action button (e.g. "+ שייך רכב"). The header
// is not part of SystemCard so we keep it here instead of adding props
// to a shared component for a one-off layout.
function InfoSection({ title, accent, right, children }) {
  return (
    <SystemCard accent={accent} className="mb-3">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-sm font-bold" style={{ color: '#0B2912' }}>{title}</p>
        {right}
      </div>
      {children}
    </SystemCard>
  );
}

function Row({ icon: Icon, label, value, dir }) {
  return (
    <div
      className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0"
      style={{ borderBottom: '1px solid #F0F7F4' }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: '#10B981' }} />
      <span className="text-[11px] shrink-0" style={{ color: '#6B7C72' }}>{label}</span>
      <span
        className="text-xs font-bold mr-auto truncate tabular-nums"
        style={{ color: '#0B2912' }}
        dir={dir}
      >
        {value}
      </span>
    </div>
  );
}

function AssignmentItem({ assignment, vehicleLabel, onEnd }) {
  const isTemp = !!assignment.valid_to;
  const isFuture = assignment.valid_from && new Date(assignment.valid_from) > new Date();
  // Quick visual cue for assignment kind:
  //   future    → amber tint (waiting to start)
  //   temporary → blue tint  (time-bounded)
  //   permanent → mint tint  (the default)
  const tint = isFuture
    ? { bg: '#FFFBEB', icon: '#92400E' }
    : isTemp
      ? { bg: '#EFF6FF', icon: '#1E40AF' }
      : { bg: '#F0F7F4', icon: '#10B981' };
  return (
    <li
      className="rounded-xl p-2.5 flex items-center gap-2"
      style={{ background: tint.bg }}
    >
      <Truck className="h-4 w-4 shrink-0" style={{ color: tint.icon }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate" style={{ color: '#0B2912' }}>
          {vehicleLabel(assignment.vehicle_id)}
        </p>
        <p className="text-[10px]" style={{ color: '#6B7C72' }}>
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
        className="shrink-0 h-8 w-8 rounded-lg bg-white flex items-center justify-center transition-all hover:scale-[1.05] active:scale-[0.95]"
        style={{ border: '1px solid #FECACA', color: '#991B1B' }}
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
      <p className="text-sm" style={{ color: '#6B7C72' }}>{text}</p>
    </div>
  );
}

// Assign dialogs were extracted into the shared
// components/drivers/AssignDriverDialog component (used here AND in
// the /Drivers list). Keeps the two flows visually + behaviorally
// identical with one source of truth for validation, error mapping,
// and the 3-state (permanent/temporary/future) toggle.

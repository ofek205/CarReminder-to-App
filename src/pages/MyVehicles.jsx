/**
 * Phase 9, Step 9 — "Mine vehicles" page for permanent drivers.
 *
 * Shows the vehicles a driver is permanently assigned to, with the
 * three actions a driver typically needs without going through a
 * route flow:
 *   - Update mileage (driver_update_mileage RPC)
 *   - Report a non-route issue (driver_log_vehicle_event 'report_issue')
 *   - Log maintenance done (driver_log_vehicle_event 'maintenance_done')
 *
 * Visible only to driver-role members in business workspaces. RLS on
 * vehicles + driver_assignments scopes the data; the SECURITY DEFINER
 * RPCs validate authorization on each write.
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Truck, Briefcase, Loader2, Wrench, AlertTriangle, Gauge, X,
  CheckCircle, Clock, AlertCircle, ChevronLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { createPageUrl } from '@/utils';

// ---------- helpers ---------------------------------------------------

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function statusBadge(label, days) {
  if (days === null || days === undefined) {
    return { text: `${label}: לא הוזן`, cls: 'bg-gray-100 text-gray-500', Icon: Clock };
  }
  if (days < 0) {
    return { text: `${label} פג לפני ${Math.abs(days)} ימים`, cls: 'bg-red-100 text-red-700', Icon: AlertCircle };
  }
  if (days <= 30) {
    return { text: `${label} בעוד ${days} ימים`, cls: 'bg-yellow-100 text-yellow-700', Icon: AlertTriangle };
  }
  return { text: `${label} תקין`, cls: 'bg-green-100 text-green-700', Icon: CheckCircle };
}

const fmtKm = (n) => n != null ? Number(n).toLocaleString('he-IL') : 'לא הוזן';

// ---------- main page ------------------------------------------------

export default function MyVehicles() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, isDriver, isLoading: roleLoading } = useWorkspaceRole();
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const driverName = (user?.user_metadata?.full_name || user?.full_name || user?.email || '').split('@')[0].split(' ')[0];
  const workspaceName = activeWorkspace?.account_name || 'חשבון עסקי';

  const [activeAction, setActiveAction] = useState(null);
  // shape: { kind: 'mileage' | 'report_issue' | 'maintenance_done', vehicle }

  const enabled = !!accountId && isAuthenticated && isBusiness && isDriver && !!user?.id;

  // Active assignments for the current user.
  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery({
    queryKey: ['my-assignments', accountId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_assignments')
        .select('id, vehicle_id, valid_from, valid_to, status')
        .eq('account_id', accountId)
        .eq('driver_user_id', user.id)
        .eq('status', 'active');
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 60 * 1000,
  });

  // Vehicles the driver can read via the layered RLS policy.
  const vehicleIds = assignments.map(a => a.vehicle_id);
  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ['my-vehicles-detail', accountId, vehicleIds.join(',')],
    queryFn: async () => {
      if (vehicleIds.length === 0) return [];
      const all = await db.vehicles.filter({ account_id: accountId });
      return all.filter(v => vehicleIds.includes(v.id));
    },
    enabled: enabled && vehicleIds.length > 0,
    staleTime: 60 * 1000,
  });

  const isLoading = assignmentsLoading || vehiclesLoading;

  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated) {
    return <Empty text="צריך להתחבר כדי לראות את הרכבים שלך." />;
  }
  if (!isBusiness) {
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="הדף הזה זמין רק בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון."
      />
    );
  }
  if (!isDriver) {
    return (
      <Empty
        icon={<Truck className="h-10 w-10 text-gray-300" />}
        title="זמין לנהגים בלבד"
        text="הדף הזה מציג את הרכבים שמוקצים לך כנהג קבוע. אם אתה מנהל, ראה 'צי הרכבים'."
      />
    );
  }

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-vehicles-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['my-assignments'] }),
    ]);

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      {/* Driver-focused header. Establishes context (which workspace
          they're driving for) and greets by first name so the page
          doesn't feel like the same generic dashboard a manager sees.
          The workspace pill is the same green family used by the
          rest of the B2B chrome so the user recognises the visual
          contract from the workspace switcher. */}
      <div className="mb-5 bg-gradient-to-l from-[#2D5233] to-[#3A6B42] text-white rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Briefcase className="h-3.5 w-3.5 opacity-80" />
          <span className="text-[11px] font-bold opacity-90 truncate">{workspaceName}</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20">נהג</span>
        </div>
        <h1 className="text-xl font-black truncate">
          {driverName ? `שלום ${driverName}` : 'שלום'} 👋
        </h1>
        <p className="text-[11px] opacity-85 mt-1">
          {assignments.length === 0
            ? 'עוד אין רכב משויך אליך. כשהמנהל ישייך אותך לרכב — תקבל התראה ותראה אותו כאן.'
            : `${assignments.length} ${assignments.length === 1 ? 'רכב משויך' : 'רכבים משויכים'} אליך`}
        </p>
      </div>

      {isLoading ? (
        <p className="text-center text-xs text-gray-400 py-8">טוען...</p>
      ) : vehicles.length === 0 ? (
        <DriverEmptyState />
      ) : (
        <ul className="space-y-3">
          {vehicles.map(v => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              onAction={(kind) => setActiveAction({ kind, vehicle: v })}
            />
          ))}
        </ul>
      )}

      {activeAction?.kind === 'mileage' && (
        <UpdateMileageDialog
          vehicle={activeAction.vehicle}
          onClose={() => setActiveAction(null)}
          onDone={async () => { await refresh(); setActiveAction(null); }}
        />
      )}
      {activeAction?.kind === 'report_issue' && (
        <VehicleEventDialog
          vehicle={activeAction.vehicle}
          kind="report_issue"
          onClose={() => setActiveAction(null)}
          onDone={async () => { await refresh(); setActiveAction(null); }}
        />
      )}
      {activeAction?.kind === 'maintenance_done' && (
        <VehicleEventDialog
          vehicle={activeAction.vehicle}
          kind="maintenance_done"
          onClose={() => setActiveAction(null)}
          onDone={async () => { await refresh(); setActiveAction(null); }}
        />
      )}
    </div>
  );
}

// ---------- vehicle card ---------------------------------------------

function VehicleCard({ vehicle, onAction }) {
  const v = vehicle;
  const label = v.nickname || `${v.manufacturer || ''} ${v.model || ''}`.trim() || 'הרכב שלי';
  const testBadge      = useMemo(() => statusBadge('טסט',   daysUntil(v.test_due_date)),      [v.test_due_date]);
  const insuranceBadge = useMemo(() => statusBadge('ביטוח', daysUntil(v.insurance_due_date)), [v.insurance_due_date]);

  return (
    <li className="bg-white border border-gray-100 rounded-2xl p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="text-base font-bold text-gray-900 truncate">{label}</p>
            {v.license_plate && (
              <span className="text-[11px] text-gray-500 font-mono px-2 py-0.5 bg-gray-50 rounded">
                {v.license_plate}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500">
            {v.manufacturer} {v.model}{v.year ? ` · ${v.year}` : ''}
          </p>
        </div>
        <Link
          to={createPageUrl('VehicleDetail') + '?id=' + v.id}
          className="shrink-0 text-[11px] font-bold text-[#2D5233] flex items-center gap-0.5"
        >
          פרטים
          <ChevronLeft className="h-3 w-3" />
        </Link>
      </div>

      {/* Mileage row */}
      <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2 mb-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-gray-500" />
          <div>
            <p className="text-[10px] text-gray-500">קילומטראז' נוכחי</p>
            <p className="text-sm font-bold text-gray-900">{fmtKm(v.current_km)} ק"מ</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onAction('mileage')}
          className="px-3 py-1.5 rounded-lg bg-[#2D5233] text-white text-[11px] font-bold active:scale-[0.98]"
        >
          עדכן ק"מ
        </button>
      </div>

      {/* Status badges */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Badge {...testBadge} />
        <Badge {...insuranceBadge} />
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onAction('report_issue')}
          className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-50 text-red-700 text-xs font-bold active:scale-[0.98]"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          דווח על תקלה
        </button>
        <button
          type="button"
          onClick={() => onAction('maintenance_done')}
          className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-blue-50 text-blue-700 text-xs font-bold active:scale-[0.98]"
        >
          <Wrench className="h-3.5 w-3.5" />
          תעד טיפול שעשיתי
        </button>
      </div>
    </li>
  );
}

function Badge({ text, cls, Icon }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${cls}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="text-[11px] font-bold truncate">{text}</span>
    </div>
  );
}

// ---------- dialogs --------------------------------------------------

function UpdateMileageDialog({ vehicle, onClose, onDone }) {
  const [km, setKm]                 = useState('');
  const [submitting, setSubmitting] = useState(false);
  const minKm = vehicle.current_km != null ? Number(vehicle.current_km) : 0;

  const submit = async (e) => {
    e.preventDefault();
    const n = Number(km);
    if (Number.isNaN(n) || n < 0) { toast.error('הזן מספר תקין'); return; }
    if (vehicle.current_km != null && n < Number(vehicle.current_km)) {
      toast.error(`הקילומטראז' לא יכול לרדת. הקיים: ${fmtKm(vehicle.current_km)}`);
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('driver_update_mileage', {
        p_vehicle_id: vehicle.id,
        p_new_km:     n,
      });
      if (error) throw error;
      toast.success('הקילומטראז\' עודכן');
      onDone?.();
    } catch (err) {
      const msg = err?.message || '';
      if      (msg.includes('forbidden'))         toast.error('אין לך הרשאה לעדכן את הרכב הזה');
      else if (msg.includes('km_cannot_decrease')) toast.error('הקילומטראז\' לא יכול לרדת');
      else if (msg.includes('invalid_km'))         toast.error('מספר לא תקין');
      else                                          toast.error('העדכון נכשל. נסה שוב.');
      // eslint-disable-next-line no-console
      console.error('driver_update_mileage failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogShell title="עדכון קילומטראז'" subtitle={vehicle.nickname || vehicle.license_plate || 'רכב'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            ק"מ נוכחי <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min={minKm}
            step="1"
            value={km}
            onChange={(e) => setKm(e.target.value)}
            placeholder={vehicle.current_km != null ? `מינימום: ${fmtKm(vehicle.current_km)}` : 'הזן ק"מ'}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
            autoFocus
            required
          />
          {vehicle.current_km != null && (
            <p className="text-[10px] text-gray-400 mt-1">
              הקיים במערכת: {fmtKm(vehicle.current_km)} ק"מ. ניתן לעדכן רק כלפי מעלה.
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={submitting || !km}
          className="w-full py-2.5 rounded-xl font-bold text-sm bg-[#2D5233] text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'עדכן'}
        </button>
      </form>
    </DialogShell>
  );
}

function VehicleEventDialog({ vehicle, kind, onClose, onDone }) {
  const isIssue = kind === 'report_issue';
  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [cost, setCost]               = useState('');
  const [submitting, setSubmitting]   = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { toast.error('יש להזין כותרת'); return; }
    if (cost && Number.isNaN(Number(cost))) { toast.error('עלות לא תקינה'); return; }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('driver_log_vehicle_event', {
        p_vehicle_id:  vehicle.id,
        p_kind:        kind,
        p_title:       title.trim(),
        p_description: description.trim() || null,
        p_cost:        cost ? Number(cost) : null,
      });
      if (error) throw error;
      toast.success(isIssue
        ? 'התקלה דווחה. המנהל יראה אותה בהיסטוריית הטיפולים.'
        : 'הטיפול תועד');
      onDone?.();
    } catch (err) {
      const msg = err?.message || '';
      if      (msg.includes('forbidden'))      toast.error('אין לך הרשאה לרכב הזה');
      else if (msg.includes('title_required')) toast.error('יש להזין כותרת');
      else                                      toast.error('הפעולה נכשלה. נסה שוב.');
      // eslint-disable-next-line no-console
      console.error('driver_log_vehicle_event failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogShell
      title={isIssue ? 'דיווח על תקלה' : 'תיעוד טיפול שעשיתי'}
      subtitle={vehicle.nickname || vehicle.license_plate || 'רכב'}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">
            {isIssue ? 'כותרת קצרה לתקלה' : 'מה עשית'} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isIssue ? 'לדוגמה: רעש מהמנוע' : 'לדוגמה: החלפת שמן'}
            maxLength={120}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
            autoFocus
            required
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-gray-700 mb-1">תיאור (לא חובה)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={isIssue
              ? 'מתי החל, באילו תנאים, מה ההשפעה'
              : 'פרטים נוספים שיועילו למעקב'}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
          />
        </div>

        {!isIssue && (
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">עלות (₪, לא חובה)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="אם הטיפול עלה כסף"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
            />
          </div>
        )}

        {isIssue && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-2.5 text-[11px] text-red-900 leading-relaxed">
            הדיווח יישמר בהיסטוריית הטיפולים של הרכב. המנהל יראה אותו ויוכל לטפל.
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !title.trim()}
          className={`w-full py-2.5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60 ${
            isIssue ? 'bg-red-600' : 'bg-[#2D5233]'
          }`}
        >
          {submitting
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : isIssue ? 'שלח דיווח' : 'שמור תיעוד'}
        </button>
      </form>
    </DialogShell>
  );
}

function DialogShell({ title, subtitle, onClose, children }) {
  return (
    <div dir="rtl" className="fixed inset-0 z-[10000] bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
        {subtitle && <p className="text-xs text-gray-500 mb-4">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

// ---------- driver-specific empty state ------------------------------
// Larger, more reassuring than the generic Empty card. Three "what to
// expect" rows so a brand-new driver understands the page will fill in
// once a manager assigns a vehicle, instead of staring at an unhelpful
// "no data" placeholder.
function DriverEmptyState() {
  return (
    <div dir="rtl" className="bg-white border border-gray-100 rounded-2xl p-6 sm:p-8 text-center">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-[#E8F2EA] flex items-center justify-center mb-3">
        <Truck className="h-7 w-7 text-[#2D5233]" />
      </div>
      <p className="text-base font-bold text-gray-900 mb-1.5">עוד אין רכב משויך אליך</p>
      <p className="text-xs text-gray-500 leading-relaxed mb-5 max-w-sm mx-auto">
        כשהמנהל ישייך לך רכב, הוא יופיע כאן עם פעולות מהירות. בינתיים אפשר להמתין — אין מה לעשות בצד שלך.
      </p>
      <div className="grid sm:grid-cols-3 gap-2 text-right">
        <DriverHintRow
          icon={<Gauge className="h-4 w-4 text-[#2D5233]" />}
          title="עדכון קילומטראז'"
          text="עדכן את המד אחרי כל נסיעה."
        />
        <DriverHintRow
          icon={<AlertTriangle className="h-4 w-4 text-orange-600" />}
          title="דיווח על תקלה"
          text="תקלה ברכב מגיעה ישר למנהל."
        />
        <DriverHintRow
          icon={<Wrench className="h-4 w-4 text-blue-600" />}
          title="תיעוד טיפול"
          text="טיפול שעשית מתועד ביומן הרכב."
        />
      </div>
    </div>
  );
}

function DriverHintRow({ icon, title, text }) {
  return (
    <div className="bg-gray-50 rounded-xl p-2.5">
      <div className="flex items-center gap-1.5 mb-0.5">
        {icon}
        <span className="text-[11px] font-bold text-gray-900">{title}</span>
      </div>
      <p className="text-[10px] text-gray-500 leading-snug">{text}</p>
    </div>
  );
}

// ---------- empty -----------------------------------------------------

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

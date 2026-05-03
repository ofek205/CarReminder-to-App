/**
 * Phase 6 / 11 — Create Task (Manager only).
 *
 * Polished form for creating a workspace task. Each task has:
 *   - Title + scheduled date + optional notes
 *   - One vehicle (required)
 *   - One driver assignment (optional; defaults to the vehicle's
 *     permanent driver if one exists)
 *   - One or more stops on a route. Multi-stop UX (phase 11):
 *       * First stop expanded by default; only essential fields shown.
 *       * "אפשרויות נוספות" toggle reveals stop_type, planned_time,
 *         contact name/phone, manager notes.
 *       * Adding a stop collapses the previous one (only one expanded
 *         at a time so the form stays short).
 *       * Up/Down arrows reorder; trash deletes; pencil expands.
 *       * Address can be validated via Nominatim ("בדוק כתובת"); if
 *         that fails the form still saves with a non-blocking warning.
 *
 * Backend: calls create_route_with_stops RPC. Phase 11 extended that RPC
 * to accept the new optional per-stop fields without changing its
 * signature, so old single-destination callers still work.
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Loader2, ArrowRight, Briefcase, Truck, User as UserIcon,
  MapPin, ClipboardList, Search, Check, ChevronDown, ChevronUp, X,
  Crown, Shield, Pencil, AlertTriangle, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createPageUrl } from '@/utils';
import VehiclePicker from '@/components/shared/VehiclePicker';
import MobileBackButton from '@/components/shared/MobileBackButton';
import { geocodeAddress } from '@/lib/geocode';

// ---------- helpers ---------------------------------------------------

const ROLE_TAG = {
  'בעלים': { label: 'בעלים', icon: Crown,    cls: 'bg-purple-50 text-purple-700' },
  'מנהל':  { label: 'מנהל',  icon: Shield,   cls: 'bg-[#E8F2EA] text-[#2D5233]' },
  'driver':{ label: 'נהג',   icon: Truck,    cls: 'bg-orange-50 text-orange-700' },
  'שותף':  { label: 'צופה',  icon: UserIcon, cls: 'bg-blue-50 text-blue-700' },
};

const STOP_TYPE_OPTIONS = [
  { value: '',                label: '— ללא סוג —' },
  { value: 'pickup',          label: 'איסוף' },
  { value: 'delivery',        label: 'מסירה' },
  { value: 'meeting',         label: 'פגישה' },
  { value: 'inspection',      label: 'בדיקה' },
  { value: 'vehicle_service', label: 'טיפול ברכב' },
  { value: 'other',           label: 'אחר' },
];

// Empty stop template. `geo_status` is UI-only — used to drive the badge
// on the collapsed card and the warning under the address field. Never
// sent to the RPC.
const emptyStop = () => ({
  title: '',
  address_text: '',
  driver_notes: '',
  // advanced (revealed via "אפשרויות נוספות"):
  stop_type: '',
  planned_time: '',
  contact_name: '',
  contact_phone: '',
  manager_notes: '',
  // geocoding state:
  latitude: null,
  longitude: null,
  geo_status: 'idle', // 'idle' | 'ok' | 'failed'
});

// ---------- main page ------------------------------------------------

export default function CreateRoute() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { canManageRoutes, isBusiness, isLoading: roleLoading } = useWorkspaceRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [vehicleId, setVehicleId]       = useState('');
  const [driverUserId, setDriverUserId] = useState('');
  const [driverPickedManually, setDriverPickedManually] = useState(false);
  const [title, setTitle]               = useState('');
  const [notes, setNotes]               = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [stops, setStops]               = useState([emptyStop()]);
  const [expandedIndex, setExpandedIndex] = useState(0);
  const [submitting, setSubmitting]     = useState(false);

  // Vehicles available in the workspace.
  const { data: vehicles = [] } = useQuery({
    queryKey: ['routes-vehicle-picker', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId && canManageRoutes,
    staleTime: 5 * 60 * 1000,
  });

  // Team directory — gives us display_name + phone for every active
  // member, including drivers we'd assign tasks to.
  const { data: team = [] } = useQuery({
    queryKey: ['routes-team-picker', accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('workspace_team_directory', {
        p_account_id: accountId,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canManageRoutes,
    staleTime: 5 * 60 * 1000,
  });

  // Active driver assignments — used to suggest the permanent driver
  // for the chosen vehicle. Manager can override the suggestion (e.g.
  // assign a temporary driver for one round trip).
  const { data: assignments = [] } = useQuery({
    queryKey: ['routes-driver-assignments', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_assignments')
        .select('vehicle_id, driver_user_id, valid_to, status')
        .eq('account_id', accountId)
        .eq('status', 'active');
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canManageRoutes,
    staleTime: 5 * 60 * 1000,
  });

  // Permanent driver of the chosen vehicle (if one exists).
  const permanentDriver = useMemo(() => {
    if (!vehicleId) return null;
    const a = assignments.find(x => x.vehicle_id === vehicleId && !x.valid_to);
    if (!a) return null;
    return team.find(m => m.user_id === a.driver_user_id) || null;
  }, [vehicleId, assignments, team]);

  // Auto-select the permanent driver the moment a vehicle with one is
  // chosen, but only if the manager hasn't already picked someone else.
  useEffect(() => {
    if (driverPickedManually) return;
    if (permanentDriver) {
      setDriverUserId(permanentDriver.user_id);
    } else {
      setDriverUserId('');
    }
  }, [vehicleId, permanentDriver?.user_id, driverPickedManually]);

  // ---------- guards ------------------------------------------------

  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated || !isBusiness || !canManageRoutes) {
    return (
      <div dir="rtl" className="max-w-md mx-auto py-16 text-center">
        <Briefcase className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-bold text-gray-700 mb-1">אין הרשאה ליצור משימות</p>
        <p className="text-xs text-gray-500">יצירת משימות שמורה למנהלי חשבון עסקי.</p>
      </div>
    );
  }

  // ---------- stop handlers ------------------------------------------

  const updateStop = (i, key, value) => {
    setStops(prev => prev.map((s, idx) => {
      if (idx !== i) return s;
      const next = { ...s, [key]: value };
      // Editing the address invalidates a previous geocode.
      if (key === 'address_text' && s.geo_status !== 'idle') {
        next.geo_status = 'idle';
        next.latitude = null;
        next.longitude = null;
      }
      return next;
    }));
  };

  const addStop = () => {
    setStops(prev => {
      const next = [...prev, emptyStop()];
      setExpandedIndex(next.length - 1);
      return next;
    });
  };

  const removeStop = (i) => {
    setStops(prev => {
      if (prev.length === 1) return prev;
      const next = prev.filter((_, idx) => idx !== i);
      // Keep an editable card visible after deletion.
      setExpandedIndex(Math.min(i, next.length - 1));
      return next;
    });
  };

  const moveStop = (from, to) => {
    if (to < 0 || to >= stops.length) return;
    setStops(prev => {
      const next = prev.slice();
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
    // Keep the same card expanded as it moves.
    if (expandedIndex === from) setExpandedIndex(to);
    else if (expandedIndex === to) setExpandedIndex(from);
  };

  // Geocode a single stop on demand (the "בדוק כתובת" button) or at
  // submit time. Returns the resolved status so submit-time orchestration
  // can decide whether to warn.
  const geocodeStop = async (i) => {
    const stop = stops[i];
    const q = (stop.address_text || '').trim();
    if (!q) return 'idle';
    const result = await geocodeAddress(q);
    setStops(prev => prev.map((s, idx) => {
      if (idx !== i) return s;
      if (result) {
        return { ...s, latitude: result.latitude, longitude: result.longitude, geo_status: 'ok' };
      }
      return { ...s, latitude: null, longitude: null, geo_status: 'failed' };
    }));
    return result ? 'ok' : 'failed';
  };

  // ---------- submit ------------------------------------------------

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle)  { toast.error('יש להזין שם למשימה'); return; }
    if (!vehicleId)   { toast.error('יש לבחור רכב למשימה'); return; }

    // Build the cleaned stop list. Drop stops that are entirely empty
    // (a multi-stop form with one blank trailing card shouldn't fail
    // the user — just ignore it).
    const indexed = stops.map((s, i) => ({ ...s, _i: i }));
    const populated = indexed.filter(s => s.title.trim() || s.address_text.trim());
    if (populated.length === 0) {
      toast.error('יש להזין יעד למשימה');
      return;
    }

    setSubmitting(true);
    try {
      // Try to resolve any stop that has an address but never went
      // through the manual "בדוק כתובת" button. Stops that already
      // resolved or already failed are skipped — the user has been
      // informed and accepted the warning.
      //
      // Critical: keep the resolved coords on a LOCAL `mergedStops`
      // copy and use that to build the RPC payload. Reading `stops`
      // straight from the closure here would see the pre-geocode
      // snapshot and save NULL coords even when Nominatim succeeded.
      //
      // We also call Nominatim sequentially — its usage policy caps at
      // ~1 request per second per IP, and parallel fan-out from one
      // user is the fast way to get rate-limited.
      let mergedStops = stops;
      const needsGeocode = populated.filter(s =>
        s.address_text.trim() && s.geo_status === 'idle'
      );
      for (const s of needsGeocode) {
        const result = await geocodeAddress(s.address_text.trim());
        mergedStops = mergedStops.map((p, idx) => {
          if (idx !== s._i) return p;
          if (result) {
            return { ...p, latitude: result.latitude, longitude: result.longitude, geo_status: 'ok' };
          }
          return { ...p, latitude: null, longitude: null, geo_status: 'failed' };
        });
      }
      if (needsGeocode.length > 0) setStops(mergedStops);

      const finalStops = mergedStops
        .filter(s => s.title.trim() || s.address_text.trim())
        .map(s => ({
          title:         s.title.trim(),
          address_text:  s.address_text.trim() || null,
          driver_notes:  s.driver_notes.trim() || null,
          manager_notes: s.manager_notes.trim() || null,
          contact_name:  s.contact_name.trim() || null,
          contact_phone: s.contact_phone.trim() || null,
          stop_type:     s.stop_type || null,
          planned_time:  s.planned_time || null,
          latitude:      s.latitude,
          longitude:     s.longitude,
        }));

      const failedCount = mergedStops.filter(s =>
        s.address_text.trim() && s.geo_status === 'failed'
      ).length;

      const { data: newRouteId, error } = await supabase.rpc('create_route_with_stops', {
        p_account_id:              accountId,
        p_vehicle_id:              vehicleId,
        p_assigned_driver_user_id: driverUserId || null,
        p_title:                   cleanTitle,
        p_notes:                   notes.trim() || null,
        p_scheduled_for:           scheduledFor || null,
        p_stops:                   finalStops,
      });
      if (error) throw error;
      if (!newRouteId) throw new Error('no_id_returned');

      await queryClient.invalidateQueries({ queryKey: ['routes'] });

      if (failedCount > 0) {
        const phrase = failedCount > 1
          ? `${failedCount} כתובות לא זוהו במפה`
          : 'כתובת אחת לא זוהתה במפה';
        toast.success(
          `המשימה נוצרה. ${phrase} — הנהג יראה את הטקסט כפי שנכתב.`
        );
      } else {
        toast.success(driverUserId
          ? 'המשימה נוצרה. הנהג יראה אותה ברשימת המשימות שלו.'
          : 'המשימה נוצרה. אפשר לשייך נהג בכל שלב.');
      }
      navigate(createPageUrl('RouteDetail') + '?id=' + newRouteId);
    } catch (err) {
      const code = err?.message || '';
      if      (code.includes('forbidden_not_manager'))    toast.error('אין לך הרשאת מנהל בחשבון הזה');
      else if (code.includes('vehicle_not_in_workspace')) toast.error('הרכב שנבחר לא שייך לחשבון העסקי');
      else if (code.includes('driver_not_workspace_member')) toast.error('הנהג שנבחר אינו חבר פעיל בחשבון');
      else if (code.includes('title_required'))           toast.error('יש להזין שם למשימה');
      else                                                 toast.error('יצירת המשימה נכשלה. נסה שוב.');
      // eslint-disable-next-line no-console
      console.error('CreateRoute failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- render helpers ----------------------------------------

  const todayISO = new Date().toISOString().slice(0, 10);
  const selectedVehicle = vehicles.find(v => v.id === vehicleId);
  const selectedDriver  = team.find(m => m.user_id === driverUserId);
  const populatedStopsCount = stops.filter(s => s.title.trim() || s.address_text.trim()).length;

  return (
    <div dir="rtl" className="max-w-2xl mx-auto py-2">
      <MobileBackButton />
      {/* Header card */}
      <div className="bg-gradient-to-l from-[#2D5233] to-[#3A6B42] text-white rounded-2xl p-4 mb-4 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <ClipboardList className="h-4 w-4 opacity-80" />
          <span className="text-[11px] font-bold opacity-90">משימה חדשה</span>
        </div>
        <h1 className="text-xl font-bold">תכנון משימה לצי</h1>
        <p className="text-[11px] opacity-85 mt-1 leading-relaxed">
          קבע יעד, רכב ונהג. אם המשימה כוללת מסלול עם כמה תחנות —
          תוכל להוסיף אותן בהמשך.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Section: כותרת המשימה */}
        <Section title="פרטי המשימה" icon={<ClipboardList className="h-4 w-4 text-[#2D5233]" />}>
          <Field label="שם המשימה" required>
            <Input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="לדוגמה: איסוף הזמנת קלאלית מהמחסן"
              maxLength={120}
              className="h-11 rounded-xl"
              autoFocus
            />
          </Field>
          <Field label="תאריך מתוכנן">
            <DateInput
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              min={todayISO}
              className="h-11 rounded-xl"
            />
          </Field>
          <Field label="הערות למשימה (לא חובה)">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="פרטים שיועילו לנהג: שעות פעילות, איש קשר, מספר הזמנה וכו׳"
              rows={2}
              className="rounded-xl"
            />
          </Field>
        </Section>

        {/* Section: רכב */}
        <Section title="רכב למשימה" icon={<Truck className="h-4 w-4 text-[#2D5233]" />}>
          <Field label="בחר רכב" required>
            <VehiclePicker
              vehicles={vehicles}
              value={vehicleId}
              onChange={(id) => {
                setVehicleId(id);
                setDriverPickedManually(false);
              }}
            />
          </Field>
          {permanentDriver && (
            <div className="bg-[#E8F2EA] border border-[#2D5233]/20 rounded-xl px-3 py-2.5 flex items-center gap-2">
              <UserIcon className="h-4 w-4 text-[#2D5233] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-[#2D5233]">נהג קבוע לרכב הזה</p>
                <p className="text-xs text-gray-700 truncate">{permanentDriver.display_name}</p>
              </div>
              <span className="text-[10px] font-bold text-[#2D5233] bg-white/60 px-2 py-0.5 rounded-full shrink-0">
                שויך אוטומטית
              </span>
            </div>
          )}
        </Section>

        {/* Section: נהג */}
        <Section title="שיוך נהג" icon={<UserIcon className="h-4 w-4 text-[#2D5233]" />}>
          <DriverPicker
            members={team}
            value={driverUserId}
            permanentDriverId={permanentDriver?.user_id}
            onChange={(id) => {
              setDriverUserId(id);
              setDriverPickedManually(true);
            }}
          />
          <p className="text-[10px] text-gray-400 leading-snug">
            {permanentDriver && driverUserId === permanentDriver.user_id
              ? 'המשימה תופיע אצל הנהג הקבוע של הרכב.'
              : driverUserId
                ? 'שיוך זמני: הנהג יבצע את המשימה ויחזור. ההיסטוריה נשמרת ב-יומן הפעילות.'
                : 'אפשר לשייך נהג עכשיו או להשאיר ללא שיוך ולשייך מאוחר יותר מדף המשימה.'}
          </p>
        </Section>

        {/* Section: תחנות במסלול */}
        <Section
          title="תחנות במסלול"
          icon={<MapPin className="h-4 w-4 text-[#2D5233]" />}
          headerExtra={
            <span className="text-[10px] text-gray-400">
              {stops.length === 1
                ? 'תחנה אחת. אפשר להוסיף עוד תחנות למסלול.'
                : `${stops.length} תחנות. הנהג יסמן ביצוע לכל תחנה.`}
            </span>
          }
        >
          <div className="space-y-2">
            {stops.map((s, i) => (
              <StopCard
                key={i}
                index={i}
                total={stops.length}
                stop={s}
                isExpanded={expandedIndex === i}
                onExpand={() => setExpandedIndex(i)}
                onCollapse={() => setExpandedIndex(-1)}
                onChange={(key, value) => updateStop(i, key, value)}
                onRemove={() => removeStop(i)}
                onMoveUp={() => moveStop(i, i - 1)}
                onMoveDown={() => moveStop(i, i + 1)}
                onGeocode={() => geocodeStop(i)}
                canRemove={stops.length > 1}
              />
            ))}
            <button
              type="button"
              onClick={addStop}
              className="w-full py-2.5 rounded-xl border border-dashed border-gray-300 text-xs font-bold text-gray-600 active:bg-gray-50 hover:bg-gray-50 flex items-center justify-center gap-1.5 transition-all"
            >
              <Plus className="h-4 w-4" />
              הוסף תחנה
            </button>
          </div>
        </Section>

        {/* Task summary — compact recap right above the submit button */}
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3">
          <p className="text-[11px] font-bold text-gray-500 mb-2">סיכום משימה</p>
          <div className="space-y-1.5">
            <SummaryRow
              icon={<UserIcon className="h-3.5 w-3.5 text-gray-400" />}
              label="נהג"
              value={selectedDriver?.display_name || 'ללא שיוך'}
              missing={!selectedDriver}
            />
            <SummaryRow
              icon={<Truck className="h-3.5 w-3.5 text-gray-400" />}
              label="רכב"
              value={selectedVehicle ? (selectedVehicle.nickname || selectedVehicle.license_plate) : '—'}
              missing={!selectedVehicle}
            />
            <SummaryRow
              icon={<MapPin className="h-3.5 w-3.5 text-gray-400" />}
              label="תחנות"
              value={String(populatedStopsCount || 0)}
              missing={populatedStopsCount === 0}
            />
            <SummaryRow
              icon={<Calendar className="h-3.5 w-3.5 text-gray-400" />}
              label="תאריך"
              value={scheduledFor ? formatHebrewDate(scheduledFor) : 'לא נקבע'}
              missing={!scheduledFor}
            />
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-2xl font-bold text-sm bg-[#2D5233] text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60 shadow-sm"
        >
          {submitting
            ? <><Loader2 className="h-4 w-4 animate-spin" /> יוצר משימה...</>
            : <>צור משימה <ArrowRight className="h-4 w-4 rotate-180" /></>}
        </button>
      </form>
    </div>
  );
}

// ---------- shared UI primitives -------------------------------------

function Section({ title, icon, headerExtra, children }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2 -mt-0.5">
        <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
          {icon}
          {title}
        </h2>
        {headerExtra}
      </div>
      {children}
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function SummaryRow({ icon, label, value, missing }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500">
        {icon}
        {label}
      </span>
      <span className={`text-[12px] truncate text-left ${missing ? 'text-gray-400 italic' : 'text-gray-800 font-medium'}`}>
        {value}
      </span>
    </div>
  );
}

function formatHebrewDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ---------- StopCard --------------------------------------------------
//
// Two visual states:
//   - Collapsed: compact 1-row card showing number + title + address +
//     validation badge + reorder/edit/delete buttons.
//   - Expanded:  essentials (title, address, driver_notes) always visible;
//     "אפשרויות נוספות" toggle reveals stop_type / planned_time /
//     contact_name / contact_phone / manager_notes.

function StopCard({
  index, total, stop,
  isExpanded,
  onExpand, onCollapse,
  onChange, onRemove, onMoveUp, onMoveDown, onGeocode,
  canRemove,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);

  const handleCheckAddress = async () => {
    if (!stop.address_text.trim() || geoBusy) return;
    setGeoBusy(true);
    await onGeocode();
    setGeoBusy(false);
  };

  // ---------- Collapsed --------------------------------------------
  if (!isExpanded) {
    return (
      <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-[#2D5233] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
            {index + 1}
          </span>
          <button
            type="button"
            onClick={onExpand}
            className="flex-1 min-w-0 text-right active:opacity-70"
          >
            <p className="text-[13px] font-bold text-gray-900 truncate">
              {stop.title.trim() || `תחנה ${index + 1}`}
            </p>
            <p className="text-[11px] text-gray-500 truncate">
              {stop.address_text.trim() || 'ללא כתובת'}
            </p>
          </button>

          {/* Validation badge */}
          {stop.geo_status === 'ok' && (
            <span title="הכתובת זוהתה במפה" className="shrink-0">
              <Check className="w-3.5 h-3.5 text-green-600" />
            </span>
          )}
          {stop.geo_status === 'failed' && (
            <span title="הכתובת לא זוהתה במפה" className="shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            </span>
          )}

          {/* Reorder */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={index === 0}
              aria-label={`העבר את תחנה ${index + 1} למעלה`}
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={index === total - 1}
              aria-label={`העבר את תחנה ${index + 1} למטה`}
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
            </button>
          </div>

          {/* Edit */}
          <button
            type="button"
            onClick={onExpand}
            aria-label={`ערוך תחנה ${index + 1}`}
            className="p-1 rounded hover:bg-gray-200 shrink-0"
          >
            <Pencil className="w-3.5 h-3.5 text-gray-600" />
          </button>

          {/* Delete */}
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`מחק תחנה ${index + 1}`}
              className="p-1 rounded hover:bg-red-50 shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------- Expanded ---------------------------------------------
  return (
    <div className="bg-gray-50 rounded-xl p-3 border border-[#2D5233]/30 space-y-2.5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-gray-700">
          <span className="w-5 h-5 rounded-full bg-[#2D5233] text-white text-[10px] font-bold flex items-center justify-center">
            {index + 1}
          </span>
          תחנה {index + 1}
        </span>
        <div className="flex items-center gap-1">
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`מחק תחנה ${index + 1}`}
              className="p-1 rounded hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
            </button>
          )}
          <button
            type="button"
            onClick={onCollapse}
            aria-label="כווץ תחנה"
            className="p-1 rounded hover:bg-gray-200"
          >
            <ChevronUp className="w-3.5 h-3.5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Essential: title */}
      <Input
        value={stop.title}
        onChange={(e) => onChange('title', e.target.value)}
        placeholder="כותרת התחנה — לדוגמה: איסוף ממחסן"
        className="h-10 rounded-xl text-sm"
      />

      {/* Essential: address + check button */}
      <div>
        <Input
          value={stop.address_text}
          onChange={(e) => onChange('address_text', e.target.value)}
          placeholder="כתובת מדויקת"
          className="h-10 rounded-xl text-sm"
        />
        <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
          <button
            type="button"
            onClick={handleCheckAddress}
            disabled={geoBusy || !stop.address_text.trim()}
            className="text-[11px] font-bold text-[#2D5233] disabled:opacity-40 flex items-center gap-1 active:opacity-70"
          >
            {geoBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
            בדוק כתובת
          </button>
          {stop.geo_status === 'ok' && (
            <span className="text-[11px] text-green-700 flex items-center gap-1">
              <Check className="w-3 h-3" />
              הכתובת זוהתה במפה
            </span>
          )}
          {stop.geo_status === 'failed' && (
            <span className="text-[11px] text-amber-700 flex items-center gap-1 leading-snug max-w-full">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              לא הצלחנו לזהות את הכתובת במפה. אפשר לשמור, אך מומלץ לדייק אותה.
            </span>
          )}
        </div>
      </div>

      {/* Essential: driver notes */}
      <Textarea
        value={stop.driver_notes}
        onChange={(e) => onChange('driver_notes', e.target.value)}
        placeholder="הערות לנהג (לא חובה)"
        rows={2}
        className="rounded-xl text-sm"
      />

      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(s => !s)}
        className="w-full text-[11px] font-bold text-gray-600 flex items-center justify-center gap-1 py-1.5 hover:text-[#2D5233]"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        {showAdvanced ? 'הסתר אפשרויות נוספות' : 'אפשרויות נוספות'}
      </button>

      {showAdvanced && (
        <div className="space-y-2 pt-2 border-t border-gray-200">
          <Field label="סוג תחנה">
            <select
              value={stop.stop_type}
              onChange={(e) => onChange('stop_type', e.target.value)}
              className="w-full h-10 rounded-xl border border-gray-200 bg-white text-sm px-3"
              dir="rtl"
            >
              {STOP_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="זמן מתוכנן">
            <Input
              type="datetime-local"
              value={stop.planned_time}
              onChange={(e) => onChange('planned_time', e.target.value)}
              className="h-10 rounded-xl text-sm"
            />
          </Field>
          <Field label="שם איש קשר בתחנה">
            <Input
              value={stop.contact_name}
              onChange={(e) => onChange('contact_name', e.target.value)}
              placeholder="לדוגמה: יוסי מהמחסן"
              className="h-10 rounded-xl text-sm"
            />
          </Field>
          <Field label="טלפון איש קשר">
            <Input
              type="tel"
              value={stop.contact_phone}
              onChange={(e) => onChange('contact_phone', e.target.value)}
              placeholder="050-1234567"
              className="h-10 rounded-xl text-sm"
              dir="ltr"
            />
          </Field>
          <Field label="הערות פנימיות (רק למנהל)">
            <Textarea
              value={stop.manager_notes}
              onChange={(e) => onChange('manager_notes', e.target.value)}
              placeholder="הערות שהנהג לא רואה"
              rows={2}
              className="rounded-xl text-sm"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

// ---------- DriverPicker ---------------------------------------------
// Same shape as VehiclePicker but for workspace members. Highlights
// which member is the permanent driver of the selected vehicle.

function DriverPicker({ members, value, permanentDriverId, onChange }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef           = useRef(null);
  const searchRef         = useRef(null);

  const selected = members.find(m => m.user_id === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30);
    else setQuery('');
  }, [open]);

  // Drivers first (most common pick), then managers, then viewers.
  // Permanent driver always sits at the top.
  const sorted = useMemo(() => {
    const arr = members.slice();
    const ROLE_ORDER = { 'driver': 0, 'בעלים': 1, 'מנהל': 2, 'שותף': 3 };
    arr.sort((a, b) => {
      if (a.user_id === permanentDriverId) return -1;
      if (b.user_id === permanentDriverId) return 1;
      return (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9);
    });
    return arr;
  }, [members, permanentDriverId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(m =>
      [m.display_name, m.email, m.phone].join(' ').toLowerCase().includes(q)
    );
  }, [sorted, query]);

  return (
    <div ref={wrapRef} className="relative" dir="rtl">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-right active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#2D5233]/30"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex-1 min-w-0 truncate">
          {selected ? (
            <span className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-900 truncate">{selected.display_name}</span>
              <RolePill role={selected.role} />
              {selected.user_id === permanentDriverId && (
                <span className="text-[10px] font-bold text-[#2D5233] bg-[#E8F2EA] px-1.5 py-0.5 rounded-md">קבוע</span>
              )}
            </span>
          ) : (
            <span className="text-gray-400">ללא שיוך, אפשר לשייך אחר כך</span>
          )}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {selected && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              aria-label="הסר שיוך"
              className="p-0.5 rounded hover:bg-gray-100"
            >
              <X className="h-3.5 w-3.5 text-gray-400" />
            </button>
          )}
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div role="listbox" className="absolute z-[10001] top-full mt-1 inset-x-0 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <Input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חפש לפי שם, אימייל או טלפון"
                className="h-9 rounded-xl pr-8 pl-2 text-xs bg-gray-50 focus:bg-white"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-right border-b border-gray-50 transition-colors ${
                !value ? 'bg-[#E8F2EA]' : 'hover:bg-gray-50'
              }`}
            >
              <X className={`shrink-0 h-4 w-4 ${!value ? 'text-[#2D5233]' : 'text-gray-400'}`} />
              <span className={`flex-1 text-sm ${!value ? 'font-bold text-[#2D5233]' : 'text-gray-700'}`}>ללא שיוך</span>
              {!value && <Check className="shrink-0 h-4 w-4 text-[#2D5233]" />}
            </button>
            {filtered.length === 0 ? (
              <p className="text-center text-[11px] text-gray-400 py-6">לא נמצאו חברים תואמים</p>
            ) : (
              filtered.map(m => {
                const isSelected   = m.user_id === value;
                const isPermanent  = m.user_id === permanentDriverId;
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { onChange(m.user_id); setOpen(false); }}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 text-right border-b border-gray-50 last:border-0 transition-colors ${
                      isSelected ? 'bg-[#E8F2EA]' : 'hover:bg-gray-50 active:bg-gray-100'
                    }`}
                  >
                    <UserIcon className={`shrink-0 h-4 w-4 mt-0.5 ${isSelected ? 'text-[#2D5233]' : 'text-gray-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm truncate ${isSelected ? 'font-bold text-[#2D5233]' : 'font-bold text-gray-900'}`}>
                          {m.display_name}
                        </span>
                        <RolePill role={m.role} />
                        {isPermanent && (
                          <span className="text-[10px] font-bold text-[#2D5233] bg-white px-1.5 py-0.5 rounded-md border border-[#2D5233]/20">
                            נהג קבוע של הרכב
                          </span>
                        )}
                      </div>
                      {(m.phone || m.email) && (
                        <p className="text-[11px] text-gray-500 mt-0.5 truncate" dir="ltr">
                          {[m.phone, m.email].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    {isSelected && <Check className="shrink-0 h-4 w-4 text-[#2D5233]" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RolePill({ role }) {
  const meta = ROLE_TAG[role];
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${meta.cls}`}>
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

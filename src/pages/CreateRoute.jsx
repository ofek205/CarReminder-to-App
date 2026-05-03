/**
 * Phase 6 — Create Task (Manager only).
 *
 * Polished form for creating a workspace task. Each task has:
 *   - Title + scheduled date + optional notes
 *   - One vehicle (required)
 *   - One driver assignment (optional; defaults to the vehicle's
 *     permanent driver if one exists)
 *   - One or more stops. Single-stop tasks read as a "destination",
 *     multi-stop tasks as a "route".
 *
 * Backend stays unchanged — calls create_route_with_stops RPC. The
 * "task" rename is UI-only (a task in the user's mental model maps
 * 1:1 to a route row in the DB).
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Loader2, ArrowRight, Briefcase, Truck, User as UserIcon,
  MapPin, ClipboardList, Search, Check, ChevronDown, X, Crown, Shield,
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

// ---------- helpers ---------------------------------------------------

const ROLE_TAG = {
  'בעלים': { label: 'בעלים', icon: Crown,    cls: 'bg-purple-50 text-purple-700' },
  'מנהל':  { label: 'מנהל',  icon: Shield,   cls: 'bg-[#E8F2EA] text-[#2D5233]' },
  'driver':{ label: 'נהג',   icon: Truck,    cls: 'bg-orange-50 text-orange-700' },
  'שותף':  { label: 'צופה',  icon: UserIcon, cls: 'bg-blue-50 text-blue-700' },
};

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
  const [stops, setStops]               = useState([{ title: '', address_text: '', notes: '' }]);
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
  // This makes the most common case (assigning to the regular driver)
  // a one-tap flow without trapping the manager's manual choice.
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

  // ---------- handlers ----------------------------------------------

  const updateStop = (i, key, value) => {
    setStops(prev => prev.map((s, idx) => idx === i ? { ...s, [key]: value } : s));
  };
  const addStop    = () => setStops(prev => [...prev, { title: '', address_text: '', notes: '' }]);
  const removeStop = (i) => setStops(prev => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i));

  const isMultiStop = stops.length > 1;
  const stopsLabel  = isMultiStop ? 'תחנות במסלול' : 'יעד המשימה';
  const stopsHelp   = isMultiStop
    ? 'הנהג יסמן ביצוע לכל תחנה בנפרד.'
    : 'משימה לנקודה אחת. אפשר להוסיף תחנה ולהפוך אותה למסלול עם רצף.';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle)  { toast.error('יש להזין שם למשימה'); return; }
    if (!vehicleId)   { toast.error('יש לבחור רכב למשימה'); return; }
    const cleanStops = stops
      .map(s => ({
        title:        s.title.trim(),
        address_text: s.address_text.trim() || null,
        notes:        s.notes.trim() || null,
      }))
      .filter(s => s.title || s.address_text);
    if (cleanStops.length === 0) {
      toast.error(isMultiStop ? 'הוסף לפחות תחנה אחת למשימה' : 'יש להזין יעד למשימה');
      return;
    }

    setSubmitting(true);
    try {
      const { data: newRouteId, error } = await supabase.rpc('create_route_with_stops', {
        p_account_id:              accountId,
        p_vehicle_id:              vehicleId,
        p_assigned_driver_user_id: driverUserId || null,
        p_title:                   cleanTitle,
        p_notes:                   notes.trim() || null,
        p_scheduled_for:           scheduledFor || null,
        p_stops:                   cleanStops,
      });
      if (error) throw error;
      if (!newRouteId) throw new Error('no_id_returned');

      await queryClient.invalidateQueries({ queryKey: ['routes'] });
      toast.success(driverUserId
        ? 'המשימה נוצרה. הנהג יראה אותה ברשימת המשימות שלו.'
        : 'המשימה נוצרה. אפשר לשייך נהג בכל שלב.');
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

  // ---------- render ------------------------------------------------

  const todayISO = new Date().toISOString().slice(0, 10);

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
                // Reset manual override so the auto-assign permanent
                // driver effect can re-run with the new vehicle.
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

        {/* Section: יעד / תחנות */}
        <Section
          title={stopsLabel}
          icon={<MapPin className="h-4 w-4 text-[#2D5233]" />}
          headerExtra={
            <span className="text-[10px] text-gray-400">{stopsHelp}</span>
          }
        >
          <div className="space-y-2">
            {stops.map((s, i) => (
              <StopRow
                key={i}
                index={i}
                stop={s}
                isMultiStop={isMultiStop}
                onChange={(key, value) => updateStop(i, key, value)}
                onRemove={() => removeStop(i)}
                canRemove={stops.length > 1}
              />
            ))}
            <button
              type="button"
              onClick={addStop}
              className="w-full py-2.5 rounded-xl border border-dashed border-gray-300 text-xs font-bold text-gray-600 active:bg-gray-50 hover:bg-gray-50 flex items-center justify-center gap-1.5 transition-all"
            >
              <Plus className="h-4 w-4" />
              {isMultiStop ? 'הוסף תחנה' : 'הפוך למסלול עם תחנות'}
            </button>
          </div>
        </Section>

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

// ---------- StopRow ---------------------------------------------------

function StopRow({ index, stop, isMultiStop, onChange, onRemove, canRemove }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 space-y-2 border border-gray-100">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-bold text-gray-500">
          {isMultiStop ? `תחנה ${index + 1}` : 'יעד'}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`הסר תחנה ${index + 1}`}
            className="text-red-500 active:scale-90 p-1 rounded-md hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Input
        value={stop.title}
        onChange={(e) => onChange('title', e.target.value)}
        placeholder="לדוגמה: איסוף סחורה ממחסן"
        className="h-10 rounded-xl text-sm"
      />
      <Input
        value={stop.address_text}
        onChange={(e) => onChange('address_text', e.target.value)}
        placeholder="כתובת מדויקת — תיפתח אצל הנהג ישירות בוויז"
        className="h-10 rounded-xl text-sm"
      />
      <Input
        value={stop.notes}
        onChange={(e) => onChange('notes', e.target.value)}
        placeholder="הערות לנהג (לא חובה)"
        className="h-10 rounded-xl text-sm"
      />
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
            {/* "ללא שיוך" row first so the manager can quickly clear */}
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

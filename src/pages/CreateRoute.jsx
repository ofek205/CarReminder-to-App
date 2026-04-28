/**
 * Phase 6 — Create Route (Manager only).
 *
 * Form: vehicle picker + driver picker + scheduled date + title + notes
 * + ordered list of stops (title + address + notes per stop).
 * Calls create_route_with_stops RPC atomically.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Loader2, ArrowRight, Briefcase } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { createPageUrl } from '@/utils';

export default function CreateRoute() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { canManageRoutes, isBusiness, isLoading: roleLoading } = useWorkspaceRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [vehicleId, setVehicleId] = useState('');
  const [driverUserId, setDriverUserId] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [stops, setStops] = useState([{ title: '', address_text: '', notes: '' }]);
  const [submitting, setSubmitting] = useState(false);

  const { data: vehicles = [] } = useQuery({
    queryKey: ['routes-vehicle-picker', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId && canManageRoutes,
    staleTime: 5 * 60 * 1000,
  });

  // Workspace members (any active role) — drivers must be members.
  const { data: members = [] } = useQuery({
    queryKey: ['routes-driver-picker', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_members')
        .select('user_id, role, status')
        .eq('account_id', accountId)
        .eq('status', 'פעיל');
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canManageRoutes,
    staleTime: 5 * 60 * 1000,
  });

  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated || !isBusiness || !canManageRoutes) {
    return (
      <div dir="rtl" className="max-w-md mx-auto py-16 text-center">
        <Briefcase className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-bold text-gray-700 mb-1">אין הרשאה ליצור מסלולים</p>
        <p className="text-xs text-gray-500">יצירת מסלולים שמורה למנהלי חשבון עסקי.</p>
      </div>
    );
  }

  const updateStop = (i, key, value) => {
    setStops(prev => prev.map((s, idx) => idx === i ? { ...s, [key]: value } : s));
  };
  const addStop    = () => setStops(prev => [...prev, { title: '', address_text: '', notes: '' }]);
  const removeStop = (i) => setStops(prev => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle)  { toast.error('יש להזין שם למסלול'); return; }
    if (!vehicleId)   { toast.error('יש לבחור רכב למסלול'); return; }
    const cleanStops = stops
      .map(s => ({
        title:        s.title.trim(),
        address_text: s.address_text.trim() || null,
        notes:        s.notes.trim() || null,
      }))
      .filter(s => s.title || s.address_text);
    if (cleanStops.length === 0) { toast.error('הוסף לפחות תחנה אחת למסלול'); return; }

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
        ? 'המסלול נוצר. הנהג יראה אותו ברשימת המסלולים שלו.'
        : 'המסלול נוצר. אפשר לשייך נהג בכל שלב.');
      navigate(createPageUrl('RouteDetail') + '?id=' + newRouteId);
    } catch (err) {
      const code = err?.message || '';
      if      (code.includes('forbidden_not_manager'))    toast.error('אין לך הרשאת מנהל בחשבון הזה');
      else if (code.includes('vehicle_not_in_workspace')) toast.error('הרכב שנבחר לא שייך לחשבון העסקי');
      else if (code.includes('driver_not_workspace_member')) toast.error('הנהג שנבחר אינו חבר פעיל בחשבון');
      else if (code.includes('title_required'))           toast.error('יש להזין שם למסלול');
      else                                                 toast.error('יצירת המסלול נכשלה. נסה שוב.');
      // eslint-disable-next-line no-console
      console.error('CreateRoute failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div dir="rtl" className="max-w-2xl mx-auto py-2">
      <h1 className="text-xl font-bold text-gray-900 mb-1">מסלול חדש</h1>
      <p className="text-xs text-gray-500 mb-5">תכנן מסלול עם תחנות והשייך אותו לנהג. הנהג יראה את המסלול ברשימה שלו.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="שם המסלול" required>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} maxLength={120} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="רכב למסלול" required>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputCls}>
              <option value="">בחר רכב...</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {v.nickname || v.license_plate || v.manufacturer + ' ' + v.model}
                </option>
              ))}
            </select>
          </Field>

          <Field label="תאריך מתוכנן">
            <input type="date" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <Field label="שיוך לנהג">
          <select value={driverUserId} onChange={(e) => setDriverUserId(e.target.value)} className={inputCls}>
            <option value="">ללא שיוך — אפשר לשייך אחר כך</option>
            {members.map(m => (
              <option key={m.user_id} value={m.user_id}>
                {m.user_id.slice(0, 8)} · {m.role}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-gray-400 mt-1">
            השמות המלאים של החברים יוצגו כאן בקרוב. לעת עתה מוצג מזהה קצר.
          </p>
        </Field>

        <Field label="הערות למסלול">
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="פרטים שיועילו לנהג: שעות פעילות, איש קשר, וכו'"
            className={inputCls} rows={2}
          />
        </Field>

        <div>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-xs font-bold text-gray-700">תחנות במסלול</p>
            <p className="text-[10px] text-gray-400">חובה לפחות תחנה אחת</p>
          </div>
          <div className="space-y-2">
            {stops.map((s, i) => (
              <div key={i} className="bg-gray-50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-gray-500">תחנה {i + 1}</span>
                  {stops.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStop(i)}
                      aria-label={`הסר תחנה ${i + 1}`}
                      className="text-red-500 active:scale-90 p-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <input
                  value={s.title}
                  onChange={(e) => updateStop(i, 'title', e.target.value)}
                  placeholder="לדוגמה: איסוף סחורה ממחסן"
                  className={inputCls}
                />
                <input
                  value={s.address_text}
                  onChange={(e) => updateStop(i, 'address_text', e.target.value)}
                  placeholder="כתובת או נקודת ציון"
                  className={inputCls}
                />
                <input
                  value={s.notes}
                  onChange={(e) => updateStop(i, 'notes', e.target.value)}
                  placeholder="הערות לנהג (לא חובה)"
                  className={inputCls}
                />
              </div>
            ))}
            <button type="button" onClick={addStop}
              className="w-full py-2.5 rounded-xl border border-dashed border-gray-300 text-xs font-bold text-gray-600 active:bg-gray-50 flex items-center justify-center gap-1.5">
              <Plus className="h-4 w-4" /> הוסף תחנה
            </button>
          </div>
        </div>

        <button type="submit" disabled={submitting}
          className="w-full py-3 rounded-xl font-bold text-sm bg-[#2D5233] text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60">
          {submitting
            ? <><Loader2 className="h-4 w-4 animate-spin" /> יוצר...</>
            : <>צור מסלול <ArrowRight className="h-4 w-4 rotate-180" /></>}
        </button>
      </form>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2D5233]/30 focus:border-[#2D5233] bg-white";

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

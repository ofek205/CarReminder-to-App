/**
 * AssignDriverDialog — single dialog used to assign a vehicle to either
 * kind of driver. Replaces three earlier copies of similar code in
 * Drivers.jsx and DriverDetail.jsx.
 *
 * Props:
 *   open                  boolean
 *   onClose               ()
 *   onAssigned            (assignmentId) — fires on success
 *   accountId             string
 *   driver                { kind: 'registered' | 'external',
 *                           id: string, displayName: string }
 *   vehicles              [{ id, nickname, manufacturer, model, license_plate }]
 *   existingAssignments   active assignments for this driver. Vehicles
 *                         already in this list are filtered out of the
 *                         picker so the user can't double-assign.
 *
 * The 3-state toggle (קבוע / זמני / עתידי) lives here. "Future" maps
 * to valid_from in the future + valid_to null. Validation enforces
 * the date for the active state.
 */
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import VehiclePicker from '@/components/shared/VehiclePicker';
import { DateInput } from '@/components/ui/date-input';
import {
  assignRegisteredDriver,
  assignExternalDriver,
} from '@/services/drivers';

export default function AssignDriverDialog({
  open,
  onClose,
  onAssigned,
  accountId,
  driver,
  vehicles = [],
  existingAssignments = [],
}) {
  const [vehicleId,  setVehicleId]  = useState('');
  // 'permanent' | 'temporary' | 'future'
  const [kind,       setKind]       = useState('permanent');
  const [validFrom,  setValidFrom]  = useState('');
  const [validTo,    setValidTo]    = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  // Hide vehicles already assigned to this driver. The RPC would
  // upsert anyway, but pre-filtering avoids an obviously-redundant
  // pick by the user.
  const assignedIds = new Set(existingAssignments.map(a => a.vehicle_id));
  const available = vehicles.filter(v => !assignedIds.has(v.id));

  const submit = async (e) => {
    e.preventDefault();
    if (!vehicleId)                          { toast.error('יש לבחור רכב'); return; }
    if (kind === 'temporary' && !validTo)    { toast.error('בחר תאריך סיום'); return; }
    if (kind === 'future'    && !validFrom)  { toast.error('בחר תאריך התחלה'); return; }

    const valid_from_iso = kind === 'future'
      ? new Date(validFrom).toISOString()
      : new Date().toISOString();
    const valid_to_iso = kind === 'temporary'
      ? new Date(validTo).toISOString()
      : null;

    setSubmitting(true);
    try {
      let assignmentId;
      if (driver.kind === 'external') {
        assignmentId = await assignExternalDriver({
          accountId,
          vehicleId,
          externalDriverId: driver.id,
          validFrom: valid_from_iso,
          validTo:   valid_to_iso,
        });
      } else {
        assignmentId = await assignRegisteredDriver({
          accountId,
          vehicleId,
          driverUserId: driver.id,
          validFrom: valid_from_iso,
          validTo:   valid_to_iso,
        });
      }
      toast.success(`הרכב שובץ ל${driver.displayName}`);
      onAssigned?.(assignmentId);
    } catch (err) {
      console.error('assign failed:', err);
      const msg = err?.message || '';
      if      (msg.includes('forbidden_not_manager'))         toast.error('אין לך הרשאת מנהל');
      else if (msg.includes('vehicle_not_in_workspace'))      toast.error('הרכב לא שייך לחשבון');
      else if (msg.includes('driver_not_workspace_member'))   toast.error('הנהג אינו חבר פעיל בחשבון');
      else if (msg.includes('external_driver_not_in_workspace_or_inactive'))
        toast.error('הנהג לא פעיל בחשבון');
      else                                                     toast.error('השיבוץ נכשל. נסה שוב.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[10000] bg-black/40 flex items-end sm:items-center justify-center p-3"
      onClick={onClose}
    >
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900">שיבוץ רכב לנהג</h2>
          <button onClick={onClose} aria-label="סגור" className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">{driver.displayName}</p>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              רכב <span className="text-red-500">*</span>
            </label>
            <VehiclePicker
              vehicles={available}
              value={vehicleId}
              onChange={setVehicleId}
              placeholder="בחר רכב מהצי..."
            />
            {available.length === 0 && (
              <p className="text-[11px] text-gray-500 mt-1">
                כל הרכבים כבר משובצים לנהג הזה.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">סוג השיבוץ</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'permanent', label: 'קבוע' },
                { v: 'temporary', label: 'זמני' },
                { v: 'future',    label: 'עתידי' },
              ].map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setKind(opt.v)}
                  className={`py-2 rounded-lg text-xs font-bold border transition-all ${
                    kind === opt.v
                      ? 'bg-[#E8F2EA] border-[#2D5233] text-[#2D5233]'
                      : 'bg-white border-gray-200 text-gray-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              {kind === 'permanent' ? 'השיבוץ ימשיך עד סיום ידני.'
                : kind === 'temporary' ? 'השיבוץ יסתיים אוטומטית בתאריך הסיום.'
                : 'השיבוץ יתחיל בתאריך שתבחר. נשמר עד סיום ידני.'}
            </p>
          </div>

          {kind === 'temporary' && (
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                תאריך סיום <span className="text-red-500">*</span>
              </label>
              <DateInput
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="h-10 rounded-xl text-sm"
              />
            </div>
          )}

          {kind === 'future' && (
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                תאריך התחלה <span className="text-red-500">*</span>
              </label>
              <DateInput
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="h-10 rounded-xl text-sm"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !vehicleId || available.length === 0}
            className="w-full py-2.5 rounded-xl font-bold text-sm bg-[#2D5233] text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'שבץ רכב'}
          </button>
        </form>
      </div>
    </div>
  );
}

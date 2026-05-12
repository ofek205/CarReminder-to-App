/**
 * maintenanceRecommendations — book-style service intervals + a
 * "next reminder" calculator.
 *
 * The intervals below are pragmatic defaults for the Israeli market,
 * grouped by the vehicle category our existing getVehicleCategory()
 * helper returns ('car', 'truck', 'motorcycle', 'offroad', 'vessel',
 * 'cme', 'special'). When the user opts in to a reminder on a
 * maintenance log, we surface the matching interval as the suggested
 * value — the user can accept, edit, or pick their own.
 *
 * Each interval has up to three units:
 *   • km      — for road vehicles
 *   • hours   — for engine-hour-tracked vehicles (CME, vessels)
 *   • months  — calendar fallback that applies to every category
 *
 * computeNextReminder() turns the chosen interval + the relevant
 * baseline (last service km/date, or current km/date when no prior
 * service of the same kind exists) into the absolute target the DB
 * stores.
 */

import { getVehicleCategory } from '@/lib/designTokens';

// Average monthly mileage used to convert km-interval reminders into
// an estimated target DATE so we can fire a LocalNotification a fixed
// number of weeks before. Tweakable per category.
const AVG_MONTHLY_KM = {
  car:        1500,
  truck:      4000,
  motorcycle: 500,
  offroad:    400,
  special:    1000,
  cme:        0,    // hour-tracked, not km
  vessel:     0,    // hour-tracked, not km
};

// Book-style recommendations.
//   small / big   — for km-tracked categories
//   engine / hull — for vessels (different lifecycle)
const INTERVALS = {
  car:        {
    small:  { km: 15000, months: 12, label: 'טיפול קטן ברכב פרטי' },
    big:    { km: 60000, months: 24, label: 'טיפול גדול ברכב פרטי' },
  },
  truck:      {
    small:  { km: 25000, months: 6,  label: 'טיפול קטן במשאית' },
    big:    { km: 80000, months: 18, label: 'טיפול גדול במשאית' },
  },
  motorcycle: {
    small:  { km: 6000,  months: 6,  label: 'טיפול קטן באופנוע' },
    big:    { km: 20000, months: 24, label: 'טיפול גדול באופנוע' },
  },
  offroad:    {
    small:  { km: 8000,  months: 6,  label: 'טיפול קטן בכלי שטח' },
    big:    { km: 30000, months: 24, label: 'טיפול גדול בכלי שטח' },
  },
  special:    {
    small:  { km: 15000, months: 12, label: 'טיפול קטן' },
    big:    { km: 60000, months: 24, label: 'טיפול גדול' },
  },
  cme:        {
    small:  { hours: 250,  months: 6,  label: 'טיפול קטן בציוד מכני הנדסי' },
    big:    { hours: 1000, months: 12, label: 'טיפול גדול בציוד מכני הנדסי' },
  },
  vessel:     {
    engine: { hours: 100, months: 12, label: 'טיפול מנוע ימי' },
    hull:   {              months: 24, label: 'טיפול גוף — העלאה למספנה' },
  },
};

/**
 * Returns the book-style interval for a vehicle + service size, or
 * null if we don't have data for that combo.
 *
 * serviceSize: 'small' | 'big' | 'engine' | 'hull'
 */
export function getRecommendedInterval(vehicle, serviceSize) {
  if (!vehicle) return null;
  const category = getVehicleCategory(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  return INTERVALS[category]?.[serviceSize] || null;
}

/**
 * Translate a user-chosen interval (in months or km/hours) into the
 * absolute target stored on the maintenance_logs row.
 *
 * Inputs:
 *   vehicle        — the row, used for current km fallback + category
 *   serviceSize    — 'small' | 'big' | 'engine' | 'hull'
 *   currentServiceDate — ISO YYYY-MM-DD, the date the user is logging
 *   currentServiceKm   — number, km at this service (optional)
 *   mode           — 'time' | 'km'
 *   intervalMonths — number, only for mode==='time'
 *   intervalKm     — number, only for mode==='km' (or hours for CME/vessel)
 *   lastSameTypeLog — most recent prior log of the same service size,
 *                     used to anchor the baseline (so "every 15K km"
 *                     means since the LAST service, not since today).
 *
 * Returns an object with three DB-ready fields:
 *   {
 *     next_reminder_kind: 'time' | 'km',
 *     next_reminder_at:   ISO timestamp,
 *     next_reminder_km:   number | null,
 *   }
 *
 * For 'km' reminders we still set next_reminder_at to an estimated
 * date so LocalNotification can fire on a calendar tick — the
 * estimate uses AVG_MONTHLY_KM for the category and is intentionally
 * conservative. The user can edit the row later if their actual
 * usage is faster/slower.
 *
 * Returns null when the inputs aren't enough to compute a target.
 */
export function computeNextReminder({
  vehicle,
  serviceSize,
  currentServiceDate,
  currentServiceKm,
  mode,
  intervalMonths,
  intervalKm,
  lastSameTypeLog,
}) {
  if (!mode) return null;

  const baseDateIso = lastSameTypeLog?.date
    || currentServiceDate
    || new Date().toISOString().slice(0, 10);

  if (mode === 'time') {
    const m = Number(intervalMonths);
    if (!m || m <= 0) return null;
    const d = new Date(baseDateIso + 'T12:00:00');
    d.setMonth(d.getMonth() + m);
    return {
      next_reminder_kind: 'time',
      next_reminder_at: d.toISOString(),
      next_reminder_km: null,
    };
  }

  if (mode === 'km') {
    const km = Number(intervalKm);
    if (!km || km <= 0) return null;
    const baseKm = Number(lastSameTypeLog?.km_at_service)
                || Number(currentServiceKm)
                || Number(vehicle?.current_mileage)
                || Number(vehicle?.km)
                || 0;
    const targetKm = baseKm + km;

    // Convert to an estimated date for LocalNotification scheduling.
    const category = getVehicleCategory(vehicle?.vehicle_type, vehicle?.nickname, vehicle?.manufacturer);
    const avgPerMonth = AVG_MONTHLY_KM[category] || AVG_MONTHLY_KM.car;
    const estimatedMonths = avgPerMonth > 0 ? km / avgPerMonth : 6;
    const d = new Date();
    d.setMonth(d.getMonth() + Math.max(1, Math.round(estimatedMonths)));

    return {
      next_reminder_kind: 'km',
      next_reminder_at: d.toISOString(),
      next_reminder_km: targetKm,
    };
  }

  return null;
}

/**
 * When should the LocalNotification fire? Two weeks before the
 * computed target_at, clamped to "no earlier than now + 1 hour"
 * so a backdated reminder still appears soon rather than vanishing
 * into the past.
 */
export function reminderFireDate(targetIso) {
  if (!targetIso) return null;
  const t = new Date(targetIso).getTime();
  const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
  const ONE_HOUR  = 60 * 60 * 1000;
  return new Date(Math.max(t - TWO_WEEKS, Date.now() + ONE_HOUR));
}

/**
 * collectVehicleHistory — the single answer to "what is this vehicle's
 * history", shared by every consumer of it.
 *
 * WHY THIS IS ITS OWN LAYER
 *   Three things need the same answer to the same question: the Excel
 *   renderer, the PDF renderer, and (later) the ownership-transfer manifest.
 *   Built separately, each grows its own idea of what counts as a service,
 *   and the drift only surfaces when a user compares two files and finds
 *   different rows. One definition, three sinks.
 *
 * WHY IT DOES NOT FETCH
 *   Deliberately pure. The caller passes what it already holds — the
 *   maintenance section already has `logs` in a React Query cache keyed
 *   ['maintenance-logs-v2', vehicle.id]. Fetching again here would double
 *   the round trips, break export while offline (the cache is the only copy
 *   then), and make every one of these functions need a test harness with a
 *   database in it. Pure in, pure out.
 */

/** `type === 'תיקון'` is the discriminator MaintenanceSection already uses;
 *  every other value ('טיפול גדול' / 'טיפול קטן' / 'טיפול מנוע' / …) is a
 *  service. Kept as one exported helper so the rule lives in a single place
 *  rather than being re-derived per renderer. */
export const REPAIR_TYPE = 'תיקון';

export function splitByType(logs = []) {
  const services = [];
  const repairs = [];
  for (const log of logs || []) {
    if (!log) continue;
    (log.type === REPAIR_TYPE ? repairs : services).push(log);
  }
  return { services, repairs };
}

/** Newest first. Rows with no usable date sink to the bottom rather than
 *  being dropped: a service someone logged without a date is still a service,
 *  and silently losing it from an export the user is about to hand to a buyer
 *  would be the worst kind of bug — invisible on both sides. */
function byDateDesc(a, b) {
  const ta = Date.parse(a?.date ?? '');
  const tb = Date.parse(b?.date ?? '');
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return tb - ta;
}

/** The identity block that heads every sheet and every page. Without it a
 *  printed history is a list of dates belonging to nothing, which is useless
 *  to the mechanic or buyer it was sent to. */
export function buildIdentity(vehicle, { now = new Date() } = {}) {
  if (!vehicle) return null;
  return {
    plate:        vehicle.license_plate  || '',
    manufacturer: vehicle.manufacturer   || '',
    model:        vehicle.model          || '',
    year:         vehicle.year           ?? null,
    currentKm:    vehicle.current_km     ?? null,
    nickname:     vehicle.nickname       || '',
    exportedAt:   now.toISOString().slice(0, 10),
  };
}

/** Latin-safe file stem. Hebrew file names get mangled by some mail clients
 *  and by Windows' built-in zip handler, and this file exists to travel. The
 *  plate is digits and dashes, so it survives intact.
 *
 *  Lives here rather than beside the Excel renderer so the PDF path can name
 *  its file without importing exceljs, which would drag ~940KB in for a
 *  format that does not use it. */
export function historyFileStem(identity) {
  const plate = (identity?.plate || 'vehicle').replace(/[^\w-]/g, '');
  const date = identity?.exportedAt || new Date().toISOString().slice(0, 10);
  return `CarReminder-${plate}-${date}`;
}

/** One maintenance_logs row, flattened to exactly the columns both renderers
 *  show. Field names verified against MaintenanceSection, not guessed. */
function toHistoryRow(log) {
  return {
    date:        log.date ?? null,
    type:        log.type ?? '',
    title:       log.title ?? '',
    km:          log.km_at_service ?? null,
    garage:      log.garage_name ?? '',
    performedBy: log.performed_by ?? '',
    cost:        log.cost ?? null,
    notes:       log.notes ?? '',
  };
}

/** One accidents row. Deliberately NOT carrying photos or the other driver's
 *  phone: an export is handed to strangers, and a phone number belonging to
 *  a third party who never agreed to be in this file has no business in it. */
function toAccidentRow(accident) {
  return {
    date:      accident.date ?? null,
    location:  accident.location ?? '',
    status:    accident.status ?? '',
    otherName: accident.other_driver_name ?? '',
    otherPlate: accident.other_driver_plate ?? '',
    otherInsurer: accident.other_driver_insurance_company ?? '',
  };
}

/**
 * Normalise everything a vehicle's history export needs.
 *
 * @param {object}   args.vehicle    a vehicles row
 * @param {object[]} args.logs       maintenance_logs rows (services + repairs)
 * @param {object[]} args.accidents  accidents rows
 * @returns {{ identity, services, repairs, accidents, counts, isEmpty }}
 */
export function collectVehicleHistory({ vehicle, logs = [], accidents = [], now } = {}) {
  const { services, repairs } = splitByType(logs);
  const accidentRows = (accidents || []).filter(Boolean);

  const out = {
    identity:  buildIdentity(vehicle, { now }),
    services:  services.slice().sort(byDateDesc).map(toHistoryRow),
    repairs:   repairs.slice().sort(byDateDesc).map(toHistoryRow),
    accidents: accidentRows.slice().sort(byDateDesc).map(toAccidentRow),
  };

  out.counts = {
    services:  out.services.length,
    repairs:   out.repairs.length,
    accidents: out.accidents.length,
  };

  // Drives the disabled state on the export button. Note it is the TOTAL that
  // matters: a vehicle with no services but one logged accident still has a
  // history worth sending, and disabling the button there would be wrong.
  out.isEmpty = out.counts.services + out.counts.repairs + out.counts.accidents === 0;

  return out;
}

/**
 * ReminderEngine.js
 * Centralized, pure-function reminder calculation logic.
 * No React, no side effects - just data in, reminder items out.
 */

import { differenceInDays, differenceInYears, subMonths } from 'date-fns';
import { getVehicleLabels, isVessel } from './DateStatusUtils';

//  Primitive helpers

/**
 * Days until a date string. Negative means past due.
 *
 * Expects `dateStr` to be a calendar date ('YYYY-MM-DD' or longer ISO).
 * Both sides use LOCAL midnight so the math stays stable across
 * timezones. The old implementation mixed parseISO (UTC midnight for
 * date-only strings) with local-midnight `today`, which quietly truncated
 * negative diffs to 0 — e.g. an expired-yesterday cert reported as
 * "today" for several hours instead of "-1 (expired)".
 *
 * NOTE: if you pass a full timestamp like '2025-06-15T22:00:00Z' the
 * date portion is taken verbatim (no TZ conversion). That's correct for
 * the date-only DB columns (`test_due_date`, `insurance_due_date` etc.)
 * and avoids a wrong-day answer at the UTC↔local boundary.
 */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // `new Date('YYYY-MM-DDT00:00:00')` — no trailing Z — is parsed as
    // local midnight of that date (Date constructor, ES2020 spec).
    const target = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
    if (isNaN(target.getTime())) return null;
    return differenceInDays(target, today);
  } catch {
    return null;
  }
}

/** Urgency level from days remaining. */
export function urgencyFromDays(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return 'neutral';
  if (daysLeft < 0) return 'danger';
  if (daysLeft <= 7) return 'warn';
  return 'upcoming';
}

/** Short Hebrew form for day count with correct singular/plural.
 *  1 → "יום", 2 → "יומיים", 3+ → "ימים". */
export function daysWord(n) {
  const abs = Math.abs(n);
  if (abs === 1) return 'יום';
  if (abs === 2) return 'יומיים';
  return 'ימים';
}

/** "בעוד N ימים" with correct plural — handles "בעוד יום" (1),
 *  "בעוד יומיים" (2), "בעוד 3 ימים" (3+). */
export function inDays(n) {
  const abs = Math.abs(n);
  if (abs === 1) return 'בעוד יום';
  if (abs === 2) return 'בעוד יומיים';
  return `בעוד ${abs} ימים`;
}

/** Human-readable Hebrew label for days remaining.
 *  Uses correct singular/plural so "לפני 1 ימים" becomes "לפני יום"
 *  (matches RTL tooltip copy users expect). */
export function daysLabel(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return '';
  if (daysLeft === 0) return 'פג תוקף היום';
  if (daysLeft === 1) return 'פג תוקף מחר';
  if (daysLeft === -1) return 'פג תוקף אתמול';
  const abs = Math.abs(daysLeft);
  if (daysLeft < 0) return `פג תוקף לפני ${abs === 2 ? 'יומיים' : `${abs} ${daysWord(abs)}`}`;
  return `פג תוקף בעוד ${abs === 2 ? 'יומיים' : `${abs} ${daysWord(abs)}`}`;
}

/** Short label variant. */
export function daysLabelShort(daysLeft) {
  if (daysLeft === null) return '';
  if (daysLeft < 0) return `-${Math.abs(daysLeft)} ימים`;
  if (daysLeft === 0) return 'היום';
  return `${daysLeft} ימים`;
}

//  Category → doc type mapping 
const INSURANCE_TYPES = new Set(['ביטוח חובה', 'ביטוח מקיף', 'ביטוח צד ג', 'צד ג']);
const TEST_TYPES      = new Set(['טסט']);
const LICENSE_TYPES   = new Set(['רישיון רכב', 'רישיון נהיגה']);
const SERVICE_TYPES   = new Set(['טיפול תקופתי']);

export function getDocEmoji(documentType) {
  if (INSURANCE_TYPES.has(documentType)) return '🛡️';
  if (TEST_TYPES.has(documentType))      return '🔧';
  if (LICENSE_TYPES.has(documentType))   return '🪪';
  if (SERVICE_TYPES.has(documentType))   return '⚙️';
  return '📄';
}

//  Main calculation 

/**
 * calcReminders({ vehicles, documents, settings })
 * Legacy wrapper. calls calcAllReminders for backward compat.
 */
export function calcReminders({ vehicles = [], documents = [], settings = {} }) {
  return calcAllReminders({ vehicles, documents, settings });
}

/**
 * calcAllReminders. UNIFIED notification engine.
 * Used by: NotificationBell, Notifications page, device notifications.
 *
 * Computes ALL 13 notification types:
 * 1. Test/כושר שייט (with vintage vehicle logic)
 * 2. Insurance
 * 3. Vessel safety (pyro, extinguisher, life raft)
 * 4. Tires (100K km / 3 years)
 * 5. Periodic service (15K km)
 * 6. Shipyard (vessels, 3 years)
 * 7. Brakes (15+ year old vehicles)
 * 8. Mileage update (180+ days)
 * 9. Winter prep (November)
 * 10. Sailing season (April)
 * 11. Documents
 *
 * Each item: { id, type, emoji, typeName, name, dueDate, daysLeft, status, linkTo, vehicleId }
 */
export function calcAllReminders({ vehicles = [], documents = [], settings = {} }) {
  const threshold  = settings.remind_test_days_before ?? 60;
  const insDays    = settings.remind_insurance_days_before ?? 60;
  const docDays    = settings.remind_document_days_before ?? 14;
  const safetyDays = settings.remind_safety_days_before ?? docDays;
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const items = [];
  let mileageDates = {};
  try {
    const parsed = JSON.parse(localStorage.getItem('carreminder_mileage_dates') || '{}');
    // Defensive: if a previous buggy write put an array/string here, reset.
    mileageDates = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (err) {
    if (import.meta.env?.DEV) console.warn('[ReminderEngine] mileage_dates corrupt, resetting:', err?.message);
  }

  vehicles.forEach(v => {
    const vLabels = getVehicleLabels(v.vehicle_type, v.nickname);
    const vName = v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ') || vLabels.vehicleFallback;
    const isV = isVessel(v.vehicle_type, v.nickname);
    const vehicleAge = v.year ? now.getFullYear() - Number(v.year) : 0;
    // Vintage threshold: 30 years for every non-vessel type (cars,
    // motorcycles, trucks, off-road, etc.). Vessels have their own
    // regulatory cycle and are excluded.
    const isVintage = !isV && (v.is_vintage || vehicleAge >= 30);

    // 1. Test / כושר שייט (with vintage logic)
    if (v.test_due_date) {
      let nextTestDate = new Date(v.test_due_date);
      if (isVintage && nextTestDate > now) {
        // date-fns subMonths handles month-boundary edge cases
        // (e.g. 2025-03-31 - 6mo = 2024-09-30, not 2024-10-01 as Date's
        // naive setMonth can produce when the day doesn't exist in the
        // target month).
        const halfTest = subMonths(nextTestDate, 6);
        if (halfTest > now) nextTestDate = halfTest;
      }
      const dl = Math.ceil((nextTestDate - now) / 86400000);
      const vintageTag = isVintage ? ' (אספנות)' : '';
      if (dl <= threshold) {
        items.push({
          id: `test-${v.id}`, type: 'test', emoji: '📋',
          typeName: vLabels.testWord,
          name: vName, vehicleId: v.id,
          dueDate: v.test_due_date, daysLeft: dl,
          status: urgencyFromDays(dl),
          label: dl < 0 ? `${vLabels.testWord} פג תוקף!${vintageTag}` : `${vLabels.testWord} ${inDays(dl)}${vintageTag}`,
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    }

    // 2. Insurance
    if (v.insurance_due_date) {
      const dl = daysUntil(v.insurance_due_date);
      if (dl !== null && dl <= insDays) {
        const iw = vLabels.insuranceWord || 'ביטוח';
        items.push({
          id: `ins-${v.id}`, type: 'insurance', emoji: '🛡️',
          typeName: iw,
          name: vName, vehicleId: v.id,
          dueDate: v.insurance_due_date, daysLeft: dl,
          status: urgencyFromDays(dl),
          label: dl < 0 ? `${iw} פג תוקף!` : `${iw} ${inDays(dl)}`,
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    }

    // 3. Vessel safety equipment
    if (isV) {
      const safetyItems = [
        { key: 'pyro', field: 'pyrotechnics_expiry_date', emoji: '🔴', word: 'פירוטכניקה' },
        { key: 'ext', field: 'fire_extinguisher_expiry_date', emoji: '🧯', word: 'מטף כיבוי' },
        { key: 'raft', field: 'life_raft_expiry_date', emoji: '🛟', word: 'אסדת הצלה' },
      ];
      safetyItems.forEach(({ key, field, emoji, word }) => {
        if (!v[field]) return;
        const dl = daysUntil(v[field]);
        if (dl !== null && dl <= safetyDays) {
          items.push({
            id: `${key}-${v.id}`, type: 'safety', emoji,
            typeName: word, name: vName, vehicleId: v.id,
            dueDate: v[field], daysLeft: dl,
            status: urgencyFromDays(dl),
            label: dl < 0 ? `${word} פג תוקף!` : `${word} ${inDays(dl)}`,
            linkTo: `VehicleDetail?id=${v.id}`,
          });
        }
      });
    }

    // 4. Tires (100K km / 3 years)
    if (!isV && v.current_km && v.last_tire_change_date) {
      // Use differenceInYears instead of days/365 so leap years don't
      // off-by-one the exact anniversary. Previously a change on
      // 2024-02-29 computed as 0.99 years after 361 days, so vehicles
      // reached the 3-year urgent threshold a day later than expected.
      const tireYears = differenceInYears(now, new Date(v.last_tire_change_date));
      const rawStored = Number(v.km_since_tire_change);
      // Data-integrity guard: the field stores the odometer AT the change,
      // so a value > current_km is impossible (the car can't have been
      // driven "backwards"). Treat that as corrupted input and fall back
      // to 0 rather than emitting a massive negative kmSinceTire that
      // would flap the 90k/100k thresholds into the wrong direction.
      const valid = Number.isFinite(rawStored) && rawStored >= 0 && rawStored <= v.current_km;
      const kmSinceTire = valid ? (v.current_km - rawStored) : 0;
      if (kmSinceTire >= 90000 || tireYears >= 2.75) {
        const urgent = kmSinceTire >= 100000 || tireYears >= 3;
        items.push({
          id: `tires-${v.id}`, type: 'maintenance', emoji: '🔧',
          typeName: 'צמיגים', name: vName, vehicleId: v.id,
          dueDate: null, daysLeft: urgent ? 0 : 30,
          status: urgent ? 'danger' : 'warn',
          label: urgent ? 'הגיע זמן להחליף צמיגים!' : 'החלפת צמיגים מתקרבת',
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    }

    // 5. Periodic service (15K km)
    if (!isV && v.current_km) {
      const lastServiceKm = v.km_baseline || 0;
      const kmSince = v.current_km - lastServiceKm;
      if (kmSince >= 13500) {
        const urgent = kmSince >= 15000;
        items.push({
          id: `service-${v.id}`, type: 'maintenance', emoji: '⚙️',
          typeName: 'טיפול', name: vName, vehicleId: v.id,
          dueDate: null, daysLeft: urgent ? 0 : 30,
          status: urgent ? 'danger' : 'warn',
          label: urgent ? `טיפול תקופתי נדרש (${Math.round(kmSince / 1000)}K ק"מ)` : `טיפול מתקרב (${Math.round(kmSince / 1000)}K ק"מ)`,
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    }

    // 6. Shipyard (vessels, 3 years)
    if (isV && v.last_shipyard_date) {
      const shipYears = differenceInYears(now, new Date(v.last_shipyard_date));
      if (shipYears >= 2.75) {
        const urgent = shipYears >= 3;
        items.push({
          id: `shipyard-${v.id}`, type: 'maintenance', emoji: '🚢',
          typeName: 'מספנה', name: vName, vehicleId: v.id,
          dueDate: null, daysLeft: urgent ? 0 : 30,
          status: urgent ? 'danger' : 'warn',
          label: urgent ? 'הגיע זמן לביקור מספנה!' : 'ביקור מספנה מתקרב',
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    }

    // 7. Brakes (15+ year vehicles)
    // Fires for upcoming AND overdue tests — the old guard (td > 0) muted
    // the alert the moment the test expired, which is the WORST time to
    // stop reminding the owner that their 15-year-old car still needs a
    // brakes certificate before the new test. Now it nags until the test
    // is renewed.
    if (!isV && vehicleAge >= 15 && v.test_due_date) {
      const td = daysUntil(v.test_due_date);
      if (td !== null && td <= 60) {
        const overdue = td < 0;
        items.push({
          id: `brakes-${v.id}`, type: 'safety', emoji: '🛑',
          typeName: 'בלמים', name: vName, vehicleId: v.id,
          dueDate: v.test_due_date, daysLeft: td,
          status: overdue ? 'danger' : 'warn',
          label: `${vLabels.vehicleWord || 'רכב'} ותיק (${vehicleAge} שנים), נדרש אישור בלמים`,
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    }

    // 8. Mileage update (180+ days)
    const mDate = mileageDates[v.id] || v.km_update_date || v.engine_hours_update_date;
    if (mDate) {
      const mDays = Math.floor((now - new Date(mDate)) / 86400000);
      if (mDays > 180) {
        items.push({
          id: `mileage-${v.id}`, type: 'mileage', emoji: '📊',
          typeName: 'עדכון', name: vName, vehicleId: v.id,
          dueDate: null, daysLeft: 999,
          status: 'upcoming',
          label: !isV ? `עדכן קילומטראז' (${mDays} ימים)` : `עדכן שעות מנוע (${mDays} ימים)`,
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    } else if (v.current_km || v.current_engine_hours) {
      items.push({
        id: `mileage-${v.id}`, type: 'mileage', emoji: '📊',
        typeName: 'עדכון', name: vName, vehicleId: v.id,
        dueDate: null, daysLeft: 999,
        status: 'upcoming',
        label: !isV ? 'עדכן קילומטראז\'' : 'עדכן שעות מנוע',
        linkTo: `VehicleDetail?id=${v.id}`,
      });
    }
  });

  // 9. Winter prep (November)
  const month = now.getMonth();
  const hasLand = vehicles.some(v => !isVessel(v.vehicle_type, v.nickname));
  const hasBoat = vehicles.some(v => isVessel(v.vehicle_type, v.nickname));
  if (month === 10 && hasLand && !localStorage.getItem(`winter_dismissed_${now.getFullYear()}`)) {
    items.push({
      id: 'winter-prep', type: 'seasonal', emoji: '❄️',
      typeName: 'עונתי', name: 'בדוק: סוללה, מגבים, צמיגים, מים, אורות',
      vehicleId: null, dueDate: null, daysLeft: 500,
      status: 'upcoming',
      label: 'הכן את הרכב לחורף',
      linkTo: 'Dashboard',
    });
  }

  // 10. Sailing season (April)
  if (month === 3 && hasBoat && !localStorage.getItem(`sailing_dismissed_${now.getFullYear()}`)) {
    items.push({
      id: 'sailing-season', type: 'seasonal', emoji: '⛵',
      typeName: 'עונתי', name: 'בדוק: ציוד בטיחות, מנוע, תחתית, מפרשים',
      vehicleId: null, dueDate: null, daysLeft: 500,
      status: 'upcoming',
      label: 'עונת ההפלגה מתחילה!',
      linkTo: 'Dashboard',
    });
  }

  // 11. Documents
  (documents || []).forEach(doc => {
    if (!doc.expiry_date) return;
    const dl = daysUntil(doc.expiry_date);
    if (dl !== null && dl <= docDays) {
      items.push({
        id: `doc-${doc.id}`, type: 'document',
        emoji: getDocEmoji(doc.document_type),
        typeName: doc.document_type || 'מסמך',
        name: doc.title || doc.document_type || 'מסמך',
        vehicleId: doc.vehicle_id || null,
        dueDate: doc.expiry_date, daysLeft: dl,
        status: urgencyFromDays(dl),
        label: dl < 0 ? `${doc.document_type || 'מסמך'} פג תוקף!` : `${doc.document_type || 'מסמך'} ${inDays(dl)}`,
        linkTo: doc.vehicle_id ? `Documents?vehicle_id=${doc.vehicle_id}` : 'Documents',
      });
    }
  });

  // Sort: expired first, then by days ascending
  items.sort((a, b) => {
    if (a.daysLeft < 0 && b.daysLeft >= 0) return -1;
    if (a.daysLeft >= 0 && b.daysLeft < 0) return 1;
    return a.daysLeft - b.daysLeft;
  });

  return items;
}

/**
 * calcUsageAlerts({ vehicle, logs, catalog })
 *
 * Returns an array of km/hours-based maintenance alerts for a single vehicle.
 * Uses the latest maintenance log per type and compares current usage against
 * the catalog interval.
 *
 * Each alert:
 * {
 *   maintenanceName: string,
 *   intervalUsage: number,       km or hours threshold
 *   usageSinceService: number,   how much driven since last service
 *   percentUsed: number,         0-100+
 *   status: 'ok' | 'warn' | 'danger',
 *   unit: 'ק״מ' | 'שעות',
 * }
 */
export function calcUsageAlerts({ vehicle, logs = [], catalog = [] }) {
  const currentKm    = vehicle.current_km    ? Number(vehicle.current_km)    : null;
  const currentHours = vehicle.current_engine_hours ? Number(vehicle.current_engine_hours) : null;

  const alerts = [];

  catalog.forEach(item => {
    if (!item.km || item.km <= 0) return; // no km interval defined

    // Find the most recent log for this maintenance type
    const relevant = logs
      .filter(l => l.maintenance_type === item.name && l.km_at_service)
      .sort((a, b) => Number(b.km_at_service) - Number(a.km_at_service));

    const lastLog = relevant[0];
    const lastKm  = lastLog ? Number(lastLog.km_at_service) : null;
    const current = currentKm;

    if (current === null) return; // no current reading. skip

    // If no log exists, count from km_baseline (the odometer when the vehicle was added).
    // This ensures alerts only fire after the user has actually driven an interval since joining 
    // not immediately because the odometer was high when they first registered.
    const baseline  = vehicle.km_baseline != null ? Number(vehicle.km_baseline) : current;
    const since     = lastKm !== null ? current - lastKm : current - baseline;
    const pct       = Math.round((since / item.km) * 100);
    const status    = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok';

    if (status !== 'ok') {
      alerts.push({
        maintenanceName: item.name,
        intervalUsage: item.km,
        usageSinceService: since,
        percentUsed: pct,
        status,
        unit: 'ק״מ',
      });
    }
  });

  // Hours-based (same logic for engine hours)
  catalog.forEach(item => {
    if (!item.hours || item.hours <= 0) return;

    const relevant = logs
      .filter(l => l.maintenance_type === item.name && l.engine_hours_at_service)
      .sort((a, b) => Number(b.engine_hours_at_service) - Number(a.engine_hours_at_service));

    const lastLog   = relevant[0];
    const lastHours = lastLog ? Number(lastLog.engine_hours_at_service) : null;
    const current   = currentHours;

    if (current === null) return;

    const hoursBaseline = vehicle.engine_hours_baseline != null ? Number(vehicle.engine_hours_baseline) : current;
    const since  = lastHours !== null ? current - lastHours : current - hoursBaseline;
    const pct    = Math.round((since / item.hours) * 100);
    const status = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : 'ok';

    if (status !== 'ok') {
      alerts.push({
        maintenanceName: item.name,
        intervalUsage: item.hours,
        usageSinceService: since,
        percentUsed: pct,
        status,
        unit: 'שעות',
      });
    }
  });

  // Deduplicate: if same maintenanceName appears for both km and hours, keep the worse one
  const seen = new Map();
  alerts.forEach(a => {
    const existing = seen.get(a.maintenanceName);
    if (!existing || a.percentUsed > existing.percentUsed) seen.set(a.maintenanceName, a);
  });

  return Array.from(seen.values()).sort((a, b) => b.percentUsed - a.percentUsed);
}

/**
 * getDocumentStatus({ doc, settings })
 * Returns status info for a single document based on reminder settings.
 */
export function getDocumentStatus(doc, settings = {}) {
  if (!doc.expiry_date) return null;
  const docDays = settings.remind_document_days_before ?? 14;
  const dl = daysUntil(doc.expiry_date);
  if (dl === null) return null;
  return {
    daysLeft: dl,
    status: dl < 0 ? 'danger' : dl <= docDays ? 'warn' : 'ok',
    label: daysLabel(dl),
    labelShort: daysLabelShort(dl),
  };
}

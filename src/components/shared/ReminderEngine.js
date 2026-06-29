/**
 * ReminderEngine.js
 * Centralized, pure-function reminder calculation logic.
 * No React, no side effects - just data in, reminder items out.
 */

import { differenceInDays, differenceInYears } from 'date-fns';
import { getVehicleLabels, isVessel, getTestPolicy, usesHours, isGenerator } from './DateStatusUtils';

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

/** Natural Hebrew "in N days" — handles:
 *    0 → "היום!"          (day-of, urgent)
 *    1 → "מחר"            (tomorrow)
 *    2 → "בעוד יומיים"
 *    7 → "בעוד שבוע"
 *    14 → "בעוד שבועיים"
 *    30 → "בעוד חודש"
 *    else → "בעוד N ימים"
 *
 *  We prefer human time units (שבוע/שבועיים/חודש) over raw day counts
 *  on the round boundaries — "בעוד שבוע" reads like a friend wrote it;
 *  "בעוד 7 ימים" reads like a robot. 1 day specifically becomes "מחר"
 *  instead of "בעוד יום" — the user already knows tomorrow exists.
 *  0 keeps its "!" because day-of is the most urgent slot. */
export function inDays(n) {
  const abs = Math.abs(n);
  if (abs === 0)  return 'היום!';
  if (abs === 1)  return 'מחר';
  if (abs === 2)  return 'בעוד יומיים';
  if (abs === 7)  return 'בעוד שבוע';
  if (abs === 14) return 'בעוד שבועיים';
  if (abs === 30) return 'בעוד חודש';
  return `בעוד ${abs} ימים`;
}

/** Natural Hebrew "N days ago" — mirror of inDays for the past:
 *    0 → "היום"
 *    1 → "אתמול"
 *    2 → "לפני יומיים"
 *    7 → "לפני שבוע"
 *    14 → "לפני שבועיים"
 *    30 → "לפני חודש"
 *    else → "לפני N ימים"
 *
 *  Used in overdue labels to tell the user HOW LONG something has
 *  been expired. Previously the engine just said "פג תוקף!" with no
 *  time context — bad UX, the user couldn't tell if it expired today
 *  or a year ago. */
export function daysAgo(n) {
  const abs = Math.abs(n);
  if (abs === 0)  return 'היום';
  if (abs === 1)  return 'אתמול';
  if (abs === 2)  return 'לפני יומיים';
  if (abs === 7)  return 'לפני שבוע';
  if (abs === 14) return 'לפני שבועיים';
  if (abs === 30) return 'לפני חודש';
  return `לפני ${abs} ימים`;
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

//  Generator reminder cadences (Phase 2)
// Per generator_type recommendation defaults. These drive DERIVED reminders
// (next-due = last-done date + interval), never hard regulatory dates. The
// detail page carries the "guidance only" liability note (spec section 11).
//   serviceMonths : annual full-service interval (calendar)
//   serviceHours  : work-hours service interval (250h light / 500h heavy)
//   loadTest      : whether this type gets a yearly load-bank test reminder
//   safety        : whether this type gets a yearly safety/fire-approval reminder
//                   (also forced on when the user marks requires_fire_dept_approval='כן')
//   checkMonths   : periodic operation-check cadence (1=monthly for emergency/
//                   critical, 3=quarterly for fixed/industrial, null=none)
export const GENERATOR_REMINDER_DEFAULTS = {
  'גנרטור ביתי קטן':                { serviceMonths: 12, serviceHours: 250, loadTest: false, safety: false, checkMonths: null },
  'גנרטור נייד / שטח / אירועים':     { serviceMonths: 12, serviceHours: 250, loadTest: false, safety: false, checkMonths: null },
  'גנרטור קבוע לעסק / מבנה':         { serviceMonths: 12, serviceHours: 500, loadTest: true,  safety: false, checkMonths: 3 },
  'גנרטור חירום':                   { serviceMonths: 12, serviceHours: 500, loadTest: true,  safety: true,  checkMonths: 1 },
  'גנרטור תעשייתי':                 { serviceMonths: 12, serviceHours: 500, loadTest: true,  safety: false, checkMonths: 3 },
  'גנרטור למתקן רפואי / מתקן קריטי': { serviceMonths: 12, serviceHours: 500, loadTest: true,  safety: true,  checkMonths: 1 },
  'אחר':                           { serviceMonths: 12, serviceHours: 250, loadTest: false, safety: false, checkMonths: null },
  _default:                        { serviceMonths: 12, serviceHours: 250, loadTest: false, safety: false, checkMonths: null },
};

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
    // Test category (aging / collector / new / regular). gov.il's
    // test_due_date is AUTHORITATIVE for the date — the Ministry already
    // encodes the real interval (6-monthly for aging cars, annual for
    // collectors, etc.). The policy only supplies the display tag.
    // The old "subtract 6 months for any 30+ vehicle" heuristic was removed:
    // it mis-tagged every 30+ car as אספנות AND applied the aging 6-month
    // interval to collectors — exactly backwards from the law.
    const testPolicy = getTestPolicy(v);
    const testTag = testPolicy.category === 'aging'
      ? ' (מיושן)'
      : testPolicy.category === 'collector'
        ? ' (אספנות)'
        : '';

    // 1. Test / כושר שייט — date comes straight from gov.il, no local shift.
    if (v.test_due_date) {
      const nextTestDate = new Date(v.test_due_date);
      const dl = Math.ceil((nextTestDate - now) / 86400000);
      const vintageTag = testTag;
      if (dl <= threshold) {
        items.push({
          id: `test-${v.id}`, type: 'test', emoji: '📋',
          typeName: vLabels.testWord,
          name: vName, vehicleId: v.id,
          dueDate: v.test_due_date, daysLeft: dl,
          status: urgencyFromDays(dl),
          label: dl < 0
            ? `${vLabels.testWord} פג ${daysAgo(dl)}${vintageTag}`
            : `${vLabels.testWord} ${inDays(dl)}${vintageTag}`,
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
          label: dl < 0 ? `${iw} פג ${daysAgo(dl)}` : `${iw} ${inDays(dl)}`,
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    }

    // 2b. Inspection report ("תסקיר") — periodic safety certificate.
    // Optional everywhere; fires only when the user filled the date.
    // Reuses the test-window `threshold` so inspection reminders show
    // up alongside the equivalent טסט reminders without needing a
    // separate setting.
    if (v.inspection_report_expiry_date) {
      const dl = daysUntil(v.inspection_report_expiry_date);
      if (dl !== null && dl <= threshold) {
        items.push({
          id: `inspect-${v.id}`, type: 'inspection', emoji: '📑',
          typeName: 'תסקיר',
          name: vName, vehicleId: v.id,
          dueDate: v.inspection_report_expiry_date, daysLeft: dl,
          status: urgencyFromDays(dl),
          label: dl < 0 ? `תסקיר פג ${daysAgo(dl)}` : `תסקיר ${inDays(dl)}`,
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
            label: dl < 0 ? `${word} פג ${daysAgo(dl)}` : `${word} ${inDays(dl)}`,
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
      // `km_since_tire_change` stores the ODOMETER AT the change (form label:
      // "קילומטראז׳ בעת ההחלפה") and is OPTIONAL. Require a POSITIVE reading
      // before using the km path: a missing / 0 / corrupt value means "no km
      // baseline" (you don't change tires at 0 km), NOT "changed at 0 km".
      // Without this, a blank km on a high-mileage car made kmSinceTire = the
      // FULL odometer → a false "replace tires now". With no baseline we fall
      // back to the age (tireYears) check only.
      const hasKmBaseline = Number.isFinite(rawStored) && rawStored > 0 && rawStored <= v.current_km;
      const kmSinceTire = hasKmBaseline ? (v.current_km - rawStored) : 0;
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

    // 5. Periodic service (15K km) — needs a real odometer baseline
    // (km_baseline = odometer at last service). A NULL baseline means "no
    // data": skip it. Treating null as 0 (the old `|| 0`) made kmSince = the
    // FULL odometer → a false "service overdue (140K ק"מ)" on every
    // high-mileage car without a baseline. A stored 0 is allowed (car tracked
    // from new); a corrupt value > current_km falls back to no-fire.
    if (!isV && v.current_km && v.km_baseline != null) {
      const lastServiceKm = Number(v.km_baseline);
      const kmSince = (Number.isFinite(lastServiceKm) && lastServiceKm <= v.current_km)
        ? v.current_km - lastServiceKm
        : 0;
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

    // 7b. Winter inspection (בדיקת חורף) — heavy trucks > 10t must pass a
    // mandatory inspection during Nov–Mar. Seasonal reminder: surface it from
    // the start of October so the owner can book before the legal window.
    if (testPolicy.winterInspection) {
      const m = now.getMonth();              // 0=Jan … 9=Oct … 11=Dec
      if (m >= 9 || m <= 2) {                // October → March
        const inWindow = m >= 10 || m <= 2;  // November → March (legal window)
        items.push({
          id: `winter-${v.id}`, type: 'safety', emoji: '❄️',
          typeName: 'בדיקת חורף', name: vName, vehicleId: v.id,
          dueDate: null, daysLeft: inWindow ? 0 : 30,
          status: inWindow ? 'warn' : 'upcoming',
          label: 'נדרשת בדיקת חורף למשאית (נובמבר עד מרץ)',
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    }

    // 8. Mileage update (180+ days)
    const mDate = mileageDates[v.id] || v.km_update_date || v.engine_hours_update_date;
    // Usage-update wording follows the vehicle's actual metric: generators
    // track "שעות עבודה", vessels / CME / tractors track "שעות מנוע", the
    // rest track "קילומטראז'". Previously this branched only on isVessel, so
    // a generator (and every CME machine) was told to update "קילומטראז'".
    const usageUpdateWord = isGenerator(v.vehicle_type)
      ? 'עדכן שעות עבודה'
      : usesHours(v)
        ? 'עדכן שעות מנוע'
        : 'עדכן קילומטראז\'';
    if (mDate) {
      const mDays = Math.floor((now - new Date(mDate)) / 86400000);
      if (mDays > 180) {
        items.push({
          id: `mileage-${v.id}`, type: 'mileage', emoji: '📊',
          typeName: 'עדכון', name: vName, vehicleId: v.id,
          dueDate: null, daysLeft: 999,
          status: 'upcoming',
          label: `${usageUpdateWord} (${mDays} ימים)`,
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      }
    } else if (v.current_km || v.current_engine_hours) {
      items.push({
        id: `mileage-${v.id}`, type: 'mileage', emoji: '📊',
        typeName: 'עדכון', name: vName, vehicleId: v.id,
        dueDate: null, daysLeft: 999,
        status: 'upcoming',
        label: usageUpdateWord,
        linkTo: `VehicleDetail?id=${v.id}`,
      });
    }

    // 12. Generator-derived reminders (Phase 2).
    // Generators have no test/insurance. Instead we derive "next due" from the
    // last-done date + a per-type cadence (annual service / load test / safety
    // approval), an hours-based service interval, and a periodic operation
    // check for emergency/critical units. All recommendations — the detail
    // page shows the "guidance only" liability note.
    if (isGenerator(v.vehicle_type)) {
      const cfg = GENERATOR_REMINDER_DEFAULTS[v.generator_type] || GENERATOR_REMINDER_DEFAULTS._default;

      // anchor date + N months → next-due; surface only within `threshold` days.
      const addByDate = (anchor, months, key, emoji, word) => {
        if (!anchor || !months) return;
        const due = new Date(`${String(anchor).slice(0, 10)}T00:00:00`);
        if (isNaN(due.getTime())) return;
        due.setMonth(due.getMonth() + months);
        const dueIso = due.toISOString().slice(0, 10);
        const dl = daysUntil(dueIso);
        if (dl === null || dl > threshold) return;
        items.push({
          id: `${key}-${v.id}`, type: 'maintenance', emoji,
          typeName: word, name: vName, vehicleId: v.id,
          dueDate: dueIso, daysLeft: dl, status: urgencyFromDays(dl),
          label: dl < 0 ? `${word} ${daysAgo(dl)}` : `${word} ${inDays(dl)}`,
          linkTo: `VehicleDetail?id=${v.id}`,
        });
      };

      addByDate(v.last_service_date, cfg.serviceMonths, 'gen-service', '⚙️', 'טיפול שנתי לגנרטור');
      if (cfg.loadTest) addByDate(v.last_load_bank_test_date, 12, 'gen-loadtest', '🔌', 'בדיקת עומס לגנרטור');
      if (cfg.safety || v.requires_fire_dept_approval === 'כן') {
        addByDate(v.last_safety_approval_date, 12, 'gen-safety', '📋', 'חידוש אישור תקינות לגנרטור');
      }

      // Periodic operation check (monthly for emergency/critical, quarterly for
      // fixed/industrial). Anchored on the most recent activity so any update or
      // logged service resets the clock; surfaced from a week before it's due.
      if (cfg.checkMonths) {
        // Anchor on the MOST RECENT activity (not the first available), so a
        // recent hours update / service resets the periodic-check clock.
        const anchorTimes = [v.last_service_date, v.engine_hours_update_date, v.km_update_date, v.created_at]
          .map(d => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).getTime() : NaN))
          .filter(t => Number.isFinite(t));
        if (anchorTimes.length) {
          const due = new Date(Math.max(...anchorTimes));
          if (!isNaN(due.getTime())) {
            due.setMonth(due.getMonth() + cfg.checkMonths);
            const dl = daysUntil(due.toISOString().slice(0, 10));
            if (dl !== null && dl <= 7) {
              const word = cfg.checkMonths === 1 ? 'בדיקה חודשית לגנרטור' : 'בדיקה תקופתית לגנרטור';
              items.push({
                id: `gen-check-${v.id}`, type: 'maintenance', emoji: '🔍',
                typeName: word, name: vName, vehicleId: v.id,
                dueDate: due.toISOString().slice(0, 10), daysLeft: dl, status: urgencyFromDays(dl),
                label: dl < 0 ? `${word} ${daysAgo(dl)}` : `${word} ${inDays(dl)}`,
                linkTo: `VehicleDetail?id=${v.id}`,
              });
            }
          }
        }
      }

      // Hours-based service. Counts work-hours since the last service (or the
      // baseline at add-time). Unknown history → count from current, so a fresh
      // generator never false-fires.
      const curHrs = v.current_engine_hours != null && v.current_engine_hours !== ''
        ? Number(v.current_engine_hours) : null;
      if (curHrs != null && cfg.serviceHours) {
        const baseHrs = (v.work_hours_at_last_service != null && v.work_hours_at_last_service !== '')
          ? Number(v.work_hours_at_last_service)
          : (v.engine_hours_baseline != null && v.engine_hours_baseline !== '')
            ? Number(v.engine_hours_baseline)
            : curHrs;
        const hoursSince = curHrs - baseHrs;
        if (Number.isFinite(hoursSince) && hoursSince >= cfg.serviceHours * 0.9) {
          const urgent = hoursSince >= cfg.serviceHours;
          items.push({
            id: `gen-hours-${v.id}`, type: 'maintenance', emoji: '🛠️',
            typeName: 'טיפול לפי שעות', name: vName, vehicleId: v.id,
            dueDate: null, daysLeft: urgent ? 0 : 30,
            status: urgent ? 'danger' : 'warn',
            label: urgent
              ? `טיפול לגנרטור נדרש (${Math.round(hoursSince)} שעות עבודה)`
              : `טיפול לגנרטור מתקרב (${Math.round(hoursSince)} שעות עבודה)`,
            linkTo: `VehicleDetail?id=${v.id}`,
          });
        }
      }
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
        label: dl < 0
          ? `${doc.document_type || 'מסמך'} פג ${daysAgo(dl)}`
          : `${doc.document_type || 'מסמך'} ${inDays(dl)}`,
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

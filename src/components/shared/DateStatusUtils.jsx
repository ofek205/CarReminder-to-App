import { differenceInDays, parseISO, format } from 'date-fns';

export function getDateStatus(dateStr) {
  if (!dateStr) return { status: 'neutral', label: 'לא הוזן', daysLeft: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = parseISO(dateStr);
  const days = differenceInDays(target, today);

  if (days < 0) return { status: 'danger', label: `באיחור ${Math.abs(days)} ימים`, daysLeft: days };
  if (days <= 14) return { status: 'warn', label: `בעוד ${days} ימים`, daysLeft: days };
  return { status: 'ok', label: `תקין - ${format(target, 'dd/MM/yyyy')}`, daysLeft: days };
}

export function formatDateHe(dateStr) {
  if (!dateStr) return 'לא הוזן';
  return format(parseISO(dateStr), 'dd/MM/yyyy');
}

export function getVehicleTypeIcon(type) {
  switch (type) {
    case 'רכב': return '🚗';
    case 'אופנוע כביש': return '🏍️';
    case 'אופנוע שטח': return '🏔️';
    // 2026-05-17: אנדורו ומוטוקרוס שניהם אופנועי שטח מבחינת אייקון.
    case 'אנדורו': return '🏔️';
    case 'מוטוקרוס': return '🏔️';
    case 'טרקטורון': return '🏎️';
    case 'קטנוע': return '🛵';
    case "ג'יפ שטח": case 'כלי שטח': return '🏔️';
    case 'RZR': return '🏁';
    case 'מיול': return '🚜';
    case 'באגי חולות': return '🏜️';
    default: return '🚗';
  }
}

export function normalizePlate(plate) {
  if (!plate || typeof plate !== 'string') return '';
  return plate.replace(/[^0-9]/g, '');
}

/** Off-road vehicle types.
 *  2026-05-17: אנדורו ומוטוקרוס נוספו כי הם החלפים החדשים של "אופנוע שטח"
 *  הישן. שניהם כלי שטח לכל דבר ועניין מבחינת לוגיקת תצוגה. */
const OFFROAD_TYPES = new Set([
  'כלי שטח', "ג'יפ שטח", 'טרקטורון', 'אופנוע שטח', 'אנדורו', 'מוטוקרוס', 'RZR', 'מיול', 'באגי חולות',
]);
// Always-hours types: read engine hours, never km. Includes the
// off-road toys that physically use a Hobbs meter (RZR / מיול) AND the
// full כלי צמ"ה family (forklifts, excavators, loaders, rollers,
// cranes, drillers, telehandlers) — heavy equipment is hour-metered
// even on wheeled chassis. Tractors are agricultural equipment that
// also use engine hours operationally.
const OFFROAD_HOURS_TYPES = new Set([
  'RZR', 'מיול',
  // CME (כלי צמ"ה) — every subtype from CME_SUBCATEGORIES
  'מחפר', 'מחפר זחלי', 'מחפר אופני', 'מיני מחפר', 'מחפרון',
  'דחפור', 'דחפור זחלי',
  'שופל', 'מעמיס אופני', 'מעמיס זחלי', 'מיני מעמיס',
  'בובקט',
  'טליהנדלר', 'מלגזה', 'מלגזת שטח',
  'מפלסת',
  'מכבש', 'מכבש אספלט', 'מכבש קרקע',
  'מערבל בטון', 'משאבת בטון',
  'מנוף', 'מנוף נייד', 'מנוף זחלי',
  'מקדח קרקע', 'ציוד קידוח',
  'רכב צמ"ה',
  // Tractors & similar agri equipment
  'טרקטור', 'מחרשה',
]);

/** Returns true if this vehicle type is an off-road vehicle. */
export function isOffroad(vehicleType) {
  return OFFROAD_TYPES.has(vehicleType);
}

/** Vessel type names - used to identify boats/yachts/watercraft.
 *  Single source of truth for the whole app — AdminUserDrawer used to
 *  maintain its own local copy with three extra types ('יאכטה',
 *  'יאכטה מנועית', "ג'ט סקי"). All have been folded in here so admin
 *  views and user-facing views share the same definition. */
const VESSEL_TYPES = new Set([
  'כלי שייט', 'מפרשית', 'סירה מנועית', 'אופנוע ים', 'סירת גומי',
  'יאכטה', 'יאכטה מנועית', "ג'ט סקי", 'ג׳ט סקי',
]);

// Nickname keywords that indicate a vessel even when vehicle_type is generic (e.g. 'רכב')
const _VESSEL_NICK_KEYWORDS = ['יאכטה', 'סירה', 'שייט', 'מפרשית', 'ספינה', 'סירת', 'גומי', 'אופנוע ים', 'ג\'ט סקי', 'jet ski'];

/** Returns true if this vehicle type is a watercraft (vessel). Checks both vehicle_type and nickname. */
export function isVessel(vehicleType, nickname) {
  if (VESSEL_TYPES.has(vehicleType)) return true;
  if (nickname && _VESSEL_NICK_KEYWORDS.some(kw => nickname.includes(kw))) return true;
  return false;
}

// Off-road types where the user can choose either metric (km *or* engine hours).
// For these, we detect the active metric from the vehicle's own data. if
// current_engine_hours is set and current_km isn't, the user picked hours.
// 2026-05-17: אנדורו ומוטוקרוס נוספו כיורשי 'אופנוע שטח' הישן. שניהם
// יכולים להימדד בק"מ או בשעות לבחירת המשתמש, כמו כל אופנוע שטח.
const OFFROAD_TOGGLE_TYPES = new Set(["ג'יפ שטח", 'טרקטורון', 'באגי חולות', 'אופנוע שטח', 'אנדורו', 'מוטוקרוס']);

// Both helpers accept EITHER (vehicleType, nickname). original signature used
// all over the app. OR a full vehicle object (preferred for toggle-able
// off-road types so we can respect the user's actual unit choice).
export function usesKm(vehicleOrType, nickname) {
  const isObj = vehicleOrType && typeof vehicleOrType === 'object';
  const vt = isObj ? vehicleOrType.vehicle_type : vehicleOrType;
  const nn = isObj ? vehicleOrType.nickname : nickname;
  if (isVessel(vt, nn)) return false;
  if (OFFROAD_HOURS_TYPES.has(vt)) return false;
  if (OFFROAD_TOGGLE_TYPES.has(vt)) {
    // User picked hours (and hasn't filled km) → hide km field in
    // maintenance/repair/everywhere. Otherwise default to km.
    if (isObj && vehicleOrType.current_engine_hours && !vehicleOrType.current_km) return false;
    return true;
  }
  return vt === 'רכב' || vt === 'אופנוע כביש' || vt === 'קטנוע';
}

export function usesHours(vehicleOrType, nickname) {
  const isObj = vehicleOrType && typeof vehicleOrType === 'object';
  const vt = isObj ? vehicleOrType.vehicle_type : vehicleOrType;
  const nn = isObj ? vehicleOrType.nickname : nickname;
  if (isVessel(vt, nn)) return true;
  if (OFFROAD_HOURS_TYPES.has(vt)) return true; // RZR, מיול. always hours
  if (OFFROAD_TOGGLE_TYPES.has(vt)) {
    // Toggle-able off-road: show hours when the user populated hours and
    // not km. Also show hours when BOTH are filled (respect the newer data).
    if (isObj && vehicleOrType.current_engine_hours && !vehicleOrType.current_km) return true;
  }
  return false;
}

// Cars / motorcycles / trucks etc. become "vintage" (רכב אספנות) at 30
// years old. The threshold is NOT applied to vessels (כלי שייט),
// which have their own regulatory cycle.
export const VINTAGE_AGE_YEARS = 30;

/** Returns true if the vehicle is considered vintage. Land vehicles only. */
export function isVintageVehicle(year) {
  if (!year) return false;
  return new Date().getFullYear() - Number(year) >= VINTAGE_AGE_YEARS;
}

// ── Test-frequency policy ────────────────────────────────────────────────
// Single source of truth for how a vehicle's טסט is classified.
//
// IMPORTANT: gov.il's `test_due_date` is the AUTHORITATIVE next-test date for
// every vehicle — the Ministry already encodes the real interval (annual,
// 6-monthly for aging cars, etc.) per the specific vehicle and the current
// law. This policy NEVER overrides that date. It exists only to drive:
//   1. the category label/badge shown to the user,
//   2. the list of documents the owner must bring to the test,
//   3. a FALLBACK due-date when gov.il provides none (manual entry).
//
// Israeli private-vehicle rule (as of 2026, per the product spec):
//   • new 0–3y (from first registration) → exempt, first test at age 3
//   • 3–19y                              → annual (12 months)
//   • 19+ "רכב מיושן"                    → every 6 months
//   • "רכב אספנות" (owner-registered)    → annual (12 months)
// A 30+ vehicle that was NOT registered as אספנות stays "מיושן" (6 months)
// until the owner changes its registration — matching the law.
export const AGING_AGE_YEARS = 19;        // רכב מיושן threshold

// Vehicle types that follow the private-car test regime. Trucks, buses, CME,
// trailers and vessels are intentionally excluded here (Phase 2 / own cycle):
// for them we simply trust gov.il's date and show no Phase-1 frequency.
const PRIVATE_TEST_TYPES = new Set(['רכב', 'אופנוע כביש', 'קטנוע']);

// gov.il lookup results carry a `_detectedType` code (and a free-text
// `_detectedTypeLabel` like "רכב מסחרי") rather than the app's saved
// vehicle_type. Map the codes to the canonical app type so getTestPolicy
// classifies a raw plate-check result identically to a saved vehicle.
// Light commercial ('commercial') shares the private-car test regime, so it
// maps to 'רכב'.
const DETECTED_TYPE_TO_APP = {
  car: 'רכב',
  commercial: 'רכב',
  motorcycle: 'אופנוע כביש',
  truck: 'משאית',
  bus: 'אוטובוס',
  collector: 'רכב אספנות',
  trailer: 'נגרר',
};

/** Vehicle age in whole years, or null when the year is missing/invalid. */
export function getVehicleAge(year) {
  if (!year) return null;
  const n = Number(year);
  if (!Number.isFinite(n)) return null;
  return new Date().getFullYear() - n;
}

/**
 * Returns the test policy for a vehicle. Pure — no network, no side effects.
 * @returns {{
 *   category: 'vessel'|'collector'|'aging'|'new'|'regular'|'other',
 *   frequencyMonths: number|null,   // null = exempt or own regulatory cycle
 *   requiredDocs: string[],         // documents to bring to the test
 *   label: string                   // short Hebrew badge label ('' = none)
 * }}
 */
export function getTestPolicy(vehicle) {
  const v = vehicle || {};
  // Resolve the effective app vehicle_type. A raw gov.il lookup's _detectedType
  // code is the reliable signal (its free-text label may be "רכב מסחרי" etc.),
  // so it wins; a saved vehicle has no _detectedType and falls back to its
  // canonical vehicle_type.
  const type = DETECTED_TYPE_TO_APP[v._detectedType] || v.vehicle_type || v._detectedTypeLabel || '';

  // Vessels follow their own seaworthiness cycle (כושר שייט) — excluded.
  if (isVessel(type, v.nickname)) {
    return { category: 'vessel', frequencyMonths: null, requiredDocs: [], label: '' };
  }

  // רכב אספנות: a deliberate owner registration (selected vehicle type),
  // not merely an old car. Annual test, needs a yearly fitness certificate.
  if (type === 'רכב אספנות') {
    return {
      category: 'collector',
      frequencyMonths: 12,
      requiredDocs: ['אישור תקינות שנתי ממוסך מורשה'],
      label: 'רכב אספנות',
    };
  }

  const age = getVehicleAge(v.year);

  // Bus (אוטובוס): public-transport regime. New buses test from the end of
  // their first year (no 3-year exemption); a bus 15+ years old tests twice
  // a year. Only the 15+ case is badged (the non-default situation).
  if (type === 'אוטובוס') {
    const sixMonthly = age !== null && age >= 15;
    return {
      category: 'bus',
      frequencyMonths: sixMonthly ? 6 : 12,
      requiredDocs: ['בדיקת רישוי'],
      label: sixMonthly ? 'אוטובוס מעל 15 שנה' : '',
    };
  }

  // Heavy truck (משאית): annual test from first registration. Trucks over
  // 10,000 kg also need a mandatory winter inspection (November–March) with a
  // yearly fitness certificate. total_weight is synced from gov.il, so the
  // >10t case is detected automatically.
  if (type === 'משאית') {
    const over10t = Number(v.total_weight) > 10000;
    return {
      category: 'heavy',
      frequencyMonths: 12,
      requiredDocs: over10t
        ? ['אישור תקינות שנתי ממוסך מורשה', 'בדיקת חורף (נובמבר עד מרץ)']
        : ['בדיקת רישוי'],
      label: over10t ? 'משאית מעל 10 טון' : '',
      winterInspection: over10t,
    };
  }

  // רכב מיושן: a PRIVATE car / motorcycle 19+ years old (including 30+ that
  // was NOT registered as אספנות) → every 6 months. Gated to private types
  // so CME (forklifts), trailers, aviation and off-road toys — which have
  // their own cycles or rely on gov.il — are never mislabelled "רכב מיושן".
  if (PRIVATE_TEST_TYPES.has(type) && age !== null && age >= AGING_AGE_YEARS) {
    return {
      category: 'aging',
      frequencyMonths: 6,
      requiredDocs: ['אישור רכב מיושן (בלמים והיגוי) ממוסך מורשה'],
      label: 'רכב מיושן',
    };
  }

  // New private vehicle: exempt for the first 3 years from registration.
  if (PRIVATE_TEST_TYPES.has(type) && age !== null && age < 3) {
    return { category: 'new', frequencyMonths: null, requiredDocs: [], label: '' };
  }

  // Regular private vehicle: annual.
  if (PRIVATE_TEST_TYPES.has(type)) {
    return { category: 'regular', frequencyMonths: 12, requiredDocs: [], label: '' };
  }

  // Trucks, buses, CME, trailers, aviation: trust gov.il (Phase 2 covers
  // their explicit frequency/winter-inspection rules).
  return { category: 'other', frequencyMonths: null, requiredDocs: [], label: '' };
}

/**
 * Fallback next-test date used ONLY when gov.il provides none — e.g. a
 * brand-new vehicle added manually whose ministry record has no next-test
 * date yet. Israeli law exempts new private cars/motorcycles for 3 years
 * from first registration, so the first test lands at +3 years.
 * Returns '' when no sensible date can be derived (caller leaves it blank).
 */
export function computeFallbackTestDate(fields) {
  const f = fields || {};
  if (f.test_due_date) return f.test_due_date;
  if (!f.first_registration_date) return '';
  if (!PRIVATE_TEST_TYPES.has(f.vehicle_type)) return '';
  try {
    const d = new Date(f.first_registration_date);
    if (isNaN(d.getTime())) return '';
    d.setFullYear(d.getFullYear() + 3);
    return d.toISOString().split('T')[0];
  } catch { return ''; }
}

// Heavy / industrial equipment subtypes (forklifts, excavators, telehandlers,
// graders, etc.) — they all hour-meter and the user thinks of them as
// "כלי הנדסי" / "כלי צמ"ה" not "רכב". Reuses the OFFROAD_HOURS_TYPES set so
// adding a new CME subtype in one place propagates everywhere.
const CME_TYPES = new Set([
  'מחפר', 'מחפר זחלי', 'מחפר אופני', 'מיני מחפר', 'מחפרון',
  'דחפור', 'דחפור זחלי',
  'שופל', 'מעמיס אופני', 'מעמיס זחלי', 'מיני מעמיס',
  'בובקט',
  'טליהנדלר', 'מלגזה', 'מלגזת שטח',
  'מפלסת',
  'מכבש', 'מכבש אספלט', 'מכבש קרקע',
  'מערבל בטון', 'משאבת בטון',
  'מנוף', 'מנוף נייד', 'מנוף זחלי',
  'מקדח קרקע', 'ציוד קידוח',
  'רכב צמ"ה',
  'טרקטור', 'מחרשה',
]);

export function isCme(vehicleType) {
  return CME_TYPES.has(vehicleType);
}

/**
 * Returns context-aware labels based on vehicle type.
 * Branches: vessel / offroad / cme (forklift family) / default.
 */
export function getVehicleLabels(vehicleType, nickname) {
  if (isVessel(vehicleType, nickname)) {
    return {
      vehicleWord:    'כלי שייט',      // replaces "רכב"
      testWord:       'כושר שייט',     // replaces "טסט"
      testDateLabel:  'תאריך כושר שייט',
      testNextLabel:  'כושר שייט הבא',
      testExpiredMsg: 'כושר השייט פג תוקף',
      insuranceWord:  'ביטוח ימי',     // replaces "ביטוח"
      vehicleFallback:'כלי שייט',      // fallback name when no nickname
    };
  }
  if (isCme(vehicleType)) {
    // Subtype itself reads natural ("מלגזה", "טרקטור") so use it directly.
    return {
      vehicleWord:    vehicleType,
      testWord:       'טסט',
      testDateLabel:  'תאריך טסט',
      testNextLabel:  'תאריך טסט הבא',
      testExpiredMsg: 'הטסט עבר את תאריך התוקף',
      insuranceWord:  'ביטוח',
      vehicleFallback: vehicleType,
    };
  }
  if (isOffroad(vehicleType)) {
    // Offroad: use the specific subtype if it isn't the generic
    // "כלי שטח" — "טרקטורון" reads better than "כלי שטח".
    const word = (vehicleType && vehicleType !== 'כלי שטח') ? vehicleType : 'כלי שטח';
    return {
      vehicleWord:    word,
      testWord:       'טסט',
      testDateLabel:  'תאריך טסט',
      testNextLabel:  'תאריך טסט הבא',
      testExpiredMsg: 'הטסט עבר את תאריך התוקף',
      insuranceWord:  'ביטוח',
      vehicleFallback:word,
    };
  }
  return {
    vehicleWord:    'רכב',
    testWord:       'טסט',
    testDateLabel:  'תאריך טסט',
    testNextLabel:  'תאריך טסט הבא',
    testExpiredMsg: 'הטסט עבר את תאריך התוקף',
    insuranceWord:  'ביטוח',
    vehicleFallback:'רכב',
  };
}
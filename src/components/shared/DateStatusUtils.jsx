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

/** Off-road vehicle types */
const OFFROAD_TYPES = new Set([
  'כלי שטח', "ג'יפ שטח", 'טרקטורון', 'אופנוע שטח', 'RZR', 'מיול', 'באגי חולות',
]);
const OFFROAD_HOURS_TYPES = new Set(['RZR', 'מיול']);

/** Returns true if this vehicle type is an off-road vehicle. */
export function isOffroad(vehicleType) {
  return OFFROAD_TYPES.has(vehicleType);
}

/** Vessel type names - used to identify boats/yachts/watercraft. */
const VESSEL_TYPES = new Set([
  'כלי שייט', 'מפרשית', 'סירה מנועית', 'אופנוע ים', 'סירת גומי',
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
const OFFROAD_TOGGLE_TYPES = new Set(["ג'יפ שטח", 'טרקטורון', 'באגי חולות', 'אופנוע שטח']);

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

/**
 * Returns context-aware labels based on vehicle type.
 * For vessels: uses "כלי שייט" / "כושר שייט" instead of "רכב" / "טסט".
 */
export function getVehicleLabels(vehicleType, nickname) {
  if (isOffroad(vehicleType)) {
    return {
      vehicleWord:    'כלי שטח',
      testWord:       'טסט',
      testDateLabel:  'תאריך טסט',
      testNextLabel:  'תאריך טסט הבא',
      testExpiredMsg: 'הטסט עבר את תאריך התוקף',
      insuranceWord:  'ביטוח',
      vehicleFallback:'כלי שטח',
    };
  }
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
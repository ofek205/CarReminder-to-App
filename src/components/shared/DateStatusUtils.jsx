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
    case 'טרקטורון': case 'טרקטורון שטח': return '🏎️';
    case "ג'יפ שטח": case 'כלי שטח': return '🏔️';
    case 'RZR': return '🏁';
    case 'מיול': return '🚜';
    case 'באגי חולות': return '🏜️';
    default: return '🚗';
  }
}

export function normalizePlate(plate) {
  return plate.replace(/[^0-9]/g, '');
}

/** Off-road vehicle types */
const OFFROAD_TYPES = new Set([
  'כלי שטח', "ג'יפ שטח", 'טרקטורון שטח', 'RZR', 'מיול', 'באגי חולות',
]);
const OFFROAD_HOURS_TYPES = new Set(['RZR', 'מיול']);

/** Returns true if this vehicle type is an off-road vehicle. */
export function isOffroad(vehicleType) {
  return OFFROAD_TYPES.has(vehicleType);
}

/** Vessel type names — used to identify boats/yachts/watercraft. */
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

export function usesKm(vehicleType, nickname) {
  if (isVessel(vehicleType, nickname)) return false;
  if (OFFROAD_HOURS_TYPES.has(vehicleType)) return false;
  return vehicleType === 'רכב' || vehicleType === 'אופנוע כביש'
    || vehicleType === "ג'יפ שטח" || vehicleType === 'טרקטורון שטח'
    || vehicleType === 'באגי חולות';
}

export function usesHours(vehicleType, nickname) {
  if (isVessel(vehicleType, nickname)) return true;
  if (OFFROAD_HOURS_TYPES.has(vehicleType)) return true;
  return vehicleType === 'אופנוע שטח' || vehicleType === 'טרקטורון';
}

/** Returns true if the vehicle is considered vintage (age >= 20 years). */
export function isVintageVehicle(year) {
  if (!year) return false;
  return new Date().getFullYear() - Number(year) >= 20;
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
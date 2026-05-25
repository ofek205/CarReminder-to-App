/**
 * Shared design tokens for the entire app.
 * Import: import { C, getTheme } from '@/lib/designTokens';
 *
 * For vehicle-specific theming:
 *   const T = getTheme(vehicle.vehicle_type);
 *   style={{ background: T.primary }}
 */

// ── Shared tokens: status + neutrals (theme-independent) ──
// Spread into every theme so `T.gray200` / `T.warnDark` etc. work
// regardless of the vehicle's theme.
const _shared = {
  // Neutrals (Tailwind gray scale for UI chrome)
  gray50:   '#F9FAFB',      // subtle bg
  grayBg:   '#FAFAFA',      // read-state / muted card bg
  gray100:  '#F3F4F6',      // light bg, hover
  gray200:  '#E5E7EB',      // border, divider
  gray300:  '#D1D5DB',      // disabled border
  gray400:  '#9CA3AF',      // placeholder, disabled text
  gray500:  '#6B7280',      // secondary text
  gray700:  '#374151',      // strong secondary text
  gray800:  '#1F2937',      // near-black text

  // Error (red)
  error:      '#DC2626',
  errorDark:  '#991B1B',     // text on error bg
  errorBg:    '#FEF2F2',     // red-50, subtle bg
  errorLight: '#FEE2E2',     // red-100, badge/stripe bg
  errorBorder:'#FECACA',     // red-200, border

  // Warning (amber)
  warn:       '#D97706',
  warnDark:   '#92400E',     // text on warning bg
  warnMid:    '#B45309',     // amber-700, sub-labels on warn bg
  warnIcon:   '#F59E0B',     // amber-500, icon/accent
  warnBg:     '#FEF3C7',     // amber-100, badge bg
  warnBorder: '#FDE68A',     // amber-200, border
  warnSubtle: '#FFFBEB',     // amber-50, full-screen bg

  // Success (emerald)
  successBright: '#10B981',  // emerald-500, live badges
  successDark:   '#065F46',  // emerald-800, text on success bg
  successMid:    '#34D399',  // emerald-400, highlight
  successLight:  '#D1FAE5',  // emerald-100, badge bg
  successLighter:'#A7F3D0',  // emerald-200, softer
  successSubtle: '#ECFDF5',  // emerald-50, full-screen bg

  // Info (blue)
  info:       '#3B82F6',     // blue-500
  infoDark:   '#1E40AF',     // blue-800, text on info bg
  infoBg:     '#DBEAFE',     // blue-100, badge bg
  infoSubtle: '#EFF6FF',     // blue-50, full-screen bg

  // Accent: Orange
  orange:     '#EA580C',     // orange-600
  orangeBg:   '#FFF7ED',     // orange-50
};

//  Default theme (green. cars, motorcycles, trucks)
export const C = {
  ..._shared,

  // ── Core brand ────────────────────────────────────────
  bg:        '#FFFFFF',
  primary:   '#2D5233',
  accent:    '#3A6B42',
  light:     '#E8F2EA',
  grad:      'linear-gradient(135deg, #2D5233 0%, #3A6B42 100%)',
  yellow:    '#FFBF00',
  yellowSoft:'#FFF8E1',
  card:      '#FFFFFF',
  muted:     '#7A8A7C',
  border:    '#D8E5D9',
  text:      '#1C2E20',

  // ── Brand green depths ────────────────────────────────
  primaryDark:  '#0B2912',   // hero bg, drawer header
  textAlt:      '#4B5D52',   // secondary green text (olive)
  mutedAlt:     '#6B7C72',   // softer green-gray muted
  borderAlt:    '#A7B3AB',   // lighter sage border
  bgSubtle:     '#F0F7F4',   // very light sage background
  bgSage:       '#E5EDE8',   // sage divider / section bg

  // ── Success (green-branded override) ──────────────────
  success:   '#3A7D44',
  successBg: '#E8F5E9',

  // Legacy aliases (used by Dashboard inline C)
  green:     '#3A6B42',
  greenDark: '#2D5233',
  greenLight:'#E8F2EA',
  greenGrad: 'linear-gradient(135deg, #2D5233 0%, #3A6B42 100%)',
};

//  Marine theme (teal. vessels / כלי שייט)
const marine = {
  ..._shared,
  bg:        '#FFFFFF',
  primary:   '#0C7B93',
  accent:    '#0E9AB2',
  light:     '#E0F7FA',
  grad:      'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)',
  yellow:    '#00BCD4',       // CTA in marine = cyan
  yellowSoft:'#E0F7FA',
  card:      '#FFFFFF',
  muted:     '#6B9EA8',
  border:    '#B2EBF2',
  text:      '#0A3D4D',
  // Marine-branded success overrides
  success:   '#0C7B93',
  successBg: '#E0F7FA',
  // Legacy aliases
  green:     '#0C7B93',
  greenDark: '#065A6E',
  greenLight:'#E0F7FA',
  greenGrad: 'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)',
};

//  Vessel detection 
const VESSEL_EXACT = new Set([
  'כלי שייט', 'מפרשית', 'סירה מנועית', 'אופנוע ים', 'סירת גומי', 'יאכטה מנועית',
]);
const VESSEL_KEYWORDS = ['שייט', 'סירה', 'יאכטה', 'מפרשית', 'ספינה', 'אופנוע ים', 'גומי', 'סירת'];

const VESSEL_MANUFACTURERS = ['sea-doo', 'yamaha marine', 'beneteau', 'jeanneau', 'zodiac', 'highfield', 'brig'];

function checkVessel(vehicleType, nickname) {
  if (!vehicleType && !nickname) return false;
  const combined = `${vehicleType || ''} ${nickname || ''}`;
  if (VESSEL_EXACT.has(vehicleType)) return true;
  return VESSEL_KEYWORDS.some(kw => combined.includes(kw));
}

// Extended check including manufacturer
function checkVesselFull(vehicleType, nickname, manufacturer) {
  if (checkVessel(vehicleType, nickname)) return true;
  if (manufacturer && VESSEL_MANUFACTURERS.some(m => manufacturer.toLowerCase().includes(m))) return true;
  return false;
}

/**
 * Get theme tokens based on vehicle type.
 */
export function getTheme(vehicleType, nickname, manufacturer) {
  if (checkVesselFull(vehicleType, nickname, manufacturer)) return marine;
  // Off-road gets the brown/earthy theme
  // (check has to come BEFORE motorcycle/truck keyword matching)
  if (vehicleType && OFFROAD_EXACT.has(vehicleType)) return offroad;
  return C;
}

/**
 * Check if a vehicle type is a vessel (for icon selection etc.)
 */
export function isVesselType(vehicleType, nickname) {
  return checkVessel(vehicleType, nickname);
}

/**
 * Get the lucide icon name string based on vehicle type.
 * Usage: import { getVehicleIconName } from '@/lib/designTokens';
 *        const iconName = getVehicleIconName(vehicle.vehicle_type, vehicle.nickname);
 * Then use a map to render the actual icon component.
 */
const MOTO_KEYWORDS = ['קטנוע', 'moto', 'bike', 'scooter'];
// 2026-05-17: 'אנדורו' joins the moto set (street-legal, plate-carrying
// dual-sport). 'מוטוקרוס' stays out of MOTO_EXACT — it's off-road only,
// no plate, no road registration — and lives in OFFROAD_EXACT alone.
// Both share the same maintenance catalog via aliases in
// MaintenanceCatalog.jsx.
const MOTO_EXACT = new Set(['אופנוע כביש', 'אופנוע שטח', 'קטנוע', 'אנדורו']);
const MOTO_MANUFACTURERS = ['sym', 'kymco', 'vespa', 'piaggio', 'yamaha moto', 'honda moto', 'ktm', 'bmw motorrad', 'harley', 'ducati', 'kawasaki', 'suzuki moto', 'aprilia', 'triumph', 'royal enfield'];
const TRUCK_KEYWORDS = ['משאית', 'truck'];
const TRUCK_MANUFACTURERS = ['man', 'scania', 'volvo trucks', 'daf', 'iveco', 'mercedes trucks'];
const OFFROAD_EXACT = new Set(["כלי שטח", "ג'יפ שטח", 'טרקטורון', 'אופנוע שטח', 'אנדורו', 'מוטוקרוס', 'RZR', 'מיול', 'באגי חולות']);
// כלי צמ"ה (Construction Machinery). Mirrors CME_SUBCATEGORIES dbName
// list in VehicleTypeSelector.jsx + the legacy 'רכב צמ"ה' that pre-CME
// rows might still carry. Anything in this set categorises as 'cme'.
const CME_EXACT = new Set([
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
  'רכב צמ"ה',  // legacy umbrella label
]);
// Special / catch-all bucket: items that don't fit any precise category.
const SPECIAL_EXACT = new Set([
  'רכב מיוחד', 'רכב אספנות', 'טרקטור', 'נגרר', 'קרוואן',
  'אוטובוס', 'מחרשה', 'רכב תפעולי',
]);

export function isOffroadType(vehicleType) {
  return OFFROAD_EXACT.has(vehicleType);
}

//  Off-road / earthy theme (rich chocolate brown)
export const offroad = {
  ..._shared,
  bg:        '#FFFFFF',
  primary:   '#5D4037',     // rich chocolate brown (Material Brown 700)
  accent:    '#795548',     // medium brown
  light:     '#EFEBE9',     // very light beige
  grad:      'linear-gradient(135deg, #4E342E 0%, #6D4C41 100%)',
  yellow:    '#FBBF24',
  yellowSoft:'#EFEBE9',
  card:      '#FFFFFF',
  muted:     '#8D6E63',
  border:    '#D7CCC8',
  text:      '#3E2723',
};

/**
 * Get visual identity (icon key + theme) for a vehicle.
 * Returns { iconKey: string, theme: object }
 * iconKey can be: 'ship', 'bike-road', 'truck', 'car',
 *                 'atv', 'jeep-off', 'dirt-bike', 'buggy', 'dune-buggy', 'mountain'
 */
export function getVehicleVisual(vehicle) {
  if (!vehicle) return { iconKey: 'car', theme: C };
  const vt = vehicle.vehicle_type;
  const nick = vehicle.nickname;
  const mfr = vehicle.manufacturer;

  // Vessel
  if (checkVesselFull(vt, nick, mfr)) return { iconKey: 'ship', theme: marine };

  // Off-road specifics.
  // 2026-05-17: אנדורו ומוטוקרוס שניהם אופנועי שטח לכל דבר ועניין
  // מבחינת אייקון ועיצוב. ההבדל ביניהם נוגע רק לטופס הרכב (רישוי,
  // טסט, ביטוח), לא לתצוגה ויזואלית.
  if (vt === 'אופנוע שטח' || vt === 'אנדורו' || vt === 'מוטוקרוס') {
    return { iconKey: 'dirt-bike', theme: offroad };
  }
  if (vt === 'טרקטורון') return { iconKey: 'atv', theme: offroad };
  if (vt === "ג'יפ שטח") return { iconKey: 'jeep-off', theme: offroad };
  if (vt === 'RZR' || vt === 'מיול') return { iconKey: 'buggy', theme: offroad };
  if (vt === 'באגי חולות') return { iconKey: 'dune-buggy', theme: offroad };
  if (OFFROAD_EXACT.has(vt)) return { iconKey: 'mountain', theme: offroad };

  // Other categories by keyword
  const cat = getVehicleCategory(vt, nick, mfr);
  if (cat === 'motorcycle') return { iconKey: 'bike-road', theme: C };
  if (cat === 'truck') return { iconKey: 'truck', theme: C };
  return { iconKey: 'car', theme: C };
}

export function getVehicleCategory(vehicleType, nickname, manufacturer) {
  const combined = `${vehicleType || ''} ${nickname || ''} ${manufacturer || ''}`.toLowerCase();
  // Vessel FIRST so "אופנוע ים" doesn't get caught by the motorcycle
  // keyword check below.
  if (checkVesselFull(vehicleType, nickname, manufacturer)) return 'vessel';
  // Off-road exact check before any keyword matching, so "טרקטורון"
  // isn't conflated with "טרקטור" and "RZR" doesn't fall through to car.
  if (OFFROAD_EXACT.has(vehicleType)) return 'offroad';
  // CME exact check before truck keywords (otherwise "מלגזה" would
  // hit truck's keyword list, even though it's actually CME now).
  if (CME_EXACT.has(vehicleType)) return 'cme';
  // Special / catch-all category — trailers, vintage, agricultural
  // tractors, buses. Tractors deliberately NOT in CME (they're more
  // agriculture than construction in our taxonomy).
  if (SPECIAL_EXACT.has(vehicleType)) return 'special';
  // Motorcycle — exact list first, then keywords/manufacturers as a
  // softer fallback (e.g. user-typed manufacturer matches Honda, KTM…)
  if (MOTO_EXACT.has(vehicleType)) return 'motorcycle';
  if (MOTO_KEYWORDS.some(kw => combined.includes(kw))) return 'motorcycle';
  if (MOTO_MANUFACTURERS.some(m => combined.includes(m))) return 'motorcycle';
  if (TRUCK_KEYWORDS.some(kw => combined.includes(kw))) return 'truck';
  if (TRUCK_MANUFACTURERS.some(m => combined.includes(m))) return 'truck';
  return 'car';
}

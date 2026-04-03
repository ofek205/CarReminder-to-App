/**
 * Shared design tokens for the entire app.
 * Import: import { C, getTheme } from '@/lib/designTokens';
 *
 * For vehicle-specific theming:
 *   const T = getTheme(vehicle.vehicle_type);
 *   style={{ background: T.primary }}
 */

// ── Default theme (green — cars, motorcycles, trucks) ──────────────────────
export const C = {
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
  error:     '#DC2626',
  errorBg:   '#FEF2F2',
  warn:      '#D97706',
  warnBg:    '#FEF3C7',
  success:   '#3A7D44',
  successBg: '#E8F5E9',
  // Legacy aliases (used by Dashboard inline C)
  green:     '#3A6B42',
  greenDark: '#2D5233',
  greenLight:'#E8F2EA',
  greenGrad: 'linear-gradient(135deg, #2D5233 0%, #3A6B42 100%)',
};

// ── Marine theme (teal — vessels / כלי שייט) ────────────────────────────────
const marine = {
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
  error:     '#DC2626',
  errorBg:   '#FEF2F2',
  warn:      '#D97706',
  warnBg:    '#FEF3C7',
  success:   '#0C7B93',
  successBg: '#E0F7FA',
  // Legacy aliases
  green:     '#0C7B93',
  greenDark: '#065A6E',
  greenLight:'#E0F7FA',
  greenGrad: 'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)',
};

// ── Vessel detection ───────────────────────────────────────────────────────
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
const MOTO_KEYWORDS = ['אופנוע', 'קטנוע', 'moto', 'bike', 'scooter', 'אופנוע כביש', 'אופנוע שטח'];
const MOTO_MANUFACTURERS = ['sym', 'kymco', 'vespa', 'piaggio', 'yamaha moto', 'honda moto', 'ktm', 'bmw motorrad', 'harley', 'ducati', 'kawasaki', 'suzuki moto', 'aprilia', 'triumph', 'royal enfield'];
const TRUCK_KEYWORDS = ['משאית', 'truck', 'מלגזה', 'טרקטור'];
const TRUCK_MANUFACTURERS = ['man', 'scania', 'volvo trucks', 'daf', 'iveco', 'mercedes trucks'];

export function getVehicleCategory(vehicleType, nickname, manufacturer) {
  const combined = `${vehicleType || ''} ${nickname || ''} ${manufacturer || ''}`.toLowerCase();
  if (checkVesselFull(vehicleType, nickname, manufacturer)) return 'vessel';
  if (MOTO_KEYWORDS.some(kw => combined.includes(kw))) return 'motorcycle';
  if (MOTO_MANUFACTURERS.some(m => combined.includes(m))) return 'motorcycle';
  if (TRUCK_KEYWORDS.some(kw => combined.includes(kw))) return 'truck';
  if (TRUCK_MANUFACTURERS.some(m => combined.includes(m))) return 'truck';
  return 'car';
}

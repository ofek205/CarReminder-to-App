// ═══════════════════════════════════════════════════════════════════════════
// Which vehicle types are צמ"ה, for Edge Functions (they can't import src/).
//
// The app's one list is CME_EXACT in src/lib/designTokens.js; DateStatusUtils
// builds CME_TYPES from it by adding tractors. This set is that CME_TYPES,
// copied. src/lib/cmeTypes.test.js reads this file and fails if the two ever
// differ, so edit both together.
//
// gov-sync-vehicles keeps its own inline copy (CME_VEHICLE_TYPES) because it
// predates this file; the same test guards it.
// ═══════════════════════════════════════════════════════════════════════════

export const CME_VEHICLE_TYPES = new Set([
  'מחפר', 'מחפר זחלי', 'מחפר אופני', 'מיני מחפר', 'מחפרון',
  'דחפור', 'דחפור זחלי',
  'שופל', 'מעמיס אופני', 'מעמיס זחלי', 'מיני מעמיס',
  'בובקט',
  'טליהנדלר', 'מלגזה', 'מלגזת שטח',
  'מפלסת',
  'מכבש', 'מכבש אספלט', 'מכבש קרקע', 'מכבש גלילי ממונע', 'מכבש גליל ידני',
  'מערבל בטון', 'משאבת בטון',
  'מנוף', 'מנוף נייד', 'מנוף זחלי',
  'מקדח קרקע', 'ציוד קידוח',
  'רכב צמ"ה', 'כלי צמ"ה',
  'טרקטור', 'מחרשה',
]);

// Gershayim (U+05F4) and a plain quote both appear in labels like צמ"ה.
export function isCmeVehicleType(vehicleType: string | null | undefined): boolean {
  const type = String(vehicleType ?? '').trim().replace(/״/g, '"');
  return CME_VEHICLE_TYPES.has(type);
}

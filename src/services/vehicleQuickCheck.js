import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import { lookupVehicleByPlate, isAircraftPlate } from '@/services/vehicleLookup';
import { generateVehicleInsights } from '@/lib/vehicleInsights';
import { getTestPolicy } from '@/components/shared/DateStatusUtils';

export const QUICK_CHECK_USED_KEY = 'vehicle_quick_check_used';
export const QUICK_CHECK_LAST_RESULT_KEY = 'vehicle_quick_check_last_result';
export const QUICK_CHECK_RETURN_KEY = 'vehicle_quick_check_return';

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const DB_COLUMNS = [
  'account_id', 'vehicle_type', 'manufacturer', 'model', 'year',
  'nickname', 'license_plate', 'test_due_date', 'insurance_due_date', 'insurance_company',
  'current_km', 'current_engine_hours', 'vehicle_photo', 'fuel_type', 'is_vintage',
  'last_tire_change_date', 'km_since_tire_change', 'tires_changed_count',
  'flag_country', 'marina', 'marina_abroad', 'engine_manufacturer', 'pyrotechnics_expiry_date', 'fire_extinguisher_expiry_date', 'fire_extinguishers',
  'life_raft_expiry_date', 'last_shipyard_date', 'hours_since_shipyard',
  'front_tire', 'rear_tire', 'engine_model', 'color', 'last_test_date', 'first_registration_date', 'ownership',
  'model_code', 'trim_level', 'vin', 'pollution_group', 'vehicle_class', 'safety_rating',
  'horsepower', 'engine_cc', 'drivetrain', 'total_weight', 'doors', 'seats', 'airbags',
  'transmission', 'body_type', 'country_of_origin', 'co2', 'green_index', 'tow_capacity',
  'engine_number', 'empty_weight', 'payload_capacity', 'has_tow_hitch',
  'eu_class', 'ac', 'abs', 'fuel_type_spec',
  'offroad_equipment', 'offroad_usage_type', 'last_offroad_service_date',
  'inspection_report_expiry_date',
  'ownership_hand', 'ownership_history',
  'is_personal_import', 'personal_import_type',
  'is_road_removed', 'road_removed_date',
];

const NUMBER_FIELDS = new Set([
  'year', 'current_km', 'current_engine_hours', 'km_since_tire_change',
  'tires_changed_count', 'hours_since_shipyard', 'horsepower', 'engine_cc',
  'total_weight', 'doors', 'seats', 'airbags', 'co2', 'green_index',
  'tow_capacity', 'ownership_hand',
]);

// Aviation routing for quick-check shares the same source of truth as
// the lookup tier (vehicleLookup.isAircraftPlate / AIRCRAFT_PLATE_REGEX
// imported above) — no local regex copy to keep in sync.
export function isAviationQuickCheckPlate(value) {
  return isAircraftPlate(value);
}

export function normalizeQuickCheckPlate(value) {
  const raw = String(value || '');
  // Aviation values (letters present) are preserved as alphanumeric+dash
  // so the lookup tier can route to the right registry column. Ground
  // values (digits only) follow the original digit-strip behaviour so
  // the existing 4-8 digit ground-vehicle cascade still works.
  if (/[A-Za-z]/.test(raw)) {
    return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  }
  return raw.replace(/\D/g, '');
}

export function validateQuickCheckPlate(value) {
  const clean = normalizeQuickCheckPlate(value);
  if (!clean) return { ok: false, plate: clean, message: 'יש להזין מספר רישוי' };
  // Aviation branch — aircraft registration mark or serial number.
  if (/[A-Z]/.test(clean)) {
    if (clean.length < 2 || clean.length > 20) {
      return { ok: false, plate: clean, message: 'מזהה כלי טיס בין 2 ל-20 תווים (אותיות/ספרות/מקפים)' };
    }
    return { ok: true, plate: clean, message: '' };
  }
  if (clean.length < 4 || clean.length > 8) {
    return { ok: false, plate: clean, message: 'מספר רישוי צריך להכיל 4 עד 8 ספרות' };
  }
  return { ok: true, plate: clean, message: '' };
}

function compact(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function normalizeLookupResult(raw, plate) {
  const source = raw || {};
  const displayName = [source.manufacturer, source.model, source.year].filter(Boolean).join(' ');
  // Test category via getTestPolicy, the single source of truth. isVintage
  // now means strictly "registered collector" (רכב אספנות) — NOT merely old:
  // a 30+ car that isn't a registered collector is "רכב מיושן" (tested every
  // 6 months), so it must not be flagged as אספנות on the check screen.
  const testPolicy = getTestPolicy({
    vehicle_type: source.vehicle_type || source._detectedTypeLabel,
    year: source.year,
    nickname: source.nickname,
  });
  const isVintage = testPolicy.category === 'collector';
  const testCategoryLabel = testPolicy.label; // '' | 'רכב מיושן' | 'רכב אספנות'
  const normalized = {
    plate,
    fetchedAt: new Date().toISOString(),
    source,
    basicInfo: compact({
      licensePlate: source.license_plate || plate,
      manufacturer: source.manufacturer,
      model: source.model,
      year: source.year,
      vehicleType: source.vehicle_type || source._detectedTypeLabel,
      detectedType: source._detectedType,
      detectedTypeLabel: source._detectedTypeLabel,
      // A finalized cancellation (bitul_dt → _cancellationDate) means the
      // vehicle was REMOVED FROM THE ROAD per the Ministry of Transport —
      // call it out explicitly so a second-hand buyer can't miss the red
      // flag. _isInactive without a cancellation date is a lapsed test
      // (not formally cancelled), so it stays the softer "לא פעיל".
      status: source._cancellationDate
        ? 'מורד מהכביש'
        : (source._isInactive ? 'לא פעיל' : 'פעיל'),
      isVintage,
      testCategoryLabel,
      displayName: displayName || source.license_plate || plate,
    }),
    registration: compact({
      firstRegistrationDate: source.first_registration_date,
      lastTestDate: source.last_test_date,
      // Only surface a test-validity date that the Ministry of Transport
      // actually publishes. For vehicles whose test date we merely ESTIMATED
      // (e.g. motorcycles — see mapMotoRecord), we suppress the guess so the
      // report never presents it as a real test date that could hide a
      // skipped test. The real "עלייה לכביש" date is shown instead.
      testDueDate: source._test_due_estimated
        ? (source.inspection_report_expiry_date || undefined)
        : (source.test_due_date || source.inspection_report_expiry_date),
      testDueEstimated: !!source._test_due_estimated,
      inspectionReportExpiryDate: source.inspection_report_expiry_date,
      cancellationDate: source._cancellationDate,
      currentKm: source.current_km,
      isInactive: !!source._isInactive,
      isVintage,
    }),
    technical: compact({
      engineCc: source.engine_cc,
      fuelType: source.fuel_type || source.fuel_type_spec,
      fuelTypeSpec: source.fuel_type_spec,
      transmission: source.transmission,
      horsepower: source.horsepower,
      drivetrain: source.drivetrain,
      vehicleClass: source.vehicle_class,
      bodyType: source.body_type,
      engineModel: source.engine_model,
      engineNumber: source.engine_number,
      modelCode: source.model_code,
      trimLevel: source.trim_level,
      vin: source.vin,
      color: source.color,
      safetyRating: source.safety_rating,
      pollutionGroup: source.pollution_group,
      frontTire: source.front_tire,
      rearTire: source.rear_tire,
      seats: source.seats,
      doors: source.doors,
      airbags: source.airbags,
      totalWeight: source.total_weight,
      emptyWeight: source.empty_weight,
      payloadCapacity: source.payload_capacity,
      countryOfOrigin: source.country_of_origin,
      co2: source.co2,
      greenIndex: source.green_index,
      towCapacity: source.tow_capacity,
      hasTowHitch: source.has_tow_hitch,
      euClass: source.eu_class,
      ac: source.ac,
      abs: source.abs,
    }),
    ownership: compact({
      current: source.ownership,
      hand: source.ownership_hand,
      history: source.ownership_history,
      isPersonalImport: !!source.is_personal_import,
      personalImportType: source.personal_import_type,
    }),
    additional: compact({
      detectedTypeLabel: source._detectedTypeLabel,
      detectedType: source._detectedType,
      isVintage,
      marina: source.marina,
      flagCountry: source.flag_country,
      offroadUsageType: source.offroad_usage_type,
      activeSameModelCount: source.active_same_model_count,
      activeSameModelColorCount: source.active_same_model_color_count,
      activeSameModelColorName: source.active_same_model_color_name,
      // Ownership-mix breakdown for the same model — array of
      // { label, count, percent } objects, top 4 baalut types,
      // ordered descending by count. May be missing when the total
      // model fleet is too small to produce reliable percentages.
      ownershipDistribution: source.ownership_distribution,
      // Open recalls — surfaced via insights AND via a dedicated
      // <RecallsCard /> on the report page, so we keep both the count
      // and the full array here (the array drives the description text
      // a buyer needs to actually act on).
      openRecallsCount: source.open_recalls_count,
      openRecalls: source.open_recalls,
    }),
    insights: generateVehicleInsights(source),
  };

  return normalized;
}

export async function lookupVehicleQuickCheck(plate) {
  const validation = validateQuickCheckPlate(plate);
  if (!validation.ok) {
    const err = new Error(validation.message);
    err.code = 'invalid_plate';
    throw err;
  }

  const cached = cache.get(validation.plate);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.result;
  }

  const raw = await lookupVehicleByPlate(validation.plate);
  if (!raw) return null;

  // Dual-registry collision. The plate digits exist in two MoT
  // datasets (e.g. mispar_tzama=229080 SCHMIDT sweeper + mispar_rechev=
  // 229080 1965 Triumph Herald). lookupVehicleByPlate returned both
  // candidates; bubble them up so the calling page (VehicleCheck or
  // Dashboard hero) can render the picker dialog. Each candidate is
  // pre-normalized so the caller can use either one directly after
  // the user picks.
  if (raw._multipleMatches) {
    const normalizedMatches = raw.matches.map((m) => ({
      source: m.source,
      fields: m.fields,
      normalized: normalizeLookupResult(m.fields, validation.plate),
    }));
    // Intentionally NOT cached — the cached value would be the choice-
    // pending state, and re-entry should re-show the dialog (or, more
    // likely, the user already navigated past it).
    return {
      _multipleMatches: true,
      plate: validation.plate,
      matches: normalizedMatches,
    };
  }

  const result = normalizeLookupResult(raw, validation.plate);
  cache.set(validation.plate, { result, cachedAt: Date.now() });
  return result;
}

export function saveLastQuickCheckResult(result) {
  try {
    sessionStorage.setItem(QUICK_CHECK_LAST_RESULT_KEY, JSON.stringify(result));
  } catch {}
}

export function readLastQuickCheckResult() {
  try {
    const raw = sessionStorage.getItem(QUICK_CHECK_LAST_RESULT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function markQuickCheckUsed() {
  try {
    sessionStorage.setItem(QUICK_CHECK_USED_KEY, '1');
  } catch {}
}

export function hasUsedQuickCheck() {
  try {
    return sessionStorage.getItem(QUICK_CHECK_USED_KEY) === '1';
  } catch {
    return false;
  }
}

function buildVehicleInsertPayload(result, accountId) {
  const source = result?.source || {};
  const data = {
    ...source,
    account_id: accountId,
    license_plate: source.license_plate || result?.plate,
    vehicle_type: source.vehicle_type || source._detectedTypeLabel || 'רכב',
    nickname: source.nickname || [source.manufacturer, source.model].filter(Boolean).join(' ') || undefined,
    is_vintage: source.is_vintage || result?.basicInfo?.isVintage || false,
    // Removed-from-road: persisted only when the registry carries a final
    // cancellation date (ביטול סופי), mirroring AddVehicle's mapping.
    is_road_removed: !!source._cancellationDate,
    road_removed_date: source._cancellationDate || null,
  };

  const clean = {};
  for (const key of DB_COLUMNS) {
    const value = data[key];
    if (value === undefined || value === null || value === '') continue;
    if (NUMBER_FIELDS.has(key)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      clean[key] = numeric;
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export async function vehicleExistsInAccount(accountId, plate) {
  if (!accountId || !plate) return false;
  const normalized = normalizeQuickCheckPlate(plate);
  const vehicles = await db.vehicles.filter(
    { account_id: accountId },
    { select: 'id, license_plate, license_plate_normalized, nickname', limit: 500 }
  );
  return vehicles.find(v =>
    normalizeQuickCheckPlate(v.license_plate_normalized || v.license_plate || '') === normalized
  ) || null;
}

// Resolve the account to save into. If the caller already has an
// accountId, use it. Otherwise self-heal: a fresh signup can reach
// "add to my vehicles" BEFORE the account resolves client-side (the
// provisioning race that produced the "לא נמצא חשבון פעיל" spike — 5
// failed saves in 15 min). ensure_user_account is idempotent and
// race-safe (returns the single personal account thanks to the
// accounts_one_personal_per_owner_uq unique index), so calling it here
// gets-or-creates the account on demand instead of failing the user.
async function resolveAccountId(accountId) {
  if (accountId) return accountId;
  const { data, error } = await withTimeout(
    supabase.rpc('ensure_user_account'),
    'ensure_user_account'
  );
  if (error) throw error;
  if (!data) {
    const err = new Error('no_account');
    err.code = 'no_account';
    throw err;
  }
  return data;
}

export async function saveQuickCheckVehicle(result, accountId) {
  if (!result) {
    const err = new Error('missing_context');
    err.code = 'missing_context';
    throw err;
  }
  // May provision on demand if accountId is null (fresh-signup race).
  const acctId = await resolveAccountId(accountId);
  const duplicate = await vehicleExistsInAccount(acctId, result.basicInfo?.licensePlate || result.plate);
  if (duplicate) {
    const err = new Error('duplicate_vehicle');
    err.code = 'duplicate_vehicle';
    err.vehicle = duplicate;
    throw err;
  }
  return db.vehicles.create(buildVehicleInsertPayload(result, acctId));
}

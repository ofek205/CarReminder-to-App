import { db } from '@/lib/supabaseEntities';
import { lookupVehicleByPlate } from '@/services/vehicleLookup';
import { generateVehicleInsights } from '@/lib/vehicleInsights';

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
];

const NUMBER_FIELDS = new Set([
  'year', 'current_km', 'current_engine_hours', 'km_since_tire_change',
  'tires_changed_count', 'hours_since_shipyard', 'horsepower', 'engine_cc',
  'total_weight', 'doors', 'seats', 'airbags', 'co2', 'green_index',
  'tow_capacity', 'ownership_hand',
]);

export function normalizeQuickCheckPlate(value) {
  return String(value || '').replace(/\D/g, '');
}

export function validateQuickCheckPlate(value) {
  const clean = normalizeQuickCheckPlate(value);
  if (!clean) return { ok: false, plate: clean, message: 'יש להזין מספר רישוי' };
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
  const age = source.year ? new Date().getFullYear() - Number(source.year) : null;
  const isVintage = !!source.is_vintage || source.vehicle_type === 'רכב אספנות' || (Number.isFinite(age) && age >= 30);
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
      status: source._isInactive ? 'לא פעיל' : 'פעיל',
      isVintage,
      displayName: displayName || source.license_plate || plate,
    }),
    registration: compact({
      firstRegistrationDate: source.first_registration_date,
      lastTestDate: source.last_test_date,
      testDueDate: source.test_due_date || source.inspection_report_expiry_date,
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

export async function saveQuickCheckVehicle(result, accountId) {
  if (!result || !accountId) {
    const err = new Error('missing_context');
    err.code = 'missing_context';
    throw err;
  }
  const duplicate = await vehicleExistsInAccount(accountId, result.basicInfo?.licensePlate || result.plate);
  if (duplicate) {
    const err = new Error('duplicate_vehicle');
    err.code = 'duplicate_vehicle';
    err.vehicle = duplicate;
    throw err;
  }
  return db.vehicles.create(buildVehicleInsertPayload(result, accountId));
}

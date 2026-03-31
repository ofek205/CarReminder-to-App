const RESOURCE_ID = '053cea08-09bc-40ec-8f7a-156f0677aff3';
import { isNative } from '@/lib/capacitor';

// In dev browser, Vite proxies /gov-api → https://data.gov.il to avoid CORS.
// In production (browser or Capacitor native) call the API directly.
const API_BASE = (import.meta.env.DEV && !isNative)
  ? '/gov-api/api/3/action/datastore_search'
  : 'https://data.gov.il/api/3/action/datastore_search';

// ── Input validation ───────────────────────────────────────────────────────
/** Israeli plate: 7-8 digits, optionally separated by dashes */
const PLATE_REGEX = /^[\d\-]{7,11}$/;

/**
 * Validate and sanitize a raw plate string before sending to API.
 * Returns cleaned digits-only string, or throws if invalid.
 */
function validatePlateInput(plate) {
  if (typeof plate !== 'string') throw new Error('invalid_input');
  const stripped = plate.replace(/[\s]/g, '');
  if (!PLATE_REGEX.test(stripped)) throw new Error('invalid_plate_format');
  const digits = stripped.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 8) throw new Error('invalid_plate_length');
  return digits;
}

// ── Output sanitization ────────────────────────────────────────────────────
const safeStr = (v, max = 80) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim().slice(0, max) : '');
const safeYear = (v) => { const n = parseInt(v, 10); return n >= 1900 && n <= new Date().getFullYear() + 2 ? String(n) : ''; };
const safeDate = (v) => { const s = String(v).split('T')[0]; return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined; };

function formatPlate(raw) {
  const p = String(raw).replace(/\D/g, '');
  if (p.length === 7) return `${p.slice(0, 2)}-${p.slice(2, 5)}-${p.slice(5)}`;
  if (p.length === 8) return `${p.slice(0, 3)}-${p.slice(3, 5)}-${p.slice(5)}`;
  return p;
}

/**
 * Map a raw API record to sanitized form fields.
 * Only known fields are extracted — unknown fields are dropped.
 */
function mapRecord(r) {
  const fields = {};

  if (r.mispar_rechev) fields.license_plate = formatPlate(r.mispar_rechev);
  if (r.tozeret_nm)    fields.manufacturer  = safeStr(r.tozeret_nm, 60);
  if (r.kinuy_mishari) fields.model         = safeStr(r.kinuy_mishari, 60);
  if (r.shnat_yitzur)  fields.year          = safeYear(r.shnat_yitzur);
  if (r.sug_delek_nm)  fields.fuel_type     = safeStr(r.sug_delek_nm, 40);

  // tokef_dt = תאריך תוקף הרישיון (מועד הטסט הבא)
  if (r.tokef_dt) fields.test_due_date = safeDate(r.tokef_dt);

  return fields;
}

/**
 * Looks up a vehicle by its Israeli license plate number.
 * @param {string} plate - The license plate (with or without dashes)
 * @returns {Promise<object|null>} Mapped form fields, or null if not found
 */
export async function lookupVehicleByPlate(plate) {
  // Validate input before sending to external API
  const clean = validatePlateInput(plate);

  const url = `${API_BASE}?resource_id=${encodeURIComponent(RESOURCE_ID)}&q=${encodeURIComponent(clean)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('הבקשה לשרת הממשלתי ארכה יותר מדי. נסה שנית.');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  if (!json.success || !json.result?.records?.length) return null;

  // Prefer exact plate match, fallback to first record
  const exact = json.result.records.find(
    r => String(r.mispar_rechev).replace(/\D/g, '') === clean
  );
  // Sanitize output — only return whitelisted fields
  return mapRecord(exact ?? json.result.records[0]);
}

const RESOURCE_ID = '053cea08-09bc-40ec-8f7a-156f0677aff3';           // רכב 4 גלגלים
const MOTO_RESOURCE_ID = 'bf9df4e2-d90d-4c0a-a400-19e15af8e95f';   // אופנועים + דו גלגליים
const SPECS_RESOURCE_ID = '142afde2-6228-49f9-8a29-9b6c3a0cbe40';  // מאגר דגמי רכב — מפרט טכני
import { isNative } from '@/lib/capacitor';

// In dev browser, Vite proxies /gov-api → https://data.gov.il to avoid CORS.
// In production (browser or Capacitor native) call the API directly.
const API_BASE = (import.meta.env.DEV && !isNative)
  ? '/gov-api/api/3/action/datastore_search'
  : 'https://data.gov.il/api/3/action/datastore_search';

// ── Input validation ───────────────────────────────────────────────────────
/** Israeli plate: 7-8 digits, optionally separated by dashes */
const PLATE_REGEX = /^[\d\-]{7,11}$/;

function validatePlateInput(plate) {
  if (typeof plate !== 'string') throw new Error('invalid_input');
  const stripped = plate.replace(/[\s]/g, '');
  if (!PLATE_REGEX.test(stripped)) throw new Error('invalid_plate_format');
  const digits = stripped.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 8) throw new Error('invalid_plate_length');
  return digits;
}

// ── Output sanitization ────────────────────────────────────────────────────
const safeStr = (v, max = 80) => {
  if (typeof v !== 'string') return '';
  return v
    .replace(/<[^>]*>/g, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim()
    .slice(0, max);
};
const safeNum = (v) => { const n = Number(v); return !isNaN(n) && n > 0 ? String(n) : ''; };
const safeYear = (v) => { const n = parseInt(v, 10); return n >= 1900 && n <= new Date().getFullYear() + 2 ? String(n) : ''; };
const safeDate = (v) => { const s = String(v).split('T')[0]; return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined; };

function formatPlate(raw) {
  const p = String(raw).replace(/\D/g, '');
  if (p.length === 7) return `${p.slice(0, 2)}-${p.slice(2, 5)}-${p.slice(5)}`;
  if (p.length === 8) return `${p.slice(0, 3)}-${p.slice(3, 5)}-${p.slice(5)}`;
  return p;
}

/**
 * Map a raw registration record to sanitized form fields.
 */
function mapRecord(r) {
  const fields = {};

  if (r.mispar_rechev) fields.license_plate = formatPlate(r.mispar_rechev);
  if (r.tozeret_nm)    fields.manufacturer  = safeStr(r.tozeret_nm, 60);
  if (r.kinuy_mishari) fields.model         = safeStr(r.kinuy_mishari, 60);
  if (r.shnat_yitzur)  fields.year          = safeYear(r.shnat_yitzur);
  if (r.sug_delek_nm)  fields.fuel_type     = safeStr(r.sug_delek_nm, 40);

  // tokef_dt = תאריך תוקף רישיון הרכב = תאריך הטסט הבא
  if (r.tokef_dt) {
    const d = safeDate(r.tokef_dt);
    if (d) fields.test_due_date = d;
  }

  // Fallback: if no tokef_dt (new cars) — use first_registration + 4 years
  // (Israeli law: first test at 4 years old, then annually)
  if (!fields.test_due_date && r.moed_aliya_lakvish) {
    const raw = String(r.moed_aliya_lakvish);
    // Format can be "YYYY-MM" or "YYYY-MM-DD"
    const match = raw.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (match) {
      const [, yr, mo, dy] = match;
      const d = new Date(Number(yr) + 4, Number(mo) - 1, Number(dy || 1));
      if (!isNaN(d.getTime())) {
        fields.test_due_date = d.toISOString().split('T')[0];
      }
    }
  }

  // Registration fields
  if (r.zmig_kidmi)    fields.front_tire    = safeStr(r.zmig_kidmi, 40);
  if (r.zmig_ahori)    fields.rear_tire     = safeStr(r.zmig_ahori, 40);
  if (r.degem_manoa)   fields.engine_model  = safeStr(r.degem_manoa, 60);
  if (r.tzeva_rechev)  fields.color         = safeStr(r.tzeva_rechev, 30);
  if (r.mivchan_acharon_dt) fields.last_test_date = safeDate(r.mivchan_acharon_dt);
  if (r.moed_aliya_lakvish) fields.first_registration_date = safeDate(r.moed_aliya_lakvish);
  if (r.baalut)        fields.ownership     = safeStr(r.baalut, 30);
  if (r.degem_nm)      fields.model_code    = safeStr(r.degem_nm, 60);
  if (r.ramat_gimur)   fields.trim_level    = safeStr(r.ramat_gimur, 60);
  if (r.misgeret)      fields.vin           = safeStr(r.misgeret, 30);
  if (r.kvutzat_zihum != null) fields.pollution_group = String(r.kvutzat_zihum);
  if (r.sug_degem) {
    const SUG_MAP = { P: 'פרטי', M: 'מסחרי', A: 'אוטובוס', R: 'אופנוע', K: 'משאית', T: 'גרור' };
    fields.vehicle_class = SUG_MAP[r.sug_degem] || safeStr(r.sug_degem, 20);
  }
  if (r.ramat_eivzur_betihuty != null) fields.safety_rating = String(r.ramat_eivzur_betihuty);

  // Save tozeret_cd + degem_cd for specs lookup
  if (r.tozeret_cd) fields._tozeret_cd = String(r.tozeret_cd);
  if (r.degem_cd)   fields._degem_cd = String(r.degem_cd);

  return fields;
}

/**
 * Map a raw motorcycle/two-wheeler record to sanitized form fields.
 * The motorcycle API has different field names than the car API.
 */
function mapMotoRecord(r) {
  const fields = {};

  if (r.mispar_rechev) fields.license_plate = formatPlate(r.mispar_rechev);
  if (r.tozeret_nm)    fields.manufacturer  = safeStr(r.tozeret_nm, 60);
  if (r.degem_nm)      fields.model         = safeStr(r.degem_nm, 60);
  if (r.shnat_yitzur)  fields.year          = safeYear(r.shnat_yitzur);
  if (r.sug_delek_nm)  fields.fuel_type     = safeStr(r.sug_delek_nm, 40);
  if (r.baalut)        fields.ownership     = safeStr(r.baalut, 30);
  if (r.misgeret)      fields.vin           = safeStr(r.misgeret, 30);
  if (r.moed_aliya_lakvish) {
    fields.first_registration_date = safeDate(r.moed_aliya_lakvish);
    // For motorcycles, the test month is the same as registration month every year
    // e.g., "2023-3" means test is due in March. Calculate next test date.
    const parts = String(r.moed_aliya_lakvish).split('-');
    if (parts.length >= 2) {
      const regMonth = parseInt(parts[1], 10);
      if (regMonth >= 1 && regMonth <= 12) {
        const now = new Date();
        const thisYear = now.getFullYear();
        const thisMonth = now.getMonth() + 1;
        // If test month already passed this year, next test is next year
        const testYear = (regMonth < thisMonth) ? thisYear + 1 : thisYear;
        const lastDay = new Date(testYear, regMonth, 0).getDate(); // last day of the month
        fields.test_due_date = `${testYear}-${String(regMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      }
    }
  }
  if (r.mida_zmig_kidmi)  fields.front_tire = safeStr(r.mida_zmig_kidmi, 40);
  if (r.mida_zmig_ahori)  fields.rear_tire  = safeStr(r.mida_zmig_ahori, 40);

  // Motorcycle-specific specs — embedded directly (no second API needed)
  if (r.nefach_manoa)  fields.engine_cc     = safeNum(r.nefach_manoa) + ' סמ"ק';
  if (r.hespek)        fields.horsepower    = safeNum(r.hespek) + ' כ"ס';
  if (r.mishkal_kolel) fields.total_weight  = safeNum(r.mishkal_kolel) + ' ק"ג';
  if (r.mispar_mekomot) fields.seats        = safeNum(r.mispar_mekomot);
  if (r.mispar_manoa)  fields.engine_model  = safeStr(String(r.mispar_manoa), 40);
  if (r.tozeret_eretz_nm) fields.country_of_origin = safeStr(r.tozeret_eretz_nm, 40);

  // Vehicle type classification
  if (r.sug_rechev_nm) {
    fields.vehicle_class = safeStr(r.sug_rechev_nm, 40);
    fields.body_type = safeStr(r.sug_rechev_nm, 40);
  }

  // Model code from degem_nm (already used as model, but also useful for spec)
  if (r.degem_nm) fields.model_code = safeStr(r.degem_nm, 60);

  return fields;
}

/**
 * Map a raw specs record (from דגמי רכב API) to tech spec fields.
 */
function mapSpecRecord(r) {
  const specs = {};
  if (r.koah_sus)               specs.horsepower      = safeNum(r.koah_sus) + ' כ"ס';
  if (r.nefah_manoa)            specs.engine_cc        = safeNum(r.nefah_manoa) + ' סמ"ק';
  if (r.hanaa_nm && r.hanaa_nm !== 'לא ידוע קוד') specs.drivetrain = safeStr(r.hanaa_nm, 30);
  if (r.mishkal_kolel)          specs.total_weight     = safeNum(r.mishkal_kolel) + ' ק"ג';
  if (r.mispar_dlatot)          specs.doors            = safeNum(r.mispar_dlatot);
  if (r.mispar_moshavim)        specs.seats            = safeNum(r.mispar_moshavim);
  if (r.mispar_kariot_avir)     specs.airbags          = safeNum(r.mispar_kariot_avir);
  if (r.automatic_ind != null)  specs.transmission     = r.automatic_ind === 1 || r.automatic_ind === '1' ? 'אוטומטי' : 'ידני';
  if (r.merkav)                 specs.body_type        = safeStr(r.merkav, 40);
  if (r.tozeret_eretz_nm)       specs.country_of_origin = safeStr(r.tozeret_eretz_nm, 40);
  if (r.delek_nm)               specs.fuel_type_spec   = safeStr(r.delek_nm, 30);
  // Emissions
  if (r.CO2_WLTP)               specs.co2              = safeNum(r.CO2_WLTP) + ' גר\'/ק"מ';
  // Green index from kvuzat_agra_cd or madad_yarok
  if (r.madad_yarok)            specs.green_index      = safeNum(r.madad_yarok);
  if (r.mazgan_ind === 1 || r.mazgan_ind === '1') specs.ac = 'כן';
  if (r.abs_ind === 1 || r.abs_ind === '1') specs.abs = 'כן';
  if (r.kosher_grira_im_blamim) specs.tow_capacity     = safeNum(r.kosher_grira_im_blamim) + ' ק"ג';
  return specs;
}

/**
 * Fetch detailed tech specs from the דגמי רכב API using tozeret_cd + degem_cd + year.
 */
async function fetchDetailedSpecs(tozeretCd, degemCd, year) {
  if (!tozeretCd || !degemCd) return null;
  try {
    const filters = JSON.stringify({ tozeret_cd: Number(tozeretCd), degem_cd: Number(degemCd), ...(year ? { shnat_yitzur: Number(year) } : {}) });
    const url = `${API_BASE}?resource_id=${encodeURIComponent(SPECS_RESOURCE_ID)}&filters=${encodeURIComponent(filters)}&limit=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success || !json.result?.records?.length) return null;
    return mapSpecRecord(json.result.records[0]);
  } catch {
    return null;
  }
}

/**
 * Looks up a vehicle by its Israeli license plate number.
 * Returns registration data + detailed tech specs merged together.
 */
/**
 * Generic fetch helper for gov.il API.
 */
async function fetchGovApi(resourceId, query) {
  const url = `${API_BASE}?resource_id=${encodeURIComponent(resourceId)}&q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.success || !json.result?.records?.length) return null;
    return json.result.records;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('הבקשה לשרת הממשלתי ארכה יותר מדי. נסה שנית.');
    throw err;
  }
}

/**
 * Looks up a vehicle by its Israeli license plate number.
 * Tries the car API first, then the motorcycle API if not found.
 * Returns registration data + detailed tech specs merged together.
 */
export async function lookupVehicleByPlate(plate) {
  const clean = validatePlateInput(plate);

  // Try car API first (4+ wheels)
  let records = await fetchGovApi(RESOURCE_ID, clean);
  let isMoto = false;

  if (!records) {
    // Try motorcycle/two-wheeler API
    records = await fetchGovApi(MOTO_RESOURCE_ID, clean);
    isMoto = true;
  }

  if (!records) return null;

  const exact = records.find(
    r => String(r.mispar_rechev).replace(/\D/g, '') === clean
  );
  const record = exact ?? records[0];

  // Use the appropriate mapper
  const fields = isMoto ? mapMotoRecord(record) : mapRecord(record);

  // For cars: fetch detailed specs from the second API (motorcycles already have specs inline)
  if (!isMoto) {
    const specs = await fetchDetailedSpecs(fields._tozeret_cd, fields._degem_cd, fields.year);
    if (specs) {
      Object.entries(specs).forEach(([k, v]) => {
        if (v && !fields[k]) fields[k] = v;
      });
    }
  }

  // Remove internal fields
  delete fields._tozeret_cd;
  delete fields._degem_cd;

  return fields;
}

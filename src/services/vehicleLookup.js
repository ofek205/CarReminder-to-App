const RESOURCE_ID = '053cea08-09bc-40ec-8f7a-156f0677aff3';           // רכב 4 גלגלים (פרטי / מסחרי קל)
const MOTO_RESOURCE_ID = 'bf9df4e2-d90d-4c0a-a400-19e15af8e95f';   // אופנועים + דו גלגליים
const SPECS_RESOURCE_ID = '142afde2-6228-49f9-8a29-9b6c3a0cbe40';  // מאגר דגמי רכב. מפרט טכני
// "כלי רכב מעל 3 וחצי טון וכלי רכב חסרי קוד דגם" — heavy vehicles
// (N2/N3 trucks, O1-O4 trailers, some buses) which the private-car
// dataset deliberately excludes. Same data.gov.il datastore_search
// endpoint, different schema: no tokef_dt (test expiry), no misgeret,
// has tkina_EU (EU class) + kvutzat_sug_rechev (Hebrew group label).
const HEAVY_RESOURCE_ID = 'cd3acc5c-03c3-4c89-9c54-d40f93c0d790';
// "כלי צמ"ה" (construction machinery) registry — forklifts, excavators,
// loaders, rollers etc. Unique schema: plate field is `mispar_tzama`
// (NOT mispar_rechev), often only 4-7 digits, and it carries a real
// `tokef_date` we can use to auto-fill the inspection report expiry
// — which is the closest the platform has to a "next test" date for
// this category.
const CME_RESOURCE_ID = '58dc4654-16b1-42ed-8170-98fadec153ea';
// "כלי רכב שירדו מהכביש ובסטטוס ביטול סופי" — vehicles that were
// permanently cancelled. ~1.16M records. Same schema as the active
// private-car registry plus a `bitul_dt` cancellation date. Probed
// LAST in the lookup chain so a plate that's still active won't
// hit a stale "off-road" record. When a plate ONLY shows up here,
// we still return the data so the user can add the vehicle
// (vintage / keepsake / etc.) — but flag it so the UI can warn
// before silently filling the form.
const INACTIVE_RESOURCE_ID = '851ecab1-0622-4dbe-a6c7-f950cf82abf9';
// "תוצאות מבחני רישוי שנתיים" — yearly inspection (test) results
// keyed by mispar_rechev. The headline field for our purposes is
// `kilometraj_test_aharon` — odometer reading recorded at the last
// annual test. We use it to seed `current_km` on AddVehicle for plates
// that don't already carry one. Tens of millions of rows; we always
// query with an exact mispar_rechev filter (not q=fulltext) and limit
// 1 record back. Values of 0 are stored when the inspector didn't
// record a reading — treated as "no value" and ignored.
const LAST_TEST_KM_RESOURCE_ID = '56063a99-8a3e-4ff4-912e-5966c0279bad';
// "היסטוריית כלי רכב פרטיים" — one row per ownership episode for a plate.
// The number of rows for a given mispar_rechev IS the vehicle's hand
// number (3 rows = יד שלישית). The `baalut` column on each row tells
// us what kind of ownership that episode was (פרטי / ליסינג /
// מסחרי / השכרה / ...). Used to populate ownership_hand and the
// expandable ownership_history list.
const OWNERSHIP_HISTORY_RESOURCE_ID = 'bb2355dc-9ec7-4f06-9c3f-3344672171da';
import { isNative } from '@/lib/capacitor';

// In dev browser, Vite proxies /gov-api → https://data.gov.il to avoid CORS.
// In production (browser or Capacitor native) call the API directly.
const API_BASE = (import.meta.env.DEV && !isNative)
  ? '/gov-api/api/3/action/datastore_search'
  : 'https://data.gov.il/api/3/action/datastore_search';

//  Input validation
/**
 * Israeli plates are 7-8 digits (optionally dash-separated). Construction
 * machinery (כלי צמ"ה) plates use a separate registry with shorter
 * numbers — sometimes as few as 4 digits. We accept 4-8 net digits so
 * both flows pass the same validator; the CME-tier API call only fires
 * when the regular 7-8-digit lookups all miss.
 */
const PLATE_REGEX = /^[\d\-]{4,11}$/;

function validatePlateInput(plate) {
  if (typeof plate !== 'string') throw new Error('invalid_input');
  const stripped = plate.replace(/[\s]/g, '');
  if (!PLATE_REGEX.test(stripped)) throw new Error('invalid_plate_format');
  const digits = stripped.replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 8) throw new Error('invalid_plate_length');
  return digits;
}

//  Output sanitization 
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

  // Fallback: if no tokef_dt (new cars). use first_registration + 4 years
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

  // Motorcycle-specific specs. embedded directly (no second API needed)
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
 * Map a raw heavy-vehicle record (trucks, trailers, buses >3.5t) to
 * sanitized form fields. Same datastore_search endpoint, different
 * schema than the private-car API.
 *
 * Notable absences:
 *   - tokef_dt (test/license expiry) — heavy vehicles run on a
 *     different test cadence (typically every 6 months) and the
 *     dataset doesn't carry it. User must enter test_due_date by hand.
 *   - misgeret (VIN as letters) — heavy uses mispar_shilda (digits).
 *   - safety_rating, pollution_group — not in the heavy dataset.
 *
 * tkina_EU (EU classification) drives type detection:
 *   N1 = light goods ≤3.5t (rare in this dataset)
 *   N2 = medium goods 3.5-12t   →  truck
 *   N3 = heavy goods >12t       →  truck
 *   O1-O4 = trailers            →  trailer
 *   M2/M3 = bus 9+/heavy        →  bus
 */
function mapHeavyRecord(r) {
  const fields = {};

  if (r.mispar_rechev) fields.license_plate = formatPlate(r.mispar_rechev);
  if (r.tozeret_nm)    fields.manufacturer  = safeStr(r.tozeret_nm, 60);
  if (r.degem_nm)      fields.model         = safeStr(r.degem_nm, 60);
  if (r.shnat_yitzur)  fields.year          = safeYear(r.shnat_yitzur);
  if (r.sug_delek_nm)  fields.fuel_type     = safeStr(r.sug_delek_nm, 40);
  if (r.tozeret_eretz_nm) fields.country_of_origin = safeStr(r.tozeret_eretz_nm, 40);
  if (r.moed_aliya_lakvish) fields.first_registration_date = safeDate(r.moed_aliya_lakvish);

  // Tires — same field names as private cars, kept inline.
  if (r.zmig_kidmi) fields.front_tire = safeStr(r.zmig_kidmi, 40);
  if (r.zmig_ahori) fields.rear_tire  = safeStr(r.zmig_ahori, 40);

  // Engine
  if (r.degem_manoa)  fields.engine_model = safeStr(r.degem_manoa, 60);
  if (r.mispar_manoa) fields.engine_number = safeStr(String(r.mispar_manoa), 40);
  if (r.nefach_manoa && Number(r.nefach_manoa) > 0) {
    fields.engine_cc = safeNum(r.nefach_manoa) + ' סמ"ק';
  }

  // Drivetrain (4X2, 4X4, 6X2, 6X4, 8X4 …) — characteristic of heavies
  if (r.hanaa_nm && r.hanaa_nm !== 'לא ידוע קוד') {
    fields.drivetrain = safeStr(r.hanaa_nm, 30);
  }

  // Weights — heavy-specific richness
  if (r.mishkal_kolel) fields.total_weight = safeNum(r.mishkal_kolel) + ' ק"ג';
  if (r.mishkal_azmi)  fields.empty_weight = safeNum(r.mishkal_azmi) + ' ק"ג';
  if (r.mishkal_mitan_harama) fields.payload_capacity = safeNum(r.mishkal_mitan_harama) + ' ק"ג';

  // Seats — driver-side seats are reported separately on heavies
  if (r.mispar_mekomot)              fields.seats = safeNum(r.mispar_mekomot);
  else if (r.mispar_mekomot_leyd_nahag) fields.seats = safeNum(r.mispar_mekomot_leyd_nahag);

  // VIN-equivalent
  if (r.mispar_shilda) fields.vin = safeStr(String(r.mispar_shilda), 30);

  // Tow hitch text. The heavy dataset writes "יש וו גרירה" / "אין"
  // verbatim; surface as a yes/no tow hitch flag for the form.
  if (r.grira_nm && r.grira_nm.includes('יש')) {
    fields.has_tow_hitch = 'כן';
  }

  // Vehicle class — prefer the Hebrew group label when present
  // (it's already user-friendly: "משאית" / "גרור" / "אוטובוס"),
  // otherwise fall back to mapping the EU class.
  if (r.kvutzat_sug_rechev) {
    fields.vehicle_class = safeStr(r.kvutzat_sug_rechev, 30);
  } else if (r.tkina_EU) {
    const tk = String(r.tkina_EU).toUpperCase();
    if (tk.startsWith('N')) fields.vehicle_class = 'משאית';
    else if (tk.startsWith('O')) fields.vehicle_class = 'גרור';
    else if (tk.startsWith('M')) fields.vehicle_class = 'אוטובוס';
  }
  if (r.tkina_EU) fields.eu_class = safeStr(String(r.tkina_EU).toUpperCase(), 8);

  // Save tozeret_cd for the optional specs lookup
  if (r.tozeret_cd) fields._tozeret_cd = String(r.tozeret_cd);

  return fields;
}

/**
 * Map a raw construction-machinery (כלי צמ"ה) record to sanitized form
 * fields. The CME registry is a completely separate dataset from the
 * road-vehicle ones:
 *
 *   - Plate field is `mispar_tzama` (not mispar_rechev), and the
 *     numbering is its own namespace — frequently 4-7 digits.
 *   - Manufacturer is in English (`shilda_totzar_en_nm`) without a
 *     Hebrew counterpart, so we accept it as-is.
 *   - Critically, the dataset carries a real `tokef_date` (license/
 *     inspection validity). Maps cleanly to inspection_report_expiry_date,
 *     which is exactly the field the user asked for in the form.
 *   - `kosher_harama_ton` (lifting capacity, tons) is the headline spec
 *     for forklifts/cranes/telehandlers — surface as a top-level field.
 */
function mapCmeRecord(r) {
  const fields = {};

  if (r.mispar_tzama)         fields.license_plate = safeStr(String(r.mispar_tzama), 12);
  if (r.shilda_totzar_en_nm)  fields.manufacturer  = safeStr(r.shilda_totzar_en_nm, 60);
  if (r.degem_nm)             fields.model         = safeStr(r.degem_nm, 60);
  if (r.shnat_yitzur)         fields.year          = safeYear(r.shnat_yitzur);
  if (r.mispar_shilda)        fields.vin           = safeStr(String(r.mispar_shilda), 30);

  // Equipment subtype — "מלגזה מנוע שריפה", "מחפר זחל", etc. Use as
  // vehicle_class so it surfaces in the technical-spec section.
  if (r.sug_tzama_nm)         fields.vehicle_class = safeStr(r.sug_tzama_nm, 60);

  // Propulsion / fuel
  if (r.hanaa_nm)             fields.fuel_type     = safeStr(r.hanaa_nm, 30);

  // Horsepower (always reported in HP)
  if (r.koah_sus && Number(r.koah_sus) > 0) {
    fields.horsepower = safeNum(r.koah_sus) + ' כ"ס';
  }

  // Weights — the CME registry uses tons, convert to kg for parity
  // with the rest of the app's UI which formats weights with ק"ג.
  if (r.mishkal_kolel_ton && Number(r.mishkal_kolel_ton) > 0) {
    fields.total_weight = String(Math.round(Number(r.mishkal_kolel_ton) * 1000)) + ' ק"ג';
  } else if (r.mishkal_ton && Number(r.mishkal_ton) > 0) {
    fields.total_weight = String(Math.round(Number(r.mishkal_ton) * 1000)) + ' ק"ג';
  }

  // Lifting capacity — stored as a tow_capacity-style string so the
  // existing form/UI treats it consistently. Heavy-equipment lift
  // capacity is the headline spec for forklifts/telehandlers/cranes,
  // and surfacing it in tow_capacity keeps it visible in the technical
  // specs section without adding a new DB column.
  if (r.kosher_harama_ton && Number(r.kosher_harama_ton) > 0) {
    fields.tow_capacity = String(Math.round(Number(r.kosher_harama_ton) * 1000)) + ' ק"ג (כושר הרמה)';
  }

  // Registration date — the registry stores it as "YYYY-MM-DD HH:MM:SS"
  if (r.rishum_date) {
    fields.first_registration_date = safeDate(r.rishum_date);
  }

  // tokef_date is the standard test/registration expiry for CME —
  // equivalent to tokef_dt on the private-car dataset. Maps to
  // test_due_date so the existing reminder pipeline + form label
  // ("תאריך טסט") work without special-casing CME. The dedicated
  // תסקיר field stays optional and is filled manually by the user
  // for any additional periodic-inspection certificate they hold.
  if (r.tokef_date) {
    fields.test_due_date = safeDate(r.tokef_date);
  }

  return fields;
}

/**
 * Fetch a single CME record by exact mispar_tzama match. Different
 * pattern from fetchGovApi (q=fulltext) because mispar_tzama is
 * numeric and we want a precise hit, not "any record whose any field
 * happens to contain '1002'".
 */
async function fetchCmeApi(plateDigits) {
  const filters = JSON.stringify({ mispar_tzama: Number(plateDigits) });
  const url = `${API_BASE}?resource_id=${encodeURIComponent(CME_RESOURCE_ID)}&filters=${encodeURIComponent(filters)}&limit=1`;
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
    return null;
  }
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
  // Tow capacity: combine "with brakes" + "without brakes" in one string when both exist.
  // Display pattern: "1500 / 750 ק\"ג" (עם בלמים / בלי). matches how Israeli specs sheets show it.
  const towBraked = safeNum(r.kosher_grira_im_blamim);
  const towUnbraked = safeNum(r.kosher_grira_bli_blamim);
  if (towBraked && towUnbraked) {
    specs.tow_capacity = `${towBraked} / ${towUnbraked} ק"ג (עם/בלי בלמים)`;
  } else if (towBraked) {
    specs.tow_capacity = `${towBraked} ק"ג (עם בלמים)`;
  } else if (towUnbraked) {
    specs.tow_capacity = `${towUnbraked} ק"ג (בלי בלמים)`;
  }
  // Tow hitch ("וו גרירה"): the gov.il spec API doesn't return a dedicated
  // boolean, but it does report towing capacity fields. The DoT only fills
  // those when the model is hitch-capable, so presence of either value is
  // a reliable proxy for "vehicle has a hitch". Absence is ambiguous — the
  // value might just be missing — so we intentionally never display "לא"
  // here; the field is shown only when we can say "כן" confidently.
  if (towBraked || towUnbraked) {
    specs.has_tow_hitch = 'כן';
  }
  return specs;
}

/**
 * Fetch last-test odometer reading for a plate. Uses an exact filter
 * on mispar_rechev (not q=fulltext) so we never get a spurious match
 * against a record where the plate digits happen to appear in some
 * other column.
 *
 * Returns the kilometers as a positive integer, or null if:
 *   • the plate isn't in the dataset
 *   • the odometer field is missing/zero (inspector didn't record)
 *   • the API call fails or times out (we never fail the parent
 *     lookup just because this enrichment didn't land)
 *
 * Wrapped in its own try/catch so a failure here can't escape and
 * crash the main lookup — current_km is a nice-to-have, not critical.
 */
async function fetchLastTestKm(plateDigits) {
  try {
    const filters = JSON.stringify({ mispar_rechev: Number(plateDigits) });
    const url = `${API_BASE}?resource_id=${encodeURIComponent(LAST_TEST_KM_RESOURCE_ID)}&filters=${encodeURIComponent(filters)}&limit=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const json = await res.json();
    const record = json?.result?.records?.[0];
    if (!record) return null;
    // Field name from the dataset (visible in the gov.il preview as
    // "...test_aharon"). Fallback to a couple of plausible synonyms in
    // case the dataset gets renamed — costs nothing to check.
    const raw = record.kilometraj_test_aharon
             ?? record.km_test_aharon
             ?? record.kmrut_test_aharon;
    const km = Number(raw);
    if (!Number.isFinite(km) || km <= 0) return null;
    return Math.round(km);
  } catch {
    return null;   // never throws — current_km is best-effort
  }
}

/**
 * Fetch ownership history for a plate. Returns:
 *   {
 *     hand:    integer 1+    — count of ownership episodes
 *     history: array of      — chronological list (oldest first)
 *       { baalut: 'פרטי', date: 'YYYY-MM-DD' | null }
 *     current: 'פרטי'        — most recent baalut value (for the
 *                              ownership field; only used as fallback
 *                              when the registration record didn't
 *                              already give us one)
 *   }
 *
 * Returns null on any error / empty result. Best-effort: never throws,
 * never blocks the parent lookup. The dataset has no documented field
 * for ownership-start date — we try a few plausible names and gracefully
 * leave date=null if none is found.
 */
async function fetchOwnershipHistory(plateDigits) {
  try {
    // We DON'T use a filters= query here because the gov.il datastore_search
    // exact-match filter on this dataset has flaky behavior with 7-digit
    // numerics — depending on whether the column is stored as int or
    // text we get either a hit or 0 results. Using q=fulltext on the
    // plate number works reliably across both. We then filter the
    // returned records client-side to the exact plate.
    const url = `${API_BASE}?resource_id=${encodeURIComponent(OWNERSHIP_HISTORY_RESOURCE_ID)}&q=${encodeURIComponent(plateDigits)}&limit=50`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const json = await res.json();
    const records = json?.result?.records || [];
    if (records.length === 0) return null;

    // Tighten to records whose plate column matches exactly. Cheap
    // safeguard against fulltext bleed (e.g. "1234567" matching a VIN
    // suffix in another row).
    const exact = records.filter(r =>
      String(r.mispar_rechev || '').replace(/\D/g, '') === plateDigits
    );
    if (exact.length === 0) return null;

    // Sort chronologically (oldest first). The dataset doesn't document
    // a single date column — try a handful of plausible names. If
    // nothing works, the records are returned in the dataset's native
    // order, which usually correlates with insertion order.
    const dateOf = (r) =>
      r.taarich_baalut ?? r.tarich_baalut ?? r.tarich_haskara
      ?? r.taarich_aliya ?? r.moed_baalut ?? null;
    const sorted = [...exact].sort((a, b) => {
      const da = String(dateOf(a) || '');
      const db = String(dateOf(b) || '');
      return da.localeCompare(db);
    });

    const history = sorted.map(r => ({
      baalut: safeStr(r.baalut || '', 30) || null,
      date:   safeDate(dateOf(r)) || null,
    }));

    return {
      hand:    history.length,
      history,
      current: history[history.length - 1]?.baalut || null,
    };
  } catch {
    return null;   // never throws — enrichment is best-effort
  }
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

  // Source priority — chosen by plate length so we don't fuzz-match
  // short CME numbers against the road-vehicle datasets:
  //
  //   • 4-6 digits → CME ONLY. The car / moto / heavy datasets use a
  //     fulltext q= search; a 4-digit string like "1002" would
  //     happily match any record where "1002" appears in any column
  //     (year, partial VIN, etc.) and return a spurious hit before
  //     CME is even tried. Skipping straight to CME (which uses an
  //     exact-match `filters` on mispar_tzama) avoids that.
  //
  //   • 7-8 digits → Standard cascade: car → moto → heavy → cme →
  //     inactive (off-road). The inactive registry is tried LAST so
  //     a plate that's still active never hits a stale cancelled
  //     record by accident.
  let records = null;
  let source = null;
  const isShort = clean.length < 7;

  if (!isShort) {
    records = await fetchGovApi(RESOURCE_ID, clean);
    if (records) source = 'car';
    if (!records) {
      records = await fetchGovApi(MOTO_RESOURCE_ID, clean);
      if (records) source = 'moto';
    }
    if (!records) {
      records = await fetchGovApi(HEAVY_RESOURCE_ID, clean);
      if (records) source = 'heavy';
    }
  }
  if (!records) {
    records = await fetchCmeApi(clean);
    if (records) source = 'cme';
  }
  // Last-resort tier — the off-road / cancelled-status registry.
  // Only probed for full-length plates because short numbers belong
  // to the CME namespace (already tried above). Same fulltext q=
  // mechanic as the active-registry tiers, schema mirrors the
  // private-car dataset plus `bitul_dt`.
  if (!records && !isShort) {
    records = await fetchGovApi(INACTIVE_RESOURCE_ID, clean);
    if (records) source = 'inactive';
  }

  if (!records) return null;

  // CME records key on mispar_tzama, all other tiers on mispar_rechev.
  const plateField = source === 'cme' ? 'mispar_tzama' : 'mispar_rechev';
  const exact = records.find(
    r => String(r[plateField]).replace(/\D/g, '') === clean
  );
  const record = exact ?? records[0];

  // Pick the matching mapper. The `inactive` (off-road / cancelled)
  // dataset uses the same private-car schema, so mapRecord is reused;
  // the cancellation date is appended after.
  const fields = source === 'moto'     ? mapMotoRecord(record)
              : source === 'heavy'    ? mapHeavyRecord(record)
              : source === 'cme'      ? mapCmeRecord(record)
              : mapRecord(record); // 'car' OR 'inactive'

  // Inactive-registry hit → tag the result so AddVehicle can warn the
  // user before silently populating the form. We still return the data
  // (vintage / keepsake owners might legitimately want to track an
  // off-road vehicle) — the warning is informational, not blocking.
  if (source === 'inactive') {
    fields._isInactive = true;
    if (record.bitul_dt) {
      fields._cancellationDate = safeDate(record.bitul_dt) || null;
    }
  }

  // Detailed specs lookup + last-test odometer enrichment. Both run
  // in parallel — they're independent calls against different
  // datasets. Either failing leaves the rest of the result intact;
  // current_km is a "nice if we have it" enrichment, the user can
  // also enter it manually.
  //
  // Coverage:
  //   • specs: cars + heavies (private-car + inactive use the same
  //     schema; motorcycles carry specs inline; CME has a complete
  //     record so neither needs the second call)
  //   • test-km: cars + heavies + inactive (all keyed on
  //     mispar_rechev). Motorcycles have their own dataset; CME plates
  //     are a different namespace entirely (mispar_tzama).
  const enrichments = await Promise.all([
    (source !== 'moto' && source !== 'cme' && fields._tozeret_cd)
      ? fetchDetailedSpecs(fields._tozeret_cd, fields._degem_cd, fields.year)
      : Promise.resolve(null),
    (source !== 'moto' && source !== 'cme')
      ? fetchLastTestKm(clean)
      : Promise.resolve(null),
    (source !== 'moto' && source !== 'cme')
      ? fetchOwnershipHistory(clean)
      : Promise.resolve(null),
  ]);
  const [specs, lastTestKm, ownership] = enrichments;

  if (specs) {
    Object.entries(specs).forEach(([k, v]) => {
      if (v && !fields[k]) fields[k] = v;
    });
  }
  // Merge non-destructively — if the user already populated current_km
  // (e.g. from a previous form session) we don't overwrite it. The
  // value is the odometer at the LAST test, which is the most recent
  // ground-truth reading we have for the plate.
  if (lastTestKm && !fields.current_km) {
    fields.current_km = String(lastTestKm);
  }
  // Ownership enrichment — the dedicated history dataset is the
  // primary source for hand + history. Current `ownership` (baalut)
  // is taken from the registration record first; we only fall back
  // to the history's most-recent entry if the registration didn't
  // carry one (e.g. CME / heavy where it isn't included).
  if (ownership) {
    fields.ownership_hand    = ownership.hand;
    fields.ownership_history = ownership.history;
    if (!fields.ownership && ownership.current) {
      fields.ownership = ownership.current;
    }
  }

  // Remove internal fields
  delete fields._tozeret_cd;
  delete fields._degem_cd;

  // Expose the detected type so callers can warn the user when the
  // selected category doesn't match what the Ministry of Transport says.
  let detectedType;
  if (source === 'cme') {
    // Anything from the CME registry — forklifts, excavators, loaders,
    // rollers, telehandlers — falls under "כלי צמ"ה" in the UI's
    // top-level category list. Subtype refinement (sug_tzama_nm)
    // already lives inside fields.vehicle_class for the form.
    detectedType = 'cme';
  } else if (source === 'moto') {
    detectedType = 'motorcycle';
  } else if (source === 'heavy') {
    // Heavy dataset uses tkina_EU instead of sug_degem.
    const tk = String(record.tkina_EU || '').toUpperCase();
    if (tk.startsWith('O'))      detectedType = 'trailer';
    else if (tk === 'M2' || tk === 'M3') detectedType = 'bus';
    else                         detectedType = 'truck';
  } else {
    // Private-car dataset OR inactive-vehicle dataset (same schema).
    // The inactive dataset uses sug_rechev_nm instead of sug_degem
    // for vehicle classification — fall back to it when present.
    const sugDegem = String(record.sug_degem || '').toUpperCase();
    if      (sugDegem === 'K') detectedType = 'truck';
    else if (sugDegem === 'A') detectedType = 'bus';
    else if (sugDegem === 'T') detectedType = 'trailer';
    else if (sugDegem === 'M') detectedType = 'commercial';
    else                       detectedType = 'car';
  }
  fields._detectedType = detectedType;
  fields._detectedTypeLabel = {
    motorcycle: 'אופנוע / דו-גלגלי',
    car: 'רכב פרטי',
    commercial: 'רכב מסחרי',
    truck: 'משאית',
    bus: 'אוטובוס',
    trailer: 'גרור',
    cme: 'כלי צמ"ה',
  }[detectedType] || 'רכב';

  return fields;
}

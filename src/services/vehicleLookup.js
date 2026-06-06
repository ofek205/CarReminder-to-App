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
// Historical archives of the SAME "ירדו מהכביש / ביטול סופי" registry,
// split by cancellation period. ~1.17M vehicles that exist ONLY here —
// the current INACTIVE_RESOURCE_ID dataset does NOT contain them
// (verified: a 2004/2014 cancellation returns 0 rows in the current set).
// Same private-car schema + `bitul_dt`, so mapRecord + the source==='inactive'
// handling work unchanged. Static archives (2010-2016 frozen since 2021,
// 2000-2009 manual) so no freshness concern. Probed at the END of the
// cascade, right after the current cancelled registry.
const INACTIVE_2010_2016_RESOURCE_ID = '4e6b9724-4c1e-43f0-909a-154d4cc4e046';
const INACTIVE_2000_2009_RESOURCE_ID = 'ec8cbc34-72e1-4b69-9c48-22821ba0bd6c';
// "רכב לא פעיל ללא קוד דגם" — vehicles missing a model_cd (older
// imports, classic cars, custom-built) that lapsed >13 months ago but
// aren't stolen or finally cancelled. The key insight: this is where
// **collector cars** ("רכבי אספנות") with short 4-6 digit plates from
// the 60s/70s actually live. They were registered before the modern
// degem_cd taxonomy and never re-coded.
//
// Critical: shares the `mispar_rechev` namespace with the active
// private-car registry, NOT `mispar_tzama` like CME. So plate "229080"
// can legitimately exist as BOTH a SCHMIDT street-sweeper (CME) AND a
// 1965 Triumph Herald (this registry) — different namespaces, same
// digits. The lookup cascade must check this dataset for short plates
// BEFORE falling through to CME, otherwise the collector gets
// mislabelled as a forklift.
const INACTIVE_NO_MODEL_RESOURCE_ID = '6f6acd03-f351-4a8f-8ecf-df792f4f573a';
// "מספרי רישוי של כלי רכב לא פעילים עם קוד דגם" — 584K records, the
// biggest of the three "inactive" datasets. Covers vehicles whose annual
// test (tokef_dt) lapsed but which haven't yet been officially cancelled
// (no bitul_dt). The schema mirrors the active private-car registry,
// so mapRecord works on it as-is. Without this tier in the cascade, a
// user looking up a plate that's been off the road for 1-3 years got
// "not found" even though the ministry still has full registration data.
const INACTIVE_WITH_MODEL_RESOURCE_ID = 'f6efe89a-fb3d-43a4-bb61-9bf12a9b9099';
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
// "כלי רכב ביבוא אישי" — 27K-row registry of vehicles that entered
// Israel via personal import. Presence of a record means the plate
// IS personally imported; the `sug_yevu` column gives the variant
// ("יבוא אישי-משומש" / "יבוא אישי-חדש"). We surface this as a small
// informational badge next to the existing vintage chip — no logic
// or reminders depend on it.
const PERSONAL_IMPORT_RESOURCE_ID = '03adc637-b6fe-402b-9937-7c3d3afc9140';
// "כלי רכב שלא ביצעו ריקול - קריאות שירות" — vehicles with an OPEN
// (unfulfilled) recall service call. Match by MISPAR_RECHEV; presence
// of any record means the plate has at least one outstanding recall.
// Headline fields: TEUR_TAKALA (defect description in Hebrew),
// SUG_TAKALA (defect type — typically "ליקוי בטיחותי"), TAARICH_PTICHA
// (recall opening date). 137K records as of 2026-05.
const OPEN_RECALL_RESOURCE_ID = '36bf1404-0be4-49d2-82dc-2f1ead4a8b93';
// "Recall" — the master recall-CAMPAIGN catalog (3.6K rows), keyed by
// RECALL_ID. The per-plate open-recall dataset above tells us WHICH
// recalls a vehicle has open + their defect text, but not HOW to act on
// them. Joining on RECALL_ID adds the actionable bits: OFEN_TIKUN (fix
// method), YEVUAN_TEUR (importer), TELEPHONE + WEBSITE (where to book the
// repair). Best-effort enrichment — a miss just omits the contact info.
const RECALL_CAMPAIGN_RESOURCE_ID = '2c33523f-87aa-44ec-a736-edbb0a82975e';
// "מאגר נתוני כלי טיס ישראליים" — the entire Israeli civil aviation
// fleet (547 records as of 2026-05). Keyed by `Expr1` which holds the
// ICAO registration mark (always "4X-XXX" — Israel's national prefix
// + 3 uppercase letters; verified 100% format compliance across the
// dataset). Auto-updated monthly. Schema: SHM_ITZRN_MTOS (manufacturer),
// SHM_DGM_MTOS (model), SHNT_IITZOR_MTOS (year), MSPR_SIDORI_MTOS
// (serial), FLIGHT_WEIGHT_KG (MTOW). No engine hours, no airworthiness
// data, no certificates — those live in CAMO systems we deliberately
// don't try to replace.
const AIRCRAFT_RESOURCE_ID = 'bc00ed41-75d0-4d0f-9eca-3cd0a2c332cc';
import { isNative } from '@/lib/capacitor';

// In dev browser ONLY, Vite proxies /gov-api → https://data.gov.il to avoid CORS.
// In production (browser or Capacitor native), call data.gov.il directly.
//
// PREVIOUS BUG: this used `import.meta.env.DEV && !isNative` which relied
// on Vite statically replacing `DEV` at build time. On Vercel, that
// replacement somehow left the ternary as a runtime expression and
// resolved to the `/gov-api` branch in production — Vercel then served
// index.html (no such path), JSON.parse choked on the HTML, every short-
// plate lookup returned null. See v4.8.5 commit for the trace.
//
// New approach: runtime hostname check. localhost / 127.0.0.1 / *.local
// hits the dev proxy; everything else (Vercel previews, prod, native)
// hits data.gov.il directly. Zero dependency on Vite env replacement.
const DATA_GOV_DIRECT = 'https://data.gov.il/api/3/action/datastore_search';
const DEV_PROXY = '/gov-api/api/3/action/datastore_search';
const API_BASE = (() => {
  if (isNative) return DATA_GOV_DIRECT;
  if (typeof window === 'undefined') return DATA_GOV_DIRECT;
  const host = window.location.hostname || '';
  const isLocalDev = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  return isLocalDev ? DEV_PROXY : DATA_GOV_DIRECT;
})();

//  Input validation
/**
 * Israeli plates are 7-8 digits (optionally dash-separated). Construction
 * machinery (כלי צמ"ה) plates use a separate registry with shorter
 * numbers — sometimes as few as 4 digits. We accept 4-8 net digits so
 * both flows pass the same validator; the CME-tier API call only fires
 * when the regular 7-8-digit lookups all miss.
 */
const PLATE_REGEX = /^[\d\-]{4,11}$/;

// Israeli aircraft registration marks: ICAO national prefix "4X-" + 3
// uppercase letters. Verified 100% format compliance across the entire
// 547-record civil aviation registry (resource bc00ed41). No exceptions,
// no digits, no other patterns. Exported so vehicleQuickCheck can share
// the same source of truth without duplicating the regex.
export const AIRCRAFT_PLATE_REGEX = /^4X-[A-Z]{3}$/;

// Aircraft serial numbers (MSPR_SIDORI_MTOS) are free-form ASCII —
// mixes digits, letters, and dashes. Floor of 4 chars matches the
// ground-plate minimum and avoids accidental routing of 2-char garbage
// to the aircraft tier. Live registry max as of 2026-05 is 15 chars
// (verified across all 547 records), so 20 leaves comfortable headroom.
const AIRCRAFT_SERIAL_REGEX = /^[A-Z0-9-]{4,20}$/;

export function isAircraftPlate(plate) {
  if (typeof plate !== 'string') return false;
  const t = plate.trim().toUpperCase();
  if (AIRCRAFT_PLATE_REGEX.test(t)) return true;
  // Serial branch requires at least one letter — without it any 4-digit
  // ground plate would mis-route to the aircraft tier (e.g. forklift
  // mispar_tzama "1002" must reach the CME registry, not aviation).
  return /[A-Z]/.test(t) && AIRCRAFT_SERIAL_REGEX.test(t);
}

// True only for the canonical 4X- registration mark — used to decide
// which registry column to filter against (Expr1 vs MSPR_SIDORI_MTOS).
function isRegistrationMark(plate) {
  return AIRCRAFT_PLATE_REGEX.test(String(plate || '').trim().toUpperCase());
}

function validatePlateInput(plate) {
  if (typeof plate !== 'string') throw new Error('invalid_input');
  const stripped = plate.replace(/[\s]/g, '');
  const upper = stripped.toUpperCase();
  // Aircraft routing has two paths:
  //   • "4X-XXX" canonical registration mark → uppercase exact form
  //   • Any other alphanumeric+dash value with at least one letter →
  //     treated as a possible aircraft serial (the lookup tier will
  //     try MSPR_SIDORI_MTOS and return null if nothing matches)
  // Pure-digit values fall through to the ground-vehicle cascade so a
  // forklift owner typing "1002" still hits the CME tier.
  if (isAircraftPlate(upper)) return upper;
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
    // The motorcycle dataset carries NO official test/validity date (unlike
    // the private-car dataset's tokef_dt). We can only ESTIMATE the next test
    // by assuming the annual test falls in the registration month. That guess
    // is NOT a verified fact — and worse, when the test month has already
    // passed this year it silently rolls forward to next year, which would
    // mask a SKIPPED test as if it were done. So we compute it but mark it
    // estimated; the "בדוק רכב" report uses the flag to show the real
    // "עלייה לכביש" date instead of presenting this guess as a test date.
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
        fields._test_due_estimated = true;   // computed guess, not a gov.il fact
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
 * Single source of truth for "is this record a collector vehicle?"
 *
 * Two registries hint at collector status with different signals:
 *   - CME registry: `sug_tzama_nm` text contains a Hebrew vintage
 *     keyword (אספנות / וטרן / וינטג). Rare — most CME records are
 *     real construction equipment.
 *   - Inactive-no-model registry: no reliable collector signal. Age alone
 *     is NOT collector status (a 30+ car is "רכב מיושן" unless the owner
 *     registered it as אספנות), so these are classified as a regular car
 *     and getTestPolicy derives the מיושן category from the age.
 *
 * Returns the appropriate detectedType for the source:
 *   - CME:               'collector' or 'cme'
 *   - inactive_classic:  'car'
 *   - other sources:     null (caller picks via its own logic)
 *
 * Centralises the regex + age threshold so future tweaks (e.g. adding
 * 'היסטורי' to the keyword list) only need ONE edit.
 */
function detectCollectorType(record, source) {
  if (source === 'cme') {
    const subtypeText = String(record?.sug_tzama_nm || '');
    return /אספנות|וטרן|וינטג/.test(subtypeText) ? 'collector' : 'cme';
  }
  if (source === 'inactive_classic') {
    // Age alone does NOT make a car "רכב אספנות". Collector status is a
    // deliberate Ministry registration, not merely being old — a 30+ car
    // that the owner did NOT register as אספנות is "רכב מיושן" and tests
    // every 6 months, not annually. So we classify these as a regular car
    // and let getTestPolicy derive the category (מיושן) from the age.
    // Only an explicit gov.il collector signal (the CME keyword path above)
    // still yields 'collector'.
    return 'car';
  }
  return null;
}

/**
 * Map a raw record from `rechev_le_pail_without-degem` (the
 * inactive-no-model registry where collector / classic / personally-
 * imported cars without a modern degem_cd live). Schema overlaps the
 * active private-car registry but is narrower:
 *   - No tokef_dt / mivchan_acharon_dt (test dates) — these are off-road
 *   - No baalut / ramat_gimur — basic registration data only
 *   - Has tkina_EU (M1/M2/M3 etc.) instead of sug_degem
 *   - tozeret_eretz_nm gives country of manufacture (often UK/USA/IT
 *     for classic cars worth flagging)
 */
function mapInactiveNoModelRecord(r) {
  const fields = {};

  if (r.mispar_rechev)       fields.license_plate = safeStr(String(r.mispar_rechev), 12);
  if (r.tozeret_nm)          fields.manufacturer  = safeStr(r.tozeret_nm, 60);
  if (r.degem_nm)            fields.model         = safeStr(r.degem_nm, 60);
  if (r.shnat_yitzur)        fields.year          = safeYear(r.shnat_yitzur);
  if (r.mispar_shilda)       fields.vin           = safeStr(String(r.mispar_shilda), 30);
  if (r.sug_delek_nm)        fields.fuel_type     = safeStr(r.sug_delek_nm, 30);
  if (r.degem_manoa)         fields.engine_model  = safeStr(r.degem_manoa, 40);

  // Engine displacement — comes in cm³ here (nefach_manoa) and we use
  // the same unit string the rest of the app does.
  if (r.nefach_manoa && Number(r.nefach_manoa) > 0) {
    fields.engine_cc = safeNum(r.nefach_manoa) + ' סמ"ק';
  }

  // Country-of-manufacture is the strongest collector signal we have
  // here — surface it so the form/UI can highlight "רכב אספנות בריטי" etc.
  if (r.tozeret_eretz_nm) fields.country_of_origin = safeStr(r.tozeret_eretz_nm, 30);

  // Drive layout (`hanaa_nm` like "4X2" / "4X4") — keep as-is, the app
  // already handles this shape from the heavy/CME mappers.
  if (r.hanaa_nm && r.hanaa_nm !== 'לא ידוע קוד') {
    fields.drivetrain = safeStr(r.hanaa_nm, 30);
  }

  return fields;
}

/**
 * Fetch a single inactive-no-model record by exact mispar_rechev match.
 * Same exact-filter pattern as fetchCmeApi — safe for short plates
 * (4-6 digits) where the standard q=fulltext on the active datasets
 * would false-match unrelated rows.
 */
async function fetchInactiveNoModelApi(plateDigits) {
  const filters = JSON.stringify({ mispar_rechev: Number(plateDigits) });
  const url = `${API_BASE}?resource_id=${encodeURIComponent(INACTIVE_NO_MODEL_RESOURCE_ID)}&filters=${encodeURIComponent(filters)}&limit=1`;
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
 * Fetch a single inactive-with-model record by exact mispar_rechev match.
 * Same exact-filter pattern as the other inactive tiers. Schema mirrors
 * the active private-car registry (mispar_rechev, tozeret_nm, degem_cd,
 * kinuy_mishari, shnat_yitzur, tokef_dt, mivchan_acharon_dt, baalut,
 * tzeva_rechev, sug_delek_nm, ramat_gimur, ...) so the caller can run
 * mapRecord on the result without a dedicated mapper.
 */
async function fetchInactiveWithModelApi(plateDigits) {
  const filters = JSON.stringify({ mispar_rechev: Number(plateDigits) });
  const url = `${API_BASE}?resource_id=${encodeURIComponent(INACTIVE_WITH_MODEL_RESOURCE_ID)}&filters=${encodeURIComponent(filters)}&limit=1`;
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
 * Map a raw aircraft record (from the Israeli civil aviation registry,
 * resource bc00ed41) to sanitized form fields. The schema is narrower
 * than ground-vehicle registries — just manufacturer, model, year,
 * serial, MTOW. No fuel type, no test dates, no ownership history. We
 * deliberately don't fabricate values for missing fields; aviation
 * maintenance lives in CAMO systems and we don't try to replace them.
 */
function mapAircraftRecord(r) {
  const fields = {};
  if (r.Expr1)              fields.license_plate = safeStr(String(r.Expr1).toUpperCase(), 10);
  if (r.SHM_ITZRN_MTOS)     fields.manufacturer  = safeStr(r.SHM_ITZRN_MTOS, 60);
  if (r.SHM_DGM_MTOS)       fields.model         = safeStr(String(r.SHM_DGM_MTOS), 60);
  if (r.SHNT_IITZOR_MTOS)   fields.year          = safeYear(r.SHNT_IITZOR_MTOS);
  if (r.MSPR_SIDORI_MTOS)   fields.vin           = safeStr(String(r.MSPR_SIDORI_MTOS), 40);
  // FLIGHT_WEIGHT_KG = MTOW (maximum take-off weight). Some records have
  // 0 — treat as missing rather than displaying "0 kg".
  if (r.FLIGHT_WEIGHT_KG && Number(r.FLIGHT_WEIGHT_KG) > 0) {
    fields.total_weight = safeNum(r.FLIGHT_WEIGHT_KG) + ' ק"ג';
  }
  return fields;
}

/**
 * Fetch a single aircraft record from the civil aviation registry.
 * Routes the query by input shape:
 *   • Registration mark ("4X-XXX") → exact filter on Expr1
 *   • Anything else (serial number, mixed alphanumeric) → exact filter
 *     on MSPR_SIDORI_MTOS
 * Uses the datastore `filters` mechanism for exact matches; q=fulltext
 * across a small dataset would produce too many false-positives for
 * short serial fragments.
 */
async function fetchAircraftApi(plate) {
  const upper = String(plate).toUpperCase();
  const column = AIRCRAFT_PLATE_REGEX.test(upper) ? 'Expr1' : 'MSPR_SIDORI_MTOS';
  const filters = JSON.stringify({ [column]: upper });
  const url = `${API_BASE}?resource_id=${encodeURIComponent(AIRCRAFT_RESOURCE_ID)}&filters=${encodeURIComponent(filters)}&limit=1`;
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
    // Verified column name from the dataset's `fields` schema:
    // `kilometer_test_aharon` (numeric, the odometer reading at the
    // last annual test). The other names are kept as fallbacks in
    // case the dataset is ever renamed — costs nothing to check.
    const raw = record.kilometer_test_aharon
             ?? record.kilometraj_test_aharon
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

    // Verified column from the dataset's `fields` schema:
    // `baalut_dt` numeric in YYYYMM format (e.g. 201709 = Sept 2017).
    // We normalize to YYYY-MM-01 ISO so the UI's date formatter renders
    // it consistently with the rest of the form's dates. Other names
    // are kept as fallbacks against future schema drift.
    const dateOf = (r) =>
      r.baalut_dt ?? r.taarich_baalut ?? r.tarich_baalut
      ?? r.tarich_haskara ?? r.taarich_aliya ?? r.moed_baalut ?? null;

    const normalizeDate = (raw) => {
      if (raw == null) return null;
      const s = String(raw);
      // YYYYMM (6 digits) → YYYY-MM-01
      if (/^\d{6}$/.test(s)) {
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-01`;
      }
      // YYYY-MM-DD or YYYY-MM-DD HH:MM:SS → keep date portion
      return safeDate(s) || null;
    };

    // Sort chronologically (oldest first) by the raw value — works
    // regardless of whether the column is YYYYMM int or ISO string.
    const sorted = [...exact].sort((a, b) => {
      const da = String(dateOf(a) ?? '');
      const db = String(dateOf(b) ?? '');
      return da.localeCompare(db);
    });

    const history = sorted.map(r => ({
      baalut: safeStr(r.baalut || '', 30) || null,
      date:   normalizeDate(dateOf(r)),
    }));

    // "יד" counts only real owners. By Israeli used-car convention the
    // dealer (סוחר) doesn't count as a hand — the dealer holds the car
    // for resale rather than driving it, so the buyer-facing hand
    // number treats those rows as pass-through. Every other ownership
    // type (פרטי / ליסינג / השכרה / מסחרי / מונית / ...) DOES count.
    // The full history list is still returned verbatim so the
    // breakdown UI can show every episode with its real baalut tag.
    // Data.gov ownership labels aren't always a clean literal "סוחר".
    // In practice we may get variants like:
    //   "סוחר רכב", "סוחר-רכב", "סוחר/פרטי", extra spaces, punctuation, etc.
    // Business rule from PM: ANY dealer episode should not count as a hand.
    const normalizeOwnershipLabel = (value) =>
      String(value || '')
        .trim()
        .replace(/[\u0591-\u05C7]/g, '') // Hebrew niqqud/marks
        .replace(/\s+/g, ' ')
        .toLowerCase();
    const isDealerEpisode = (b) => {
      const label = normalizeOwnershipLabel(b);
      return label.includes('סוחר');
    };
    const handCount = history.filter(h => !isDealerEpisode(h.baalut)).length;

    return {
      hand:    handCount,
      history,
      current: history[history.length - 1]?.baalut || null,
    };
  } catch {
    return null;   // never throws — enrichment is best-effort
  }
}

/**
 * Map a personal-import dataset row to sanitized form fields. The
 * dataset has plenty of overlap with the standard car schema — we use
 * it as a primary record source for plates that aren't in the active
 * private-car registry (vintage personal-imports often live ONLY here).
 */
function mapPersonalImportRecord(r) {
  const fields = {};

  if (r.mispar_rechev)      fields.license_plate           = formatPlate(r.mispar_rechev);
  if (r.tozeret_nm)         fields.manufacturer            = safeStr(r.tozeret_nm, 60);
  if (r.degem_nm)           fields.model                   = safeStr(r.degem_nm, 60);
  if (r.shnat_yitzur)       fields.year                    = safeYear(r.shnat_yitzur);
  if (r.sug_delek_nm)       fields.fuel_type               = safeStr(r.sug_delek_nm, 40);
  if (r.tozeret_eretz_nm)   fields.country_of_origin       = safeStr(r.tozeret_eretz_nm, 40);
  if (r.degem_manoa)        fields.engine_model            = safeStr(r.degem_manoa, 60);
  if (r.shilda)             fields.vin                     = safeStr(String(r.shilda), 30);
  if (r.sug_rechev_nm)      fields.vehicle_class           = safeStr(r.sug_rechev_nm, 40);
  if (r.nefach_manoa && Number(r.nefach_manoa) > 0) {
    fields.engine_cc = safeNum(r.nefach_manoa) + ' סמ"ק';
  }
  if (r.mishkal_kolel && Number(r.mishkal_kolel) > 0) {
    fields.total_weight = safeNum(r.mishkal_kolel) + ' ק"ג';
  }
  if (r.tokef_dt)               fields.test_due_date           = safeDate(r.tokef_dt);
  if (r.mivchan_acharon_dt)     fields.last_test_date          = safeDate(r.mivchan_acharon_dt);
  if (r.moed_aliya_lakvish) {
    const raw = String(r.moed_aliya_lakvish);
    // moed_aliya_lakvish in this dataset can be "YYYY-MM" or "YYYY-MM-DD".
    const match = raw.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (match) {
      const [, yr, mo, dy] = match;
      const d = new Date(Number(yr), Number(mo) - 1, Number(dy || 1));
      if (!isNaN(d.getTime())) {
        fields.first_registration_date = d.toISOString().split('T')[0];
      }
    }
  }

  // Pre-flag the import status so the parallel enrichment doesn't have
  // to call the dataset a second time (we already know it's positive).
  fields.is_personal_import   = true;
  if (r.sug_yevu) {
    fields.personal_import_type = safeStr(r.sug_yevu, 30);
  }

  return fields;
}

/**
 * Fetch the raw personal-import record for a plate (or null). Used in
 * two ways:
 *   1. As a fallback PRIMARY source — when the plate isn't in the
 *      active registry but IS a personal import (vintage Mercedes etc.),
 *      we map the record to fields and treat it as the lookup result.
 *   2. As an ENRICHMENT — when the plate IS in the active registry,
 *      we still want to know it's a personal import to surface the
 *      badge. The caller in that path only reads sug_yevu.
 *
 * Exact mispar_rechev filter — never substring/fulltext, to avoid
 * matching rows where the digits happen to appear in a VIN.
 */
async function fetchPersonalImportRecord(plateDigits) {
  try {
    const filters = JSON.stringify({ mispar_rechev: Number(plateDigits) });
    const url = `${API_BASE}?resource_id=${encodeURIComponent(PERSONAL_IMPORT_RESOURCE_ID)}&filters=${encodeURIComponent(filters)}&limit=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result?.records?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Lightweight wrapper for the parallel-enrichment path. Returns just
 * the flag + type, or null. Kept for clarity at the call site.
 */
async function fetchPersonalImport(plateDigits) {
  const record = await fetchPersonalImportRecord(plateDigits);
  if (!record) return null;
  return {
    is_personal_import:   true,
    personal_import_type: safeStr(record.sug_yevu || '', 30) || 'יבוא אישי',
  };
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
 * Fetch "anecdote" market stats for private cars:
 *   - how many ACTIVE vehicles exist בישראל מאותו דגם
 *   - how many ACTIVE vehicles exist מאותו דגם + אותו צבע
 *
 * Scope is intentionally the active private-car registry only
 * (RESOURCE_ID). For motorcycles/heavy/CME datasets we skip to avoid
 * misleading counts from schema mismatch.
 */
async function fetchActiveModelAnecdote(source, record) {
  // Supported sources that can be mapped back to the active private-car
  // registry with stable model identifiers.
  const supported = source === 'car' || source === 'inactive' || source === 'personal_import';
  if (!supported) return null;

  const tozeretCd = Number(record?.tozeret_cd);
  const degemCd = Number(record?.degem_cd);
  if (!Number.isFinite(tozeretCd) || !Number.isFinite(degemCd) || tozeretCd <= 0 || degemCd <= 0) {
    return null;
  }

  const modelFilters = { tozeret_cd: tozeretCd, degem_cd: degemCd };
  const colorRaw = safeStr(record?.tzeva_rechev || '', 30) || null;

  const fetchCount = async (filters) => {
    const url = `${API_BASE}?resource_id=${encodeURIComponent(RESOURCE_ID)}&filters=${encodeURIComponent(JSON.stringify(filters))}&limit=0`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return null;
      const json = await res.json();
      const total = Number(json?.result?.total);
      return Number.isFinite(total) && total >= 0 ? total : null;
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  };

  // Ownership-mix breakdown — same model, split by baalut. We only
  // probe the four most common values in the registry (private/leasing/
  // rental/commercial); anything else is too rare to be useful as a
  // percentage and would just inflate API load. All 6 calls fire in
  // parallel, all best-effort. If any fails we degrade gracefully —
  // the breakdown is informational, never load-bearing.
  const BAALUT_BREAKDOWN_KEYS = ['פרטי', 'ליסינג', 'השכרה', 'מסחרי'];

  const [sameModelCount, sameModelColorCount, ...baalutCounts] = await Promise.all([
    fetchCount(modelFilters),
    colorRaw ? fetchCount({ ...modelFilters, tzeva_rechev: colorRaw }) : Promise.resolve(null),
    ...BAALUT_BREAKDOWN_KEYS.map(b => fetchCount({ ...modelFilters, baalut: b })),
  ]);

  if (!Number.isFinite(sameModelCount) && !Number.isFinite(sameModelColorCount)) return null;

  // Build breakdown only when we have a reliable total to divide by AND
  // at least one band landed. Skip the percentage rounding when total
  // is too small to be meaningful (<100) — at low N the % swings wildly
  // and looks like noise.
  let ownership_distribution = null;
  if (Number.isFinite(sameModelCount) && sameModelCount >= 100) {
    const entries = BAALUT_BREAKDOWN_KEYS
      .map((label, i) => ({ label, count: Number(baalutCounts[i]) }))
      .filter(e => Number.isFinite(e.count) && e.count > 0)
      .map(e => ({ label: e.label, count: e.count, percent: Math.round((e.count / sameModelCount) * 100) }))
      .filter(e => e.percent >= 1)
      .sort((a, b) => b.count - a.count);
    if (entries.length > 0) ownership_distribution = entries;
  }

  return {
    active_same_model_count: Number.isFinite(sameModelCount) ? sameModelCount : null,
    active_same_model_color_count: Number.isFinite(sameModelColorCount) ? sameModelColorCount : null,
    active_same_model_color_name: colorRaw,
    ownership_distribution,
  };
}

/**
 * Open-recall lookup. Best-effort: never throws, returns null on any
 * failure or empty result so the parent lookup can keep going. We do
 * an exact filter on MISPAR_RECHEV (the dataset uses an uppercase
 * field name) and ask for up to 10 rows — a single plate can have
 * multiple recalls open if the manufacturer issued several over time.
 *
 * Returns an array of { id, type, defectType, description, openedDate }
 * or null when the plate has no open recalls (or the call failed).
 */
async function fetchOpenRecalls(plateDigits) {
  try {
    const filters = JSON.stringify({ MISPAR_RECHEV: Number(plateDigits) });
    const url = `${API_BASE}?resource_id=${encodeURIComponent(OPEN_RECALL_RESOURCE_ID)}&filters=${encodeURIComponent(filters)}&limit=10`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const json = await res.json();
    const records = json?.result?.records;
    if (!Array.isArray(records) || records.length === 0) return null;
    const mapped = records.map(r => ({
      id:           r.RECALL_ID != null ? String(r.RECALL_ID) : null,
      type:         safeStr(r.SUG_RECALL, 60),
      defectType:   safeStr(r.SUG_TAKALA, 60),
      description:  safeStr(r.TEUR_TAKALA, 400),
      openedDate:   safeDate(r.TAARICH_PTICHA),
    }));
    // Enrich each recall with the campaign catalog (fix method + importer
    // contact) by RECALL_ID. Best-effort and parallel — a failed/missing
    // campaign row just leaves the actionable fields undefined.
    const enriched = await Promise.all(mapped.map(async (rec) => {
      if (!rec.id) return rec;
      const campaign = await fetchRecallCampaign(rec.id);
      return campaign ? { ...rec, ...campaign } : rec;
    }));
    return enriched;
  } catch {
    return null;
  }
}

/**
 * Fetch the actionable details for a recall campaign by RECALL_ID from the
 * master "Recall" catalog. Returns { fixMethod, importer, phone, website }
 * or null. Best-effort — never throws.
 */
async function fetchRecallCampaign(recallId) {
  try {
    const filters = JSON.stringify({ RECALL_ID: Number(recallId) });
    const url = `${API_BASE}?resource_id=${encodeURIComponent(RECALL_CAMPAIGN_RESOURCE_ID)}&filters=${encodeURIComponent(filters)}&limit=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const json = await res.json();
    const r = json?.result?.records?.[0];
    if (!r) return null;
    return {
      fixMethod: safeStr(r.OFEN_TIKUN, 60),
      importer:  safeStr(r.YEVUAN_TEUR, 80),
      phone:     safeStr(r.TELEPHONE, 40),
      website:   safeStr(r.WEBSITE, 200),
      // Matching/validity context: which model + production-year range the
      // recall campaign covers, and when it was issued. Lets the UI show the
      // buyer this recall really applies to their vehicle (the per-plate
      // dataset already guarantees it; the model/years build trust) and that
      // it's still open (recalls don't expire — they only get fulfilled).
      campaignModel:        safeStr(r.DEGEM, 40),
      campaignManufacturer: safeStr(r.TOZAR_TEUR, 40),
      recallYear:           safeYear(r.SHNAT_RECALL),
      buildFrom:            String(r.BUILD_BEGIN_A || '').slice(0, 4),
      buildTo:              String(r.BUILD_END_A || '').slice(0, 4),
    };
  } catch {
    return null;
  }
}

/**
 * Public helper — open recalls for a saved vehicle's plate, enriched with
 * campaign contact info. Used by the vehicle screen's RecallCard (the
 * recall data isn't persisted on the vehicle, so it's fetched on demand,
 * best-effort). Returns an array of recalls or null (no recall / failed).
 */
export async function fetchOpenRecallsForPlate(plate) {
  const clean = String(plate || '').replace(/\D/g, '');
  if (clean.length < 4 || clean.length > 8) return null;
  try {
    return await fetchOpenRecalls(clean);
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

// Hebrew labels for each detected vehicle type. Shared by the single-
// match finalizer and the short-plate multi-match decorator so both
// paths label a vehicle identically.
const TYPE_LABELS = {
  motorcycle: 'אופנוע / דו-גלגלי',
  car:        'רכב פרטי',
  commercial: 'רכב מסחרי',
  truck:      'משאית',
  bus:        'אוטובוס',
  trailer:    'גרור',
  cme:        'כלי צמ"ה',
  collector:  'רכב אספנות',
};

// Derive the detected vehicle type from the raw record + which registry
// it came from. Extracted so the single-match finalizer and the short-
// plate multi-match picker decorator stay in lockstep.
function computeDetectedType(source, record) {
  if (source === 'cme' || source === 'inactive_classic') {
    return detectCollectorType(record, source);
  }
  if (source === 'moto') return 'motorcycle';
  if (source === 'heavy') {
    // Heavy dataset uses tkina_EU instead of sug_degem.
    const tk = String(record.tkina_EU || '').toUpperCase();
    if (tk.startsWith('O')) return 'trailer';
    if (tk === 'M2' || tk === 'M3') return 'bus';
    return 'truck';
  }
  if (source === 'personal_import') return 'car';
  // Private-car / inactive datasets share a schema; sug_degem classifies.
  const sugDegem = String(record.sug_degem || '').toUpperCase();
  if (sugDegem === 'K') return 'truck';
  if (sugDegem === 'A') return 'bus';
  if (sugDegem === 'T') return 'trailer';
  if (sugDegem === 'M') return 'commercial';
  return 'car';
}

// Map a raw record to sanitized fields using the mapper that matches its
// registry. Mirrors the single-match switch inside lookupVehicleByPlate.
function mapBySource(source, record) {
  return source === 'cme'              ? mapCmeRecord(record)
       : source === 'moto'             ? mapMotoRecord(record)
       : source === 'heavy'            ? mapHeavyRecord(record)
       : source === 'inactive_classic' ? mapInactiveNoModelRecord(record)
       : mapRecord(record);
}

// Build a fully-decorated candidate (mapped fields + detected type +
// label) for the short-plate multi-match picker. Enrichment is
// deliberately skipped for picker candidates — only one will be kept,
// and the caller re-runs the lookup after the user chooses.
function decorateShortMatch(source, record) {
  const fields = mapBySource(source, record);
  const dt = computeDetectedType(source, record);
  fields._detectedType = dt;
  fields._detectedTypeLabel = TYPE_LABELS[dt] || 'רכב';
  delete fields._tozeret_cd;
  delete fields._degem_cd;
  return fields;
}

/**
 * Looks up a vehicle by its Israeli license plate number.
 * Tries the car API first, then the motorcycle API if not found.
 * Returns registration data + detailed tech specs merged together.
 */
export async function lookupVehicleByPlate(plate) {
  const clean = validatePlateInput(plate);

  // Aircraft fast path — registration marks (4X-XXX) live in a single,
  // disjoint dataset and can't legitimately collide with ground-vehicle
  // plate digits, so we route them straight to the aviation tier and
  // skip the whole digit-cascade. Pattern check happens via
  // validatePlateInput which already returned the uppercased mark for
  // aircraft plates.
  if (isAircraftPlate(clean)) {
    const aircraftRecords = await fetchAircraftApi(clean);
    if (!aircraftRecords) return null;
    const fields = mapAircraftRecord(aircraftRecords[0]);
    fields._detectedType = 'aircraft';
    fields._detectedTypeLabel = 'כלי טיס';
    return fields;
  }

  // Source priority — chosen by plate length so we don't fuzz-match
  // short CME numbers against the road-vehicle datasets:
  //
  //   • 4-6 digits → inactive-no-model FIRST, then CME. Both use
  //     exact-match `filters` so they're safe to query for short plates
  //     (no fulltext false-positives). The inactive-no-model registry
  //     is where collector cars with vintage 4-6 digit plates actually
  //     live (e.g. Triumph Herald 229080) — checking it first means a
  //     real classic car wins over a same-digits namespace collision
  //     against CME (e.g. SCHMIDT street sweeper mispar_tzama=229080).
  //
  //   • 7-8 digits → Standard cascade: car → moto → heavy → cme →
  //     inactive-no-model → inactive (off-road, with-degem). The
  //     two inactive tiers are tried LAST so a plate that's still
  //     active never hits a stale cancelled record by accident.
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

  // Short plates (4-6 digits) can legitimately live in FOUR registries:
  //   • inactive-no-model (classic collectors) — exact-match filter
  //   • CME / construction machinery (mispar_tzama) — exact-match filter
  //   • motorcycles (vintage two-wheelers, e.g. Norton plate 445287)
  //   • heavy (vintage cars filed as heavy, e.g. 1970 VW plate 275182)
  // The road-vehicle datasets (moto/heavy) are fulltext-only, so we
  // exact-match mispar_rechev afterwards to stop a short number from
  // fuzz-matching a VIN/engine field. Probe all four in PARALLEL and
  // collect every EXACT hit: one hit → use it (flows through the normal
  // single-match path below); 2+ hits → the digits collide across
  // registries (real case: 229080 = Triumph Herald classic + SCHMIDT
  // sweeper CME) so we return all candidates and let the UI ask.
  //
  // PREVIOUS BUG: only classic + CME were probed for short plates, so a
  // vintage motorcycle or heavy/collector car with a 4-6 digit plate
  // returned "not found" even though gov.il has it (user report:
  // plate 275182 = 1970 VW, 2026-06-01).
  if (!records && isShort) {
    const [classicRes, cmeRes, motoRes, heavyRes] = await Promise.all([
      fetchInactiveNoModelApi(clean).catch(() => null),
      fetchCmeApi(clean).catch(() => null),
      fetchGovApi(MOTO_RESOURCE_ID, clean).catch(() => null),
      fetchGovApi(HEAVY_RESOURCE_ID, clean).catch(() => null),
    ]);
    const exactByRechev = (recs) =>
      (recs || []).find(r => String(r.mispar_rechev).replace(/\D/g, '') === clean) || null;
    const candidates = [];
    if (classicRes) candidates.push({ source: 'inactive_classic', record: classicRes[0] });
    if (cmeRes)     candidates.push({ source: 'cme',              record: cmeRes[0] });
    const motoRec = exactByRechev(motoRes);
    if (motoRec)    candidates.push({ source: 'moto',  record: motoRec });
    const heavyRec = exactByRechev(heavyRes);
    if (heavyRec)   candidates.push({ source: 'heavy', record: heavyRec });

    if (candidates.length === 1) {
      // Single registry hit — feed it into the normal single-match path
      // (mapper switch + enrichment + detectedType all run below).
      records = [candidates[0].record];
      source = candidates[0].source;
    } else if (candidates.length >= 2) {
      // Digits exist in 2+ registries → we can't know which vehicle the
      // user means. Return all as candidates; the UI renders the picker.
      // Enrichment is skipped (see decorateShortMatch) — only one is kept.
      return {
        _multipleMatches: true,
        plate: clean,
        matches: candidates.map(c => ({
          source: c.source,
          fields: decorateShortMatch(c.source, c.record),
        })),
      };
    }
  }
  // For NORMAL plates (7-8 digits), inactive-with-model is the biggest
  // and most common "lapsed test" bucket (584K records vs the 1.16M of
  // the cancelled-only inactive registry). Probe it BEFORE CME / cancelled
  // so a user who looks up a vehicle whose test expired 1-2 years ago
  // (very common case) hits the right record on the first non-active try.
  if (!records && !isShort) {
    records = await fetchInactiveWithModelApi(clean);
    if (records) source = 'inactive_with_model';
  }
  if (!records && !isShort) {
    records = await fetchInactiveNoModelApi(clean);
    if (records) source = 'inactive_classic';
  }
  if (!records && !isShort) {
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
  // Historical "ירדו מהכביש / ביטול סופי" archives (2010-2016, then
  // 2000-2009). A vehicle finally cancelled in those periods lives ONLY
  // here, not in the current cancelled registry above — without these
  // tiers ~1.17M cancelled vehicles return "not found". Same schema +
  // `bitul_dt`, so source='inactive' reuses the existing _isInactive +
  // _cancellationDate handling and the AddVehicle off-road warning.
  if (!records && !isShort) {
    records = await fetchGovApi(INACTIVE_2010_2016_RESOURCE_ID, clean);
    if (records) source = 'inactive';
  }
  if (!records && !isShort) {
    records = await fetchGovApi(INACTIVE_2000_2009_RESOURCE_ID, clean);
    if (records) source = 'inactive';
  }

  // Final fallback — the personal-import registry. Plates of
  // privately-imported cars (often older Mercedes / BMW / etc.) live
  // ONLY here; without this tier they'd return "not found" even
  // though the gov knows about them. Tried for any plate length.
  let personalImportRecordRaw = null;
  if (!records) {
    personalImportRecordRaw = await fetchPersonalImportRecord(clean);
    if (personalImportRecordRaw) source = 'personal_import';
  }

  if (!records && !personalImportRecordRaw) return null;

  // CME records key on mispar_tzama, all other tiers on mispar_rechev.
  let record;
  if (source === 'personal_import') {
    record = personalImportRecordRaw;
  } else {
    const plateField = source === 'cme' ? 'mispar_tzama' : 'mispar_rechev';
    const exact = records.find(
      r => String(r[plateField]).replace(/\D/g, '') === clean
    );
    record = exact ?? records[0];
  }

  // Pick the matching mapper. The `inactive` (cancelled, has bitul_dt)
  // and `inactive_with_model` (test expired, no bitul_dt) datasets both
  // use the same private-car schema, so mapRecord is reused; the
  // cancellation date is appended after for `inactive`. `inactive_classic`
  // is the no-degem dataset (collectors etc.) with a trimmed schema.
  const fields = source === 'moto'             ? mapMotoRecord(record)
              : source === 'heavy'            ? mapHeavyRecord(record)
              : source === 'cme'              ? mapCmeRecord(record)
              : source === 'inactive_classic' ? mapInactiveNoModelRecord(record)
              : source === 'personal_import'  ? mapPersonalImportRecord(record)
              : mapRecord(record); // 'car' OR 'inactive' OR 'inactive_with_model'

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
  // inactive_with_model — test expired but NOT formally cancelled. Same
  // _isInactive flag so the same warning toast fires; the AddVehicle
  // copy branches on _cancellationDate presence to pick the right
  // wording ("ביטול סופי" vs "טסט פג לפני יותר משנה").
  if (source === 'inactive_with_model') {
    fields._isInactive = true;
  }
  // inactive_classic — same "off-road" status. The dataset is older
  // private cars / classic cars without a model code, expired >13 months
  // back. Flag _isInactive so the warning toast fires; vintage owners
  // see "אספנות" in the category selector and are expected to confirm.
  if (source === 'inactive_classic') {
    fields._isInactive = true;
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
    // Skip when personal_import is already the primary source — we
     // already have those fields. Skip CME (different plate namespace).
    (source !== 'cme' && source !== 'personal_import')
      ? fetchPersonalImport(clean)
      : Promise.resolve(null),
    fetchActiveModelAnecdote(source, record),
    // Open-recall lookup — same MISPAR_RECHEV namespace as cars, motos,
    // heavies, and inactives. CME plates are a different namespace
    // (mispar_tzama) so we skip; personal-import plates ARE in the
    // car namespace so they're included.
    (source !== 'cme') ? fetchOpenRecalls(clean) : Promise.resolve(null),
  ]);
  const [specs, lastTestKm, ownership, personalImport, modelAnecdote, openRecalls] = enrichments;

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
  // Personal-import flag — informational only. Whether the plate
  // appears in the dedicated registry → boolean + a short label
  // (e.g. "יבוא אישי-משומש"). Surfaced as a badge in VehicleDetail
  // alongside the vintage chip; no business logic depends on it.
  if (personalImport) {
    fields.is_personal_import   = true;
    fields.personal_import_type = personalImport.personal_import_type;
  }
  // Open recalls — actionable warning for buyers. Surface BOTH the
  // count (drives the insight tone) and the array of full records (so
  // the UI can show the actual defect descriptions, not just a count).
  if (Array.isArray(openRecalls) && openRecalls.length > 0) {
    fields.open_recalls       = openRecalls;
    fields.open_recalls_count = openRecalls.length;
  }

  // Friendly "market context" anecdote for Vehicle Quick Check:
  // active vehicles בישראל with the same model (+ same color). Best-effort.
  if (modelAnecdote) {
    if (Number.isFinite(modelAnecdote.active_same_model_count)) {
      fields.active_same_model_count = modelAnecdote.active_same_model_count;
    }
    if (Number.isFinite(modelAnecdote.active_same_model_color_count)) {
      fields.active_same_model_color_count = modelAnecdote.active_same_model_color_count;
    }
    if (modelAnecdote.active_same_model_color_name) {
      fields.active_same_model_color_name = modelAnecdote.active_same_model_color_name;
    }
    if (Array.isArray(modelAnecdote.ownership_distribution) && modelAnecdote.ownership_distribution.length) {
      fields.ownership_distribution = modelAnecdote.ownership_distribution;
    }
  }

  // Remove internal fields
  delete fields._tozeret_cd;
  delete fields._degem_cd;

  // Expose the detected type so callers can warn the user when the
  // selected category doesn't match what the Ministry of Transport says.
  // computeDetectedType is the single source of truth (shared with the
  // short-plate multi-match decorator) — see its definition above.
  const detectedType = computeDetectedType(source, record);
  fields._detectedType = detectedType;
  fields._detectedTypeLabel = TYPE_LABELS[detectedType] || 'רכב';

  return fields;
}

/**
 * authorizedGarages — fetches the Israeli Ministry of Transport's official
 * registry of licensed garages from data.gov.il and matches local POIs
 * (from OSM/Overpass) against it.
 *
 * Source dataset:
 *   https://data.gov.il/dataset/automotor/resource/bb68386a-a331-4bbc-b668-bba2766d517d
 *   "מוסכים ומכוני רישוי" — refreshed daily by the ministry.
 *
 * Storage strategy:
 *   - Single fetch on demand (~5MB raw → ~500KB after dedupe + field-strip).
 *   - localStorage cache keyed by version, TTL 7 days. Registry doesn't
 *     churn on a daily-relevant scale — a week-old copy is still
 *     authoritative for the "is this garage licensed" question.
 *   - Bump CACHE_VERSION when the response shape we depend on changes.
 *
 * Matching strategy (highest confidence first):
 *   1. Phone number — strip everything except digits, drop leading
 *      0 or 972 country code. Phones are unique within the registry,
 *      so a phone hit is a confident match.
 *   2. Name + city — normalize both sides (strip "מוסך"/"בע״מ"/punctuation,
 *      lowercase) and check substring containment in either direction
 *      within the same city. Catches "מוסך נירים" (OSM) ↔
 *      "נירים מוסך הקבוץ" (registry).
 *
 * Three return states:
 *   'authorized'   — matched a record in the registry.
 *   'unauthorized' — has at least one usable signal (phone OR city+name)
 *                    but failed to match.
 *   'unknown'      — no signal at all (no phone, no city). Hidden from
 *                    the "filter to unauthorized" view by default.
 */

// Resource id is stable per dataset; bump CACHE_VERSION if the script
// is updated to depend on a new response field (currently uses
// shem_mosah / yishuv / telephone / cod_sug_mosah / mispar_mosah).
const RESOURCE_ID    = 'bb68386a-a331-4bbc-b668-bba2766d517d';
const CACHE_KEY      = 'fg_auth_garages_v1';
const CACHE_TTL_MS   = 7 * 24 * 60 * 60 * 1000;   // 7 days
const FETCH_LIMIT    = 32000;                      // dataset is ~14k rows

// In-flight singleton — multiple components on the page mount at the
// same time and would otherwise spawn parallel fetches. The promise is
// resolved once the data is in memory; later callers get it instantly.
let inFlight = null;
let inMemory = null;

// Strip everything except digits, then drop leading 0 or 972 country
// code so "054-7916219", "0547916219", "+972547916219" all collapse to
// "547916219". The registry phones are stored with mixed formatting,
// so this normalization is required on both sides before comparing.
export function normalizePhone(p) {
  if (!p) return '';
  const digits = String(p).replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('972')) return digits.slice(3);
  if (digits.startsWith('0'))   return digits.slice(1);
  return digits;
}

// Word-set normalization: lowercase, strip punctuation/hyphens/quotes,
// drop common Hebrew filler tokens that appear in business names but
// don't carry identity ("מוסך", "בעמ", "בע״מ", etc.). Returns the
// original string trimmed and lowercased — kept as a single phrase
// rather than tokens, because substring matching on the whole phrase
// is more robust than token-set comparison for short business names.
const NAME_NOISE = [
  /מוסך/g,
  /\bבע[״"']?מ\b/g,
  /\bבעמ\b/g,
  /[״"',.\-_]/g,
  /\s+/g,
];
export function normalizeName(s) {
  if (!s) return '';
  let out = String(s).toLowerCase();
  for (const re of NAME_NOISE) out = out.replace(re, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

// City normalization is a thinner operation — drop punctuation and
// common abbreviations like "ת״א" → "תל אביב". The registry uses full
// names ("תל אביב יפו"), OSM often uses the shortened variant.
const CITY_ALIASES = new Map([
  ['ת"א',     'תל אביב'],
  ['ת״א',     'תל אביב'],
  ['תא',      'תל אביב'],
  ['ת״א-יפו', 'תל אביב'],
  ['תל אביב-יפו', 'תל אביב'],
  ['תל-אביב', 'תל אביב'],
  ['ראשל"צ',  'ראשון לציון'],
  ['ראשל״צ',  'ראשון לציון'],
  ['ראשון',   'ראשון לציון'],
  ['פ"ת',     'פתח תקווה'],
  ['פ״ת',     'פתח תקווה'],
  ['פ"ת',     'פתח תקווה'],
  ['ק"ש',     'קרית שמונה'],
  ['ק״ש',     'קרית שמונה'],
]);
export function normalizeCity(s) {
  if (!s) return '';
  const cleaned = String(s).replace(/[״"',.\-_]/g, ' ').replace(/\s+/g, ' ').trim();
  return CITY_ALIASES.get(cleaned) || cleaned;
}

// Try to extract the city from the OSM "address" string we already
// build in FindGarage (street + housenumber + city). The city is the
// last word group; this is a heuristic but works well enough for
// matching against the registry's tidy `yishuv` field.
export function extractCity(address) {
  if (!address) return '';
  // The address is composed as `${street} ${housenumber} ${city}`.
  // The city tends to come last, possibly multi-word ("רמת גן").
  // Take the last 2 words and try them; the matcher will pick the
  // one that maps to a known city in the registry.
  const parts = String(address).trim().split(/\s+/);
  if (parts.length === 0) return '';
  // Single word → it IS the city in most cases.
  if (parts.length === 1) return normalizeCity(parts[0]);
  // Try "last two" (e.g. "רמת גן") then fall back to "last one".
  return normalizeCity(parts.slice(-2).join(' '));
}

// Read cached registry from localStorage. Returns null if missing,
// expired, or malformed (so the caller falls back to network).
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { savedAt, data } = JSON.parse(raw);
    if (!data || !Array.isArray(data)) return null;
    if (Date.now() - savedAt > CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch { /* quota / private mode — non-fatal */ }
}

// Compress the registry to the fields we use, dedupe by mispar_mosah
// (each garage appears once per profession). Drops ~3x of bulk so the
// cache fits comfortably in localStorage.
function compress(records) {
  const seen = new Map();
  for (const r of records) {
    const id = r.mispar_mosah;
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      name:  r.shem_mosah || '',
      city:  r.yishuv     || '',
      phone: r.telephone  || '',
      sug:   r.sug_mosah  || '',
    });
  }
  return Array.from(seen.values());
}

// Build O(1) lookup indexes once and reuse for every match call.
// Phone index → exact normalized-digits lookup.
// City index  → list of {name,id} per normalized city, scanned by
//               substring containment (registry ~5k rows total, each
//               city has at most a few dozen — fast enough at scan time).
function buildIndexes(records) {
  const byPhone = new Map();
  const byCity  = new Map();
  for (const r of records) {
    const ph = normalizePhone(r.phone);
    if (ph) byPhone.set(ph, r);
    const city = normalizeCity(r.city);
    if (city) {
      const arr = byCity.get(city);
      const entry = { id: r.id, name: normalizeName(r.name), record: r };
      if (arr) arr.push(entry); else byCity.set(city, [entry]);
    }
  }
  return { byPhone, byCity };
}

// Fetch the dataset once and return a registry object with indexes
// attached. Singleton — concurrent callers receive the same promise.
async function loadRegistry() {
  if (inMemory) return inMemory;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    // Fast path: warm cache.
    const cached = readCache();
    if (cached) {
      inMemory = { records: cached, ...buildIndexes(cached) };
      return inMemory;
    }

    // Slow path: network. The dataset endpoint accepts a single large
    // limit (>=32000) and returns the full set in one shot, so we
    // skip pagination overhead.
    const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${RESOURCE_ID}&limit=${FETCH_LIMIT}`;
    let records;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = await res.json();
      const raw = json?.result?.records || [];
      records = compress(raw);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('authorizedGarages: registry fetch failed:', err?.message);
      // Soft-fail: empty registry → matcher returns 'unknown' for
      // every input. The caller should hide the filter chip when
      // registry.records.length === 0.
      records = [];
    }
    writeCache(records);
    inMemory = { records, ...buildIndexes(records) };
    return inMemory;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * matchGarage — given a POI from OSM, return one of:
 *   'authorized'   — matched a registry record by phone or name+city.
 *   'unauthorized' — searchable signal exists but no match found.
 *   'unknown'      — no usable signal (no phone, no city in address).
 *
 * @param {Object} g                   — garage row from FindGarage
 * @param {string} g.name              — display name from OSM tags
 * @param {string} [g.phone]           — phone if present
 * @param {string} [g.address]         — street+house+city joined
 * @param {Object} registry            — { byPhone, byCity } from loadRegistry()
 * @returns { status, record? }
 */
export function matchGarage(g, registry) {
  if (!registry || !registry.byPhone) return { status: 'unknown' };

  // 1. Phone match — most confident signal.
  const ph = normalizePhone(g.phone);
  if (ph) {
    const hit = registry.byPhone.get(ph);
    if (hit) return { status: 'authorized', record: hit };
  }

  // 2. Name + city match. We need the OSM address to expose a city
  // we can normalize against the registry's `yishuv`. If the address
  // is missing or the city doesn't appear in the registry at all,
  // the caller can't tell whether the garage is genuinely unlisted
  // or just unmatchable; we mark those 'unknown' to keep the filter
  // honest.
  const city = extractCity(g.address);
  const cityHits = city ? registry.byCity.get(city) : null;
  if (cityHits && cityHits.length > 0) {
    const myName = normalizeName(g.name);
    if (myName) {
      // Bidirectional substring check. "נירים" matches
      // "נירים הקבוץ" and vice versa, after both sides have had
      // "מוסך" / "בע״מ" / punctuation stripped.
      for (const e of cityHits) {
        if (e.name.includes(myName) || myName.includes(e.name)) {
          return { status: 'authorized', record: e.record };
        }
      }
    }
    // City is in the registry but no name match → we trust the
    // negative answer enough to call it 'unauthorized'.
    return { status: 'unauthorized' };
  }

  // No city in registry / no usable city in OSM → can't determine.
  // If we DID have a phone but no match, that's an unauthorized
  // signal — phone is unique across the registry.
  if (ph) return { status: 'unauthorized' };
  return { status: 'unknown' };
}

/**
 * Public entrypoint: load the registry (cached or fresh) and return
 * a self-contained matcher. Components call this once, then call
 * `match(g)` per garage row. Resolves to a stable shape even when
 * the network is offline (matcher just returns 'unknown' for all).
 *
 * @returns Promise<{
 *   loaded: boolean,             // true if registry has any records
 *   recordCount: number,
 *   match: (garage) => { status, record? },
 * }>
 */
export async function getAuthorizedGarageMatcher() {
  const reg = await loadRegistry();
  return {
    loaded:      reg.records.length > 0,
    recordCount: reg.records.length,
    match:       (g) => matchGarage(g, reg),
  };
}

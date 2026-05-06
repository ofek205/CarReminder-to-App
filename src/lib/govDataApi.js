// data.gov.il CKAN client — Israeli streets & localities dataset.
//
// Resource: 9ad3862c-8391-4b2f-84a4-2d4c68625f4b
// Schema: { _id, סמל_ישוב, שם_ישוב, סמל_רחוב, שם_רחוב }
// Convention: סמל_רחוב = 9000 marks a "city-only" row (no street).
// Names in the DB sometimes have trailing whitespace — we always trim.
//
// Strategy:
//   • Cities — one fetch on first use (~1,300 rows, ~100 KB), filtered
//     server-side by `סמל_רחוב = 9000`. Cached in localStorage 7 days
//     (the dataset updates weekly).
//   • Streets — per-city fetch by city code (numeric, no whitespace
//     issues), cached per code 7 days.
//   • Errors → return null. The UI falls back to free-text input
//     and the existing hardcoded ISRAEL_CITIES list.

const API_BASE = 'https://data.gov.il/api/3/action/datastore_search';
const RESOURCE_ID = '9ad3862c-8391-4b2f-84a4-2d4c68625f4b';

const CACHE_PREFIX = 'gov-il-streets-v1:';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REQUEST_TIMEOUT_MS = 6000;

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ savedAt: Date.now(), data })
    );
  } catch {
    /* private mode / quota — silently no-op */
  }
}

// Single in-flight promise per cache key, so concurrent callers don't
// fan out into duplicate network requests on first use.
const inflight = new Map();

async function timedFetch(url, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Forward an external signal if the caller passed one (component unmount).
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || json.success !== true) throw new Error('api_failure');
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch all distinct Israeli cities.
 * Returns [{ code: number, name: string }, ...] sorted Hebrew alphabetical,
 * or null on failure.
 */
export async function fetchCities({ signal } = {}) {
  const cacheKey = 'cities';
  const cached = readCache(cacheKey);
  if (cached) return cached;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const params = new URLSearchParams({
    resource_id: RESOURCE_ID,
    filters: JSON.stringify({ 'סמל_רחוב': 9000 }),
    limit: '2000',
    // We don't pass `fields` because some CKAN deployments reject the
    // Hebrew column names in that param. The full row is small.
  });
  const url = `${API_BASE}?${params.toString()}`;

  const promise = (async () => {
    try {
      const result = await timedFetch(url, signal);
      const records = result?.records || [];
      const cities = records
        .map((r) => ({
          code: Number(r['סמל_ישוב']),
          name: String(r['שם_ישוב'] || '').trim(),
        }))
        .filter((c) => Number.isFinite(c.code) && c.name)
        // Some cities appear with multiple variants (different codes for
        // shevet / district subdivisions). Dedupe by name keeping the
        // smallest code; that's the "main" municipal entry.
        .reduce((acc, c) => {
          const prev = acc.get(c.name);
          if (!prev || c.code < prev.code) acc.set(c.name, c);
          return acc;
        }, new Map());
      const list = [...cities.values()].sort((a, b) =>
        a.name.localeCompare(b.name, 'he')
      );
      writeCache(cacheKey, list);
      return list;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('govDataApi fetchCities failed:', err?.message || err);
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

/**
 * Fetch all distinct streets for a given city, by numeric city code.
 * Returns [string, ...] sorted Hebrew alphabetical, or null on failure.
 * Empty array if the city has no streets in the dataset (small yishuv).
 */
export async function fetchStreetsByCityCode(cityCode, { signal } = {}) {
  if (!Number.isFinite(cityCode)) return [];
  const cacheKey = `streets:${cityCode}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const params = new URLSearchParams({
    resource_id: RESOURCE_ID,
    filters: JSON.stringify({ 'סמל_ישוב': cityCode }),
    limit: '5000',
  });
  const url = `${API_BASE}?${params.toString()}`;

  const promise = (async () => {
    try {
      const result = await timedFetch(url, signal);
      const records = result?.records || [];
      const streets = records
        .filter((r) => Number(r['סמל_רחוב']) !== 9000) // skip the city-only row
        .map((r) => String(r['שם_רחוב'] || '').trim())
        .filter(Boolean);
      // Dedupe + sort.
      const list = [...new Set(streets)].sort((a, b) =>
        a.localeCompare(b, 'he')
      );
      writeCache(cacheKey, list);
      return list;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('govDataApi fetchStreets failed:', err?.message || err);
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

/**
 * Find the city object (with code) by display name. Trim-tolerant.
 * Returns null if not loaded yet or not found — caller decides whether
 * to wait for cities or fall back.
 */
export async function findCityByName(name, { signal } = {}) {
  if (!name) return null;
  const trimmed = String(name).trim();
  const cities = await fetchCities({ signal });
  if (!cities) return null;
  return cities.find((c) => c.name === trimmed) || null;
}

// Exported for tests / debugging.
export const __INTERNAL = { CACHE_PREFIX, CACHE_TTL_MS, RESOURCE_ID };

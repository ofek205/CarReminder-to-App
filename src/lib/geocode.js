// Nominatim (OpenStreetMap) one-shot geocoder. Israel-only by default.
//
// Nominatim's usage policy caps requests at ~1 per second per IP, so this
// helper is intended for user-triggered calls ("בדוק כתובת" buttons or
// submit-time validation), NOT keystroke-driven geocoding.
//
// In-memory cache keyed by the trimmed query string keeps repeated checks
// of the same address from re-hitting the API in the same session.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const cache = new Map();

/**
 * @param {string} query — free-text address.
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.countryCode='il']
 * @returns {Promise<{latitude: number, longitude: number, displayName: string} | null>}
 *   `null` when the address can't be resolved or the request fails.
 */
export async function geocodeAddress(query, opts = {}) {
  const q = (query || '').trim();
  if (!q) return null;

  const { signal, countryCode = 'il' } = opts;
  const key = `${countryCode}:${q}`;
  if (cache.has(key)) return cache.get(key);

  const params = new URLSearchParams({
    q: countryCode === 'il' ? `${q} ישראל` : q,
    format: 'json',
    limit: '1',
    countrycodes: countryCode,
  });
  const url = `${NOMINATIM_URL}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'he' },
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const result = {
      latitude: lat,
      longitude: lon,
      displayName: data[0].display_name || q,
    };
    cache.set(key, result);
    return result;
  } catch {
    // Network error, abort, JSON parse — caller treats as "couldn't resolve".
    return null;
  }
}

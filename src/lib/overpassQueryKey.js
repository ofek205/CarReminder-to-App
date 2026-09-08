/**
 * overpassQueryKey — makes an Overpass "what's near me" question
 * cache-shareable between users without changing what any one user sees.
 *
 * WHY THIS EXISTS
 *   `curl https://overpass-api.de/api/status` reports `Rate limit: 2` — two
 *   concurrent query slots per IP. Every Overpass call from this app goes out
 *   through the overpass-proxy Edge Function, i.e. from the shared Supabase
 *   egress IP, so all users of "מצא מוסך" compete for those two slots
 *   globally. The fix is a shared server-side cache (public.overpass_cache),
 *   and that cache is keyed by the query text itself.
 *
 *   Which means raw GPS coordinates would make it useless. Two users 80m
 *   apart, or one user whose GPS drifted between two mounts, would produce
 *   different query strings, different cache rows, and separate upstream
 *   calls. A cache that never hits is not a cache; with a two-slot ceiling
 *   it is the outage.
 *
 * THE APPROACH
 *   Ask a coarser question than the user asked, then narrow the answer
 *   locally:
 *     1. Snap the search centre to a ~1km grid, so everyone in a
 *        neighbourhood asks the same question.
 *     2. Round the radius up to one of five rungs, so the 25 slider
 *        positions collapse into 5 distinct queries instead of 25.
 *     3. Pad the radius by the worst-case snapping displacement, so
 *        step 1 can never hide a result that was genuinely in range.
 *     4. Measure and filter using the user's TRUE position on the way out.
 *
 *   Steps 3 and 4 are what make this invisible: the user sees exactly the
 *   results and distances for where they actually stand. Only the wire
 *   format is coarsened. `overpassQueryKey.test.js` pins that property.
 */

// ~0.01° ≈ 1.1km of latitude, and ~0.94km of longitude at Israel's latitude.
export const GRID_DEG = 0.01;

/**
 * Worst-case distance between a true position and its snapped grid centre:
 * half the cell diagonal. At Israel's latitude range that is ~738m
 * (sqrt(557² + 484²)), so 800m is the padding every query radius gets.
 * Raising GRID_DEG without raising this would start losing results.
 */
export const GRID_MARGIN_M = 800;

/**
 * Radius rungs, in metres. The slider offers 1..25km in 1km steps; querying
 * each verbatim would fragment the cache 25 ways per grid cell. Five rungs
 * (plus a 26km top rung so the 25km maximum still gets its margin) keep the
 * cache dense. Over-fetching is cheap: the widest rung measured 3.5s and 164
 * elements from Tel Aviv centre on 2026-09-08.
 */
export const RADIUS_LADDER = [2000, 5000, 10000, 15000, 25000, 26000];

/** Great-circle distance in kilometres. */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Snap a coordinate to the shared grid.
 *
 * The `toFixed(2)` is not cosmetic. `Math.round(32.0853 / 0.01) * 0.01`
 * evaluates to 32.089999999999996, which would be interpolated into the
 * query string verbatim and produce a different cache key than a run that
 * happened to land on 32.09. The key must be byte-stable, so the value is
 * pinned to two decimals before it can ever reach a template literal.
 */
export function snapToGrid(v) {
  return Number((Math.round(v / GRID_DEG) * GRID_DEG).toFixed(2));
}

/**
 * The radius to actually query for a requested radius: the first ladder rung
 * that covers the request plus the snapping margin.
 */
export function queryRadiusFor(requestedMeters) {
  const needed = requestedMeters + GRID_MARGIN_M;
  return RADIUS_LADDER.find(v => v >= needed) ?? needed;
}

/**
 * Build the cache key for a canonical question. Shared by the local
 * localStorage layer and (via the query text) the server-side row, so both
 * layers agree on what "the same question" means.
 */
export function canonicalCacheKey(version, qLat, qLng, qR, hasVessel) {
  return `${version}:${qLat}:${qLng}:${qR}:${hasVessel ? 1 : 0}`;
}

/**
 * Re-measure every row from the caller's true position, drop anything
 * outside the radius they asked for, and sort nearest-first.
 *
 * Re-measuring rather than trusting a row's stored `distance` matters on the
 * cache-read path: a cached row was measured from wherever the user stood
 * when it was written, which can be up to a grid cell away from where they
 * are now. The previous cache stored the computed distance and redisplayed
 * it, so a revisit could show a confidently stale "1.2 ק"מ". Each row
 * carries its own lat/lon, so correcting this costs nothing.
 *
 * Rows without usable coordinates are dropped rather than sorted to an
 * arbitrary position.
 */
export function narrowToRadius(rows, radiusMeters, fromLat, fromLng) {
  return (rows || [])
    .filter(row => Number.isFinite(row?.lat) && Number.isFinite(row?.lon))
    .map(row => ({ ...row, distance: haversineDistance(fromLat, fromLng, row.lat, row.lon) }))
    .filter(row => row.distance * 1000 <= radiusMeters)
    .sort((a, b) => a.distance - b.distance);
}

import { describe, it, expect } from 'vitest';
import {
  GRID_DEG,
  GRID_MARGIN_M,
  RADIUS_LADDER,
  haversineDistance,
  snapToGrid,
  queryRadiusFor,
  canonicalCacheKey,
  narrowToRadius,
} from './overpassQueryKey';

// Israel's latitude span, used to bound the worst-case grid displacement.
const LAT_MIN = 29.4;   // Eilat
const LAT_MAX = 33.4;   // Metula

describe('snapToGrid', () => {
  it('produces a byte-stable two-decimal value', () => {
    // The regression this guards: Math.round(32.0853 / 0.01) * 0.01 is
    // 32.089999999999996 in IEEE 754. Interpolated into a query string that
    // is a different cache key than 32.09, so the whole shared cache would
    // silently fragment on floating-point noise.
    expect(snapToGrid(32.0853)).toBe(32.09);
    expect(String(snapToGrid(32.0853))).toBe('32.09');
    expect(String(snapToGrid(34.7818))).toBe('34.78');
  });

  it('maps every position in a cell to one key, which is the point', () => {
    // Tel Aviv centre and a point ~400m away must ask the same question.
    expect(snapToGrid(32.0853)).toBe(snapToGrid(32.0869));
    expect(snapToGrid(34.7818)).toBe(snapToGrid(34.7834));
  });

  it('is idempotent', () => {
    for (const v of [32.0853, 34.7818, 31.2530, 29.5577, -0.004, 0]) {
      expect(snapToGrid(snapToGrid(v))).toBe(snapToGrid(v));
    }
  });
});

describe('queryRadiusFor', () => {
  it('always covers the request plus the snapping margin', () => {
    for (let r = 1000; r <= 25000; r += 1000) {
      expect(queryRadiusFor(r)).toBeGreaterThanOrEqual(r + GRID_MARGIN_M);
    }
  });

  it('returns a ladder rung for every slider position', () => {
    for (let r = 1000; r <= 25000; r += 1000) {
      expect(RADIUS_LADDER).toContain(queryRadiusFor(r));
    }
  });

  it('collapses the 25 slider positions into 6 distinct queries', () => {
    const rungs = new Set();
    for (let r = 1000; r <= 25000; r += 1000) rungs.add(queryRadiusFor(r));
    // This is the cache-density property: a ~4x reduction in distinct
    // queries per grid cell. Six rather than five because the 25km slider
    // maximum needs its margin and so lands on the 26km top rung — the
    // test below pins that separately. If a future change to the ladder
    // pushes this number up, every extra rung divides the hit rate.
    expect(rungs.size).toBe(6);
    expect([...rungs].sort((a, b) => a - b))
      .toEqual([2000, 5000, 10000, 15000, 25000, 26000]);
  });

  it('still pads the 25km maximum, which needs the top rung', () => {
    expect(queryRadiusFor(25000)).toBe(26000);
  });
});

describe('the lossless-snapping invariant', () => {
  // This is the property the whole design rests on: coarsening the question
  // must never hide a result that was genuinely within the radius the user
  // asked for. Formally — for any true position P and requested radius r,
  // every point within r of P is within queryRadiusFor(r) of snap(P). That
  // holds exactly when GRID_MARGIN_M >= the worst-case distance from a true
  // position to its snapped centre.
  it('GRID_MARGIN_M exceeds the worst-case grid displacement across Israel', () => {
    let worst = 0;
    let worstAt = null;
    // Sweep latitudes, and within each cell sweep the offset to the corner.
    // The maximum is at the cell corner, where both offsets are half a cell.
    for (let lat = LAT_MIN; lat <= LAT_MAX; lat += 0.1) {
      for (let dLat = -GRID_DEG / 2; dLat <= GRID_DEG / 2; dLat += GRID_DEG / 10) {
        for (let dLng = -GRID_DEG / 2; dLng <= GRID_DEG / 2; dLng += GRID_DEG / 10) {
          const trueLat = lat + dLat;
          const trueLng = 34.8 + dLng;
          const d = haversineDistance(
            trueLat, trueLng,
            snapToGrid(trueLat), snapToGrid(trueLng),
          ) * 1000;
          if (d > worst) { worst = d; worstAt = { trueLat, trueLng }; }
        }
      }
    }
    // ~738m expected: half-cell is 557m of latitude and up to 484m of
    // longitude at 29.4°.
    expect(worst).toBeLessThan(GRID_MARGIN_M);
    expect(worst).toBeGreaterThan(600); // sanity: the sweep really found the corner
    expect(worstAt).not.toBeNull();
  });

  it('keeps a POI at the exact edge of the requested radius', () => {
    // Construct the adversarial case directly: user at a cell corner, POI
    // exactly at the requested radius, in the direction away from the
    // snapped centre. It must still fall inside the queried radius.
    const trueLat = 32.0849;                  // ~ corner of its cell
    const trueLng = 34.7849;
    const qLat = snapToGrid(trueLat);
    const qLng = snapToGrid(trueLng);
    for (let r = 1000; r <= 25000; r += 1000) {
      const qR = queryRadiusFor(r);
      // Walk due south-west, away from the snapped centre, r metres out.
      const bearingAway = trueLat < qLat ? -1 : 1;
      const poiLat = trueLat + bearingAway * (r / 1000) / 111.32;
      const distFromSnapped = haversineDistance(qLat, qLng, poiLat, trueLng) * 1000;
      expect(distFromSnapped).toBeLessThanOrEqual(qR);
    }
  });
});

describe('narrowToRadius', () => {
  const from = { lat: 32.0853, lng: 34.7818 };
  const rows = [
    { id: 'far',  name: 'far',  lat: 32.2000, lon: 34.7818 },  // ~12.8km
    { id: 'near', name: 'near', lat: 32.0900, lon: 34.7818 },  // ~0.5km
    { id: 'mid',  name: 'mid',  lat: 32.1200, lon: 34.7818 },  // ~3.9km
  ];

  it('drops rows outside the requested radius', () => {
    const out = narrowToRadius(rows, 5000, from.lat, from.lng);
    expect(out.map(r => r.id)).toEqual(['near', 'mid']);
  });

  it('sorts nearest first', () => {
    const out = narrowToRadius(rows, 25000, from.lat, from.lng);
    expect(out.map(r => r.id)).toEqual(['near', 'mid', 'far']);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].distance).toBeGreaterThanOrEqual(out[i - 1].distance);
    }
  });

  it('recomputes distance instead of trusting a cached value', () => {
    // The cache-staleness regression: a row written when the user stood
    // elsewhere carries that old distance. Redisplaying it shows a
    // confidently wrong "1.2 ק"מ" on a revisit.
    const stale = [{ id: 'x', lat: 32.0900, lon: 34.7818, distance: 999 }];
    const [out] = narrowToRadius(stale, 5000, from.lat, from.lng);
    expect(out.distance).toBeLessThan(1);
    expect(out.distance).toBeGreaterThan(0);
  });

  it('drops rows with unusable coordinates rather than mis-sorting them', () => {
    const dirty = [
      { id: 'ok',      lat: 32.0900, lon: 34.7818 },
      { id: 'nolat',   lat: null,    lon: 34.7818 },
      { id: 'nan',     lat: NaN,     lon: 34.7818 },
      { id: 'missing' },
    ];
    const out = narrowToRadius(dirty, 25000, from.lat, from.lng);
    expect(out.map(r => r.id)).toEqual(['ok']);
  });

  it('tolerates null and empty input', () => {
    expect(narrowToRadius(null, 5000, from.lat, from.lng)).toEqual([]);
    expect(narrowToRadius([], 5000, from.lat, from.lng)).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = [{ id: 'x', lat: 32.09, lon: 34.7818, distance: 999 }];
    narrowToRadius(input, 5000, from.lat, from.lng);
    expect(input[0].distance).toBe(999);
  });
});

describe('canonicalCacheKey', () => {
  it('is identical for two positions in the same cell at the same rung', () => {
    const a = canonicalCacheKey('fg_v4', snapToGrid(32.0853), snapToGrid(34.7818), queryRadiusFor(3000), false);
    const b = canonicalCacheKey('fg_v4', snapToGrid(32.0869), snapToGrid(34.7834), queryRadiusFor(4000), false);
    expect(a).toBe(b);
  });

  it('separates the vessel query from the car-only one', () => {
    const car    = canonicalCacheKey('fg_v4', 32.09, 34.78, 5000, false);
    const vessel = canonicalCacheKey('fg_v4', 32.09, 34.78, 5000, true);
    expect(car).not.toBe(vessel);
  });

  it('is versioned, so a query-shape change cannot read old rows', () => {
    expect(canonicalCacheKey('fg_v4', 32.09, 34.78, 5000, false))
      .not.toBe(canonicalCacheKey('fg_v5', 32.09, 34.78, 5000, false));
  });
});

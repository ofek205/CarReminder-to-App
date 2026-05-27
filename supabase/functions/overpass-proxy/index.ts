// ═══════════════════════════════════════════════════════════════════════════
// overpass-proxy — server-side proxy for OpenStreetMap Overpass queries.
//
// Why this exists:
//   FindGarage used to call public Overpass mirrors directly from the
//   browser. That coupling was fragile on three axes:
//     1. CORS — the browser can only use mirrors that send
//        Access-Control-Allow-Origin. Most Overpass mirrors DON'T, so
//        the usable pool was tiny.
//     2. CSP — every mirror had to be whitelisted in vercel.json's
//        connect-src. A missing entry silently blocked the fallback
//        (the 2026-05-26 incident: the kumi fallback was CSP-blocked
//        the whole time, so a single primary outage killed the feature).
//     3. Wrong-region mirrors — a Switzerland-only instance returned
//        HTTP 200 with empty elements for Israel, masking real data.
//
//   Moving the fetch server-side removes CORS entirely (server-to-server),
//   collapses the CSP surface to just Supabase (already allowed), and
//   lets us try ANY mirror — including the many that lack CORS headers.
//
// Auth:
//   Verify JWT: OFF (deploy with --no-verify-jwt). FindGarage is a
//   public-data feature usable by guests, and Overpass data is public
//   and non-sensitive. SSRF is not possible — the client sends only the
//   query STRING; the mirror URLs are a fixed server-side allow-list.
//   Abuse surface is bounded by the query validation below + Supabase's
//   platform-level rate limiting.
//
// Contract:
//   POST { query: "<Overpass QL>" }  →  the chosen mirror's JSON, or
//   { error, details } with a non-200 status on total failure.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { buildCorsHeaders, CAPACITOR_ORIGINS } from '../_shared/cors.ts';

// Full-planet Overpass mirrors. Server-side we are NOT limited to CORS-
// enabled ones, so this pool is wider than what the browser could use.
// Order is the *preference* when several respond — but the race below
// takes whichever returns a non-empty payload first.
//   ⚠️ Every entry MUST be a planet mirror (regional extracts return
//   false-empty for Israel). Verify a new mirror with:
//     curl -sX POST <url> --data 'data=[out:json];node["shop"="car_repair"](32.0,34.7,32.15,34.85);out count;'
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];

// Per-mirror hard timeout. Overpass's own [timeout:N] is server-side; we
// also cap the network wait so one hung mirror can't stall the race.
const MIRROR_TIMEOUT_MS = 30_000;
const MAX_QUERY_LEN = 8_000;

// Overpass mirrors reject requests without a descriptive User-Agent —
// overpass-api.de returns HTTP 406 Not Acceptable for the default Deno
// UA (and for curl's UA), which is exactly why the first proxy deploy
// got all_mirrors_unavailable. OSM's usage policy REQUIRES a UA that
// identifies the app + a contact. Sending one flips overpass-api.de
// from 406 → 200.
const USER_AGENT = 'CarReminder/1.0 (https://car-reminder.app; contact@car-reminder.app)';

function json(body: unknown, status: number, req: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(req, { extraOrigins: CAPACITOR_ORIGINS }),
      'Content-Type': 'application/json',
    },
  });
}

// One mirror attempt → parsed JSON, or throw on any failure. A response
// counts as a failure when: network error/timeout, non-2xx, non-JSON,
// or Overpass's soft server-side timeout (200 + remark + empty).
async function queryMirror(server: string, body: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), MIRROR_TIMEOUT_MS);
  try {
    const res = await fetch(server, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':   USER_AGENT,
      },
      body,
      signal:  ctrl.signal,
    });
    if (!res.ok) throw new Error(`${server}: HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new Error(`${server}: non-json`);
    const data = await res.json();
    if (data && typeof data.remark === 'string' && /timed out|runtime error/i.test(data.remark)) {
      throw new Error(`${server}: server-side timeout`);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(req, { extraOrigins: CAPACITOR_ORIGINS }) });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  let query: string;
  try {
    const parsed = await req.json();
    query = parsed?.query;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req);
  }

  // Validation — keep the proxy a narrow Overpass relay, nothing else.
  if (typeof query !== 'string' || query.length === 0) {
    return json({ error: 'Missing query' }, 400, req);
  }
  if (query.length > MAX_QUERY_LEN) {
    return json({ error: 'Query too long' }, 413, req);
  }
  // Cheap shape check — Overpass QL always carries [out:...] and an out;
  // statement. Blocks the function being used as a generic open relay.
  if (!/\[out:/i.test(query) || !/\bout\b/i.test(query)) {
    return json({ error: 'Not an Overpass query' }, 400, req);
  }

  const body = `data=${encodeURIComponent(query)}`;

  // Two-phase race:
  //   Phase 1 — resolve with the first mirror that returns a NON-EMPTY
  //             element set. This is the win we actually want: real data.
  //   Phase 2 — if every mirror either failed or returned empty, fall
  //             back to the first VALID (possibly empty) payload so a
  //             genuinely empty area still renders "no results" rather
  //             than a server error.
  const attempts = MIRRORS.map((server) => queryMirror(server, body));

  // Collect settled results; resolve early on first non-empty.
  const results = await Promise.allSettled(attempts);
  const fulfilled = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map((r) => r.value);

  const nonEmpty = fulfilled.find(
    (d) => Array.isArray(d?.elements) && d.elements.length > 0,
  );
  if (nonEmpty) return json(nonEmpty, 200, req);

  // No mirror had data. If at least one returned a valid (empty) payload,
  // pass it through — the area legitimately has no matches.
  if (fulfilled.length > 0) return json(fulfilled[0], 200, req);

  // Everything failed (all mirrors down/blocked). Surface the per-mirror
  // rejection reasons — they're just error strings (no secrets) and they
  // turn an opaque 502 into an actionable signal (e.g. "all 406" → UA
  // problem, "all timeout" → datacenter IP blocked).
  const reasons = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => String(r.reason?.message || r.reason));
  console.warn('[overpass-proxy] all mirrors failed:', reasons.join(' | '));
  return json({ error: 'all_mirrors_unavailable', elements: [], reasons }, 502, req);
});

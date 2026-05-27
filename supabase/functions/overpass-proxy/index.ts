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
// Verified from the Supabase Edge runtime (2026-05-27):
//   • overpass-api.de    → 200 with a UA; intermittently 504 under load
//                          (transient — the retry below recovers it).
//   • kumi.systems       → often hangs from the edge IP (→ timeout abort),
//                          but kept as redundancy for when .de is 504ing.
//   • private.coffee     → same profile as kumi.
// Dropped (never contribute, only added latency + noise to the race):
//   • maps.mail.ru       → HTTP 403 (blocks our IP range).
//   • overpass.osm.jp    → invalid TLS cert (NotValidForName) — broken.
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Per-mirror hard timeout. Overpass's own [timeout:N] is 25s server-side;
// we cap the network wait just above that so one hung mirror can't stall
// the race. NOTE: with early-resolution (raceForData) a fast mirror no
// longer waits for the slow ones — this cap only bounds the worst case
// where EVERY mirror is slow.
const MIRROR_TIMEOUT_MS = 27_000;
const MAX_QUERY_LEN = 8_000;

// overpass-api.de returns a transient 504/502/429 under load. A single
// retry after a short backoff recovers most of these within one request,
// which is the difference between "sometimes finds, sometimes doesn't"
// and "always finds". Only transient statuses are retried.
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const RETRY_BACKOFF_MS = 600;

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

// Custom error carrying the HTTP status so the retry layer can decide
// whether the failure is transient (504 → retry) or terminal (403 → give up).
class MirrorError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

// One mirror attempt → parsed JSON, or throw on any failure. A response
// counts as a failure when: network error/timeout, non-2xx, non-JSON,
// or Overpass's soft server-side timeout (200 + remark + empty).
async function attemptMirror(server: string, body: string): Promise<unknown> {
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
    if (!res.ok) throw new MirrorError(`${server}: HTTP ${res.status}`, res.status);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new MirrorError(`${server}: non-json`);
    const data = await res.json();
    if (data && typeof data.remark === 'string' && /timed out|runtime error/i.test(data.remark)) {
      // Overpass's soft timeout is transient — same class as a 504.
      throw new MirrorError(`${server}: server-side timeout`, 504);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

// Mirror attempt + one retry on a transient status. overpass-api.de 504s
// under load often enough that without this the feature flickers between
// "found results" and "no results found"; the retry collapses that.
async function queryMirror(server: string, body: string): Promise<unknown> {
  try {
    return await attemptMirror(server, body);
  } catch (err) {
    const status = err instanceof MirrorError ? err.status : undefined;
    if (status && RETRY_STATUSES.has(status)) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      return await attemptMirror(server, body);
    }
    throw err;
  }
}

// Race the mirrors and resolve as soon as ONE returns a non-empty element
// set — DON'T wait for the slow/hanging mirrors (the old Promise.allSettled
// made every request wait for kumi/private.coffee to hit their 27s timeout
// even when overpass-api.de had already answered in 2s). Only if no mirror
// produces data do we fall back to the first VALID-but-empty payload (real
// "no garages here"), and only if everything errored do we report failure.
function raceForData(
  attempts: Promise<unknown>[],
): Promise<{ data: unknown } | { failed: string[] }> {
  return new Promise((resolve) => {
    let remaining = attempts.length;
    let emptyFallback: unknown;
    let hasFallback = false;
    let done = false;
    const failures: string[] = [];

    for (const p of attempts) {
      p.then((data) => {
        if (done) return;
        const els = (data as { elements?: unknown[] })?.elements;
        if (Array.isArray(els) && els.length > 0) {
          done = true;
          resolve({ data });
        } else if (!hasFallback) {
          emptyFallback = data;
          hasFallback = true;
        }
      }).catch((err) => {
        failures.push(String(err?.message || err));
      }).finally(() => {
        remaining -= 1;
        if (remaining === 0 && !done) {
          done = true;
          resolve(hasFallback ? { data: emptyFallback } : { failed: failures });
        }
      });
    }
  });
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

  // Race all mirrors; resolve the instant one returns data (see
  // raceForData). Falls back to a valid-but-empty payload (real "no
  // garages here"), then to a 502 only if every mirror errored.
  const attempts = MIRRORS.map((server) => queryMirror(server, body));
  const outcome = await raceForData(attempts);

  if ('data' in outcome) return json(outcome.data, 200, req);

  // Everything failed (all mirrors down/blocked). Surface the per-mirror
  // failure reasons — they're just error strings (no secrets) and they
  // turn an opaque 502 into an actionable signal (e.g. "all 406" → UA
  // problem, "all timeout" → datacenter IP blocked).
  console.warn('[overpass-proxy] all mirrors failed:', outcome.failed.join(' | '));
  return json({ error: 'all_mirrors_unavailable', elements: [], reasons: outcome.failed }, 502, req);
});

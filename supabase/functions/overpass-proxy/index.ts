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
// Shared cache (added 2026-09-08):
//   overpass-api.de reports `Rate limit: 2` — two concurrent slots PER IP.
//   All app traffic egresses from the shared Supabase Edge IP pool, so every
//   user of the feature competes for those two slots globally. That is the
//   real ceiling behind "sometimes finds, sometimes doesn't", and it tightens
//   as the app grows. So this function is now a read-through cache over
//   public.overpass_cache (see supabase-overpass-cache-2026-09-08.sql):
//
//     • Fresh row        → served from Postgres, no upstream call at all.
//     • Expired hot row  → served stale to everyone while exactly ONE elected
//                          caller refreshes upstream. The election is what
//                          stops an expiring popular cell from stampeding the
//                          two slots.
//     • Upstream failure → a stale row is served instead of a 502. Garage
//                          locations tolerate staleness; the feature does not
//                          tolerate an error screen.
//
//   Every cache interaction soft-fails to the old direct-fetch behaviour, so
//   this function keeps working if the migration has not been applied yet,
//   if the service-role env is missing, or if the table is dropped. Order of
//   "apply SQL" vs "redeploy function" therefore does not matter.
//
// Contract:
//   POST { query: "<Overpass QL>" }  →  the chosen mirror's JSON, or
//   { error, details } with a non-200 status on total failure.
//   Response carries `X-Overpass-Cache` (HIT | HIT-STALE | STALE-FALLBACK |
//   REVALIDATED | MISS | BYPASS) and `X-Overpass-Age` for diagnosis.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
// Dropped (never contribute, only added latency + noise to the race):
//   • maps.mail.ru       → HTTP 403 (blocks our IP range).
//   • overpass.osm.jp    → invalid TLS cert (NotValidForName) — broken.
//   • kumi.systems       → dropped 2026-09-12, see below.
//   • private.coffee     → dropped 2026-09-12, see below.
//
// ⚠️ 2026-09-12 — why the pool is down to one, and why that is an
// improvement rather than a loss of redundancy.
//
// These two were kept "as redundancy for when .de is 504ing", on the
// belief that they merely hung from the edge IP. Measured directly from a
// laptop on a plain residential line that day, with the same query that
// overpass-api.de answered in 0.6s:
//
//   overpass-api.de           200, 0.6s, 9 elements
//   overpass.kumi.systems     no response at all, aborted at 30s
//   overpass.private.coffee   no response at all, aborted at 30s
//
// So they are not slow from our IP, they are not answering anyone. They
// never win the race (it takes the first NON-EMPTY payload), so they never
// helped — but when .de also fails they are what makes the whole call sit
// for the full 27s MIRROR_TIMEOUT_MS before admitting defeat. The user
// watched a spinner for half a minute and concluded the app found no
// garages, which is how this was reported.
//
// Adding a mirror back is fine, but VERIFY IT FIRST with the curl above.
// An entry that cannot answer is not a spare tyre, it is 27 seconds.
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
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

function json(body: unknown, status: number, req: Request, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(req, { extraOrigins: CAPACITOR_ORIGINS }),
      'Content-Type': 'application/json',
      // Without this the browser cannot read the diagnostic headers on a
      // cross-origin response. Nothing in the client depends on them, but
      // being able to see HIT vs MISS from devtools is the difference
      // between "the cache is working" and "we think the cache is working".
      'Access-Control-Expose-Headers': 'X-Overpass-Cache, X-Overpass-Age',
      ...extra,
    },
  });
}

// ── shared cache ───────────────────────────────────────────────────────────
// Both env vars are injected automatically by the Supabase platform. If
// either is absent (local `functions serve` without them, say) the client
// stays null and every cache call becomes a no-op, which degrades this
// function to exactly its pre-cache behaviour.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const sb = (SUPABASE_URL && SERVICE_ROLE)
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

// Cache TTLs. 24h soft / 7d hard: a garage that opened yesterday can wait a
// day to appear, and a week-old answer still beats an error screen.
const CACHE_TTL_SECONDS   = 86_400;
const CACHE_STALE_SECONDS = 604_800;

interface CacheRow {
  // Named cache_hit, not found: a PL/pgSQL RETURNS TABLE column called
  // `found` would shadow the language's built-in FOUND variable inside the
  // function body. See supabase-overpass-cache-2026-09-08.sql.
  cache_hit: boolean;
  payload: unknown;
  element_count: number;
  fetched_at: string;
  is_stale: boolean;
  should_refresh: boolean;
}

// The query text is the cache identity. Whitespace is normalised first so a
// cosmetic formatting change on the client doesn't silently orphan every
// existing row — the client builds these by string concatenation, and one
// stray newline would otherwise look like a brand-new query to every cell.
function canonicalize(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Returns the cache row, or null for "nothing usable — go upstream". Never
// throws: a cache problem must not turn into a user-visible failure of a
// feature that worked without a cache at all.
async function cacheGet(key: string): Promise<CacheRow | null> {
  if (!sb) return null;
  try {
    const { data, error } = await sb.rpc('overpass_cache_get', { p_key: key });
    if (error) {
      // Includes "relation does not exist" when the migration hasn't run yet.
      console.warn('[overpass-proxy] cache read unavailable:', error.message);
      return null;
    }
    // A RETURNS TABLE function comes back as an array of rows.
    const row = (Array.isArray(data) ? data[0] : data) as CacheRow | undefined;
    return row?.cache_hit ? row : null;
  } catch (err) {
    console.warn('[overpass-proxy] cache read threw:', String((err as Error)?.message || err));
    return null;
  }
}

async function cachePut(key: string, query: string, payload: unknown, count: number): Promise<void> {
  if (!sb || count <= 0) return;
  try {
    const { error } = await sb.rpc('overpass_cache_put', {
      p_key: key,
      p_query: query,
      p_payload: payload,
      p_element_count: count,
      p_ttl_seconds: CACHE_TTL_SECONDS,
      p_stale_seconds: CACHE_STALE_SECONDS,
    });
    if (error) console.warn('[overpass-proxy] cache write unavailable:', error.message);
  } catch (err) {
    console.warn('[overpass-proxy] cache write threw:', String((err as Error)?.message || err));
  }
}

function ageSeconds(fetchedAt: string): string {
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return '0';
  return String(Math.max(0, Math.round((Date.now() - t) / 1000)));
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
  // Shape check — Overpass QL always carries [out:...] and an out;
  // statement. Blocks the function being used as a generic open relay.
  if (!/\[out:/i.test(query) || !/\bout\b/i.test(query)) {
    return json({ error: 'Not an Overpass query' }, 400, req);
  }

  // Blocklist: reject queries that could abuse the proxy for resource
  // exhaustion or data scraping beyond the intended garage-finder scope.
  // Audit finding H-2 (2026-05-27).
  const queryLower = query.toLowerCase();
  const BLOCKED_PATTERNS = [
    /\[timeout:\s*(\d+)/.test(query) && parseInt(RegExp.$1, 10) > 30,  // server-side timeout > 30s
    /\brecurse\b/i.test(query),        // recursive queries are expensive
    /\bconvert\b/i.test(query),         // type conversions can scan huge datasets
    /\bmake\b/i.test(query),            // geometry creation is expensive
    /\btimeline\b/i.test(query),        // historical data dumps
    /\bdiff\b/i.test(query),            // diff queries can be very expensive
    /\badiff\b/i.test(query),           // augmented diff
  ];
  if (BLOCKED_PATTERNS.some(Boolean)) {
    return json({ error: 'Query type not allowed' }, 400, req);
  }

  const canonical = canonicalize(query);
  const key = await sha256Hex(canonical);

  // ── cache read ───────────────────────────────────────────────────────────
  // A fresh row, or a stale row we were NOT elected to refresh, is served
  // immediately with no upstream call. This is the branch that should serve
  // the overwhelming majority of requests once the cache is warm, and the
  // whole reason the two-slot upstream limit stops mattering.
  const cached = await cacheGet(key);
  if (cached && !cached.should_refresh) {
    return json(cached.payload, 200, req, {
      'X-Overpass-Cache': cached.is_stale ? 'HIT-STALE' : 'HIT',
      'X-Overpass-Age':   ageSeconds(cached.fetched_at),
    });
  }

  // Past here we are either a cold miss, or the one caller elected to
  // refresh an expired cell. Either way, exactly one request goes upstream.
  const body = `data=${encodeURIComponent(query)}`;

  // Race all mirrors; resolve the instant one returns data (see
  // raceForData). Falls back to a valid-but-empty payload (real "no
  // garages here"), then to a 502 only if every mirror errored.
  const attempts = MIRRORS.map((server) => queryMirror(server, body));
  const outcome = await raceForData(attempts);

  if ('data' in outcome) {
    const els = (outcome.data as { elements?: unknown[] })?.elements;
    const count = Array.isArray(els) ? els.length : 0;

    // An empty answer while we hold a non-empty stale row: prefer the stale
    // row. Without this the ONE caller elected to do the refresh work gets a
    // worse answer than everyone being served from cache alongside it —
    // "לא נמצאו תוצאות" for them, results for everybody else. A mirror that
    // soft-timed out and a genuinely emptied area are indistinguishable
    // here, so the next refresh is the right place to notice a real change.
    if (count === 0 && cached) {
      return json(cached.payload, 200, req, {
        'X-Overpass-Cache': 'STALE-FALLBACK',
        'X-Overpass-Age':   ageSeconds(cached.fetched_at),
      });
    }

    // Empty answers are never cached — see the constraint and its comment in
    // supabase-overpass-cache-2026-09-08.sql. cachePut declines count <= 0,
    // so the next request re-asks rather than pinning "no results" for a day.
    await cachePut(key, canonical, outcome.data, count);
    return json(outcome.data, 200, req, {
      'X-Overpass-Cache': cached ? 'REVALIDATED' : 'MISS',
      'X-Overpass-Age':   '0',
    });
  }

  // Upstream is unreachable. If we hold a stale copy, that is a far better
  // answer than an error — this is the case that used to surface as
  // "שרת החיפוש לא הגיב" and left the screen empty. The refresh lock stays
  // held until it lapses, which also stops every subsequent caller from
  // retrying into a dead upstream.
  if (cached) {
    console.warn('[overpass-proxy] upstream failed, serving stale:', outcome.failed.join(' | '));
    return json(cached.payload, 200, req, {
      'X-Overpass-Cache': 'STALE-FALLBACK',
      'X-Overpass-Age':   ageSeconds(cached.fetched_at),
    });
  }

  // Everything failed (all mirrors down/blocked) and we have nothing cached.
  // Surface the per-mirror failure reasons — they're just error strings (no
  // secrets) and they turn an opaque 502 into an actionable signal (e.g.
  // "all 406" → UA problem, "all timeout" → datacenter IP blocked).
  console.warn('[overpass-proxy] all mirrors failed:', outcome.failed.join(' | '));
  return json({ error: 'all_mirrors_unavailable', elements: [], reasons: outcome.failed }, 502, req, {
    'X-Overpass-Cache': 'MISS',
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// gov-sync-vehicles — Supabase Edge Function that mirrors fresh
// data.gov.il vehicle data back onto our `vehicles` table. The cron fires
// every 20 minutes from 07:00 to 18:59 UTC, after the ministry's overnight
// reload (supabase-gov-sync-schedule-2026-09-24.sql); the 20h staleness
// clock below keeps each vehicle at roughly once a day.
//
// What it syncs:
//   • current_km           — but only when the user hasn't manually
//                            overridden it after the last gov test
//   • last_test_date       — forward in time only
//   • test_due_date        — forward in time only
//   • last_gov_sync_at     — always (heartbeat)
//   • last_gov_sync_km     — always (sync-snapshot)
//   • last_gov_sync_test_date — always (sync-snapshot)
//   • last_gov_sync_attempt_at — every row a run takes on (queue position)
//
// What it does NOT sync:
//   • Anything for vehicles whose owner toggled `auto_sync_enabled` off
//   • Vehicles without a license_plate (motocross, vessels, etc.)
//   • Backwards values (km going down, test date moving earlier)
//
// Pipeline per invocation:
//   1. Authenticate via shared secret (cron) or admin JWT.
//   2. SELECT a batch of candidates from `vehicles`:
//         - auto_sync_enabled = true
//         - license_plate IS NOT NULL
//         - last_gov_sync_at IS NULL OR < now() - 20 hours
//      Sorted least-recently-attempted first, then oldest-synced first,
//      capped at MAX_VEHICLES_PER_RUN. Every row taken on is stamped
//      last_gov_sync_attempt_at, so no row can keep the front of the queue.
//   3. In chunks of GOV_CHUNK_SIZE plates, two requests per chunk, in
//      parallel (data.gov.il accepts an array in `filters`):
//         a. fetchTestDatesFrom(PRIVATE_RESOURCE_ID, plates)
//                                          → test_due_date / last_test_date
//         b. fetchKmBatch(plates)          → current_km
//      Plates the private dataset doesn't have are then asked of the
//      personal-import and public-vehicle registries (see
//      PERSONAL_IMPORT_RESOURCE_ID). A failure there only holds back
//      the rows that needed it.
//      צמ"ה vehicles (by type, with a 3-6 digit number) go to the צמ"ה
//      registry instead, in chunks of their own; see lookupRoute.
//   4. If EITHER request failed, the whole chunk is left untouched: no
//      sync stamp, no RPC, no notification. Those rows stay due, and go
//      behind the rows not yet attempted, so they are retried once the rest
//      of the queue has had a turn. The run moves on to its next chunk
//      rather than stopping. A plate the ministry simply doesn't have is a
//      different thing (a successful response without that plate) and is
//      stamped as before.
//   5. Call record_gov_sync_update(vehicle_id, gov_km, gov_test_date,
//      gov_test_due_date). The RPC handles the compare + write +
//      notification + idempotency log atomically.
//   6. Log a JSON summary (pg_net stops waiting long before we finish, so
//      the response body never reaches net._http_response) and return it.
//
// A successful answer can still be wrong (2026-09-24): the ministry reloads
// its datasets in place. That morning the test-dates CSV (4.1M rows) was
// uploaded at 02:36 UTC and finished loading at 06:08, and every miss on a
// car we had test data for fell inside that window, tapering 40, 22, 12, 0
// per hour as the table filled up. The km dataset loaded in 8 minutes and
// was fine. A half-loaded table answers "success" with some plates absent,
// which looks exactly like "no such plate". So a plate that a dataset gave
// us data for last time, and now lacks, is held for a retry instead of
// being believed; see MISSING_GRACE_MS.
//
// Why failure and "not found" must never be the same value (2026-09-24):
//   Both fetchers used to return nulls on a timeout, a non-2xx or a throw,
//   exactly as they did for an unknown plate. A failed test-dates request
//   next to a successful km request therefore reached the RPC as "the
//   ministry has no test for this car": the km was updated, the test date
//   was not, the user got a km-only push, the row was stamped as synced
//   and the real test waited another 20 hours. Seen on one plate with six
//   rows: four got the full update, two got km only, same car, same day.
//
// Deploy:
//   Dashboard → Edge Functions → Deploy new function → paste this
//   file → name `gov-sync-vehicles` → Deploy. Verify JWT: OFF.
//   Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//                     DISPATCH_SECRET.
//
// Migrate: run supabase-gov-sync-detector.sql first (RPC +
// gov_sync_log table). Without the RPC this function returns 500.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Inlined helpers ────────────────────────────────────────────────────────
// 2026-05-17: Originally these came from ../_shared/securityLog.ts and
// ../_shared/cors.ts. The Supabase dashboard's "paste-and-deploy" path
// doesn't walk relative imports, so we inline a minimal version here.
// Deployment via the CLI (`supabase functions deploy`) would have
// bundled the imports — we chose paste compatibility over DRY because
// these helpers are small and rarely change.

type SecurityEvent =
  | 'auth_failed'
  | 'permission_denied'
  | 'rate_limit_hit'
  | 'rate_limit_error'
  | 'ssrf_rejected'
  | 'payload_rejected';

function logSecurityEvent(
  fn: string,
  event: SecurityEvent,
  details: Record<string, unknown> = {},
): void {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (v !== undefined && v !== null) safe[k] = v;
  }
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({
    _:      'security_event',
    fn,
    event,
    ts:     new Date().toISOString(),
    ...safe,
  }));
}

const LOCAL_WEB_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

function isTrustedVercelPreview(origin: string): boolean {
  if (!origin) return false;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'https:') return false;
    if (!hostname.endsWith('.vercel.app')) return false;
    return (
      hostname.startsWith('car-reminder-to-app-git-') ||
      hostname.startsWith('car-manage-hub-git-')
    );
  } catch {
    return false;
  }
}

function pickAllowedOrigin(req: Request, extraOrigins: string[] = []): string {
  const origin = req.headers.get('origin') || '';
  const fromAllowed = (Deno.env.get('ALLOWED_ORIGIN') || '').split(',');
  const fromApp     = (Deno.env.get('APP_ORIGIN')     || '').split(',');
  const envAllowed  = [...fromAllowed, ...fromApp]
    .map(s => s.trim())
    .filter(Boolean);
  if (envAllowed.length === 0) envAllowed.push('https://car-reminder.app');
  const allowList = [...envAllowed, ...LOCAL_WEB_ORIGINS, ...extraOrigins];
  return (allowList.includes(origin) || isTrustedVercelPreview(origin)) ? origin : 'null';
}

function buildCorsHeaders(
  req: Request,
  options: { allowedHeaders?: string; allowedMethods?: string; extraOrigins?: string[] } = {},
): HeadersInit {
  return {
    'Access-Control-Allow-Origin':  pickAllowedOrigin(req, options.extraOrigins),
    'Access-Control-Allow-Headers': options.allowedHeaders || 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': options.allowedMethods || 'POST, OPTIONS',
    'Vary':                         'Origin',
  };
}

// ── End inlined helpers ────────────────────────────────────────────────────

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const DISPATCH_SECRET = Deno.env.get('DISPATCH_SECRET');

// Same dataset IDs as src/services/vehicleLookup.js — keep in sync if
// either side ever changes. tokef_dt + mivchan_acharon_dt live on the
// "private cars" dataset; kilometer_test_aharon lives on the
// "last test odometer" dataset, queried separately.
const PRIVATE_RESOURCE_ID = '053cea08-09bc-40ec-8f7a-156f0677aff3';
const LAST_KM_RESOURCE_ID = '56063a99-8a3e-4ff4-912e-5966c0279bad';
const GOV_API_BASE        = 'https://data.gov.il/api/3/action/datastore_search';

// Registries asked only about plates the private-cars dataset doesn't have.
// Both publish a test due date. Checked 2026-09-24: of 100 random plates
// from each, none was in the private dataset, so one plate can't be found
// in two registries and pick up another car's dates. Personal imports are
// 61% motorcycles, which is how some motorcycles get a date at all.
// Motorcycles and heavy vehicles registered the normal way, trailers, and
// the km dataset outside private cars: the ministry publishes no test date
// or km for them anywhere (every vehicle dataset was checked that day).
const PERSONAL_IMPORT_RESOURCE_ID = '03adc637-b6fe-402b-9937-7c3d3afc9140';  // יבוא אישי
const PUBLIC_RESOURCE_ID          = 'cf29862d-ca25-4691-84f6-1be60dcb4a1e';  // רכב ציבורי: מוניות, אוטובוסים

// צמ"ה registry: keyed by mispar_tzama, not a licence plate, and it only
// publishes a licence expiry (tokef_date). Checked 2026-09-24: numbers run
// from 145 to 999,202 (3 to 6 digits), one row per number across 32,000
// rows, and tokef_date is always present as YYYY-MM-DD.
const CME_RESOURCE_ID = '58dc4654-16b1-42ed-8170-98fadec153ea';

// Which vehicles are צמ"ה. This is the app's CME_TYPES
// (src/components/shared/DateStatusUtils.jsx), plus three labels found on
// real vehicles on 2026-09-24 that the app's list lacks: 'כלי צמ"ה',
// 'מכבש גלילי ממונע' and 'מכבש גליל ידני'. Keep the two lists in step, and
// the copy in record_gov_sync_update too (it picks the "תוקף הרישוי" wording
// from it; supabase-gov-sync-cme-2026-09-24.sql is generated from this one).
const CME_VEHICLE_TYPES = new Set([
  'מחפר', 'מחפר זחלי', 'מחפר אופני', 'מיני מחפר', 'מחפרון',
  'דחפור', 'דחפור זחלי',
  'שופל', 'מעמיס אופני', 'מעמיס זחלי', 'מיני מעמיס',
  'בובקט',
  'טליהנדלר', 'מלגזה', 'מלגזת שטח',
  'מפלסת',
  'מכבש', 'מכבש אספלט', 'מכבש קרקע', 'מכבש גלילי ממונע', 'מכבש גליל ידני',
  'מערבל בטון', 'משאבת בטון',
  'מנוף', 'מנוף נייד', 'מנוף זחלי',
  'מקדח קרקע', 'ציוד קידוח',
  'רכב צמ"ה', 'כלי צמ"ה',
  'טרקטור', 'מחרשה',
]);

// Plates per data.gov.il request. Measured 2026-09-24 against both
// datasets: 100 plates answer in 1-2s, the URL is ~1.3KB, and neither
// dataset holds more than one row per plate.
const GOV_CHUNK_SIZE = 100;

// Per-request budget. A 100-plate lookup normally takes 1-2s; 15s absorbs
// a slow response without letting one stuck request eat the run.
const GOV_TIMEOUT_MS = 15000;

// Hard upper bound on rows pulled per run. With batching the gov.il side
// is 2 requests per 100 vehicles, so the run time is now dominated by one
// RPC per vehicle. 200 keeps a run far under the 150s gateway cut, and
// RUN_BUDGET_MS below stops starting new chunks well before it anyway.
// This used to be 30 with one request pair per vehicle, which is what
// made a full cycle of ~1,000 vehicles take 35 days.
const MAX_VEHICLES_PER_RUN = 200;

// Stop starting new chunks after this much wall time. Anything not reached
// stays the oldest and leads the next run.
const RUN_BUDGET_MS = 100_000;

// How long a plate that vanished from a dataset is held for a retry before
// we accept that it is really gone (a car taken off the road leaves the
// active registry). Measured from the row's last sync, and that is why it
// is long: the rows hit on 2026-09-24 had last synced 13 to 35 days before,
// because of the 35-day backlog, and a short grace would have waved them
// through. A car that really is gone costs nothing meanwhile; it has no new
// tests to miss and is only re-asked inside a chunk we send anyway.
const MISSING_GRACE_MS = 45 * 24 * 60 * 60 * 1000;

// Pause between chunks. gov.il is a public open-data API with no
// documented quota; a handful of requests per run spaced like this is far
// below anything it should notice.
const INTER_CHUNK_DELAY_MS = 1000;

const ALLOWED_HEADERS =
  'authorization, x-client-info, x-client-ip, apikey, content-type, x-dispatch-secret';

function buildCors(req: Request): HeadersInit {
  return buildCorsHeaders(req, { allowedHeaders: ALLOWED_HEADERS });
}

function json(body: unknown, status = 200, req?: Request) {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(req ? buildCors(req) : {}),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

// Inline best-effort error reporter — see notes in send-daily-digest.
async function reportEdgeError(action: string, error: unknown, extra?: Record<string, unknown>) {
  const FN = 'gov-sync-vehicles';
  const err = error as { message?: string; stack?: string } | null;
  const message = (err?.message || String(error) || 'unknown').slice(0, 500);
  const stack = (err?.stack || '').slice(0, 2000) || null;
  try {
    console.error(JSON.stringify({ _: 'edge_error', fn: FN, action, message, ts: new Date().toISOString() }));
  } catch {}
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) return;
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await sb.from('app_errors').insert({
      type: 'edge', message, stack,
      url: `edge:/${FN}`, route: `edge:/${FN}`,
      action, severity: 'error', visible: false,
      app_version: 'edge', user_agent: 'edge-function',
      extra: { fn: FN, ...(extra || {}) },
      created_at: new Date().toISOString(),
    });
  } catch {}
}

// Constant-time compare for the dispatch secret, so response timing can't be
// used to guess it byte by byte. Security audit H-2 (2026-06-07) records this
// swap as done in every dispatch function, but it never reached git for this
// one; it lives here now so a deploy from the repo can't quietly undo it.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function authorizeCaller(
  req: Request,
  supabaseAdmin: any,
): Promise<{ ok: boolean; reason?: string }> {
  const headerSecret = req.headers.get('x-dispatch-secret');
  if (DISPATCH_SECRET && headerSecret && timingSafeEqual(headerSecret, DISPATCH_SECRET)) {
    return { ok: true };
  }
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    logSecurityEvent('gov-sync-vehicles', 'auth_failed', { reason: 'missing_authorization' });
    return { ok: false, reason: 'missing authorization' };
  }
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    logSecurityEvent('gov-sync-vehicles', 'auth_failed', { reason: error?.message || 'invalid_token' });
    return { ok: false, reason: 'invalid token' };
  }
  // Service-controlled admin check (cannot be self-elevated through
  // auth.users metadata). Same pattern check-test-renewals uses.
  const { data: isAdminFlag } = await supabaseAdmin.rpc('is_admin', { uid: user.id });
  if (isAdminFlag !== true) {
    logSecurityEvent('gov-sync-vehicles', 'permission_denied', {
      user_id: user.id,
      required: 'admin',
    });
    return { ok: false, reason: 'not an admin' };
  }
  return { ok: true };
}

type Registry = 'plate' | 'cme';

// Which registry a vehicle's number belongs to. צמ"ה numbers (3 to 6
// digits) and licence plates (5 to 8: the private dataset starts at 7, but
// ~1% of personal imports have 5 or 6) overlap in the 5-6 digit range, so
// the vehicle type decides, never the number alone. A צמ"ה-typed vehicle
// with a 7-8 digit number carries an ordinary plate (some tractors do), so
// it takes the plate route.
// The candidates query orders by last_gov_sync_attempt_at, which exists only
// once supabase-gov-sync-attempt-at-2026-09-25.sql has run. Postgres answers
// an unknown column with 42703, PostgREST's schema cache with its own PGRST
// codes; both name the column. Keyed on the name rather than one code, so a
// deploy that beats the SQL keeps syncing in the old order instead of
// failing every run. Any other error is real and is not papered over.
function isMissingAttemptColumn(err: { code?: string; message?: string }): boolean {
  return /last_gov_sync_attempt_at/.test(err.message ?? '');
}

function lookupRoute(
  raw: string | null | undefined,
  vehicleType: string | null | undefined,
): { registry: Registry; number: string } | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  // Gershayim (U+05F4) and a plain quote both appear in labels like צמ"ה.
  const type = String(vehicleType ?? '').trim().replace(/״/g, '"');
  if (CME_VEHICLE_TYPES.has(type) && digits.length >= 3 && digits.length <= 6) {
    return { registry: 'cme', number: digits };
  }
  if (digits.length >= 5 && digits.length <= 8) return { registry: 'plate', number: digits };
  return null;
}

function toDate(govDate: any): string | null {
  if (!govDate) return null;
  const s = String(govDate);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function toInt(govNum: any): number | null {
  if (govNum == null || govNum === '') return null;
  const n = Number(govNum);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

type GovTestData = { test_due_date: string | null; last_test_date: string | null };

// A failed request and a plate the ministry doesn't know must never look
// alike (see the header). `ok: false` means "we don't know", and the caller
// leaves the rows alone. A plate missing from `byPlate` means "the ministry
// answered, and has no such plate".
type GovBatch<T> =
  | { ok: true; byPlate: Map<string, T> }
  | { ok: false; reason: string };

// Both datasets store mispar_rechev as a number, so a leading zero never
// survives on their side. Key both sides the same way.
function plateKey(plate: unknown): string {
  return String(Number(plate));
}

async function fetchGovBatch(
  resourceId: string,
  plates: string[],
  fields?: string[],
  keyField = 'mispar_rechev',
): Promise<GovBatch<Record<string, unknown>>> {
  const filters = encodeURIComponent(JSON.stringify({ [keyField]: plates.map(Number) }));
  // Twice the plate count leaves room for an unexpected duplicate row, and
  // a cut-off answer is caught below instead of being trusted.
  const limit = plates.length * 2;
  const fieldParam = fields ? `&fields=${encodeURIComponent(fields.join(','))}` : '';
  const url = `${GOV_API_BASE}?resource_id=${resourceId}&filters=${filters}&limit=${limit}${fieldParam}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GOV_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const body = await res.json();
    const records = body?.result?.records;
    if (body?.success !== true || !Array.isArray(records)) {
      return { ok: false, reason: 'bad_body' };
    }
    // More matches than came back means rows were cut off. Reading the
    // missing plates as "not found" would be the same bug in a new place.
    if (typeof body.result.total === 'number' && body.result.total > records.length) {
      return { ok: false, reason: 'truncated' };
    }
    const byPlate = new Map<string, Record<string, unknown>>();
    for (const rec of records) {
      const key = plateKey(rec?.[keyField]);
      // First row wins, the same as the old one-plate query with limit=1.
      if (!byPlate.has(key)) byPlate.set(key, rec);
    }
    return { ok: true, byPlate };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    return { ok: false, reason: name === 'AbortError' ? 'timeout' : 'fetch_error' };
  } finally {
    clearTimeout(timer);
  }
}

// The private-cars and personal-import datasets share these column names.
async function fetchTestDatesFrom(resourceId: string, plates: string[]): Promise<GovBatch<GovTestData>> {
  const raw = await fetchGovBatch(resourceId, plates, ['mispar_rechev', 'tokef_dt', 'mivchan_acharon_dt']);
  if (!raw.ok) return raw;
  const byPlate = new Map<string, GovTestData>();
  for (const [key, rec] of raw.byPlate) {
    byPlate.set(key, {
      test_due_date:  toDate(rec.tokef_dt),
      last_test_date: toDate(rec.mivchan_acharon_dt),
    });
  }
  return { ok: true, byPlate };
}

async function fetchKmBatch(plates: string[]): Promise<GovBatch<number | null>> {
  // No `fields` filter here: the fallbacks below exist in case the column
  // is ever renamed, and they only help if every column comes back.
  const raw = await fetchGovBatch(LAST_KM_RESOURCE_ID, plates);
  if (!raw.ok) return raw;
  const byPlate = new Map<string, number | null>();
  for (const [key, rec] of raw.byPlate) {
    // Verified column name + fallbacks (same set as the client-side
    // fetcher in src/services/vehicleLookup.js so the two paths stay
    // bug-compatible if the dataset is ever renamed).
    const kmRaw = rec.kilometer_test_aharon
              ?? rec.kilometraj_test_aharon
              ?? rec.km_test_aharon
              ?? rec.kmrut_test_aharon;
    byPlate.set(key, toInt(kmRaw));
  }
  return { ok: true, byPlate };
}

async function fetchPublicBatch(plates: string[]): Promise<GovBatch<GovTestData>> {
  const raw = await fetchGovBatch(PUBLIC_RESOURCE_ID, plates, ['mispar_rechev', 'tokef_dt', 'bitul_cd', 'bitul_dt']);
  if (!raw.ok) return raw;
  const byPlate = new Map<string, GovTestData>();
  for (const [key, rec] of raw.byPlate) {
    // bitul_cd '0' is "not cancelled" and never has a bitul_dt; every real
    // cancellation (total loss, dismantled, deposited...) has both, checked
    // on 2,000 rows. A cancelled vehicle's due date means nothing, so its
    // record stays in the map as present-without-data: it neither updates
    // the car nor trips the mid-reload hold.
    const active = String(rec.bitul_cd ?? '') === '0' && !rec.bitul_dt;
    byPlate.set(key, {
      test_due_date:  active ? toDate(rec.tokef_dt) : null,
      last_test_date: null,  // this dataset has no last-test date
    });
  }
  return { ok: true, byPlate };
}

const NO_FALLBACK: GovBatch<GovTestData> = { ok: true, byPlate: new Map() };

async function fetchCmeBatch(numbers: string[]): Promise<GovBatch<GovTestData>> {
  const raw = await fetchGovBatch(CME_RESOURCE_ID, numbers, ['mispar_tzama', 'tokef_date'], 'mispar_tzama');
  if (!raw.ok) return raw;
  const byPlate = new Map<string, GovTestData>();
  for (const [key, rec] of raw.byPlate) {
    byPlate.set(key, {
      test_due_date:  toDate(rec.tokef_date),
      last_test_date: null,  // the צמ"ה registry has only the expiry
    });
  }
  return { ok: true, byPlate };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ── Main ───────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCors(req) });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405, req);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: 'missing service config' }, 500, req);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const auth = await authorizeCaller(req, supabaseAdmin);
  if (!auth.ok) return json({ error: auth.reason || 'unauthorized' }, 401, req);

  // Pull candidates. The partial index
  // (idx_vehicles_gov_sync_candidates) covers this filter pattern so
  // the LIMIT scan is cheap even at 10k+ vehicles.
  //
  // Queue order is by when a vehicle was last TAKEN ON, then by when it last
  // synced (2026-09-25). A held row, or one whose chunk failed, keeps its old
  // last_gov_sync_at on purpose: the 45-day hold grace counts from it. Ordered
  // by that alone, such rows stayed the oldest and every run took the same
  // ones again. On 2026-09-25 the private registry sat empty from 02:37 UTC
  // to past 10:45; ~350 cars with a test history were held, and from 07:20
  // every run took the same 200 of them, so nothing behind them (צמ"ה,
  // trucks) was ever reached. markAttempted() stamps each row a run takes on,
  // whatever the outcome, which sends it to the back of the stale queue:
  // everyone gets a turn, and held rows are retried once the rest have had
  // theirs. The column comes from supabase-gov-sync-attempt-at-2026-09-25.sql;
  // until that has run, the old order is used and nothing is stamped.
  const runStartedMs = Date.now();
  const staleCutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const selectCandidates = (byAttempt: boolean) => {
    let q = supabaseAdmin
      .from('vehicles')
      .select('id, license_plate, vehicle_type, last_gov_sync_at, last_gov_sync_test_date, last_gov_sync_km')
      .eq('auto_sync_enabled', true)
      .not('license_plate', 'is', null)
      .or(`last_gov_sync_at.is.null,last_gov_sync_at.lt.${staleCutoff}`);
    if (byAttempt) q = q.order('last_gov_sync_attempt_at', { ascending: true, nullsFirst: true });
    return q
      .order('last_gov_sync_at', { ascending: true, nullsFirst: true })
      .limit(MAX_VEHICLES_PER_RUN);
  };
  let attemptOrder = true;
  let { data: vehicles, error: vehErr } = await selectCandidates(true);
  if (vehErr && isMissingAttemptColumn(vehErr)) {
    attemptOrder = false;
    ({ data: vehicles, error: vehErr } = await selectCandidates(false));
  }

  if (vehErr) {
    await reportEdgeError('list_vehicles', vehErr);
    return json({ error: 'query failed', detail: vehErr.message }, 500, req);
  }

  const stats = {
    checked:        0,
    no_plate:       0,
    no_api_hit:     0,
    no_change:      0,
    km_updated:     0,
    test_updated:   0,
    notifications:  0,
    errors:         0,
    fetch_failed:   0,  // rows left untouched because a gov.il request failed
    held_missing:   0,  // rows held because a dataset lost a plate it had before
    found_personal_import: 0,  // test dates from the personal-import registry
    found_public:   0,  // test dates from the public-vehicle registry
    found_cme:      0,  // licence expiries from the צמ"ה registry
    deferred:       0,  // rows not reached this run; they lead the next one
    attempt_order:  attemptOrder,  // false = the attempt column doesn't exist yet
    started_at:     new Date().toISOString(),
    finished_at:    null as string | null,
    samples:        [] as Array<{
      vehicle_id: string;
      km_updated: boolean;
      test_updated: boolean;
      notification_id: string | null;
    }>,
  };

  type Row = {
    id: string;
    number: string;      // plate or צמ"ה number, digits only
    registry: Registry;
    lastSyncMs: number;  // last successful sync, 0 if never
    hadTest: boolean;    // a registry gave us a test date last time
    hadKm: boolean;      // the km dataset gave us a reading last time
  };

  // Sends the rows a run takes on to the back of the queue; see
  // selectCandidates above. One statement per chunk, before its requests, so
  // even a chunk that crashes the run can't keep the front of the queue.
  // Note: vehicles.updated_at moves with it (set_updated_at trigger), as it
  // already does on every sync; nothing reads it for vehicles today.
  const markAttempted = async (ids: string[]) => {
    if (!attemptOrder || ids.length === 0) return;
    const { error } = await supabaseAdmin
      .from('vehicles')
      .update({ last_gov_sync_attempt_at: new Date().toISOString() })
      .in('id', ids);
    if (error) await reportEdgeError('mark_attempted', error, { rows: ids.length });
  };

  // Rows with no usable number first: they never reach gov.il, so they
  // must not wait behind a chunk that might fail.
  const rows: Row[] = [];
  for (const v of (vehicles || [])) {
    const route = lookupRoute(v.license_plate, v.vehicle_type);
    if (!route) {
      stats.checked++;
      stats.no_plate++;
      // Still stamp last_gov_sync_at so we don't keep retrying this
      // row forever — the user can fix the plate and the next sweep
      // will pick it up via the 20h staleness clock.
      const now = new Date().toISOString();
      await supabaseAdmin
        .from('vehicles')
        .update(attemptOrder
          ? { last_gov_sync_at: now, last_gov_sync_attempt_at: now }
          : { last_gov_sync_at: now })
        .eq('id', v.id);
      continue;
    }
    rows.push({
      id: v.id,
      number: route.number,
      registry: route.registry,
      lastSyncMs: v.last_gov_sync_at ? Date.parse(v.last_gov_sync_at) || 0 : 0,
      hadTest: v.last_gov_sync_test_date != null,
      hadKm: v.last_gov_sync_km != null,
    });
  }

  // Everything that happens to one row once its lookups are in. testRec is
  // undefined when no registry had the number; kmPresent is whether the km
  // dataset had a record (a 0 reading still counts as a record).
  const settle = async (
    v: Row,
    testRec: GovTestData | undefined,
    km: number | null,
    kmPresent: boolean,
  ): Promise<void> => {
    stats.checked++;
    const testData = testRec ?? { test_due_date: null, last_test_date: null };

    // A dataset that answered but no longer has a plate it gave us data
    // for last time is most likely mid-reload (see the header), not a car
    // that vanished. Hold the row: no sync stamp, no RPC; it is retried
    // after the rest of the queue (it was already stamped as attempted).
    // Believing it would write a half-update and lose the rest for good,
    // because the RPC applies a given test date only once.
    const testGone = v.hadTest && testRec === undefined;
    const kmGone = v.hadKm && !kmPresent;
    if ((testGone || kmGone) && Date.now() - v.lastSyncMs < MISSING_GRACE_MS) {
      stats.held_missing++;
      return;
    }

    // The registries answered and none has anything we sync for this
    // number. Stamp the sync-at so we don't re-ask every run, but don't
    // touch any other field.
    if (!testData.test_due_date && !testData.last_test_date && km == null) {
      stats.no_api_hit++;
      await supabaseAdmin
        .from('vehicles')
        .update({ last_gov_sync_at: new Date().toISOString() })
        .eq('id', v.id);
      return;
    }

    // Hand off to the RPC. The RPC does the compare + write +
    // notify + idempotency journal atomically. We pass everything
    // we know and let it decide what to actually apply.
    const { data: rpcData, error: rpcErr } = await supabaseAdmin
      .rpc('record_gov_sync_update', {
        p_vehicle_id:        v.id,
        p_gov_km:            km,
        p_gov_test_date:     testData.last_test_date,
        p_gov_test_due_date: testData.test_due_date,
      });

    if (rpcErr) {
      stats.errors++;
      // Don't stamp last_gov_sync_at on RPC failure: the next run should
      // retry this vehicle. Surface the error in logs for debugging.
      console.error('record_gov_sync_update failed', v.id, rpcErr.message);
      await reportEdgeError('record_gov_sync_update_rpc', rpcErr, { vehicle_id: v.id });
      return;
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row || row.was_new === false) {
      stats.no_change++;
      return;
    }

    if (row.km_updated) stats.km_updated++;
    if (row.test_updated) stats.test_updated++;
    if (row.notification_id) stats.notifications++;

    if (stats.samples.length < 10) {
      stats.samples.push({
        vehicle_id:      v.id,
        km_updated:      !!row.km_updated,
        test_updated:    !!row.test_updated,
        notification_id: row.notification_id || null,
      });
    }
  };

  // Plate chunks first, then צמ"ה chunks. Each chunk goes to its own
  // registries, so a number is never asked of a registry it can't belong to.
  const chunks: Array<{ registry: Registry; rows: Row[] }> = [];
  for (const registry of ['plate', 'cme'] as const) {
    const ofKind = rows.filter((r) => r.registry === registry);
    for (let i = 0; i < ofKind.length; i += GOV_CHUNK_SIZE) {
      chunks.push({ registry, rows: ofKind.slice(i, i + GOV_CHUNK_SIZE) });
    }
  }

  for (let c = 0; c < chunks.length; c++) {
    if (Date.now() - runStartedMs > RUN_BUDGET_MS) {
      stats.deferred += chunks.slice(c).reduce((n, ch) => n + ch.rows.length, 0);
      break;
    }
    if (c > 0) await sleep(INTER_CHUNK_DELAY_MS);

    const chunk = chunks[c].rows;
    await markAttempted(chunk.map((r) => r.id));
    // One car can sit in several accounts, one row each. Ask about it once.
    const numbers = [...new Set(chunk.map((r) => r.number))];

    if (chunks[c].registry === 'cme') {
      const cme = await fetchCmeBatch(numbers);
      if (!cme.ok) {
        // Same rule as a failed plate chunk below: leave the rows exactly
        // as they are; they are retried after the rest of the queue.
        stats.fetch_failed += chunk.length;
        await reportEdgeError('gov_cme_fetch_failed', new Error('data.gov.il צמ"ה request failed'), {
          cme: cme.reason,
          chunk_size: chunk.length,
        });
        continue;
      }
      for (const v of chunk) {
        const testRec = cme.byPlate.get(plateKey(v.number));
        if (testRec !== undefined) stats.found_cme++;
        // No km registry exists for צמ"ה, so there is nothing to be absent.
        await settle(v, testRec, null, false);
      }
      continue;
    }

    // Parallel: two distinct datasets, no need to serialise.
    const [tests, kms] = await Promise.all([
      fetchTestDatesFrom(PRIVATE_RESOURCE_ID, numbers),
      fetchKmBatch(numbers),
    ]);

    if (!tests.ok || !kms.ok) {
      // Leave every row of this chunk exactly as it is: no sync stamp, no
      // RPC, no notification. They stay due and are retried after the rest
      // of the queue. Carry on with the next chunk instead of stopping: a
      // run has only a few chunks, so that costs a request or two, and a
      // chunk that fails every time (a data shape we don't expect, say)
      // can't freeze everything behind it.
      stats.fetch_failed += chunk.length;
      await reportEdgeError('gov_fetch_failed', new Error('data.gov.il batch request failed'), {
        test_dates: tests.ok ? 'ok' : tests.reason,
        km:         kms.ok ? 'ok' : kms.reason,
        chunk_size: chunk.length,
      });
      continue;
    }

    // Plates the private-cars dataset doesn't know may be personal imports
    // or public vehicles. Ask those two registries about them only.
    const missing = numbers.filter((p) => !tests.byPlate.has(plateKey(p)));
    const [imports, publics] = missing.length > 0
      ? await Promise.all([
          fetchTestDatesFrom(PERSONAL_IMPORT_RESOURCE_ID, missing),
          fetchPublicBatch(missing),
        ])
      : [NO_FALLBACK, NO_FALLBACK] as const;
    if (!imports.ok || !publics.ok) {
      await reportEdgeError('gov_fallback_fetch_failed', new Error('data.gov.il fallback request failed'), {
        personal_import: imports.ok ? 'ok' : imports.reason,
        public:          publics.ok ? 'ok' : publics.reason,
        plates:          missing.length,
      });
    }

    for (const v of chunk) {
      const key = plateKey(v.number);
      let testRec = tests.byPlate.get(key);
      if (testRec === undefined) {
        // Only rows the private dataset didn't know depend on the
        // fallbacks. If one of those requests failed we can't tell "not a
        // personal import" from "didn't hear back", so leave the row for
        // the next run, exactly as a failed main request would.
        if (!imports.ok || !publics.ok) {
          stats.fetch_failed++;
          continue;
        }
        testRec = imports.byPlate.get(key);
        if (testRec !== undefined) {
          stats.found_personal_import++;
        } else {
          testRec = publics.byPlate.get(key);
          if (testRec !== undefined) stats.found_public++;
        }
      }
      await settle(v, testRec, kms.byPlate.get(key) ?? null, kms.byPlate.has(key));
    }
  }

  stats.finished_at = new Date().toISOString();
  // The documented cron calls net.http_post without timeout_milliseconds,
  // so pg_net stops waiting long before a run ends and this summary never
  // reaches net._http_response. The function log is the only record of
  // what a cron run did, so write it there.
  console.log(JSON.stringify({ _: 'gov_sync_run', ...stats, samples: undefined }));
  return json(stats, 200, req);
});

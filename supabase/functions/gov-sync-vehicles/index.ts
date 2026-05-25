// ═══════════════════════════════════════════════════════════════════════════
// gov-sync-vehicles — Supabase Edge Function that mirrors fresh
// data.gov.il vehicle data back onto our `vehicles` table once a day.
//
// What it syncs:
//   • current_km           — but only when the user hasn't manually
//                            overridden it after the last gov test
//   • last_test_date       — forward in time only
//   • test_due_date        — forward in time only
//   • last_gov_sync_at     — always (heartbeat)
//   • last_gov_sync_km     — always (sync-snapshot)
//   • last_gov_sync_test_date — always (sync-snapshot)
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
//      Sorted oldest-synced-first, capped at MAX_VEHICLES_PER_RUN.
//   3. For each candidate, in parallel-of-2:
//         a. fetchTokefDt(plate)            → test_due_date / last_test_date
//         b. fetchLastTestKm(plate)         → current_km
//      Both wrapped in their own 6s timeout. Failure to fetch is a
//      per-row no-op, not a run failure.
//   4. Call record_gov_sync_update(vehicle_id, gov_km, gov_test_date,
//      gov_test_due_date). The RPC handles the compare + write +
//      notification + idempotency log atomically.
//   5. Build a JSON summary and return it.
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

// Per-row gov.il request budget. Long enough to absorb a slow
// response, short enough that a stuck endpoint doesn't time-out the
// whole cron run on a 50-vehicle batch.
const GOV_TIMEOUT_MS = 6000;

// Hard upper bound on rows pulled per run. Supabase's HTTP gateway
// disconnects after 150s, so we size the batch + inter-row delay to
// finish under that. 30 × (~2s API pair + 0.8s sleep) ≈ 84s plus
// per-row RPC overhead, leaving headroom for slow gov.il calls.
// If platform grows, run the cron more often rather than enlarge
// the batch — successive runs pick up the next-oldest sync via the
// 20h staleness clock.
const MAX_VEHICLES_PER_RUN = 30;

// Spacing between row processing. Gov.il is a public open-data API
// with no documented quota, but the polite-citizen rate is ~1 req/sec.
// We do 2 calls per vehicle in parallel + 800ms sleep between rows.
const INTER_ROW_DELAY_MS = 800;

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

async function authorizeCaller(
  req: Request,
  supabaseAdmin: any,
): Promise<{ ok: boolean; reason?: string }> {
  const headerSecret = req.headers.get('x-dispatch-secret');
  if (DISPATCH_SECRET && headerSecret && headerSecret === DISPATCH_SECRET) {
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

function normalizePlate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 8) return null;
  return digits;
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

async function fetchTestDates(plate: string): Promise<GovTestData> {
  const filters = encodeURIComponent(JSON.stringify({ mispar_rechev: plate }));
  const url = `${GOV_API_BASE}?resource_id=${PRIVATE_RESOURCE_ID}&filters=${filters}&limit=1`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GOV_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { test_due_date: null, last_test_date: null };
    const body = await res.json();
    const rec = body?.result?.records?.[0];
    if (!rec) return { test_due_date: null, last_test_date: null };
    return {
      test_due_date:  toDate(rec.tokef_dt),
      last_test_date: toDate(rec.mivchan_acharon_dt),
    };
  } catch {
    return { test_due_date: null, last_test_date: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLastTestKm(plate: string): Promise<number | null> {
  const filters = encodeURIComponent(JSON.stringify({ mispar_rechev: Number(plate) }));
  const url = `${GOV_API_BASE}?resource_id=${LAST_KM_RESOURCE_ID}&filters=${filters}&limit=1`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GOV_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = await res.json();
    const rec = body?.result?.records?.[0];
    if (!rec) return null;
    // Verified column name + fallbacks (same set as the client-side
    // fetcher in src/services/vehicleLookup.js so the two paths stay
    // bug-compatible if the dataset is ever renamed).
    const raw = rec.kilometer_test_aharon
            ?? rec.kilometraj_test_aharon
            ?? rec.km_test_aharon
            ?? rec.kmrut_test_aharon;
    return toInt(raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  // the LIMIT-50 scan is cheap even at 10k+ vehicles.
  const staleCutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
  const { data: vehicles, error: vehErr } = await supabaseAdmin
    .from('vehicles')
    .select('id, license_plate, last_gov_sync_at')
    .eq('auto_sync_enabled', true)
    .not('license_plate', 'is', null)
    .or(`last_gov_sync_at.is.null,last_gov_sync_at.lt.${staleCutoff}`)
    .order('last_gov_sync_at', { ascending: true, nullsFirst: true })
    .limit(MAX_VEHICLES_PER_RUN);

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
    started_at:     new Date().toISOString(),
    finished_at:    null as string | null,
    samples:        [] as Array<{
      vehicle_id: string;
      km_updated: boolean;
      test_updated: boolean;
      notification_id: string | null;
    }>,
  };

  for (const v of (vehicles || [])) {
    stats.checked++;

    const plate = normalizePlate(v.license_plate);
    if (!plate) {
      stats.no_plate++;
      // Still stamp last_gov_sync_at so we don't keep retrying this
      // row forever — the user can fix the plate and the next sweep
      // will pick it up via the 20h staleness clock.
      await supabaseAdmin
        .from('vehicles')
        .update({ last_gov_sync_at: new Date().toISOString() })
        .eq('id', v.id);
      continue;
    }

    let testData: GovTestData = { test_due_date: null, last_test_date: null };
    let km: number | null = null;
    try {
      // Parallel — two distinct datasets, no need to serialise.
      const [t, k] = await Promise.all([
        fetchTestDates(plate),
        fetchLastTestKm(plate),
      ]);
      testData = t;
      km = k;
    } catch {
      stats.errors++;
      continue;
    }

    // Nothing useful came back. Stamp the sync-at so we don't retry
    // the same dead plate every run, but don't touch any other field.
    if (!testData.test_due_date && !testData.last_test_date && km == null) {
      stats.no_api_hit++;
      await supabaseAdmin
        .from('vehicles')
        .update({ last_gov_sync_at: new Date().toISOString() })
        .eq('id', v.id);
      continue;
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
      // Don't stamp last_gov_sync_at on RPC failure — next run should
      // retry this vehicle. Surface the error in logs for debugging.
      console.error('record_gov_sync_update failed', v.id, rpcErr.message);
      await reportEdgeError('record_gov_sync_update_rpc', rpcErr, { vehicle_id: v.id });
      continue;
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row || row.was_new === false) {
      stats.no_change++;
      continue;
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

    await sleep(INTER_ROW_DELAY_MS);
  }

  stats.finished_at = new Date().toISOString();
  return json(stats, 200, req);
});

// ═══════════════════════════════════════════════════════════════════════════
// check-test-renewals — Supabase Edge Function that detects when a vehicle's
// annual test (טסט) has been renewed at משרד התחבורה and updates the local
// record + notifies the owner.
//
// Pipeline per invocation:
//
//   1. Authenticate the caller (shared secret OR admin JWT).
//   2. Pull every vehicle whose `test_due_date` falls in
//      [today − 7 days, today + 30 days]. Older windows almost
//      never matter; newer windows are dominated by users who haven't
//      done the test yet (no renewal to detect).
//   3. For each vehicle:
//        a. Skip if `license_plate` is missing or non-numeric (we
//           can't query data.gov.il without it).
//        b. Query the gov.il datastore by `mispar_rechev` filter,
//           fetch the row's `tokef_dt`.
//        c. If `tokef_dt` is strictly later than the stored
//           `test_due_date`, call `record_test_renewal()` RPC. The
//           RPC handles the update + bell notification + idempotency
//           atomically.
//   4. Return a JSON summary: how many were checked, how many were
//      renewed, how many had no plate / no API match / API errors.
//
// Deploy:
//   Dashboard → Edge Functions → Deploy new function → paste this file →
//   name it `check-test-renewals` → Deploy.
//   Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//                     DISPATCH_SECRET (same one used by
//                     dispatch-reminder-emails — they share the
//                     "trusted cron caller" credential).
//   Verify JWT: OFF (called by pg_cron with service role).
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const DISPATCH_SECRET = Deno.env.get('DISPATCH_SECRET');
const ALLOWED_ORIGIN  = Deno.env.get('APP_ORIGIN') || 'https://car-reminder.app';

const LOCAL_WEB_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

// Same datastore the client-side vehicleLookup uses. Keep in sync with
// src/services/vehicleLookup.js — RESOURCE_ID for "רכב 4 גלגלים".
const RESOURCE_ID    = '053cea08-09bc-40ec-8f7a-156f0677aff3';
const GOV_API_BASE   = 'https://data.gov.il/api/3/action/datastore_search';
// Per-row gov.il request budget. Long enough to absorb the rare slow
// response, short enough that a stuck endpoint doesn't time out the
// whole cron run on a fleet of 200+ vehicles.
const GOV_TIMEOUT_MS = 6000;

// Window of vehicles we bother to check. A vehicle whose test is due
// in 90 days hasn't been tested yet; a vehicle whose test was due 60
// days ago is either off-road or the user already updated manually.
// 7 days back covers the common "did the test on the morning of
// expiry, ministry record updated overnight" path.
const WINDOW_BACK_DAYS    = 7;
const WINDOW_FORWARD_DAYS = 30;

// Hard upper bound on rows pulled per run. A scheduled job that hits
// 5000 vehicles at once wedges the data.gov.il endpoint and our own
// RPC pipeline. If the platform ever grows past this, batch with a
// continuation cursor — but at < 5000 active vehicles a single run
// is fine.
const MAX_VEHICLES_PER_RUN = 2000;

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
  } catch { return false; }
}

function buildCors(req: Request): HeadersInit {
  const origin = req.headers.get('origin') || '';
  const allowList = [
    ...ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean),
    ...LOCAL_WEB_ORIGINS,
  ];
  const allow = (allowList.includes(origin) || isTrustedVercelPreview(origin)) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, x-client-ip, apikey, content-type, x-dispatch-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary':                         'Origin',
  };
}

function json(body: unknown, status = 200, req?: Request) {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(req ? buildCors(req) : {}),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

async function authorizeCaller(req: Request, supabaseAdmin: any): Promise<{ ok: boolean; reason?: string }> {
  const headerSecret = req.headers.get('x-dispatch-secret');
  if (DISPATCH_SECRET && headerSecret && headerSecret === DISPATCH_SECRET) {
    return { ok: true };
  }
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, reason: 'missing authorization' };
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return { ok: false, reason: 'invalid token' };
  const role = (user.user_metadata as any)?.role;
  if (role !== 'admin') return { ok: false, reason: 'not an admin' };
  return { ok: true };
}

// Strip non-digits and validate. Israeli plates are 7-8 digits; the
// gov.il datastore stores them as integers, so we coerce to a clean
// digit string before sending.
function normalizePlate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 8) return null;
  return digits;
}

// gov.il returns dates as 'YYYY-MM-DDTHH:MM:SS'. Strip to YYYY-MM-DD
// so it round-trips cleanly into a date column.
function toDate(govDate: any): string | null {
  if (!govDate) return null;
  const s = String(govDate);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function fetchTokefDt(plate: string): Promise<string | null> {
  // CKAN's `filters` parameter accepts a JSON object; using it instead
  // of `q` ensures we match on `mispar_rechev` exactly (no full-text
  // false positives where a 7-digit plate substring shows up inside
  // a chassis number on a different vehicle).
  const filters = encodeURIComponent(JSON.stringify({ mispar_rechev: plate }));
  const url = `${GOV_API_BASE}?resource_id=${RESOURCE_ID}&filters=${filters}&limit=1`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GOV_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = await res.json();
    const records = body?.result?.records;
    if (!Array.isArray(records) || records.length === 0) return null;
    return toDate(records[0].tokef_dt);
  } catch {
    // Timeout or transient network error — caller treats as "no data
    // this run", we'll try again tomorrow.
    return null;
  } finally {
    clearTimeout(timer);
  }
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

  const today      = new Date();
  const back       = new Date(today); back.setDate(today.getDate() - WINDOW_BACK_DAYS);
  const forward    = new Date(today); forward.setDate(today.getDate() + WINDOW_FORWARD_DAYS);
  const backStr    = back.toISOString().slice(0, 10);
  const forwardStr = forward.toISOString().slice(0, 10);

  // Pull the candidate set. Service role bypasses RLS — that's the
  // whole point of this function being SECURITY DEFINER on the inside.
  const { data: vehicles, error: vehErr } = await supabaseAdmin
    .from('vehicles')
    .select('id, account_id, license_plate, test_due_date, nickname')
    .gte('test_due_date', backStr)
    .lte('test_due_date', forwardStr)
    .not('license_plate', 'is', null)
    .limit(MAX_VEHICLES_PER_RUN);

  if (vehErr) {
    return json({ error: 'query failed', detail: vehErr.message }, 500, req);
  }

  const stats = {
    checked:    0,
    no_plate:   0,
    no_api_hit: 0,
    no_change:  0,
    renewed:    0,
    errors:     0,
    started_at: new Date().toISOString(),
    finished_at: null as string | null,
    samples:    [] as Array<{ vehicle_id: string; from: string | null; to: string }>,
  };

  for (const v of (vehicles || [])) {
    stats.checked++;
    const plate = normalizePlate(v.license_plate);
    if (!plate) { stats.no_plate++; continue; }

    let tokefDt: string | null = null;
    try {
      tokefDt = await fetchTokefDt(plate);
    } catch {
      stats.errors++;
      continue;
    }

    if (!tokefDt) { stats.no_api_hit++; continue; }
    if (v.test_due_date && tokefDt <= v.test_due_date) { stats.no_change++; continue; }

    // Renewed → call the RPC. Atomic update + notification + log.
    const { data: rpcData, error: rpcErr } = await supabaseAdmin
      .rpc('record_test_renewal', {
        p_vehicle_id:        v.id,
        p_new_test_due_date: tokefDt,
      });

    if (rpcErr) {
      stats.errors++;
      continue;
    }
    // RPC returns a single-row table. If `was_new` is true we count it,
    // otherwise it was a duplicate within the same window (re-run).
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (row?.was_new) {
      stats.renewed++;
      if (stats.samples.length < 5) {
        stats.samples.push({
          vehicle_id: v.id,
          from:       v.test_due_date,
          to:         tokefDt,
        });
      }
    } else {
      stats.no_change++;
    }
  }

  stats.finished_at = new Date().toISOString();
  return json(stats, 200, req);
});

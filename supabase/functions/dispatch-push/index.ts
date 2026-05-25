// ═══════════════════════════════════════════════════════════════════════════
// dispatch-push — server-side push notification fan-out.
//
// Called by other Edge Functions (or by Postgres triggers via http.send) to
// deliver a push to every device a given user is signed into. Routes per
// platform:
//
//   • android tokens → FCM HTTP v1 API
//                       (https://fcm.googleapis.com/v1/projects/{id}/messages:send)
//   • ios tokens     → APNs HTTP/2 API
//                       (https://api.push.apple.com/3/device/{token} or sandbox)
//
// Inputs (POST body, JSON):
//   {
//     "user_id": "uuid",                 // required
//     "title":   "string",               // required
//     "body":    "string",               // required
//     "data":    { "vehicle_id": "..." } // optional — passed through to
//                                          the client for deep-linking via
//                                          the `cr:push-tapped` window event
//   }
//
// Auth: requires SUPABASE_SERVICE_ROLE_KEY in the `apikey` header, OR a
// shared DISPATCH_SECRET in `x-dispatch-secret`. Browser callers go
// through the standard supabase-js `invoke()` which sends the user's JWT
// — those are rejected here because user-initiated push fan-out doesn't
// make sense.
//
// Deploy:
//   supabase functions deploy dispatch-push --no-verify-jwt
//
// Required secrets (set via Supabase Dashboard → Project Settings →
// Edge Functions → Secrets, OR via `supabase secrets set ...`):
//
//   FCM_PROJECT_ID            (e.g. "carreminder-bd40c")
//   FCM_SERVICE_ACCOUNT_JSON  (the full Firebase Admin SDK JSON, single line)
//   APNS_KEY_P8               (the full text of AuthKey_XXXXXXXXXX.p8)
//   APNS_KEY_ID               (10-char Key ID from the .p8 filename)
//   APNS_TEAM_ID              (10-char Team ID from developer.apple.com)
//   APNS_BUNDLE_ID            ("com.carreminders.app")
//   APNS_USE_SANDBOX          ("true" for TestFlight / dev builds, "false"
//                              for App Store. Apple uses different push
//                              hosts per environment — wrong one returns
//                              BadDeviceToken silently.)
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { reportEdgeError } from '../_shared/reportEdgeError.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DISPATCH_SECRET = Deno.env.get('DISPATCH_SECRET') || '';

const FCM_PROJECT_ID    = Deno.env.get('FCM_PROJECT_ID') || '';
const FCM_SA_JSON_RAW   = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON') || '';

const APNS_KEY_P8       = Deno.env.get('APNS_KEY_P8') || '';
const APNS_KEY_ID       = Deno.env.get('APNS_KEY_ID') || '';
const APNS_TEAM_ID      = Deno.env.get('APNS_TEAM_ID') || '';
const APNS_BUNDLE_ID    = Deno.env.get('APNS_BUNDLE_ID') || '';
const APNS_USE_SANDBOX  = (Deno.env.get('APNS_USE_SANDBOX') || 'true') === 'true';
const APNS_HOST = APNS_USE_SANDBOX
  ? 'https://api.sandbox.push.apple.com'
  : 'https://api.push.apple.com';

// ─── Shared utilities ──────────────────────────────────────────────────────

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlEncodeStr(s: string): string {
  return b64urlEncode(new TextEncoder().encode(s));
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ─── APNs JWT (ES256 over P-256) ──────────────────────────────────────────

async function importApnsKey(): Promise<CryptoKey> {
  const der = pemToDer(APNS_KEY_P8);
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

// APNs JWTs are valid for up to 60 minutes. We cache for 50 minutes to
// stay comfortably inside that window even if the function gets cold.
let apnsJwtCache: { token: string; exp: number } | null = null;

async function getApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwtCache && apnsJwtCache.exp - 300 > now) return apnsJwtCache.token;

  const header = { alg: 'ES256', kid: APNS_KEY_ID };
  const claims = { iss: APNS_TEAM_ID, iat: now };
  const signingInput = `${b64urlEncodeStr(JSON.stringify(header))}.${b64urlEncodeStr(JSON.stringify(claims))}`;

  const key = await importApnsKey();
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${b64urlEncode(new Uint8Array(sigBuf))}`;
  apnsJwtCache = { token: jwt, exp: now + 60 * 50 };
  return jwt;
}

async function sendApns(deviceToken: string, title: string, body: string, data: Record<string, unknown>) {
  const jwt = await getApnsJwt();
  const payload = {
    aps: {
      alert: { title, body },
      sound: 'default',
      'mutable-content': 1,
    },
    ...data,
  };
  const res = await fetch(`${APNS_HOST}/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      'authorization':    `bearer ${jwt}`,
      'apns-topic':       APNS_BUNDLE_ID,
      'apns-push-type':   'alert',
      'apns-priority':    '10',
      'content-type':     'application/json',
    },
    body: JSON.stringify(payload),
  });
  // APNs returns 200 OK on success with no body. On failure it returns
  // JSON with a "reason" field — BadDeviceToken / Unregistered means
  // we should prune the row.
  if (res.ok) return { ok: true, stale: false };
  const text = await res.text();
  let reason = '';
  try { reason = JSON.parse(text)?.reason || ''; } catch {}
  const stale = reason === 'BadDeviceToken' || reason === 'Unregistered';
  return { ok: false, stale, status: res.status, reason };
}

// ─── FCM OAuth2 (Service Account → access_token) ─────────────────────────

let fcmTokenCache: { token: string; exp: number } | null = null;

async function getFcmAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (fcmTokenCache && fcmTokenCache.exp - 300 > now) return fcmTokenCache.token;

  const sa = JSON.parse(FCM_SA_JSON_RAW);
  const header = { alg: 'RS256', typ: 'JWT', kid: sa.private_key_id };
  const claims = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  };
  const signingInput = `${b64urlEncodeStr(JSON.stringify(header))}.${b64urlEncodeStr(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64urlEncode(new Uint8Array(sigBuf))}`;

  // Exchange JWT for an access token.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!tokenRes.ok) throw new Error(`fcm oauth: ${tokenRes.status} ${await tokenRes.text()}`);
  const j = await tokenRes.json();
  fcmTokenCache = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

async function sendFcm(deviceToken: string, title: string, body: string, data: Record<string, unknown>) {
  const accessToken = await getFcmAccessToken();
  // FCM v1 data values must be strings — stringify anything that isn't.
  const dataStr: Record<string, string> = {};
  for (const [k, v] of Object.entries(data || {})) {
    dataStr[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  const payload = {
    message: {
      token: deviceToken,
      notification: { title, body },
      android: { priority: 'HIGH', notification: { channel_id: 'car-reminders' } },
      data: dataStr,
    },
  };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${accessToken}`,
      'content-type':  'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true, stale: false };
  const text = await res.text();
  // FCM returns 404 with error.status="NOT_FOUND" for unregistered tokens,
  // and 400 with "INVALID_ARGUMENT" for malformed ones.
  const stale = res.status === 404 || /UNREGISTERED|NOT_FOUND/i.test(text);
  return { ok: false, stale, status: res.status, reason: text.slice(0, 200) };
}

// ─── Main handler ─────────────────────────────────────────────────────────

interface PushRequest {
  user_id: string;
  title:   string;
  body:    string;
  data?:   Record<string, unknown>;
}

interface DispatchSummary {
  sent:    number;
  failed:  number;
  pruned:  number;
  errors:  Array<{ token: string; reason: string }>;
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-headers': 'authorization, content-type, apikey, x-dispatch-secret' } });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  // Auth — service role apikey OR shared dispatch secret. No public access.
  const apikey  = req.headers.get('apikey') || '';
  const secret  = req.headers.get('x-dispatch-secret') || '';
  const authed = (apikey === SERVICE_ROLE) || (DISPATCH_SECRET && secret === DISPATCH_SECRET);
  if (!authed) return json({ error: 'unauthorized' }, 401);

  let body: PushRequest;
  try { body = await req.json(); }
  catch { return json({ error: 'invalid json' }, 400); }

  const { user_id, title, body: text, data } = body;
  if (!user_id || !title || !text) {
    return json({ error: 'user_id, title, body required' }, 400);
  }

  // Fetch device tokens for this user.
  const { data: rows, error } = await supabase
    .from('device_tokens')
    .select('token, platform')
    .eq('user_id', user_id);
  if (error) return json({ error: `db: ${error.message}` }, 500);
  if (!rows || rows.length === 0) {
    return json({ sent: 0, failed: 0, pruned: 0, errors: [], reason: 'no devices' }, 200);
  }

  const summary: DispatchSummary = { sent: 0, failed: 0, pruned: 0, errors: [] };

  for (const row of rows) {
    try {
      let result;
      if (row.platform === 'android') {
        if (!FCM_PROJECT_ID || !FCM_SA_JSON_RAW) {
          result = { ok: false, stale: false, reason: 'fcm not configured' };
        } else {
          result = await sendFcm(row.token, title, text, data || {});
        }
      } else if (row.platform === 'ios') {
        if (!APNS_KEY_P8 || !APNS_KEY_ID || !APNS_TEAM_ID || !APNS_BUNDLE_ID) {
          result = { ok: false, stale: false, reason: 'apns not configured' };
        } else {
          result = await sendApns(row.token, title, text, data || {});
        }
      } else {
        result = { ok: false, stale: false, reason: `unsupported platform: ${row.platform}` };
      }

      if (result.ok) {
        summary.sent++;
      } else {
        summary.failed++;
        summary.errors.push({ token: row.token.slice(0, 12) + '…', reason: String(result.reason || result.status || 'unknown') });
        if (result.stale) {
          const { data: pruned } = await supabase.rpc('prune_stale_device_token', { p_token: row.token });
          if (pruned) summary.pruned += pruned as number;
        }
      }
    } catch (e: unknown) {
      summary.failed++;
      summary.errors.push({ token: row.token.slice(0, 12) + '…', reason: (e as Error)?.message || 'exception' });
      // Persist to app_errors. Per-token failures are common (stale
      // FCM tokens, transient APNs) — log only when severity > info to
      // avoid flooding the table.
      await reportEdgeError({
        fn: 'dispatch-push',
        action: 'send_to_token',
        error: e,
        severity: 'warning',
        userId: row.user_id ?? null,
        extra: { platform: row.platform, token_prefix: row.token?.slice(0, 12) },
      });
    }
  }

  return json(summary, 200);
});

function json(o: unknown, status: number): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
  });
}

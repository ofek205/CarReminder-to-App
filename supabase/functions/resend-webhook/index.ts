// ═══════════════════════════════════════════════════════════════════════════
// resend-webhook — receives events from Resend and writes them to the
// email_events table via the SECURITY DEFINER RPC ingest_resend_event().
//
// Event shape from Resend (https://resend.com/docs/dashboard/webhooks/events):
//   {
//     type:       "email.delivered" | "email.opened" | "email.bounced" | ...,
//     created_at: "2026-04-20T12:34:56Z",
//     data: {
//       email_id:  "abc...",    <- the Resend message id we stored in send_log
//       from:      "no-reply@car-reminder.app",
//       to:        ["user@example.com"],
//       subject:   "...",
//       ... more per event type
//     }
//   }
//
// Security:
//   • Resend signs each webhook with an HMAC (svix format). The function
//     verifies the signature against RESEND_WEBHOOK_SECRET and rejects
//     unsigned / tampered / unconfigured requests — `verifySvix` returns
//     false when WEBHOOK_SECRET is missing, failing closed. Treat the
//     secret as a production deployment requirement.
//   • Verify JWT: OFF (Resend can't send a Supabase JWT).
//
// Deploy:
//   Dashboard → Edge Functions → Deploy new function → name = `resend-webhook`
//   → paste this file → Deploy.
//   Configure RESEND_WEBHOOK_SECRET in Secrets, then register the webhook
//   URL in Resend Dashboard → Webhooks.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE          = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const WEBHOOK_SECRET        = Deno.env.get('RESEND_WEBHOOK_SECRET'); // optional

// Resend webhook only receives POSTs from Resend's servers. No browser
// should reach it, so CORS is minimal. We still set Origin for the
// infrequent cases where a browser OPTIONS lands.
const corsHeaders: HeadersInit = {
  'Access-Control-Allow-Origin':  'null',
  'Access-Control-Allow-Headers': 'content-type, svix-id, svix-timestamp, svix-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Inline best-effort error reporter — see notes in send-daily-digest.
async function reportEdgeError(action: string, error: unknown, extra?: Record<string, unknown>) {
  const FN = 'resend-webhook';
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

// Resend uses Svix for webhook signing. The signature is:
//   base64(hmac_sha256(secret, svix_id + "." + svix_timestamp + "." + body))
// Verified against the `svix-signature` header (space-separated list of
// `v1,base64signature` values).
//
// SECURITY: In this hardened version we REQUIRE a secret. Without one
// configured, the function refuses all requests. Previously a missing
// secret silently accepted everything, which let any attacker forge
// email events.
async function verifySvix(body: string, headers: Headers): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false;  // fail closed when unconfigured
  const svixId        = headers.get('svix-id');
  const svixTimestamp = headers.get('svix-timestamp');
  const svixSignature = headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Replay protection: reject webhooks older than 5 minutes.
  // Without this, an attacker who captured a valid webhook could replay
  // it indefinitely. Audit finding H-3 (2026-05-27).
  const tsSeconds = parseInt(svixTimestamp, 10);
  if (isNaN(tsSeconds)) return false;
  const ageMs = Date.now() - tsSeconds * 1000;
  if (Math.abs(ageMs) > 5 * 60 * 1000) return false; // allow 5min clock skew

  // Svix secrets start with "whsec_" and are base64 after the prefix.
  const rawSecret = WEBHOOK_SECRET.startsWith('whsec_') ? WEBHOOK_SECRET.slice(6) : WEBHOOK_SECRET;
  const keyBytes = Uint8Array.from(atob(rawSecret), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const payload = new TextEncoder().encode(`${svixId}.${svixTimestamp}.${body}`);
  const sigBuf = await crypto.subtle.sign('HMAC', key, payload);
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  // svix-signature is like "v1,base64sig v1,another" — any match wins.
  const parts = svixSignature.split(' ');
  for (const p of parts) {
    const [version, sig] = p.split(',');
    if (version === 'v1' && sig === expected) return true;
  }
  return false;
}

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json({ error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY secrets' }, 500);
    }

    const rawBody = await req.text();

    // Signature gate.
    const signed = await verifySvix(rawBody, req.headers);
    if (!signed) return json({ error: 'Invalid signature' }, 401);

    let payload: any;
    try { payload = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON' }, 400); }

    const eventType = payload?.type || 'other';
    const data      = payload?.data || {};
    const messageId = data?.email_id || data?.id || null;
    const recipient = Array.isArray(data?.to) ? data.to[0] : data?.to || null;
    const occurredAt = payload?.created_at || new Date().toISOString();

    if (!messageId) {
      // Still log it as 'other' so we can inspect later.
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: eventId, error } = await supabase.rpc('ingest_resend_event', {
      p_event_type:  eventType,
      p_message_id:  messageId,
      p_recipient:   recipient,
      p_occurred_at: occurredAt,
      p_raw:         payload,
    });

    if (error) {
      await reportEdgeError('ingest_resend_event', error, { event_type: eventType, message_id: messageId });
      return json({ error: error.message }, 500);
    }
    return json({ ok: true, event_id: eventId });
  } catch (err: unknown) {
    await reportEdgeError('webhook_main', err);
    return json({ error: 'internal error' }, 500);
  }
});

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
//   • Resend signs each webhook with an HMAC (svix format). If the secret
//     RESEND_WEBHOOK_SECRET is configured, we verify the signature and
//     reject unsigned / tampered requests. If no secret is configured we
//     accept anything — fine while testing, tighten before going wide.
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

const corsHeaders: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, svix-id, svix-timestamp, svix-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Resend uses Svix for webhook signing. The signature is:
//   base64(hmac_sha256(secret, svix_id + "." + svix_timestamp + "." + body))
// Verified against the `svix-signature` header (space-separated list of
// `v1,base64signature` values).
async function verifySvix(body: string, headers: Headers): Promise<boolean> {
  if (!WEBHOOK_SECRET) return true;   // enforcement off until secret is set
  const svixId        = headers.get('svix-id');
  const svixTimestamp = headers.get('svix-timestamp');
  const svixSignature = headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) return false;

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

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, event_id: eventId });
});

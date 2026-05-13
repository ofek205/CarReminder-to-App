// ═══════════════════════════════════════════════════════════════════════════
// send-email — Supabase Edge Function that sends transactional emails via
// Resend. Callers provide { to, subject, html, text?, from? } and we forward
// to https://api.resend.com/emails with the RESEND_API_KEY secret.
//
// Deploy:
//   • Dashboard: supabase.com/dashboard → Edge Functions → Deploy new function
//                → paste this file's contents → Deploy
//   • CLI:       `supabase functions deploy send-email`
//
// Invoke from client:
//   const { data, error } = await supabase.functions.invoke('send-email', {
//     body: { to: 'x@y.com', subject: 'Hi', html: '<b>Hello</b>' }
//   });
//
// Secret required: RESEND_API_KEY (set in Edge Functions → Secrets)
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logSecurityEvent } from '../_shared/securityLog.ts';
import { buildCorsHeaders } from '../_shared/cors.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Per-user rate limit. Resend free tier is 100/day; an authenticated
// attacker without this gate could empty the quota in under a minute by
// looping invoke() calls. 5 sends/min/user is generous for the legitimate
// flows (invite emails, password resets piggy-backing on supabase auth,
// admin test sends) and tight enough to block runaway loops.
// See audit finding C-2 (2026-05-12).
const RATE_LIMIT_PER_MIN = 5;

const supabaseAdmin = SUPABASE_URL && SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// Default sender — uses the verified Resend domain (car-reminder.app).
// Override per-call by passing `from` in the request body.
const DEFAULT_FROM = 'CarReminder <no-reply@car-reminder.app>';

// CORS — whitelist explicit origins instead of `*`. The JWT gate already
// blocks unauthenticated callers, but a wildcard origin means any page on
// the internet with a stolen token can trigger sends. Allow-list logic
// lives in _shared/cors.ts; this function only declares its accepted
// headers (no x-dispatch-secret because send-email is user-callable, not
// cron-callable).
const SEND_EMAIL_ALLOWED_HEADERS =
  'authorization, x-client-info, x-client-ip, apikey, content-type';

function buildCors(req: Request): HeadersInit {
  return buildCorsHeaders(req, { allowedHeaders: SEND_EMAIL_ALLOWED_HEADERS });
}

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(req ? buildCors(req) : {}), 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCors(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  if (!RESEND_API_KEY) {
    return json({ error: 'RESEND_API_KEY secret not configured' }, 500, req);
  }

  // ── Auth + per-user rate limit ────────────────────────────────────────
  // Verify JWT is ON for this function at the Supabase gateway, so the
  // token is already cryptographically valid by the time we run. We still
  // need to extract user.id here to key the rate-limit bucket. Without
  // this gate, any authenticated user could empty the Resend quota.
  if (!supabaseAdmin) {
    return json({ error: 'Server misconfigured (missing supabase env)' }, 500, req);
  }
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    logSecurityEvent('send-email', 'auth_failed', { reason: 'missing_authorization' });
    return json({ error: 'missing authorization' }, 401, req);
  }
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) {
    logSecurityEvent('send-email', 'auth_failed', { reason: authErr?.message || 'invalid_token' });
    return json({ error: 'invalid token' }, 401, req);
  }

  const { data: allowed, error: rlErr } = await supabaseAdmin.rpc('rate_limit_check', {
    kind:        `send-email:${user.id}`,
    max_per_min: RATE_LIMIT_PER_MIN,
  });
  // Fail-closed on RPC error: a misconfigured rate_limit_counters table
  // shouldn't open the floodgates. Return 503 so the client retries.
  if (rlErr) {
    logSecurityEvent('send-email', 'rate_limit_error', { user_id: user.id, error: rlErr.message });
    return json({ error: 'rate limit system unavailable' }, 503, req);
  }
  if (allowed === false) {
    logSecurityEvent('send-email', 'rate_limit_hit', { user_id: user.id, limit: RATE_LIMIT_PER_MIN });
    return json({ error: `Rate limit exceeded (${RATE_LIMIT_PER_MIN}/min)` }, 429, req);
  }

  let payload: {
    to?: string | string[];
    subject?: string;
    html?: string;
    text?: string;
    from?: string;
    reply_to?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req);
  }

  const { to, subject, html, text, from, reply_to } = payload;

  // Validation — at minimum need a recipient, a subject, and either html or text
  if (!to || (Array.isArray(to) && to.length === 0)) {
    return json({ error: '`to` is required (string or string[])' }, 400, req);
  }
  if (!subject || typeof subject !== 'string') {
    return json({ error: '`subject` is required' }, 400, req);
  }
  if (!html && !text) {
    return json({ error: 'Either `html` or `text` is required' }, 400, req);
  }

  // Defensive caps to stop a runaway client/script from blowing through the
  // Resend free tier by flooding with huge payloads.
  if (subject.length > 250) return json({ error: 'subject too long' }, 400, req);
  if (html && html.length > 200_000) return json({ error: 'html too long' }, 400, req);
  if (text && text.length > 100_000) return json({ error: 'text too long' }, 400, req);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || DEFAULT_FROM,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        reply_to,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      // Resend errors look like { name, message, statusCode }
      return json({ error: data.message || 'Resend error', details: data }, res.status, req);
    }

    return json({ ok: true, id: data.id }, 200, req);
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500, req);
  }
});

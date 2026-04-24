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

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

// Default sender — uses the verified Resend domain (car-reminder.app).
// Override per-call by passing `from` in the request body.
const DEFAULT_FROM = 'CarReminder <no-reply@car-reminder.app>';

// CORS — whitelist explicit origins instead of `*`. The JWT gate already
// blocks unauthenticated callers, but a wildcard origin means any page on
// the internet with a stolen token can trigger sends. Keep the allow-list
// narrow; fail-closed on unknown origins (returns 'null' which the browser
// treats as a CORS failure).
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || 'https://car-reminder.app';

function buildCors(req: Request): HeadersInit {
  const origin = req.headers.get('origin') || '';
  const allowList = ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
  const allow = allowList.includes(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
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

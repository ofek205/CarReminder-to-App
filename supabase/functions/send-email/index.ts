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

// CORS — Supabase functions are called from the browser; we need to answer
// the pre-flight OPTIONS request. Allow any origin here because Supabase
// itself already gates access via JWT verification (configured in the
// function settings) for logged-in users.
const corsHeaders: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!RESEND_API_KEY) {
    return json({ error: 'RESEND_API_KEY secret not configured' }, 500);
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
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { to, subject, html, text, from, reply_to } = payload;

  // Validation — at minimum need a recipient, a subject, and either html or text
  if (!to || (Array.isArray(to) && to.length === 0)) {
    return json({ error: '`to` is required (string or string[])' }, 400);
  }
  if (!subject || typeof subject !== 'string') {
    return json({ error: '`subject` is required' }, 400);
  }
  if (!html && !text) {
    return json({ error: 'Either `html` or `text` is required' }, 400);
  }

  // Defensive caps to stop a runaway client/script from blowing through the
  // Resend free tier by flooding with huge payloads.
  if (subject.length > 250) return json({ error: 'subject too long' }, 400);
  if (html && html.length > 200_000) return json({ error: 'html too long' }, 400);
  if (text && text.length > 100_000) return json({ error: 'text too long' }, 400);

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
      return json({ error: data.message || 'Resend error', details: data }, res.status);
    }

    return json({ ok: true, id: data.id });
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

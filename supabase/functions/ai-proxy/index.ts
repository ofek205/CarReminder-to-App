// ═══════════════════════════════════════════════════════════════════════════
// ai-proxy — server-side AI call dispatcher.
//
// Why this exists:
//   Previously the web client held VITE_GEMINI_API_KEY / VITE_GROQ_API_KEY /
//   VITE_ANTHROPIC_API_KEY and fired requests directly at the provider from
//   the browser. Any user (or anyone who downloaded the JS bundle) could pull
//   the keys out of DevTools → Sources and use them for free AI calls against
//   our quota, or worse, abuse them. Vite exposes every VITE_* var to the
//   built bundle by design — there is no way to keep them client-side-only.
//
//   This function moves the keys to server-side secrets (Deno.env) and
//   accepts a Claude-format request from the authenticated client. The
//   browser never sees the key.
//
// Auth:
//   Verify JWT: ON (deploy with `--verify-jwt`). Only signed-in users can
//   call this. Anonymous / abusive callers get rejected at the gateway.
//
// Secrets to configure:
//   GEMINI_API_KEY          (Google Generative Language API key)
//   GROQ_API_KEY            (optional — enables the fast text-only path)
//   ANTHROPIC_API_KEY       (optional — Claude fallback)
//   ALLOWED_ORIGIN          (optional — comma-separated CORS whitelist)
//
// Rate limit:
//   Per-user soft cap via the public.rate_limit_counters table (created in
//   the security hardening SQL). 60 requests per user per rolling hour.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_KEY       = Deno.env.get('GEMINI_API_KEY');
const GROQ_KEY         = Deno.env.get('GROQ_API_KEY');
const ANTHROPIC_KEY    = Deno.env.get('ANTHROPIC_API_KEY');
const ALLOWED_ORIGIN   = Deno.env.get('ALLOWED_ORIGIN') || '';

const GEMINI_URL    = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GROQ_URL      = 'https://api.groq.com/openai/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function buildCors(req: Request): HeadersInit {
  const origin = req.headers.get('origin') || '';
  const allowList = ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
  const allow = allowList.length === 0 || allowList.includes(origin) ? origin : allowList[0] || 'null';
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Headers': 'authorization, content-type',
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

async function callGemini(body: any) {
  if (!GEMINI_KEY) return null;
  const parts: any[] = [];
  if (body.system) parts.push({ text: body.system + '\n\n' });
  for (const msg of (body.messages || [])) {
    if (typeof msg.content === 'string') parts.push({ text: msg.content });
    else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') parts.push({ text: part.text });
        else if ((part.type === 'image' || part.type === 'document') && part.source?.type === 'base64') {
          parts.push({ inline_data: { mime_type: part.source.media_type, data: part.source.data } });
        }
      }
    }
  }
  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: body.max_tokens || 400, temperature: 0.7 },
    }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { content: [{ type: 'text', text }], provider: 'gemini' };
}

async function callGroq(body: any) {
  if (!GROQ_KEY) return null;
  const messages: any[] = [];
  if (body.system) messages.push({ role: 'system', content: body.system });
  for (const msg of (body.messages || [])) {
    if (typeof msg.content === 'string') messages.push({ role: msg.role || 'user', content: msg.content });
    else if (Array.isArray(msg.content)) {
      const textParts = msg.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
      if (textParts) messages.push({ role: msg.role || 'user', content: textParts });
    }
  }
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: body.model && String(body.model).includes('llama') ? body.model : 'llama-3.3-70b-versatile',
      messages,
      max_tokens: body.max_tokens || 400,
      temperature: 0.7,
    }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content || '';
  return { content: [{ type: 'text', text }], provider: 'groq' };
}

async function callClaude(body: any) {
  if (!ANTHROPIC_KEY) return null;
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return { ...j, provider: 'claude' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCors(req) });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405, req);

  // Verify JWT ourselves (in addition to gateway) so we have the user id
  // for rate limiting and audit.
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'Missing bearer token' }, 401, req);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7));
  if (authErr || !user) return json({ error: 'Invalid token' }, 401, req);

  // Soft per-user rate limit. Fails open if table isn't present.
  try {
    // rate_limit_check(kind, max_per_min) buckets by kind+auth.uid().
    // The JWT was attached above, so auth.uid() inside the RPC resolves
    // to the caller when we invoke it with the user's token — but we're
    // using the service role client here, so pass user id via a distinct
    // bucket name to keep counters separated.
    const { data: allowed } = await supabase.rpc('rate_limit_check', {
      kind:        `ai_proxy:${user.id}`,
      max_per_min: 10,
    });
    if (allowed === false) return json({ error: 'Rate limit exceeded' }, 429, req);
  } catch { /* table missing → skip */ }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400, req); }

  // Guard against absurdly large payloads (runaway base64 images, etc.)
  const approxSize = JSON.stringify(body).length;
  if (approxSize > 8 * 1024 * 1024) return json({ error: 'Payload too large' }, 413, req);

  const hasImages = (body.messages || []).some((m: any) =>
    Array.isArray(m.content) && m.content.some((p: any) => p.type === 'image' || p.type === 'document')
  );

  // Text-only: try Groq first (fastest, free). Vision: straight to Gemini.
  if (!hasImages) {
    const groq = await callGroq(body).catch(() => null);
    if (groq) return json(groq, 200, req);
  }

  const gemini = await callGemini(body).catch(() => null);
  if (gemini) return json(gemini, 200, req);

  const claude = await callClaude(body).catch(() => null);
  if (claude) return json(claude, 200, req);

  return json({ error: 'No AI provider available' }, 503, req);
});

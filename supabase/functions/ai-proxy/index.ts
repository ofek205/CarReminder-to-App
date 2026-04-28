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
//   Per-user soft cap via the public.rate_limit_counters table and the
//   rate_limit_check(kind, max_per_min) RPC. Bucket is ai_proxy:<user_id>
//   so counters don't collide between users. Limit: 10 requests per user
//   per rolling minute (≈600/hr), enough for interactive use but blocks
//   a compromised token from draining the provider quota.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_KEY       = Deno.env.get('GEMINI_API_KEY');
const GROQ_KEY         = Deno.env.get('GROQ_API_KEY');
const ANTHROPIC_KEY    = Deno.env.get('ANTHROPIC_API_KEY');
// Fail-closed default. If ALLOWED_ORIGIN isn't configured we refuse all
// browser origins rather than echo whatever the caller sent. Same pattern
// as dispatch-reminder-emails.
const ALLOWED_ORIGIN   = Deno.env.get('ALLOWED_ORIGIN') || 'https://car-reminder.app';

// Switched from gemini-2.0-flash to gemini-1.5-flash after the
// project's 2.0-flash daily quota started getting exhausted under
// real user load. Both are flash-tier (low-latency), 1.5-flash has
// a separate free-tier bucket (15 RPM, 1M TPM, 1500 RPD) and no
// billing requirement. To upgrade back to 2.0/2.5 later, swap the
// model name here and either enable billing on the Google Cloud
// project or accept tighter daily limits.
const GEMINI_URL    = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
const GROQ_URL      = 'https://api.groq.com/openai/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function buildCors(req: Request): HeadersInit {
  const origin = req.headers.get('origin') || '';
  const allowList = ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
  // Only echo the caller's origin if it's in the whitelist. Otherwise
  // advertise the first allowed origin, which will trigger a browser
  // CORS failure for unauthorised callers instead of silently succeeding.
  // Fail-closed: unauthorised origins get 'null' so the browser's CORS check
  // rejects. (The old `allowList[0]` fallback still echoed an allowed
  // origin, letting unauthorised callers see headers they shouldn't.)
  const allow = allowList.includes(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin':  allow,
    // supabase-js invoke() attaches apikey + x-client-info on every call;
    // without them in the allow-list the browser blocks the preflight and
    // the invoke() helper returns "Failed to send a request" even though
    // the function is up. authorization + content-type cover raw fetch too.
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
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
  if (!GEMINI_KEY) {
    console.warn('[ai-proxy] gemini: no key configured');
    return null;
  }
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
  // Send the API key in the x-goog-api-key header, not the URL — query
  // strings are logged by Supabase edge runtimes, CDNs, and browser
  // referrer headers, which leaks the key every time a request is made.
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY! },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: body.max_tokens || 400, temperature: 0.7 },
    }),
  });
  if (!res.ok) {
    // Log the status + a short excerpt of the body so we can debug
    // recurring outages from the Supabase Edge Function logs. Common
    // failure modes: 429 (free-tier quota), 403 (key invalid / API
    // disabled in the project), 503 (transient cold-start), 400 (bad
    // request shape after a model schema change).
    let bodyExcerpt = '';
    try { bodyExcerpt = (await res.text()).slice(0, 200); } catch {}
    console.warn(`[ai-proxy] gemini ${res.status}: ${bodyExcerpt}`);
    return null;
  }
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    // Empty completions are the silent killer — Gemini returns 200 with
    // no candidates when safety filters block the prompt. Log so we
    // notice instead of treating it as success.
    console.warn('[ai-proxy] gemini: empty completion (safety block?)');
    return null;
  }
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
  if (!res.ok) {
    let bodyExcerpt = '';
    try { bodyExcerpt = (await res.text()).slice(0, 200); } catch {}
    console.warn(`[ai-proxy] groq ${res.status}: ${bodyExcerpt}`);
    return null;
  }
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content || '';
  if (!text) {
    console.warn('[ai-proxy] groq: empty completion');
    return null;
  }
  return { content: [{ type: 'text', text }], provider: 'groq' };
}

// ──────────────────────────────────────────────────────────────────────────
// extract_document: fetch file → base64 → Gemini with schema-guided prompt.
// Returns Base44-compatible shape: { status: 'success'|'error', output?, details? }
// ──────────────────────────────────────────────────────────────────────────
async function fetchAsBase64(url: string): Promise<{ data: string; mime: string }> {
  // 10s timeout so a hung storage fetch can't pin the function.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`file fetch failed: ${res.status}`);
    const mime = res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 6 * 1024 * 1024) throw new Error('file too large (>6MB)');
    // Chunked base64 encode — btoa on huge strings blows the stack in Deno.
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CHUNK)) as any);
    }
    return { data: btoa(bin), mime };
  } finally {
    clearTimeout(t);
  }
}

function extractJsonFromText(text: string): any {
  if (!text) return null;
  // Strip ```json ... ``` fences if the model wrapped the answer.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  // Fallback: first {...} block.
  const braced = candidate.match(/\{[\s\S]*\}/);
  const raw = braced ? braced[0] : candidate;
  try { return JSON.parse(raw); } catch { return null; }
}

async function extractDocument(body: any, req: Request): Promise<Response> {
  if (!GEMINI_KEY) return json({ status: 'error', details: 'No AI provider configured' }, 503, req);

  const { file_url, file_base64, file_mime, json_schema, instructions } = body;
  if (!json_schema) return json({ status: 'error', details: 'Missing json_schema' }, 400, req);
  if (!file_url && !file_base64) return json({ status: 'error', details: 'Missing file_url or file_base64' }, 400, req);

  let data: string;
  let mime: string;
  try {
    if (file_base64) {
      data = file_base64;
      mime = file_mime || 'application/octet-stream';
    } else {
      const fetched = await fetchAsBase64(file_url);
      data = fetched.data;
      mime = fetched.mime;
    }
  } catch (e) {
    return json({ status: 'error', details: `Fetch failed: ${(e as Error).message}` }, 400, req);
  }

  const schemaText = typeof json_schema === 'string' ? json_schema : JSON.stringify(json_schema);
  const prompt =
    (instructions ? instructions + '\n\n' : '') +
    'Extract the following fields from the attached document.\n' +
    'Return ONLY a single JSON object matching this schema (no prose, no markdown fences).\n' +
    'Omit fields you cannot determine from the document.\n' +
    'Dates: prefer ISO 8601 (YYYY-MM-DD) if possible.\n\n' +
    'Schema:\n' + schemaText;

  // Send the API key in the x-goog-api-key header, not the URL — query
  // strings are logged by Supabase edge runtimes, CDNs, and browser
  // referrer headers, which leaks the key every time a request is made.
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY! },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mime, data } },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  }).catch(() => null);

  if (!res || !res.ok) {
    const detail = res ? await res.text().catch(() => '') : 'network error';
    return json({ status: 'error', details: `AI call failed: ${detail.slice(0, 200)}` }, 502, req);
  }

  const j = await res.json().catch(() => ({}));
  const text: string = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = extractJsonFromText(text);
  if (!parsed || typeof parsed !== 'object') {
    return json({ status: 'error', details: 'Could not parse AI response as JSON', raw: text.slice(0, 500) }, 200, req);
  }

  return json({ status: 'success', output: parsed, provider: 'gemini' }, 200, req);
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

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400, req); }

  // Guard against absurdly large payloads (runaway base64 images, etc.)
  const approxSize = JSON.stringify(body).length;
  if (approxSize > 8 * 1024 * 1024) return json({ error: 'Payload too large' }, 413, req);

  // ─────────────────────────────────────────────────────────────────────
  // Mode: providers_status (admin-only meta call)
  // Returns which provider keys are configured so /AdminAiSettings can
  // grey out options that won't actually work. We never return the keys
  // themselves — only booleans. Gated by is_admin() RPC so non-admins
  // can't enumerate the deployment's secrets.
  // ─────────────────────────────────────────────────────────────────────
  if (body?.action === 'providers_status') {
    // The 0-arg `is_admin()` reads `auth.uid()` from the JWT context,
    // but our `supabase` client uses the service role and therefore has
    // no JWT context — `auth.uid()` returns null → is_admin returns
    // false → admins were getting 403. Switch to the `is_admin(uuid)`
    // overload and pass the user id we already validated above.
    const { data: isAdminFlag } = await supabase.rpc('is_admin', { uid: user.id });
    if (isAdminFlag !== true) return json({ error: 'admin_required' }, 403, req);
    return json({
      providers: {
        gemini: !!GEMINI_KEY,
        groq:   !!GROQ_KEY,
        claude: !!ANTHROPIC_KEY,
      },
    }, 200, req);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Mode: extract_document
  // Replaces base44.integrations.Core.ExtractDataFromUploadedFile.
  // Fetches a signed URL, sends the bytes to Gemini with a schema-guided
  // prompt, returns { status: 'success', output: {...} } on success.
  // Uses a separate rate-limit bucket (30/min) because scan wizards
  // sometimes burst 2-3 pages back-to-back.
  // ─────────────────────────────────────────────────────────────────────
  if (body?.mode === 'extract_document') {
    const { data: allowed, error: rlErr } = await supabase.rpc('rate_limit_check', {
      kind:        `extract_document:${user.id}`,
      max_per_min: 30,
    });
    if (rlErr) {
      // Surface rate-limit misconfiguration in logs so we notice instead
      // of silently letting unlimited traffic through.
      console.error('rate_limit_check failed (extract_document):', rlErr.message);
    }
    if (allowed === false) return json({ status: 'error', details: 'Rate limit exceeded' }, 429, req);

    return extractDocument(body, req);
  }

  // Default mode: Claude-format chat. Use the smaller rate limit.
  {
    const { data: allowed, error: rlErr } = await supabase.rpc('rate_limit_check', {
      kind:        `ai_proxy:${user.id}`,
      max_per_min: 10,
    });
    if (rlErr) {
      console.error('rate_limit_check failed (ai_proxy):', rlErr.message);
    }
    if (allowed === false) return json({ error: 'Rate limit exceeded' }, 429, req);
  }

  const hasImages = (body.messages || []).some((m: any) =>
    Array.isArray(m.content) && m.content.some((p: any) => p.type === 'image' || p.type === 'document')
  );

  // Look up the admin's chosen provider for this feature. The client can
  // pass `feature` in the body ('community_expert', 'yossi_chat',
  // 'scan_extraction'); falls back to 'auto' if the feature isn't known
  // or the RPC errors. 'auto' = the legacy priority ladder below.
  let preferred: string = 'auto';
  if (typeof body?.feature === 'string' && body.feature.length < 40) {
    try {
      const { data: pref } = await supabase.rpc('get_ai_provider', { p_feature: body.feature });
      if (typeof pref === 'string' && ['gemini', 'groq', 'claude', 'auto'].includes(pref)) {
        preferred = pref;
      }
    } catch { /* fall back to auto */ }
  }

  // Resolve by preference. Behavior change vs. earlier versions:
  // an explicit admin selection ('gemini' / 'groq' / 'claude') is now
  // *strict* — if that provider fails we return 503 with the provider
  // tagged, so the client can display "Gemini זמנית לא זמין" instead
  // of silently demoting every chat to Groq the moment Gemini hits a
  // 429. The old fall-through made the badge lie ("admin picked Gemini
  // but I'm seeing Groq?").
  //
  // Only `preferred === 'auto'` triggers the legacy ladder.
  const tryGemini = async () => (await callGemini(body).catch((e) => { console.warn('[ai-proxy] gemini failed:', e?.message); return null; }));
  const tryGroq   = async () => (await callGroq(body).catch((e)   => { console.warn('[ai-proxy] groq failed:',   e?.message); return null; }));
  const tryClaude = async () => (await callClaude(body).catch((e) => { console.warn('[ai-proxy] claude failed:', e?.message); return null; }));

  if (preferred === 'gemini') {
    const r = await tryGemini(); if (r) return json(r, 200, req);
    return json({ error: 'Gemini provider unavailable', provider: 'gemini' }, 503, req);
  }
  if (preferred === 'groq') {
    if (hasImages) {
      // Groq doesn't support vision today — make the constraint explicit
      // so the admin sees a real error and can pick another provider.
      return json({ error: 'Groq does not support image input', provider: 'groq' }, 503, req);
    }
    const r = await tryGroq(); if (r) return json(r, 200, req);
    return json({ error: 'Groq provider unavailable', provider: 'groq' }, 503, req);
  }
  if (preferred === 'claude') {
    const r = await tryClaude(); if (r) return json(r, 200, req);
    return json({ error: 'Claude provider unavailable', provider: 'claude' }, 503, req);
  }

  // preferred === 'auto' (or unknown). Legacy ladder: text → Groq (fastest);
  // vision → Gemini first. Each leg falls back on failure.
  if (!hasImages) {
    const groq = await tryGroq(); if (groq) return json(groq, 200, req);
  }
  const gemini = await tryGemini(); if (gemini) return json(gemini, 200, req);
  const claude = await tryClaude(); if (claude) return json(claude, 200, req);

  return json({ error: 'No AI provider available' }, 503, req);
});

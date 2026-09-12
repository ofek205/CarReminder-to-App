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
import { logSecurityEvent } from '../_shared/securityLog.ts';
import { buildCorsHeaders, CAPACITOR_ORIGINS } from '../_shared/cors.ts';
import { countsTowardAiQuota, aiQuotaFeature } from '../_shared/aiQuota.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_KEY       = Deno.env.get('GEMINI_API_KEY');
const GROQ_KEY         = Deno.env.get('GROQ_API_KEY');
const ANTHROPIC_KEY    = Deno.env.get('ANTHROPIC_API_KEY');

// Model history (most recent first):
//   • 2026-05-26 — upgraded to gemini-2.5-flash. Newest free-tier flash
//     model with multimodal (text + image + PDF) support, 1M-token
//     context, 15 RPM / 1M TPM / 1500 RPD on the free tier. Chosen
//     because 2.0-flash is scheduled to shut down on 2026-06-01 and
//     pro models went paid-only in April 2026.
//   • Earlier — gemini-1.5-flash. We had downgraded to 1.5 from 2.0
//     because the project's 2.0-flash daily quota started getting
//     exhausted under real user load. 2.5-flash sits in its own free
//     bucket so the previous quota issue does not apply.
// If 2.5-flash itself runs out of free capacity in the future, options
// are: enable billing on the Google Cloud project, drop to
// gemini-2.5-flash-lite, or route via the abstraction layer in
// _shared/ai-providers to a different provider.
const GEMINI_URL    = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GROQ_URL      = 'https://api.groq.com/openai/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Model name constants. Kept here (not inside call*) so logAiUsage can
// reference the same string the request used — avoids drift between
// what we sent and what we record.
const GEMINI_MODEL  = 'gemini-2.5-flash';
const GROQ_MODEL    = 'llama-3.3-70b-versatile';
// Claude reads the model from the request body; nothing pinned here.

// ──────────────────────────────────────────────────────────────────────
// Usage tracking — best-effort write to public.ai_usage_logs after
// every successful provider call. Disabled by flipping
// app_config.ai_usage_tracking_enabled to false (the row is seeded as
// true in supabase-feature-flags-attachments.sql).
//
// Cached for 60 seconds in module scope. A bounce of the Edge worker
// re-reads on first call; in steady state, only one row of the
// app_config table is hit per minute regardless of traffic.
// ──────────────────────────────────────────────────────────────────────
const USAGE_FLAG_TTL_MS = 60 * 1000;
let usageFlagCache: boolean | null = null;
let usageFlagCachedAt = 0;
let usageFlagInFlight: Promise<boolean> | null = null;

async function isUsageTrackingEnabled(sb: ReturnType<typeof createClient>): Promise<boolean> {
  const now = Date.now();
  if (usageFlagCache !== null && now - usageFlagCachedAt < USAGE_FLAG_TTL_MS) {
    return usageFlagCache;
  }
  if (usageFlagInFlight) return usageFlagInFlight;

  usageFlagInFlight = (async () => {
    try {
      const { data, error } = await sb
        .from('app_config')
        .select('value')
        .eq('key', 'ai_usage_tracking_enabled')
        .maybeSingle();
      if (error) throw error;
      const raw = data?.value;
      // Default to ENABLED if the row is missing — we want data flowing
      // by default. To pause, explicitly set the row to false.
      if (raw === false || raw === 'false') {
        usageFlagCache = false;
      } else {
        usageFlagCache = true;
      }
    } catch (err) {
      console.warn('[ai-proxy] usage flag fetch failed:', (err as Error)?.message);
      usageFlagCache = true;  // default ON when unsure
    } finally {
      usageFlagCachedAt = Date.now();
      usageFlagInFlight = null;
    }
    return usageFlagCache!;
  })();

  return usageFlagInFlight;
}

// ──────────────────────────────────────────────────────────────────────
// Scan kill switch — server-side half of app_config.
// scan_extraction_enabled.
//
// Why this has to live here and not only in the browser: the
// extract_document mode is reached by calling
// supabase.functions.invoke('ai-proxy', { mode: 'extract_document' })
// directly (src/lib/aiExtract.js), which never passes through
// aiRequest's client-side gate. Until 2026-09-08 that meant flipping
// the flag to false stopped the four aiRequest surfaces (vehicle
// licence, inline renewal, generic document, garage receipt) and left
// the four extraction surfaces running at full cost: personal and
// business receipts, vessel licence, driver licence. Half a kill
// switch is worse than none, because the dashboard reads "off".
//
// Fail OPEN on any error, deliberately, mirroring the client's
// { defaultOnError: true }. This is a cost and provider-health
// throttle, not a security boundary — a transient app_config read
// failure must not take scanning down for every user. Contrast with
// rate_limit_check above, which fails CLOSED because bypassing it is
// an abuse vector.
//
// Same 60s module cache + in-flight dedup as the usage flag, so a
// burst of scan pages costs one app_config row read per minute.
// ──────────────────────────────────────────────────────────────────────
let scanFlagCache: boolean | null = null;
let scanFlagCachedAt = 0;
let scanFlagInFlight: Promise<boolean> | null = null;

async function isScanExtractionEnabled(sb: ReturnType<typeof createClient>): Promise<boolean> {
  const now = Date.now();
  if (scanFlagCache !== null && now - scanFlagCachedAt < USAGE_FLAG_TTL_MS) {
    return scanFlagCache;
  }
  if (scanFlagInFlight) return scanFlagInFlight;

  scanFlagInFlight = (async () => {
    try {
      const { data, error } = await sb
        .from('app_config')
        .select('value')
        .eq('key', 'scan_extraction_enabled')
        .maybeSingle();
      if (error) throw error;
      const raw = data?.value;
      // Only an EXPLICIT false disables. A missing row means enabled —
      // the feature shipped that way for months and the client agrees.
      scanFlagCache = !(raw === false || raw === 'false');
    } catch (err) {
      console.warn('[ai-proxy] scan flag fetch failed:', (err as Error)?.message);
      scanFlagCache = true;  // fail open
    } finally {
      scanFlagCachedAt = Date.now();
      scanFlagInFlight = null;
    }
    return scanFlagCache!;
  })();

  return scanFlagInFlight;
}

// Allowed values for the optional `surface` field on a request. Keeps
// in sync with the CHECK constraint in supabase-ai-quota-alerts.sql.
// Anything not in this set is silently dropped (logged as NULL) so a
// client typo doesn't break the request.
const ALLOWED_SURFACES = new Set([
  'chat_assistant',
  'community_reply',
  'vehicle_scan',
  'vessel_scan',
  'vehicle_inline_scan',
  'driver_license_scan',
  'expense_personal_scan',
  'expense_business_scan',
  'document_scan',
  'maintenance_log_scan',   // garage receipt scan in MaintenanceSection
  'plate_scan',             // license-plate camera in PlateScanButton
]);

/**
 * The one place the request's `surface` tag is validated.
 *
 * This expression was copy-pasted at three call sites (the extraction usage
 * log, the quota decision, and the advisor usage log), which is one copy per
 * reason to care and three places to forget. It matters more than ordinary
 * duplication because the quota consults the SAME sanitised value: a surface
 * dropped to NULL here is one that `countsTowardAiQuota` treats as billable,
 * so a fourth site that sanitised differently would decide money differently
 * from the site that logs it.
 *
 * Unknown values become null rather than an error, preserving the existing
 * behaviour that a client typo never fails the request.
 */
function sanitizeSurface(b: any): string | null {
  return (typeof b?.surface === 'string' && ALLOWED_SURFACES.has(b.surface)) ? b.surface : null;
}

// Known feature values for ai_usage_logs. Mirrors the DB CHECK
// constraint. logAiUsage maps anything outside this set to NULL so a
// new/typo feature string never trips a 23514 constraint violation and
// drops the whole log row (and spams the edge console).
const KNOWN_FEATURES = new Set([
  'community_expert',
  'yossi_chat',
  'scan_extraction',
  'plate_scan',
]);

interface UsageLogInput {
  user_id:           string;
  provider:          'groq' | 'gemini' | 'claude' | 'grok';
  model:             string;
  feature:           string | null;
  surface:           string | null;
  prompt_tokens:     number | null;
  completion_tokens: number | null;
  total_tokens:      number | null;
  had_attachment:    boolean;
}

async function logAiUsage(
  sb: ReturnType<typeof createClient>,
  opts: UsageLogInput,
): Promise<void> {
  try {
    if (!(await isUsageTrackingEnabled(sb))) return;
    // Defensive: map any feature/surface value that isn't in the known
    // set to NULL. The DB has CHECK constraints on both columns; an
    // unrecognised string would throw 23514 and drop the whole row.
    // NULL is always valid, so we degrade gracefully (lose the tag,
    // keep the token counts) instead of losing the row + spamming logs.
    const safeFeature = opts.feature && KNOWN_FEATURES.has(opts.feature) ? opts.feature : null;
    const safeSurface = opts.surface && ALLOWED_SURFACES.has(opts.surface) ? opts.surface : null;
    const { error } = await sb.from('ai_usage_logs').insert({
      user_id:           opts.user_id,
      provider:          opts.provider,
      model:             opts.model,
      feature:           safeFeature,
      surface:           safeSurface,
      prompt_tokens:     opts.prompt_tokens,
      completion_tokens: opts.completion_tokens,
      total_tokens:      opts.total_tokens,
      had_attachment:    opts.had_attachment,
    });
    if (error) {
      // Best-effort — never block the response on a log write. Log to
      // edge console so we notice if the writer is broken (e.g., RLS
      // policy got renamed, table dropped). Not routed through
      // reportEdgeError to avoid an infinite loop if app_errors itself
      // is the failing path.
      console.warn('[ai-proxy] usage log insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[ai-proxy] usage log unexpected error:', (err as Error)?.message);
  }
}

// Strip common markdown formatting from chat completions before
// returning to the client. The /AiAssistant chat surface (ברוך /
// יוסי) renders answers as plain text — no react-markdown wrapper —
// so `**bold**`, `## headings`, `` `code` ``, and triple-backtick
// fences show up as literal characters instead of formatting. The
// system prompt itself uses markdown to instruct the model on
// response structure ("**תסמינים תואמים**", "## שני מצבי תשובה"),
// which trains the model to mirror those markers in its replies.
//
// We can't change the client without an app release, but the Edge
// Function deploys independently — this normalizes the LLM output
// here so the fix lands instantly for every user on every
// platform.
//
// Strip rules (intentionally conservative — we do not parse full
// markdown, just unwrap the common AI-output patterns):
//   • **bold**       → bold
//   • *italic*       → italic                (negative lookarounds
//                                             keep bullets at line
//                                             start untouched)
//   • ## heading     → heading
//   • `code`         → code
//   • ```fenced```   → fenced content        (fences stripped)
//   • --- rules      → removed
//
// The extract_document() / scan_extraction path uses its own
// schema-guided prompt and never goes through call*() — so JSON
// scan responses are unaffected.
function stripMarkdown(text: string): string {
  if (typeof text !== 'string' || !text) return text;
  let s = text;
  // Bold MUST run before italic — otherwise the inner ** in
  // **word** matches the italic pattern first and leaves a
  // dangling *word* instead of word.
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  // Italic: single * around a word, only when non-asterisk chars
  // touch both * marks. Lookarounds avoid stripping bullets
  // ("* item") and standalone operators ("a * b").
  s = s.replace(/(?<=\S)\*([^\s*][^*\n]*[^\s*])\*(?=\S)/g, '$1');
  s = s.replace(/(?<=\S)\*([^\s*])\*(?=\S)/g, '$1');
  // Headings: leading #+ followed by space, anywhere on a line.
  s = s.replace(/^#{1,6}\s+/gm, '');
  // Fenced code blocks: ```js\ncode\n``` → keep inner content.
  s = s.replace(/```[a-z0-9]*\n?/gi, '');
  s = s.replace(/```/g, '');
  // Inline code: `code` → code.
  s = s.replace(/`([^`\n]+)`/g, '$1');
  // Horizontal rules.
  s = s.replace(/^[ \t]*-{3,}[ \t]*$/gm, '');
  // Collapse runs of 3+ blank lines the removals may have
  // introduced — keep the conversation visually tight.
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// CORS allow-list logic lives in _shared/cors.ts. ai-proxy is the
// mobile-callable function so it opts into CAPACITOR_ORIGINS (the
// other Edge Functions don't). supabase-js invoke() attaches apikey +
// x-client-info on every call so those headers must be in the allow
// list — authorization + content-type cover raw fetch too.
const AI_PROXY_ALLOWED_HEADERS =
  'authorization, content-type, apikey, x-client-info, x-client-ip';

function buildCors(req: Request): HeadersInit {
  return buildCorsHeaders(req, {
    allowedHeaders: AI_PROXY_ALLOWED_HEADERS,
    extraOrigins:   CAPACITOR_ORIGINS,
  });
}

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(req ? buildCors(req) : {}), 'Content-Type': 'application/json' },
  });
}

// Inline best-effort error reporter — see notes in send-daily-digest.
async function reportEdgeError(action: string, error: unknown, extra?: Record<string, unknown>) {
  const FN = 'ai-proxy';
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
      generationConfig: {
        // Raised from 400 → 1500 (2026-05-28). 400 left zero headroom on
        // vision requests because gemini-2.5-flash bills internal
        // "thinking" tokens against this budget. Users reported answers
        // cut off mid-word when an image was attached. 1500 gives a
        // comfortable answer envelope; thinkingConfig below caps the
        // hidden reasoning so we always have room for visible output.
        maxOutputTokens: body.max_tokens || 1500,
        temperature: 0.7,
        // gemini-2.5-flash has "thinking" enabled by default. On a vision
        // request the model burns 500–800 tokens reasoning about the
        // image BEFORE the first visible token — and that reasoning is
        // billed against maxOutputTokens. Without an explicit cap, the
        // answer envelope gets eaten by the internal reasoning and
        // generation hard-stops mid-word at finishReason=MAX_TOKENS.
        // For a conversational mechanic assistant, the system prompt
        // already shapes the response — extra "thinking" adds latency
        // and cost without quality. Set to 0 to disable.
        thinkingConfig: { thinkingBudget: 0 },
      },
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
  // Detect truncation. finishReason='MAX_TOKENS' means we hit the cap
  // and the response is incomplete (often mid-word). Log so we can
  // raise the budget if we see this in production. The text is still
  // returned — a partial answer is better than nothing for the user.
  const finishReason = j?.candidates?.[0]?.finishReason;
  if (finishReason === 'MAX_TOKENS') {
    console.warn(`[ai-proxy] gemini: response truncated at maxOutputTokens (${body.max_tokens || 1500})`);
  }
  if (!text) {
    // Empty completions are the silent killer — Gemini returns 200 with
    // no candidates when safety filters block the prompt. Log so we
    // notice instead of treating it as success.
    console.warn('[ai-proxy] gemini: empty completion (safety block?)');
    return null;
  }
  // Gemini exposes counters under usageMetadata with different names:
  //   promptTokenCount    → prompt_tokens
  //   candidatesTokenCount → completion_tokens
  //   totalTokenCount     → total_tokens
  const um = j?.usageMetadata || {};
  return {
    content:  [{ type: 'text', text: stripMarkdown(text) }],
    provider: 'gemini',
    model:    GEMINI_MODEL,
    usage: {
      prompt_tokens:     um.promptTokenCount     ?? null,
      completion_tokens: um.candidatesTokenCount ?? null,
      total_tokens:      um.totalTokenCount      ?? null,
    },
  };
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
  // Detect truncation. OpenAI/Groq report finish_reason='length' when the
  // response hit max_tokens and was clipped (often mid-word). Log it so a
  // recurring clip surfaces in production logs — parity with callGemini's
  // MAX_TOKENS detection (added 2026-05-31 after the community AI showed a
  // mid-word "200,000 ק"מ על אא" cutoff).
  const finishReason = j?.choices?.[0]?.finish_reason;
  if (finishReason === 'length') {
    console.warn(`[ai-proxy] groq: response truncated at max_tokens (${body.max_tokens || 400})`);
  }
  if (!text) {
    console.warn('[ai-proxy] groq: empty completion');
    return null;
  }
  // Groq follows the OpenAI usage shape: { prompt_tokens, completion_tokens, total_tokens }.
  return {
    content:  [{ type: 'text', text: stripMarkdown(text) }],
    provider: 'groq',
    model:    j?.model || GROQ_MODEL,
    usage: {
      prompt_tokens:     j?.usage?.prompt_tokens     ?? null,
      completion_tokens: j?.usage?.completion_tokens ?? null,
      total_tokens:      j?.usage?.total_tokens      ?? null,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// extract_document: fetch file → base64 → Gemini with schema-guided prompt.
// Returns Base44-compatible shape: { status: 'success'|'error', output?, details? }
// ──────────────────────────────────────────────────────────────────────────
// Hostnames the AI proxy is allowed to fetch documents from. Each entry
// is a regex tested against `new URL(url).hostname`. Anything else is
// rejected before fetch() runs to prevent SSRF — without this, an
// authenticated caller could point file_url at internal services (cloud
// metadata 169.254.169.254, link-local, the Supabase project's own
// admin API, etc.) and exfiltrate responses through the AI provider's
// echo. See audit finding H-1 (2026-05-12).
const FETCH_ALLOWED_HOSTS = [
  /\.supabase\.co$/i,         // Supabase Storage signed URLs
  /\.supabase\.in$/i,         // legacy Supabase domains
  /\.amazonaws\.com$/i,       // S3 (Supabase Storage backend on some plans)
  /^storage\.googleapis\.com$/i,
  /\.r2\.cloudflarestorage\.com$/i,
];

function isFetchHostAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return FETCH_ALLOWED_HOSTS.some(rx => rx.test(u.hostname));
  } catch {
    return false;
  }
}

async function fetchAsBase64(url: string): Promise<{ data: string; mime: string }> {
  if (!isFetchHostAllowed(url)) {
    // Log the rejected host for observability — high-signal event since
    // this fires only when someone tries to point fetch at a non-allowed
    // origin (likely SSRF probe).
    let host = 'invalid_url';
    try { host = new URL(url).hostname; } catch {}
    logSecurityEvent('ai-proxy', 'ssrf_rejected', { host });
    throw new Error('file host not allowed');
  }
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

async function extractDocument(
  body: any,
  req: Request,
  sb: ReturnType<typeof createClient>,
  userId: string,
): Promise<Response> {
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
        maxOutputTokens: 2048,
        temperature: 0.1,
        responseMimeType: 'application/json',
        // gemini-2.5-flash's thinking mode counts against output budget.
        // For schema-driven JSON extraction we want all tokens going to
        // the structured response, not internal reasoning. Disable to
        // prevent occasional truncated/empty JSON on complex documents.
        thinkingConfig: { thinkingBudget: 0 },
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

  // Best-effort usage log. Extraction always uses Gemini today, always
  // has an attached document, always under the scan_extraction feature.
  // Surface comes from the request body when the call site supplied it
  // — lets the dashboard separate vehicle_scan from expense_personal_scan
  // even though both ride the same feature key.
  const um = j?.usageMetadata || {};
  const extractSurface: string | null = sanitizeSurface(body);
  await logAiUsage(sb, {
    user_id:           userId,
    provider:          'gemini',
    model:             GEMINI_MODEL,
    feature:           'scan_extraction',
    surface:           extractSurface,
    prompt_tokens:     um.promptTokenCount     ?? null,
    completion_tokens: um.candidatesTokenCount ?? null,
    total_tokens:      um.totalTokenCount      ?? null,
    had_attachment:    true,
  });

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
  // Anthropic returns { content: [{type:'text', text:'...'}, ...], ... }.
  // Pass each text block through stripMarkdown so /AiAssistant renders
  // clean Hebrew without ** ## ` artifacts. Non-text blocks (tool_use,
  // etc.) pass through untouched.
  if (Array.isArray(j?.content)) {
    j.content = j.content.map((block: any) =>
      block && block.type === 'text' && typeof block.text === 'string'
        ? { ...block, text: stripMarkdown(block.text) }
        : block
    );
  }
  // Anthropic exposes usage as { input_tokens, output_tokens } — no
  // separate total, so we add it ourselves. Model comes back in j.model.
  const inT  = j?.usage?.input_tokens  ?? null;
  const outT = j?.usage?.output_tokens ?? null;
  const totalT = (inT != null && outT != null) ? (inT + outT) : null;
  return {
    ...j,
    provider: 'claude',
    model:    j?.model || 'claude',
    usage: {
      prompt_tokens:     inT,
      completion_tokens: outT,
      total_tokens:      totalT,
    },
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCors(req) });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405, req);

  // Verify JWT ourselves (in addition to gateway) so we have the user id
  // for rate limiting and audit.
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    logSecurityEvent('ai-proxy', 'auth_failed', { reason: 'missing_bearer' });
    return json({ error: 'Missing bearer token' }, 401, req);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7));
  if (authErr || !user) {
    logSecurityEvent('ai-proxy', 'auth_failed', { reason: authErr?.message || 'invalid_token' });
    return json({ error: 'Invalid token' }, 401, req);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400, req); }

  // Guard against absurdly large payloads (runaway base64 images, etc.)
  const approxSize = JSON.stringify(body).length;
  if (approxSize > 8 * 1024 * 1024) {
    logSecurityEvent('ai-proxy', 'payload_rejected', { reason: 'oversize', size: approxSize, user_id: user.id });
    return json({ error: 'Payload too large' }, 413, req);
  }

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
    if (isAdminFlag !== true) {
      logSecurityEvent('ai-proxy', 'permission_denied', { action: 'providers_status', user_id: user.id });
      return json({ error: 'admin_required' }, 403, req);
    }
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
    // Kill switch BEFORE the rate-limit check: a request we are going
    // to refuse should not consume the caller's scan budget.
    if (!(await isScanExtractionEnabled(supabase))) {
      // Admins bypass so QA can exercise scan flows while the feature
      // is off for users — same rule the client gate has had since
      // 2026-05-26. Probed only on the disabled path, so a normal
      // request pays nothing for it.
      //
      // NOTE the uuid overload. The 0-arg is_admin() reads auth.uid()
      // from the JWT context, which is absent here, so it returns
      // false and would lock admins out too. See the identical note on
      // the admin-flags branch below.
      const { data: isAdminFlag } = await supabase.rpc('is_admin', { uid: user.id });
      if (isAdminFlag !== true) {
        logSecurityEvent('ai-proxy', 'scan_extraction_blocked', {
          user_id: user.id,
          surface: typeof body?.surface === 'string' ? body.surface : null,
        });
        // `code` is the load-bearing field — aiExtract.js keys on it to
        // raise the global "currently unavailable" explainer instead of
        // letting each surface show its generic "could not read"
        // message. `details` is a readable fallback for any caller that
        // surfaces it directly. 403, not 503: this is a deliberate
        // policy decision, not an outage.
        return json({
          status:  'error',
          code:    'SCAN_EXTRACTION_DISABLED',
          details: 'שירות הסריקה מושבת זמנית. אפשר למלא את הפרטים ידנית.',
        }, 403, req);
      }
    }

    const { data: allowed, error: rlErr } = await supabase.rpc('rate_limit_check', {
      kind:        `extract_document:${user.id}`,
      max_per_min: 30,
    });
    // Fail-closed on RPC error: a misconfigured / down rate_limit_counters
    // table must NOT open the gate. Old behavior was log-and-continue,
    // which let an attacker DoS the rate-limit table to bypass limits.
    // See audit finding H-5 (2026-05-12).
    if (rlErr) {
      logSecurityEvent('ai-proxy', 'rate_limit_error', { kind: 'extract_document', user_id: user.id, error: rlErr.message });
      await reportEdgeError('rate_limit_check_failed', rlErr, { kind: 'extract_document' });
      return json({ status: 'error', details: 'rate limit system unavailable' }, 503, req);
    }
    if (allowed === false) {
      logSecurityEvent('ai-proxy', 'rate_limit_hit', { kind: 'extract_document', user_id: user.id });
      return json({ status: 'error', details: 'Rate limit exceeded' }, 429, req);
    }

    return extractDocument(body, req, supabase, user.id);
  }

  // Default mode: Claude-format chat. Use the smaller rate limit.
  {
    const { data: allowed, error: rlErr } = await supabase.rpc('rate_limit_check', {
      kind:        `ai_proxy:${user.id}`,
      max_per_min: 10,
    });
    // Fail-closed on RPC error — see comment above. Audit finding H-5.
    if (rlErr) {
      logSecurityEvent('ai-proxy', 'rate_limit_error', { kind: 'ai_proxy', user_id: user.id, error: rlErr.message });
      await reportEdgeError('rate_limit_check_failed', rlErr, { kind: 'ai_proxy' });
      return json({ error: 'rate limit system unavailable' }, 503, req);
    }
    if (allowed === false) {
      logSecurityEvent('ai-proxy', 'rate_limit_hit', { kind: 'ai_proxy', user_id: user.id });
      return json({ error: 'Rate limit exceeded' }, 429, req);
    }
  }

  // ── Monetization phase 5b: the advisor quota ──────────────────────────
  //
  // Placed after the Default-mode rate limit and BEFORE any provider call,
  // because a refused request must not cost a provider token.
  //
  // ⚠️ 402 AND 429 ARE DIFFERENT ON PURPOSE. aiProxy.js maps every 429 to
  // "נסה שוב בעוד דקה" and AiAssistant to "המתן דקה" — right for the
  // per-minute limiter above, and wrong for a plan block: it would tell a
  // free user who spent their one question to wait sixty seconds for
  // something that never arrives. The reason string is what lets the client
  // tell a paywall from a cooldown.
  //
  // ⚠️ FAIL OPEN ON AN RPC ERROR, deliberately, and this is the ONE place in
  // the monetization work that does. Everywhere else a swallowed error is a
  // way to skip paying. Here the flag is off until deliberately enabled, the
  // whole decision already lives in SQL where the client cannot reach it,
  // and a Supabase blip must not take the advisor down for every paying
  // customer. The cost of the open direction is a handful of free calls
  // during an outage; the cost of the closed direction is the feature dark.
  {
    const surfaceForQuota: string | null = sanitizeSurface(body);

    if (countsTowardAiQuota(surfaceForQuota)) {
      try {
        const { data: verdict, error: qErr } = await supabase.rpc('ai_quota_check', {
          p_user_id: user.id,
        });
        if (qErr) throw qErr;

        if (verdict && verdict.allowed === false) {
          const reason = String(verdict.reason || '');
          // ⚠️ DELIBERATELY NOT logSecurityEvent. A quota block is not an
          // anomaly: it is the expected outcome of every free user's second
          // question, so at this user count it would emit hundreds of
          // "security events" and bury the stream's real signals
          // (ssrf_rejected, auth_failed) under routine paywall hits.
          // 'ai_quota_block' is also not in the SecurityEvent union, and
          // widening that union is the wrong fix. The decision is already
          // recoverable from feature_usage_counters, which holds the counts
          // that produced it, and the client receives an explicit reason.
          if (reason === 'ai_requires_paid_plan') {
            // 402 Payment Required: the remedy is an upgrade.
            return json({
              error: 'ai_requires_paid_plan',
              reason: 'ai_requires_paid_plan',
              limit: verdict.limit ?? null,
              used: verdict.used ?? null,
            }, 402, req);
          }
          // 429 for the daily ceiling: the remedy is tomorrow, not money.
          // The body's `reason` is how the client avoids reusing the
          // rate-limiter copy.
          //
          // Also the default for any reason this code does not recognise.
          // `allowed: false` is authoritative, so an unknown reason must
          // still refuse, and of the two shapes this is the safe one to
          // guess: it never names a paid plan, so it cannot become an
          // anti-steering violation on iOS, and it never promises the
          // 60-second wait that the rate-limiter copy would.
          return json({
            error: 'ai_daily_cap_reached',
            reason: 'ai_daily_cap_reached',
            limit: verdict.limit ?? null,
            used: verdict.used ?? null,
          }, 429, req);
        }
      } catch (e) {
        // ⚠️ "FUNCTION MISSING" IS AN EXPECTED STATE AND MUST NOT BE
        // REPORTED. This code ships before its migration is applied, so
        // until Ofek runs phase 5b every advisor call gets PGRST202 from
        // PostgREST. Reporting that would write one app_errors row per AI
        // request across the whole user base, which is how a useful error
        // table becomes one nobody reads. Phase 3's counter took the same
        // decision, for the same reason.
        //
        // Every OTHER failure IS reported, and the asymmetry is the point:
        // once the function exists, an error here means the paywall is
        // silently open, which is exactly the condition worth an alert.
        const msg = String((e as any)?.message || '');
        const code = String((e as any)?.code || '');
        const notDeployedYet =
          code === 'PGRST202' || /could not find the function|does not exist/i.test(msg);
        console.warn('[ai-proxy] quota check failed, allowing:', msg);
        if (!notDeployedYet) {
          await reportEdgeError('ai_quota_check_failed', e as Error, { user_id: user.id });
        }
      }
    }
  }

  const hasImages = (body.messages || []).some((m: any) =>
    Array.isArray(m.content) && m.content.some((p: any) => p.type === 'image' || p.type === 'document')
  );

  // Look up the admin's chosen provider for this feature. The client can
  // pass `feature` in the body ('community_expert', 'yossi_chat',
  // 'scan_extraction'); falls back to 'auto' if the feature isn't known
  // or the RPC errors. 'auto' = the legacy priority ladder below.
  // Defense-in-depth: whitelist the feature name before passing it to
  // the RPC. The RPC has its own CHECK constraint on get_ai_provider,
  // but validating client-side too means an attacker can't probe the
  // server for unexpected feature strings. See audit finding M-4.
  const ALLOWED_FEATURES = new Set(['community_expert', 'yossi_chat', 'scan_extraction']);
  let preferred: string = 'auto';
  if (typeof body?.feature === 'string' && ALLOWED_FEATURES.has(body.feature)) {
    try {
      const { data: pref } = await supabase.rpc('get_ai_provider', { p_feature: body.feature });
      if (typeof pref === 'string' && ['gemini', 'groq', 'claude', 'auto'].includes(pref)) {
        preferred = pref;
      }
    } catch { /* fall back to auto */ }
  }

  // Plate OCR is pinned to Claude when a key is configured. The
  // auto-ladder sends vision to Gemini first, but Gemini 2.5-flash
  // proved unreliable on Israeli plates (2026-05-27): it
  // intermittently refuses on PII grounds (empty completion) AND
  // truncates multi-group plates ("69-222-58" → "6922"). Claude reads
  // the full number and doesn't refuse a transcription task.
  //   • ANTHROPIC_KEY set  → preferred='claude' (strict: Claude or a
  //     503; no silent Gemini fallback, so a bad read can't slip in).
  //   • ANTHROPIC_KEY unset → preferred='auto' (Gemini-first ladder,
  //     i.e. exactly today's behaviour — no regression).
  // REQUIRES: ANTHROPIC_API_KEY in the ai-proxy Edge Function secrets.
  if (body?.feature === 'plate_scan') {
    preferred = ANTHROPIC_KEY ? 'claude' : 'auto';
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

  // Wrap the response with a usage-log write. Centralised so each
  // success path doesn't repeat the boilerplate. The log call is
  // awaited so the row lands before the worker context dies — adds
  // ~50 ms but guarantees the analytics surface stays consistent.
  // Pick up the surface tag from the request body and validate it.
  // Anything unknown is dropped to NULL — keeps the dashboard clean.
  const requestSurface: string | null = sanitizeSurface(body);

  // Monetization phase 3: count the advisor call. COUNTING ONLY, no refusal.
  //
  // ⚠️ SEPARATE FROM logAiUsage, AND THAT IS THE REQUIREMENT, NOT A STYLE
  // CHOICE. logAiUsage checks app_config.ai_usage_tracking_enabled before it
  // writes, so a quota built on ai_usage_logs would become INFINITE the
  // moment analytics were switched off. The AC demand the opposite, so this
  // write is deliberately outside that gate and reads no flag.
  //
  // Counted on SUCCESS only (§3.1 step 7): a provider that failed cost the
  // user nothing and must not consume an allowance.
  //
  // Failures here are swallowed. Before the phase-3 migration the RPCs do
  // not exist, and an advisor answer must never be lost because a counter
  // could not be written. Phase 5 is where the decision moves in front of
  // the call and a failure has to mean something.
  const countAdvisorUsage = async () => {
    if (!countsTowardAiQuota(requestSurface)) return;
    try {
      const { data: acct } = await supabase.rpc('resolve_usage_account', {
        p_user_id: user.id,
      });
      if (!acct) return;
      // Which bucket: 'ai_advisor' for a question the user asked, 'ai_forum'
      // for the community reply that a post triggers on its own. Only the
      // advisor bucket is measured against the free lifetime teaser, so a
      // forum reply cannot spend the one free question the user never asked
      // to use. See NON_TEASER_SURFACES in _shared/aiQuota.ts.
      const quotaFeature = aiQuotaFeature(requestSurface);
      // Both horizons, because the free plan is bounded by a lifetime
      // teaser while the paid plans are bounded by a daily ceiling, and
      // phase 3 has to measure against whichever the plan turns out to use.
      await supabase.rpc('bump_feature_usage', {
        p_account_id: acct, p_user_id: user.id,
        p_feature: quotaFeature, p_horizon: 'lifetime',
      });
      await supabase.rpc('bump_feature_usage', {
        p_account_id: acct, p_user_id: user.id,
        p_feature: quotaFeature, p_horizon: 'day',
      });
    } catch (e) {
      console.warn('[ai-proxy] usage count failed:', (e as any)?.message);
    }
  };

  const respondAndLog = async (r: any) => {
    await countAdvisorUsage();
    await logAiUsage(supabase, {
      user_id:           user.id,
      provider:          r?.provider,
      model:             r?.model || 'unknown',
      feature:           typeof body?.feature === 'string' ? body.feature : null,
      surface:           requestSurface,
      prompt_tokens:     r?.usage?.prompt_tokens     ?? null,
      completion_tokens: r?.usage?.completion_tokens ?? null,
      total_tokens:      r?.usage?.total_tokens      ?? null,
      had_attachment:    hasImages,
    });
    return json(r, 200, req);
  };

  if (preferred === 'gemini') {
    const r = await tryGemini(); if (r) return respondAndLog(r);
    return json({ error: 'Gemini provider unavailable', provider: 'gemini' }, 503, req);
  }
  if (preferred === 'groq') {
    if (hasImages) {
      // Groq doesn't support vision today — make the constraint explicit
      // so the admin sees a real error and can pick another provider.
      return json({ error: 'Groq does not support image input', provider: 'groq' }, 503, req);
    }
    const r = await tryGroq(); if (r) return respondAndLog(r);
    return json({ error: 'Groq provider unavailable', provider: 'groq' }, 503, req);
  }
  if (preferred === 'claude') {
    const r = await tryClaude(); if (r) return respondAndLog(r);
    return json({ error: 'Claude provider unavailable', provider: 'claude' }, 503, req);
  }

  // preferred === 'auto' (or unknown). New ladder (2026-05-26 — see
  // PM analysis): Gemini first for everything because it's the only
  // provider whose Hebrew is officially supported and the speed gap
  // vs Groq (~0.8s on a 600-token reply) is not user-perceptible.
  // Groq remains as a TEXT-ONLY fallback when Gemini is down or out
  // of its free-tier 1500 RPD quota. Claude is the last resort
  // (currently unavailable in this deployment — no ANTHROPIC_API_KEY).
  // Old ladder was Groq→Gemini for text and Gemini→Claude for vision.
  const gemini = await tryGemini(); if (gemini) return respondAndLog(gemini);
  if (!hasImages) {
    const groq = await tryGroq(); if (groq) return respondAndLog(groq);
  }
  const claude = await tryClaude(); if (claude) return respondAndLog(claude);

  await reportEdgeError('all_providers_unavailable', new Error('No AI provider available'), {
    has_images: hasImages,
    preferred,
    user_id: user.id,
  });
  return json({ error: 'No AI provider available' }, 503, req);
});

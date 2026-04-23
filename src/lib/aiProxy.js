/**
 * AI Proxy — thin client that forwards Claude-format requests to the
 * `ai-proxy` Supabase Edge Function. The Edge Function holds all provider
 * API keys server-side (Gemini / Groq / Anthropic) and handles provider
 * selection, fallback, and per-user rate limiting.
 *
 * Why this changed:
 *   Earlier versions read VITE_GEMINI_API_KEY / VITE_GROQ_API_KEY /
 *   VITE_ANTHROPIC_API_KEY directly from the browser bundle and called
 *   each provider over CORS. Vite inlines every VITE_* var into the
 *   built JS, so anyone downloading the bundle could lift the keys and
 *   burn quota against them. The keys now live only in Supabase Edge
 *   Function secrets — the browser never sees them.
 *
 * The only dev fallback preserved: if the user explicitly sets
 * VITE_ANTHROPIC_API_KEY in their local .env.local AND we're in DEV
 * mode, we still allow a direct Claude call for offline/local testing
 * against Deno. Production builds never take this path.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// Cold-start on Gemini can push a single request to 15-25s, plus our
// own network overhead. 45s gives headroom without leaving the user
// hanging forever.
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * AbortController-wrapped fetch. Throws a domain-specific error on
 * timeout so callers can distinguish it from network failures.
 */
async function fetchWithTimeout(url, opts = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('התשובה מהשרת מאחרת. נסה שוב או התחבר לרשת יציבה יותר.');
      e.code = 'TIMEOUT';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the Supabase ai-proxy Edge Function. The function validates the
 * JWT, rate-limits, and forwards to whichever provider is configured.
 */
async function callEdgeProxy(body) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    const e = new Error('VITE_SUPABASE_URL לא מוגדר');
    e.code = 'NO_SUPABASE_URL';
    throw e;
  }

  const { supabase } = await import('./supabase');
  // Get the active session. If the access token is near/past expiry,
  // proactively refresh it BEFORE sending the request — we saw cases
  // where the SDK held a technically-expired token and getSession()
  // returned it verbatim, leading to spurious 401s from the edge
  // function and a confusing "ההתחברות פגה" message for the user.
  let { data: { session } } = await supabase.auth.getSession();
  const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
  const needsRefresh = !expiresAt || (expiresAt - Date.now() < 60_000); // <60s left
  if (session && needsRefresh) {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed?.session) session = refreshed.session;
    } catch {
      // Refresh failed. Fall through; we'll throw NO_SESSION below if
      // there's no usable token at all, or let the edge function
      // return 401 otherwise so the user sees a single clear error.
    }
  }
  const token = session?.access_token;
  if (!token) {
    const e = new Error('יש להתחבר מחדש כדי להשתמש ב-AI');
    e.code = 'NO_SESSION';
    throw e;
  }

  let res;
  try {
    res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/ai-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // TIMEOUT or network error. Bubble up with a helpful code.
    if (err?.code === 'TIMEOUT') throw err;
    const e = new Error('שגיאת רשת בפנייה ל-AI. בדוק חיבור לאינטרנט.');
    e.code = 'NETWORK';
    throw e;
  }

  if (res.status === 429) {
    const e = new Error('חרגת ממגבלת קריאות ה-AI. נסה שוב בעוד דקה.');
    e.code = 'RATE_LIMIT';
    throw e;
  }
  if (res.status === 401) {
    const e = new Error('ההתחברות פגה. יש להתחבר מחדש.');
    e.code = 'UNAUTHORIZED';
    throw e;
  }
  if (res.status === 503) {
    // Edge function returns 503 when no AI provider is configured / all
    // providers failed. That typically means GEMINI_API_KEY isn't set
    // or is invalid. Surface a distinct message so deploys with missing
    // secrets are obvious.
    const e = new Error('שירות ה-AI עומס או לא מוגדר. נסה שוב בעוד כמה דקות.');
    e.code = 'PROVIDER_UNAVAILABLE';
    throw e;
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch {}
    const e = new Error(detail ? `AI error: ${detail}` : `AI error (${res.status})`);
    e.code = 'HTTP_' + res.status;
    throw e;
  }
  return await res.json();
}

/**
 * Dev-only fallback: direct call to Claude with a local key. Never runs
 * in a production build.
 */
async function callClaudeDev(body) {
  if (import.meta.env.PROD) return null;
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const res = await fetchWithTimeout(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  return await res.json();
}

/**
 * Send an AI request — routes through the Edge Function proxy.
 * @param {object} body - Claude-format request body
 * @returns {Promise<object>} - Response with { content: [{ text }] }
 * @throws {Error} - with a `.code` property describing the failure kind:
 *   TIMEOUT / NETWORK / NO_SESSION / RATE_LIMIT / UNAUTHORIZED /
 *   PROVIDER_UNAVAILABLE / HTTP_4xx / NO_SUPABASE_URL / AI_UNAVAILABLE
 * Callers that want to surface a meaningful UI message should inspect
 * `error.code` and pick the right copy.
 */
export async function aiRequest(body) {
  try {
    const result = await callEdgeProxy(body);
    if (result) return result;
  } catch (err) {
    // Rate-limit / auth / timeout errors bubble up with their
    // specific codes so the UI can react intelligently (e.g. offer
    // a retry after 60s for rate limits, a "log in again" prompt
    // for UNAUTHORIZED).
    if (err?.code) {
      // Dev fallback only for provider/network issues — user-facing
      // errors like RATE_LIMIT / UNAUTHORIZED shouldn't be masked.
      const hardFails = new Set([
        'RATE_LIMIT', 'UNAUTHORIZED', 'NO_SESSION', 'NO_SUPABASE_URL',
      ]);
      if (hardFails.has(err.code)) throw err;
    }
    if (import.meta.env.DEV) console.warn('ai-proxy edge function failed:', err?.code, err?.message);
  }

  // Dev offline fallback
  if (!import.meta.env.PROD) {
    try {
      const claudeResult = await callClaudeDev(body);
      if (claudeResult) return claudeResult;
    } catch (err) {
      if (import.meta.env.DEV) console.warn('Claude dev fallback failed:', err?.message);
    }
  }

  const e = new Error('שירות ה-AI לא זמין כעת. נסה שוב בעוד רגע.');
  e.code = 'AI_UNAVAILABLE';
  throw e;
}

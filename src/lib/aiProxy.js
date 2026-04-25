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

  // Resolve a fresh access token. Two-stage strategy:
  //   1. Proactive refresh: if <120s remain on the cached token, refresh
  //      before sending. Window is wider than 60s to absorb device clock
  //      skew — Capacitor PWAs on Android occasionally drift a minute+
  //      from real time, which used to make us send a "valid" token that
  //      Supabase had already expired.
  //   2. On 401 from the edge function, refresh + retry once. The 401
  //      really means "Supabase couldn't validate this JWT", which is
  //      almost always a token race we can recover from in one round-trip.
  // If refresh itself errors with no usable session, we throw NO_SESSION
  // immediately rather than swallowing — the user is genuinely logged out.
  const resolveToken = async ({ forceRefresh = false } = {}) => {
    let { data: { session } } = await supabase.auth.getSession();
    const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
    const needsRefresh = forceRefresh || !expiresAt || (expiresAt - Date.now() < 120_000);
    if (session && needsRefresh) {
      try {
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr) {
          if (import.meta.env.DEV) console.warn('[aiProxy] refreshSession error:', refreshErr.message);
          // Surface only when there's no usable token at all — a stale
          // token + a recoverable refresh error shouldn't kick the user
          // out; the edge function will tell us via 401 if it's truly bad.
          if (!session?.access_token) throw refreshErr;
        }
        if (refreshed?.session) session = refreshed.session;
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[aiProxy] refresh threw:', err?.message);
        if (!session?.access_token) throw err;
      }
    }
    return session?.access_token || null;
  };

  let token = await resolveToken();
  if (!token) {
    const e = new Error('יש להתחבר מחדש כדי להשתמש ב-AI');
    e.code = 'NO_SESSION';
    throw e;
  }

  const sendOnce = async (bearer) => {
    try {
      return await fetchWithTimeout(`${supabaseUrl}/functions/v1/ai-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bearer}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (err?.code === 'TIMEOUT') throw err;
      const e = new Error('שגיאת רשת בפנייה ל-AI. בדוק חיבור לאינטרנט.');
      e.code = 'NETWORK';
      throw e;
    }
  };

  let res = await sendOnce(token);

  // Single-shot 401 recovery: force-refresh and retry. Avoids the spurious
  // "ההתחברות פגה" toast users were seeing when the only real problem was
  // a token that expired during the request itself.
  if (res.status === 401) {
    if (import.meta.env.DEV) {
      let detail = '';
      try { detail = (await res.clone().json())?.error || ''; } catch {}
      console.warn('[aiProxy] 401 from edge, attempting refresh+retry. detail:', detail);
    }
    try {
      const fresh = await resolveToken({ forceRefresh: true });
      if (fresh && fresh !== token) {
        token = fresh;
        res = await sendOnce(token);
      }
    } catch {
      // Refresh failed for real → fall through to the 401 throw below.
    }
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
    // Edge function returns 503 when the admin-pinned provider failed
    // (strict mode) or when every provider in the auto-ladder bombed.
    // The body now includes `{ provider: 'gemini' | 'groq' | 'claude' }`
    // when a single provider is pinned, so we surface that specifically
    // — admins shipping a misconfigured GEMINI_API_KEY shouldn't get
    // the same generic toast as a real Gemini outage.
    let providerTag = '';
    try {
      const data = await res.clone().json();
      const map = { gemini: 'Gemini', groq: 'Groq', claude: 'Claude' };
      if (data?.provider && map[data.provider]) providerTag = map[data.provider];
    } catch {}
    const msg = providerTag
      ? `${providerTag} זמנית לא זמין. אדמין יכול לבחור ספק אחר בהגדרות AI, או נסה שוב בעוד כמה דקות.`
      : 'שירות ה-AI עומס או לא מוגדר. נסה שוב בעוד כמה דקות.';
    const e = new Error(msg);
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
    // Any error with a `.code` was raised by callEdgeProxy with a
    // user-meaningful message and should propagate verbatim. Examples:
    //   PROVIDER_UNAVAILABLE → "Groq זמנית לא זמין. אדמין יכול לבחור..."
    //   RATE_LIMIT           → "חרגת ממגבלת קריאות ה-AI..."
    //   UNAUTHORIZED         → "ההתחברות פגה..."
    //   TIMEOUT              → "התשובה מהשרת מאחרת..."
    //   NETWORK / HTTP_xxx   → specific network/server diagnostics
    //
    // Previous version only re-threw 4 codes and swallowed the rest,
    // turning every transient 503/timeout into a generic "AI לא זמין"
    // — which hid the real reason from the user (e.g., "Groq is down,
    // pick another provider"). We now propagate any coded error and
    // keep the dev-fallback path only as a last resort for *uncoded*
    // failures (truly unexpected exceptions).
    if (err?.code) {
      if (import.meta.env.DEV) console.warn('[aiRequest] coded failure:', err.code, err.message);
      throw err;
    }
    if (import.meta.env.DEV) console.warn('ai-proxy edge function failed (no code):', err?.message);
  }

  // Dev offline fallback. Only reached when callEdgeProxy threw an
  // uncoded error (very rare — JSON parse failure, fetch internals).
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

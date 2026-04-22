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

/**
 * Call the Supabase ai-proxy Edge Function. The function validates the
 * JWT, rate-limits, and forwards to whichever provider is configured.
 */
async function callEdgeProxy(body) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) return null;

  const { supabase } = await import('./supabase');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null; // Edge function requires an authenticated user

  const res = await fetch(`${supabaseUrl}/functions/v1/ai-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    throw new Error('חרגת ממגבלת קריאות ה-AI. נסה שוב בעוד דקה.');
  }
  if (!res.ok) {
    // Let the caller fall back to Claude dev path if available
    return null;
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

  const res = await fetch(ANTHROPIC_URL, {
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
 */
export async function aiRequest(body) {
  try {
    const result = await callEdgeProxy(body);
    if (result) return result;
  } catch (err) {
    // Rate-limit errors bubble up. Other failures fall through to dev path.
    if (err?.message && err.message.includes('חרגת')) throw err;
    if (import.meta.env.DEV) console.warn('ai-proxy edge function failed:', err?.message);
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

  throw new Error('שירות AI לא זמין - ודא שהתחברת למערכת');
}

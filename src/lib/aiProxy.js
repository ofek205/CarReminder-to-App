/**
 * AI Proxy — sends requests through a server-side proxy instead of exposing API keys.
 *
 * In development: Uses Vite proxy (/api/ai) → forwards to Anthropic with key on server side.
 * In production: Uses Supabase Edge Function (/functions/v1/ai-proxy).
 * Fallback: Direct call with client-side key (for backwards compatibility during migration).
 */

const ANTHROPIC_DIRECT = 'https://api.anthropic.com/v1/messages';

/**
 * Send an AI request safely without exposing the API key in the browser.
 * @param {object} body - The full request body for Claude API (model, max_tokens, messages)
 * @returns {Promise<object>} - The parsed JSON response
 */
export async function aiRequest(body) {
  // Try 1: Supabase Edge Function (production)
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      const { supabase } = await import('./supabase');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${supabaseUrl}/functions/v1/ai-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return await res.json();
      }
      // If edge function doesn't exist yet (404), fall through to fallback
      if (res.status !== 404) {
        throw new Error(`AI proxy error: ${res.status}`);
      }
    } catch (err) {
      if (err.message?.includes('AI proxy error')) throw err;
      // Edge function not deployed yet — fall through to fallback
    }
  }

  // In production: no fallback — AI features require Edge Function
  if (import.meta.env.PROD) {
    throw new Error('שירות AI לא זמין כרגע. נסה שוב מאוחר יותר.');
  }

  // Dev-only fallback: direct call with client-side key (NEVER in production builds)
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('AI service not configured — set VITE_ANTHROPIC_API_KEY in .env');
  }

  console.warn('[AI Proxy] Using direct API call — dev only. Deploy Edge Function for production.');

  const res = await fetch(ANTHROPIC_DIRECT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`AI request failed: ${res.status}`);
  }

  return await res.json();
}

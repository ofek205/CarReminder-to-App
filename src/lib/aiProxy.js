/**
 * AI Proxy - supports Gemini (free, primary) and Claude (fallback).
 *
 * Priority:
 * 1. Supabase Edge Function (if deployed)
 * 2. Google Gemini API (free, VITE_GEMINI_API_KEY)
 * 3. Anthropic Claude API (paid, VITE_ANTHROPIC_API_KEY, dev only)
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Convert Claude-format request to Gemini format and call Gemini API.
 * @param {object} body - Claude-format body (model, max_tokens, system, messages)
 * @returns {object} - Claude-format response { content: [{ text }] }
 */
async function callGemini(body) {
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!geminiKey) return null;

  // Convert Claude messages to Gemini format
  const parts = [];

  // System prompt goes as first user message context
  if (body.system) {
    parts.push({ text: body.system + '\n\n' });
  }

  // Convert messages
  for (const msg of (body.messages || [])) {
    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          parts.push({ text: part.text });
        } else if ((part.type === 'image' || part.type === 'document') && part.source?.type === 'base64') {
          // Gemini accepts both images and PDFs via inline_data. same shape,
          // just different mime_type. Document type used for PDF uploads.
          parts.push({
            inline_data: {
              mime_type: part.source.media_type,
              data: part.source.data,
            },
          });
        }
      }
    }
  }

  const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        maxOutputTokens: body.max_tokens || 400,
        temperature: 0.7,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('Gemini API error:', res.status, errText);
    return null; // Fall through to next provider
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Return in Claude-compatible format
  return { content: [{ type: 'text', text }] };
}

/**
 * Call Groq API (free, fast, OpenAI-compatible format).
 */
async function callGroq(body) {
  const groqKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!groqKey) return null;

  // Convert Claude format to OpenAI chat format
  const messages = [];
  if (body.system) {
    messages.push({ role: 'system', content: body.system });
  }
  for (const msg of (body.messages || [])) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role || 'user', content: msg.content });
    } else if (Array.isArray(msg.content)) {
      // Groq text-only - extract text parts, skip images
      const textParts = msg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
      if (textParts) {
        messages.push({ role: msg.role || 'user', content: textParts });
      }
    }
  }

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: body.model && body.model.includes('llama') ? body.model : 'llama-3.3-70b-versatile',
      messages,
      max_tokens: body.max_tokens || 400,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('Groq API error:', res.status, errText);
    // For 401/403 (auth) - throw so user sees clear error; for others fall through
    if (res.status === 401 || res.status === 403) {
      throw new Error('Invalid Groq API key');
    }
    return null;
  }

  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content || '';

  // Return in Claude-compatible format
  return { content: [{ type: 'text', text }] };
}

/**
 * Call Claude API directly (dev fallback).
 */
async function callClaude(body) {
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
 * Send an AI request - tries Gemini first (free), then Claude.
 * @param {object} body - Claude-format request body
 * @returns {Promise<object>} - Response with { content: [{ text }] }
 */
export async function aiRequest(body) {
  // Detect whether this request includes any images. Groq is text-only and
  // silently strips image parts. sending an OCR prompt to it would make the
  // model hallucinate from the prompt alone (this caused garbage results in
  // the vehicle license scan flow). Vision requests must skip straight to
  // Gemini (or another vision-capable provider).
  const hasImages = (body.messages || []).some(m =>
    Array.isArray(m.content) && m.content.some(p => p.type === 'image' || p.type === 'document')
  );

  if (!hasImages) {
    // Text-only path: Groq is fastest + free.
    try {
      const groqResult = await callGroq(body);
      if (groqResult) return groqResult;
    } catch (err) {
      console.warn('Groq failed, trying Gemini:', err.message);
    }
  }

  // Vision (or text fallback): Gemini supports images natively.
  try {
    const geminiResult = await callGemini(body);
    if (geminiResult) return geminiResult;
  } catch (err) {
    console.warn('Gemini failed:', err.message);
  }

  // Backup 2: Supabase Edge Function (if deployed)
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
      if (res.ok) return await res.json();
    } catch (err) {
      console.warn('Supabase Edge function failed:', err.message);
    }
  }

  // Last resort: Claude (dev only)
  if (!import.meta.env.PROD) {
    try {
      const claudeResult = await callClaude(body);
      if (claudeResult) return claudeResult;
    } catch (err) {
      console.warn('Claude fallback failed:', err.message);
    }
  }

  throw new Error('שירות AI לא זמין - בדוק מפתח API בהגדרות');
}

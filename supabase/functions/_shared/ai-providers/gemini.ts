// Gemini provider — chat with vision + schema-guided document extraction.
//
// Capabilities: chat (text + image + document parts), extraction (OCR).
// Today this is the only provider with extract() implemented. When we
// add a second extractor (Grok vision, Claude vision-extract, etc.) it
// gains a matching extract() method — the dispatcher picks per the
// admin's get_ai_provider('scan_extraction') preference.
//
// Ported from supabase/functions/ai-proxy/index.ts: callGemini() and
// extractDocument(). Behavior preserved exactly — same model version
// (gemini-2.5-flash as of 2026-05-26, see the rationale comment in the
// original file), same x-goog-api-key header (NOT query string — quota
// & key would leak into CDN/edge logs), same generationConfig per mode.

import { stripMarkdown } from './markdown.ts';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ExtractRequest,
  ExtractResponse,
  ProviderCapabilities,
} from './types.ts';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function extractJsonFromText(text: string): unknown {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const braced = candidate.match(/\{[\s\S]*\}/);
  const raw = braced ? braced[0] : candidate;
  try { return JSON.parse(raw); } catch { return null; }
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini' as const;
  readonly capabilities: ProviderCapabilities = {
    chat:       true,
    vision:     true,
    extraction: true,
  };

  private readonly apiKey: string | undefined;

  constructor(apiKey: string | undefined = Deno.env.get('GEMINI_API_KEY')) {
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async chat(body: ChatRequest): Promise<ChatResponse | null> {
    if (!this.apiKey) {
      console.warn('[ai-providers/gemini] no key configured');
      return null;
    }

    const parts: Array<
      { text: string } | { inline_data: { mime_type: string; data: string } }
    > = [];

    if (body.system) parts.push({ text: body.system + '\n\n' });

    for (const msg of body.messages || []) {
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (
            (part.type === 'image' || part.type === 'document') &&
            part.source?.type === 'base64'
          ) {
            parts.push({
              inline_data: { mime_type: part.source.media_type, data: part.source.data },
            });
          }
        }
      }
    }

    const res = await fetch(GEMINI_URL, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-goog-api-key':  this.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: body.max_tokens || 400, temperature: 0.7 },
      }),
    });

    if (!res.ok) {
      let excerpt = '';
      try { excerpt = (await res.text()).slice(0, 200); } catch {}
      console.warn(`[ai-providers/gemini] ${res.status}: ${excerpt}`);
      return null;
    }

    const j = await res.json();
    const text: string = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      // 200 with no candidates = safety filter block. Surface as null so
      // the dispatcher falls through to the next provider.
      console.warn('[ai-providers/gemini] empty completion (safety block?)');
      return null;
    }

    return {
      content:  [{ type: 'text', text: stripMarkdown(text) }],
      provider: 'gemini',
    };
  }

  async extract(req: ExtractRequest): Promise<ExtractResponse | null> {
    if (!this.apiKey) {
      return {
        status:   'error',
        details:  'No AI provider configured',
        provider: 'gemini',
      };
    }

    const schemaText =
      typeof req.schema === 'string' ? req.schema : JSON.stringify(req.schema);

    const prompt =
      (req.instructions ? req.instructions + '\n\n' : '') +
      'Extract the following fields from the attached document.\n' +
      'Return ONLY a single JSON object matching this schema (no prose, no markdown fences).\n' +
      'Omit fields you cannot determine from the document.\n' +
      'Dates: prefer ISO 8601 (YYYY-MM-DD) if possible.\n\n' +
      'Schema:\n' + schemaText;

    const res = await fetch(GEMINI_URL, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-goog-api-key':  this.apiKey,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: req.mime, data: req.data } },
          ],
        }],
        generationConfig: {
          maxOutputTokens:  1024,
          temperature:      0.1,
          responseMimeType: 'application/json',
        },
      }),
    }).catch(() => null);

    if (!res || !res.ok) {
      const detail = res ? await res.text().catch(() => '') : 'network error';
      return {
        status:   'error',
        details:  `AI call failed: ${detail.slice(0, 200)}`,
        provider: 'gemini',
      };
    }

    const j = await res.json().catch(() => ({}));
    const text: string = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = extractJsonFromText(text);
    if (!parsed || typeof parsed !== 'object') {
      return {
        status:   'error',
        details:  'Could not parse AI response as JSON',
        raw:      text.slice(0, 500),
        provider: 'gemini',
      };
    }

    return { status: 'success', output: parsed, provider: 'gemini' };
  }
}

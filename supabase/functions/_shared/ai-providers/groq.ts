// Groq provider — fast, low-cost text-only chat (Llama 3.3 70B by default).
//
// Capabilities: chat (text only). NO vision. The dispatcher must filter
// image/document parts out of the request before delegating to Groq, or
// the model will respond as if no image was present (this was the root
// cause of the OCR hallucination incident — see commit 12c254b).
//
// Ported from supabase/functions/ai-proxy/index.ts callGroq(). Behavior
// preserved exactly — same model fallback, same temperature, same
// stripMarkdown post-processing, same null-on-failure semantics.

import { stripMarkdown } from './markdown.ts';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ProviderCapabilities,
} from './types.ts';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export class GroqProvider implements AIProvider {
  readonly name = 'groq' as const;
  readonly capabilities: ProviderCapabilities = {
    chat:       true,
    vision:     false,
    extraction: false,
  };

  private readonly apiKey: string | undefined;

  constructor(apiKey: string | undefined = Deno.env.get('GROQ_API_KEY')) {
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async chat(body: ChatRequest): Promise<ChatResponse | null> {
    if (!this.apiKey) return null;

    const messages: Array<{ role: string; content: string }> = [];
    if (body.system) messages.push({ role: 'system', content: body.system });

    for (const msg of body.messages || []) {
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role || 'user', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Drop non-text parts. Groq has no vision today; if we passed
        // image/document parts through it would silently ignore them.
        const textParts = msg.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('\n');
        if (textParts) messages.push({ role: msg.role || 'user', content: textParts });
      }
    }

    const model =
      body.model && String(body.model).includes('llama')
        ? body.model
        : 'llama-3.3-70b-versatile';

    const res = await fetch(GROQ_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens:  body.max_tokens || 400,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      let excerpt = '';
      try { excerpt = (await res.text()).slice(0, 200); } catch {}
      console.warn(`[ai-providers/groq] ${res.status}: ${excerpt}`);
      return null;
    }

    const j = await res.json();
    const text: string = j?.choices?.[0]?.message?.content || '';
    if (!text) {
      console.warn('[ai-providers/groq] empty completion');
      return null;
    }

    return {
      content:  [{ type: 'text', text: stripMarkdown(text) }],
      provider: 'groq',
    };
  }
}

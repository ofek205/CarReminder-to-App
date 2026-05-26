// Claude (Anthropic) provider — chat fallback with native vision support.
//
// Capabilities: chat (text + image). No extraction implemented today —
// the Gemini path covers OCR. Could be added later if we need a vision
// fallback for scan_extraction.
//
// Ported from supabase/functions/ai-proxy/index.ts callClaude(). The
// request body is already in Claude's native shape (the canonical
// schema for this codebase), so adaptation is minimal: forward as-is,
// stripMarkdown each text block on the way back.

import { stripMarkdown } from './markdown.ts';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ProviderCapabilities,
} from './types.ts';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude' as const;
  readonly capabilities: ProviderCapabilities = {
    chat:       true,
    vision:     true,
    extraction: false,
  };

  private readonly apiKey: string | undefined;

  constructor(apiKey: string | undefined = Deno.env.get('ANTHROPIC_API_KEY')) {
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async chat(body: ChatRequest): Promise<ChatResponse | null> {
    if (!this.apiKey) return null;

    const res = await fetch(ANTHROPIC_URL, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let excerpt = '';
      try { excerpt = (await res.text()).slice(0, 200); } catch {}
      console.warn(`[ai-providers/claude] ${res.status}: ${excerpt}`);
      return null;
    }

    const j = await res.json();

    // Anthropic returns { content: [{type:'text', text:'...'}, ...] }.
    // Strip markdown on every text block; pass non-text blocks through.
    const blocks = Array.isArray(j?.content)
      ? j.content.map((block: { type?: string; text?: string }) =>
          block && block.type === 'text' && typeof block.text === 'string'
            ? { type: 'text' as const, text: stripMarkdown(block.text) }
            : block
        )
      : [];

    return { content: blocks, provider: 'claude' };
  }
}

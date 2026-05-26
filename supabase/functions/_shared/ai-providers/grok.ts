// Grok (xAI) provider — chat with vision support via api.x.ai.
//
// Status: SCAFFOLDED, not yet activated. No XAI_API_KEY exists in the
// project's secrets at the time of writing — isAvailable() will return
// false until one is configured, so the dispatcher will skip Grok
// silently. Adding the secret in Supabase Dashboard activates this
// provider with no code change.
//
// API: xAI exposes an OpenAI-compatible Chat Completions endpoint at
// https://api.x.ai/v1/chat/completions. Auth is Bearer XAI_API_KEY.
// Models:
//   • grok-2-latest         — text (default for non-vision requests)
//   • grok-2-vision-latest  — multimodal (auto-selected when image /
//                              document parts are present)
//
// Adaptation from the Claude-shaped ChatRequest used everywhere in this
// codebase:
//   • system → first message with role 'system'
//   • text parts → string content
//   • image / document parts → content array with image_url entries
//     whose url is a data URI ("data:<mime>;base64,<data>")
//
// Capabilities: chat (text + vision). Extraction is NOT wired up here —
// when Grok gains an extract() implementation later, set
// capabilities.extraction = true and the dispatcher will see it.

import { stripMarkdown } from './markdown.ts';
import type {
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ContentPart,
  ProviderCapabilities,
} from './types.ts';

const GROK_URL = 'https://api.x.ai/v1/chat/completions';

// Default model picks. Override via body.model when the caller knows
// what it wants (e.g. a future grok-3 release).
const GROK_TEXT_MODEL   = 'grok-2-latest';
const GROK_VISION_MODEL = 'grok-2-vision-latest';

function hasVisionParts(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p) => p.type === 'image' || p.type === 'document'),
  );
}

function toOpenAIContent(parts: ContentPart[]):
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > {
  const out: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [];
  for (const part of parts) {
    if (part.type === 'text') {
      out.push({ type: 'text', text: part.text });
    } else if (
      (part.type === 'image' || part.type === 'document') &&
      part.source?.type === 'base64'
    ) {
      out.push({
        type: 'image_url',
        image_url: {
          url: `data:${part.source.media_type};base64,${part.source.data}`,
        },
      });
    }
  }
  // Collapse to a plain string when there's only one text part — keeps
  // the wire format identical to the simpler text-only requests.
  if (out.length === 1 && out[0].type === 'text') return out[0].text;
  return out;
}

export class GrokProvider implements AIProvider {
  readonly name = 'grok' as const;
  readonly capabilities: ProviderCapabilities = {
    chat:       true,
    vision:     true,
    extraction: false,
  };

  private readonly apiKey: string | undefined;

  constructor(apiKey: string | undefined = Deno.env.get('XAI_API_KEY')) {
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async chat(body: ChatRequest): Promise<ChatResponse | null> {
    if (!this.apiKey) return null;

    const messages: Array<{ role: string; content: unknown }> = [];
    if (body.system) messages.push({ role: 'system', content: body.system });

    for (const msg of body.messages || []) {
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role || 'user', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        messages.push({
          role:    msg.role || 'user',
          content: toOpenAIContent(msg.content),
        });
      }
    }

    const wantsVision = hasVisionParts(body.messages || []);
    const model =
      body.model && String(body.model).toLowerCase().includes('grok')
        ? body.model
        : wantsVision
        ? GROK_VISION_MODEL
        : GROK_TEXT_MODEL;

    const res = await fetch(GROK_URL, {
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
      console.warn(`[ai-providers/grok] ${res.status}: ${excerpt}`);
      return null;
    }

    const j = await res.json();
    const text: string = j?.choices?.[0]?.message?.content || '';
    if (!text) {
      console.warn('[ai-providers/grok] empty completion');
      return null;
    }

    return {
      content:  [{ type: 'text', text: stripMarkdown(text) }],
      provider: 'grok',
    };
  }
}

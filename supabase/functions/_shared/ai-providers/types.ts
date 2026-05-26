// ═══════════════════════════════════════════════════════════════════════════
// AI Provider Abstraction — shared types
//
// Phase 1 of the multi-provider refactor. These interfaces describe a
// uniform shape every provider (Groq, Gemini, Claude, Grok/xAI) must
// satisfy so the dispatcher in ai-proxy can treat them interchangeably.
//
// IMPORTANT: This module is *additive*. The existing ai-proxy/index.ts
// continues to call its inline call*() functions and is not affected by
// anything in this directory until a follow-up phase wires it up.
// ═══════════════════════════════════════════════════════════════════════════

export type ProviderName = 'gemini' | 'groq' | 'claude' | 'grok';

// Mirrors the Claude / Anthropic message content schema, which is the
// canonical shape every call site in this codebase already uses (see
// src/lib/aiProxy.js). Each provider adapts this internally.
export type ContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image' | 'document';
      source: { type: 'base64'; media_type: string; data: string };
    };

export interface ChatMessage {
  role?: string;
  content: string | ContentPart[];
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  model?: string;
}

export interface ChatResponse {
  content: Array<{ type: 'text'; text: string }>;
  provider: ProviderName;
}

export interface ExtractRequest {
  data: string;             // base64
  mime: string;
  schema: string | object;  // JSON schema, stringified or object
  instructions?: string;
}

export interface ExtractResponse {
  status: 'success' | 'error';
  output?: unknown;
  details?: string;
  raw?: string;
  provider: ProviderName;
}

export interface ProviderCapabilities {
  chat: boolean;
  vision: boolean;
  extraction: boolean;
}

export interface AIProvider {
  readonly name: ProviderName;
  readonly capabilities: ProviderCapabilities;

  // True when the provider has the secret(s) it needs to run.
  // Cheap (no network) — used by the dispatcher and providers_status.
  isAvailable(): boolean;

  // null = soft failure (key missing, provider returned non-OK, empty
  // completion, safety block). Callers should treat null as "try next
  // provider". Throwing is reserved for programmer errors.
  chat?(req: ChatRequest): Promise<ChatResponse | null>;

  extract?(req: ExtractRequest): Promise<ExtractResponse | null>;
}

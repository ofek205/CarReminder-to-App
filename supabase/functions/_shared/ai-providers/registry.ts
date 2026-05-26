// Provider registry — single source of truth for which providers exist,
// which are available right now, and which to pick for a given feature.
//
// Used by the (future) v2 dispatcher in ai-proxy. The existing v1 path
// continues to use its inline ladder; this module is dormant until
// wired in a later phase.
//
// Selection rules mirror the live serve() in ai-proxy/index.ts:
//   • If admin preference is an explicit provider name and that
//     provider is available → strict mode, no fallback.
//   • If admin preference is 'auto' (or unknown) → legacy ladder:
//       - text requests:  Groq → Gemini → Claude
//       - vision requests: Gemini → Claude (Groq has no vision; Grok
//                           joins once enabled — see pickForFeature)
//   • Grok is included in 'auto' ordering only when XAI_API_KEY is set.

import { GeminiProvider } from './gemini.ts';
import { GroqProvider   } from './groq.ts';
import { ClaudeProvider } from './claude.ts';
import { GrokProvider   } from './grok.ts';
import type { AIProvider, ProviderName } from './types.ts';

// Lazy single-instance registry. Constructed once on first access so
// Deno.env reads happen at request time (not module load) — important
// because the secrets table is read from the runtime context.
let _registry: Map<ProviderName, AIProvider> | null = null;

function buildRegistry(): Map<ProviderName, AIProvider> {
  const m = new Map<ProviderName, AIProvider>();
  m.set('gemini', new GeminiProvider());
  m.set('groq',   new GroqProvider());
  m.set('claude', new ClaudeProvider());
  m.set('grok',   new GrokProvider());
  return m;
}

export function getRegistry(): Map<ProviderName, AIProvider> {
  if (!_registry) _registry = buildRegistry();
  return _registry;
}

export function getProvider(name: ProviderName): AIProvider | null {
  return getRegistry().get(name) || null;
}

export function listProviders(): AIProvider[] {
  return Array.from(getRegistry().values());
}

export function availabilityMap(): Record<ProviderName, boolean> {
  const out: Record<string, boolean> = {};
  for (const [name, p] of getRegistry()) out[name] = p.isAvailable();
  return out as Record<ProviderName, boolean>;
}

// Used by the dispatcher to walk the legacy 'auto' ladder. Returns
// providers in priority order, skipping any that are unavailable or
// (when needsVision is true) can't see images.
export function autoLadder(needsVision: boolean): AIProvider[] {
  const reg = getRegistry();
  const order: ProviderName[] = needsVision
    ? ['gemini', 'grok', 'claude']
    : ['groq', 'gemini', 'grok', 'claude'];

  const out: AIProvider[] = [];
  for (const name of order) {
    const p = reg.get(name);
    if (!p || !p.isAvailable()) continue;
    if (needsVision && !p.capabilities.vision) continue;
    if (!p.capabilities.chat) continue;
    out.push(p);
  }
  return out;
}

// Pick exactly one provider for a feature given the admin's stored
// preference. Returns:
//   { provider }           — caller should use this provider strictly
//   { ladder }             — caller should walk these in order
//   { error: 'no_vision' } — admin picked a non-vision provider for a
//                            request that contains images
//   { error: 'no_key' }    — admin picked a provider with no API key
export type PickResult =
  | { provider: AIProvider; ladder: null; error: null }
  | { provider: null;       ladder: AIProvider[]; error: null }
  | { provider: null;       ladder: null; error: 'no_vision' | 'no_key'; name: ProviderName };

export function pickForFeature(
  preferred: string,
  needsVision: boolean,
): PickResult {
  const KNOWN: ProviderName[] = ['gemini', 'groq', 'claude', 'grok'];

  if (KNOWN.includes(preferred as ProviderName)) {
    const name = preferred as ProviderName;
    const p = getProvider(name);
    if (!p || !p.isAvailable()) {
      return { provider: null, ladder: null, error: 'no_key', name };
    }
    if (needsVision && !p.capabilities.vision) {
      return { provider: null, ladder: null, error: 'no_vision', name };
    }
    return { provider: p, ladder: null, error: null };
  }

  // 'auto' or unknown — return the ladder.
  return { provider: null, ladder: autoLadder(needsVision), error: null };
}

// Test-only hook so future unit tests can install fakes. Not exported
// elsewhere — production code should never call this.
export function __setRegistryForTests(m: Map<ProviderName, AIProvider> | null) {
  _registry = m;
}

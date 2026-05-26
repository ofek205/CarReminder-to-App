/**
 * AiProviderBadge — tiny "Powered by X" chip shown under AI replies.
 *
 * The ai-proxy Edge Function stamps `provider: 'gemini' | 'groq' | 'claude'`
 * into the response; the chat components pass that prop here. Intentionally
 * visible to ALL users (not just admins) — knowing which model answered
 * is useful when a user wants to evaluate an answer's reliability.
 */
import React from 'react';
import { Sparkles } from 'lucide-react';
import { C } from '@/lib/designTokens';

const STYLES = {
  gemini: { bg: C.infoSubtle, color: '#1D4ED8', border: '#BFDBFE', label: 'Gemini' },
  groq:   { bg: C.warnBg, color: C.warnDark, border: C.warnBorder, label: 'Groq' },
  claude: { bg: '#FDF2F8', color: '#9D174D', border: '#FBCFE8', label: 'Claude' },
};

export default function AiProviderBadge({ provider }) {
  if (!provider) return null;
  const s = STYLES[provider] || { bg: C.gray100, color: C.gray500, border: C.gray200, label: provider };
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
      title={`תשובה זו נוצרה על ידי ${s.label}`}
    >
      <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
      {s.label}
    </span>
  );
}

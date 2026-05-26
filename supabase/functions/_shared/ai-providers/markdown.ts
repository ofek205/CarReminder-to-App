// Strip common markdown formatting from chat completions before
// returning to the client. Lifted verbatim from ai-proxy/index.ts —
// see that file for the long-form rationale (the /AiAssistant surface
// renders responses as plain text, so **bold** etc. appear literally).
//
// Conservative rules (we do not parse full markdown, just unwrap the
// common AI-output patterns):
//   • **bold**       → bold
//   • *italic*       → italic        (lookarounds preserve "* item"
//                                     bullets and "a * b" operators)
//   • ## heading     → heading
//   • `code`         → code
//   • ```fenced```   → content       (fences stripped)
//   • --- rules      → removed
//
// extract_document responses go through their own schema-guided prompt
// and never touch this helper — JSON outputs stay untouched.

export function stripMarkdown(text: string): string {
  if (typeof text !== 'string' || !text) return text;
  let s = text;
  // Bold MUST run before italic — otherwise the inner ** in **word**
  // matches the italic pattern first and leaves *word* dangling.
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  s = s.replace(/(?<=\S)\*([^\s*][^*\n]*[^\s*])\*(?=\S)/g, '$1');
  s = s.replace(/(?<=\S)\*([^\s*])\*(?=\S)/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/```[a-z0-9]*\n?/gi, '');
  s = s.replace(/```/g, '');
  s = s.replace(/`([^`\n]+)`/g, '$1');
  s = s.replace(/^[ \t]*-{3,}[ \t]*$/gm, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

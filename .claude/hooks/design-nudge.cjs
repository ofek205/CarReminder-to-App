#!/usr/bin/env node
/**
 * Advisory hook — reminds Claude of the UI Playbook when a prompt or an edit
 * touches the front end. Handles both events it is wired to:
 *
 *   UserPromptSubmit  — the user's prompt mentions design / UI / a screen
 *   PreToolUse        — a Write/Edit targets a component, page, or stylesheet
 *
 * FAIL-OPEN, DELIBERATELY
 * -----------------------
 * This is the opposite choice from commit-gate.cjs, and the difference is the
 * point. That gate blocks; if it cannot evaluate itself it must block, because
 * a broken blocker that allows is worse than useless. This one only *injects
 * advice*; if it cannot evaluate itself the correct behaviour is to stay quiet
 * and let the work proceed. A malfunctioning reminder must never stop an edit.
 *
 * Always exits 0. Emits the context envelope on stdout, or nothing at all.
 */

'use strict';

const fs = require('fs');

const PLAYBOOK = [
  'זוהתה עבודת פרונט. ה-Playbook ב-CLAUDE.md (סעיף „Playbook — שינויי UI”):',
  'pm → ux → designer → copywriter → frontend-design → qa.',
  '',
  'דילוג מותר רק לפי כללי הדילוג הכתובים שם — תיקון מיקרו, שינוי copy בלבד,',
  'או באג ב-flow קיים. שינוי layout, קומפוננטה חדשה או state חדש בלי ux+designer',
  'הוא BLOCK עצמי.',
  '',
  'חובה בכל שינוי UI: כל המצבים (default / loading / empty / error / offline),',
  'עברית RTL, mobile-first בטווח האגודל, ואימות ב-preview לפני שמכריזים על סיום.',
].join('\n');

/** Prompt keywords that signal design/UI intent. */
const PROMPT_RE =
  /עיצוב|תעצב|אסתטיקה|נראות|חזות|מסך|קומפוננט|טופס|כפתור|פונט|גופן|חזית|פרונט|\bUI\b|\bUX\b|frontend|front-end|design|redesign|component|screen|layout|styling|responsive/i;

/** Paths whose edits are front-end work. Excludes vendored shadcn primitives. */
const PATH_RE = /\.(tsx|jsx|css|scss)$|[\\/](components|pages)[\\/]/i;
const VENDORED_RE = /[\\/]components[\\/]ui[\\/]/i;

function emit(eventName) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: eventName, additionalContext: PLAYBOOK },
    }) + '\n'
  );
}

try {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  const event = payload?.hook_event_name;

  if (event === 'UserPromptSubmit') {
    if (PROMPT_RE.test(payload?.prompt ?? '')) emit('UserPromptSubmit');
  } else if (event === 'PreToolUse') {
    const file = payload?.tool_input?.file_path ?? '';
    if (PATH_RE.test(file) && !VENDORED_RE.test(file)) emit('PreToolUse');
  }
} catch {
  /* Advisory only — stay silent rather than interfere. See the note above. */
}

process.exit(0);

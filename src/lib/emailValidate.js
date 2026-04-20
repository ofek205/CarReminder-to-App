/**
 * emailValidate — lightweight validation for editable email templates.
 *
 * Two responsibilities:
 *
 *   1. extractPlaceholders(string)  — scan any template field and return
 *      the list of {{variable}} names found inside it.
 *
 *   2. validateTemplate(template)   — take a full template object and tell
 *      the caller whether the declared `variables` array matches what the
 *      content actually uses. This is the architect's #2 critical fix:
 *      silent `{{foo}}` leaking into production emails is the worst
 *      debugging hell; we catch it at save time instead.
 *
 * Kept framework-free so the template editor UI AND the Edge Function
 * (Deno) can both import it if needed.
 */

// Matches {{ anything }} with optional whitespace. Name is \w+ (letters,
// digits, underscore). Admin-authored content, so we don't try to be a
// full HTML parser — just find every Mustache-style token.
const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Returns an array of unique placeholder names (order preserved, dedup).
 * Example: extractPlaceholders("Hi {{name}}, see {{link}} — {{name}}")
 *          → ["name", "link"]
 */
export function extractPlaceholders(text = '') {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  PLACEHOLDER_RE.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER_RE.exec(String(text))) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

// Fields on a template that can contain {{placeholders}}. Everything else
// (from_email, reply_to) is plain text and doesn't get scanned.
const CONTENT_FIELDS = [
  'subject',
  'preheader',
  'title',
  'body_html',
  'cta_label',
  'cta_url',
  'footer_note',
];

/**
 * validateTemplate(template)
 *
 * Returns { ok: true } if declared vars match content, otherwise
 * { ok: false, errors: [...], warnings: [...], found, declared }.
 *
 * - errors  → placeholder used in content but NOT declared in variables[].
 *             Those will silently leave `{{foo}}` visible to the user.
 * - warnings → declared variable never used in content. Harmless but
 *             suggests stale declarations.
 *
 * The UI should block save on errors and surface warnings as a soft hint.
 */
export function validateTemplate(template) {
  if (!template || typeof template !== 'object') {
    return { ok: false, errors: ['תבנית לא תקינה'], warnings: [], found: [], declared: [] };
  }

  const declared = Array.isArray(template.variables)
    ? template.variables.filter(v => typeof v === 'string')
    : [];

  // Collect placeholders from every content field.
  const foundSet = new Set();
  const byField = {};
  for (const field of CONTENT_FIELDS) {
    const value = template[field];
    if (!value) continue;
    const names = extractPlaceholders(value);
    byField[field] = names;
    names.forEach(n => foundSet.add(n));
  }
  const found = Array.from(foundSet);

  const errors = [];
  const warnings = [];

  const declaredSet = new Set(declared);
  for (const name of found) {
    if (!declaredSet.has(name)) {
      errors.push(
        `המשתנה {{${name}}} מופיע בתבנית אבל לא מוצהר ברשימת המשתנים. הוסף אותו או הסר אותו מהתוכן.`
      );
    }
  }
  for (const name of declared) {
    if (!foundSet.has(name)) {
      warnings.push(`המשתנה {{${name}}} מוצהר אבל לא משמש בתוכן.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    found,
    declared,
    byField,
  };
}

/**
 * renderPlaceholders(text, vars)
 *
 * Replaces {{name}} with vars[name]. Missing vars are left as literal
 * `{{name}}` so validation errors are visible rather than silently empty.
 *
 * Intentionally NOT HTML-escaping the values — admin-authored templates
 * may want to inject URLs, which can contain &. Callers that embed user-
 * supplied strings (like an invitee's name) must escape those BEFORE
 * passing them in. See emailRender.js for the full pipeline.
 */
export function renderPlaceholders(text = '', vars = {}) {
  if (!text) return '';
  return String(text).replace(PLACEHOLDER_RE, (_match, name) => {
    const v = vars[name];
    return v === undefined || v === null ? `{{${name}}}` : String(v);
  });
}

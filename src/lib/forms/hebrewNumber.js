/**
 * hebrewNumber — convert an integer amount to Hebrew words (for the
 * "במילים" line on contracts, e.g. a vehicle sale price).
 *
 * Scope: 0–999,999 (covers realistic vehicle prices). Above that returns
 * '' so the caller leaves the words field for the user to type. The forms
 * use this to AUTO-FILL an editable field — so a rare imperfect edge case
 * (Hebrew number grammar is genuinely thorny) is always user-correctable.
 *
 * Uses masculine number forms because שקל is a masculine noun
 * (שלושה שקלים, not שלוש).
 */

const ONES = ['', 'אחד', 'שניים', 'שלושה', 'ארבעה', 'חמישה', 'שישה', 'שבעה', 'שמונה', 'תשעה'];
const TEENS = ['עשרה', 'אחד עשר', 'שנים עשר', 'שלושה עשר', 'ארבעה עשר', 'חמישה עשר', 'שישה עשר', 'שבעה עשר', 'שמונה עשר', 'תשעה עשר'];
const TENS = ['', 'עשרה', 'עשרים', 'שלושים', 'ארבעים', 'חמישים', 'שישים', 'שבעים', 'שמונים', 'תשעים'];
const HUNDREDS = ['', 'מאה', 'מאתיים', 'שלוש מאות', 'ארבע מאות', 'חמש מאות', 'שש מאות', 'שבע מאות', 'שמונה מאות', 'תשע מאות'];
// Construct forms for 1,000–10,000.
const THOUSANDS = ['', 'אלף', 'אלפיים', 'שלושת אלפים', 'ארבעת אלפים', 'חמשת אלפים', 'ששת אלפים', 'שבעת אלפים', 'שמונת אלפים', 'תשעת אלפים', 'עשרת אלפים'];

// Join word-groups, attaching "ו" (and) to the final group — the standard
// connector in spoken Hebrew amounts (מאה עשרים וחמישה).
function joinVav(parts) {
  const p = parts.filter(Boolean);
  if (p.length === 0) return '';
  if (p.length === 1) return p[0];
  return p.slice(0, -1).join(' ') + ' ו' + p[p.length - 1];
}

function belowThousand(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rem) {
    if (rem < 10) parts.push(ONES[rem]);
    else if (rem < 20) parts.push(TEENS[rem - 10]);
    else {
      const t = Math.floor(rem / 10);
      const u = rem % 10;
      parts.push(TENS[t]);
      if (u) parts.push(ONES[u]);
    }
  }
  return joinVav(parts);
}

export function numberToHebrewWords(value) {
  const num = Math.floor(Math.abs(Number(value) || 0));
  if (num === 0) return 'אפס';
  if (num > 999999) return '';

  const thousands = Math.floor(num / 1000);
  const rest = num % 1000;
  const groups = [];

  if (thousands) {
    if (thousands <= 10) groups.push(THOUSANDS[thousands]);
    else groups.push(belowThousand(thousands) + ' אלף');
  }
  if (rest) groups.push(belowThousand(rest));

  return joinVav(groups);
}

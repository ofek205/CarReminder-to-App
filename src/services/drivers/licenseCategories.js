/**
 * License category catalog — single source of truth for the chip picker
 * in the External-Driver form and the badge renderer on the list/detail.
 *
 * Codes match what the DB stores in external_drivers.license_categories
 * (text[]). The catalog is OPEN: a manager can also type a free-text
 * "אחר" (custom) category — those flow through as plain strings that
 * aren't in this list. The badge renderer falls back to the raw code
 * when the catalog has no match.
 *
 * Order = display order in the picker. Most common first.
 */

export const LICENSE_CATEGORIES = [
  { code: 'B',       label: 'B - רכב פרטי',          emoji: '🚗' },
  { code: 'A1',      label: "A1 - אופנוע עד 33 כ\"ס", emoji: '🛵' },
  { code: 'A',       label: 'A - אופנוע',            emoji: '🏍️' },
  { code: 'C1',      label: 'C1 - משאית עד 12 טון',  emoji: '🚛' },
  { code: 'C',       label: 'C - משאית מעל 12 טון',  emoji: '🚚' },
  { code: 'D1',      label: 'D1 - מיניבוס',          emoji: '🚐' },
  { code: 'D',       label: 'D - אוטובוס',           emoji: '🚌' },
  { code: 'E',       label: 'E - גרור',              emoji: '🛻' },
  { code: 'forklift',label: 'מלגזה',                 emoji: '🚜' },
  { code: 'tractor', label: 'טרקטור',                emoji: '🚜' },
  { code: 'crane',   label: 'מנוף',                  emoji: '🏗️' },
];

const BY_CODE = Object.fromEntries(LICENSE_CATEGORIES.map(c => [c.code, c]));

/**
 * Resolve a category code (or free-text label) to a display object.
 * Free-text entries get `code === label`, no emoji.
 */
export function getLicenseCategory(code) {
  if (!code) return { code: '', label: '', emoji: '' };
  if (BY_CODE[code]) return BY_CODE[code];
  return { code, label: code, emoji: '' };
}

export function categoryShortLabel(code) {
  // Short label for chips — strip the long " - description" suffix.
  const c = getLicenseCategory(code);
  if (!c.label) return '';
  return c.label.split(' - ')[0];
}

export function categoryEmoji(code) {
  return getLicenseCategory(code).emoji || '';
}

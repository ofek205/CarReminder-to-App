/**
 * Expense category catalog — single source of truth.
 *
 * 16 codes, the same set the DB CHECK constraint validates against.
 * The order here is the order the dropdown filter shows them.
 *
 * Each category has:
 *   - code   — the DB value
 *   - label  — Hebrew display string
 *   - emoji  — single character used inline in row cards
 *   - source — which table this category lives in:
 *                'expense'     → vehicle_expenses (writeable from this UI)
 *                'maintenance' → maintenance_logs (read-only here)
 *                'repair'      → repair_logs (read-only here)
 *
 * The 'maintenance' / 'repair' categories appear in this list because the
 * Expenses feed READS them (via v_vehicle_expense_feed). The form does
 * NOT let the user pick them when adding a new manual expense — the
 * picker filters them out. They're surfaced for filtering / display only.
 */

export const EXPENSE_CATEGORIES = [
  { code: 'fuel',             label: 'דלק',           emoji: '⛽', source: 'expense' },
  { code: 'maintenance',      label: 'טיפול',         emoji: '🔧', source: 'maintenance' },
  { code: 'repair',           label: 'תיקון',         emoji: '🛠️', source: 'repair' },
  { code: 'inspection',       label: 'טסט',           emoji: '📋', source: 'expense' },
  { code: 'license_fee',      label: 'אגרת רישוי',   emoji: '🪪', source: 'expense' },
  { code: 'insurance_mtpl',   label: 'ביטוח חובה',   emoji: '🛡️', source: 'expense' },
  { code: 'insurance_comp',   label: 'ביטוח מקיף',   emoji: '🔒', source: 'expense' },
  { code: 'insurance_3p',     label: 'ביטוח צד ג׳',  emoji: '🤝', source: 'expense' },
  { code: 'tires',            label: 'צמיגים',        emoji: '🛞', source: 'expense' },
  { code: 'parking',          label: 'חניה',          emoji: '🅿️', source: 'expense' },
  { code: 'wash',             label: 'שטיפה',         emoji: '🧼', source: 'expense' },
  { code: 'toll',             label: 'כבישי אגרה',    emoji: '🛣️', source: 'expense' },
  { code: 'towing',           label: 'גרירה',         emoji: '🚛', source: 'expense' },
  { code: 'accessories',      label: 'אביזרים',       emoji: '🎒', source: 'expense' },
  { code: 'general',          label: 'כללי',          emoji: '💰', source: 'expense' },
  { code: 'other',            label: 'אחר',           emoji: '📦', source: 'expense' },
];

const BY_CODE = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.code, c]));

export function getCategory(code) {
  return BY_CODE[code] || BY_CODE.other;
}

export function categoryLabel(code) {
  return getCategory(code).label;
}

export function categoryEmoji(code) {
  return getCategory(code).emoji;
}

/**
 * Categories the user can pick when ADDING a manual expense. We exclude
 * 'maintenance' and 'repair' because those have their own dedicated
 * dialogs (MaintenanceDialog, AddRepairDialog) that capture richer
 * fields like km_at_service, repair_type_id, attachments.
 */
export const MANUAL_EXPENSE_CATEGORIES = EXPENSE_CATEGORIES.filter(
  c => c.source === 'expense'
);

/**
 * Source-type → human badge label. Drives the small chip on each row.
 */
export const SOURCE_BADGE = {
  expense:     { label: 'ידני',  tone: 'neutral' },
  ai_scan:     { label: 'נסרק',   tone: 'neutral' },
  maintenance: { label: 'טיפול', tone: 'info'    },
  repair:      { label: 'תיקון', tone: 'info'    },
};

/**
 * Describing a plan exception in words.
 *
 * Pure, and separate from the screen, because this is where a wrong render
 * misleads an admin about a commercial deal. "רכבים: 15" when the real
 * override is unlimited, or a row that looks active when the grant lapsed
 * last month, are both decisions made on false information.
 *
 * @see docs/plan-monetization-implementation.md §3.5.7
 */

export const UNLIMITED_LABEL = 'ללא הגבלה';

/** The override columns, in the order an admin reads them. */
export const OVERRIDE_FIELDS = [
  { key: 'max_vehicles',           label: 'כלי תחבורה' },
  { key: 'plate_checks_per_month', label: 'בדיקות רכב לחודש' },
  { key: 'max_shares',             label: 'שיתופים' },
  { key: 'ai_daily_cap',           label: 'קריאות AI ליום' },
  { key: 'ai_lifetime_teaser',     label: 'שאלות AI להתרשמות' },
  { key: 'business_ui',            label: 'ממשק עסקי' },
];

/**
 * Render one numeric limit for display.
 *
 * ⚠️ TWO SEPARATE CONVENTIONS MEET HERE, which is the whole reason this is
 * a function and not an inline template:
 *   in plan_limits,     NULL  = unlimited
 *   in override columns, -1    = unlimited, NULL = inherit
 * Both must read as "ללא הגבלה" to a human, and neither must ever render as
 * the literal "-1" or an empty string.
 */
export function limitText(value) {
  if (value === null || value === undefined) return UNLIMITED_LABEL;
  if (value === -1) return UNLIMITED_LABEL;
  return String(value);
}

/**
 * One line per overridden limit: what it is now, and what the plan says.
 *
 * Only fields that are ACTUALLY overridden appear. A row is included when
 * its override column is non-null, so "inherit" never shows up as a
 * deviation, and `0` is a real override rather than a falsy blank.
 *
 * @param {object} row   one admin_list_plan_exceptions row
 * @param {object|null} basePlan  the plan_limits row for row.base_plan
 * @returns {Array<{label: string, now: string, was: string}>}
 */
export function describeOverrides(row, basePlan) {
  if (!row) return [];
  const out = [];
  for (const { key, label } of OVERRIDE_FIELDS) {
    const ovr = row[`ovr_${key}`];
    // Explicit null/undefined test, never falsy: 0 and false are both
    // legitimate overrides ("no vehicles allowed", "no business UI").
    if (ovr === null || ovr === undefined) continue;

    const was = basePlan
      ? (key === 'business_ui'
        ? (basePlan.business_ui ? 'כלול' : 'לא כלול')
        : limitText(basePlan[key]))
      : null;

    out.push({
      label,
      now: key === 'business_ui'
        ? (ovr ? 'כלול' : 'לא כלול')
        : limitText(ovr),
      was,
    });
  }
  return out;
}

/**
 * How urgent this exception is, for badging and for the summary counts.
 *
 * 'expired'  the window has passed. The server ALREADY ignores it, so this
 *            is stale bookkeeping and not a live leak. Saying otherwise
 *            would be a false alarm.
 * 'never'    no expiry at all. This is the one that leaks: a free grant
 *            nobody revisits, with no alert anywhere.
 * 'soon'     lapses within a week, so it needs a decision now.
 * 'active'   in force, with time left.
 */
export function exceptionUrgency(row, now = Date.now()) {
  if (!row) return 'active';
  if (!row.ovr_expires_at) return 'never';
  const end = new Date(row.ovr_expires_at).getTime();
  if (!Number.isFinite(end)) return 'never';
  if (end <= now) return 'expired';
  if (end - now <= 7 * 86_400_000) return 'soon';
  return 'active';
}

/** Whole days until expiry, or null when there is no live window. */
export function daysUntil(iso, now = Date.now()) {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return null;
  const ms = end - now;
  if (ms <= 0) return null;
  return Math.ceil(ms / 86_400_000);
}

/**
 * Is this account currently holding more vehicles than its effective cap?
 *
 * §3.5.9: an override set below current usage does not delete anything, the
 * account simply cannot add more. Surfacing it lets an admin see that a
 * deal they are about to write is already breached.
 */
export function isOverCap(row) {
  if (!row) return false;
  const cap = row.eff_max_vehicles;
  if (cap === null || cap === undefined) return false;   // unlimited
  const count = Number(row.vehicle_count);
  if (!Number.isFinite(count)) return false;
  return count > cap;
}

/** Counts for the summary strip. */
export function summarise(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let never = 0, expired = 0, soon = 0, overCap = 0;
  for (const r of list) {
    const u = exceptionUrgency(r);
    if (u === 'never') never++;
    else if (u === 'expired') expired++;
    else if (u === 'soon') soon++;
    if (isOverCap(r)) overCap++;
  }
  return { total: list.length, never, expired, soon, overCap };
}

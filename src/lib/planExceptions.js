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

/**
 * Turn what an admin chose in the UI into the value the RPC expects.
 *
 * ⚠️ THE ADMIN MUST NEVER SEE OR TYPE -1. The sentinel is a storage detail
 * born of NULL meaning two opposite things in two tables; asking a human to
 * remember it is how you get a -1 typed into a field that wanted a count,
 * or a genuine "1" turned into unlimited by a stray minus. So the UI offers
 * a choice ("unlimited" or a number) and this function does the translation
 * in one place, mirroring plan_ovr() on the server.
 *
 * @param {{unlimited?: boolean, value?: string|number}} choice
 * @returns {number|null} -1 for unlimited, an integer, or null for "clear
 *   this override" (which the RPC reads as inherit-from-plan)
 * @throws {Error} on a value that is not a non-negative integer
 */
export function toWireOverride(choice) {
  if (!choice) return null;
  if (choice.unlimited) return -1;

  const raw = choice.value;
  if (raw === '' || raw === null || raw === undefined) return null;

  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error('הערך חייב להיות מספר שלם');
  }
  // Negative input is refused rather than passed through, so a typed "-1"
  // cannot become "unlimited" by accident. Unlimited is a deliberate
  // choice, never a side effect of a minus sign.
  if (n < 0) {
    throw new Error('הערך לא יכול להיות שלילי. לביטול מגבלה יש לבחור „ללא הגבלה”');
  }
  return n;
}

/**
 * Turn a date-input value ("2026-12-31") into the ISO instant the RPC wants.
 *
 * ⚠️ END OF THE CHOSEN DAY, IN LOCAL TIME. `new Date('2026-12-31')` parses
 * as UTC midnight, which in Israel is 02:00 or 03:00 on the 31st: an
 * exception granted "until 31 December" would die at 2am that morning,
 * effectively a day short. Worse, picking TODAY would land in the past and
 * be refused outright by the RPC's expiry_in_the_past check.
 *
 * Appending the time with no Z makes the runtime interpret it in the local
 * zone, which is the zone the admin picked the date in.
 *
 * @param {string} dateStr  yyyy-mm-dd, or empty
 * @returns {string|null}   ISO instant, or null for no date
 */
export function endOfDayIso(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T23:59:59`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Centralised string enums used in DB filters + UI logic.
 *
 * Prior to this module, status values like 'פעיל' / 'הוסר' were inlined
 * across ~15 files. A single typo (extra space, swapped quote, missing
 * geresh) silently broke a filter — the DB returned 0 rows and the page
 * looked empty with no error to debug from.
 *
 * Importing from this module gets the value-checked, autocomplete-able
 * version. Old inline strings still work (they're the same value); this
 * is a defense-in-depth measure for new code and high-traffic call sites.
 */

/**
 * Account membership status. Used on the public.account_members table.
 * The DB historically also accepts the English fallback 'removed' for
 * legacy rows — we filter against both.
 */
export const MEMBER_STATUS = Object.freeze({
  ACTIVE:  'פעיל',
  REMOVED: 'הוסר',
});

/** Legacy English status values that may appear on older rows. */
export const LEGACY_MEMBER_STATUS = Object.freeze({
  REMOVED_EN: 'removed',
});

/**
 * Helper: returns true if a membership row is "live" — i.e. not explicitly
 * removed by either the canonical Hebrew status or the legacy English
 * fallback. Centralises the `m.status !== 'הוסר' && m.status !== 'removed'`
 * pattern. Treats null/undefined status as live (legacy data without an
 * explicit status field shouldn't be retroactively kicked out).
 */
export function isActiveMember(member) {
  if (!member) return false;
  if (!member.status) return true;
  return member.status !== MEMBER_STATUS.REMOVED
      && member.status !== LEGACY_MEMBER_STATUS.REMOVED_EN;
}

/**
 * Invite lifecycle status. Mirrors values used in public.invites.status.
 */
export const INVITE_STATUS = Object.freeze({
  ACTIVE:   'פעיל',
  REVOKED:  'בוטל',
  EXPIRED:  'פג תוקף',
  REDEEMED: 'נוצל',
});

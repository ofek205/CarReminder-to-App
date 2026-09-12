import { describe, it, expect } from 'vitest';
import { valueDir, statusBadge, vehiclesLabel, meteredValue } from './MyPlan';

describe('valueDir', () => {
  it('is ltr only for purely numeric or symbolic values', () => {
    expect(valueDir('12 / 30')).toBe('ltr');
    expect(valueDir('5')).toBe('ltr');
  });

  // ── the bidi rule ───────────────────────────────────────────────────
  //
  // Forcing LTR on a Hebrew phrase that contains a digit puts the numeral
  // on the wrong side of the words. The first version of this tested
  // `value === 'ללא הגבלה'`, which got four of the five real values wrong.

  it('is rtl for a Hebrew phrase that contains a number', () => {
    expect(valueDir('3 בחודש')).toBe('rtl');
    expect(valueDir('עד 2')).toBe('rtl');
    expect(valueDir('1 שאלה להתרשמות')).toBe('rtl');
  });

  it('is rtl for plain Hebrew', () => {
    expect(valueDir('ללא הגבלה')).toBe('rtl');
    expect(valueDir('כלול')).toBe('rtl');
    expect(valueDir('לא כלול')).toBe('rtl');
  });

  it('does not throw on a missing value', () => {
    expect(valueDir(undefined)).toBe('ltr');
    expect(valueDir(null)).toBe('ltr');
  });
});

describe('statusBadge', () => {
  it('labels each status the schema allows', () => {
    // account_subscriptions.status is CHECK-constrained to exactly these.
    expect(statusBadge('active').text).toBe('פעיל');
    expect(statusBadge('grace').text).toBe('תקופת התאמה');
    expect(statusBadge('past_due').text).toBe('תשלום לא עבר');
    expect(statusBadge('canceled').text).toBe('בוטל');
  });

  // ── the guarantee: never claim "active" for something that is not ───
  //
  // A hardcoded green "פעיל" sitting above a cancelled subscription is the
  // screen asserting the opposite of the row it renders. Nothing writes a
  // non-active status yet, which is exactly why this is pinned now.

  it('never reports a non-active status as active', () => {
    for (const s of ['grace', 'past_due', 'canceled']) {
      expect(statusBadge(s).text).not.toBe('פעיל');
    }
  });

  it('shows an unknown status verbatim rather than guessing active', () => {
    // If phase 6 adds a status and forgets this map, the badge must say
    // "we do not know" instead of making a claim.
    expect(statusBadge('trialing').text).toBe('trialing');
    expect(statusBadge('trialing').text).not.toBe('פעיל');
  });

  it('treats a missing row as active on free', () => {
    // Matches account_plan()'s fail-closed default: an account with no
    // subscription row is a live free account, not a broken one.
    expect(statusBadge(undefined).text).toBe('פעיל');
    expect(statusBadge(null).text).toBe('פעיל');
  });

  it('gives every branch a colour pair', () => {
    for (const s of ['active', 'grace', 'past_due', 'canceled', 'weird', undefined]) {
      const b = statusBadge(s);
      expect(b.bg).toBeTruthy();
      expect(b.fg).toBeTruthy();
    }
  });
});

describe('vehiclesLabel', () => {
  it('pairs the live count with the cap when both are known', () => {
    expect(vehiclesLabel(12, 30, true)).toBe('12 / 30');
    expect(vehiclesLabel(0, 5, true)).toBe('0 / 5');   // genuinely zero is fine
  });

  it('says unlimited when there is no cap', () => {
    expect(vehiclesLabel(40, null, true)).toBe('ללא הגבלה');
    expect(vehiclesLabel(40, undefined, true)).toBe('ללא הגבלה');
  });

  // ── the guarantee ───────────────────────────────────────────────────
  //
  // The plan query and the count query fail independently. useVehicleCapacity
  // defaults count to 0, so interpolating it while its query is down renders
  // "0 / 30" for an account that may hold thirty. A real cap beside a
  // fabricated numerator is the exact failure this screen exists to prevent.

  it('shows the cap ALONE when the count is not known', () => {
    expect(vehiclesLabel(0, 30, false)).toBe('עד 30');
    expect(vehiclesLabel(0, 5, false)).toBe('עד 5');
  });

  it('never renders a zero numerator from a failed count', () => {
    expect(vehiclesLabel(0, 30, false)).not.toContain('0 /');
    expect(vehiclesLabel(undefined, 30, true)).not.toContain('/');
    expect(vehiclesLabel(NaN, 30, true)).not.toContain('/');
  });
});

describe('meteredValue', () => {
  const fmt = (u, c) => `${u} / ${c}`;

  it('renders usage when both numbers are known', () => {
    expect(meteredValue(2, 3, fmt, 'fallback')).toBe('2 / 3');
    expect(meteredValue(0, 3, fmt, 'fallback')).toBe('0 / 3'); // a GENUINE zero
  });

  it('falls back for an unlimited cap', () => {
    expect(meteredValue(40, null, fmt, 'ללא הגבלה')).toBe('ללא הגבלה');
    expect(meteredValue(40, undefined, fmt, 'ללא הגבלה')).toBe('ללא הגבלה');
  });

  // ── the branch this function exists for ─────────────────────────────
  //
  // null means the usage read has NOT succeeded. Rendering "0 / 3" there
  // tells someone who spent all three that they have spent none. A genuine
  // zero arrives as the number 0 and is shown; only null falls back.

  it('shows NO figure when usage is not yet known', () => {
    expect(meteredValue(null, 3, fmt, '3 בחודש')).toBe('3 בחודש');
    expect(meteredValue(undefined, 3, fmt, '3 בחודש')).toBe('3 בחודש');
  });

  it('never renders a fabricated zero from an unknown read', () => {
    expect(meteredValue(null, 3, fmt, '3 בחודש')).not.toContain('0 /');
    expect(meteredValue(NaN, 3, fmt, '3 בחודש')).not.toContain('/');
  });

  it('distinguishes a real zero from an unknown one', () => {
    // The whole reason the hook returns 0 for "no row" and null for
    // "no answer".
    expect(meteredValue(0, 3, fmt, 'fb')).not.toBe(meteredValue(null, 3, fmt, 'fb'));
  });
});

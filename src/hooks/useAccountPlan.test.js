import { describe, it, expect, vi, afterEach } from 'vitest';
import { usagePercent, usageLevel, graceDaysLeft } from './useAccountPlan';

describe('usagePercent', () => {
  it('computes a normal ratio', () => {
    expect(usagePercent(4, 5)).toBe(80);
    expect(usagePercent(1, 3)).toBe(33);
    expect(usagePercent(0, 5)).toBe(0);
  });

  it('clamps above the cap instead of exceeding 100', () => {
    // A grandfathered account holds 12 vehicles against a cap of 5. The
    // meter has to stay inside its track.
    expect(usagePercent(12, 5)).toBe(100);
  });

  // ── the guarantees ──────────────────────────────────────────────────
  //
  // Every one of these must yield null, because null is what makes the
  // screen render NO meter. A number here paints a bar that reports an
  // allowance nobody measured.

  it('returns null for an unlimited cap', () => {
    // There is no such thing as "80% of unlimited".
    expect(usagePercent(40, null)).toBeNull();
    expect(usagePercent(40, undefined)).toBeNull();
  });

  it('returns null when the count is unknown', () => {
    // The count comes from a different query than the cap. If that query
    // failed, pairing a real cap with a missing count would render "0 / 5"
    // for someone who might hold thirty.
    expect(usagePercent(undefined, 5)).toBeNull();
    expect(usagePercent(null, 5)).toBeNull();
    expect(usagePercent(NaN, 5)).toBeNull();
  });

  it('returns null for a nonsensical cap rather than dividing by it', () => {
    expect(usagePercent(1, 0)).toBeNull();
    expect(usagePercent(1, -5)).toBeNull();
    expect(usagePercent(1, NaN)).toBeNull();
  });
});

describe('usageLevel', () => {
  it('maps to three named steps, not a gradient', () => {
    expect(usageLevel(0)).toBe('ok');
    expect(usageLevel(79)).toBe('ok');
    expect(usageLevel(80)).toBe('near');   // the conversion moment
    expect(usageLevel(99)).toBe('near');
    expect(usageLevel(100)).toBe('full');
  });

  it('is "none" when there is no percentage', () => {
    // Pairs with usagePercent returning null: no meter, no colour.
    expect(usageLevel(null)).toBe('none');
    expect(usageLevel(undefined)).toBe('none');
  });
});

describe('graceDaysLeft', () => {
  afterEach(() => vi.useRealTimers());

  const at = (iso) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };

  it('is null when there is no grace window', () => {
    expect(graceDaysLeft(null)).toBeNull();
    expect(graceDaysLeft(undefined)).toBeNull();
  });

  it('is null once the window has passed, never 0', () => {
    // "0 ימים" reads as an active grace with nothing left. An expired
    // grace is a different state and must render a different banner.
    at('2026-09-08T12:00:00Z');
    expect(graceDaysLeft('2026-09-07T12:00:00Z')).toBeNull();
    expect(graceDaysLeft('2026-09-08T11:59:59Z')).toBeNull();
  });

  it('rounds UP so a partial last day still counts', () => {
    // Two hours left is "1 day", not "0 days". Telling someone their
    // grace ended while it is still running is the error that matters.
    at('2026-09-08T12:00:00Z');
    expect(graceDaysLeft('2026-09-08T14:00:00Z')).toBe(1);
    expect(graceDaysLeft('2026-09-09T12:00:00Z')).toBe(1);
    expect(graceDaysLeft('2026-09-09T12:00:01Z')).toBe(2);
  });

  it('counts a full 60-day backfill window', () => {
    at('2026-09-08T00:00:00Z');
    expect(graceDaysLeft('2026-11-07T00:00:00Z')).toBe(60);
  });

  it('is null for an unparseable value', () => {
    expect(graceDaysLeft('not a date')).toBeNull();
  });
});

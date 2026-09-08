/**
 * The null-vs-zero rule the whole /MyPlan screen depends on, plus the
 * multi-bucket sum the daily AI ceiling needs.
 *
 * Tested against the exported pure reducers rather than by rendering the
 * hook, matching how MyPlan.jsx's own helpers are tested: the react-query
 * wiring is not what can silently report a wrong allowance.
 */
import { describe, it, expect } from 'vitest';
import { pickUsed, sumUsed, LIFETIME, DAY, MONTH } from './useFeatureUsage';

// The shape my_feature_usage(uuid) returns: one row per (feature, period),
// with the horizon LABELLED by the server.
const ROWS = [
  { feature: 'ai_advisor',  horizon: 'lifetime', period_key: 'lifetime',   used: 1 },
  { feature: 'ai_advisor',  horizon: 'day',      period_key: '2026-09-09', used: 4 },
  { feature: 'ai_forum',    horizon: 'day',      period_key: '2026-09-09', used: 3 },
  { feature: 'plate_check', horizon: 'month',    period_key: '2026-09',    used: 7 },
];

describe('pickUsed', () => {
  it('reads the row for the requested feature and horizon', () => {
    expect(pickUsed(ROWS, 'ai_advisor', LIFETIME)).toBe(1);
    expect(pickUsed(ROWS, 'ai_advisor', DAY)).toBe(4);
    expect(pickUsed(ROWS, 'plate_check', MONTH)).toBe(7);
  });

  it('does not confuse two horizons of the same feature', () => {
    // ai_advisor comes back TWICE in one result. Matching on feature alone
    // would return whichever row happened to be first, so today's usage
    // could be reported as the lifetime total or the reverse.
    expect(pickUsed(ROWS, 'ai_advisor', DAY))
      .not.toBe(pickUsed(ROWS, 'ai_advisor', LIFETIME));
  });

  // ── the distinction that protects the user ──────────────────────────
  //
  // "query succeeded, no row" is a true zero. "query failed" is unknown.
  // Collapsing them shows "0 used" to someone who has used everything,
  // promising an allowance they do not have.

  it('returns 0 for a feature with no row, which is a genuine zero', () => {
    expect(pickUsed(ROWS, 'vehicle_share', DAY)).toBe(0);
    expect(pickUsed([], 'ai_advisor', DAY)).toBe(0);
  });

  it('returns null when the read did not succeed', () => {
    expect(pickUsed(null, 'ai_advisor', DAY)).toBeNull();
    expect(pickUsed(undefined, 'ai_advisor', DAY)).toBeNull();
  });

  it('treats an unusable count as 0 rather than NaN', () => {
    // A NaN would render as "NaN of 50 used".
    const rows = [{ feature: 'ai_advisor', horizon: 'day', used: 'oops' }];
    expect(pickUsed(rows, 'ai_advisor', DAY)).toBe(0);
  });
});

describe('sumUsed', () => {
  it('adds the buckets the daily ceiling is enforced against', () => {
    // 4 advisor + 3 forum. The SQL checks ai_advisor + ai_forum together,
    // so a meter showing only 4 would sit below the cap it is drawn
    // against and refuse the user at apparent room to spare.
    expect(sumUsed(ROWS, ['ai_advisor', 'ai_forum'], DAY)).toBe(7);
  });

  it('counts a missing bucket as zero, not as unknown', () => {
    // ai_forum has no lifetime row here. The sum is still known.
    expect(sumUsed(ROWS, ['ai_advisor', 'ai_forum'], LIFETIME)).toBe(1);
  });

  it('returns null when the read did not succeed', () => {
    expect(sumUsed(null, ['ai_advisor', 'ai_forum'], DAY)).toBeNull();
  });

  it('returns null for an empty feature list, not 0', () => {
    // Summing nothing is not evidence of no usage. Returning 0 here would
    // report a full allowance to a caller that asked the wrong question.
    expect(sumUsed(ROWS, [], DAY)).toBeNull();
    expect(sumUsed(ROWS, null, DAY)).toBeNull();
  });

  it('agrees with pickUsed on a single bucket', () => {
    for (const h of [LIFETIME, DAY, MONTH]) {
      for (const f of ['ai_advisor', 'ai_forum', 'plate_check', 'nope']) {
        expect(sumUsed(ROWS, [f], h), `${f}/${h}`).toBe(pickUsed(ROWS, f, h));
      }
    }
  });
});

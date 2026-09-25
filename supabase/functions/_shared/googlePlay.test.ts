/**
 * The two questions every Play notification is turned into:
 *
 *   entitlementFrom  does this account get the plan RIGHT NOW?
 *   willRenewFrom    will it still have it after the current period?
 *
 * They are separate on purpose, and conflating them is the bug this file
 * pins: a cancelled subscription is entitled until it expires, and it does
 * not renew. Storing only the first answer made /MyPlan tell somebody who
 * had just cancelled that their plan "מתחדש ב...".
 */
import { describe, it, expect } from 'vitest';
import { entitlementFrom, willRenewFrom } from './googlePlay';

const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

const sub = (state: string, expiry: string, autoRenewEnabled?: boolean) => ({
  subscriptionState: `SUBSCRIPTION_STATE_${state}`,
  lineItems: [{
    productId: 'plan_p9',
    expiryTime: expiry,
    ...(autoRenewEnabled === undefined ? {} : { autoRenewingPlan: { autoRenewEnabled } }),
  }],
});

describe('entitlementFrom: the edge cases a downgrade or a cancel goes through', () => {
  it('keeps the plan after a cancel until the paid period ends', () => {
    // ⚠️ Revoking on CANCELED would cut a paying customer off the moment
    // they decide not to renew.
    expect(entitlementFrom(sub('CANCELED', future, false)).entitled).toBe(true);
  });

  it('drops the plan once a cancelled period has actually ended', () => {
    expect(entitlementFrom(sub('CANCELED', past, false)).entitled).toBe(false);
  });

  it('keeps the plan while a failed card is being retried', () => {
    expect(entitlementFrom(sub('IN_GRACE_PERIOD', future, true)).entitled).toBe(true);
  });

  it('drops the plan on hold, paused, expired, and anything unrecognised', () => {
    for (const s of ['ON_HOLD', 'PAUSED', 'EXPIRED', 'SOMETHING_NEW']) {
      expect(entitlementFrom(sub(s, future)).entitled, s).toBe(false);
    }
  });
});

describe('willRenewFrom', () => {
  it('is false for a cancelled subscription, even with paid time left', () => {
    expect(willRenewFrom(sub('CANCELED', future, true))).toBe(false);
    expect(willRenewFrom(sub('CANCELED', future))).toBe(false);
  });

  it('reads Google\'s own flag for a live subscription', () => {
    expect(willRenewFrom(sub('ACTIVE', future, true))).toBe(true);
    expect(willRenewFrom(sub('ACTIVE', future, false))).toBe(false);
    expect(willRenewFrom(sub('IN_GRACE_PERIOD', future, true))).toBe(true);
  });

  it('is null when Google does not say, so nothing is claimed either way', () => {
    expect(willRenewFrom(sub('ACTIVE', future))).toBeNull();
    expect(willRenewFrom({})).toBeNull();
  });

  it('is false once expired', () => {
    expect(willRenewFrom(sub('EXPIRED', past, true))).toBe(false);
  });
});

/**
 * Which flag, which platform, which store page, on every platform.
 *
 * Uses the same getter-backed capacitor mock as backendIdentity.test.js, so
 * the platform can be flipped per test; a plain object mock would freeze the
 * first answer and test one platform four times.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const platform = { isNative: false, isAndroid: false, isIOS: false };
vi.mock('@/lib/capacitor', () => ({
  get isNative() { return platform.isNative; },
  get isAndroid() { return platform.isAndroid; },
  get isIOS() { return platform.isIOS; },
}));

vi.mock('@capgo/native-purchases', () => ({
  NativePurchases: {},
  PURCHASE_TYPE: { SUBS: 'subs', INAPP: 'inapp' },
}));

const { billingFlagKey, billingPlatform, canOpenStoreSubscriptionManagement, getBillingBackend } =
  await import('./index');

const asAndroid = () => Object.assign(platform, { isNative: true, isAndroid: true, isIOS: false });
const asIOS     = () => Object.assign(platform, { isNative: true, isAndroid: false, isIOS: true });
const asWeb     = () => Object.assign(platform, { isNative: false, isAndroid: false, isIOS: false });
const asOther   = () => Object.assign(platform, { isNative: true, isAndroid: false, isIOS: false });

beforeEach(asWeb);

describe('billingFlagKey', () => {
  it('gives iOS its own flag, so switching Play on cannot switch Apple on', () => {
    asIOS();
    expect(billingFlagKey()).toBe('apple_billing_enabled');
  });

  it('keeps Android and the browser on the flag they already read', () => {
    asAndroid();
    expect(billingFlagKey()).toBe('play_billing_enabled');
    asWeb();
    expect(billingFlagKey()).toBe('play_billing_enabled');
  });
});

describe('billingPlatform', () => {
  it('names each platform, and never calls an unknown native one a browser', () => {
    asAndroid(); expect(billingPlatform()).toBe('android');
    asIOS();     expect(billingPlatform()).toBe('ios');
    asWeb();     expect(billingPlatform()).toBe('web');
    asOther();   expect(billingPlatform()).toBe('other');
  });
});

describe('canOpenStoreSubscriptionManagement', () => {
  it('is true on both phones and false elsewhere', () => {
    asAndroid(); expect(canOpenStoreSubscriptionManagement()).toBe(true);
    asIOS();     expect(canOpenStoreSubscriptionManagement()).toBe(true);
    asWeb();     expect(canOpenStoreSubscriptionManagement()).toBe(false);
    asOther();   expect(canOpenStoreSubscriptionManagement()).toBe(false);
  });
});

describe('the Apple backend is wired on iOS only', () => {
  it('returns the Apple backend on iOS and nothing Apple anywhere else', () => {
    asIOS();
    expect(getBillingBackend()?.store).toBe('apple');
    asAndroid();
    expect(getBillingBackend()?.store).toBeUndefined();
    asOther();
    expect(getBillingBackend()).toBeNull();
  });
});

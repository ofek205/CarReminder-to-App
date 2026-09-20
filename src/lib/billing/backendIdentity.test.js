/**
 * ONE INVARIANT, AND IT COST A NIGHT OF A REAL DEVICE SPINNING.
 *
 * getBillingBackend() is read into a React dependency array. On Android it
 * used to call a factory and hand back a NEW object every time, so the deps
 * changed on every render, the catalogue effect re-ran, it set
 * LOADING_PRODUCTS, and that re-render produced another new object:
 *
 *   catalogue resolves -> setState -> re-render -> new backend object
 *     -> deps changed -> effect re-runs -> setState(LOADING_PRODUCTS) -> ...
 *
 * /Plans never left the spinner and re-queried Play all night. The catalogue
 * timeout added the day before does not rescue it, because the timeout's own
 * state write restarts the same cycle; a twelve-second flip-flop simply reads
 * as a permanent spinner.
 *
 * ⚠️ AND THE REASON THIS FILE EXISTS RATHER THAN A CASE IN billing.test.js.
 * That file mocks the platform as a browser, where the two branches return a
 * module-level object and null, both referentially stable. The bug is
 * unreachable anywhere except Android, which is exactly why no preview run
 * and no existing test saw it. Proving it needs a platform this suite can
 * flip, so the mock below uses getters and ESM live-binding, the same
 * technique billingGate.test.js documents.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const platform = { isNative: false, isAndroid: false, isIOS: false };
vi.mock('@/lib/capacitor', () => ({
  get isNative() { return platform.isNative; },
  get isAndroid() { return platform.isAndroid; },
  get isIOS() { return platform.isIOS; },
}));

// The plugin is never called here; it only has to import.
vi.mock('@capgo/native-purchases', () => ({
  NativePurchases: {},
  PURCHASE_TYPE: { SUBS: 'subs', INAPP: 'inapp' },
}));

const { getBillingBackend } = await import('./index');

const asAndroid = () => Object.assign(platform, { isNative: true, isAndroid: true, isIOS: false });
const asIOS     = () => Object.assign(platform, { isNative: true, isAndroid: false, isIOS: true });
const asWeb     = () => Object.assign(platform, { isNative: false, isAndroid: false, isIOS: false });

beforeEach(asWeb);

describe('getBillingBackend identity', () => {
  it('returns the SAME object every call on Android', () => {
    asAndroid();
    const a = getBillingBackend();
    const b = getBillingBackend();
    expect(a).not.toBeNull();
    // toBe, not toEqual. Deep equality was always true and is exactly what
    // made the bug invisible to reasoning: the objects were identical in
    // every way except the one React compares on.
    expect(a).toBe(b);
  });

  it('stays stable across many calls, which is what the dep array sees', () => {
    asAndroid();
    const first = getBillingBackend();
    const all = Array.from({ length: 25 }, () => getBillingBackend());
    expect(new Set(all).size).toBe(1);
    expect(all[24]).toBe(first);
  });

  it('is stable on the browser branch too', () => {
    // mockBackend is a module-level object, so this always held. Asserted so
    // that a future refactor to a factory cannot reintroduce the loop on the
    // one platform the preview can actually run.
    expect(getBillingBackend()).toBe(getBillingBackend());
  });

  it('gives iOS a stable null rather than a backend', () => {
    asIOS();
    expect(getBillingBackend()).toBeNull();
  });

  it('keeps the Play backend distinct from the browser one', () => {
    // Guards against a singleton that is shared across platforms, which
    // would hand the mock to a device or the plugin to a browser.
    asAndroid();
    const play = getBillingBackend();
    asWeb();
    expect(getBillingBackend()).not.toBe(play);
  });

  it('exposes the whole backend contract from the memoised object', () => {
    // A singleton built once must not be a partial object: if the factory is
    // ever changed to build lazily per method, this fails rather than
    // surfacing as a TypeError on a device mid-purchase.
    asAndroid();
    const b = getBillingBackend();
    for (const m of ['connect', 'listProducts', 'purchase', 'queryOwnedPurchases', 'acknowledge']) {
      expect(typeof b[m], m).toBe('function');
    }
  });
});

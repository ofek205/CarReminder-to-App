import { describe, it, expect, vi, beforeEach } from 'vitest';

// ⚠️ NO vi.resetModules() HERE, AND THAT IS THE POINT.
//
// The first version of this file re-imported billingGate per case with
// vi.resetModules(). It passed alone and FAILED in the full suite, because
// resetModules clears the whole worker's module registry rather than just
// this file's, so it disturbed modules other test files had already
// imported. Classic self-inflicted test pollution: green in isolation,
// red together, and the blame lands on whichever file happens to run next.
//
// It is also unnecessary. The mock below exposes getters, and ESM
// live-binds imported names, so billingSurface() reads the CURRENT value on
// every call. Mutating `platform` is enough.
const platform = { isNative: false, isIOS: false, isAndroid: false, isWeb: true };
vi.mock('@/lib/capacitor', () => ({
  get isNative() { return platform.isNative; },
  get isIOS() { return platform.isIOS; },
  get isAndroid() { return platform.isAndroid; },
  get isWeb() { return platform.isWeb; },
}));

const {
  billingSurface, canReferToWeb, canMentionExternalPurchase, capWallAction,
} = await import('./billingGate');

const asWeb = () => Object.assign(platform, { isNative: false, isIOS: false, isAndroid: false, isWeb: true });
const asIOS = () => Object.assign(platform, { isNative: true, isIOS: true, isAndroid: false, isWeb: false });
const asAndroid = () => Object.assign(platform, { isNative: true, isIOS: false, isAndroid: true, isWeb: false });
// A native platform that is neither iOS nor Android, to prove the
// fall-through cannot hand a checkout to an unrecognised store.
const asUnknownNative = () => Object.assign(platform, { isNative: true, isIOS: false, isAndroid: false, isWeb: false });

// Restore the default after every case so no test depends on order.
beforeEach(asWeb);

describe('billingSurface', () => {
  it('is web in a browser', () => {
    expect(billingSurface()).toBe('web');
  });

  it('is iap on iOS native', () => {
    asIOS();
    expect(billingSurface()).toBe('iap');
  });

  it('is none on Android native', () => {
    asAndroid();
    expect(billingSurface()).toBe('none');
  });

  it('never treats an unrecognised native platform as a browser', () => {
    // The ORDER of the checks is the guarantee: falling through to 'web'
    // would hand a checkout link to a store whose rules are unknown.
    asUnknownNative();
    expect(billingSurface()).toBe('none');
  });
});

describe('canReferToWeb', () => {
  it('is false on iOS, and that includes plain text', () => {
    // 3.1.1(a) covers "buttons, external links, or other calls to action",
    // and reviewers have rejected apps for a bare URL in body copy.
    asIOS();
    expect(canReferToWeb()).toBe(false);
  });

  it('is false on Android too, which may mention but not link', () => {
    asAndroid();
    expect(canReferToWeb()).toBe(false);
    expect(canMentionExternalPurchase()).toBe(true);
  });

  it('is true in a browser', () => {
    expect(canReferToWeb()).toBe(true);
  });
});

describe('capWallAction', () => {
  // ── the anti-steering guarantee, per platform ──────────────────────
  //
  // A plan-cap wall on iOS must carry no button, no link, no price and no
  // mention of buying elsewhere. Getting this wrong is the class of
  // mistake that gets an app pulled, not a cosmetic bug.

  it('offers NOTHING about plans on iOS', () => {
    asIOS();
    const a = capWallAction('plan');
    expect(a.cta).toBeNull();
    expect(a.mayMentionPlans).toBe(false);
  });

  it('lets Android mention a paid plan without linking to it', () => {
    asAndroid();
    const a = capWallAction('plan');
    expect(a.cta).toBeNull();          // no link
    expect(a.mayMentionPlans).toBe(true);
  });

  it('gives the browser a real route to the plan screen', () => {
    const a = capWallAction('plan');
    expect(a.cta).toBe('plan');
    expect(a.mayMentionPlans).toBe(true);
  });

  it('routes the personal cap to the business request on every platform', () => {
    // CreateBusinessWorkspace is an in-app admin-approval request, not a
    // purchase, so no store rule touches it.
    for (const set of [asWeb, asIOS, asAndroid]) {
      set();
      const a = capWallAction('personal');
      expect(a.cta).toBe('business');
      expect(a.mayMentionPlans).toBe(false);
    }
  });

  it('treats an unknown kind as a plan cap, so iOS still says nothing', () => {
    // Fail-closed on the store rule: an unrecognised cap must not default
    // to something that could be steering.
    asIOS();
    const a = capWallAction(null);
    expect(a.cta).toBeNull();
    expect(a.mayMentionPlans).toBe(false);
  });
});

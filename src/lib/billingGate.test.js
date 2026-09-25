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
  mayMentionPaidPlans, planEntryPage,
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

  // ⚠️ THIS CASE USED TO ASSERT 'none', AND THE ASSERTION OUTLIVED THE FACT.
  //
  // 'none' encoded Play's consumption-only exemption, which only covers an
  // app that sells nothing in-app. The app stopped qualifying the moment the
  // Billing library shipped inside the binary and three subscriptions went
  // live in the console. Play forbids the hybrid outright.
  it('is iap on Android native, because the app now ships Play Billing', () => {
    asAndroid();
    expect(billingSurface()).toBe('iap');
  });

  it('does not let the feature flag change the surface', () => {
    // The exemption is lost by SHIPPING the Billing library, not by
    // switching a flag on. billingSurface must therefore be flag-free, so
    // that turning play_billing_enabled off can never resurrect the
    // "המנוי מנוהל באתר" branch inside a build that carries Play Billing.
    asAndroid();
    expect(billingSurface()).toBe('iap');
    expect(billingSurface.length).toBe(0);
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

  it('is false on Android, and so is every reference to an outside purchase', () => {
    // ⚠️ canMentionExternalPurchase USED TO BE TRUE HERE. That was the
    // consumption-only middle ground, and shipping Play Billing ended it:
    // Play Billing present AND an external purchase referred to is the
    // hybrid Play forbids.
    asAndroid();
    expect(canReferToWeb()).toBe(false);
    expect(canMentionExternalPurchase()).toBe(false);
  });

  it('is true in a browser', () => {
    expect(canReferToWeb()).toBe(true);
  });
});

describe('mayMentionPaidPlans', () => {
  // The question canMentionExternalPurchase can no longer answer: naming our
  // own paid plan is not the same act as pointing at a purchase elsewhere,
  // and Android may now do the first while being forbidden the second.
  it('lets Android name a paid plan', () => {
    asAndroid();
    expect(mayMentionPaidPlans()).toBe(true);
    expect(canMentionExternalPurchase()).toBe(false);
  });

  it('still forbids it on iOS, where 3.1.1(a) covers prose', () => {
    asIOS();
    expect(mayMentionPaidPlans()).toBe(false);
  });

  it('allows it in a browser', () => {
    expect(mayMentionPaidPlans()).toBe(true);
  });

  it('refuses it on an unrecognised native platform', () => {
    asUnknownNative();
    expect(mayMentionPaidPlans()).toBe(false);
  });
});

describe('planEntryPage', () => {
  it('opens the plans directly on Android and in a browser', () => {
    // Ofek, 2026-09-25: one tap to the plans, not a detour through /MyPlan.
    asAndroid();
    expect(planEntryPage()).toBe('Plans');
    asWeb();
    expect(planEntryPage()).toBe('Plans');
  });

  it('keeps /MyPlan as the plan screen on iOS, where paid plans may not be named', () => {
    // ⚠️ /Plans lists paid plans by name. On iOS before StoreKit that is a
    // plan nothing in the app can buy, which 3.1.1 treats as steering.
    asIOS();
    expect(planEntryPage()).toBe('MyPlan');
    asUnknownNative();
    expect(planEntryPage()).toBe('MyPlan');
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

  it('lets Android name a paid plan, and offers no button until a sheet exists', () => {
    // ⚠️ THE REGRESSION THIS CASE GUARDS. Android is now an 'iap' surface,
    // and the IAP branch was written for iOS, where there is genuinely
    // nothing to press. Without the isAndroid split, flipping the surface
    // would have silently deleted "במסלול בתשלום…" from four cap walls that
    // were never in breach of anything.
    asAndroid();
    const a = capWallAction('plan');
    expect(a.cta).toBeNull();          // flag off: nothing to press
    expect(a.mayMentionPlans).toBe(true);
  });

  it('gives Android a real CTA once iapReady says a sheet can open', () => {
    // The distinction billingSurface does not make: 'iap' says which store
    // governs, iapReady says whether its sheet can actually open. They were
    // identical everywhere until Play Billing shipped.
    asAndroid();
    const a = capWallAction('plan', { iapReady: true });
    expect(a.cta).toBe('plan');
    expect(a.mayMentionPlans).toBe(true);
  });

  it('never gives iOS a CTA, even if a caller claims iapReady', () => {
    // Fail-closed: iOS has no StoreKit implementation, so a true here would
    // be a caller bug. It must not become a 3.1.1(a) breach.
    asIOS();
    const a = capWallAction('plan', { iapReady: true });
    expect(a.cta).toBeNull();
    expect(a.mayMentionPlans).toBe(false);
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

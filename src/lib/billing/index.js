/**
 * The one place a screen asks for a billing backend.
 *
 * Selection is by PLATFORM, never by build mode. `import.meta.env.DEV` would
 * hand the mock to a production web build (harmless but wrong) and, far worse,
 * hand the real plugin to a dev native build where it cannot connect, which
 * looks exactly like a broken integration.
 *
 * @see docs/ux-play-billing-purchase.md
 */

import { isAndroid, isNative } from '@/lib/capacitor';
import { mockBackend } from './mockBackend';

export { PurchaseOutcome } from './types';

/**
 * ⚠️ PLACEHOLDER, AND DELIBERATELY NOT A SILENT ONE.
 *
 * The Play plugin is not installed: package.json carries no purchase
 * dependency, and adding one needs `npx cap sync` plus a native build, both
 * of which are Ofek's under חוק 0. Until then Android native has no backend.
 *
 * Returning the mock here instead would be the dangerous shortcut: the app
 * would appear to sell subscriptions on a real device and take no money.
 * Returning null makes `iapReady()` false, which keeps every purchase control
 * hidden, which is the honest state.
 */
function playBackend() {
  return null;
}

/**
 * @returns {import('./types').BillingBackend|null}
 */
export function getBillingBackend() {
  if (isNative && isAndroid) return playBackend();
  // Browser, including the preview. The mock is what makes the ten states
  // designable without a build.
  if (!isNative) return mockBackend;
  return null;
}

/**
 * Is there a purchase sheet that can actually open right now?
 *
 * ⚠️ THIS IS THE DISTINCTION billingSurface() DOES NOT MAKE, and the reason
 * flipping Android to IAP was never a one-line change. billingSurface()
 * answers "which store governs this platform". It does NOT answer "is there
 * something to press", and until a store is implemented those two questions
 * had identical answers everywhere, which is how they came to be conflated.
 *
 * capWallAction() returns no CTA for IAP because that branch was written for
 * iOS, where there is genuinely no sheet. Reusing it for Android after Play
 * Billing ships would strip the call to action from the cap wall at the exact
 * moment we finally have something to sell.
 *
 * Callers must pass the resolved `play_billing_enabled` flag. This module does
 * not read it, so it stays synchronous and free of a data dependency; the flag
 * arrives from useFeatureFlag where the screen already has it.
 *
 * @param {boolean} flagEnabled
 * @returns {boolean}
 */
export function iapReady(flagEnabled) {
  if (flagEnabled !== true) return false;
  return getBillingBackend() !== null;
}

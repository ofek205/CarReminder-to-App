/**
 * Hand a completed purchase to the server that asks the right store about it.
 *
 * ⚠️ ROUTED BY THE BACKEND'S STORE, NOT BY GUESSING FROM THE TOKEN. /Plans
 * used to invoke 'verify-play-purchase' by name. On an iPhone that would post
 * a StoreKit transaction id to a function that asks Google about it, get
 * "not found", and leave a charged user in PENDING for ever.
 *
 * ⚠️ THE FIELD IS NAMED FOR WHAT IT IS. The shared purchase result calls its
 * token `purchaseToken`; for Apple that value is a StoreKit transaction id,
 * and verify-apple-purchase reads `transactionId`. Mapping it here, once,
 * is what keeps the two meanings from meeting inside a screen.
 *
 * ⚠️ IT RETURNS `data.granted`, NOT "the call succeeded". Both functions
 * answer HTTP 200 with `granted:false` for every refusal, deliberately. Any
 * failure here resolves to PENDING, never FAILED: by the time this runs the
 * card is charged. See purchaseMachine.afterVerification.
 */

import { supabase } from '@/lib/supabase';

/**
 * Which function, with which body. Pure, so both routes are tested without
 * a network.
 *
 * @param {'apple'|undefined} store  the backend's `store`; Play's predates it
 */
export function verifyRequest(store, { purchaseToken, productId, accountId }) {
  if (store === 'apple') {
    return {
      fn: 'verify-apple-purchase',
      body: { transactionId: purchaseToken, productId, accountId },
    };
  }
  return {
    fn: 'verify-play-purchase',
    body: { purchaseToken, productId, accountId },
  };
}

/**
 * Server refusals that mean "this purchase belongs to another account",
 * not "your payment is late". Apple's from verify-apple-purchase, Play's
 * account_mismatch from verify-play-purchase.
 */
const NOT_YOURS = new Set([
  'held_by_other_account', 'account_token_mismatch', 'no_account_token', 'account_mismatch',
]);

/**
 * `true`, `false` (not yet: renders PENDING), or `'not_yours'`.
 *
 * ⚠️ 'not_yours' EXISTS SO A REFUSAL CAN BE SILENT. Every other refusal
 * renders PENDING, whose copy says the payment arrived and activation is
 * late. For a purchase that belongs to a different account of ours, that
 * sentence is false and invites paying again, so the screen returns to idle.
 */
export function verificationResult(data, error) {
  if (error) return false;
  if (data?.granted === true) return true;
  return NOT_YOURS.has(data?.reason) ? 'not_yours' : false;
}

function makeStoreVerifier(store) {
  return async function verifyStorePurchase(args) {
    const { fn, body } = verifyRequest(store, args);
    const { data, error } = await supabase.functions.invoke(fn, { body });
    return verificationResult(data, error);
  };
}

// ⚠️ BUILT ONCE, AT MODULE LEVEL. The verifier lands in usePurchaseFlow's
// callback dependencies; a new function per render would rebuild every
// callback downstream of it, the same family of identity bug that left
// /Plans spinning all night (backendIdentity.test.js).
const VERIFIERS = Object.freeze({
  apple: makeStoreVerifier('apple'),
  play: makeStoreVerifier(undefined),
});

/**
 * The stable verifier for a backend.
 *
 * @param {'apple'|undefined} store  the backend's `store`
 * @returns {(args: {purchaseToken: string, productId: string, accountId: string}) => Promise<boolean>}
 */
export function verifierFor(store) {
  return store === 'apple' ? VERIFIERS.apple : VERIFIERS.play;
}

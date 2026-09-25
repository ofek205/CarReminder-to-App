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

function makeStoreVerifier(store) {
  return async function verifyStorePurchase(args) {
    const { fn, body } = verifyRequest(store, args);
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) return false;
    return data?.granted === true;
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

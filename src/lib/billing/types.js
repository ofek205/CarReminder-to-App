/**
 * The contract every billing backend implements.
 *
 * WHY AN ADAPTER AND NOT DIRECT PLUGIN CALLS
 *   Play Billing only works inside a signed build sitting on a Play track.
 *   A debug APK cannot open the sheet, and a browser certainly cannot. If the
 *   screens called the plugin directly, every change to a button would cost a
 *   full native build to look at.
 *
 *   With one seam, the mock backend runs in the browser preview, which is
 *   where the ten states from docs/ux-play-billing-purchase.md §5 actually get
 *   designed and verified. The Play backend then has to satisfy the same
 *   contract, and swapping it changes one file.
 *
 * @see docs/ux-play-billing-purchase.md
 * @see docs/spec-monetization-play-billing.md
 */

/**
 * Why a purchase ended. The UI branches on this and NOT on an error string,
 * because two of these are not failures at all.
 *
 * ⚠️ `cancelled` IS NOT AN ERROR. Closing the Play sheet is a legitimate act,
 * and a "purchase failed" toast tells the user they did something wrong. UX
 * §5 state 8 is deliberate silence.
 *
 * ⚠️ `pending` IS NOT A SUCCESS AND NOT A FAILURE. Play supports slow payment
 * methods that settle later. Granting on `pending` hands out a plan nobody
 * paid for; treating it as failure tells a user who WILL pay that they did
 * not. It needs its own copy.
 *
 * ⚠️ `owned` means this Google account already holds the subscription, which
 * is what a reinstall looks like. Sending that user back to a purchase sheet
 * is how someone ends up paying twice.
 */
export const PurchaseOutcome = Object.freeze({
  PURCHASED: 'purchased',
  CANCELLED: 'cancelled',
  PENDING: 'pending',
  OWNED: 'owned',
  FAILED: 'failed',
  UNAVAILABLE: 'unavailable',
});

/**
 * @typedef {Object} BillingProduct
 * @property {string} productId      Play's id, e.g. 'plan_p9'
 * @property {string} planCode       ours, e.g. 'p9'
 * @property {string} priceFormatted Play's localised string, e.g. '₪9.00'
 *   ⚠️ ALWAYS THE STORE'S STRING, never a number we format. The store knows
 *   the currency, the tax treatment and the user's locale; plan_limits does
 *   not, and a mismatch between the displayed price and the charged one is a
 *   removable offence under Play's policy, not a cosmetic bug.
 * @property {string} [priceCurrency]
 */

/**
 * @typedef {Object} PurchaseResult
 * @property {string} outcome         one of PurchaseOutcome
 * @property {string} [purchaseToken] present on PURCHASED and OWNED. The only
 *   value the server may trust, and only after it has verified it with Google.
 * @property {string} [productId]
 * @property {string} [message]       diagnostic, never shown raw to a user
 */

/**
 * @typedef {Object} BillingBackend
 * @property {() => Promise<boolean>}                connect
 * @property {() => Promise<BillingProduct[]>}       listProducts
 * @property {(productId: string, accountId: string) => Promise<PurchaseResult>} purchase
 * @property {() => Promise<PurchaseResult[]>}       queryOwnedPurchases
 * @property {(token: string) => Promise<boolean>}   acknowledge
 */

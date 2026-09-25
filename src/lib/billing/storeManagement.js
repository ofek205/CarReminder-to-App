/**
 * Where does this subscription live, and what may this device say about it?
 *
 * ⚠️ PURE ON PURPOSE. /MyPlan used to decide this inline with
 * `source === 'iap_google'` and an Android check, which was right while only
 * one store existed. With two, there are six combinations of store and
 * platform, and three of them are wrong in a way nobody would see in a
 * browser preview. So the whole decision lives here, takes the platform as
 * an argument, and storeManagement.test.js walks every combination.
 *
 * ⚠️ AN iOS APP MAY NOT NAME GOOGLE OR ANDROID (Guideline 2.3.10: no other
 * mobile platforms in the app). The old /MyPlan copy did exactly that for a
 * Google subscriber opening the iPhone app: "המנוי מנוהל דרך Google Play"
 * and "במכשיר האנדרואיד". Nobody could reach it yet, since no Play purchase
 * can exist while the flag is off, but it was one sale away from a review
 * rejection. The cross-store case now uses one neutral pair in both
 * directions.
 */

export const STORE = Object.freeze({ GOOGLE: 'google', APPLE: 'apple' });

/** account_subscriptions.source -> the store that holds it, or null. */
export function storeOfSource(source) {
  if (source === 'iap_google') return STORE.GOOGLE;
  if (source === 'iap_apple') return STORE.APPLE;
  return null;
}

/**
 * @param {'android'|'ios'|'web'} platform
 * @returns {'google'|'apple'|null} the store whose page this device can open
 */
export function nativeStoreOf(platform) {
  if (platform === 'android') return STORE.GOOGLE;
  if (platform === 'ios') return STORE.APPLE;
  return null;
}

/**
 * The management row for one subscription on one platform.
 *
 * `canOpenHere` is true only when the store that holds the subscription is
 * the store this device has. Opening Apple's page for a Google subscription
 * would show a list the plan is not in, which reads as "my subscription
 * vanished".
 *
 * @param {string|null|undefined} source  account_subscriptions.source
 * @param {'android'|'ios'|'web'|'other'} platform  see billingPlatform()
 * @returns {null | { store: string, canOpenHere: boolean, title: string, detail: string }}
 *   null when no store holds this plan (free, admin grant, grandfather):
 *   there is nothing to manage and the row must not render.
 */
export function managementCopy(source, platform) {
  const store = storeOfSource(source);
  if (!store) return null;

  const native = nativeStoreOf(platform);
  const canOpenHere = native === store;

  if (canOpenHere && store === STORE.GOOGLE) {
    return {
      store, canOpenHere,
      title: 'ניהול המנוי ב-Google Play',
      detail: 'שם אפשר לבטל, לשנות אמצעי תשלום או לעבור למסלול אחר. ביטול נשאר בתוקף עד סוף התקופה ששולמה.',
    };
  }
  if (canOpenHere && store === STORE.APPLE) {
    return {
      store, canOpenHere,
      title: 'ניהול המנוי ב-App Store',
      // ⚠️ NO "לשנות אמצעי תשלום" HERE. Apple's subscriptions page cancels
      // and switches plans; the payment method lives in the Apple ID
      // settings. Promising it on that page sends people looking for a
      // control that is not there.
      detail: 'שם אפשר לבטל או לעבור למסלול אחר. ביטול נשאר בתוקף עד סוף התקופה ששולמה.',
    };
  }

  // The other phone. Neutral in both directions, because the iOS half may
  // not name Google or Android at all. An unrecognised native platform lands
  // here too: a store whose rules we do not know gets the quiet answer, the
  // same choice billingGate makes.
  if (platform !== 'web') {
    return {
      store, canOpenHere,
      title: 'המנוי מנוהל בחנות שבה נרכש',
      detail: 'ביטול ושינוי המסלול נעשים במכשיר שבו נרכש המנוי.',
    };
  }

  // A browser, where no store rule applies and naming the store is simply
  // the most useful thing to say.
  if (store === STORE.GOOGLE) {
    return {
      store, canOpenHere,
      title: 'המנוי מנוהל דרך Google Play',
      detail: 'ביטול ושינוי אמצעי תשלום נעשים באפליקציה במכשיר האנדרואיד שבו נרכש המנוי.',
    };
  }
  return {
    store, canOpenHere,
    title: 'המנוי מנוהל דרך App Store',
    detail: 'ביטול ומעבר למסלול אחר נעשים באייפון, בהגדרות חשבון אפל שדרכו נרכש המנוי.',
  };
}

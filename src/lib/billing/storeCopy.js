/**
 * Every sentence the purchase surfaces say about a STORE, per store.
 *
 * ⚠️ ONE MODULE, BECAUSE THE ALTERNATIVE IS NINE TERNARIES IN TWO FILES.
 * /Plans and PurchaseAction were written when Google was the only store, and
 * "Google Play" is typed into nine of their strings. An iPhone must not show
 * any of them: they name the wrong store, and Guideline 2.3.10 forbids naming
 * another mobile platform inside an iOS app at all. So the strings live here,
 * keyed by store, and the screens ask for a sentence rather than choosing one.
 *
 * ⚠️ THE GOOGLE STRINGS ARE BYTE-IDENTICAL TO WHAT SHIPPED, and
 * storeCopy.test.js pins them. Android must not change because iOS arrived.
 *
 * ⚠️ THE TWO STORES DO NOT OFFER THE SAME THINGS, AND THE COPY SAYS SO.
 *   Play's subscription centre cancels and changes the payment method; it
 *   cannot switch between products. Apple's subscriptions page switches
 *   between plans in the same group (an upgrade starts at once, a cheaper
 *   plan at the next renewal), while the payment method lives in the Apple
 *   ID settings. A sentence that promises the other store's feature sends
 *   somebody hunting for a control that does not exist.
 */

import { STORE } from './storeManagement';

export { STORE };

const GOOGLE = {
  name: 'Google Play',
  catalogueFailed: 'לא הצלחנו לטעון את המסלולים מ-Google Play. אפשר לנסות שוב בעוד רגע, וכל מה שיש לך בחשבון ממשיך לעבוד כרגיל.',
  sheetOpen: 'ממתין ל-Google Play',
  owned: 'כבר יש לך מנוי פעיל בחשבון Google הזה. נשחזר אותו לחשבון שלך באפליקציה, בלי חיוב נוסף.',
  failed: 'התשלום לא הושלם ולא חויבת. אפשר לנסות שוב או לבחור אמצעי תשלום אחר ב-Google Play.',
  renewal: 'החיוב מתחדש אוטומטית. ניתן לבטל בכל עת דרך Google Play.',
  // Play's own pending purchases are slow payment methods, not a parent.
  // Unreachable today: the Play backend never returns PENDING.
  deferred: 'התשלום עוד לא הושלם, ועדיין לא חויבת. כשהתשלום יושלם המסלול יופעל, ואפשר ללחוץ על בדוק שוב.',
  manageButton: 'ניהול המנוי ב-Google Play',
  currentNote: 'זה המסלול שלך. ביטול ושינוי אמצעי תשלום נעשים ב-Google Play.',
  toFreeNote: 'כדי לחזור לחינם מבטלים את המנוי ב-Google Play. המסלול הנוכחי נשאר פעיל עד סוף התקופה ששולמה.',
  toPaidNote: 'עדיין אי אפשר לעבור מסלול מתוך האפליקציה. מבטלים ב-Google Play, ובסוף התקופה ששולמה בוחרים כאן את המסלול החדש.',
};

const APPLE = {
  name: 'App Store',
  catalogueFailed: 'לא הצלחנו לטעון את המסלולים מ-App Store. אפשר לנסות שוב בעוד רגע, וכל מה שיש לך בחשבון ממשיך לעבוד כרגיל.',
  sheetOpen: 'ממתין ל-App Store',
  owned: 'כבר יש לך מנוי פעיל בחשבון Apple הזה. נשחזר אותו לחשבון שלך באפליקציה, בלי חיוב נוסף.',
  failed: 'התשלום לא הושלם ולא חויבת. אפשר לנסות שוב, או לעדכן אמצעי תשלום בהגדרות חשבון Apple.',
  // ⚠️ THE 24 HOURS IS APPLE'S RULE, not a courtesy: auto-renew has to be
  // off at least a day before the period ends, or the next month is charged.
  // Leaving it out is how a user who cancelled "in time" still gets billed.
  renewal: 'החיוב מתחדש אוטומטית כל חודש. ניתן לבטל בכל עת בהגדרות חשבון Apple. ביטול עד 24 שעות לפני החידוש מונע את החיוב הבא.',
  // Ask to Buy: a parent approves in Family Sharing. Nothing is charged
  // until then, and Apple notifies our server when it happens.
  deferred: 'הרכישה ממתינה לאישור, למשל של הורה, ועדיין לא חויבת. אחרי האישור המסלול יופעל, ואפשר ללחוץ על בדוק שוב.',
  manageButton: 'ניהול המנוי ב-App Store',
  currentNote: 'זה המסלול שלך. ביטול ומעבר מסלול נעשים ב-App Store.',
  toFreeNote: 'כדי לחזור לחינם מבטלים את המנוי ב-App Store. המסלול הנוכחי נשאר פעיל עד סוף התקופה ששולמה.',
  toPaidNote: 'מעבר למסלול הזה נעשה בניהול המנויים ב-App Store. שדרוג מתחיל מיד, ומעבר למסלול זול יותר מתחיל בחידוש הבא.',
};

/**
 * The phone holds a subscription bought in the OTHER store. Neutral on
 * purpose: on an iPhone these sentences may not name Google or Android.
 */
export const ELSEWHERE = Object.freeze({
  currentNote: 'זה המסלול שלך. המנוי נרכש בחנות אחרת, וביטולו נעשה במכשיר שבו נרכש.',
  otherNote: 'המנוי שלך נרכש בחנות אחרת, ולכן אי אפשר לעבור מסלול מכאן. ביטול נעשה במכשיר שבו נרכש.',
});

/**
 * @param {'google'|'apple'|null|undefined} store  anything else is Google,
 *   which is what every caller meant before this module existed
 */
export function storeCopy(store) {
  return store === STORE.APPLE ? APPLE : GOOGLE;
}

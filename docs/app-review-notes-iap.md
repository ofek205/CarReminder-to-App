# הערות לבודק של אפל

נכתב 2026-09-25, עודכן 2026-09-26: השורה בהגדרות פותחת עכשיו את מסך המסלולים ישירות, לחיצה אחת פחות. הטקסט לבודק באנגלית, כי זו השפה שהבודקים קוראים. ההוראות אליך בעברית.

## לפני שמדביקים: שלושה תנאים

| # | מה | למה |
|---|---|---|
| 1 | שני דגלים דלוקים בזמן הבדיקה | בלי הראשון אין שורה של המסלול בהגדרות. בלי השני השורה פותחת את מסך המסלול הנוכחי, בלי רשימת המסלולים ובלי כפתור קנייה |
| 2 | חשבון הדגמה אישי, לא עסקי, במסלול החינמי | ההערות מתארות את הדרך בחשבון אישי. בחשבון עסקי השורה נמצאת בקבוצה אחרת במסך ההגדרות, ובמסלול בתשלום אין מה לקנות |
| 3 | גרסה שנבנתה אחרי 25 בספטמבר | הקנייה דרך אפל, כפתור שחזור הרכישות והדרך הקצרה למסך המסלולים נכנסו לקוד ב-25 בספטמבר אחר הצהריים. גרסה שנבנתה לפני כן לא מכילה אותם, ובלי כפתור שחזור אפל פוסלת בדרך כלל את המנוי |

```
monetization_ui_enabled
apple_billing_enabled
```

⚠️ את הסיסמה של חשבון ההדגמה ממלאים רק בשדות הייעודיים אצל אפל, לא בטקסט של ההערות, ולא שולחים אותה אליי.

| מה כתוב על המסך | מה ממלאים |
|---|---|
| `Sign-In Information` | שם המשתמש והסיסמה של חשבון ההדגמה |
| `Notes` | הטקסט שבחלק הבא |

---

## 1. הערות לגרסה

המקום:

| מה כתוב על המסך |
|---|
| `App Review Information` → `Notes` |

```text
Thank you for reviewing CarReminder.

The app's interface is in Hebrew (right to left). Each label below is given in Hebrew with an English translation, so the steps can be followed as written.

DEMO ACCOUNT
Please use the account in the Sign-In Information fields. It is a personal account on the free plan, so every subscription can be purchased with it. Sign in with Apple also works.

WHERE TO FIND THE SUBSCRIPTIONS
1. Sign in with the demo account.
2. Tap the menu icon at the top of the screen, then "הגדרות" (Settings).
3. Tap "המסלול והחיוב" (Plan and billing). This opens the "המסלולים" (Plans) screen, which lists four plans.
4. Tap a paid plan to open it. Its price is loaded from StoreKit, and "בחר מסלול" (Choose plan) opens the StoreKit purchase sheet.
The same screen also opens from the message shown when the free plan's vehicle limit is reached.

SUBSCRIPTIONS
One subscription group, "CarReminder Plans", with three monthly auto-renewable subscriptions:
- plan_p9  "מסלול מורחב" (Extended)
- plan_p19 "מסלול מקצועי" (Professional)
- plan_p49 "מסלול ללא הגבלה" (Unlimited)
All three unlock the same features. They differ in how many vehicles and documents the account can keep and in how many AI questions it can ask per day. The free plan stays available with no purchase.

RESTORING PURCHASES
Tap "שחזור רכישות" (Restore purchases) at the bottom of the Plans screen. An existing subscription is also restored automatically whenever the Plans screen opens.

MANAGING AND CANCELLING
On a subscriber's own plan, "ניהול המנוי ב-App Store" (Manage subscription in the App Store) opens the system subscription management sheet.

TERMS AND PRIVACY
Links to "תנאי שימוש" (Terms of Use) and "מדיניות פרטיות" (Privacy Policy) appear directly under the purchase button, and in the App Store listing.

ACCOUNT DELETION
Menu > "הגדרות" (Settings) > "פרופיל ורישיון" (Profile and license) > "מחיקת חשבון ונתונים" (Delete account and data).

Contact: support@car-reminder.app
```

✅ **כפתור השחזור קיים בקוד,** מתחת לרשימת המסלולים. הוא מופיע כשיש מה לקנות והחשבון כבר נטען, ולכן בחשבון ההדגמה הוא גלוי.

---

## 2. הערות לכל מנוי

המקום, בכל אחד משלושת המנויים:

| מה כתוב על המסך |
|---|
| `Review Information` → `Review Notes` |

```text
Monthly auto-renewable subscription in the "CarReminder Plans" group. It raises the account's limits to 15 vehicles, 15 documents and 50 AI questions per day. Purchased from the Plans screen: Menu > Settings > "המסלול והחיוב", then tap "מסלול מורחב" and "בחר מסלול".
```

```text
Monthly auto-renewable subscription in the "CarReminder Plans" group. It raises the account's limits to 30 vehicles, 40 documents and 200 AI questions per day. Purchased from the Plans screen: Menu > Settings > "המסלול והחיוב", then tap "מסלול מקצועי" and "בחר מסלול".
```

```text
Monthly auto-renewable subscription in the "CarReminder Plans" group. It removes the limit on vehicles and documents and allows 500 AI questions per day. Purchased from the Plans screen: Menu > Settings > "המסלול והחיוב", then tap "מסלול ללא הגבלה" and "בחר מסלול".
```

---

## 3. צילום מסך לכל מנוי

אפל מבקשת צילום מסך של המקום שבו קונים. מצלמים בבדיקה בטלפון, מגרסת טסטפלייט: מסך המסלולים, כשהשורה של המנוי פתוחה ורואים את המחיר ואת כפתור הבחירה. צילום אחד לכל מנוי.

| מה כתוב על המסך |
|---|
| `Review Information` → `Screenshot` |

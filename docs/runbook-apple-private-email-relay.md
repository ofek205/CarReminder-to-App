# רנבוק: רישום Private Email Relay אצל אפל

> נכתב 2026-09-08. **פעולה חיצונית, צד Ofek בלבד** (חוק 0).
> **למה זה דחוף:** 5 מהמשתמשים שנרשמו דרך Apple בחרו "Hide My Email", וכל מייל אליהם **חוזר**. הם לא מקבלים welcome, לא תזכורות, לא כלום. זה קורה עכשיו, לא בעתיד.
> קשור: [store-compliance-checklist.md](store-compliance-checklist.md)

---

## 0. מה הבעיה בשורה אחת

כתובת `@privaterelay.appleid.com` היא מסירה תקינה, **אבל רק מדומיינים שרשומים אצל אפל.** מדומיין לא רשום אפל דוחה, ומחזירה bounce. הדומיין שלנו לא רשום.

מתוך [התיעוד של אפל](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service):

> "If you don't register all the source domains or emails that you use, email sent to the private relay service will result in a bounce message."

---

## 1. ⚠️ לפני שנוגעים בפורטל: שני צינורות, לא אחד

זו הנקודה שהופכת רישום של 5 דקות לפעולה שצריך לחשוב עליה.

| צינור | שולח מ | מה עובר בו | ניתן לרישום? |
|---|---|---|---|
| **Resend** (edge functions) | `no-reply@car-reminder.app` | תזכורות, welcome, broadcast, הזמנות | ✅ כן |
| **Supabase Auth** | **`@mail.app.supabase.io`** כברירת מחדל | אישור הרשמה, איפוס סיסמה, magic link, קוד OTP | 🔴 **לא. הדומיין לא שלנו** |

הראיה, מהריפו שלנו ([README.md:62](../supabase/email-templates/README.md#L62)):

> "Supabase sends from its own `@mail.app.supabase.io` domain unless you configure a custom SMTP."

### מה זה אומר

**רישום `car-reminder.app` יפתור רק את הצינור של Resend.** מיילי ה-Auth ימשיכו ליפול למשתמשי relay, כי הם יוצאים מדומיין של Supabase שאי-אפשר לרשום אצל אפל.

**לכן יש שתי פעולות, לא אחת:**

- [ ] **פעולה א** — לרשום את המקורות של Resend אצל אפל (§3 כאן)
- [ ] **פעולה ב** — להגדיר **Authentication → SMTP Settings** בדשבורד של Supabase עם פרטי ה-SMTP של Resend, כדי שמיילי ה-Auth ייצאו גם הם מ-`car-reminder.app`

בלי ב', חצי מהבעיה נשארת.

> **מה שלא נשבר בגלל זה:** זרימת מחיקת החשבון. ענף ה-OTP חל רק על מי שיש לו כתובת שאפשר להגיע אליה, ומשתמשי relay מנותבים לענף מילת האישור. זה תוכנן כך, ובמקרה זה גם מכסה את הפער.

---

## 2. לאסוף את הערכים לפני שנכנסים לפורטל

### 2.1 מהקוד, כבר ידוע

| ערך | מה זה |
|---|---|
| `car-reminder.app` | דומיין ה-`From:` וה-DKIM `d=` |
| `no-reply@car-reminder.app` | הכתובת היחידה שמופיעה בקוד כשולחת |

`support@car-reminder.app` ו-`contact@car-reminder.app` מופיעים בקוד **רק כ-`mailto:` בגוף המייל וכ-User-Agent**, לא כשולחים. אין צורך לרשום אותם.

### 2.2 🔴 מ-Resend, ואי-אפשר לדעת אותו מהקוד

**ה-Return-Path / MAIL FROM subdomain.** בדרך כלל `send.car-reminder.app`, אבל יכול להיות `send.<something>.car-reminder.app`.

**Resend → Domains → `car-reminder.app`**, ולחפש את רשומת ה-`MAIL FROM` או ה-Return-Path.

> **זה הערך שמפספסים, וזה הכי חשוב בדף הזה.** בדיקת ה-SPF של אפל היא **התאמה מדויקת** בין הדומיין ב-envelope sender לבין הדומיין הרשום. לרשום רק את `car-reminder.app` ולא את תת-הדומיין = הרישום ייראה מוצלח וה-bounces ימשיכו.

### 2.3 🔴 מה-DB, ואי-אפשר לדעת אותו מהקוד

שתי פונקציות שולחות עם `template.from_email || 'no-reply@car-reminder.app'`
([dispatch-reminder-emails:204](../supabase/functions/dispatch-reminder-emails/index.ts#L204), [dispatch-broadcast:229](../supabase/functions/dispatch-broadcast/index.ts#L229)).

כלומר הכתובת האמיתית יושבת ב-DB. כל כתובת מותאמת שם שאינה `no-reply@` תיפול למשתמשי relay גם אחרי הרישום.

```sql
select distinct from_email
from public.email_templates
where from_email is not null;
```

כל כתובת שתחזור צריכה להירשם גם היא.

**מגבלות אפל:** 32 מקורות למפתח יחיד, 100 לארגון. תת-דומיינים וכתובות נספרים בנפרד. אין לחץ.

---

## 3. הרישום

**מסלול:** [developer.apple.com/account/resources](https://developer.apple.com/account/resources) → **Certificates, Identifiers & Profiles** → **Services** → **Sign in with Apple for Email Communication** → **Configure**

1. במקטע **Email Sources**, לחיצה על **+**
2. להזין **רשימה מופרדת בפסיקים של דומיינים**:
   ```
   car-reminder.app, send.car-reminder.app
   ```
   (עם הערך המדויק מ-§2.2) → **Next** → אישור → **Register**
3. **+** שוב, הפעם **רשימה של כתובות**:
   ```
   no-reply@car-reminder.app
   ```
   בתוספת כל מה שחזר מהשאילתה ב-§2.3
4. הטבלה תציג **תוצאת בדיקת SPF לכל מקור**. לוודא שכולם עוברים
5. **Settings** (ימין למעלה) → להשאיר **"Sign in with Apple private email relay notifications"** דלוק, כדי שכשלי מסירה ממקור לא רשום יגיעו כהתראה. דורש הרשאת Account Holder או Admin

> אפל דורשת **SPF ו/או DKIM**. Resend מחייב את שניהם לדומיין מותאם, ולכן לא אמורה להידרש עבודת DNS נוספת מעבר למה שכבר מוגדר שם. החלק החסר הוא הרישום בצד של אפל.

---

## 4. איך יודעים שזה באמת עבד

**לא להסתמך על "הרישום נשמר".** צריך מסירה אמיתית.

1. לשלוח `reminder_test` לכתובת relay אמיתית של אחד מ-5 המשתמשים, או לחשבון בדיקה שנרשם דרך Apple עם "Hide My Email"
2. לבדוק בטבלת `email_events` — ה-webhook של Resend כבר מוזן לשם ([resend-webhook](../supabase/functions/resend-webhook/index.ts)):

```sql
select status, count(*), max(created_at)
from public.email_events
where created_at > now() - interval '1 hour'
group by status;
```

3. הסטטוס צריך להיות **`delivered`** ולא `bounced`
4. אם עוד `bounced` עם **`5.7.1`** או **"Unauthorized Sender"** — יש מקור שלא נרשם. כמעט תמיד זה ה-Return-Path מ-§2.2

### מדידת ההצלחה האמיתית

```sql
-- כמה משתמשי relay יש, וכמה מהם קיבלו מייל בהצלחה
select
  count(*) filter (where u.email like '%@privaterelay.appleid.com') as relay_users,
  count(*) filter (where e.status = 'delivered')                    as delivered
from auth.users u
left join public.email_events e on e.recipient = u.email
where u.deleted_at is null;
```

לפני הרישום: `delivered` אמור להיות 0 עבור משתמשי relay. אחריו, גדול מ-0.

---

## 5. צ'קליסט

**איסוף**
- [ ] ה-Return-Path המדויק מ-Resend → Domains (§2.2)
- [ ] רשימת `from_email` מה-DB (§2.3)

**רישום אצל אפל**
- [ ] `car-reminder.app`
- [ ] תת-הדומיין של ה-Return-Path
- [ ] `no-reply@car-reminder.app` + כל מה שחזר מהשאילתה
- [ ] כל המקורות עוברים בדיקת SPF בטבלה
- [ ] התראות bounce דלוקות

**הצינור השני**
- [ ] Supabase → Authentication → SMTP Settings מוגדר עם Resend (§1, פעולה ב)

**אימות**
- [ ] `reminder_test` לכתובת relay
- [ ] `email_events` מציג `delivered`
- [ ] שאילתת המדידה מחזירה `delivered > 0` למשתמשי relay

---

## 6. למה זה גם עניין של ציות ולא רק של מסירה

באפליקציית iOS **אסור** כפתור או קישור לתשלום חיצוני (Guideline 3.1.1(a)), ואפל מרשה במפורש **מיילים מחוץ לאפליקציה** על אמצעי תשלום אחרים. בתכנון המונטיזציה המקורי זה הפך את המייל לערוץ ההמרה **היחיד** ב-iOS, ואז חור ה-relay היה סתימת דרך.

זה כבר לא המצב: [spec ח-5](spec-monetization-plans-v2.md) הוכרע ל-**Apple IAP** ב-iOS, ולכן המייל אינו ערוץ ההמרה היחיד. אבל הוא עדיין נושא חשבוניות, dunning והתראות חסד, ומשתמש שלא מקבל אותם הוא משתמש שיופתע מחיוב.

**וגם בלי שום קשר למונטיזציה:** 5 משתמשים לא מקבלים תזכורת טסט. זו הפונקציה המרכזית של האפליקציה.

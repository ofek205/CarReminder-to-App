# Runbook: החלת המיגרציות של המונטיזציה וההסכמה

> נכתב 2026-09-08. **הכל בקובץ הזה מיועד ל-Ofek** — קלוד לא מריץ SQL ולא נוגע בשרת (חוק 0).
> קשור: [open-questions-monetization.md](open-questions-monetization.md) · [plan-monetization-implementation.md](plan-monetization-implementation.md)

**למה הקובץ הזה קיים:** התהליך פרוס על כמה ימים (להחיל, לאמת, לרשום, ואחר כך להדליק דגלים), ושני תיקונים חשובים נאמרו רק בשיחה. בלי הקובץ הזה הם נאבדים ושתי הטעויות חוזרות.

---

## שני התיקונים שאסור לאבד

### 1. הפנקס — ✅ נבדק 2026-09-08, הוא **כבר** חי

`node scripts/sql-ledger.cjs record <file>` מפיק קריאה ל-**`public.sql_ledger_record(...)`**, ולכן הטבלה חייבת להתקיים.

**היא קיימת.** `select count(*) from public.sql_ledger` החזיר **4** — כלומר הפנקס הוחל לפני 2026-09-08 וארבעה קבצים כבר רשומים בו. הקובץ עצמו לא זורע שורות (ה-`insert` היחיד שבו יושב בתוך גוף `sql_ledger_record`), ולכן ארבע השורות הן רישומים אמיתיים.

> **שני תיקונים לגרסה קודמת של הקובץ הזה:**
> 1. כתבתי ש-`0` היא „התשובה הנכונה” לשאילתת הבדיקה. **זה היה שגוי** והיה גורם לתוצאה תקינה להיראות כתקלה. כל מספר ≥ 0 תקין; מה שנבדק הוא שהשאילתה **לא זורקת שגיאה**.
> 2. הסתמכתי על ההערה ב-CLAUDE.md שהקובץ „טרם הוחל”. ההערה **מיושנת**. זה בדיוק הפער בין תיעוד למציאות שה-CLAUDE.md עצמו מזהיר עליו שוב ושוב.

הרצה חוזרת של הקובץ **בלתי-מזיקה** (`create table if not exists` + `create or replace function`), אך אינה נדרשת.

**מה כן כדאי לראות לפני שממשיכים** — מה בדיוק רשום, כי בריפו הזה הפנקס הוא העדות היחידה למה שהוחל:

```sql
select filename, verdict, target_database,
       applied_at::date as applied,
       applied_by_email as who,
       left(coalesce(notes, ''), 60) as notes
  from public.sql_ledger
 where rolled_back_at is null
 order by applied_at;
```

```bash
node scripts/sql-ledger.cjs drift
```

### 2. הדגלים דורשים upsert, לא `UPDATE`

`public.app_config` הוא `key text primary key`, ו**אין שום seed שיוצר את שורות הדגלים החדשות**. `update ... where key = '...'` על שורה שלא קיימת מעדכן **0 שורות ולא אומר כלום** — הדגל נראה כאילו הודלק ושום דבר לא משתנה.

---

## סדר ההחלה

```
0. supabase-sql-ledger-2026-09-01.sql        ← תנאי מקדים לכל record
1. supabase-ai-consents-2026-09-08.sql       ← עצמאי
2. supabase-monetization-phase1-plans-2026-09-08.sql
3. supabase-monetization-phase2b-admin-2026-09-08.sql   ← preflight דורש 2
4. supabase-monetization-phase3-counters-2026-09-08.sql ← preflight דורש 2
```

3 ו-4 עצמאיים זה מזה. שניהם נעצרים לפני שהם יוצרים משהו אם 2 חסר, כך שסדר שגוי נכשל בבטחה ולא חצי-מוחל.

⚠️ **staging ו-prod חולקים מסד** (שער 5 ב-CLAUDE.md). כל הקבצים additive: טבלאות ופונקציות חדשות בלבד, אפס שינוי בקיים.

---

## שלב 0 — הפנקס ✅ כבר בוצע

**אין מה להריץ כאן.** נבדק ב-2026-09-08: הפנקס חי ובו 4 רישומים. ראה תיקון 1 למעלה.

אם בסביבה אחרת הוא כן חסר, השאילתה הזו זורקת שגיאה, ואז מדביקים את `supabase-sql-ledger-2026-09-01.sql` במלואו:

```sql
select count(*) as ledger_rows from public.sql_ledger;
```

**מה שנבדק הוא שהשאילתה לא זורקת שגיאה.** המספר עצמו אינו אבחנתי.

---

## שלב 1 — הסכמת AI

הדבק את `supabase-ai-consents-2026-09-08.sql`.

```sql
select policyname, cmd from pg_policies
 where tablename = 'ai_consents' order by policyname;

select relrowsecurity from pg_class
 where oid = 'public.ai_consents'::regclass;
```

**מצופה:** 4 policies, `rowsecurity = true`.
**תשובה רעה:** פחות מ-4, או `false`. בלי RLS הטבלה פתוחה.

---

## שלב 2 — תשתית המסלולים

הדבק את `supabase-monetization-phase1-plans-2026-09-08.sql`.

```sql
select plan, price_ils_month, max_vehicles, business_ui
  from public.plan_limits order by sort_order;
```
**מצופה:** free/p9/p19/p49 במחירים 0/9/19/49 ותקרות 5/10/30/NULL.

```sql
select (select count(*) from public.accounts)             as accounts,
       (select count(*) from public.account_subscriptions) as subs;
```
**חייבים להיות זהים.** פער = ה-backfill פספס חשבונות, ואלה יישארו בלי שורה.

### ⭐ השאילתה שמכריעה את תקרת החינם

```sql
select case when c.n > 30 then '30+'
            when c.n > 10 then '11-30'
            when c.n > 5  then '6-10'
            else '0-5' end as bucket,
       count(*) as accounts
  from (select a.id,
               (select count(*) from public.vehicles v
                 where v.account_id = a.id) as n
          from public.accounts a
         where a.type = 'personal') c
 group by 1 order by 1;
```

**הדלי `6-10` הוא הליבה:** אלה חשבונות שתקינים **היום** (התקרה האישית בפועל היא `app_config.personal_vehicle_cap` שברירת המחדל שלה **10**) ויהיו **מעל** תקרת חינם של 5. הצ'ארט ב-Admin Analytics לא עונה על זה כי `TAIL = 10` ב-`AdminAnalytics.jsx` מקבץ הכל מעל 10 לעמודה אחת.

אם `6-10` גדול, או 5 היא התקרה הלא-נכונה, או שהחסד של 60 יום קצר מדי.

```sql
select source, count(*), min(grace_until), max(grace_until)
  from public.account_subscriptions group by source order by 2 desc;
```
**מצופה:** `default` לרוב, ו-`grandfather` לכל מי שמעל התקרה **ולכל חשבון עסקי**.

```sql
select plan, max_vehicles
  from public.account_plan('00000000-0000-0000-0000-000000000000');
```
**חייב להחזיר `free, 5`.** זה ה-fail-closed: חשבון בלי שורת מנוי מקבל את המסלול החינמי, לא "ללא הגבלה". תשובה אחרת = חור.

---

## שלב 3 — ניהול אדמין

הדבק את `supabase-monetization-phase2b-admin-2026-09-08.sql`.

```sql
select public.plan_ovr(null, 10)   as inherit_10,
       public.plan_ovr(-1,   10)   as to_unlimited,
       public.plan_ovr(15,   10)   as to_15,
       public.plan_ovr(null, null) as inherit_unlimited;
```
**מצופה:** `10 / NULL / 15 / NULL`.

זה הסנטינל, והוא הנקודה העדינה בשלב: ב-`plan_limits` המשמעות של NULL היא **ללא הגבלה**, ובעמודות ה-override היא **לרשת מהמסלול**. אם השורה הזו לא מחזירה בדיוק את הארבעה, כל התעריפים המותאמים שבורים.

```sql
select * from public.admin_list_plan_exceptions();
```
**אפס שורות היא התשובה הטובה.** כל שורה כאן היא חשבון שמצבו אינו סטנדרטי.

---

## שלב 4 — המונים

הדבק את `supabase-monetization-phase3-counters-2026-09-08.sql`.

```sql
select public.usage_period_key('lifetime') as lifetime,
       public.usage_period_key('month')    as month,
       public.usage_period_key('day')      as day,
       to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as utc_day;
```

**ליד חצות UTC, `day` ו-`utc_day` חייבים להיות שונים.** אם הם זהים בכל שעה, שעון ישראל לא נתפס, והמכסה החודשית תתגלגל ב-03:00 מקומי במקום בחצות.

```sql
select public.bump_feature_usage(
  '<account-id>', '<user-id>', 'ai_advisor', 'weekly');
```
**מצופה: שגיאה `unknown_horizon: weekly`.** אופק לא מוכר חייב להיכשל בקול, לא ליפול בשקט ל-`lifetime`.

---

## הרישום בפנקס

לכל אחד מארבעת הקבצים:

```bash
node scripts/sql-ledger.cjs record supabase-ai-consents-2026-09-08.sql
```
```bash
node scripts/sql-ledger.cjs record supabase-monetization-phase1-plans-2026-09-08.sql
```
```bash
node scripts/sql-ledger.cjs record supabase-monetization-phase2b-admin-2026-09-08.sql
```
```bash
node scripts/sql-ledger.cjs record supabase-monetization-phase3-counters-2026-09-08.sql
```

כל אחת מדפיסה `select public.sql_ledger_record(...)` להדבקה.

⚠️ **`p_notes` הוא כל הערך של הפנקס.** למלא במה שראית בפועל ("ההתפלגות: 412 ב-0-5, 89 ב-6-10, 23 ב-11-30"), לא ב-"applied ok". השדה הנושא הוא ה-`sha256`, ולכן `drift` יזהה אם הקובץ שונה אחרי ההחלה.

---

## הדגלים

השורות לא קיימות. ליצור אותן **כבויות** — שום דבר לא משתנה למשתמשים:

```sql
insert into public.app_config (key, value)
values ('ai_consent_enforced',     'false'::jsonb),
       ('monetization_ui_enabled', 'false'::jsonb)
on conflict (key) do nothing;
```

להדליק, **אחד בכל פעם** ולא שניהם יחד:

```sql
insert into public.app_config (key, value)
values ('monetization_ui_enabled', 'true'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
```

```sql
insert into public.app_config (key, value)
values ('ai_consent_enforced', 'true'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
```

**לכבות בחזרה** זה אותו upsert עם `'false'`. שני הדגלים fail-closed כשהשורה חסרה, ולכן היעדרות = כבוי, וזה הכיוון הבטוח.

⚠️ **`ai_consent_enforced` דורש את שלב 1 מוחל.** הקריאה fail-closed, כלומר הדלקת הדגל בלי הטבלה **חוסמת AI לכולם**.

⚠️ **`monetization_ui_enabled` מגדר רק את השורה של המשתמש ב-`/MyPlan`.** מסך `/AdminPlans` והפקדים בדראוור **אינם מגודרים במכוון**: הם קיימים כדי לתפוס מענק שנשכח, ולכן צריכים להיות נגישים בכל רגע שבו מענק יכול להתקיים. לפני המיגרציות הם מציגים „ייתכן שמיגרציית המסלולים עוד לא הורצה” ולא נשברים.

---

## שתי בדיקות שאינן חלק מהמיגרציות

```sql
select pg_get_functiondef(oid) from pg_proc
 where proname = 'create_business_workspace';
```
פריט 5 בצ'קליסט של [plan §6.5](plan-monetization-implementation.md). הלקוח כבר עובר דרך `request_business_workspace` באישור אדמין (מסלול השירות-העצמי הוסר), אבל צריך לאמת שהשרת חוסם non-admin. אם לא, **הממשק העסקי חינמי לכל דורש**.

```sql
select column_name from information_schema.columns
 where table_name = 'vehicle_shares' order by ordinal_position;
```
לאישור ש-`invitee_email`, `account_id` ו-`updated_at` קיימות.

> **מה שכבר נבדק ב-2026-09-08 והוסר מרשימת החוסמים:** `pg_get_functiondef` על `share_vehicle_with_email` הראה ש**v4 מתוקן חי, והשיתוף אינו שבור**. ההערה בגוף הפונקציה מתעדת את תיקון אוצר-המילים מנהל/שותף (ג-13), והתפקידים `viewer`/`editor` תואמים את הלקוח. הפונקציה גם **מכניסה `account_id`**, כלומר העמודה קיימת — הפוך ממה שהתוכנית הניחה, וזה מפשט את cap השיתופים בשלב 5 (אפשר לספור לפי `account_id` ישירות ולא דרך join ל-`vehicles`).
>
> אותה בדיקה חשפה באג חי בלקוח, שתוקן ב-`784f803`: ארבעה מקודי השגיאה שהפונקציה זורקת לא היו במפת התרגום, ולכן מי שהגיע לתקרת 3 השיתופים ראה `שגיאה בשיתוף: max_shares_per_vehicle`.

---

## מה לא בקובץ הזה

**Edge functions וסודות**, שהם מסלול נפרד:

- `apple-revoke` נכתבה ו**מעולם לא נפרסה**. דורשת `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY`, ו-`APPLE_SERVICES_ID` (או `APPLE_BUNDLE_ID`). בלעדיה מחיקת חשבון עובדת אך טוקן אפל לא מבוטל, וזה חלק מ-5.1.1(v).
- `ai-proxy` טרם שונתה. ספירת ה-AI של שלב 3 נכנסת אחרי ה-rate-limit של ה-Default mode ולפני `hasImages`.

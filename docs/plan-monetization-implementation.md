# תוכנית מימוש: מונטיזציה (4 מסלולים)

> **סטטוס:** תוכנית הנדסית. נכתב 2026-09-07.
> **מסמך האפיון:** [spec-monetization-plans-v2.md](spec-monetization-plans-v2.md). כאן, *איך* בונים.
> **עקרון-על:** למדוד לפני שחוסמים. אף שלב לא חוסם משתמש לפני שראינו את הנתונים האמיתיים.

---

## 1. מודל הנתונים

### 1.1 `plan_limits`: מקור האמת למגבלות

טבלת lookup, שורה פר-מסלול. **`NULL` = ללא הגבלה.**

```sql
create table public.plan_limits (
  plan                   text primary key,   -- 'free' | 'p9' | 'p19' | 'p50'
  label_he               text not null,
  price_ils_month        numeric(6,2) not null,
  max_vehicles           int,                -- 5 / 10 / 30 / NULL
  ai_daily_cap           int,                -- fair-use; NULL = ללא הגבלה
  ai_lifetime_teaser     int,                -- free בלבד: 1
  plate_checks_per_month int,                -- 3 / NULL
  max_shares             int,                -- 2 / NULL
  business_ui            boolean not null default false,
  sort_order             int not null
);
```

**למה טבלה ולא קוד:** שינוי מגבלה = `UPDATE` אחד, בלי deploy. גם דף המסלולים באתר נבנה מאותה טבלה, אין סיכון שהשיווק והאכיפה יסתרו זה את זה.

**RLS:** קריאה לכולם (מידע פומבי), כתיבה `service-role` בלבד.

### 1.2 `account_subscriptions`: המסלול של כל חשבון

```sql
create table public.account_subscriptions (
  account_id               uuid primary key
                             references public.accounts(id) on delete cascade,
  plan                     text not null default 'free'
                             references public.plan_limits(plan),
  status                   text not null default 'active',
                             -- 'active' | 'grace' | 'past_due' | 'canceled'
  current_period_end       timestamptz,
  grace_until              timestamptz,
  source                   text not null default 'default',
                             -- 'checkout' | 'admin_grant' | 'grandfather' | 'default'
  external_customer_id     text,
  external_subscription_id text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
```

**`account_id` הוא ה-PK, במכוון.** שורה אחת פר-חשבון, אין אי-ודאות "איזו שורה היא הנוכחית". זה נמנע מהבאג שנתפס באפיון החברות (ג11): `invite_account_member_by_email` השתמש ב-`LIMIT 1` ללא `ORDER BY` ולכן נפל על חשבון לא-דטרמיניסטי. אין לחזור על זה במסלולים.

היסטוריית מנוי (שדרוגים, חיובים), טבלה append-only נפרדת `subscription_events`, לא שורות מרובות כאן.

**RLS:** `select`, המשתמש קורא את החשבונות שהוא חבר בהם בלבד. `insert/update/delete`, **`service-role` בלבד, ללא שום policy ללקוח.** לקוח לעולם לא קובע מסלול.

### 1.3 `feature_usage_counters`: מונה אחד לשלוש המכסות

```sql
create table public.feature_usage_counters (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id    uuid not null,       -- מי צרך (גם כשהמכסה חשבונית)
  feature    text not null,       -- 'ai_advisor' | 'plate_check'
  period_key text not null,       -- 'lifetime' | '2026-09' | '2026-09-07'
  count      int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (account_id, user_id, feature, period_key)
);
```

מכסה חשבונית = `SUM(count)` על החשבון. מכסה פר-משתמש = השורה עצמה. `period_key` מכסה את שלושת האופקים בלי שלוש טבלאות.

> **⚠️ למה טבלה חדשה ולא `ai_usage_logs`:** האפיון דורש שכיבוי `app_config.ai_usage_tracking_enabled` **לא** יבטל את המכסה. אבל `ai-proxy` בודק את הדגל הזה **לפני** שהוא כותב ל-`ai_usage_logs` ([ai-proxy/index.ts:167](../supabase/functions/ai-proxy/index.ts)). כלומר `ai_usage_logs` **אינו** יכול לשמש מקור אמת למכסה, כיבוי הדגל היה הופך את המכסה לאין-סופית, בדיוק מה שה-AC אוסר. הכתיבה למונה הזה **חסינה לדגל**.

**`period_key` בשעון ישראל:**
```sql
-- יומי:  to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD')
-- חודשי: to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM')
```
`Asia/Jerusalem` ולא UTC, אחרת המכסה מתאפסת ב-03:00 בקיץ.

### 1.4 פונקציית עזר מרכזית

```sql
create or replace function public.account_plan(p_account_id uuid)
returns public.plan_limits
language sql stable security definer set search_path = public
as $$
  select pl.*
    from public.plan_limits pl
   where pl.plan = coalesce(
     (select s.plan from public.account_subscriptions s
       where s.account_id = p_account_id
         and (s.status = 'active'
              or (s.grace_until is not null and s.grace_until > now()))),
     'free'                    -- fail-closed: ברירת המחדל היא החינמי
   );
$$;
```

**חשבון בלי שורת מנוי ⇒ `free`, לא "ללא הגבלה".** זה ה-fail-closed שה-AC דורש.

---

## 2. אכיפת תקרת הרכבים: הנקודה שבה v1 טעה

### 2.1 מפת נתיבי ההוספה: 7 נתיבים באפליקציה + 4 מחוץ לה

אפיון v1 דיבר על "6 נתיבים". המיפוי המלא:

| # | נתיב | מנגנון | שורות לפקודה |
|---|---|---|---|
| 1 | הוספה ידנית, [AddVehicle.jsx:1023](../src/pages/AddVehicle.jsx#L1023) | insert ישיר (RLS חל) | 1 |
| 2 | אשף סריקה, [VehicleScanWizard.jsx:347](../src/components/vehicle/VehicleScanWizard.jsx#L347) | insert ישיר | 1 |
| 3 | בדיקה מהירה → שמור, [vehicleQuickCheck.js:359](../src/services/vehicleQuickCheck.js#L359) | insert ישיר; **מקצה חשבון בדרישה** דרך `ensure_user_account` | 1 |
| 4 | מיגרציית אורח #1, [GuestDataContext.jsx:402](../src/contexts/GuestDataContext.jsx#L402) | לופ; **ללא שום תקרה**; כשל פר-רכב **נבלע** ב-`console.warn` | N × 1 |
| 5 | מיגרציית אורח #2, [Dashboard.jsx:1029](../src/pages/Dashboard.jsx#L1029) | לופ; `.slice(0,20)`; פילטר **רחב יותר** מ-#4 | ≤20 × 1 |
| 6 | ייבוא מרובה, RPC `bulk_add_vehicles` | **`SECURITY DEFINER`** ([phase9-bulk-vehicles.sql:25](../supabase-phase9-bulk-vehicles.sql#L25)), עוקף RLS | N × 1 בלופ |
| 7 | כתיבת admin view-as | policy נוסף ב-RLS, **ללא** SECURITY DEFINER, trigger כן יורה | 1 |

מחוץ לאפליקציה (יורים על trigger ב-DB): ייבוא נפתלי, **41 שורות בפקודה אחת** ([scripts/supabase-naftaly-import-2026-06-25.sql:11](../scripts/supabase-naftaly-import-2026-06-25.sql#L11)); seed צי מדומה, **20 שורות בפקודה אחת**; dump מיגרציית Base44; smoke test.

שני נתיבי מיגרציית האורח (#4, #5) קוראים את אותו מפתח `fleet_guest_vehicles` ו**מתחרים ביניהם**: ה-guard נגד re-entry קיים רק בתוך #4 ואינו מתאם עם #5.

### 2.2 ⚠️ `bulk_add_vehicles` **בולע** exceptions: ה-trigger לבדו לא יעצור אותו

זה הממצא הקריטי ביותר בתוכנית.

ה-RPC עוטף **כל הוספה בנפרד** ב-handler משלה ([phase9-bulk-vehicles.sql:110-113](../supabase-phase9-bulk-vehicles.sql#L110)):
```sql
begin
  execute format('insert into public.vehicles ...');
exception when others then          -- ← בולע גם את שגיאת התקרה
  error_count := error_count + 1;
  errors := errors || ...;          -- נרשם ונשכח
end;
```

המשמעות: `raise exception 'vehicle_plan_cap_exceeded'` מתוך trigger **ייתפס כאן**, ייספר ל-`error_count`, והלופ ימשיך. ה-RPC יחזיר **HTTP 200 עם הצלחה חלקית**.

וגרוע מזה, הלקוח ([BulkAddVehicles.jsx:440-455](../src/pages/BulkAddVehicles.jsx#L440)) קורא **רק** את `added_count` ו**לעולם לא בודק את `errors`**. כלומר המשתמש שמייבא 50 רכבים לחשבון עם תקרה 5 יראה "נוספו 5" ו**שום הסבר**: לא פופ-אפ, לא שגיאה, לא רמז שצריך לשדרג. שקט מוחלט.

**התיקון דורש שלושה שינויים, לא אחד:**
1. **בדיקת תקרה מקדימה ב-RPC עצמו**, לפני הלופ: `count(*) + array_length(p_vehicles)` מול התקרה → `raise` יחיד בחוץ, מחוץ לכל handler.
2. **הלקוח חייב לקרוא את `errors`** ולמפות `vehicle_plan_cap_exceeded` לפופ-אפ.
3. **ה-trigger נשאר** כרשת ביטחון לכל שאר הנתיבים.

> **הערה על snapshot:** מכיוון שה-RPC מריץ N פקודות **נפרדות** בלופ (ולא `INSERT` אחד מרובה-שורות), הספירה בין הפקודות **כן** מצטברת נכון. שאלת ה-snapshot נוגעת רק לסקריפטים החד-פעמיים שמכניסים 41/20 שורות בפקודה אחת, ושם `AFTER ... FOR EACH STATEMENT` (§2.3) מטפל בזה נכון.

### 2.3 שני נתיבים שאף trigger על `vehicles` לא יכול לתפוס

| בייפס | למה |
|---|---|
| **`claim_migrated_account`** ([supabase-claim-migrated-account-2026-06-27.sql:20](../supabase-claim-migrated-account-2026-06-27.sql#L20), `SECURITY DEFINER`) | מכניס ל-`account_members` ו-`user_profiles` בלבד, **לא ל-`vehicles`**. המשתמש מחובר כ"בעלים" לחשבון שכבר מחזיק N רכבים. **אפס INSERT ⇒ אפס trigger.** המשתמש מגיע מעל התקרה בלי שנכתבה שורה אחת. |
| **שיתוף רכב שאושר** | מוסיף ל-`vehicle_shares`, לא ל-`vehicles`. הרכב מופיע דרך `my_vehicles_v`. |

**הטיפול ב-`claim_migrated_account`:** לא לחסום (זה נתיב שחזור לגיטימי) אלא **להעניק חסד אוטומטית** בתוך ה-RPC, לכתוב `grace_until` בשורת המנוי בזמן ה-claim. כך המשתמש מקבל את החשבון שלו במלואו, ומקבל התראה מסודרת.

**השיתופים תקינים כמו שהם**: לפי האפיון רכב משותף נספר לבעלים בלבד. אבל יש מכאן כלל UI: **ספירת התקרה חייבת להתבסס על רכבים בבעלות, לא על `my_vehicles_v`**: בדיוק כפי שהאפיון (§6.4) מזהיר.

### 2.4 טריגרים קיימים על `vehicles`: סדר הפעלה

**שניים כבר יורים על `BEFORE INSERT`**, ו-Postgres מפעיל triggers באותו phase **בסדר אלפביתי לפי שם**:

| Trigger | Timing | file |
|---|---|---|
| `vehicles_stamp_mileage_update_date` | **BEFORE INSERT** | [supabase-vehicle-auto-stamp-mileage-date.sql:57](../supabase-vehicle-auto-stamp-mileage-date.sql#L57) |
| `trg_vehicles_first_reminder_armed_at` | **BEFORE INSERT** / UPDATE OF | [supabase-vehicles-first-reminder-armed-at.sql:67](../supabase-vehicles-first-reminder-armed-at.sql#L67) |
| `trg_prevent_vehicle_account_hijack` | BEFORE UPDATE | [supabase-vehicle-shares-hardening.sql:82](../supabase-vehicle-shares-hardening.sql#L82) |
| `prevent_vehicle_account_change` | BEFORE UPDATE | [supabase-phase4-business-vehicles.sql:101](../supabase-phase4-business-vehicles.sql#L101) |
| `trg_log_view_as_write` | AFTER I/U/D | [supabase-admin-view-as-audit.sql:39](../supabase-admin-view-as-audit.sql#L39) |

ה-trigger החדש הוא `AFTER ... FOR EACH STATEMENT` ולכן **אינו מתחרה** על סדר עם השניים הראשונים. עוד רלוונטי: `license_plate_normalized` הוא **generated column** ויש unique index `vehicles_plate_unique_per_account` על `(account_id, license_plate_normalized)`.

> ⚠️ **קבצי ה-`.sql` הם סקריפטים חד-פעמיים, לא snapshot מאומת של הסכמה.** אין בריפו תיעוד אם ארבעת הטריגרים האלה באמת הורצו על prod. **חובה לאמת מול `pg_trigger` ב-DB החי** לפני שקובעים סדר.

### 2.5 בייפס עתידי: שכבת ה-offline

[src/lib/dal/commands/vehicles.js:16-20](../src/lib/dal/commands/vehicles.js#L16) רושמת כרגע **רק** `vehicle.update`; ה-header מציין ש-create/delete לא נרשמו במכוון. **אם `vehicle.create` יתווסף לתור ה-replay**: דחיית תקרה תתגלה אסינכרונית בזמן replay, כשהמשתמש כבר מזמן סגר את המסך. חייב להיכנס לתכנון ה-offline לפני שזה נרשם.

### 2.2 הפתרון: trigger ברמת-פקודה עם transition table

```sql
create or replace function public.enforce_vehicle_plan_cap_stmt()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_max int;
  v_count int;
begin
  -- distinct: פקודה אחת יכולה לגעת בכמה חשבונות
  for r in select distinct account_id from new_rows where account_id is not null loop

    -- סריאליזציה פר-חשבון: מונע מריצה של שתי הוספות מקבילות
    -- שכל אחת רואה count מתחת לתקרה ויחד חוצות אותה.
    perform 1 from public.account_subscriptions
      where account_id = r.account_id for update;

    select max_vehicles into v_max from public.account_plan(r.account_id);
    if v_max is null then continue; end if;          -- מסלול ללא הגבלה

    select count(*) into v_count
      from public.vehicles where account_id = r.account_id;

    if v_count > v_max then
      raise exception 'vehicle_plan_cap_exceeded'
        using detail = format('max=%s attempted_total=%s', v_max, v_count),
              hint   = 'upgrade_required';
    end if;
  end loop;
  return null;
end $$;

create trigger trg_vehicle_plan_cap_stmt
  after insert on public.vehicles
  referencing new table as new_rows
  for each statement
  execute function public.enforce_vehicle_plan_cap_stmt();
```

**למה `AFTER ... FOR EACH STATEMENT`:** ה-transition table `new_rows` מכילה את **כל** שורות הפקודה, וה-`count(*)` אחרי ההוספה רואה את המצב הסופי האמיתי. עובד נכון גם להוספה בודדת וגם לייבוא של 100. ה-`raise` מגלגל את כל הפקודה, ייבוא מרובה שחוצה את התקרה נדחה **כשלמות**, ולא "חלק נכנס וחלק לא".

**סריאליזציה:** ה-`for update` על שורת המנוי הופך את החשבון לצוואר-בקבוק לוגי לרגע. עלות זניחה (הוספת רכב היא פעולה נדירה), ומונע את מירוץ ההוספות המקבילות.

**`security definer` + `set search_path = public`:** ה-trigger חייב לקרוא `account_subscriptions` גם כשה-RLS של המשתמש לא היה מרשה. ה-`search_path` הקבוע מונע השתלטות דרך search_path, תבנית הבית (למשל [staging-init-consolidated.sql:5752](../staging-init-consolidated.sql#L5752)).

### 2.3 ⚠️ תבנית ה-trigger הקיימת בפרויקט היא fail-OPEN: אין להעתיק אותה

```sql
-- staging-init-consolidated.sql:5735-5742, community_posts_rate_limit
begin
  select public.rate_limit_check(...) into allowed;
exception when others then allowed := null; end;   -- ← בליעת שגיאה
if allowed = false then                            -- ← null = false → null
  raise exception 'rate_limit_exceeded: ...';      -- ← לא מורם!
end if;
```

אם `rate_limit_check` נכשל, `allowed` הוא `null`, והתנאי `null = false` מוערך ל-`null`, כלומר ה-`raise` **לא** קורה וההוספה עוברת. זה **fail-open**, והוא מכוון ונכון לפוסטים בקהילה (עדיף פוסט כפול מאשר חסימת משתמש).

**למונטיזציה זה הפוך:** כל בליעת שגיאה = פרצה לעקוף את התשלום. ב-triggers של המסלול **אין `exception when others`**: שגיאה מגלגלת את הפקודה. זה ה-`fail-closed` שה-AC דורש, וזו סטייה מודעת מתבנית הבית.

### 2.4 קיים כבר trigger על `vehicles`

`trg_prevent_vehicle_account_hijack` ([staging-init-consolidated.sql:4446](../staging-init-consolidated.sql#L4446)), trigger קיים על הטבלה. ה-trigger החדש **מתווסף** ואינו מחליף. שם ייחודי, ואימות שסדר ההפעלה אינו יוצר תלות.

---

## 3. אכיפת שלוש המכסות

### 3.1 יועץ AI

נקודת אכיפה: [ai-proxy/index.ts](../supabase/functions/ai-proxy/index.ts), **מיד אחרי שורה 763**: סוף בלוק ה-`rate_limit_check` של ה-Default mode, לפני `const hasImages` ב-:765. באותה נקודה יש `user.id` מאומת, ה-`body` המפורש, וקליינט service-role. **צריך להרים את `requestSurface`** שמחושב כרגע מאוחר יותר ב-:822-825.

יש **שני** בלוקי rate-limit. הבלוק ב-:725-745 הוא של `extract_document` (`max_per_min: 30`), **אין לשים שם את מכסת היועץ.**

#### ⚠️ שני נתיבי יועץ שולחים **אפס תיוג**: מכסה לפי `surface` תפספס אותם

| נתיב | מה קורה |
|---|---|
| [PostCreateDialog.jsx:152-160](../src/components/community/PostCreateDialog.jsx#L152) | תשובת מומחה ראשונה לפוסט חדש. **ללא `feature`, ללא `surface`.** |
| [aiAdvice.js:36-41](../src/lib/aiAdvice.js#L36) (`getVesselAdvice`) ← [VesselIssuesSection.jsx:87](../src/components/vehicle/VesselIssuesSection.jsx#L87) | "עצה" על תקלת כלי-שיט. **ללא `feature`, ללא `surface`.** |

שני אלה הם תשובות יועץ שמשתמש חינמי יכול להפעיל **בלי הגבלה**, ומכסה שמסתמכת על `surface IN ('chat_assistant','community_reply')` לא תראה אותן. זו תקלה מוכרת בקוד הזה, [supabase-ai-surface-maintenance.sql:5](../supabase-ai-surface-maintenance.sql#L5) מתעד מקרה קודם זהה.

#### ⚠️ הסניטציה בשרת שקטה: ולכן ניתנת לניצול מ-DevTools

השרת ממפה כל `feature`/`surface` לא-מוכר ל-**`NULL`** במקום לדחות (:173-174, :600-603, :822-825). כלומר לקוח שישלח `surface: 'x'` **ייענה** ויירשם כ-NULL.

**המשמעות לאכיפה:** מכסה שבודקת "האם ה-surface הוא צ'אט" תיעקף ע"י שליחת surface שרירותי. לכן:

> **הכלל: `NULL` או surface לא-מוכר נחשבים צ'אט (deny-by-default).** הרשימה הלבנה היא של ה-surfaces ש**פטורים** מהמכסה (הסריקות), לא של אלה שכלולים בה. זו ההיפוך שהופך את הפרצה לבלתי-ניתנת-לניצול, וגם מכסה אוטומטית את שני הנתיבים הלא-מתויגים למעלה.

ה-surfaces הפטורים (8 סריקות + `plate_scan`): `vehicle_scan`, `vessel_scan`, `vehicle_inline_scan`, `driver_license_scan`, `expense_personal_scan`, `expense_business_scan`, `document_scan`, `maintenance_log_scan`, `plate_scan`. שאר הכל, מכסת יועץ.

**הערה:** `plate_scan` הוא ה-OCR שמזין את בדיקת הרכב (מכסה 2). חנק שלו יעניש פעמיים.

#### הלוגיקה

```
1. surface := body.surface
2. אם surface ∈ EXEMPT_SCAN_SURFACES → המשך ללא בדיקה
3. account_id := resolve(user.id)          -- כולל טיפול במרובה-חשבונות
4. plan := account_plan(account_id)
5. אם plan.ai_lifetime_teaser ≠ null (חינמי):
     used := counter('ai_advisor', 'lifetime')
     אם used >= teaser → 402 'ai_requires_paid_plan'
6. אחרת אם plan.ai_daily_cap ≠ null (fair-use):
     used := counter('ai_advisor', today_israel)
     אם used >= cap → 429 'ai_daily_cap_reached'
7. הרץ. בהצלחה, increment (חסין לדגל).
```

**402 מול 429 במכוון:** 402 = "צריך לשדרג" → פיי-וול. 429 = "חזור מחר" → לא פיי-וול. הקופי הקיים ל-429 ([AiAssistant.jsx:709](../src/pages/AiAssistant.jsx#L709), [aiProxy.js:161-165](../src/lib/aiProxy.js#L161)) אומר "נסה שוב בעוד דקה", **שגוי לחסימת מסלול**, ולכן חובה קוד שגיאה נפרד.

**`rate_limit_check` לא ניתן למחזור:** הוא חלון מתגלגל של דקה קבועה ([supabase-security-hardening.sql:279-307](../supabase-security-hardening.sql#L279)) ואינו יכול לבטא "טיזר לכל החיים" או "N בחודש". נדרשת פונקציה חדשה. שים לב שהוא בונה מפתח עם `auth.uid()` שהוא NULL תחת service-role, הבידוד מגיע **רק** מה-`user.id` שנתפר ל-`kind`. לשחזר את התבנית.

#### ⚠️ נתיב שעוקף את ה-edge function לגמרי

[aiProxy.js:205-223](../src/lib/aiProxy.js#L205) (`callClaudeDev`) ו-:294-301 קוראים ל-Anthropic **ישירות מהדפדפן** עם `VITE_ANTHROPIC_API_KEY`, מגודר ב-`import.meta.env.PROD`. אם הגידור עובד, מת בייצור. **אבל יש תקדים מתועד בפרויקט** ([vehicleLookup.js:110-120](../src/services/vehicleLookup.js#L110)) שבו החלפת env של Vite **לא** התנהגה כמצופה ב-Vercel וענף מגודר-DEV **רץ בייצור**. חובה לאמת ב-`dist/` הבנוי.

**אורחים:** `AiAssistant` מסומן `guestAllowed: true` ([Layout.jsx:144](../src/Layout.jsx#L144)). צריך להכריע מה המכסה לאורח, אין לו חשבון לחייב.

---

### 3.2 בדיקת רכב: 3 בחודש ⚠️ הממצא שמשנה scope

> **ה-lookup הוא fetch ישיר מהדפדפן ל-`data.gov.il`. אין edge function, אין RPC, אין שום עצירה בשרת.**
> [vehicleLookup.js:121-129](../src/services/vehicleLookup.js#L121), `DATA_GOV_DIRECT`, וה-`API_BASE` נבחר לפי hostname בזמן טעינת המודול: localhost → proxy של Vite; **כל השאר (Vercel prod, Capacitor נייטיב) → `data.gov.il` ישירות**. ה-fetch היחיד ב-:1175.

**לכן אי-אפשר לאכוף מכסה על נתיב הנתונים.** שתי אפשרויות:

| | גישה | יתרון | חיסרון |
|---|---|---|---|
| **א** | **שער pre-flight**: RPC שמעלה מונה אטומית ומחזיר allow/deny, נקרא **לפני** `lookupVehicleByPlate` | זול, שבוע עבודה, ללא שינוי ארכיטקטורה | נעקף מה-console. **אבל** הוא מגדר את **משטח המוצר** (דוח ה-UI), וזה מה שנמכר. נתוני הלוחית ציבוריים בכל מקרה. |
| **ב** | **להעביר את ה-lookup מאחורי edge function** | אכיפה אמיתית | תוספת scope משמעותית; 18 ה-resource-IDs צריכים לעבור (יש תקדים, הם כבר משוכפלים ב-`gov-sync-vehicles:136`) |

**ההמלצה: (א) בגרסה הזו.** מה שנמכר הוא הדוח המעוצב, לא ה-JSON הגולמי; מי שמסוגל לקרוא ל-`data.gov.il` מה-console לא היה משלם בכל מקרה. (ב) נכון כשהמוצר יבשיל.

#### הנתיבים: מה נספר ומה לא

**נספר (משטח "בדוק מספר"):** [VehicleCheck.jsx:177](../src/pages/VehicleCheck.jsx#L177), הפיצ'ר הקנוני. ה-hero בדשבורד ([Dashboard.jsx:920-929](../src/pages/Dashboard.jsx#L920)) **אינו** lookup שני, הוא כותב ל-sessionStorage ומנווט, ומתנקז לאותה שורה.

**⚠️ שלושה נתיבים שהם דה-פקטו "בדוק כל מספר בחינם":**

| נתיב | הבעיה |
|---|---|
| [AddVehicle.jsx:775](../src/pages/AddVehicle.jsx#L775), כפתור "חפש מספר" | **הפרצה הגדולה ביותר במכסה 2.** lookup מפורש ביוזמת משתמש שמחזיר את המפרט המלא וממלא את הטופס. אם לא נספר, משתמש חינמי מקבל **קריאות מפרט מלא ללא הגבלה** פשוט בפתיחת `/AddVehicle` וחיפוש, בלי לשמור. **חייב להיספר.** |
| [AddAccident.jsx:264](../src/pages/AddAccident.jsx#L264) | lookup של לוחית **צד שלישי** עם מילוי שדות. מתנהג כמו "בדוק כל רכב בחינם". **חייב להיספר או להיות מוגבל.** |
| [BulkAddVehicles.jsx:52](../src/pages/BulkAddVehicles.jsx#L52) | **N lookups פר-ייבוא, ללא חסם.** concurrency 3, retry×3. קציר מפרט בכמות. חייב להיות מוכרע במפורש, בפנים או בחוץ. |

**לא נספר (אוטומטי, לא ביוזמת המשתמש):** `gov-sync-vehicles`, `check-test-renewals`, `dispatch-recall-alerts`; העשרה אוטומטית ב-[VehicleDetail.jsx:545](../src/pages/VehicleDetail.jsx#L545) (רץ בדפדפן בפתיחת עמוד, guard ב-localStorage בלבד ולכן חוזר במכשיר חדש); recalls; היתר נכה. וכן `AddVehicle.jsx:878` (העשרה בשמירה), מי שכבר חיפש לא ייחויב פעמיים.

#### הכרעות נדרשות

- **ה-cache של 10 דק'** ([vehicleQuickCheck.js:12](../src/services/vehicleQuickCheck.js#L12)) הוא `Map` ברמת-מודול, **מת ברענון, לא משותף בין טאבים.** שער **לפני** ה-cache = חיוב על cache hits; **אחרי** = צפייה חוזרת חינם ב-10 דק'. ההמלצה: אחרי (נדיב, ומונע תלונות על "שילמתי פעמיים על אותו רכב").
- **צפייה חוזרת בתוצאה שמורה** ([VehicleCheck.jsx:111-116](../src/pages/VehicleCheck.jsx#L111)), אינה fetch. ההמלצה: חינם. תוצאה שכבר שולמה נשארת נגישה.
- **`/vehicle-check` הוא עמוד ציבורי** ([Layout.jsx:847](../src/Layout.jsx#L847), `guestAllowed: true`). למכסה חודשית פר-חשבון **אין חשבון לחייב** לתנועה אנונימית. הטיזר הקיים ב-`sessionStorage` ([vehicleQuickCheck.js:265-277](../src/services/vehicleQuickCheck.js#L265)) נשאר לאנונימיים בלבד, הוא **אינו** מכסה.

---

### 3.3 שיתופים: 2 בחשבון

נתיב יצירה **אחד** מהלקוח: RPC `share_vehicle_with_email` ([ShareVehicleDialog.jsx:123](../src/components/sharing/ShareVehicleDialog.jsx#L123)). אין נתיב bulk. אין policy של INSERT ב-RLS **במכוון**: כל הכתיבות דרך RPCs שכולם `SECURITY DEFINER`. **לכן trigger הוא האכיפה היחידה שלא ניתן לנתב סביבה.**

#### 🔴 חוסם: לא ידוע איזו גרסה של ה-RPC חיה

`share_vehicle_with_email` עובר `CREATE OR REPLACE` **ארבע פעמים** בריפו, והחדשה ביותר מפנה לעמודות **שאף מיגרציה לא יוצרת**:

[supabase-vehicle-share-role-edit.sql:129-261](../supabase-vehicle-share-role-edit.sql#L129) משתמש ב-`invitee_email`, `account_id`, `updated_at`, **שלושתן אינן קיימות** על `vehicle_shares`. אין שום `ADD COLUMN` בריפו.

שני סימנים שהיא **לא** מותקנת: (1) [ShareVehicleDialog.jsx:65-73](../src/components/sharing/ShareVehicleDialog.jsx#L65) מטפל בקודי v3 ולא בקודי v4 (`max_shares_per_vehicle`, `cannot_share_with_self`); (2) `update_vehicle_share_role` באותו קובץ כותב `updated_at`, ו-`VehicleAccessModal.jsx:128` קורא לו, אם v4 הותקן, **עריכת תפקיד הייתה זורקת שגיאה כבר עכשיו**.

> **אם v4 כן חי, השיתוף שבור בייצור ברגע זה.** חובה לאמת מול ה-DB (`pg_get_functiondef`, `\d public.vehicle_shares`) לפני כתיבת ה-cap. זו הסכנה הגדולה ביותר במכסה 3.

#### עיצוב ה-cap

**ב-trigger, לא בגוף ה-RPC**: בדיוק כי יש 4 גופי RPC מתחרים. מתווסף ל-`enforce_vehicle_share_cap()` הקיים ([supabase-vehicle-shares.sql:79-104](../supabase-vehicle-shares.sql#L79), 3 נמענים פר-רכב). **שני ה-caps חיים במקביל.**

- **מהו "החשבון"?** ל-`vehicle_shares` **אין `account_id`**. יש לגזור דרך `vehicle_id → vehicles.account_id`. **לא** דרך `owner_user_id`, השניים נפרדים כשמשתמש חבר בכמה חשבונות, והאפיון (§6.1) קובע שנושא המסלול הוא ה-**account**.
- **מנעול משלו:** המנעול הקיים ([hardening.sql:118](../supabase-vehicle-shares-hardening.sql#L118)) הוא `pg_advisory_xact_lock` על `vehicle_id`, **לא** יסדר שני שיתופים של **רכבים שונים** באותו חשבון. נדרש מנעול על ה-`account_id`.
- **אינדקס:** אין `(owner_user_id, status)` ואין `account_id`. שאילתת ה-cap תצטרך אינדקס חדש.
- **אילו סטטוסים נספרים?** ה-trigger הקיים סופר `accepted` בלבד; v4 סופר `pending`+`accepted`.
  - `accepted` בלבד ⇒ משתמש חינמי מחזיק **הזמנות pending ללא הגבלה**, וה-cap נושך רק ברגע האישור, שהוא פעולה של **משתמש אחר**. חוויה גרועה.
  - **ההמלצה: `pending` + `accepted`.** ה-cap נושך בזמן ההזמנה, כשהמזמין נוכח ויכול לשדרג.
  - **סיבוך:** `revoked` מאחד שלושה דברים שונים, ביטול ע"י הבעלים (:507), יציאה של המקבל (:561), **ודחייה** (:459). אין ערך `declined` נפרד. לכן "האם השיתוף הזה תפס מקום?" **אינו נענה מ-`status` לבד**. הכרעה: `revoked`/`expired` **משחררים** מקום (נדיב, ופשוט למימוש).
- הודעת שגיאה **נפרדת** מזו של ה-cap הקיים: "3 נמענים לרכב" מול "2 רכבים משותפים במסלול החינמי".

---

## 3.4 ארכיטקטורת הצד-לקוח

### א. שער התשלום: מודול אחד, לא `isIOS` מפוזר

הכלי הקיים: [src/lib/capacitor.js:17-21](../src/lib/capacitor.js#L17) מייצא קונסטנטות ברמת-מודול, `isNative`, `isIOS`, `isAndroid`, `isWeb`. **קונסטנטות, לא hooks**: בטוח להשתמש בהן ב-early-return לפני hooks אחרים.

**הפרדיקט הנכון ל-Apple הוא `isIOS`, לא `isNative`:**
```js
// iOS נייטיב → טקסט אינפורמטיבי בלבד (anti-steering)
// Android נייטיב + web/PWA → כפתור checkout מותר
```
`isIOS` נכון **רק** ל-build הנייטיב של iOS. Safari באייפון מדווח `'web'`, כלומר **משתמשי PWA באייפון כן מקבלים כפתור**, וזה נכון (§5.2 באפיון: "הדפדפן אינו כפוף לחוקי Apple").

**תבנית לחזור עליה, TripGuard.** [src/lib/tripGuard/index.js:15-24](../src/lib/tripGuard/index.js#L15) לא מפזר `isIOS` באתר הקריאה, אלא עוטף אותו בפרדיקט סמנטי בעל-שם:
```js
export function isTripGuardSupported() { return !isIOS; }
```
ואז early-return עם כרטיס הסבר ידידותי ([SafetyReminder.jsx:237-251](../src/pages/SafetyReminder.jsx#L237)).

**לכן:** מודול חדש `src/lib/billingGate.js` עם `canShowCheckout()` (= `!isIOS`). כלל Apple חי ב**מקום אחד ניתן לביקורת**, ולא ב-4 פופ-אפים. ה-AC של האפיון בודק בדיוק את זה.

### ב. הפופ-אפים: להעתיק את שער סריקת-ה-AI

[src/lib/aiScanGate.js](../src/lib/aiScanGate.js) הוא **האנלוג הקרוב ביותר לפיי-וול** שקיים בפרויקט, וכדאי למדל עליו את כל המנגנון:
- **pub-sub** (`onAiScanDisabled` / `emitAiScanDisabled`), כל דחייה בכל מקום מרימה **מודאל גלובלי אחד**.
- **דיאלוג סינגלטון** מותקן פעם אחת ב-[Layout.jsx:977](../src/Layout.jsx#L977) בתוך `<SafeComponent>`.
- **throttle של פעם-בסשן** דרך `sessionStorage`.
- **כותרת הקובץ מונה את כל המשטחים המגודרים**: לעשות אותו דבר לנתיבי ההוספה.
- **חסימה מקדימה:** האריח עצמו מוצג `cursor-not-allowed` עם תג "כרגע לא זמין" **וכתובית שמציעה חלופה** ([AddVehicle.jsx:1619-1648](../src/pages/AddVehicle.jsx#L1619)), לא נותנים למשתמש להיכנס למבוי סתום.

> **התובנה החשובה מה-docblock שלו:** אין בו כפתור "נסה שוב", והנימוק המתועד הוא שהדגל נשלט ע"י אדמין ולכן retry פר-משתמש **היה מטעה**. זה חל ישירות על הפיי-וול ב-iOS: **אסור להציע פעולה שאי-אפשר לקיים.**

`Dialog` הוא הקונבנציה (47 קבצים; `Drawer` כמעט לא בשימוש). ה-className הבטוח למובייל יציב בין הפופ-אפים:
```
max-w-sm w-[calc(100vw-32px)] max-h-[90vh] p-0 overflow-y-auto overflow-x-hidden rounded-3xl border-0
```
כשההירו נושא את הכותרת החזותית, לשמור `DialogTitle` אמיתי בתוך `<VisuallyHidden.Root>` (a11y).

**צבעים:** תמיד מ-`C` ב-[src/lib/designTokens.js](../src/lib/designTokens.js), יש כלל eslint שאוסר hex/rgb inline. משפחת `warn*` = "נדרשת פעולה, לא שגיאה", הטון הנכון לפיי-וול.

**לבדוק לפני בנייה:** קיים מנוע פופ-אפים מנוהל-אדמין (`src/lib/popups/frequencyGate.js`, `PopupEngine`/`PopupQueue`). אם באנר תקופת החסד צריך תזמון או frequency-capping, ייתכן שזה כבר פתור שם, ואין לגלגל `sessionStorage` ביד.

### ג. `<Empty>` הוא **לא** קומפוננטה משותפת: תיקון להנחת האפיון

האפיון (§13) מתייחס ל-`<Empty>` כתבנית לייבוא. בפועל זה helper מקומי בן ~10 שורות **המשוכפל ב-23 קבצים** (למשל [BulkAddVehicles.jsx:1420](../src/pages/BulkAddVehicles.jsx#L1420)). אין מה לייבא, מעתיקים.

קיימות שתי חלופות משותפות בתת-אימוץ: `src/design/primitives/EmptyState.jsx` (חדשה, מבוססת tokens) ו-`src/components/shared/EmptyState.jsx` (מדור קודם). **החלטה:** להשתמש ב-`design/primitives/EmptyState.jsx` בקוד החדש ולא להוסיף שכפול 24.

**נוסחת הקופי הקיימת:** `title` = מה מגודר + תנאי הפתיחה; `text` = הפעולה הבאה. ב-iOS ה-`text` מוסר את הפעולה ומשאיר את העובדה בלבד.

### ד. מיפוי שגיאת ה-trigger לעברית ידידותית

השגיאה תגיע כ-exception מ-Postgres. התבנית הקיימת למיפוי קודי-שרת לעברית, עם `action` נפרד לכל ענף, [BulkAddVehicles.jsx:458-460](../src/pages/BulkAddVehicles.jsx#L458):
```js
if (msg.includes('forbidden_not_manager')) toastError('אין לך הרשאת מנהל', { action: '...', err });
```
כאן מתווסף ענף `vehicle_plan_cap_exceeded`, ובו **מרימים את הפופ-אפ במקום toast**. `toastError` מ-[src/lib/userErrorReport.js:39](../src/lib/userErrorReport.js#L39) גם רושם ל-`app_errors`.

### ה. ⚠️ שאילתת המסלול: כשל טעינה אסור שייראה כמו מכסה מנוצלת

התבנית להעתקה: [src/pages/Drivers.jsx:77-88](../src/pages/Drivers.jsx#L77) (query) + [338-355](../src/pages/Drivers.jsx#L338) (רינדור). היא מרכיבה שתי שאילתות, בדיוק מה שמסך "המסלול שלי" צריך (שורת מנוי + ספירת רכבים).

הסדר קריטי: **`isLoading` → `isError` → ריק → תוכן.** ה-`isError` **לפני** המצב הריק, עם `<SystemErrorBanner onRetry={refetch} />`.

> **הכשל המסוכן:** שאילתת מכסה שנכשלה ורונדרה כ-"0 מתוך 10 בשימוש" נראית כמו מכסה **פנויה**. בפיי-וול זו פרצה, לא רק באג תצוגה. כשל טעינה = באנר שגיאה, לעולם לא מספר.

`withTimeout` חובה עם label ייחודי (למשל `'account_subscription'`), שער ה-Query Timeout חוסם push אחרת.

### ו. ⚠️ עקיפת האדמין היא client-side בלבד: באג ממתין

[featureFlags.js:174-181](../src/lib/featureFlags.js#L174) מממש `admin === true || flag === true`. זו עקיפת **נראות** בלקוח. **היא לא תעקוף את ה-trigger ב-SQL.**

בלי תיקון, אדמין יראה UI פתוח ואז יקבל שגיאת Postgres גולמית. **חובה עקיפת אדמין מקבילה ב-SQL**: קריאה ל-`public.is_admin()` (שהוא `SECURITY DEFINER`) בתוך פונקציות ה-trigger, לפני בדיקת התקרה.

**נגד-שיקול:** עקיפה שקטה לאדמין מסתירה את ההתנהגות האמיתית בבדיקות. ההמלצה: האדמין עובר, אבל הפעולה נרשמת ל-audit, כדי שבדיקת QA על חשבון אדמין לא תיראה בטעות כמו "התקרה לא עובדת".

### ז. footgun: `enabled === null`

`useFeatureFlag` הוא **תלת-מצבי**. `if (enabled)` מקפל `null` ל-"הסתר" (נכון ל-first paint); `if (enabled === false)` מציג את האלמנט בהבהוב הטעינה. לפיי-וול, לבחור במודע, וברירת המחדל היא **fail-closed** (`defaultOnError: false`).

---

## 3.45 שלושה מסלולי חיוב, הרשאה אחת

**נובע מ-[spec ח-5](spec-monetization-plans-v2.md):** אפל דורשת IAP, ולכן יש שלושה מקורות חיוב שכולם צריכים להתנקז לאותה שורת הרשאה.

### 3.45.1 מקור אמת אחד

```
Apple IAP ──┐
Web PSP ────┼──→ account_subscriptions (שורה אחת פר-חשבון)
Admin grant ┘         source = 'apple_iap' | 'web_checkout' | 'admin_grant'
```

**ההרשאה חיה אצלנו, לא אצל אפל.** זו לא בחירה ארכיטקטונית אלא **הדרישה של 3.1.3(b)**: מי שקנה ב-iOS חייב לקבל גישה גם בדפדפן ובאנדרואיד. אם ההרשאה תישמר רק ב-StoreKit, הגישה החוצה-פלטפורמית לא תעבוד וגם החריג לא יסופק.

### 3.45.2 ⚠️ קישור עסקת אפל לחשבון: `appAccountToken`

הבעיה: קנייה ב-StoreKit מזוהה מול **Apple ID**, וההרשאה שלנו מול **`account_id`**. אם לא נקשר אותם, לא נדע למי לתת גישה.

**הפתרון:** להעביר `appAccountToken` (UUID) בעת הרכישה, שממופה ל-`account_id` שלנו. זה השדה היחיד שאפל מחזירה בהתראות השרת ומאפשר קישור אמין.

⚠️ **מקרה קצה אמיתי:** אותו Apple ID קונה, ואחר כך המשתמש מתחבר לחשבון אחר באפליקציה. או שני חשבונות שלנו על אותו Apple ID. צריך להחליט: הרשאה אחת פר-Apple-ID, והתנגשות נדחית עם הסבר.

### 3.45.3 התראות שרת של אפל: App Store Server Notifications V2

זה **webhook נוסף** מלבד זה של ספק הסליקה, עם מודל אירועים שונה לגמרי (`SUBSCRIBED`, `DID_RENEW`, `DID_FAIL_TO_RENEW`, `EXPIRED`, `REFUND`, `GRACE_PERIOD_EXPIRED`).

- **אימות חתימה**: JWS, לא HMAC כמו רוב ה-PSPs. תשתית שונה.
- **`REFUND`**: אפל מחזירה כסף בלי לשאול אותנו. חייבים לכבד ולשלול הרשאה.
- **תקופת חסד של אפל**: לאפל יש מנגנון grace משלה לכשל חיוב, **בנוסף** לחסד שלנו. שני מנגנוני חסד על אותה שורה = בלבול. להחליט מי גובר.

### 3.45.4 מה מסתעף לפי `source`

| | `web_checkout` | `apple_iap` | `admin_grant` |
|---|---|---|---|
| ביטול חיוב | אנחנו, 3 ימי עסקים | **אפל בלבד** | אין |
| החזר | אנחנו, פרו-רטה | אפל | |
| חשבונית מס | **אנחנו מפיקים** | **אפל היא merchant of record** | |
| dunning | אנחנו | אפל | |
| מסך `/MyPlan` | "בטל מנוי" | "נהל באפל" + הסבר | "מוענק ע"י מנהל" |

> ⚠️ **החשבוניות מסתעפות.** ב-IAP אפל היא ה-merchant of record ומטפלת במע"מ, **אנחנו לא מפיקים חשבונית מס על מנוי IAP**, ואם נפיק ניצור כפל דיווח. 🔴 לאמת מול רואה החשבון: איך רושמים הכנסה מ-IAP בספרים הישראליים.

### 3.45.5 מה זה עושה ללוח הזמנים

IAP הוא **שלב נפרד ומשמעותי**, לא תוספת ל-checkout:

- StoreKit 2 דרך Capacitor, צריך plugin, `cap sync ios`, ובנייה נייטיבית
- מוצרים מוגדרים ב-App Store Connect (מדרגות מחיר, לא ₪9 חופשי)
- אימות קבלות בשרת + webhook V2 + אימות JWS
- **בנייה נייטיבית של iOS חובה**: וזה ממילא חוב פתוח בפרויקט (iOS על 5.6.4)

---

## 3.5 ניהול מסלולים בצד האדמין

**זה לא פיצ'ר "נחמד שיהיה", זה מסלול המכירה של שלבים 1–5**, לפני שיש סליקה בכלל. וגם המנגנון שמספק את **חשבון הבודק לחנויות** (§3.5.6).

### 3.5.1 שתי דרישות שונות שאסור לבלבל

| | "תן לו מסלול בתשלום בחינם" | "תן לו תעריף אחר" |
|---|---|---|
| מה זה | חשבון מקבל מסלול קיים (למשל ₪49) **בלי לשלם** | חשבון מקבל **מגבלות מותאמות** שלא קיימות באף מסלול (למשל 15 רכבים) |
| מימוש | `plan='p49'`, `source='admin_grant'`, ללא `current_period_end` | **override פר-מגבלה** על שורת המנוי |

### 3.5.2 ⚠️ לא ליצור "מסלולים מותאמים" ב-`plan_limits`

הפיתוי הוא להוסיף שורה `custom_naftaly` ל-`plan_limits`. **אסור:**
- דף המסלולים באתר נבנה מאותה טבלה, כל דיל מיוחד היה מופיע כמסלול פומבי.
- מספר השורות גדל בלי חסם, ואי-אפשר לענות על "מה המסלולים שלנו?".

**במקום זה, עמודות override על `account_subscriptions`:**

```sql
alter table public.account_subscriptions
  add column if not exists ovr_max_vehicles           int,
  add column if not exists ovr_ai_daily_cap           int,
  add column if not exists ovr_ai_lifetime_teaser     int,
  add column if not exists ovr_plate_checks_per_month int,
  add column if not exists ovr_max_shares             int,
  add column if not exists ovr_business_ui            boolean,
  add column if not exists ovr_note                   text,        -- למה. חובה.
  add column if not exists ovr_expires_at             timestamptz, -- NULL = לתמיד
  add column if not exists reverts_to_plan            text references public.plan_limits(plan),
  add column if not exists granted_by                 uuid,
  add column if not exists granted_at                 timestamptz;
```

ולהוסיף `is_public boolean not null default true` ל-`plan_limits`, דף המסלולים מסנן עליו.

### 3.5.3 ⚠️ מלכודת ה-`NULL`: סנטינל חובה

ב-`plan_limits` המשמעות של `NULL` היא **"ללא הגבלה"**. ב-עמודות ה-override המשמעות היא **"תורש מהמסלול"**. אותו ערך, שתי משמעויות הפוכות, ולכן `COALESCE` לבדו **לא יכול לבטא "עקוף לבלתי-מוגבל"**.

**ההכרעה: `-1` = ללא הגבלה** בעמודות ה-override.

```sql
alter table public.account_subscriptions
  add constraint ovr_sane check (
    coalesce(ovr_max_vehicles,0) >= -1 and
    coalesce(ovr_ai_daily_cap,0) >= -1 and
    coalesce(ovr_plate_checks_per_month,0) >= -1 and
    coalesce(ovr_max_shares,0) >= -1
  );
```

הפונקציה `account_plan()` מתרגמת `-1` → `NULL` לפני שהיא מחזירה, כך ששאר הקוד ממשיך לראות רק את הקונבנציה האחת ("NULL = ללא הגבלה"). **התרגום קורה במקום אחד בלבד.**

### 3.5.4 תפוגה מוערכת בזמן קריאה, לא ב-cron

מענק ל-3 חודשים חייב להיפסק בזמן. שתי דרכים: cron שסורק, או הערכה בזמן קריאה.

**ההכרעה: בזמן קריאה, בתוך `account_plan()`.**
- אין תלות ב-cron שיכול ליפול (ויש תקדים בפרויקט, התזכורות היו מושבתות ~98% מהזמן בגלל כשל שקט).
- אין חלון שבו המענק חי אחרי התאריך.
- **fail-closed מעצם הבנייה:** אם המענק פג, ה-override פשוט לא נלקח בחשבון.

```
אם ovr_expires_at אינו null ו-ovr_expires_at <= now():
    להתעלם מכל ה-overrides
    אם source = 'admin_grant' → המסלול האפקטיבי הוא coalesce(reverts_to_plan, 'free')
```

### 3.5.5 ה-RPCs: כולם על התבנית הקיימת

התבנית להעתקה: `admin_set_role` ([supabase-admin-audit-log.sql:207](../supabase-admin-audit-log.sql#L207)), `SECURITY DEFINER`, `SET search_path = public`, `is_admin()` בשורה הראשונה, ו-`admin_log()` בסוף.

| RPC | תפקיד |
|---|---|
| `admin_set_account_plan(account, plan, source, note, expires_at, reverts_to)` | הענקה / שינוי מסלול |
| `admin_set_account_overrides(account, overrides jsonb, note, expires_at)` | תעריף מותאם |
| `admin_clear_account_overrides(account, note)` | חזרה למסלול הרגיל |
| `admin_extend_grace(account, until, note)` | הארכת חסד |
| `admin_revoke_plan(account, note)` | חזרה ל-`free` |
| `admin_list_plan_exceptions(filter, cursor)` | **מסך החריגים** (§3.5.7) |

**כלל קשיח: `ovr_note` הוא חובה בכל פעולה.** מענק בלי סיבה כתובה הוא מענק שאף אחד לא יוכל להצדיק בעוד שנה. ה-RPC דוחה מחרוזת ריקה.

**אבטחה:**
- `is_admin()` **בשרת**. עקיפת האדמין ב-`featureFlags.js` היא client-side ואינה תחליף (§3.4.ו).
- `admin_log()` על **כל** פעולה, `target_type='account'`, ו-`detail` עם המסלול הקודם והחדש. פעולות כספיות חייבות שובל ביקורת, וה-`admin_audit_log` הוא append-only ולכן אי-אפשר לטשטש.
- הלקוח **לעולם** לא כותב ל-`account_subscriptions`, גם לא אדמין. הכל דרך RPC.

### 3.5.6 💡 חשבון הבודק לחנויות: נפתר ע"י אותו כלי

מחקר Play העלה דרישה קשיחה: חשבון בודק עם הרשאה מלאה, **בלי תפוגה, בלי 2FA, בלי הגבלת מדינה**, מוצהר ב-Play Console → App content → App access. הניסוח של גוגל: *"you may be blocked from releasing updates, or your app may be removed."*

זה בדיוק `admin_set_account_plan(plan='p49', source='admin_grant', expires_at=NULL, note='חשבון בודק חנויות, אין לבטל')`.

⚠️ **מסך החריגים חייב לסמן אותו כ"לעולם לא לבטל"**, אחרת מישהו ינקה חריגים ויחסום את עדכוני החנות בלי להבין למה.

### 3.5.7 ⭐ מסך החריגים: החלק החשוב ביותר ב-UI

הסיכון התפעולי האמיתי אינו בהענקה, אלא ב**שכחה**. מענק חינם שנשכח הוא הכנסה שנוזלת בשקט, בלי שום התראה.

לכן חובה מסך שמציג **כל חשבון שמצבו אינו סטנדרטי**: כל override, או `source='admin_grant'`:

| עמודה | למה |
|---|---|
| חשבון + סוג | זיהוי |
| מסלול אפקטיבי | מה הוא **באמת** מקבל |
| מה עוקף | "רכבים: 15 (במקום 10)" |
| הסיבה (`ovr_note`) | הצדקה |
| מי העניק ומתי | אחריות |
| תפוגה | **ממוין לפי זה**: הקרובים למעלה; "לתמיד" מסומן בנפרד |

זהו גם המסך שמנטרל את הסיכון "קוהורט >10 רכבים קטן ⇒ ₪19/₪49 ריקים": אם מחצית מהחשבונות בתשלום הם מענקים, ה-MRR האמיתי נראה אחרת.

### 3.5.8 איפה זה יושב ב-UI

- **פר-חשבון:** בתוך ה-drawer הקיים ([AdminUserDrawer.jsx](../src/components/admin/AdminUserDrawer.jsx)), שכבר מכיל `admin_update_vehicle` / `admin_delete_vehicle`. שם האדמין כבר נמצא כשהוא מטפל בלקוח.
- **רוחבי:** טאב אדמין חדש "מסלולים", מסך החריגים + סיכום תמהיל. מודל קיים להעתקה: [AdminBusinessRequests.jsx](../src/pages/AdminBusinessRequests.jsx), שהוא זרימת בקשה→אישור־אדמין.
- **תיעוד:** הפעולות מופיעות אוטומטית ב-[AdminAuditLog.jsx](../src/pages/AdminAuditLog.jsx) הקיים, בלי עבודה נוספת.

### 3.5.9 מקרי קצה

| מצב | התנהגות |
|---|---|
| אדמין מעניק ₪49 לחשבון שמשלם ₪9 בכרטיס | **לא לגעת בחיוב בשקט.** או לבטל אצל הספק, או להציג אזהרה שהוא ימשיך להיות מחויב |
| override מתחת לשימוש הנוכחי (15 רכבים למי שיש לו 22) | לא מוחקים כלום, נכנס ל"קריאה בלבד מעל התקרה" (§6.B באפיון) |
| המענק פג ולמשתמש 40 רכבים | חוזר ל-`reverts_to_plan`; הרכבים והתזכורות ממשיכים; אין הוספה |
| שני אדמינים עורכים במקביל | `for update` על שורת המנוי, כמו ב-trigger התקרה (§2.2) |
| מחיקת חשבון עם מענק | ה-cascade מוחק את השורה. אם היה חיוב אמיתי, §6.D באפיון חל |
| אדמין מעניק לחשבון של עצמו | מותר, אבל **נרשם ב-audit** כמו כל פעולה אחרת |

---

## 4. שלבי מסירה

**עקרון הסידור: מודדים → מציגים → סופרים → חוסמים → גובים.** התשלומים **אחרונים**, לא ראשונים.

| שלב | מה נכנס | נראה למשתמש? | סיכון |
|---|---|---|---|
| **0, מדידה** | הרצת `admin_vehicle_count_distribution()`. קביעת התקרות הסופיות. **צד Ofek, לא קוד.** | לא | אפס |
| **1, תשתית מסלול** | `plan_limits` + `account_subscriptions` + RLS + backfill כל החשבונות ל-`free` עם `grace_until`. **ללא אכיפה.** | לא | אפס |
| **2, תצוגה בלבד** | hook `useAccountPlan()`, מסך **`/MyPlan`** (שורה ב-hub ההגדרות, [spec §5.2](spec-monetization-plans-v2.md)), UI אדמין להענקה/הארכה/ביטול. **ללא אכיפה.** | כן, אינפורמטיבי | נמוך |
| **3, ספירה ללא חסימה** | `feature_usage_counters` + כתיבה בכל קריאת AI / בדיקה / שיתוף. אכיפה **כבויה** בדגל. **מדי הניצול ב-`/MyPlan` נדלקים כאן.** | לא (חוץ מהמדים) | נמוך |
| **3.5, מיילים** ⚠️ | 7 מיילי מחזור-החיים ([spec §5.7](spec-monetization-plans-v2.md)). **חוסם את שלב 4-5**: ב-iOS זה ערוץ ההמרה **היחיד**. | כן | בינוני |
| **4, אכיפת רכבים** | trigger ברמת-פקודה + בדיקה מקדימה ב-`bulk_add_vehicles` + הלקוח קורא `errors` + חסד + `claim_migrated_account`. | כן, חוסם | **גבוה** |
| **5, אכיפת מכסות** | AI + בדיקת רכב + שיתופים, עם 4 הפופ-אפים × 2 פלטפורמות (`billingGate.js`). | כן, חוסם | גבוה |
| **6, סליקה באתר** | דף מסלולים, checkout, webhook, חשבונית מס, dunning, שדרוג/הורדה/ביטול ([spec §5.5](spec-monetization-plans-v2.md)). **+ קישור ביטול בדף הבית** (חובת 14ט) **+ מוניטור "חויב אחרי ביטול"**. | כן | גבוה |
| **7, Apple IAP** | StoreKit 2 דרך Capacitor, מוצרים ב-App Store Connect, אימות קבלות, webhook V2 עם JWS, `appAccountToken`, **בנייה נייטיבית של iOS**. | כן (iOS) | **גבוה מאוד** |

### למה זה הסדר הנכון

**שלב 3 הוא ההגנה המשמעותית ביותר בתוכנית.** הוא נותן שבוע-שבועיים של נתונים אמיתיים על *כמה בדיקות רכב אנשים באמת עושים בחודש* ו*כמה שאלות AI*, **לפני** שמישהו נחסם. אם יתברר ש-3 בדיקות בחודש חוסמות 40% מהמשתמשים הפעילים, מגלים את זה מדוח, לא מגל תלונות.

**שלבים 1–5 מספקים ערך בלי שום אינטגרציית תשלומים.** אחרי שלב 5 יש מערכת מסלולים מלאה שבה **אדמין מעניק מסלול ידנית**: כלומר אפשר להתחיל למכור מיד, ולקבל תשלום ידנית (העברה/ביט) מהלקוחות הראשונים. זה מאמת שאנשים באמת משלמים **לפני** שבונים checkout ו-webhook. אם אף אחד לא משלם ידנית, נחסך כל שלב 6.

**שלב 4 לבד.** זה השינוי היחיד שיכול לשבור הוספת רכב, הפעולה המרכזית באפליקציה. לא מעורבב עם שום דבר אחר, כדי שאם משהו נשבר יהיה ברור מה.

**שלב 3.5 (מיילים) הוא חוסם ולא "Should have".** באפיון v1 המיילים היו בעדיפות שנייה. אבל מכיוון ש**ב-iOS אסור כפתור, קישור או כתובת אתר** לתשלום ([spec §5.4](spec-monetization-plans-v2.md)), המייל הוא **ערוץ ההמרה היחיד** למשתמשי iOS. חסימה בשלב 4-5 בלי מיילים עובדים = משתמש iOS שנחסם **ואין לו שום דרך לשלם**. זו לא חוויה גרועה, זו הכנסה אבודה.

**מדי הניצול נדלקים בשלב 3, לפני האכיפה.** משתמש שרואה "4 מתוך 5 כלי תחבורה" מבין את הגבול לפני שהוא נחסם. זה גם ממתן את שלב 4: כשהחסימה מגיעה, היא לא מפתיעה.

---

## 5. תוכנית QA (שער 4 של CLAUDE.md)

לכל שלב חוסם (4, 5, 6), הטבלה הזו חייבת להיות מכוסה במלואה:

| תרחיש | מה לבדוק |
|---|---|
| **משתמש קיים מתחת לתקרה** | אפס שינוי מורגש. הוספת רכב עובדת. |
| **משתמש קיים מעל התקרה** (production data) | לא נחסם עד תום החסד. **תזכורות ממשיכות לעבוד גם אחרי.** אין הוספה. |
| **משתמש חדש** | חשבון רענן מקבל `free` אוטומטית עם התקרה הנכונה. |
| **אורח (guest)** | תקרת האורח מול תקרת החינם; מיגרציה של אורח שמעל התקרה (ממומשת **פעמיים** בקוד). |
| **אדמין** | עובר את כל המגבלות. |
| **ייבוא מרובה** | 100 רכבים לחשבון עם תקרה 5 → נדחה **כשלמות**, לא חלקית. |
| **הוספות מקבילות** | שני טאבים מוסיפים בו-זמנית ב-count=4, תקרה 5 → בדיוק אחד מצליח. |
| **offline / רשת איטית** | המסלול מ-cache; **אין החלטת אכיפה בלקוח**; `isError` + "נסה שוב"; לעולם לא ספינר נצחי. |
| **RTL עברית** | 4 הפופ-אפים + דף המסלולים + המיילים, כולל מחירים ומספרים מעורבים. |
| **מובייל + Capacitor** | **iOS: אין שום כפתור/קישור לתשלום.** Android/PWA: checkout מלא. |
| **מסלול פג באמצע סשן** | ה-cache בלקוח לא נותן גישה אחרי שהשרת כבר חוסם. |
| **שדרוג** | המגבלה נפתחת ללא התקנה מחדש ובלי logout. |

---

## 6. מיגרציית DB ובטיחות (שער 5 של CLAUDE.md)

- **staging ו-prod חולקים DB** (נכון לאפריל 2026, CLAUDE.md). כל מיגרציה כאן משפיעה על משתמשי ייצור מיד. אין "לנסות על staging".
- כל שלב = קובץ `.sql` אחד, אידמפוטנטי (`create ... if not exists`, `create or replace`), עם בלוק rollback בהערה.
- **שלבים 1–3 הם additive בלבד**: טבלאות חדשות, אפס שינוי בטבלאות קיימות, אפס אכיפה. בטוחים להרצה בכל רגע.
- **שלב 4 הוא הראשון שמשנה התנהגות.** לפניו: backfill מלא + `grace_until` לכל חשבון שמעל התקרה, ואימות שהספירה נכונה, **לפני** שה-trigger נדלק.
- מפסק חירום: דגל ב-`app_config` שמנטרל את האכיפה בלי rollback של מיגרציה. **הדגל מנטרל אכיפה, לא ספירה**: וברירת המחדל שלו כשהוא חסר היא "אכיפה דלוקה" (fail-closed).
- כל query חדש ב-`useQuery` עטוף ב-`withTimeout`, שער ה-Query Timeout חוסם push אחרת.

---

## 6.5 ⚠️ צ'קליסט אימות מול ה-DB החי: לפני כתיבת קוד

**הריפו אינו מקור אמת לסכמה.** יש ~190 קבצי `supabase-*.sql` שטוחים, **אין `supabase/migrations/`** ואין שום ledger שמתעד מה הורץ. `staging-init-consolidated.sql` הוא שרשור בסדר לא-מתועד. **מצב ה-deploy אינו ניתן לקביעה מהריפו.**

לכן, לפני שכותבים שורת קוד, להריץ את השאילתות האלה על ה-DB החי. **צד Ofek.**

| # | מה לבדוק | למה זה חוסם | שאילתה |
|---|---|---|---|
| 1 | פילוח רכבים פר-חשבון | קובע תקרות, חסד, ותחזית תמהיל | `select * from admin_vehicle_count_distribution();` |
| 2 | **איזו גרסה של `share_vehicle_with_email` חיה** | v4 בריפו מפנה לעמודות שלא קיימות. **אם היא חיה, השיתוף שבור עכשיו** | `select pg_get_functiondef(oid) from pg_proc where proname='share_vehicle_with_email';` |
| 3 | העמודות האמיתיות של `vehicle_shares` | ה-cap פר-חשבון צריך לדעת אם יש `account_id` (לפי הריפו, אין) | `\d public.vehicle_shares` |
| 4 | הטריגרים האמיתיים על `vehicles` | סדר הפעלה אלפביתי; 4 מתוך 5 מתועדים רק בסקריפטים חד-פעמיים | `select tgname, tgtype from pg_trigger where tgrelid='public.vehicles'::regclass and not tgisinternal;` |
| 5 | האם `create_business_workspace` מוקשח | אם יצירה בשירות-עצמי פתוחה, **הממשק העסקי חינמי** | `select pg_get_functiondef(oid) from pg_proc where proname='create_business_workspace';` |
| 6 | תקרת מצב האורח בפועל | 20 מול 5, משפיע על קופי הפופ-אפ ועל המיגרציה | קוד + התנהגות |
| 7 | האם `callClaudeDev` נשלף מה-bundle | תקדים מתועד ש-Vite env **לא** התנהג כמצופה ב-Vercel | `grep -r "anthropic" dist/assets/*.js` |
| 8 | התנהגות snapshot בהוספה מרובת-שורות | קובע אם צריך גם בדיקה ברמת-פקודה (התכנון נכון בשני המקרים) | חשבון בדיקה: 4 רכבים, תקרה 5, `insert ... generate_series(1,10)` |

**1, 2 ו-5 הם חוסמים אמיתיים.** 2 עלול לחשוף באג ייצור פעיל שאינו קשור למונטיזציה בכלל.

---

## 7. סיכונים

| סיכון | חומרה | הפחתה |
|---|---|---|
| **`bulk_add_vehicles` בולע את שגיאת התקרה**: ייבוא נכשל בשקט, ללא פיי-וול (§2.2) | **קריטי** | בדיקה מקדימה בגוף ה-RPC + הלקוח קורא `errors` + trigger כרשת ביטחון |
| **סניטציה שקטה של `surface` ⇒ עקיפת מכסת AI מ-DevTools** (§3.1) | **קריטי** | היפוך לרשימה לבנה של **פטורים**; NULL = צ'אט (deny-by-default) |
| **שני נתיבי יועץ ללא תיוג** (§3.1) | **קריטי** | מכוסים אוטומטית ע"י ההיפוך למעלה |
| **`share_vehicle_with_email` v4 מפנה לעמודות שלא קיימות**: ייתכן שהשיתוף שבור **עכשיו** (§3.3) | **קריטי** | אימות DB #2, לפני כל עבודה על מכסה 3 |
| 💰 **מחיקת חשבון לא תבטל את המנוי אצל הספק**: ה-`on delete cascade` מוחק את השורה המקומית בשקט, החיוב ממשיך | **קריטי** | `delete_my_account` חייב לבטל אצל הספק; AC מפורש |
| 💰 **העברת בעלות משאירה את הבעלים הקודם כמשלם**: המסלול הולך עם החשבון, אמצעי התשלום לא | **קריטי** | קביעת משלם מחדש בזרימת ההעברה; אישור שמציג זאת |
| **הבאנר/מדים לא מתעדכנים אחרי מחיקת רכב**: משתמש שפינה מקום ממשיך לראות "חסום" | **גבוה** | `invalidate` בכל מחיקה; AC מפורש (§6.B באפיון) |
| **משתמשי Apple relay לא מקבלים מייל**: וב-iOS המייל הוא ערוץ ההמרה היחיד | **גבוה** | חור מוכר; לא נפתר בעוד מייל, לשקול מסלול חלופי |
| trigger fail-open בטעות (§2.3) | **קריטי** | ללא `exception when others`; בדיקה שמפילה את הבדיקה בכוונה ומאמתת חסימה |
| `create_business_workspace` פתוח בשירות-עצמי | **קריטי** | אימות DB #5 לפני שלב 5, אחרת הממשק העסקי חינמי |
| **חיפוש לוחית ב-`AddVehicle` = מפרט מלא חינם ללא הגבלה** (§3.2) | **גבוה** | חייב להיספר במכסה |
| `claim_migrated_account`, מעל התקרה ללא INSERT (§2.3) | גבוה | חסד אוטומטי בתוך ה-RPC |
| עקיפת אדמין קיימת בלקוח בלבד ⇒ שגיאת Postgres גולמית לאדמין (§3.4.ו) | גבוה | `is_admin()` גם ב-SQL, + audit |
| **כלכלת ₪9: 5.6%–23% עמלה מעל מע"מ 18%** (§7.5) | גבוה | ₪9 שנתי-בלבד, או ₪12–15 חודשי; ספק עם רצפה ולא תוספת |
| עלות AI ללא תקרה ב-₪9 | גבוה | fair-use cap (ח-3 באפיון) |
| דחייה בחנות על anti-steering | גבוה | `billingGate.js` יחיד; פופ-אפים ללא CTA ב-iOS; בדיקת copy לפני הגשה |
| נטישה בתום החסד | גבוה | חסד 60 יום; התראות מקדימות; תזכורות לעולם לא נכבות |
| **אין `supabase/migrations/`, מצב ה-deploy לא ידוע** | גבוה | צ'קליסט §6.5 לפני קוד |
| `callClaudeDev` עוקף את ה-edge function; יש תקדים ש-DEV-guard רץ בייצור | בינוני | אימות DB #7 ב-`dist/` |
| בדיקת רכב היא fetch ישיר מהדפדפן ⇒ אין צוואר-בקבוק שרת (§3.2) | בינוני | שער pre-flight (גישה א); מגדר את משטח המוצר |
| קוהורט >10 רכבים קטן ⇒ ₪19/₪49 כמעט ריקים | בינוני | שלב 0 עונה על זה **לפני** הבנייה |
| מכונת-מצבים של מנוי נבנית ביד (אין Stripe Billing) | בינוני | scope מפורש בשלב 6; דוחות ה-dunning של PayPlus מקצרים |
| `vehicle.create` יתווסף ל-outbox ⇒ דחייה אסינכרונית (§2.5) | בינוני | להיכנס לתכנון ה-offline לפני הרישום |
| `sessionStorage` נתפס בטעות כמכסה | בינוני | תועד ב-§3.2; ה-AC דורש שמחיקתו לא תאפס |

---

## 7.5 סליקה וחשבונית: מחקר 2026-09-07

### 🔴 Stripe אינו זמין לעסק ישראלי

ישראל **אינה** ברשימת המדינות של Stripe, ואין payout ב-₪ לבנק ישראלי. גם **Stripe Managed Payments** (ה-MoR החדש שלהם), ישראל **אינה** location כשיר.

**המשמעות:** שתי החבילות `@stripe/react-stripe-js` + `@stripe/stripe-js` שב-`package.json` אינן רק "מותקנות ולא מיובאות", הן **לא ניתנות לשימוש בכלל** מהעסק הזה. יש להסיר אותן כדי שלא יטעו שוב.

### 🔴 Merchant-of-Record הוא הכלי הלא-נכון לשוק ישראלי-בלבד

Paddle **אינו גובה מע"מ ישראלי** (ישראל נעדרת מרשימת המדינות שהוא גובה עבורן) ואינו מפיק חשבונית מס ישראלית. כלומר כל הרציונל של MoR, "הם מטפלים במיסים", **מתאדה**, בעוד העמלה היא 5% + ₪1.50 = **21.7% מחיוב של ₪9**. בנוסף, מוצרים מתחת ל-$10 דורשים אצלם שיחת מכירות, **שני המסלולים התחתונים שלך**.

### ✅ מספרי הקצאה **אינם** דרישה עבורך

הרף הוא **₪5,000 לפני מע"מ** (מ-1 ביוני 2026). החיוב הגדול ביותר האפשרי (שנתי ~₪600) נמוך ממנו בסדר גודל. **אבל** הרף צנח פי-5 בשנתיים, ולכן לבחור ספק שכבר שולף מספר הקצאה אוטומטית (Cardcom, Grow, Morning, iCount) ולא לחזור לנושא.

**מה כן חובה:** מסמך תואם לכל חיוב. קבלה חייבת לצאת **מיד** עם קבלת התשלום, ולכן הפקה ידנית על מאות חיובים חוזרים אינה אפשרית. **אוטומציה היא דרישת מוצר קשיחה.**

### העמלות ב-₪9: כאן המבנה נחשף

נטו אחרי מע"מ 18% **ואחרי** עמלת סליקה:

| ספק | ₪9 → נטו | ₪19 → נטו | ₪49 → נטו | דמי פלטפורמה |
|---|---|---|---|---|
| **Grow** (0.75%, רצפה ₪0.50) | **₪7.13** (5.6%) | ₪15.60 (2.6%) | ₪41.03 (1.0%) | ₪59/חודש |
| **PayPlus / Cardcom**: הצעה טובה (1.2%+₪0.20) | **₪7.32** (3.4%) | ₪15.67 (2.3%) | ₪40.74 (1.6%) | ₪80–150 |
| **PayPlus / Cardcom**: הצעה גרועה (2%+₪1.00) | **₪6.45** (13.1%) | ₪14.72 (7.3%) | ₪39.55 (4.0%) | ₪80–150 |
| **Morning / חשבונית ירוקה** (1.4%+₪1.20) | **₪6.30** (14.7%) | ₪14.64 (7.7%) | ₪39.64 (3.8%) | לפי חבילה |
| **Paddle** (MoR) | **₪5.68** (21.7%) | ₪13.65 | ₪37.58 | ₪0 |

**התצפית:** ב-₪49 הפער בין הטוב לגרוע הוא 1.0% מול 9.5%, 9 נקודות. ב-₪9 הוא 3.4% מול 23.2%, **20 נקודות.** כל ₪1.00 של עמלה קבועה הוא **11% מחיוב של ₪9**. המבנה של Grow (רצפה של ₪0.50, לא תוספת) הוא הידידותי ביותר ל-₪9 בשוק, ובפועל הוא **₪0.50 שטוח על כל סולם המחירים** שלך.

### 💡 חיוב שנתי הוא המנוף הגדול, לא בחירת הספק

12 חיובים של ₪9 מול חיוב אחד של ₪108:

| ספק | 12 חודשיים | שנתי אחד | עמלה אפקטיבית |
|---|---|---|---|
| **Grow** | ₪85.53 | **₪90.72** | 5.6% → **0.75%** |
| **Morning** | ₪75.61 | **₪88.82** | 14.7% → **2.5%** |
| **Paddle** | ₪68.12 | **₪84.63** | 21.7% → **6.4%** |

ובנוסף: **פי-12 פחות מסמכי חשבונית** (Grow/Morning/iCount מודדים מסמכים), אפס נטישה כפויה מכרטיס שפג באמצע השנה.

> **המלצה על מבנה התמחור: ₪9 שנתי-בלבד (₪90–108/שנה), או ₪12–15 לחודש.**
> ₪9 שמחויב חודשית הוא קרוב לטעות עיגול אחרי מע"מ ועמלות. זו התשובה המספרית להחלטה **ח-7** באפיון.

### דירוג

1. **PayPlus**: ההתאמה הטובה ביותר. הספק הישראלי היחיד שה-API הציבורי שלו מתעד מחזור-חיים אמיתי של מנוי, **כולל דוחות Failures / Future / Cancellations / Expired Cards**: בדיוק משטח ה-dunning שאחרת בונים ביד. REST מודרני, Bit + Apple Pay + Google Pay.
2. **Cardcom**: כמעט תיקו; לבחור אם איכות ה-API חשובה מהמחיר. ה-API המתועד ביותר בסליקה הישראלית, ו**חשבונית מס/קבלה חתומה נשלחת אוטומטית בכל חיוב מוצלח** עם מספר הקצאה מ-SHAAM. עלות: ₪80–180/חודש יותר מ-Grow.
3. **Grow**: לבחור כדי לצאת לאוויר החודש. אגרגטור ⇒ onboarding של ימים ולא שבועות, **עמלות מפורסמות** (נדיר בשוק הזה), והזול ביותר ב-₪9. חסרונות: ה-API לחיוב חוזר דל בתיעוד, payout רק מה-1–9 בחודש העוקב, ו-**לא ברור אם חיוב חוזר צורך פריט אחד או שניים** מתוך 100 הכלולים (חיוב + מסמך), מה שיחתוך את הקיבולת ל-~50 מנויים. **לקבל בכתב.**
4. **Morning / iCount**: הספרים הטובים בישראל, מבנה עמלה שגוי. ₪1.20 קבוע = 14.7% ב-₪9. רק אם שנתי-בלבד.
5. **Paddle / Polar / Lemon Squeezy**: לא. (Lemon Squeezy נבלע ל-Stripe Managed Payments, יעד שישראל אינה כשירה אליו, בנייה עליו היא בנייה לקראת מיגרציה שאי-אפשר להשלים.)

### ⚠️ הטרייד-אוף האמיתי של הבחירה המובילה

**ספק ישראלי נותן טוקנים, חיובים מתוזמנים, דוחות כשל ו-webhooks, הוא לא נותן Stripe Billing.** אין proration, אין לוגיקת trial/upgrade/downgrade, אין retry חכם, אין portal מתארח ללקוח, אין card-account-updater.

**כלומר: אתה בונה את מכונת-המצבים של המנוי בעצמך.** זו תוספת עבודה אמיתית לשלב 6, וזו סיבה נוספת לדחוף אותו לסוף (§4).

**וגם:** PayPlus ו-Cardcom **אינם מפרסמים מחירים**. כלכלת ה-₪9 תלויה כולה ברכיב העמלה הקבועה שיוסכם. **לקבל את הרכיב הקבוע בכתב לפני התחייבות**: המספר הזה, לא האחוז, מכריע אם ₪9 בר-קיימא בכלל.

### 💡 שאלה לרואה החשבון: שווה כסף אמיתי

**מצב עוסק פטור.** תקרת 2026 היא **₪122,833/שנה**. כעוסק פטור: אין מע"מ, מפיקים קבלה בלבד, ומספרי הקצאה לא חלים כלל. ב-₪9 זה ההבדל בין לשמור **₪8.50** לבין **₪7.13**: תנודה של ~19% במרווח בזמן שהמוצר קטן. חוצים את התקרה בסביבות **540 שנות-מנוי** במחיר ממוצע ₪19.

> **מה שלא אומת ודורש רואה חשבון (לא מחקר):** האם רשות המסים תקבל payout מ-MoR כייצוא שירותים בשיעור אפס כשהלקוחות הם צרכנים ישראלים, או תסתכל דרך העטיפה ותחייב 18%. רלוונטי רק אם בכל זאת שוקלים MoR.

---

## 8. מה חסום ולא ניתן להתחיל בלעדיו

### חוסמים אמיתיים

| # | מה | מי | חוסם את |
|---|---|---|---|
| 1 | **הרצת `admin_vehicle_count_distribution()`**: קובע תקרות, אורך חסד, תחזית תמהיל | Ofek (DB) | שלבים 1+ |
| 2 | **אימות `share_vehicle_with_email` החי**: ייתכן באג ייצור פעיל | Ofek (DB) | מכסה 3 |
| 3 | **אימות `create_business_workspace`**: פרצה לממשק עסקי חינם | Ofek (DB) | שלב 5 |
| 4 | **הכרעת ח-2**: קופי ה-AI ("עסקי בלבד" סותר את ₪9) | מוצר | שלב 5 |
| 5 | **הכרעת ח-3**: תקרת fair-use ל-AI | מוצר | שלב 5 |
| 6 | **מבנה החיוב של ₪9**: חודשי מול שנתי-בלבד (§7.5) | מוצר | שלב 6 |
| 7 | **הצעת מחיר בכתב מ-PayPlus/Cardcom**: הרכיב הקבוע מכריע אם ₪9 בר-קיימא | Ofek (מו"מ) | שלב 6 |
| 8 | **שאלת עוסק פטור לרואה חשבון**: ~19% מרווח | Ofek | שלב 6 |

### מה כן ניתן להתחיל מיד

**שלבים 1–3 חסומים רק על #1.** ברגע שהתקרות נקבעו, תשתית המסלול, מסך התצוגה, ה-UI לאדמין והספירה-ללא-חסימה כולם ניתנים לבנייה, והם additive בלבד (אפס אכיפה, אפס שינוי בטבלאות קיימות).

**#7 ו-#8 חוסמים רק את שלב 6**: ומכיוון שהענקת מסלול ידנית ע"י אדמין נכנסת בשלב 2, אפשר **למכור ולגבות ידנית** לפני שנוגעים בסליקה בכלל.

### פעולת ניקוי מומלצת

**להסיר `@stripe/react-stripe-js` + `@stripe/stripe-js` מ-`package.json`.** הן לא רק מותקנות-ולא-בשימוש, Stripe **אינו זמין לעסק ישראלי** (§7.5), ולכן הן מטעות באופן אקטיבי כל מי שיקרא את הריפו וישאל "אז יש כבר תשתית תשלומים?".

-- ═══════════════════════════════════════════════════════════════════════════
-- גל 1 — תקרת רכבים לחשבון אישי (backend)
-- 2026-07-25 · מממש docs/spec-vehicle-cap-and-personal-to-business-transfer.md
--
-- מה זה עושה:
--   • accounts.vehicle_cap  — תקרת רכבים לחשבון (ברירת מחדל 10)
--   • accounts.plan / plan_since — הכנת קרקע לתמחור עתידי (ה-7). עמודות בלבד,
--     אפס לוגיקה תלויה בהן ב-v1.
--   • backfill: vehicle_cap = greatest(current_count, 10) לכל חשבון אישי —
--     מי שמעל 10 היום קפוא על מה שיש לו, לא מאבד כלום ולא נחסם רטרואקטיבית.
--   • טריגר enforce_personal_vehicle_cap — חוסם הוספת רכב מעל התקרה.
--   • my_vehicle_capacity(account_id) — RPC למד הקיבולת ב-UI (גל 2).
--   • app_config_int — helper קטן לקריאת מספר מ-app_config.
--
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ בטיחות הרצה על ה-DB המשותף (staging+prod חולקים מסד — ראו CLAUDE.md):   │
-- │                                                                         │
-- │   האכיפה מכובה כברירת מחדל. הטריגר קורא את                              │
-- │   app_config.personal_vehicle_cap_enforce_from, ו**לא חוסם כלום** עד    │
-- │   שהערך יוגדר לתאריך שעבר. לכן אפשר להריץ את כל הקובץ על פרודקשן        │
-- │   עכשיו — אפס שינוי התנהגות, אף משתמש לא נחסם.                          │
-- │                                                                         │
-- │   ההפעלה היא צעד ידני, מודע, נפרד (ראו "להפעלת האכיפה" בתחתית).         │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS / backfill בטוח לריצה חוזרת).
-- Reversible (ראו ROLLBACK בתחתית).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── §0. app_config — הסף והמתג הגלובלי ────────────────────────────────────
-- personal_vehicle_cap              — התקרה שחלה על חשבון אישי שאין לו ערך
--                                     מפורש ב-accounts.vehicle_cap.
-- personal_vehicle_cap_enforce_from — מתי האכיפה נכנסת לתוקף. JSON null =
--                                     כבוי (המצב ההתחלתי). הטריגר לא חוסם
--                                     עד שיש כאן חותמת זמן שכבר עברה.
insert into public.app_config (key, value) values
  ('personal_vehicle_cap',              '10'::jsonb),
  ('personal_vehicle_cap_enforce_from', 'null'::jsonb)
on conflict (key) do nothing;


-- ── §1. helper — קריאת מספר שלם מ-app_config עם ברירת מחדל ─────────────────
create or replace function public.app_config_int(p_key text, p_default int)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(value #>> '{}', '')::int
       from public.app_config
      where key = p_key),
    p_default
  );
$$;

revoke all on function public.app_config_int(text, int) from public;
grant execute on function public.app_config_int(text, int) to authenticated;


-- ── §2. עמודות על accounts ────────────────────────────────────────────────
-- vehicle_cap: NULL → נופל לברירת המחדל הגלובלית (app_config). ערך מספרי →
--   תקרת החשבון. default 10 ממלא חשבונות חדשים; ה-backfill למטה מתקן קיימים.
alter table public.accounts
  add column if not exists vehicle_cap int default 10;

-- הכנת קרקע לתמחור (ה-7) — עמודות בלבד, אפס לוגיקה תלויה בהן ב-v1.
alter table public.accounts
  add column if not exists plan text not null default 'free';

alter table public.accounts
  add column if not exists plan_since timestamptz not null default now();


-- ── §3. backfill — הקפאת הקוהורט הקיים על מה שיש לו ────────────────────────
-- vehicle_cap = greatest(current_count, 10):
--   • חשבון עם 53 רכבים → 53 (קפוא, לא מאבד כלום, לא נחסם על הקיים)
--   • חשבון עם 10       → 10 (קפוא)
--   • חשבון עם 6        → 10 (יש מקום לגדול עד 10)
-- בטוח לריצה חוזרת: מריץ שוב על אותם נתונים נותן אותה תוצאה (אין רכב שנוסף
-- ⇒ אין שינוי). אם רכב נוסף בין הרצה להרצה, greatest רק יעלה — לעולם לא יחסום
-- רטרואקטיבית מתחת למה שקיים.
update public.accounts a
   set vehicle_cap = greatest(
         (select count(*) from public.vehicles v where v.account_id = a.id),
         10)
 where a.type = 'personal';


-- ── §4. הטריגר — enforce_personal_vehicle_cap ─────────────────────────────
-- BEFORE INSERT על vehicles. חל רק על accounts.type='personal', ורק אחרי
-- שהאכיפה הופעלה (personal_vehicle_cap_enforce_from עבר). פטורים: אדמין,
-- ואדמין בתוך view-as לחשבון (תמיכה — P1-7).
create or replace function public.enforce_personal_vehicle_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type         text;
  v_cap          int;
  v_count        int;
  v_enforce_from timestamptz;
begin
  -- קורא סוג + תקרה, ונועל את שורת ה-account כדי ששתי הוספות מקבילות לא
  -- יקראו שתיהן count=9 ויעברו שתיהן (P0-4). הנעילה זולה — הוספת רכב נדירה.
  select a.type,
         coalesce(a.vehicle_cap, public.app_config_int('personal_vehicle_cap', 10))
    into v_type, v_cap
    from public.accounts a
   where a.id = new.account_id
   for update;

  -- לא-אישי (עסקי / לא נמצא): אין תקרה.
  if v_type is distinct from 'personal' then
    return new;
  end if;

  -- המתג הגלובלי. עד שאדמין יגדיר חותמת זמן שכבר עברה — התקרה רשומה אך
  -- לא נאכפת. זה מה שהופך את כל הקובץ לבטוח על ה-DB המשותף.
  select nullif(value #>> '{}', '')::timestamptz
    into v_enforce_from
    from public.app_config
   where key = 'personal_vehicle_cap_enforce_from';

  if v_enforce_from is null or now() < v_enforce_from then
    return new;                       -- תקופת חסד / לא הופעל
  end if;

  -- פטור תמיכה: אדמין ישיר, או אדמין בתוך view-as פעיל לחשבון (P1-7).
  if public.is_admin() or public.is_viewing(new.account_id) then
    return new;
  end if;

  select count(*) into v_count
    from public.vehicles
   where account_id = new.account_id;

  if v_count >= v_cap then
    raise exception
      'personal_vehicle_cap_reached: % of % vehicles', v_count, v_cap
      using errcode = 'check_violation',
            hint    = 'פתח/י חשבון עסקי כדי להוסיף עוד רכבים.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_personal_vehicle_cap on public.vehicles;
create trigger enforce_personal_vehicle_cap
  before insert on public.vehicles
  for each row
  execute function public.enforce_personal_vehicle_cap();


-- ── §5. RPC — my_vehicle_capacity(account_id) ─────────────────────────────
-- מזין את מד הקיבולת ב-UI (גל 2). מקור אמת יחיד — ה-UI לעולם לא סופר לבד
-- (P1-8: רכבים משותפים לא נספרים בתקרה של מי ששותפו איתו).
create or replace function public.my_vehicle_capacity(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  v_type  text;
  v_cap   int;
  v_count int;
  v_default int := public.app_config_int('personal_vehicle_cap', 10);
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  -- הקורא חייב להיות חבר פעיל בחשבון (או אדמין / view-as). המספרים לא
  -- רגישים, אבל scoping מונע דליפת גודל-צי של חשבונות זרים.
  if not exists (
        select 1 from public.account_members
         where account_id = p_account_id
           and user_id    = uid
           and status     = 'פעיל'
      )
     and not public.is_admin()
     and not public.is_viewing(p_account_id) then
    raise exception 'forbidden';
  end if;

  select a.type, coalesce(a.vehicle_cap, v_default)
    into v_type, v_cap
    from public.accounts a
   where a.id = p_account_id;

  if v_type is null then raise exception 'account_not_found'; end if;

  select count(*) into v_count
    from public.vehicles
   where account_id = p_account_id;

  return jsonb_build_object(
    'account_type',     v_type,
    'count',            v_count,
    'cap',              case when v_type = 'personal' then v_cap else null end,
    'remaining',        case when v_type = 'personal' then greatest(v_cap - v_count, 0) else null end,
    'is_capped',        v_type = 'personal',
    -- קפוא-מעל-הרף: תקרה גבוהה מברירת המחדל = הקוהורט שכבר היה מעל 10.
    'is_grandfathered', v_type = 'personal' and v_cap > v_default
  );
end;
$$;

revoke all  on function public.my_vehicle_capacity(uuid) from public;
grant execute on function public.my_vehicle_capacity(uuid) to authenticated;


notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- אימות (הרץ אחרי ההחלה)
-- ═══════════════════════════════════════════════════════════════════════════
-- 1) ה-backfill נכון — אסור שתחזור ולו שורה אחת (תקרה מתחת למה שקיים):
--    select a.id,
--           (select count(*) from public.vehicles v where v.account_id=a.id) as cnt,
--           a.vehicle_cap
--      from public.accounts a
--     where a.type='personal'
--       and a.vehicle_cap < (select count(*) from public.vehicles v where v.account_id=a.id);
--
-- 2) הטריגר קיים ומופעל:
--    select tgname, tgenabled from pg_trigger
--     where tgrelid='public.vehicles'::regclass and tgname='enforce_personal_vehicle_cap';
--
-- 3) האכיפה עדיין כבויה (חייב להחזיר null):
--    select value from public.app_config where key='personal_vehicle_cap_enforce_from';
--
-- 4) ה-RPC עובד (החלף במזהה חשבון אמיתי שלך):
--    select public.my_vehicle_capacity('<account-uuid>');


-- ═══════════════════════════════════════════════════════════════════════════
-- להפעלת האכיפה (צעד ידני נפרד — אחרי אימות + אחרי שגל 2.5 יצא)
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ לפני שמפעילים — חובה:
--    (א) ✅ הקליינט תופס 'personal_vehicle_cap_reached' ומציג מסך שדרוג —
--        מומש בגל 2: AddVehicle, VehicleScanWizard, VehicleCheck (3 הנתיבים
--        האינטראקטיביים). bulk_add_vehicles עסקי-בלבד ⇒ אין תקרה שם.
--    (ב) ✅ נתיבי מיגרציית אורח — נפתר ב-supabase-vehicle-cap-migration-
--        2026-07-25.sql (bump_personal_cap + sync_personal_cap_to_count,
--        מחווטים ב-Dashboard init + GuestDataContext). חובה שהקובץ הזה
--        יוחל לפני הפעלת האכיפה.
--    (ג) 4 החשבונות שמעל התקרה קיבלו פנייה אישית (גל 2.5).
--
-- ואז, להפעיל עם תאריך עתידי (תקופת חסד):
--    update public.app_config
--       set value = to_jsonb('2026-08-15T00:00:00+03:00'::text),
--           updated_at = now()
--     where key = 'personal_vehicle_cap_enforce_from';
--
-- לכבות מיידית (גלגול אחורה של האכיפה בלבד, בלי לגעת בנתונים):
--    update public.app_config set value='null'::jsonb
--     where key='personal_vehicle_cap_enforce_from';


-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK מלא (ידני — רק אם צריך לבטל את כל גל 1)
-- ═══════════════════════════════════════════════════════════════════════════
--   drop trigger   if exists enforce_personal_vehicle_cap on public.vehicles;
--   drop function  if exists public.enforce_personal_vehicle_cap();
--   drop function  if exists public.my_vehicle_capacity(uuid);
--   drop function  if exists public.app_config_int(text, int);
--   delete from public.app_config
--    where key in ('personal_vehicle_cap','personal_vehicle_cap_enforce_from');
--   alter table public.accounts drop column if exists vehicle_cap;
--   alter table public.accounts drop column if exists plan;
--   alter table public.accounts drop column if exists plan_since;
--   notify pgrst, 'reload schema';
-- ═══════════════════════════════════════════════════════════════════════════

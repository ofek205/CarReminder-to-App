-- ═══════════════════════════════════════════════════════════════════════════
-- גל 0 — אימות מול ה-DB החי לפני מימוש תקרת הרכבים וההעברה לעסקי
-- 2026-07-24 · נספח ל-docs/spec-vehicle-cap-and-personal-to-business-transfer.md §9
--
-- קריאה בלבד. אף שאילתה כאן לא כותבת, לא משנה סכמה ולא נוגעת בנתונים.
-- בטוח להריץ על פרודקשן.
--
-- הרץ בלוק אחר בלוק ב-Supabase SQL Editor (הוא מציג רק את תוצאת השאילתה
-- האחרונה, לכן אל תריץ את כל הקובץ בבת אחת).
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- ① פסק דין מהיר — ארבע העובדות הקריטיות בטבלה אחת
--
-- זו השאילתה החשובה ביותר. היא עונה על מה שקובע אם חלקים מהאפיון מיותרים.
-- ───────────────────────────────────────────────────────────────────────────
select 'trigger_blocks_vehicle_move' as check_name,
       coalesce(
         (select string_agg(tgname, ', ')
            from pg_trigger
           where tgrelid = 'public.vehicles'::regclass
             and not tgisinternal
             and tgname ilike '%account%'),
         'ABSENT — ח1 מיותר, אין מה לעקוף'
       ) as result
union all
select 'part_b_applied (create_business_workspace חסום?)',
       case when exists (
              select 1 from pg_proc
               where proname = 'create_business_workspace'
                 and pg_get_functiondef(oid) ilike '%approval_required%')
            then 'YES — כבר חסום לנון-אדמין'
            else 'NO — עדיין פתוח לכולם (PART B לא הופעל)' end
union all
select 'routes_fk_on_delete',
       coalesce(
         (select case con.confdeltype
                   when 'c' then 'CASCADE'
                   when 'r' then 'RESTRICT ← מאשר את §5.5: רכב עם מסלול לא נמחק'
                   when 'n' then 'SET NULL'
                   when 'a' then 'NO ACTION'
                 end
            from pg_constraint con
            join pg_class cls on con.conrelid  = cls.oid
            join pg_class ref on con.confrelid = ref.oid
           where con.contype = 'f'
             and cls.relname = 'routes'
             and ref.relname = 'vehicles'
           limit 1),
         'אין FK מ-routes ל-vehicles'
       )
union all
select 'personal_accounts_with_10_or_more',
       (select count(*)::text from (
          select a.id
            from public.accounts a
            left join public.vehicles v on v.account_id = a.id
           where a.type = 'personal'
           group by a.id
          having count(v.id) >= 10) t)
union all
select 'personal_accounts_with_more_than_10',
       (select count(*)::text from (
          select a.id
            from public.accounts a
            left join public.vehicles v on v.account_id = a.id
           where a.type = 'personal'
           group by a.id
          having count(v.id) > 10) t);

-- מה לחפש:
--   trigger_blocks_vehicle_move = ABSENT           → גל 4 מתכווץ, אין טריגר לעקוף
--   part_b_applied              = NO               → אפשר להפעיל, בזהירות מול cap_upgrade
--   routes_fk_on_delete         = RESTRICT         → גל 4.5 חובה
--   with_10_or_more             = מספר ההתרעות שצריך לשלוח ביום ההשקה


-- ───────────────────────────────────────────────────────────────────────────
-- ② כל הטבלאות שחייבות לזוז עם הרכב — מהמקור, לא מהריפו
--
-- כל טבלה שחוזרת כאן ואינה ברשימת §2.4 באפיון = פער שיגרום לשורות יתומות.
-- ───────────────────────────────────────────────────────────────────────────
select c.table_name
  from information_schema.columns c
  join information_schema.columns v
    on  v.table_schema = c.table_schema
    and v.table_name   = c.table_name
    and v.column_name  = 'vehicle_id'
 where c.table_schema = 'public'
   and c.column_name  = 'account_id'
 order by 1;


-- ───────────────────────────────────────────────────────────────────────────
-- ③ כל ה-FK-ים אל vehicles + התנהגותם במחיקה — הפירוט המלא של §5.5
-- ───────────────────────────────────────────────────────────────────────────
select cls.relname as tbl,
       con.conname,
       case con.confdeltype
         when 'c' then 'CASCADE'
         when 'r' then 'RESTRICT'
         when 'n' then 'SET NULL'
         when 'a' then 'NO ACTION'
         else con.confdeltype::text
       end as on_delete
  from pg_constraint con
  join pg_class cls    on con.conrelid  = cls.oid
  join pg_class ref    on con.confrelid = ref.oid
  join pg_namespace ns on cls.relnamespace = ns.oid
 where con.contype  = 'f'
   and ns.nspname   = 'public'
   and ref.relname  = 'vehicles'
 order by on_delete, tbl;


-- ───────────────────────────────────────────────────────────────────────────
-- ④ התפלגות מלאה של מספר הרכבים לחשבון אישי
--
-- שים לב: לא משתמשים כאן ב-admin_vehicle_count_distribution() כי היא
-- מגודרת ב-is_admin(), ו-auth.uid() הוא NULL ב-SQL Editor — היא תיפול על
-- 'forbidden'. השאילתה הישירה נותנת את אותו מידע.
-- ───────────────────────────────────────────────────────────────────────────
with per_account as (
  select a.id, count(v.id)::int as vc
    from public.accounts a
    left join public.vehicles v on v.account_id = a.id
   where a.type = 'personal'
   group by a.id
)
select vc as vehicle_count,
       count(*) as accounts,
       sum(count(*)) over (order by vc desc) as accounts_at_or_above
  from per_account
 group by vc
 order by vc;


-- ───────────────────────────────────────────────────────────────────────────
-- ⑤ מדיניות RLS בפועל על דלי הקבצים — מאמת את §2.3
-- ───────────────────────────────────────────────────────────────────────────
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
 order by policyname;


-- ───────────────────────────────────────────────────────────────────────────
-- ⑥ נפח קבצים לחשבון — קובע אם מזיזים אובייקטים או משנים RLS (§5.3)
-- ───────────────────────────────────────────────────────────────────────────
select (storage.foldername(name))[1]                        as account,
       count(*)                                             as objects,
       pg_size_pretty(sum((metadata->>'size')::bigint))     as total_size
  from storage.objects
 where bucket_id = 'vehicle-files'
 group by 1
 order by 2 desc
 limit 20;


-- ───────────────────────────────────────────────────────────────────────────
-- ⑦ בונוס — כמה קבצים יתומים כבר קיימים היום
--
-- מכמת את הבאג של ניקוי ה-Storage במחיקת רכב (§5.5 ממצא 2). אם המספר
-- גדול, שווה לצרף sweep חד-פעמי לתיקון.
-- ───────────────────────────────────────────────────────────────────────────
select count(*)                                          as orphan_objects,
       pg_size_pretty(sum((metadata->>'size')::bigint))  as wasted
  from storage.objects o
 where o.bucket_id = 'vehicle-files'
   and (storage.foldername(o.name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and not exists (
     select 1 from public.vehicles v
      where v.id = ((storage.foldername(o.name))[2])::uuid
   );

-- ═══════════════════════════════════════════════════════════════════════════
-- גל 3 — מסלול השדרוג: יצירת חשבון עסקי מיידית מהגעה לתקרה
-- 2026-07-25 · מממש docs/spec-...-transfer.md §5.2 + ה-2 (אישור אוטומטי לתקרה)
--
-- הרקע: PART B מופעל בפרודקשן (אומת 2026-07-24) — create_business_workspace
-- זורק approval_required לכל מי שאינו אדמין, כך שהקליינט לא יכול ליצור חשבון
-- עסקי בעצמו. הנתיב הידני (request_business_workspace → pending → אישור אדמין)
-- נשאר כפי שהוא. זה מוסיף נתיב שני, נפרד ומאובטח, לבקשה שמקורה בתקרה.
--
-- הליבה האבטחתית: ההצדקה היחידה לדלג על אישור האדמין היא שהמשתמש **באמת**
-- הגיע לתקרת הרכבים שלו. ה-RPC מאמת זאת בשרת (owns a full personal account),
-- לעולם לא סומך על הקליינט. מי שלא בתקרה — נדחה עם not_at_cap, והקליינט נופל
-- חזרה לנתיב הידני. אי-אפשר לייצר לעצמך חשבון עסקי בלי צי אישי מלא.
--
-- Idempotent (CREATE OR REPLACE). Reversible (DROP בתחתית).
--
-- ┌─ תלוי ב (חובה לאמת בפרודקשן לפני החלה — ראו §אימות תלויות בתחתית) ────────┐
-- │  • public.app_config_int(text,int)        — מגל 1 (הוחל 2026-07-25)       │
-- │  • accounts.vehicle_cap                    — מגל 1                          │
-- │  • public.admin_alerts(kind,severity,title,message,context) + טריגר טלגרם │
-- │  • business_workspace_requests(status in pending/approved/denied, ...)    │
-- └───────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.create_business_workspace_from_cap(
  p_name          text,
  p_business_meta jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  clean_name text;
  new_id     uuid;
  v_meta     jsonb;
  v_pending  uuid;
  v_phone    text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  clean_name := nullif(trim(coalesce(p_name, '')), '');
  if clean_name is null then raise exception 'name_required'; end if;
  if char_length(clean_name) > 120 then raise exception 'name_too_long'; end if;

  -- ── שער אבטחה ────────────────────────────────────────────────────────────
  -- מאשר אוטומטית רק אם לקורא יש חשבון אישי שהגיע לתקרה. אחרת — נתיב ידני.
  -- (עצמאי מהמתג הגלובלי: "בתקרה" = 10 רכבים, גם בתקופת החסד; זה האות המוצרי,
  --  לא האכיפה.)
  if not exists (
    select 1
      from public.accounts a
     where a.owner_user_id = uid
       and a.type = 'personal'
       and (select count(*) from public.vehicles v where v.account_id = a.id)
           >= coalesce(a.vehicle_cap, public.app_config_int('personal_vehicle_cap', 10))
  ) then
    raise exception 'not_at_cap';
  end if;

  -- origin נשמר לתמיד — הבסיס לקוהורט התמחור העתידי (ה-7).
  v_meta := coalesce(p_business_meta, '{}'::jsonb) || jsonb_build_object('origin', 'cap_upgrade');

  -- ── יצירת החשבון (משקף את approve_business_workspace_request) ──────────────
  insert into public.accounts (owner_user_id, type, name, business_meta, created_via)
    values (uid, 'business', clean_name, v_meta, 'cap_upgrade')
    returning id into new_id;

  insert into public.account_members (account_id, user_id, role, status, joined_at)
    values (new_id, uid, 'בעלים', 'פעיל', now());

  insert into public.workspace_audit_log
    (account_id, actor_user_id, action, target_kind, target_id, payload)
  values
    (new_id, uid, 'workspace.create_cap_upgrade', 'workspace', new_id,
     jsonb_build_object('name', clean_name, 'origin', 'cap_upgrade'));

  -- ── עקביות מול לוח האדמין ─────────────────────────────────────────────────
  -- אם יש בקשה ידנית ממתינה — מקדם אותה (P0-2, לא משאיר יתומה). אחרת — רושם
  -- שורת בקשה 'approved' כדי ש-AdminBusinessRequests יישאר שלם.
  select id into v_pending
    from public.business_workspace_requests
   where requesting_user_id = uid and status = 'pending'
   order by created_at desc
   limit 1;

  if v_pending is not null then
    update public.business_workspace_requests
       set status             = 'approved',
           reviewed_at        = now(),
           review_note        = 'אושר אוטומטית — הגעה לתקרת רכבים',
           created_account_id  = new_id,
           business_meta       = coalesce(business_meta, '{}'::jsonb)
                                   || jsonb_build_object('origin', 'cap_upgrade')
     where id = v_pending;
  else
    insert into public.business_workspace_requests
      (requesting_user_id, requested_name, business_meta, reason,
       status, reviewed_at, review_note, created_account_id)
    values
      (uid, clean_name, v_meta, null,
       'approved', now(), 'אושר אוטומטית — הגעה לתקרת רכבים', new_id);
  end if;

  -- ── התראת אדמין לביקורת בדיעבד (טלגרם דרך admin_alerts). best-effort ──────
  begin
    v_phone := nullif(trim(coalesce(v_meta->>'phone', '')), '');
    insert into public.admin_alerts (kind, severity, title, message, context)
    values (
      'business_cap_upgrade',
      'info',
      'חשבון עסקי נפתח אוטומטית (תקרת רכבים)',
      clean_name || coalesce(' · טלפון: ' || v_phone, ''),
      jsonb_build_object('account_id', new_id, 'user_id', uid,
                         'name', clean_name, 'origin', 'cap_upgrade')
    );
  exception when others then
    null;  -- ההתראה best-effort; החשבון כבר נוצר
  end;

  return new_id;
end;
$$;

revoke all  on function public.create_business_workspace_from_cap(text, jsonb) from public;
grant execute on function public.create_business_workspace_from_cap(text, jsonb) to authenticated;

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- אימות תלויות (הרץ לפני ההחלה — מוודא שהריפו תואם את ה-DB החי)
-- ═══════════════════════════════════════════════════════════════════════════
-- חייב להחזיר את כל 4 השורות כ-true:
--   select 'app_config_int'        as dep, to_regprocedure('public.app_config_int(text,int)')     is not null as ok
--   union all
--   select 'accounts.vehicle_cap',       exists(select 1 from information_schema.columns
--            where table_schema='public' and table_name='accounts' and column_name='vehicle_cap')
--   union all
--   select 'admin_alerts cols',          exists(select 1 from information_schema.columns
--            where table_schema='public' and table_name='admin_alerts' and column_name='context')
--   union all
--   select 'bwr.created_account_id',      exists(select 1 from information_schema.columns
--            where table_schema='public' and table_name='business_workspace_requests'
--              and column_name='created_account_id');

-- אימות אחרי החלה (החלף במזהה משתמש שאינו בתקרה — חייב not_at_cap):
--   select public.create_business_workspace_from_cap('בדיקה', '{}'::jsonb);

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
--   drop function if exists public.create_business_workspace_from_cap(text, jsonb);
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-personal-cap-archive-2026-09-11.sql
--
-- The SECOND vehicle-cap system also stops counting transferred-away vehicles.
--
-- Companion to supabase-vehicle-archive-readonly-2026-09-11.sql, which fixed
-- the PLAN cap (enforce_vehicle_plan_cap_stmt / vehicle_cap_room). A live scan
-- of every function reading public.vehicles turned up a second, older cap
-- built on accounts.vehicle_cap, with its own enforcement trigger and its own
-- pre-flight. Fixing only the first would have left a seller un-blocked by
-- their paid plan and still blocked by their personal cap, which from the
-- user's chair is not a fix at all.
--
-- ═══ TWO OF THE FOUR ARE DELIBERATELY NOT TOUCHED ═════════════════════════
--
-- The personal-cap family has four functions, and they split cleanly by what
-- the count is FOR:
--
--   counts in order to REFUSE            → fixed here
--     enforce_personal_vehicle_cap   the trigger that blocks the insert
--     my_vehicle_capacity            the pre-flight the client asks first
--
--   counts in order to GRANT             → left exactly as they are
--     bump_personal_cap              raises the cap to fit a pending batch
--     sync_personal_cap_to_count     settles the cap after a batch insert
--
-- The line matters. In the refusing pair, counting a sold vehicle takes
-- something away from the seller: they are told they are full because of a car
-- they no longer own. In the granting pair the arithmetic runs the other way —
-- sync_personal_cap_to_count writes `greatest(count, 10)` over the existing
-- value, so removing rows from that count can only produce a LOWER cap.
-- Someone grandfathered at fifteen who sells three cars would be quietly
-- dropped to ten, and might even stop reading as grandfathered at all
-- (my_vehicle_capacity derives is_grandfathered from cap > default).
--
-- Product decision 5 says an archived vehicle should not COST the seller a
-- slot. It does not say selling a car should shrink their allowance. Applying
-- the same edit to all four would turn a benefit into a takeaway, so the two
-- pairs get opposite treatment on purpose.
--
-- ═══ PROVENANCE ══════════════════════════════════════════════════════════
--
-- Both bodies below were read back from the LIVE database with
-- pg_get_functiondef on 2026-09-11 and are reproduced VERBATIM — Hebrew
-- comments, spelling and all — apart from the single added predicate, which is
-- marked. This repo defines cap functions across several files, so rebuilding
-- one from a file rather than from the database is how hardening silently
-- disappears.
--
-- SAFETY
--   Idempotent. Changes no data. The edit can only ever RELAX a refusal, never
--   create one, because it removes rows from a count that is compared with >=.
--   Note also that enforce_personal_vehicle_cap is gated behind the
--   `personal_vehicle_cap_enforce_from` timestamp in app_config and does
--   nothing at all until that is set to a past moment.
--
-- APPLY
--   Supabase SQL Editor, once, then:
--     node scripts/sql-ledger.cjs record supabase-personal-cap-archive-2026-09-11.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. pre-flight ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vehicles' and column_name = 'lifecycle'
  ) then
    raise exception 'vehicles.lifecycle is missing. Apply supabase-vehicle-transfer-2026-09-11.sql first.';
  end if;
end $$;


-- ── 1. the enforcing trigger ──────────────────────────────────────────────
create or replace function public.enforce_personal_vehicle_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- ⚠️ ADDED 2026-09-11, the only change to this function: a vehicle already
  -- transferred to its new owner is not one of yours. Without this line a
  -- seller is refused a new car because of one they sold, and the transfer
  -- feature punishes exactly the people who use it (product decision 5).
  -- my_vehicle_capacity below carries the identical predicate; if these two
  -- ever diverge the client promises room the database then refuses, or the
  -- reverse.
  select count(*) into v_count
    from public.vehicles
   where account_id = new.account_id
     and lifecycle <> 'sold_archive';

  if v_count >= v_cap then
    raise exception
      'personal_vehicle_cap_reached: % of % vehicles', v_count, v_cap
      using errcode = 'check_violation',
            hint    = 'פתח/י חשבון עסקי כדי להוסיף עוד רכבים.';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_personal_vehicle_cap() from public;


-- ── 2. the pre-flight the client asks ─────────────────────────────────────
create or replace function public.my_vehicle_capacity(p_account_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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

  -- Identical predicate to enforce_personal_vehicle_cap. See the note there.
  select count(*) into v_count
    from public.vehicles
   where account_id = p_account_id
     and lifecycle <> 'sold_archive';

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
$function$;

revoke all on function public.my_vehicle_capacity(uuid) from public;
grant execute on function public.my_vehicle_capacity(uuid) to authenticated;


-- ── 3. verify ─────────────────────────────────────────────────────────────
-- Expect exactly two rows, both true, and nothing else in the family changed:
--
--   select p.proname,
--          (pg_get_functiondef(p.oid) ~ 'sold_archive') as excludes_archive
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('enforce_personal_vehicle_cap','my_vehicle_capacity',
--                        'bump_personal_cap','sync_personal_cap_to_count')
--    order by p.proname;
--
--   bump_personal_cap             false   ← deliberate, see the header
--   enforce_personal_vehicle_cap  true
--   my_vehicle_capacity           true
--   sync_personal_cap_to_count    false   ← deliberate, see the header
--
-- And the two cap systems should now agree for a real account:
--   select public.my_vehicle_capacity('<account_id>'),
--          public.vehicle_cap_room('<account_id>');
--
-- ROLLBACK: re-create both functions from the live definitions captured in
-- this file, WITHOUT the `and lifecycle <> 'sold_archive'` line. Do not
-- restore them from any other file in this repo.

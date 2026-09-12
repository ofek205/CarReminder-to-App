-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-reminders-skip-sold-2026-09-11.sql
--
-- Reminder emails stop going out for a vehicle its owner has already
-- transferred away.
--
-- Fourth and last companion to supabase-vehicle-transfer-2026-09-11.sql.
--
-- ═══ THE DEFECT ══════════════════════════════════════════════════════════
--
-- email_dispatch_candidates draws from public.vehicles with no notion of
-- lifecycle, so every completed transfer produces a permanent, doubled stream
-- of wrong mail: the seller keeps being told the test and the insurance are
-- due on a car that is not theirs, while the buyer is correctly told the same
-- thing about their own copy. The seller cannot act on it, cannot make it
-- stop, and it names a vehicle they no longer have any relationship with.
--
-- ═══ ONE PREDICATE, NOT EIGHT ════════════════════════════════════════════
--
-- The body is a CTE with EIGHT `union all` branches — insurance and test,
-- upcoming and overdue, owner and driver — and every one of them starts from
-- `public.vehicles v`. The obvious edit is to add `and v.lifecycle <>
-- 'sold_archive'` to each branch's WHERE.
--
-- This file does not do that. Eight separate edits inside one 8.5KB SQL
-- statement is eight chances to mistype, and a mistake here does not fail
-- loudly on one screen — it breaks reminder mail for every user of the
-- product. Instead the archived vehicles are removed once, in the final WHERE
-- that already filters on the cooldown log, with a NOT EXISTS against the
-- vehicle id each row carries.
--
-- The result is the same set, and it covers any branch added later without
-- anyone remembering to. The cost is that the eight branches still compute
-- rows that are then discarded, which is the same shape as the cooldown check
-- sitting beside it.
--
-- ═══ PROVENANCE ══════════════════════════════════════════════════════════
--
-- The body below was read back from the LIVE database with pg_get_functiondef
-- on 2026-09-11 and is reproduced VERBATIM — comments, spacing, Hebrew role
-- names and all — apart from the single marked block. This matters more for
-- this function than for any other in the project: the repo contains SIX
-- competing definitions of email_dispatch_candidates across ten files, so
-- rebuilding it from any of them would silently revert whatever the live one
-- has that they do not.
--
-- SAFETY
--   Idempotent. The change can only ever REMOVE rows from the candidate set,
--   never add one, so no user can start receiving mail they were not already
--   receiving. If vehicles.lifecycle did not exist the pre-flight below
--   refuses to run at all.
--
-- APPLY
--   Supabase SQL Editor, once, then:
--     node scripts/sql-ledger.cjs record supabase-reminders-skip-sold-2026-09-11.sql
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vehicles' and column_name = 'lifecycle'
  ) then
    raise exception 'vehicles.lifecycle is missing. Apply supabase-vehicle-transfer-2026-09-11.sql first.';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.email_dispatch_candidates(p_notification_key text)
 RETURNS TABLE(user_id uuid, recipient_email text, vehicle_id uuid, vehicle_name text, license_plate text, reference_date date, days_left integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with trig as (
    select days_before, cooldown_days, conditions
    from public.email_triggers
    where notification_key = p_notification_key
      and enabled = true
  ),
  raw as (
    -- ── insurance · UPCOMING · owner ──────────────────────────────
    select am.user_id, u.email as recipient_email, v.id as vehicle_id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')) as vehicle_name,
      v.license_plate, v.insurance_due_date as reference_date,
      (v.insurance_due_date - current_date)::int as days_left, u.created_at as user_created_at
    from public.vehicles v
    join public.account_members am on am.account_id = v.account_id and am.role = 'בעלים'
    join auth.users u on u.id = am.user_id
    join public.reminder_settings rs on rs.user_id = am.user_id
      and rs.email_enabled = true and coalesce(rs.notify_insurance, true) = true
    cross join trig
    where p_notification_key = 'reminder_insurance'
      and v.insurance_due_date between current_date and current_date + coalesce(rs.remind_insurance_days_before, trig.days_before)

    union all
    -- ── insurance · UPCOMING · driver ─────────────────────────────
    select da.driver_user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.insurance_due_date, (v.insurance_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.driver_assignments da on da.vehicle_id = v.id and da.status = 'active' and (da.valid_to is null or da.valid_to > now())
    join auth.users u on u.id = da.driver_user_id
    left join public.reminder_settings rs on rs.user_id = da.driver_user_id
    cross join trig
    where p_notification_key = 'reminder_insurance'
      and v.insurance_due_date between current_date and current_date + coalesce(rs.remind_insurance_days_before, trig.days_before)
      and coalesce(rs.email_enabled, false) = true and coalesce(rs.notify_insurance, true) = true
      and not exists (select 1 from public.account_members am2 where am2.account_id = v.account_id and am2.user_id = da.driver_user_id and am2.role = 'בעלים')

    union all
    -- ── test · UPCOMING · owner ───────────────────────────────────
    select am.user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.test_due_date, (v.test_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.account_members am on am.account_id = v.account_id and am.role = 'בעלים'
    join auth.users u on u.id = am.user_id
    join public.reminder_settings rs on rs.user_id = am.user_id
      and rs.email_enabled = true and coalesce(rs.notify_test, true) = true
    cross join trig
    where p_notification_key = 'reminder_test'
      and v.test_due_date between current_date and current_date + coalesce(rs.remind_test_days_before, trig.days_before)

    union all
    -- ── test · UPCOMING · driver ──────────────────────────────────
    select da.driver_user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.test_due_date, (v.test_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.driver_assignments da on da.vehicle_id = v.id and da.status = 'active' and (da.valid_to is null or da.valid_to > now())
    join auth.users u on u.id = da.driver_user_id
    left join public.reminder_settings rs on rs.user_id = da.driver_user_id
    cross join trig
    where p_notification_key = 'reminder_test'
      and v.test_due_date between current_date and current_date + coalesce(rs.remind_test_days_before, trig.days_before)
      and coalesce(rs.email_enabled, false) = true and coalesce(rs.notify_test, true) = true
      and not exists (select 1 from public.account_members am2 where am2.account_id = v.account_id and am2.user_id = da.driver_user_id and am2.role = 'בעלים')

    union all
    -- ── insurance · OVERDUE · owner (7..30 days past) ─────────────
    select am.user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.insurance_due_date, (v.insurance_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.account_members am on am.account_id = v.account_id and am.role = 'בעלים'
    join auth.users u on u.id = am.user_id
    join public.reminder_settings rs on rs.user_id = am.user_id
      and rs.email_enabled = true and coalesce(rs.notify_insurance, true) = true
    cross join trig
    where p_notification_key = 'reminder_insurance_overdue'
      and v.insurance_due_date between current_date - 30 and current_date - 7

    union all
    -- ── insurance · OVERDUE · driver ──────────────────────────────
    select da.driver_user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.insurance_due_date, (v.insurance_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.driver_assignments da on da.vehicle_id = v.id and da.status = 'active' and (da.valid_to is null or da.valid_to > now())
    join auth.users u on u.id = da.driver_user_id
    left join public.reminder_settings rs on rs.user_id = da.driver_user_id
    cross join trig
    where p_notification_key = 'reminder_insurance_overdue'
      and v.insurance_due_date between current_date - 30 and current_date - 7
      and coalesce(rs.email_enabled, false) = true and coalesce(rs.notify_insurance, true) = true
      and not exists (select 1 from public.account_members am2 where am2.account_id = v.account_id and am2.user_id = da.driver_user_id and am2.role = 'בעלים')

    union all
    -- ── test · OVERDUE · owner ────────────────────────────────────
    select am.user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.test_due_date, (v.test_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.account_members am on am.account_id = v.account_id and am.role = 'בעלים'
    join auth.users u on u.id = am.user_id
    join public.reminder_settings rs on rs.user_id = am.user_id
      and rs.email_enabled = true and coalesce(rs.notify_test, true) = true
    cross join trig
    where p_notification_key = 'reminder_test_overdue'
      and v.test_due_date between current_date - 30 and current_date - 7

    union all
    -- ── test · OVERDUE · driver ───────────────────────────────────
    select da.driver_user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.test_due_date, (v.test_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.driver_assignments da on da.vehicle_id = v.id and da.status = 'active' and (da.valid_to is null or da.valid_to > now())
    join auth.users u on u.id = da.driver_user_id
    left join public.reminder_settings rs on rs.user_id = da.driver_user_id
    cross join trig
    where p_notification_key = 'reminder_test_overdue'
      and v.test_due_date between current_date - 30 and current_date - 7
      and coalesce(rs.email_enabled, false) = true and coalesce(rs.notify_test, true) = true
      and not exists (select 1 from public.account_members am2 where am2.account_id = v.account_id and am2.user_id = da.driver_user_id and am2.role = 'בעלים')
  )
  select r.user_id, r.recipient_email, r.vehicle_id, r.vehicle_name, r.license_plate, r.reference_date, r.days_left
  from raw r
  cross join trig t
  where not exists (
    select 1 from public.email_send_log esl
    where esl.user_id = r.user_id and esl.notification_key = p_notification_key
      and esl.reference_date = r.reference_date
      and esl.sent_at > now() - (t.cooldown_days || ' days')::interval
  )
  -- ⚠️ ADDED 2026-09-11, and the ONLY change to this function.
  --
  -- A vehicle already transferred to its new owner is dropped here, once, for
  -- all eight branches above and for any branch added after this. Placed in
  -- the final WHERE rather than repeated eight times on purpose: this is one
  -- SQL statement, and a typo inside it does not break one screen, it stops
  -- reminder mail for everybody.
  --
  -- Without it, every completed sale creates a permanent doubled stream — the
  -- seller told their test is due on a car they no longer own, the buyer told
  -- the same about their copy — and the seller has no way to stop it.
  and not exists (
    select 1 from public.vehicles vv
    where vv.id = r.vehicle_id and vv.lifecycle = 'sold_archive'
  )
  and (
    (t.conditions->>'min_days_since_signup') is null
    or r.user_created_at < now() - ((t.conditions->>'min_days_since_signup')::int || ' days')::interval
  );
$function$;

revoke all on function public.email_dispatch_candidates(text) from public;


-- ── verify ────────────────────────────────────────────────────────────────
-- 1. The clause landed, and the function still has its eight branches:
--
--   select (pg_get_functiondef(p.oid) ~ 'sold_archive')                as excludes_archive,
--          (length(pg_get_functiondef(p.oid)) - length(replace(
--             pg_get_functiondef(p.oid), 'union all', '')))/9          as union_branches
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'email_dispatch_candidates';
--   -- expect: t | 7      (seven `union all` keywords join eight branches)
--
-- 2. It still returns rows for a real key — a function that returns nothing is
--    indistinguishable from "no reminders due" and would be silent for days:
--
--   select count(*) from public.email_dispatch_candidates('reminder_test');
--   select count(*) from public.email_dispatch_candidates('reminder_insurance');
--
--   Compare these with what you would have expected BEFORE applying. They may
--   legitimately be zero if nothing is due today; in that case re-check after
--   the next cron run rather than assuming the change is at fault.
--
-- 3. No archived vehicle appears in any candidate set:
--
--   select count(*)
--     from public.email_dispatch_candidates('reminder_test') c
--     join public.vehicles v on v.id = c.vehicle_id
--    where v.lifecycle = 'sold_archive';   -- 0
--
-- ROLLBACK: re-create the function from the definition in this file WITHOUT
-- the marked `and not exists (... sold_archive ...)` block. Do not restore it
-- from any of the ten other files in this repo that define it.
--
-- ── STILL OWED ────────────────────────────────────────────────────────────
-- get_daily_digest reads public.vehicles too and has the same defect. Its live
-- definition has not been read back yet, so it is deliberately untouched here.

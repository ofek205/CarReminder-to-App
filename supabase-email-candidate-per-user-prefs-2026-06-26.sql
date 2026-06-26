-- ═══════════════════════════════════════════════════════════════════════════
-- email_dispatch_candidates → honor per-user notify toggle + per-user timing
-- 2026-06-26
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY:
--   Until now the email reminder pipeline only respected the per-user MASTER
--   switch (reminder_settings.email_enabled) and used the ADMIN-GLOBAL window
--   (email_triggers.days_before). The per-type toggles the user sees in
--   /Settings → התראות (notify_test, notify_insurance) and their per-type
--   "ימים לפני" (remind_test_days_before, remind_insurance_days_before) were
--   ignored by email entirely (the toggles were localStorage-only and the
--   window came from the admin global).
--
--   Product decision (Ofek, 2026-06-26): every user gets FULL per-type
--   control, default ON.
--
-- WHAT CHANGES (vs supabase-email-candidate-window-fix-2026-06-06.sql):
--   • Each branch now requires coalesce(rs.notify_<type>, true) = true.
--   • The due-date window now uses the USER's remind_<type>_days_before
--     (falling back to the admin trig.days_before when null).
--   email_triggers.enabled stays the admin global on/off per type;
--   reminder_settings.email_enabled stays the user master on/off.
--
-- DEPENDENCY (run order):
--   1. supabase-add-reminder-notify-columns.sql  ← MUST run first; this
--      function references rs.notify_test / rs.notify_insurance.
--   2. THIS file.
--   3. Deploy the frontend that adds notify_* to ReminderSettingsPage
--      DB_COLUMNS (so user changes persist to the DB).
--
-- Idempotent (CREATE OR REPLACE). Run ONCE in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

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
    -- insurance · owner
    select
      am.user_id,
      u.email as recipient_email,
      v.id as vehicle_id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')) as vehicle_name,
      v.license_plate,
      v.insurance_due_date as reference_date,
      (v.insurance_due_date - current_date)::int as days_left,
      u.created_at as user_created_at
    from public.vehicles v
    join public.account_members am
      on am.account_id = v.account_id
     and am.role = 'בעלים'
    join auth.users u on u.id = am.user_id
    join public.reminder_settings rs
      on rs.user_id = am.user_id
     and rs.email_enabled = true
     and coalesce(rs.notify_insurance, true) = true
    cross join trig
    where p_notification_key = 'reminder_insurance'
      and v.insurance_due_date between current_date
          and current_date + coalesce(rs.remind_insurance_days_before, trig.days_before)

    union all

    -- insurance · driver
    select
      da.driver_user_id,
      u.email,
      v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate,
      v.insurance_due_date,
      (v.insurance_due_date - current_date)::int,
      u.created_at
    from public.vehicles v
    join public.driver_assignments da
      on da.vehicle_id = v.id
     and da.status = 'active'
     and (da.valid_to is null or da.valid_to > now())
    join auth.users u on u.id = da.driver_user_id
    left join public.reminder_settings rs
      on rs.user_id = da.driver_user_id
    cross join trig
    where p_notification_key = 'reminder_insurance'
      and v.insurance_due_date between current_date
          and current_date + coalesce(rs.remind_insurance_days_before, trig.days_before)
      and coalesce(rs.email_enabled, false) = true
      and coalesce(rs.notify_insurance, true) = true
      and not exists (
        select 1
        from public.account_members am2
        where am2.account_id = v.account_id
          and am2.user_id = da.driver_user_id
          and am2.role = 'בעלים'
      )

    union all

    -- test · owner
    select
      am.user_id,
      u.email,
      v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate,
      v.test_due_date,
      (v.test_due_date - current_date)::int,
      u.created_at
    from public.vehicles v
    join public.account_members am
      on am.account_id = v.account_id
     and am.role = 'בעלים'
    join auth.users u on u.id = am.user_id
    join public.reminder_settings rs
      on rs.user_id = am.user_id
     and rs.email_enabled = true
     and coalesce(rs.notify_test, true) = true
    cross join trig
    where p_notification_key = 'reminder_test'
      and v.test_due_date between current_date
          and current_date + coalesce(rs.remind_test_days_before, trig.days_before)

    union all

    -- test · driver
    select
      da.driver_user_id,
      u.email,
      v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate,
      v.test_due_date,
      (v.test_due_date - current_date)::int,
      u.created_at
    from public.vehicles v
    join public.driver_assignments da
      on da.vehicle_id = v.id
     and da.status = 'active'
     and (da.valid_to is null or da.valid_to > now())
    join auth.users u on u.id = da.driver_user_id
    left join public.reminder_settings rs
      on rs.user_id = da.driver_user_id
    cross join trig
    where p_notification_key = 'reminder_test'
      and v.test_due_date between current_date
          and current_date + coalesce(rs.remind_test_days_before, trig.days_before)
      and coalesce(rs.email_enabled, false) = true
      and coalesce(rs.notify_test, true) = true
      and not exists (
        select 1
        from public.account_members am2
        where am2.account_id = v.account_id
          and am2.user_id = da.driver_user_id
          and am2.role = 'בעלים'
      )
  )
  select
    r.user_id,
    r.recipient_email,
    r.vehicle_id,
    r.vehicle_name,
    r.license_plate,
    r.reference_date,
    r.days_left
  from raw r
  cross join trig t
  where not exists (
    select 1
    from public.email_send_log esl
    where esl.user_id = r.user_id
      and esl.notification_key = p_notification_key
      and esl.reference_date = r.reference_date
      and esl.sent_at > now() - (t.cooldown_days || ' days')::interval
  )
  and (
    (t.conditions->>'min_days_since_signup') is null
    or r.user_created_at < now() - ((t.conditions->>'min_days_since_signup')::int || ' days')::interval
  );
$function$
;

-- Verify (after running, with a type that has candidates):
--   SELECT count(*) FROM public.email_dispatch_candidates('reminder_test');
-- Toggle one user's notify_test off and confirm the count drops by their vehicles.

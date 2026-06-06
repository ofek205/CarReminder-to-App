-- C1 (audit): email candidate window = exact-day -> BETWEEN, so a missed cron
-- day no longer permanently drops the renewal email. email_send_log idempotency
-- (user_id, notification_key, reference_date=due_date) still guarantees exactly-once.
-- 2026-06-06. Regenerated from live pg_get_functiondef.

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
    cross join trig
    where p_notification_key = 'reminder_insurance'
      and v.insurance_due_date between current_date and current_date + trig.days_before

    union all

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
      and v.insurance_due_date between current_date and current_date + trig.days_before
      and coalesce(rs.email_enabled, false) = true
      and not exists (
        select 1
        from public.account_members am2
        where am2.account_id = v.account_id
          and am2.user_id = da.driver_user_id
          and am2.role = 'בעלים'
      )

    union all

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
    cross join trig
    where p_notification_key = 'reminder_test'
      and v.test_due_date between current_date and current_date + trig.days_before

    union all

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
      and v.test_due_date between current_date and current_date + trig.days_before
      and coalesce(rs.email_enabled, false) = true
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

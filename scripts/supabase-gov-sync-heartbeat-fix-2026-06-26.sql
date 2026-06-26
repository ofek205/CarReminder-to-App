-- ═══════════════════════════════════════════════════════════════════════════
-- gov-sync heartbeat fix — record_gov_sync_update
-- 2026-06-26
--
-- BUG (production, since the 2026-05-24 gov-sync dormancy):
--   record_gov_sync_update advanced the last_gov_sync_at heartbeat ONLY when
--   gov.il data actually changed (the main UPDATE path). When the function
--   found an existing gov_sync_log row for (vehicle_id, gov_test_date) — i.e.
--   "we already saw this test date, nothing new" — it returned early with
--   was_new=false WITHOUT stamping last_gov_sync_at. The edge function then
--   sees was_new=false, counts it as no_change, and continues without
--   stamping either.
--
--   Result: every vehicle in a steady state (gov.il data unchanged since the
--   last successful log) was re-queried against gov.il on EVERY cron run,
--   forever, and permanently showed up in the 20h-staleness backlog. This is
--   why ~280 vehicles were frozen at last_gov_sync_at = 2026-05-17/05-24 and
--   the backlog flatlined no matter how many sync runs fired. It would only
--   grow as more vehicles reached a stable state.
--
-- FIX:
--   In the "existing log found" early-return branch, stamp the heartbeat
--   (last_gov_sync_at = now()) plus the sync-snapshot columns. A successful
--   "we checked, nothing changed" now advances the heartbeat exactly like the
--   change path does. This does NOT touch any user-facing field
--   (current_km / last_test_date / test_due_date are untouched).
--
-- Deployed live to the shared prod DB on 2026-06-26 via the Supabase
-- Management API (base64 EXECUTE, to preserve the Hebrew notification text
-- byte-for-byte). This file is the repo record / idempotent re-runner.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.record_gov_sync_update(p_vehicle_id uuid, p_gov_km integer, p_gov_test_date date, p_gov_test_due_date date)
 RETURNS TABLE(notification_id uuid, km_updated boolean, test_updated boolean, was_new boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id              uuid;
  v_owner_user_id           uuid;
  v_nickname                text;
  v_license_plate           text;
  v_old_km                  integer;
  v_old_test_date           date;
  v_old_test_due_date       date;
  v_last_manual_km_update   timestamptz;
  v_auto_sync_enabled       boolean;
  v_should_update_km        boolean := false;
  v_should_update_test      boolean := false;
  v_should_update_test_due  boolean := false;
  v_notification_id         uuid    := null;
  v_log_id                  uuid;
  v_existing_log_id         uuid;
  v_title                   text;
  v_body                    text;
  v_vehicle_label           text;
begin
  select
    v.account_id, v.nickname, v.license_plate,
    v.current_km, v.last_test_date, v.test_due_date,
    v.last_manual_km_update_at, v.auto_sync_enabled
  into
    v_account_id, v_nickname, v_license_plate,
    v_old_km, v_old_test_date, v_old_test_due_date,
    v_last_manual_km_update, v_auto_sync_enabled
  from public.vehicles v
  where v.id = p_vehicle_id
  for update;

  if not found then
    raise exception 'vehicle not found: %', p_vehicle_id
      using errcode = 'P0002';
  end if;

  if v_auto_sync_enabled is false then
    return query select null::uuid, false, false, false;
    return;
  end if;

  if p_gov_test_date is not null then
    select gs.id, gs.notification_id
      into v_existing_log_id, v_notification_id
    from public.gov_sync_log gs
    where gs.vehicle_id = p_vehicle_id
      and gs.gov_test_date = p_gov_test_date
    limit 1;

    if found then
      -- 2026-06-26 fix: advance the heartbeat even when nothing changed, so steady-state
      -- vehicles leave the 20h staleness backlog instead of being re-queried against gov.il forever.
      update public.vehicles
        set last_gov_sync_at = now(),
            last_gov_sync_km = p_gov_km,
            last_gov_sync_test_date = p_gov_test_date
        where id = p_vehicle_id;
      return query select v_notification_id, false, false, false;
      return;
    end if;
  end if;

  if p_gov_km is not null
     and p_gov_km > coalesce(v_old_km, 0) then
    if v_last_manual_km_update is null
       or p_gov_test_date is null
       or v_last_manual_km_update < (p_gov_test_date::timestamptz) then
      v_should_update_km := true;
    end if;
  end if;

  if p_gov_test_due_date is not null
     and (v_old_test_due_date is null
          or p_gov_test_due_date > v_old_test_due_date) then
    v_should_update_test_due := true;
  end if;

  if p_gov_test_date is not null
     and (v_old_test_date is null
          or p_gov_test_date > v_old_test_date) then
    v_should_update_test := true;
  end if;

  update public.vehicles
    set
      current_km              = case when v_should_update_km       then p_gov_km             else current_km              end,
      last_test_date          = case when v_should_update_test     then p_gov_test_date      else last_test_date          end,
      test_due_date           = case when v_should_update_test_due then p_gov_test_due_date  else test_due_date            end,
      last_gov_sync_at        = now(),
      last_gov_sync_km        = p_gov_km,
      last_gov_sync_test_date = p_gov_test_date
  where id = p_vehicle_id;

  select m.user_id
    into v_owner_user_id
  from public.account_members m
  where m.account_id = v_account_id
    and m.status     = 'פעיל'
    and m.role       in ('בעלים', 'owner')
  order by m.joined_at asc nulls last
  limit 1;

  if v_owner_user_id is null then
    select m.user_id
      into v_owner_user_id
    from public.account_members m
    where m.account_id = v_account_id
      and m.status     = 'פעיל'
    order by m.joined_at asc nulls last
    limit 1;
  end if;

  v_vehicle_label := coalesce(nullif(v_nickname, ''), v_license_plate, 'רכב');

  if (v_should_update_km or v_should_update_test or v_should_update_test_due)
     and v_owner_user_id is not null then

    v_title := '✅ עדכון אוטומטי ממשרד התחבורה';

    if v_should_update_km and v_should_update_test_due then
      v_body := 'זיהינו שביצעת טסט ל'
             || v_vehicle_label
             || '. הקילומטראז׳ עודכן ל-'
             || to_char(p_gov_km, 'FM999G999G999')
             || ' ק״מ ותוקף הטסט הבא ל-'
             || to_char(p_gov_test_due_date, 'DD/MM/YYYY')
             || '.';
    elsif v_should_update_km then
      v_body := 'הקילומטראז׳ של '
             || v_vehicle_label
             || ' עודכן ל-'
             || to_char(p_gov_km, 'FM999G999G999')
             || ' ק״מ לפי נתוני משרד התחבורה.';
    elsif v_should_update_test_due then
      v_body := 'תוקף הטסט של '
             || v_vehicle_label
             || ' עודכן ל-'
             || to_char(p_gov_test_due_date, 'DD/MM/YYYY')
             || '.';
    else
      v_body := 'תאריך הטסט של '
             || v_vehicle_label
             || ' עודכן לפי נתוני משרד התחבורה.';
    end if;

    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      v_owner_user_id,
      'gov_sync_update',
      v_title,
      v_body,
      jsonb_build_object(
        'vehicle_id',          p_vehicle_id,
        'old_km',              v_old_km,
        'new_km',              case when v_should_update_km then p_gov_km else null end,
        'old_test_due_date',   v_old_test_due_date,
        'new_test_due_date',   case when v_should_update_test_due then p_gov_test_due_date else null end,
        'new_test_date',       case when v_should_update_test     then p_gov_test_date     else null end,
        'license_plate',       v_license_plate,
        'nickname',            v_nickname
      )
    )
    returning id into v_notification_id;
  end if;

  insert into public.gov_sync_log (
    vehicle_id, account_id, user_id,
    gov_km, gov_test_date, gov_test_due_date,
    old_km, old_test_date, old_test_due_date,
    km_updated, test_date_updated, test_due_date_updated,
    notification_id
  )
  values (
    p_vehicle_id, v_account_id, v_owner_user_id,
    p_gov_km, p_gov_test_date, p_gov_test_due_date,
    v_old_km, v_old_test_date, v_old_test_due_date,
    v_should_update_km, v_should_update_test, v_should_update_test_due,
    v_notification_id
  )
  on conflict (vehicle_id, gov_test_date) do nothing
  returning id into v_log_id;

  return query select
    v_notification_id,
    v_should_update_km,
    (v_should_update_test or v_should_update_test_due),
    true;
end;
$function$;

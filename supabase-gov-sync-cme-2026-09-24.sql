-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-gov-sync-cme-2026-09-24.sql
--
-- record_gov_sync_update: a צמ"ה vehicle's push says "תוקף הרישוי", not
-- "תוקף הטסט".
--
-- ═══ WHY ═══════════════════════════════════════════════════════════════════
--
-- gov-sync-vehicles now reads the ministry's צמ"ה registry (58dc4654) for
-- vehicles typed as צמ"ה. That registry publishes a licence expiry only, so
-- those rows reach this function with just p_gov_test_due_date and land in
-- the due-only branch, whose text said "תוקף הטסט של X עודכן ל-...".
-- צמ"ה has an annual licence, not a test; Ofek chose "תוקף הרישוי"
-- (2026-09-24). Every other vehicle keeps its wording.
--
-- ═══ THE CHANGE ════════════════════════════════════════════════════════════
--
--   * reads vehicles.vehicle_type alongside the columns it already reads
--   * v_is_cme: that type is in the צמ"ה list (see below)
--   * the due-only branch picks "תוקף הרישוי של" when v_is_cme
--
-- Nothing else moves. The file was generated from the live body, and the
-- generator refused to write it if undoing these edits didn't give back that
-- body exactly.
--
-- The צמ"ה list is generated from CME_VEHICLE_TYPES in
-- supabase/functions/gov-sync-vehicles/index.ts, which is the app's
-- CME_TYPES (src/components/shared/DateStatusUtils.jsx) plus 'כלי צמ"ה',
-- 'מכבש גלילי ממונע' and 'מכבש גליל ידני', labels found on real vehicles.
-- If the list changes, regenerate this rather than editing it by hand.
--
-- ═══ BUILT ON THE LIVE FUNCTION, AND IT CHECKS ═════════════════════════════
--
-- Base: supabase-gov-sync-notification-copy-2026-09-24.sql, applied and
-- verified 2026-09-24. Body md5 84b9bf0348dc27fb3e8b138b138cb2b2 (LF) / 7253d0ee897f07bd647227b0df1d1a8c (CRLF).
-- The guard below compares the live md5 first and raises if it is neither,
-- inside one transaction, so nothing changes on top of a version this file
-- doesn't know. If that happens, stop and look; don't edit the guard away.
--
-- Signature unchanged, so CREATE OR REPLACE keeps the grants and the
-- deployed Edge Function keeps calling it the same way. Either can go first.
--
-- ═══ VERIFY AFTER RUNNING ══════════════════════════════════════════════════
--
--   select md5(p.prosrc)                                                   as md5_now,
--          p.prosrc like '%v_is_cme%'                                      as has_cme_wording,
--          (select count(*) from regexp_matches(p.prosrc,
--             'last_gov_sync_at\s*=\s*now\(\)', 'g'))                     as heartbeat_stamps,
--          has_function_privilege('anon',          p.oid, 'execute')       as anon_can,
--          has_function_privilege('authenticated', p.oid, 'execute')       as authed_can,
--          has_function_privilege('service_role',  p.oid, 'execute')       as service_can
--   from pg_proc p
--   where p.proname = 'record_gov_sync_update';
--
--   Expected: md5_now ae2598480ac2d10d504aa2bc087454d6 (or its CRLF twin), true, 2, false, false, true.
--
-- Rollback: run supabase-gov-sync-notification-copy-2026-09-24.sql again.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- Refuse to run on top of anything but the version this file was built on.
do $guard$
declare
  v_md5 text;
begin
  select md5(prosrc) into v_md5 from pg_proc where proname = 'record_gov_sync_update';
  if v_md5 is distinct from '84b9bf0348dc27fb3e8b138b138cb2b2' and v_md5 is distinct from '7253d0ee897f07bd647227b0df1d1a8c' then
    raise exception 'record_gov_sync_update is not the version this file was built on (md5 %). Nothing was changed.', v_md5;
  end if;
end
$guard$;

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
  v_vehicle_type            text;
  v_is_cme                  boolean := false;
begin
  select
    v.account_id, v.nickname, v.license_plate,
    v.current_km, v.last_test_date, v.test_due_date,
    v.last_manual_km_update_at, v.auto_sync_enabled, v.vehicle_type
  into
    v_account_id, v_nickname, v_license_plate,
    v_old_km, v_old_test_date, v_old_test_due_date,
    v_last_manual_km_update, v_auto_sync_enabled, v_vehicle_type
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

  -- 2026-09-24: צמ"ה has a licence (רישוי), not a test. Same list as
  -- CME_VEHICLE_TYPES in supabase/functions/gov-sync-vehicles/index.ts,
  -- generated from it; gershayim and a plain quote both occur in labels.
  v_is_cme := replace(btrim(coalesce(v_vehicle_type, '')), '״', '"') = any (array[
        'מחפר',
        'מחפר זחלי',
        'מחפר אופני',
        'מיני מחפר',
        'מחפרון',
        'דחפור',
        'דחפור זחלי',
        'שופל',
        'מעמיס אופני',
        'מעמיס זחלי',
        'מיני מעמיס',
        'בובקט',
        'טליהנדלר',
        'מלגזה',
        'מלגזת שטח',
        'מפלסת',
        'מכבש',
        'מכבש אספלט',
        'מכבש קרקע',
        'מכבש גלילי ממונע',
        'מכבש גליל ידני',
        'מערבל בטון',
        'משאבת בטון',
        'מנוף',
        'מנוף נייד',
        'מנוף זחלי',
        'מקדח קרקע',
        'ציוד קידוח',
        'רכב צמ"ה',
        'כלי צמ"ה',
        'טרקטור',
        'מחרשה'
      ]::text[]);

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
    elsif v_should_update_km and v_should_update_test then
      -- 2026-09-24: a new test whose due date the owner had already typed in
      -- by hand. The km-only text below used to hide the test entirely.
      v_body := 'זיהינו שביצעת טסט ל'
             || v_vehicle_label
             || '. הקילומטראז׳ עודכן ל-'
             || to_char(p_gov_km, 'FM999G999G999')
             || ' ק״מ'
             || case
                  when v_old_test_due_date is not null
                   and p_gov_test_due_date is not null
                   and v_old_test_due_date >= p_gov_test_due_date
                  then ', ותוקף הטסט הבא ('
                       || to_char(v_old_test_due_date, 'DD/MM/YYYY')
                       || ') כבר היה מעודכן אצלך.'
                  else '.'
                end;
    elsif v_should_update_km then
      v_body := 'הקילומטראז׳ של '
             || v_vehicle_label
             || ' עודכן ל-'
             || to_char(p_gov_km, 'FM999G999G999')
             || ' ק״מ לפי נתוני משרד התחבורה.';
    elsif v_should_update_test_due then
      v_body := case when v_is_cme then 'תוקף הרישוי של ' else 'תוקף הטסט של ' end
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

-- CREATE OR REPLACE keeps the grants; restated so the file stands alone.
revoke execute on function public.record_gov_sync_update(uuid, integer, date, date)
  from public, anon, authenticated;
grant execute on function public.record_gov_sync_update(uuid, integer, date, date)
  to service_role;

commit;

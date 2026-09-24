-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-gov-sync-notification-copy-2026-09-24.sql
--
-- record_gov_sync_update: when a new test is detected, the push says so,
-- and no client role can call the function any more.
--
-- ═══ SECURITY: WHO MAY EXECUTE IT ══════════════════════════════════════════
--
-- The function is SECURITY DEFINER, writes to whatever vehicle id it is
-- handed, and checks no ownership. supabase-gov-sync-detector.sql granted it
-- to `authenticated`, and Supabase's default privileges also hand new
-- functions to `anon`. So any signed-in user who knew a vehicle id could
-- move that vehicle's test due date to 2099 (the RPC only moves dates
-- forward, never back) and silence its owner's test reminders, or trigger
-- pushes to that owner.
--
-- Its only caller is the gov-sync-vehicles Edge Function, which uses the
-- service role (grep of src/ and supabase/functions/, 2026-09-24). So:
-- revoked from public, anon and authenticated, granted to service_role.
-- Nothing in the app loses access.
--
-- ═══ THE BUG ═══════════════════════════════════════════════════════════════
--
-- The notification text is chosen from what changed, and the branches only
-- looked at km and test_due_date. A vehicle with a NEW test whose due date
-- the owner had already typed in by hand (so last_test_date moved but
-- test_due_date did not) fell into the km-only branch:
--
--   "הקילומטראז׳ של X עודכן ל-Y ק״מ לפי נתוני משרד התחבורה."
--
-- The test was recorded; the push just never mentioned it. Seen once in the
-- two days after the 2026-09-23 backlog cleared (km_updated and
-- test_date_updated, not test_due_date_updated, old due >= ministry due).
--
-- The other km-only pushes from those days are a DIFFERENT bug: a failed
-- ministry request was read as "no test data". That one is fixed in
-- supabase/functions/gov-sync-vehicles, and this file does not touch it.
--
-- ═══ THE CHANGE ════════════════════════════════════════════════════════════
--
-- One new branch, between the full-message branch and the km-only one, for
-- "km and last_test_date moved, the due date did not":
--
--   "זיהינו שביצעת טסט ל<X>. הקילומטראז׳ עודכן ל-<Y> ק״מ, ותוקף הטסט הבא (<date>) כבר היה מעודכן אצלך."
--
-- The "already up to date" clause appears only when the stored due date
-- really is at or past the ministry's; otherwise the sentence ends after
-- the km. Every other line is the live body, byte-for-byte: the file was
-- generated from it, and the generator refused to write anything if more
-- than this branch differed.
--
-- ═══ BUILT ON THE LIVE FUNCTION, NOT ON THE ROOT FILE ══════════════════════
--
-- Source: scripts/supabase-gov-sync-heartbeat-fix-2026-06-26.sql, whose
-- body matched the live function on 2026-09-24:
--   md5(prosrc) = a17603fcd269fc5b24b7393e6399f089 (LF form of that file)
-- supabase-gov-sync-detector.sql still holds the pre-fix RPC that returns
-- early without stamping last_gov_sync_at. Never build on it, never replay it.
--
-- Independent of the gov-sync-vehicles deploy: either can go first.
--
-- ═══ VERIFY AFTER RUNNING ══════════════════════════════════════════════════
--
--   select md5(p.prosrc) <> 'a17603fcd269fc5b24b7393e6399f089'              as changed,
--          p.prosrc like '%v_should_update_km and v_should_update_test then%' as has_new_branch,
--          (select count(*) from regexp_matches(p.prosrc,
--             'last_gov_sync_at\s*=\s*now\(\)', 'g'))                       as heartbeat_stamps,
--          has_function_privilege('anon',          p.oid, 'execute')         as anon_can,
--          has_function_privilege('authenticated', p.oid, 'execute')         as authed_can,
--          has_function_privilege('service_role',  p.oid, 'execute')         as service_can
--   from pg_proc p
--   where p.proname = 'record_gov_sync_update';
--
--   Expected: true, true, 2, false, false, true.
--
-- Rollback of the text: run scripts/supabase-gov-sync-heartbeat-fix-2026-06-26.sql.
-- Do NOT roll the grants back; there is no caller that needs them.
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

-- Only the gov-sync-vehicles Edge Function calls this, with the service role.
-- See the SECURITY section above for why no client role may.
revoke execute on function public.record_gov_sync_update(uuid, integer, date, date)
  from public, anon, authenticated;
grant execute on function public.record_gov_sync_update(uuid, integer, date, date)
  to service_role;

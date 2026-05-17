-- ═══════════════════════════════════════════════════════════════════════════
-- gov.il auto-sync detector (Phase 2) — RPC that the gov-sync-vehicles
-- Edge Function calls once per vehicle. Decides what to update based on
-- the values returned by data.gov.il + the per-vehicle state stored on
-- our side (last_manual_km_update_at, auto_sync_enabled).
--
-- Pipeline:
--   1. pg_cron schedule fires daily → POSTs to `gov-sync-vehicles`
--      Edge with a shared secret.
--   2. Edge pulls every vehicle that needs sync (auto_sync_enabled &&
--      license_plate present && older than 20h since last sync),
--      queries data.gov.il by mispar_rechev for each.
--   3. Per vehicle, Edge calls record_gov_sync_update(...) with the
--      fresh ministry values. THIS RPC decides:
--        a. Always: stamp last_gov_sync_at, last_gov_sync_km,
--           last_gov_sync_test_date.
--        b. test_due_date / last_test_date: update if the ministry's
--           value is strictly later than ours.
--        c. current_km: update only if the new km is strictly larger
--           AND the user hasn't manually overridden after the test.
--        d. If anything user-visible changed, insert app_notifications
--           and log the event in gov_sync_log (idempotency).
--
-- Idempotency:
--   UNIQUE (vehicle_id, gov_test_date) on gov_sync_log prevents the
--   same test event from generating two notifications. A re-run of the
--   cron the next morning is a no-op for already-logged events.
--
-- Compatibility with the existing record_test_renewal RPC:
--   This RPC SUPERSEDES record_test_renewal for vehicles that have
--   auto_sync_enabled=true (the default). The old check-test-renewals
--   Edge Function can keep running during transition without harm —
--   the two paths converge on the same test_due_date value. Once the
--   new pipeline is verified in staging, the old cron schedule can
--   be unscheduled.
--
-- Idempotent migration: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Idempotency journal ────────────────────────────────────────────────────
create table if not exists public.gov_sync_log (
  id                        uuid primary key default gen_random_uuid(),
  vehicle_id                uuid not null references public.vehicles(id) on delete cascade,
  account_id                uuid not null references public.accounts(id) on delete cascade,
  user_id                   uuid references auth.users(id) on delete set null,
  -- Snapshot of what the ministry said at detection time.
  gov_km                    integer,
  gov_test_date             date,
  gov_test_due_date         date,
  -- Snapshot of what we had stored locally before the sync.
  old_km                    integer,
  old_test_date             date,
  old_test_due_date         date,
  -- Which fields actually got changed in this round (the others were
  -- either already up-to-date or were blocked by a manual override).
  km_updated                boolean not null default false,
  test_date_updated         boolean not null default false,
  test_due_date_updated     boolean not null default false,
  detected_at               timestamptz not null default now(),
  notification_id           uuid references public.app_notifications(id) on delete set null,
  -- Natural idempotency key: a given vehicle + ministry test date
  -- combination can only be processed once. Re-runs short-circuit on
  -- the conflict path below.
  unique (vehicle_id, gov_test_date)
);

create index if not exists gov_sync_log_account_perf_idx
  on public.gov_sync_log(account_id, detected_at desc);

alter table public.gov_sync_log enable row level security;

-- Read-only access for users that belong to the vehicle's account.
-- Writes come exclusively from the SECURITY DEFINER RPC below.
drop policy if exists gov_sync_log_select_own on public.gov_sync_log;
create policy gov_sync_log_select_own
  on public.gov_sync_log for select
  using (
    exists (
      select 1
      from public.account_members m
      where m.account_id = gov_sync_log.account_id
        and m.user_id    = auth.uid()
        and m.status     = 'פעיל'
    )
  );


-- ── The detector RPC ───────────────────────────────────────────────────────
-- Called by the Edge Function once per vehicle whose ministry data is
-- fresher than our local snapshot. Decides which subset of fields to
-- update based on the per-vehicle state, applies them atomically, logs
-- the event, and creates a single bell notification summarising what
-- changed.
--
-- Returns:
--   notification_id — the app_notifications row that was inserted
--                     (null if nothing was user-visible)
--   km_updated      — true if current_km was overwritten
--   test_updated    — true if test_due_date or last_test_date moved
--   was_new         — false on duplicate (idempotent short-circuit)
create or replace function public.record_gov_sync_update(
  p_vehicle_id             uuid,
  p_gov_km                 integer,
  p_gov_test_date          date,
  p_gov_test_due_date      date
)
returns table (
  notification_id   uuid,
  km_updated        boolean,
  test_updated      boolean,
  was_new           boolean
)
language plpgsql
security definer
set search_path = public
as $$
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
  -- Row-lock the vehicle to prevent a concurrent EditVehicle save
  -- from racing past our comparison.
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

  -- Sanity guard: a row whose user disabled auto-sync should never
  -- have reached the Edge candidate query, but check here anyway so
  -- a misconfigured cron run can't silently overwrite their data.
  if v_auto_sync_enabled is false then
    return query select null::uuid, false, false, false;
    return;
  end if;

  -- Idempotency probe.
  -- For (vehicle, gov_test_date) we either find a prior row and
  -- short-circuit, or we proceed. Test date is the natural key
  -- because the ministry only changes it when a real test occurs.
  if p_gov_test_date is not null then
    select gs.id, gs.notification_id
      into v_existing_log_id, v_notification_id
    from public.gov_sync_log gs
    where gs.vehicle_id = p_vehicle_id
      and gs.gov_test_date = p_gov_test_date
    limit 1;

    if found then
      return query select v_notification_id, false, false, false;
      return;
    end if;
  end if;

  -- ── Decide what to update ─────────────────────────────────────────
  --
  -- km: gate behind both "new is larger" AND "user hasn't manually
  -- overridden". An odometer can't physically go backward, so a
  -- smaller new value means a bad gov.il record — skip.
  if p_gov_km is not null
     and p_gov_km > coalesce(v_old_km, 0) then
    if v_last_manual_km_update is null
       or p_gov_test_date is null
       or v_last_manual_km_update < (p_gov_test_date::timestamptz) then
      v_should_update_km := true;
    end if;
  end if;

  -- test_due_date: only forward in time. The ministry never moves
  -- it back, so a smaller value indicates an API artefact.
  if p_gov_test_due_date is not null
     and (v_old_test_due_date is null
          or p_gov_test_due_date > v_old_test_due_date) then
    v_should_update_test_due := true;
  end if;

  -- last_test_date: forward in time too. Distinct from
  -- test_due_date — a vehicle in for an unscheduled check may bump
  -- last_test_date without changing the next-due window.
  if p_gov_test_date is not null
     and (v_old_test_date is null
          or p_gov_test_date > v_old_test_date) then
    v_should_update_test := true;
  end if;

  -- ── Apply the updates ─────────────────────────────────────────────
  -- Build an UPDATE that touches only the columns that actually
  -- changed, plus the always-updated sync snapshot columns. The
  -- snapshot columns let the Edge tell next time "we already saw
  -- this version" without re-hitting gov.il.
  update public.vehicles
    set
      current_km              = case when v_should_update_km       then p_gov_km             else current_km              end,
      last_test_date          = case when v_should_update_test     then p_gov_test_date      else last_test_date          end,
      test_due_date           = case when v_should_update_test_due then p_gov_test_due_date  else test_due_date            end,
      last_gov_sync_at        = now(),
      last_gov_sync_km        = p_gov_km,
      last_gov_sync_test_date = p_gov_test_date
  where id = p_vehicle_id;

  -- ── Resolve recipient + build notification copy ───────────────────
  -- Notify the vehicle's primary owner. Shared users will see the
  -- update reflected on the row itself when they open the app; we
  -- avoid fanning notifications out to everyone to keep the bell
  -- quiet — matches the same restraint record_test_renewal uses.
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

  -- Only insert a notification when something user-visible changed.
  -- A pure "snapshot refreshed, nothing moved" run shouldn't ping
  -- the user — that would devalue every other notification.
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

  -- Log the detection (idempotency journal). The ON CONFLICT clause
  -- handles a race where two cron runs hit the same vehicle inside
  -- the same second — only the first row wins.
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
$$;

grant execute on function public.record_gov_sync_update(uuid, integer, date, date)
  to authenticated, service_role;


-- ── pg_cron schedule (uncomment after the Edge Function is deployed) ──────
-- Daily at 03:00 IST (00:00 UTC during winter / 23:00 UTC the previous
-- day in summer). Off-hours to avoid contention with the app's morning
-- usage spike and to give the ministry's nightly data refresh time to
-- finish (their datasets are reloaded around midnight).
--
-- SELECT cron.schedule(
--   'gov-sync-vehicles-daily',
--   '0 0 * * *',                                       -- adjust for DST
--   $$
--   SELECT net.http_post(
--     url     := 'https://<your-project>.supabase.co/functions/v1/gov-sync-vehicles',
--     headers := jsonb_build_object(
--       'Content-Type',      'application/json',
--       'Authorization',     'Bearer <SERVICE_ROLE_KEY>',
--       'X-Dispatch-Secret', '<DISPATCH_SECRET>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
--
-- To see scheduled jobs:    SELECT * FROM cron.job;
-- To see last runs:         SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- To unschedule:            SELECT cron.unschedule('gov-sync-vehicles-daily');
-- To unschedule the OLDER test-only cron (after verifying the new pipeline):
--                           SELECT cron.unschedule('test-renewal-detector-daily');


-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT count(*) FROM public.gov_sync_log;
-- SELECT * FROM public.gov_sync_log ORDER BY detected_at DESC LIMIT 10;

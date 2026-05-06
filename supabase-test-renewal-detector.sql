-- ═══════════════════════════════════════════════════════════════════════════
-- Test renewal detector — auto-update test_due_date from gov.il +
-- notify the owner when the ministry's `tokef_dt` for one of their
-- vehicles moves into the future (which means the annual test was
-- performed and a new sticker was issued).
--
-- Pipeline:
--   1. pg_cron job fires daily at 09:00 Israel time → POSTs to the
--      `check-test-renewals` Edge Function with a shared secret.
--   2. The function pulls every vehicle with test_due_date in
--      [today − 7, today + 30], queries data.gov.il by mispar_rechev,
--      compares the fresh tokef_dt to the stored value, and on a
--      strict increase calls record_test_renewal() (this RPC).
--   3. record_test_renewal() updates vehicles.test_due_date, inserts
--      a row into app_notifications (which the bell renders + the
--      Capacitor LocalNotification side-effect picks up), and inserts
--      a row into test_renewal_log so a re-run of the cron the next
--      morning doesn't re-fire the same notification.
--
-- Idempotency model:
--   UNIQUE (vehicle_id, new_test_due_date) on test_renewal_log means
--   the same renewal can never be processed twice. Re-running the
--   cron job, manual invocations, retry-on-error, and clock skew are
--   all safe.
--
-- Idempotent migration: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Idempotency journal ────────────────────────────────────────────────────
create table if not exists public.test_renewal_log (
  id                    uuid primary key default gen_random_uuid(),
  vehicle_id            uuid not null references public.vehicles(id) on delete cascade,
  account_id            uuid not null references public.accounts(id) on delete cascade,
  user_id               uuid references auth.users(id) on delete set null,
  old_test_due_date     date,
  new_test_due_date     date not null,
  detected_at           timestamptz not null default now(),
  notification_id       uuid references public.app_notifications(id) on delete set null,
  -- The exact (vehicle, new-date) pair is the natural idempotency key:
  -- two rows for the same vehicle+date can only mean a duplicate run.
  unique (vehicle_id, new_test_due_date)
);

create index if not exists test_renewal_log_account_perf_idx
  on public.test_renewal_log(account_id, detected_at desc);

alter table public.test_renewal_log enable row level security;

-- Read-only access for users who own (or share) the vehicle. Writes
-- come exclusively from the SECURITY DEFINER RPC below — never client.
drop policy if exists test_renewal_log_select_own on public.test_renewal_log;
create policy test_renewal_log_select_own
  on public.test_renewal_log for select
  using (
    exists (
      select 1
      from public.account_members m
      where m.account_id = test_renewal_log.account_id
        and m.user_id    = auth.uid()
        and m.status     = 'פעיל'
    )
  );


-- ── The detector RPC ───────────────────────────────────────────────────────
-- Called from the Edge Function once per vehicle whose ministry-side
-- tokef_dt is greater than the locally stored test_due_date. Atomic:
-- either the update + log row + notification all land, or none do.
--
-- Returns:
--   notification_id — the app_notifications row that was inserted
--                     (or null if this was a duplicate already logged)
--   was_new         — true on first detection, false on duplicate
create or replace function public.record_test_renewal(
  p_vehicle_id            uuid,
  p_new_test_due_date     date
)
returns table (notification_id uuid, was_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id          uuid;
  v_owner_user_id       uuid;
  v_old_test_due_date   date;
  v_nickname            text;
  v_license_plate       text;
  v_notification_id     uuid;
  v_log_id              uuid;
  v_already_logged      boolean;
  v_title               text;
  v_body                text;
begin
  -- Pull the row with FOR UPDATE so a concurrent invocation can't
  -- race past us between the comparison and the write.
  select v.account_id, v.test_due_date, v.nickname, v.license_plate
    into v_account_id, v_old_test_due_date, v_nickname, v_license_plate
  from public.vehicles v
  where v.id = p_vehicle_id
  for update;

  if not found then
    raise exception 'vehicle not found: %', p_vehicle_id
      using errcode = 'P0002';
  end if;

  -- Defensive: if the new date is not strictly later than what we
  -- already have, treat as a no-op. The Edge Function should have
  -- already filtered for this, but a stale call should not regress.
  if v_old_test_due_date is not null and p_new_test_due_date <= v_old_test_due_date then
    return query select null::uuid, false;
    return;
  end if;

  -- Idempotency probe — duplicate (vehicle, new-date) pair returns
  -- the existing row's notification id and exits.
  select tr.id, tr.notification_id
    into v_log_id, v_notification_id
  from public.test_renewal_log tr
  where tr.vehicle_id = p_vehicle_id
    and tr.new_test_due_date = p_new_test_due_date
  limit 1;

  if found then
    return query select v_notification_id, false;
    return;
  end if;

  -- Resolve which user to notify — for personal vehicles, the
  -- account's primary owner. For business workspaces the manager
  -- pattern is too noisy (every test event would page every viewer);
  -- we notify the workspace owner only and leave broader fan-out for
  -- a follow-up if it's needed in practice.
  select m.user_id
    into v_owner_user_id
  from public.account_members m
  where m.account_id = v_account_id
    and m.status     = 'פעיל'
    and m.role       in ('בעלים', 'owner')
  order by m.created_at asc
  limit 1;

  -- Fall back to ANY active member if no canonical owner row exists
  -- (legacy data — predates the role-strict migration).
  if v_owner_user_id is null then
    select m.user_id
      into v_owner_user_id
    from public.account_members m
    where m.account_id = v_account_id
      and m.status     = 'פעיל'
    order by m.created_at asc
    limit 1;
  end if;

  -- Apply the renewal to the vehicle row.
  update public.vehicles
    set test_due_date = p_new_test_due_date,
        updated_date  = now()
  where id = p_vehicle_id;

  -- Build the notification copy. The vehicle reference uses the
  -- nickname when set (most users have one), otherwise the plate so
  -- the user can still tell which car we mean.
  v_title := '✅ הטסט עודכן בהצלחה';
  v_body  := 'זיהינו שביצעת טסט ל'
          || coalesce(nullif(v_nickname, ''), v_license_plate, 'רכב')
          || '. תאריך הטסט הבא עודכן ל-'
          || to_char(p_new_test_due_date, 'DD/MM/YYYY')
          || '.';

  -- Insert the bell + push notification row. The realtime channel on
  -- app_notifications fires the bell refresh + the LocalNotification
  -- on the user's device automatically (see useSharedVehicleRealtime
  -- and NotificationBell's app_push_fired branch).
  if v_owner_user_id is not null then
    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      v_owner_user_id,
      'test_renewed',
      v_title,
      v_body,
      jsonb_build_object(
        'vehicle_id',          p_vehicle_id,
        'old_test_due_date',   v_old_test_due_date,
        'new_test_due_date',   p_new_test_due_date,
        'license_plate',       v_license_plate,
        'nickname',            v_nickname
      )
    )
    returning id into v_notification_id;
  end if;

  -- Log the detection so a re-run tomorrow can short-circuit.
  insert into public.test_renewal_log (
    vehicle_id, account_id, user_id,
    old_test_due_date, new_test_due_date, notification_id
  )
  values (
    p_vehicle_id, v_account_id, v_owner_user_id,
    v_old_test_due_date, p_new_test_due_date, v_notification_id
  )
  on conflict (vehicle_id, new_test_due_date) do nothing
  returning id into v_log_id;

  return query select v_notification_id, true;
end;
$$;

grant execute on function public.record_test_renewal(uuid, date) to authenticated, service_role;


-- ── pg_cron schedule (run AFTER the Edge Function is deployed) ─────────────
-- The ministry's daily refresh lands at ~08:00 Israel time. We run at
-- 09:00 (06:00 UTC during winter, 06:00 UTC during summer — Israel is
-- UTC+2 / UTC+3) to give the data layer an hour to settle.
--
-- Uncomment and edit the URL/secret, then run separately.
-- Requires pg_cron + pg_net extensions (enabled by default on Supabase).
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- SELECT cron.schedule(
--   'test-renewal-detector-daily',
--   '0 6 * * *',                                      -- 09:00 IST winter / 09:00 IDT — adjust for DST
--   $$
--   SELECT net.http_post(
--     url     := 'https://<your-project>.supabase.co/functions/v1/check-test-renewals',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
--       'X-Dispatch-Secret', '<DISPATCH_SECRET>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
--
-- To see scheduled jobs:    SELECT * FROM cron.job;
-- To see last runs:         SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- To unschedule:            SELECT cron.unschedule('test-renewal-detector-daily');


-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT count(*) FROM public.test_renewal_log;
-- SELECT * FROM public.test_renewal_log ORDER BY detected_at DESC LIMIT 10;

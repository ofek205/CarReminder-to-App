-- ═══════════════════════════════════════════════════════════════════════════
-- Push trigger — add app_notif_id to FCM/APNs data for client-side dedup
--
-- Background
-- ----------
-- An INSERT into app_notifications fans out to up to THREE notification
-- surfaces on a foregrounded native client:
--   (a) Push via dispatch-push → FCM/APNs → app receives it foregrounded
--       → pushNotifications.js forwardForegroundToLocal() schedules a
--       local banner 300ms in the future.
--   (b) useSharedVehicleRealtime sees the INSERT via the Realtime
--       channel → schedules its own local banner 1500ms in the future.
--   (c) NotificationBell on next fetch sees the unread row → schedules
--       a local banner 2s in the future on first-fetch only.
--
-- (b) and (c) already dedupe via a shared localStorage flag
--   `app_push_fired_<row.id>`
-- but (a) doesn't know the row id — the trigger sent only user_id +
-- title + body + data, never the row's own id. So a foregrounded user
-- saw TWO banners per event: one from (a), one from (b) or (c).
--
-- Fix
-- ---
-- Add the row id to the data jsonb under the key `app_notif_id`.
-- pushNotifications.js will read it and apply the same flag.
--
-- Safe to re-run: CREATE OR REPLACE FUNCTION + same trigger name.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.tg_app_notifications_dispatch_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_secret  text;
  v_has_dev boolean;
  v_url     text := 'https://zuqvolqapwcxomuzoodu.supabase.co/functions/v1/dispatch-push';
begin
  -- Cheap exit: no device tokens → no push possible.
  select exists (
    select 1 from public.device_tokens where user_id = new.user_id
  ) into v_has_dev;

  if not v_has_dev then
    return new;
  end if;

  -- Pull the shared secret from Vault. If it's missing we log a notice
  -- and return — better than throwing, because we don't want to block
  -- the bell notification path on push misconfiguration.
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'dispatch_secret'
  limit 1;

  if v_secret is null or length(v_secret) = 0 then
    raise notice 'dispatch_secret vault entry missing — push skipped for notif %', new.id;
    return new;
  end if;

  -- Fire-and-forget. pg_net puts the request on its async queue and
  -- the trigger returns immediately. Failures are visible in the
  -- net._http_response table for debugging.
  --
  -- The `data` payload merges three sources:
  --   1. The row's own `data` jsonb (e.g. {post_id, vehicle_id, …})
  --   2. The row's `type` (so the client deep-link router can pick
  --      a target screen via APP_NOTIF_CONFIG).
  --   3. `app_notif_id` = the row's primary key, so the foreground
  --      push handler can apply the same `app_push_fired_<id>`
  --      localStorage dedup flag that the Realtime mirror uses.
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type',      'application/json',
      'x-dispatch-secret', v_secret
    ),
    body := jsonb_build_object(
      'user_id', new.user_id,
      'title',   new.title,
      'body',    new.body,
      'data',    coalesce(new.data, '{}'::jsonb)
                  || jsonb_build_object('type', new.type, 'app_notif_id', new.id)
    )
  );

  return new;
end;
$$;

comment on function public.tg_app_notifications_dispatch_push()
  is 'Fire-and-forget pg_net call to dispatch-push after every app_notifications INSERT. Includes app_notif_id so the foreground push handler can dedupe vs the Realtime mirror.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Store-update notices: shown only on the platform they are about — 2026-09-26
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY: broadcast_app_update('ios', ...) writes one app_notifications row per
-- USER holding an iOS token. The row is per user, so the notification bell
-- showed "update to 6.5.14 in the App Store" on that user's Android phone and
-- on the website too (and dispatch-push pushed it to every device; fixed in
-- the function itself, same day).
--
-- HOW: a RESTRICTIVE select policy, which is ANDed with every permissive one
-- (app_notifs_select_own, and the view-as policy), so neither is redefined.
-- It hides a row only when BOTH hold:
--   type = 'app_update'  and  data->>'platform' is 'ios' or 'android'
--   and the request does not come from that app.
-- Every other notification reads exactly as before.
--
-- Depends on public.request_client_platform() from
-- supabase-release-announcement-platform-target-2026-09-26.sql (already
-- applied). If it is missing, this file fails on create, loudly.
--
-- Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.app_notification_visible(p_type text, p_data jsonb)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select case
    when p_type = 'app_update'
         and coalesce(p_data ->> 'platform', '') in ('ios', 'android')
      then (p_data ->> 'platform') = public.request_client_platform()
    else true
  end
$function$;

grant execute on function public.app_notification_visible(text, jsonb) to authenticated;

drop policy if exists app_notifs_platform_scope on public.app_notifications;
create policy app_notifs_platform_scope
  on public.app_notifications
  as restrictive
  for select
  to authenticated
  using (public.app_notification_visible(type, data));

commit;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY (SQL editor, which sends no request headers = 'web'):
--   select public.app_notification_visible('app_update', '{"platform":"ios"}'::jsonb);  -- false
--   select public.app_notification_visible('reminder',   '{"platform":"ios"}'::jsonb);  -- true
--   select public.app_notification_visible('app_update', '{}'::jsonb);                  -- true
--   select set_config('request.headers', '{"origin":"capacitor://localhost"}', true) as x,
--          public.app_notification_visible('app_update', '{"platform":"ios"}'::jsonb) as v; -- true
--   select polname, polpermissive, pg_get_expr(polqual, polrelid)
--     from pg_policy where polrelid = 'public.app_notifications'::regclass;
--     -- app_notifs_platform_scope with polpermissive = false
-- ═══════════════════════════════════════════════════════════════════════════

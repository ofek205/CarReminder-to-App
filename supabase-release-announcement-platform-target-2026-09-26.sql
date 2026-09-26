-- ═══════════════════════════════════════════════════════════════════════════
-- Release announcement: target a platform (iPhone / Android) — 2026-09-26
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY: Ofek wants a separate "what's new" popup for iPhone and for Android,
-- and none on the website. The popup lives in ONE app_config row
-- ('release_announcement'), and the native apps already in the stores read
-- that exact row directly (src/hooks/useReleaseAnnouncement.js). A client
-- change would only reach them after another store release on each
-- platform, so the targeting is done HERE, where it works for installed
-- builds today.
--
-- HOW: the row carries `platforms` (['ios'], ['android'] or both), and the
-- public read policy shows it only to a request whose Origin header matches:
--   capacitor://localhost  -> iOS app      (Capacitor's default iOS scheme)
--   https://localhost      -> Android app  (capacitor.config.ts androidScheme 'https')
--   anything else          -> web, which never sees the popup.
-- Fails CLOSED: an unrecognised origin, or no header at all, sees nothing.
--
-- LIMITS, deliberate:
--   - Still one row, so one live announcement at a time. Publishing for
--     Android replaces an iPhone one for anyone who has not opened the app
--     yet. Two simultaneous texts need a client change + store releases.
--   - Admins keep seeing the row everywhere: app_config_admin_write is
--     FOR ALL, which includes SELECT. To check the targeting on a phone,
--     use a NON-admin account.
--   - A row published before this file (no `platforms`) keeps its old
--     meaning for the apps: every native app. The web stops seeing it.
--
-- Re-runnable. Replaces the 4-arg publish RPC (quiet-edit version,
-- 2026-06-06) with a 5-arg one; the old admin client, which sends 4 named
-- args, keeps working and targets both apps by default.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Which client sent this request? ─────────────────────────────────────
create or replace function public.request_client_platform()
returns text
language sql
stable
set search_path to 'public'
as $function$
  select case coalesce(
           (nullif(current_setting('request.headers', true), '')::json) ->> 'origin',
           '')
    when 'capacitor://localhost' then 'ios'
    when 'https://localhost'     then 'android'
    when 'http://localhost'      then 'android'  -- older Android scheme; web dev always carries a port
    else 'web'
  end
$function$;

-- ── 2. May this request see the announcement row? ─────────────────────────
create or replace function public.release_announcement_visible(p_value jsonb)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select case
    when public.request_client_platform() = 'web' then false
    when jsonb_typeof(p_value -> 'platforms') = 'array'
      then (p_value -> 'platforms') ? public.request_client_platform()
    else true  -- legacy row without targeting: every native app, as before
  end
$function$;

grant execute on function public.request_client_platform() to anon, authenticated;
grant execute on function public.release_announcement_visible(jsonb) to anon, authenticated;

-- ── 3. The public read policy, now blind to the announcement off-target ───
-- Every other key reads exactly as before (using true).
drop policy if exists app_config_public_read on public.app_config;
create policy app_config_public_read
  on public.app_config
  for select
  to anon, authenticated
  using (key <> 'release_announcement' or public.release_announcement_visible(value));

-- ── 4. Publish RPC with a target ──────────────────────────────────────────
drop function if exists public.publish_release_announcement(text, text, boolean, boolean);

create or replace function public.publish_release_announcement(
  p_title     text,
  p_body      text,
  p_clear     boolean DEFAULT false,
  p_keep_id   boolean DEFAULT false,
  p_platforms text[]  DEFAULT array['ios', 'android']
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id        text;
  v_platforms text[];
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if p_clear then
    delete from public.app_config where key = 'release_announcement';
    return jsonb_build_object('ok', true, 'action', 'cleared');
  end if;

  if coalesce(btrim(p_body), '') = '' then
    raise exception 'empty_body: announcement text is required';
  end if;

  -- Distinct, known values only, in a stable order.
  select array_agg(p order by p) into v_platforms
    from (select distinct p from unnest(coalesce(p_platforms, array[]::text[])) as p) s;
  if v_platforms is null or cardinality(v_platforms) = 0 then
    raise exception 'no_platform: choose at least one platform';
  end if;
  if not (v_platforms <@ array['android', 'ios']) then
    raise exception 'bad_platform: only ios and android are allowed';
  end if;

  if p_keep_id then
    select value ->> 'id' into v_id from public.app_config where key = 'release_announcement';
  end if;
  if v_id is null or v_id = '' then
    v_id := gen_random_uuid()::text;
  end if;

  insert into public.app_config (key, value, updated_at)
  values (
    'release_announcement',
    jsonb_build_object(
      'id',           v_id,
      'title',        left(coalesce(btrim(p_title), ''), 120),
      'body',         left(btrim(p_body), 2000),
      'platforms',    to_jsonb(v_platforms),
      'published_at', now()
    ),
    now()
  )
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true,
    'action', case when p_keep_id then 'edited' else 'published' end,
    'id', v_id,
    'platforms', to_jsonb(v_platforms));
end;
$function$;

-- SECURITY DEFINER functions are executable by PUBLIC (anon included) on
-- creation. is_admin() already refuses, but nobody else should reach it.
revoke execute on function public.publish_release_announcement(text, text, boolean, boolean, text[]) from public, anon;
grant execute on function public.publish_release_announcement(text, text, boolean, boolean, text[]) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY (SQL editor). The editor sends no request headers, so the first
-- line must say 'web'.
--   select public.request_client_platform();                                   -- 'web'
--   select public.release_announcement_visible('{"platforms":["ios"]}'::jsonb); -- false (web)
--   select polname, pg_get_expr(polqual, polrelid)
--     from pg_policy where polrelid = 'public.app_config'::regclass;           -- new using()
--   select pg_get_function_identity_arguments(oid)
--     from pg_proc where proname = 'publish_release_announcement';            -- ONE row, 5 args
-- Simulate an iPhone request:
--   select set_config('request.headers', '{"origin":"capacitor://localhost"}', true),
--          public.request_client_platform();                                  -- 'ios'
-- ═══════════════════════════════════════════════════════════════════════════

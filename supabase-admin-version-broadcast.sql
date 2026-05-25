-- ==========================================================================
-- broadcast_app_update — admin-only RPC for version update management.
--
-- Sets the latest version for a given platform (ios / android) in
-- app_config, then bulk-inserts an app_update notification into
-- app_notifications for every user on that platform who has a registered
-- device token (i.e. has the native app installed). Optionally filters
-- by users whose last-known app version is older than the target.
--
-- The notification rows make the update appear in the bell and the
-- Notifications page. The useUpdateAvailable hook picks up the new
-- app_config value on its next refresh cycle and shows the banner.
--
-- Admin guard: uses public.is_admin() — same gate as AdminDashboard.
-- Idempotent: safe to re-run.
-- ==========================================================================

create or replace function public.broadcast_app_update(
  p_platform   text,          -- 'ios' | 'android'
  p_version    text,           -- e.g. '5.1.0'
  p_clear      boolean default false  -- if true, nullify the version (stop prompting)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config_key   text;
  v_new_value    jsonb;
  v_notif_count  int := 0;
  v_user_ids     uuid[];
begin
  -- ── Guard: admin only ──────────────────────────────────────────────
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  -- ── Validate platform ─────────────────────────────────────────────
  if p_platform not in ('ios', 'android') then
    raise exception 'invalid_platform: must be ios or android';
  end if;

  -- ── Resolve config key ────────────────────────────────────────────
  v_config_key := p_platform || '_latest_version';

  -- ── Update or clear app_config ────────────────────────────────────
  if p_clear then
    -- Nullify: removes the prompt entirely. Users won't see the banner
    -- until a new version is set. We delete the key so
    -- useUpdateAvailable's NULL check ("if latest_version IS NULL →
    -- never show") takes effect immediately.
    delete from public.app_config where key = v_config_key;
    return jsonb_build_object(
      'ok', true,
      'action', 'cleared',
      'platform', p_platform,
      'notifications_sent', 0
    );
  end if;

  -- ── Validate version format (loose semver: digits.digits.digits) ──
  if p_version !~ '^\d+\.\d+\.\d+$' then
    raise exception 'invalid_version_format: expected X.Y.Z';
  end if;

  v_new_value := to_jsonb(p_version);

  -- ── Upsert app_config ─────────────────────────────────────────────
  insert into public.app_config (key, value, updated_at)
  values (v_config_key, v_new_value, now())
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = excluded.updated_at;

  -- ── Gather target user IDs ────────────────────────────────────────
  -- Users who have a device_token on the target platform. This is the
  -- best proxy for "has the native app installed on this platform".
  -- We de-duplicate by user_id since a user may have multiple tokens
  -- (e.g. re-installs, multiple devices).
  select array_agg(distinct dt.user_id)
  into v_user_ids
  from public.device_tokens dt
  where dt.platform = p_platform;

  -- If nobody has registered a token on this platform yet, just update
  -- the config and return early. The banner will still show on next
  -- app launch via useUpdateAvailable.
  if v_user_ids is null or array_length(v_user_ids, 1) is null then
    return jsonb_build_object(
      'ok', true,
      'action', 'config_updated',
      'platform', p_platform,
      'version', p_version,
      'notifications_sent', 0
    );
  end if;

  -- ── Dedup: remove previous unread app_update for this platform ────
  -- Prevents duplicate notifications when admin broadcasts the same or
  -- a newer version before users read the old one. Read notifications
  -- are kept for history.
  delete from public.app_notifications
  where type = 'app_update'
    and is_read = false
    and data->>'platform' = p_platform;

  -- ── Bulk-insert app_update notifications ──────────────────────────
  -- One notification per user on the target platform. Title and body
  -- are in Hebrew (consistent with all other notification types).
  insert into public.app_notifications (user_id, type, title, body, data)
  select
    uid,
    'app_update',
    'עדכון גרסה זמין',
    'גרסה ' || p_version || ' זמינה להורדה. עדכן/י עכשיו לחוויה הטובה ביותר.',
    jsonb_build_object('version', p_version, 'platform', p_platform)
  from unnest(v_user_ids) as uid;

  get diagnostics v_notif_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'action', 'broadcast',
    'platform', p_platform,
    'version', p_version,
    'notifications_sent', v_notif_count
  );
end;
$$;

-- ── Read helper: current versions + last update timestamps ──────────
-- Convenience wrapper so the admin tab can get both platforms in one
-- call without building a multi-key .in() on the client side.
create or replace function public.get_app_versions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb := '{}'::jsonb;
  r record;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  for r in
    select key, value, updated_at
    from public.app_config
    where key in (
      'ios_latest_version', 'android_latest_version',
      'ios_min_version', 'android_min_version'
    )
  loop
    v_result := v_result || jsonb_build_object(
      r.key, jsonb_build_object('value', r.value, 'updated_at', r.updated_at)
    );
  end loop;

  -- Add device token counts per platform for the stats badges.
  v_result := v_result || jsonb_build_object(
    'device_counts', (
      select coalesce(jsonb_object_agg(platform, cnt), '{}'::jsonb)
      from (
        select platform, count(distinct user_id) as cnt
        from public.device_tokens
        group by platform
      ) sub
    )
  );

  return v_result;
end;
$$;

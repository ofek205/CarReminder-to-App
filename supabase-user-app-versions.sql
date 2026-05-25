-- ==========================================================================
-- user_app_versions — lightweight version heartbeat.
--
-- One row per user. Upserted silently on each native app launch via the
-- useUpdateAvailable hook (which already resolves platform + version).
-- Web users are excluded (version is meaningless — they always get the
-- latest deploy).
--
-- Used by the admin analytics dashboard to show version distribution:
--   "30 users on 5.1.0, 12 on 5.0.2, 4 on 4.8.0"
--
-- Zero user-facing impact. The upsert is fire-and-forget; failures are
-- silently swallowed so a network blip never affects the user's session.
--
-- Idempotent. Safe to re-run.
-- ==========================================================================

create table if not exists public.user_app_versions (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android')),
  app_version  text not null,
  last_seen_at timestamptz not null default now()
);

-- Index for the admin analytics query: group by (platform, app_version).
create index if not exists idx_user_app_versions_platform_version
  on public.user_app_versions(platform, app_version);

alter table public.user_app_versions enable row level security;

-- Users can read/write only their own row.
drop policy if exists uav_select_own on public.user_app_versions;
create policy uav_select_own
  on public.user_app_versions for select
  using (auth.uid() = user_id);

drop policy if exists uav_insert_own on public.user_app_versions;
create policy uav_insert_own
  on public.user_app_versions for insert
  with check (auth.uid() = user_id);

drop policy if exists uav_update_own on public.user_app_versions;
create policy uav_update_own
  on public.user_app_versions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── RPC: report_app_version ─────────────────────────────────────────
-- Called from the client on each native app launch. Upserts the user's
-- current platform + version. Lightweight — no joins, no side effects.
create or replace function public.report_app_version(
  p_platform    text,
  p_version     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if p_platform not in ('ios', 'android') then return; end if;
  if p_version is null or p_version = '' then return; end if;

  insert into public.user_app_versions (user_id, platform, app_version, last_seen_at)
  values (auth.uid(), p_platform, p_version, now())
  on conflict (user_id) do update
    set platform     = excluded.platform,
        app_version  = excluded.app_version,
        last_seen_at = excluded.last_seen_at;
end;
$$;

-- ── RPC: get_version_distribution (admin only) ──────────────────────
-- Returns version distribution per platform for the analytics chart.
create or replace function public.get_version_distribution()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return (
    select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb)
    from (
      select
        platform,
        app_version,
        count(*) as user_count,
        max(last_seen_at) as latest_seen
      from public.user_app_versions
      group by platform, app_version
      order by platform, user_count desc
    ) r
  );
end;
$$;

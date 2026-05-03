-- ==========================================================================
-- App Config — store app-wide configuration values that the client reads
-- on boot (currently used for the minimum-supported app version per
-- platform; can grow into feature flags / remote kill-switches later).
--
-- Read access: PUBLIC (anon + authenticated). The version check runs
-- BEFORE the user signs in, so the row needs to be readable to anon.
-- Write access: not exposed via RLS. Updates go through the Supabase
-- dashboard (or a future SECURITY DEFINER admin RPC).
--
-- Idempotent. Safe to re-run.
-- ==========================================================================

create table if not exists public.app_config (
  key        text primary key,
  value      jsonb        not null,
  updated_at timestamptz  not null default now()
);

alter table public.app_config enable row level security;

drop policy if exists app_config_public_read on public.app_config;
create policy app_config_public_read
  on public.app_config
  for select
  to anon, authenticated
  using (true);

-- Seed initial values. Both platforms start at 2.9.0 — the current
-- shipping version. Bump these whenever you want to force users off
-- an older build:
--   update public.app_config set value = '"3.0.0"'
--    where key = 'android_min_version';
insert into public.app_config (key, value) values
  ('android_min_version', '"2.9.0"'::jsonb),
  ('ios_min_version',     '"2.9.0"'::jsonb)
on conflict (key) do nothing;

-- ==========================================================================
-- Phase 3 — Workspace context switching: persistence
--
-- Adds the user_preferences table that remembers which workspace each
-- user was in last. Resolution order on boot is implemented client-side
-- in WorkspaceContext.jsx; this table only stores the hint.
--
-- Idempotent. Reversible (see ROLLBACK at bottom).
--
-- DO NOT APPLY TO PRODUCTION UNTIL STAGING/PROD DB SPLIT.
-- ==========================================================================

create table if not exists public.user_preferences (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  last_active_account_id  uuid     references public.accounts(id)    on delete set null,
  updated_at              timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

-- Policies: a user can only see and modify their own row. Standard
-- own-row pattern; mirrors what reminder_settings + user_profiles do.

drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own"
  on public.user_preferences
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_preferences_insert_own" on public.user_preferences;
create policy "user_preferences_insert_own"
  on public.user_preferences
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_preferences_update_own" on public.user_preferences;
create policy "user_preferences_update_own"
  on public.user_preferences
  for update
  to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on public.user_preferences to authenticated;

notify pgrst, 'reload schema';

-- ==========================================================================
-- ROLLBACK (manual)
--
--   drop table if exists public.user_preferences;
--
-- After rollback, WorkspaceContext falls back gracefully to the static
-- resolution order (no last-active hint). No data loss anywhere else.
-- ==========================================================================

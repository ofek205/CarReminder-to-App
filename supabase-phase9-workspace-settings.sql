-- ==========================================================================
-- Phase 9, Step 8 — Expose business_meta on v_user_workspaces
--
-- The frontend WorkspaceContext reads from v_user_workspaces. To let
-- managers configure per-workspace settings (e.g., hide Community/AI
-- from driver-role members), the meta field must be available there.
--
-- Idempotent. Reversible (re-run Phase 1 view to remove the column).
-- ==========================================================================

create or replace view public.v_user_workspaces
  with (security_invoker = true)
as
select
  m.user_id,
  m.account_id,
  m.role,
  m.status,
  m.joined_at,
  a.type          as account_type,
  a.name          as account_name,
  a.created_via   as account_created_via,
  a.owner_user_id,
  a.business_meta
  from public.account_members m
  join public.accounts a on a.id = m.account_id;

grant select on public.v_user_workspaces to authenticated;

notify pgrst, 'reload schema';

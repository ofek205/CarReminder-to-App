-- ==========================================================================
-- Phase 9, Step 1 — Workspace member directory
--
-- A SECURITY DEFINER function that returns the members of a workspace
-- with their display_name (from auth.users.raw_user_meta_data.full_name,
-- falling back to email prefix). The caller must be an active member
-- of that workspace.
--
-- Why: previous B2B UI showed user_id.slice(0,8) as a placeholder
-- because auth.users is not directly readable from postgrest. This
-- function closes the gap so Drivers / Fleet / BusinessDashboard pages
-- can render real names.
--
-- Idempotent. Reversible. Read-only function; safe on production.
-- ==========================================================================

create or replace function public.workspace_members_directory(p_account_id uuid)
returns table (
  user_id      uuid,
  role         text,
  status       text,
  email        text,
  display_name text,
  joined_at    timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  -- Alias the table so the user_id column is unambiguous against the
  -- function's OUT parameter of the same name. Newer PostgreSQL/PL/pgSQL
  -- builds raise 42702 here without the alias because the OUT parameter
  -- shadows the column in the EXISTS subquery, which broke the entire
  -- Drivers / Fleet / BusinessDashboard directory in production.
  if not exists (
    select 1 from public.account_members am
     where am.account_id = p_account_id
       and am.user_id    = auth.uid()
       and am.status     = 'פעיל'
  ) then
    raise exception 'forbidden_not_member';
  end if;

  return query
    select
      m.user_id,
      m.role,
      m.status,
      u.email::text,
      coalesce(
        nullif(u.raw_user_meta_data->>'full_name', ''),
        nullif(u.raw_user_meta_data->>'name', ''),
        split_part(u.email, '@', 1)
      ) as display_name,
      m.joined_at
      from public.account_members m
      join auth.users u on u.id = m.user_id
     where m.account_id = p_account_id
       and m.status not in ('הוסר', 'removed')
     order by
       case m.role
         when 'בעלים'  then 0
         when 'מנהל'   then 1
         when 'שותף'   then 2
         when 'driver' then 3
         else 9
       end,
       m.joined_at asc;
end;
$$;

revoke all  on function public.workspace_members_directory(uuid) from public;
grant execute on function public.workspace_members_directory(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ROLLBACK: drop function if exists public.workspace_members_directory(uuid);

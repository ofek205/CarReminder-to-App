-- ==========================================================================
-- Phase 9, Step 3.5b — Admin helper for business workspace requests
--
-- A SECURITY DEFINER function that returns the request rows joined
-- with the requesting user's email + display name. Caller must be
-- an admin (per public.is_admin()).
-- ==========================================================================

create or replace function public.admin_list_business_workspace_requests(
  p_status text default null
)
returns table (
  id                  uuid,
  requesting_user_id  uuid,
  email               text,
  display_name        text,
  requested_name      text,
  business_meta       jsonb,
  reason              text,
  status              text,
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  review_note         text,
  created_account_id  uuid,
  created_at          timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden_not_admin';
  end if;

  return query
    select
      r.id,
      r.requesting_user_id,
      u.email::text,
      coalesce(
        nullif(u.raw_user_meta_data->>'full_name', ''),
        nullif(u.raw_user_meta_data->>'name', ''),
        split_part(u.email, '@', 1)
      ) as display_name,
      r.requested_name,
      r.business_meta,
      r.reason,
      r.status,
      r.reviewed_by,
      r.reviewed_at,
      r.review_note,
      r.created_account_id,
      r.created_at
      from public.business_workspace_requests r
      join auth.users u on u.id = r.requesting_user_id
     where (p_status is null or r.status = p_status)
     order by r.created_at desc;
end;
$$;

revoke all on function public.admin_list_business_workspace_requests(text) from public;
grant execute on function public.admin_list_business_workspace_requests(text) to authenticated;

notify pgrst, 'reload schema';

-- ROLLBACK: drop function if exists public.admin_list_business_workspace_requests(text);

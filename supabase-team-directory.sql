-- ==========================================================================
-- workspace_team_directory — drivers + managers contact info
--
-- The original workspace_members_directory exposes display_name + email.
-- For the driver experience the team also needs phone numbers so a
-- driver can reach the fleet manager without leaving the app, and so
-- drivers can coordinate with each other (peer phone calls).
--
-- Phone comes from public.user_profiles.phone — the same field the
-- private app already collects via the profile-completion popup.
-- Members who never filled it get phone=null and the UI hides the row.
--
-- Caller must be an active member of the workspace. RLS-equivalent
-- check via account_members lookup.
-- ==========================================================================

create or replace function public.workspace_team_directory(p_account_id uuid)
returns table (
  user_id      uuid,
  role         text,
  status       text,
  email        text,
  display_name text,
  phone        text,
  joined_at    timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
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
      )::text as display_name,
      p.phone::text,
      m.joined_at
      from public.account_members m
      join auth.users u           on u.id      = m.user_id
      left join public.user_profiles p on p.user_id = m.user_id
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

revoke all  on function public.workspace_team_directory(uuid) from public;
grant execute on function public.workspace_team_directory(uuid) to authenticated;

notify pgrst, 'reload schema';

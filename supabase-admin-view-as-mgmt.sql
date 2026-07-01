-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-view-as-mgmt.sql — RPCs for the admin view-as management screen
--
-- Gives the admin visibility + control over impersonation sessions:
--   * admin_list_view_sessions() — recent sessions enriched with admin email,
--     target account name, target owner email, and an is_active flag.
--   * admin_force_end_view(session_id) — end any open session (kill switch).
--
-- Both SECURITY DEFINER + is_admin()-gated (only admins can read auth.users /
-- end sessions). force-end is audited via admin_log.
--
-- DEPENDS ON: public.is_admin(), public.admin_log(), admin_view_sessions.
-- Run ONCE in Supabase SQL Editor. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_list_view_sessions(p_limit integer default 50)
returns table (
  id                 bigint,
  admin_email        text,
  target_account_id  uuid,
  target_name        text,
  target_type        text,
  target_owner_email text,
  reason             text,
  started_at         timestamptz,
  expires_at         timestamptz,
  ended_at           timestamptz,
  is_active          boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  return query
  select
    s.id,
    au.email::text                                   as admin_email,
    s.target_account_id,
    coalesce(a.name, '')::text                       as target_name,
    coalesce(a.type, 'personal')::text               as target_type,
    tu.email::text                                   as target_owner_email,
    s.reason,
    s.started_at,
    s.expires_at,
    s.ended_at,
    (s.ended_at is null and s.expires_at > now())    as is_active
  from public.admin_view_sessions s
  left join auth.users   au on au.id = s.admin_user_id
  left join public.accounts a on a.id = s.target_account_id
  left join auth.users   tu on tu.id = s.target_user_id
  order by s.started_at desc
  limit least(coalesce(p_limit, 50), 200);
end;
$$;

grant execute on function public.admin_list_view_sessions(integer) to authenticated;


create or replace function public.admin_force_end_view(p_session_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  if not public.is_admin() then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  update public.admin_view_sessions
     set ended_at = now()
   where id = p_session_id
     and ended_at is null
  returning target_account_id into v_account;

  if v_account is not null then
    perform public.admin_log('view_force_end', 'view_session', p_session_id::text,
      jsonb_build_object('target_account_id', v_account));
  end if;
end;
$$;

grant execute on function public.admin_force_end_view(bigint) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY: select * from public.admin_list_view_sessions(20);
-- ═══════════════════════════════════════════════════════════════════════════

-- ==========================================================================
-- Invite role validation — strict instead of silent-coerce
-- Audit finding #18: if an invite row has role_to_assign = 'בעלים' (or any
-- garbage string), the old redeem_invite_token coerced it to 'שותף' without
-- warning. That silently downgrades any misconfigured invite and hides the
-- underlying bug (most likely a client bypassing the insert policy, or a
-- backfill script that set the wrong role). We'd rather raise loudly.
-- ==========================================================================

create or replace function public.redeem_invite_token(tok text)
returns table (
  id uuid, account_id uuid, role_to_assign text, status text,
  vehicle_ids uuid[],
  remaining_uses int, was_consumed boolean, already_member boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites%rowtype;
  uid uuid := auth.uid();
  is_member boolean;
  new_status text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Lock the row so concurrent redemptions don't race.
  select * into inv
  from public.invites
  where token = tok
  for update;

  if not found then
    raise exception 'invite_not_found';
  end if;

  if inv.status <> 'פעיל' then
    raise exception 'invite_not_active';
  end if;

  if inv.expires_at is not null and inv.expires_at < now() then
    update public.invites set status = 'פג תוקף' where id = inv.id;
    raise exception 'invite_expired';
  end if;

  if inv.uses_count >= inv.max_uses then
    raise exception 'invite_exhausted';
  end if;

  -- Already a member? Short-circuit without consuming the invite.
  select exists(
    select 1 from public.account_members
     where account_id = inv.account_id
       and user_id = uid
       and status = 'פעיל'
  ) into is_member;

  if is_member then
    return query
    select inv.id, inv.account_id, inv.role_to_assign, inv.status,
           inv.vehicle_ids,
           (inv.max_uses - inv.uses_count)::int,
           false, true;
    return;
  end if;

  -- Reject invalid roles instead of silently coercing. If this fires, it
  -- means the invite was created with a role this RPC isn't allowed to
  -- hand out (e.g. 'בעלים') — that's a bug in the invite creation path,
  -- not something we should paper over here.
  if inv.role_to_assign not in ('מנהל', 'שותף') then
    raise exception 'invalid_invite_role: %', inv.role_to_assign;
  end if;

  -- Create membership atomically with the redemption.
  insert into public.account_members (account_id, user_id, role, status, joined_at, vehicle_ids)
  values (inv.account_id, uid, inv.role_to_assign, 'פעיל', now(), inv.vehicle_ids);

  -- Increment & potentially close out the invite.
  new_status := case when inv.uses_count + 1 >= inv.max_uses then 'מומש' else inv.status end;
  update public.invites
     set uses_count = uses_count + 1,
         status = new_status
   where id = inv.id;

  return query
  select inv.id, inv.account_id, inv.role_to_assign, new_status,
         inv.vehicle_ids,
         (inv.max_uses - inv.uses_count - 1)::int,
         (inv.uses_count + 1 >= inv.max_uses),
         false;
end $$;

grant execute on function public.redeem_invite_token(text) to authenticated;

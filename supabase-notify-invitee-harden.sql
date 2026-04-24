-- ==========================================================================
-- notify_invitee_by_email — harden against email enumeration + spoofing
--
-- Original version (supabase-app-notifications.sql) had two issues:
--   1. Return value leaked whether an email was registered — any auth'd
--      user could loop to enumerate accounts.
--   2. No check that p_invite_id belongs to the caller — a user could
--      send a notification on someone else's invite with any p_role text
--      interpolated into the body.
--
-- Fix: require p_invite_id be owned by auth.uid(), and don't distinguish
-- success/"no such email" in the return value. Role is also whitelisted
-- so the title/body text stays bounded.
--
-- Idempotent.
-- ==========================================================================

create or replace function public.notify_invitee_by_email(
  p_email      text,
  p_invite_id  uuid,
  p_role       text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_uid   uuid;
  inviter_name text;
  inviter_uid  uuid := auth.uid();
begin
  if inviter_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_email is null or p_email = '' or p_invite_id is null then
    return true;                             -- silent no-op
  end if;

  -- Ownership: inviter must own the invite they're notifying on.
  -- Closes the spoofing vector where any user could push a row into
  -- any other user's app_notifications.
  if not exists (
    select 1 from public.invites
    where id = p_invite_id
      and invited_by_user_id = inviter_uid
  ) then
    raise exception 'invite_not_owned';
  end if;

  -- Whitelist role strings so the body text is bounded. Anything else
  -- is a programming error on the client, not user data.
  if p_role not in ('מנהל', 'שותף') then
    raise exception 'invalid_role';
  end if;

  select id into target_uid
    from auth.users
   where lower(email) = lower(p_email)
   limit 1;

  -- Silently no-op if the address isn't registered or is the caller.
  -- Returning true in both cases prevents enumeration.
  if target_uid is null or target_uid = inviter_uid then
    return true;
  end if;

  select coalesce(full_name, email, 'משתמש')
    into inviter_name
    from public.user_profiles up
   where up.user_id = inviter_uid
   limit 1;

  if inviter_name is null then
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
      into inviter_name
      from auth.users where id = inviter_uid;
  end if;

  insert into public.app_notifications (user_id, type, title, body, data)
  values (
    target_uid,
    'share_offered',
    coalesce(inviter_name, 'משתמש') || ' מזמין/ה אותך לשתף רכב',
    'אתה מוזמן להצטרף לחשבון כ־' || p_role || '. פתח את ההזמנה מקישור המייל.',
    jsonb_build_object(
      'invite_id',   p_invite_id,
      'inviter_id',  inviter_uid,
      'inviter_name',coalesce(inviter_name, 'משתמש'),
      'role',        p_role
    )
  );
  return true;
end $$;

grant execute on function public.notify_invitee_by_email(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';

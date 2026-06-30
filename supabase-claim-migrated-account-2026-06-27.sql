-- ==========================================================================
-- claim_migrated_account() — 2026-06-27
--
-- Links a first-login user to their pre-migrated Base44 account (if their
-- email is mapped in migration_email_map and not yet claimed), marks the
-- mapping claimed, and best-effort pre-fills the profile.
--
-- WHY an RPC: the client used to do this with a direct
--   db.account_members.create({ role:'בעלים', status:'פעיל' })
-- which the members_insert RLS policy rejects (it only ever allowed a 'שותף'
-- self-insert, and is now WITH CHECK(false)). So the Base44 claim silently
-- failed and the user got a fresh empty account instead of their migrated one.
-- SECURITY DEFINER bypasses RLS, so the owner-membership link works correctly.
--
-- Idempotent + defensive (no-ops if migration_email_map is absent or already
-- claimed). Additive — safe on the shared DB (prod's old client doesn't call
-- it). Run in Supabase SQL Editor.
-- ==========================================================================

create or replace function public.claim_migrated_account()
returns uuid                 -- claimed account_id, or null when there's no mapping
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  v_email text;
  v_map  record;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select lower(btrim(email)) into v_email from auth.users where id = uid;
  if coalesce(v_email, '') = '' then
    return null;
  end if;

  -- Find an unclaimed mapping for this email. The table may not exist in some
  -- environments — treat that as "no migration".
  begin
    select * into v_map
      from public.migration_email_map
     where lower(email) = v_email
       and claimed_by_user_id is null
     limit 1;
  exception when undefined_table then
    return null;
  end;

  if not found or v_map.account_id is null then
    return null;
  end if;

  -- Link the owner membership (idempotent — skip if already a member).
  if not exists (
    select 1 from public.account_members
     where account_id = v_map.account_id and user_id = uid
  ) then
    insert into public.account_members (account_id, user_id, role, status, joined_at)
      values (v_map.account_id, uid, 'בעלים', 'פעיל', now());
  end if;

  -- Mark the mapping claimed.
  update public.migration_email_map
     set claimed_by_user_id = uid, claimed_at = now()
   where lower(email) = v_email and claimed_by_user_id is null;

  -- Best-effort profile pre-fill from migration data (only if no profile yet).
  -- Wrapped so a missing column / type mismatch never fails the claim itself.
  begin
    if not exists (select 1 from public.user_profiles where user_id = uid) then
      insert into public.user_profiles
        (user_id, phone, birth_date, driver_license_number, license_expiration_date)
      values
        (uid, v_map.phone, v_map.birth_date, v_map.driver_license_number, v_map.license_expiration_date);
    end if;
  exception when others then
    null;
  end;

  return v_map.account_id;
end $$;

revoke all on function public.claim_migrated_account() from public;
grant execute on function public.claim_migrated_account() to authenticated;

notify pgrst, 'reload schema';

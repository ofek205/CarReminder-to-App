-- ==========================================================================
-- New-user bootstrap — guaranteed account + membership at signup time
--
-- Failure mode this fixes: a brand-new user signs up, lands on /Vehicles
-- (or any page that isn't /Dashboard) before /Dashboard has had a chance
-- to call ensure_user_account, finds zero account_members rows, and the
-- page sits forever on a loading skeleton because every account-aware
-- query gates on `accountId` (which never gets set).
--
-- Symptoms reported in production: skeletons that never resolve on
-- Vehicles, Dashboard sometimes works because that's the one page
-- wired to provision. The Google OAuth deep-link return path makes
-- this hit harder — the user lands on the route they came from, not
-- always /Dashboard.
--
-- Two-layer defense in this file:
--   1. ensure_user_account() — idempotent RPC the client can call
--      anywhere. Re-stated here so deployments without it (or with
--      drifted definitions) are made consistent.
--   2. Trigger on auth.users INSERT — server-side guarantee that
--      every new user gets exactly one account + 'בעלים' membership
--      row at signup time, before any page can mount. This is the
--      standard Supabase pattern; once it's in place, any client-side
--      provisioning is just a safety net.
--
-- Idempotent: safe to re-run.
-- ==========================================================================

-- 1. ensure_user_account() — restate.
-- Returns the account_id the caller belongs to (existing or newly created).
-- SECURITY DEFINER bypasses the members_insert_weak RLS policy that
-- rejects role='בעלים' on direct INSERT and was the original cause of
-- orphan accounts (Ilan / Eyal / nethanel834).
create or replace function public.ensure_user_account()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing_account_id uuid;
  new_account_id uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Already have an active membership? Prefer the user's own owner
  -- account if one exists — falling back to the oldest by joined_at
  -- only catches the edge case where someone accepted an invite
  -- before they ever got an owner account of their own.
  select a.id into existing_account_id
    from public.account_members am
    join public.accounts a on a.id = am.account_id
   where am.user_id = uid
     and am.status  = 'פעיל'
     and a.type     = 'personal'
   limit 1;

  if existing_account_id is not null then
    return existing_account_id;
  end if;

  -- Create account + membership atomically.
  insert into public.accounts (owner_user_id)
    values (uid)
    returning id into new_account_id;

  insert into public.account_members (account_id, user_id, role, status, joined_at)
    values (new_account_id, uid, 'בעלים', 'פעיל', now());

  return new_account_id;
end;
$$;

revoke all on function public.ensure_user_account() from public;
grant execute on function public.ensure_user_account() to authenticated;


-- 2. handle_new_user() trigger function.
-- Runs as the function owner (SECURITY DEFINER), so RLS doesn't apply.
-- Wrapped in EXCEPTION blocks so a transient failure on one of the
-- inserts can't reject the auth.users INSERT itself — losing a signup
-- because of a bootstrap glitch is worse than a user with no account
-- (the client RPC catches that case).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_account_id uuid;
begin
  -- If the user already has a membership (e.g. provisioned by a
  -- migration script before the trigger landed), do nothing.
  -- Skip only if the user already has a PERSONAL account. A user who
  -- was pre-added to a business workspace as driver/viewer before
  -- they signed up still needs their own personal account — without
  -- it the workspace switcher has no personal fallback, and the
  -- personal-flow pages (Dashboard, Vehicles, Documents…) have no
  -- account to scope to. The previous "any membership" check let
  -- pre-invited drivers slip through with no personal workspace.
  if exists (
    select 1
    from public.account_members am
    join public.accounts a on a.id = am.account_id
    where am.user_id = new.id
      and a.type    = 'personal'
      and am.status = 'פעיל'
  ) then
    return new;
  end if;

  begin
    insert into public.accounts (owner_user_id)
      values (new.id)
      returning id into new_account_id;

    insert into public.account_members (account_id, user_id, role, status, joined_at)
      values (new_account_id, new.id, 'בעלים', 'פעיל', now());
  exception when others then
    -- Don't block the signup, but DO surface the failure in
    -- Postgres logs so we notice when this fires. The client-side
    -- ensure_user_account() will recover on first authenticated
    -- render either way.
    raise warning 'handle_new_user failed for user_id=%: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- Drop & recreate the trigger so re-runs of this script keep one copy.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-account-owner-2026-07-24.sql
-- Admin control over business-workspace ownership.
--
-- WHY THIS EXISTS
--   transfer_ownership() cannot serve support cases. It refuses unless
--   auth.uid() IS the current owner (line "IF v_current_owner <> uid"), it
--   requires the heir to already be an active member, and it always writes a
--   new owner — there is no path that leaves an account without one. So when
--   a business workspace's owner leaves the company, or must be swapped for
--   someone else, nobody can fix it: not the owner (gone), not the members
--   (not authorised), not an admin (not the owner).
--
-- WHAT CHANGES
--   1. accounts.owner_user_id becomes NULLABLE. NULL now means "this business
--      workspace has no owner" — an explicit, visible state rather than an
--      impossible one.
--   2. admin_set_account_owner() lets an admin appoint, swap, or clear the
--      owner of a BUSINESS account, and choose what happens to the previous
--      one.
--
-- ON DELIBERATELY RELAXING THE INVARIANT
--   supabase-ownership-integrity-2026-06-26.sql set owner_user_id NOT NULL on
--   purpose ("ע3 — בעלים אחד תמיד"). Allowing NULL is a conscious product
--   decision, not an oversight. It is safe because every RLS policy that
--   grants owner powers keys off account_members.role = 'בעלים', never off
--   accounts.owner_user_id directly — so an ownerless workspace simply stops
--   authorising owner-level actions for everyone. It freezes rather than
--   leaks, and only an admin can unfreeze it.
--
--   The partial unique index accounts_one_personal_per_owner_uq is scoped
--   WHERE type = 'personal', so multiple NULL-owner BUSINESS rows do not
--   collide with it. Personal accounts are rejected by this RPC anyway — a
--   personal workspace without its owner is meaningless.
--
-- WHY NON-MEMBERS CAN BE APPOINTED
--   Requiring the new owner to already be a member deadlocks the exact case
--   this exists for: an ownerless workspace has nobody who can invite anyone,
--   so it could never regain an owner. Appointing creates the membership.
--   The target must still be a real registered user.
--
-- DEPENDS ON: public.is_admin(), public.admin_log(...). Re-runnable.
-- HOW TO APPLY: paste into Supabase SQL Editor and Run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Allow the ownerless state ──────────────────────────────────────────
alter table public.accounts alter column owner_user_id drop not null;


-- ── 2. admin_set_account_owner ────────────────────────────────────────────
create or replace function public.admin_set_account_owner(
  p_account_id        uuid,
  p_new_owner_user_id uuid,                      -- NULL ⇒ leave it ownerless
  p_remove_previous   boolean default false      -- true ⇒ remove, false ⇒ demote
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid             uuid := auth.uid();
  v_prev_owner    uuid;
  v_account_name  text;
  v_account_type  text;
  v_prev_action   text := 'none';
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'not_authorized';
  end if;

  select owner_user_id, name, type
    into v_prev_owner, v_account_name, v_account_type
    from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'account_not_found';
  end if;

  -- Personal workspaces are 1:1 with their owner; orphaning one would strand
  -- the user's own vehicles behind policies nobody can satisfy.
  if v_account_type is distinct from 'business' then
    raise exception 'not_a_business_account';
  end if;

  if p_new_owner_user_id is not null
     and not exists (select 1 from auth.users where id = p_new_owner_user_id) then
    raise exception 'new_owner_not_registered';
  end if;

  -- No-op guard: re-appointing the sitting owner would demote/remove them via
  -- the block below and leave the account ownerless by accident.
  if p_new_owner_user_id is not null and p_new_owner_user_id = v_prev_owner then
    return jsonb_build_object('ok', true, 'unchanged', true,
                              'account_id', p_account_id, 'owner_id', v_prev_owner);
  end if;

  -- ── previous owner ──
  if v_prev_owner is not null then
    if p_remove_previous then
      update public.account_members
         set status = 'הוסר'
       where account_id = p_account_id and user_id = v_prev_owner;

      -- Mirrors remove_account_member in supabase-membership-rpcs-2026-06-26
      -- exactly, including the 'revoked' + valid_to pair: an operational
      -- driver assignment must not outlive the membership that justified it
      -- (spec gap ג9). The status string matters — the partial unique index
      -- driver_assignments_user_unique_active keys off status = 'active', so
      -- any other value both frees the slot and stops the reminder-email
      -- candidate joins (which filter da.status = 'active') from picking the
      -- removed person up.
      update public.driver_assignments
         set status = 'revoked', valid_to = now()
       where driver_user_id = v_prev_owner
         and vehicle_id in (select id from public.vehicles where account_id = p_account_id)
         and status = 'active';

      v_prev_action := 'removed';
    else
      update public.account_members
         set role = 'מנהל'
       where account_id = p_account_id and user_id = v_prev_owner;
      v_prev_action := 'demoted';
    end if;
  end if;

  -- ── new owner ──
  if p_new_owner_user_id is not null then
    -- Appointing revives a previously-removed row rather than inserting a
    -- duplicate, which the partial unique index on active memberships would
    -- reject anyway.
    if exists (select 1 from public.account_members
                where account_id = p_account_id and user_id = p_new_owner_user_id) then
      update public.account_members
         set role = 'בעלים', status = 'פעיל'
       where account_id = p_account_id and user_id = p_new_owner_user_id;
    else
      insert into public.account_members (account_id, user_id, role, status, joined_at)
      values (p_account_id, p_new_owner_user_id, 'בעלים', 'פעיל', now());
    end if;

    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      p_new_owner_user_id,
      'account_ownership_received',
      'הפכת לבעלים של החשבון',
      'קיבלת בעלות על "' || coalesce(v_account_name, 'החשבון')
        || '" על ידי צוות המערכת. כעת יש לך שליטה מלאה.',
      jsonb_build_object('account_id', p_account_id, 'by_admin', true)
    );
  end if;

  update public.accounts
     set owner_user_id = p_new_owner_user_id
   where id = p_account_id;

  perform public.admin_log(
    'account_owner_changed',
    'account',
    p_account_id::text,
    jsonb_build_object(
      'previous_owner_id', v_prev_owner,
      'previous_action',   v_prev_action,
      'new_owner_id',      p_new_owner_user_id,
      'left_ownerless',    p_new_owner_user_id is null,
      'account_name',      v_account_name
    )
  );

  return jsonb_build_object(
    'ok',              true,
    'account_id',      p_account_id,
    'previous_owner',  v_prev_owner,
    'previous_action', v_prev_action,
    'new_owner_id',    p_new_owner_user_id,
    'ownerless',       p_new_owner_user_id is null
  );
end $$;

revoke all on function public.admin_set_account_owner(uuid, uuid, boolean) from public;
grant execute on function public.admin_set_account_owner(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- Verification (run after the above)
-- ═══════════════════════════════════════════════════════════════════════════
--   -- owner_user_id is nullable now:
--   select is_nullable from information_schema.columns
--    where table_name = 'accounts' and column_name = 'owner_user_id';   -- YES
--
--   -- Ownerless business workspaces (this is the admin alert list):
--   select id, name, created_at from public.accounts
--    where type = 'business' and owner_user_id is null;
--
--   -- Non-admins are refused (run as a normal user):
--   select public.admin_set_account_owner('<uuid>', null, false);       -- not_authorized
-- ═══════════════════════════════════════════════════════════════════════════

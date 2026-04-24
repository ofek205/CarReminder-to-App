-- ==========================================================================
-- delete_my_account(mode) — SECURITY DEFINER RPC
--
-- Replaces the DeleteAccount.jsx client-side delete loop. The old code ran
-- ~20 separate DELETE statements over 100+ lines, had a bug where
-- `.eq('vehicle_id', vehicles.map(...))` silently did nothing when passed
-- an array (audit finding C2), and had no transaction — a crash or network
-- hiccup mid-delete left partial state (cork_notes pointing at a deleted
-- vehicle, profile rows for an account that no longer exists, etc).
--
-- This RPC does the whole operation in a single transaction.
-- On failure, nothing is deleted (all-or-nothing).
--
-- Modes:
--   'data'    — delete all vehicles + community content but keep auth user
--               and accounts. User can start fresh afterwards.
--   'account' — delete vehicles, community content, account memberships.
--               If the user is sole owner of an account, delete the account
--               row too. The auth.users row is NOT deleted here (only the
--               user themselves can via supabase.auth.admin, and this
--               function's JWT gives it auth.uid(), not admin rights).
--
-- Safe to re-run (CREATE OR REPLACE).
-- ==========================================================================

create or replace function public.delete_my_account(mode text default 'data')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_ids uuid[];
  v_account_id uuid;
  v_vehicles_deleted int := 0;
  v_community_deleted int := 0;
  v_accounts_deleted int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if mode not in ('data', 'account') then
    raise exception 'invalid_mode: must be "data" or "account"';
  end if;

  -- Collect all account ids the caller is a member of.
  select array_agg(account_id)
    into v_account_ids
    from public.account_members
    where user_id = uid
      and status = 'פעיל';

  if v_account_ids is null then
    v_account_ids := array[]::uuid[];
  end if;

  -- 1. Delete vehicles. ON DELETE CASCADE on vehicles takes care of
  --    repair_logs, repair_attachments, accident_details, documents,
  --    cork_notes, maintenance_logs, vessel_issues, vessel_checklist_runs,
  --    notification_log (set up in supabase-critical-fixes.sql).
  foreach v_account_id in array v_account_ids
  loop
    with del as (
      delete from public.vehicles where account_id = v_account_id returning 1
    )
    select v_vehicles_deleted + count(*) into v_vehicles_deleted from del;
  end loop;

  -- 2. Delete community content owned by this user (NOT scoped to account —
  --    a user's posts/comments/likes belong to the user, not an account).
  with c1 as (delete from public.community_posts         where user_id = uid returning 1),
       c2 as (delete from public.community_comments      where user_id = uid returning 1),
       c3 as (delete from public.community_likes         where user_id = uid returning 1),
       c4 as (delete from public.community_reactions     where user_id = uid returning 1),
       c5 as (delete from public.community_saved         where user_id = uid returning 1),
       c6 as (delete from public.community_comment_likes where user_id = uid returning 1),
       c7 as (delete from public.community_notifications where user_id = uid returning 1)
  select (select count(*) from c1) + (select count(*) from c2) + (select count(*) from c3)
       + (select count(*) from c4) + (select count(*) from c5) + (select count(*) from c6)
       + (select count(*) from c7)
    into v_community_deleted;

  -- 3. Delete user-scoped records that don't live under an account.
  delete from public.user_profiles where user_id = uid;
  delete from public.anonymous_analytics where user_id = uid;
  delete from public.reminder_settings where user_id = uid;
  delete from public.maintenance_reminder_prefs where user_id = uid;

  -- 4. In 'data' mode we stop here — caller's account + membership stay so
  --    they can keep using the app with a clean slate.
  if mode = 'data' then
    return jsonb_build_object(
      'ok', true,
      'mode', 'data',
      'vehicles_deleted', v_vehicles_deleted,
      'community_deleted', v_community_deleted,
      'accounts_deleted', 0
    );
  end if;

  -- 5. 'account' mode: remove memberships and, for accounts where this user
  --    was the sole owner, delete the account row (cascades to remaining
  --    members and invites).
  foreach v_account_id in array v_account_ids
  loop
    -- Remove this user's membership first.
    delete from public.account_members
      where account_id = v_account_id and user_id = uid;

    -- If no owners remain on this account, nuke the account row.
    -- (Other members, if any, will also be removed via account_members FK.)
    if not exists (
      select 1 from public.account_members
       where account_id = v_account_id
         and role = 'בעלים'
         and status = 'פעיל'
    ) then
      delete from public.accounts where id = v_account_id;
      v_accounts_deleted := v_accounts_deleted + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'mode', 'account',
    'vehicles_deleted', v_vehicles_deleted,
    'community_deleted', v_community_deleted,
    'accounts_deleted', v_accounts_deleted
  );
end $$;

revoke all on function public.delete_my_account(text) from public;
grant execute on function public.delete_my_account(text) to authenticated;

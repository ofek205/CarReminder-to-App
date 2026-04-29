-- ==========================================================================
-- delete_my_account(mode) — patch for B2B tables
--
-- The original RPC (supabase-delete-account-rpc.sql) was written before
-- Phase 6/7/8 added routes / driver_assignments / vehicle_expenses /
-- workspace_audit_log / app_notifications. Deleting a vehicle now fails
-- with a foreign-key violation because routes.vehicle_id is declared
-- ON DELETE RESTRICT — a manager could lose audit history if a route
-- silently disappeared with the vehicle, so the schema deliberately
-- blocks the cascade. Account deletion in 'data' mode hits this on the
-- first user with even one route.
--
-- This patch re-creates the RPC to delete the new B2B tables before
-- vehicles, and adds app_notifications cleanup for both modes.
--
-- All-or-nothing: if any DELETE fails the whole RPC raises and nothing
-- is committed. Safe to re-run.
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

  -- CRITICAL: only collect accounts the user OWNS. Earlier versions
  -- iterated every account they were a member of, which meant a driver
  -- in a business workspace ran 'delete my data' and wiped the whole
  -- fleet that belonged to the workspace owner. The user is responsible
  -- for the data in accounts they own; in shared accounts they're just
  -- a member and have no business deleting other people's records.
  -- Their membership in shared accounts is removed below in 'account'
  -- mode (and only the membership row, not the underlying data).
  select array_agg(account_id)
    into v_account_ids
    from public.account_members
    where user_id = uid
      and status = 'פעיל'
      and role   = 'בעלים';

  if v_account_ids is null then
    v_account_ids := array[]::uuid[];
  end if;

  -- 0. workspace_audit_log first — it has FKs to vehicles/routes with
  --    ON DELETE SET NULL, but the table also has a BEFORE UPDATE
  --    trigger (prevent_audit_log_update) that raises
  --    'activity_log_immutable' on any UPDATE. The cascade SET NULL
  --    counts as UPDATE → trigger blocks the whole transaction.
  --    Deleting these rows up front avoids the cascade entirely.
  --    The trigger does NOT block DELETE.
  foreach v_account_id in array v_account_ids
  loop
    delete from public.workspace_audit_log where account_id = v_account_id;
  end loop;

  -- 1. Delete B2B data BEFORE vehicles, in dependency order.
  --    routes.vehicle_id is ON DELETE RESTRICT (intentional — a manager
  --    losing route history because a vehicle row vanished would be a
  --    data-integrity bug). So we must drop routes first; route_stops
  --    cascades through route_id. driver_assignments cascade through
  --    vehicle/account but we drop them up front for symmetry.
  foreach v_account_id in array v_account_ids
  loop
    delete from public.driver_assignments where account_id = v_account_id;
    delete from public.routes              where account_id = v_account_id;
    delete from public.vehicle_expenses    where account_id = v_account_id;
  end loop;

  -- 2. Delete vehicles. ON DELETE CASCADE handles repair_logs,
  --    repair_attachments, accident_details, documents, cork_notes,
  --    maintenance_logs, vessel_issues, vessel_checklist_runs,
  --    notification_log.
  foreach v_account_id in array v_account_ids
  loop
    with del as (
      delete from public.vehicles where account_id = v_account_id returning 1
    )
    select v_vehicles_deleted + count(*) into v_vehicles_deleted from del;
  end loop;

  -- 3. Community content (user-scoped).
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

  -- 4. User-scoped records that don't belong to an account.
  --    anonymous_analytics is intentionally NOT touched here — the
  --    table is genuinely anonymous (event, date, count, metadata)
  --    with no user_id column, so DELETE … WHERE user_id = uid raised
  --    42703 (undefined_column) and aborted the whole transaction.
  --    Nothing per-user to delete there anyway.
  delete from public.user_profiles              where user_id = uid;
  delete from public.reminder_settings          where user_id = uid;
  delete from public.maintenance_reminder_prefs where user_id = uid;
  -- B2B addition: in-app notifications targeted at this user.
  delete from public.app_notifications          where user_id = uid;

  if mode = 'data' then
    return jsonb_build_object(
      'ok', true,
      'mode', 'data',
      'vehicles_deleted', v_vehicles_deleted,
      'community_deleted', v_community_deleted,
      'accounts_deleted', 0
    );
  end if;

  -- 5. 'account' mode: leave shared workspaces (driver / viewer
  --    memberships) by removing this user's membership rows, and drop
  --    accounts the user owns.
  --
  --    Before removing the rows, notify each shared workspace's
  --    owners + managers so they see "X עזב את החשבון" in their bell.
  --    Without this the manager only finds out by spotting the gap in
  --    the directory. Email is preferred over display_name for the
  --    label so the manager recognises a driver they may have invited
  --    by email.
  declare
    v_actor_email   text;
    v_actor_display text;
  begin
    select
      coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1)),
      u.email
    into v_actor_display, v_actor_email
    from auth.users u
    where u.id = uid;

    insert into public.app_notifications (user_id, type, title, body, data)
    select
      m.user_id,
      'workspace_member_left',
      'חבר עזב את הסביבה',
      coalesce(v_actor_display, v_actor_email, 'משתמש') || ' עזב את החשבון "' ||
        coalesce(a.name, 'חשבון עסקי') || '"',
      jsonb_build_object(
        'account_id',     a.id,
        'account_name',   a.name,
        'left_user_id',   uid,
        'left_email',     v_actor_email,
        'left_display',   v_actor_display
      )
    from public.account_members m
    join public.accounts a on a.id = m.account_id
    -- Only owners/managers in the same shared workspaces the leaving
    -- user is a member of. Excludes the leaving user themselves and
    -- accounts where they're the owner (those rows get deleted whole
    -- below; nobody to notify).
    where m.account_id in (
      select account_id from public.account_members
       where user_id = uid and status = 'פעיל' and role <> 'בעלים'
    )
      and m.user_id <> uid
      and m.status = 'פעיל'
      and m.role in ('בעלים', 'מנהל');
  end;

  delete from public.account_members
    where user_id = uid;

  --    For owned accounts where no other בעלים remains, delete the
  --    account row. workspace_audit_log + everything else cascades
  --    via account_id FKs.
  foreach v_account_id in array v_account_ids
  loop
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

notify pgrst, 'reload schema';

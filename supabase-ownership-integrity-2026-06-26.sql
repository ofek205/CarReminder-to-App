-- ==========================================================================
-- Wave 1 — Ownership integrity for personal/business separation
--
-- Spec:  docs/spec-business-personal-membership-separation.md  (ג5, ג7)
-- Plan:  docs/plan-business-personal-membership-separation.md   (T1.1–T1.3)
--
-- Goal: make accounts.owner_user_id the SINGLE source of truth for who owns
-- an account, and stop delete_my_account from SILENTLY destroying a shared
-- business account when its owner deletes themselves.
--
-- BACKWARD-COMPATIBLE: does not break the currently deployed client. Safe to
-- re-run (idempotent). Run in Supabase Dashboard → SQL Editor.
--
-- DB SAFETY (שער 5): staging shares the DB with prod → this runs once and
-- affects prod immediately. It is non-destructive: a backfill + a NOT NULL
-- guard that only fires when clean + a CREATE OR REPLACE of one RPC.
-- ==========================================================================


-- ── 1. Backfill accounts.owner_user_id from the active 'בעלים' member ──────
--    Most rows already have owner_user_id (set at bootstrap in phase1). This
--    only fills legacy rows where it is NULL. DISTINCT ON keeps one owner per
--    account (earliest joined) in the unlikely case of duplicates.
UPDATE public.accounts a
   SET owner_user_id = sub.user_id
  FROM (
    SELECT DISTINCT ON (account_id) account_id, user_id
      FROM public.account_members
     WHERE role = 'בעלים' AND status = 'פעיל'
     ORDER BY account_id, joined_at NULLS LAST
  ) sub
 WHERE a.id = sub.account_id
   AND a.owner_user_id IS NULL;


-- ── 2. Diagnostics + conditional NOT NULL ──────────────────────────────────
--    We do NOT auto-fix drift (owner_user_id pointing at a non-owner) — that
--    is a data decision. We only REPORT it. NOT NULL is enforced only when no
--    orphan accounts remain, so the migration never aborts mid-way.
DO $$
DECLARE
  v_null_count  int;
  v_drift_count int;
BEGIN
  SELECT count(*) INTO v_null_count
    FROM public.accounts WHERE owner_user_id IS NULL;

  SELECT count(*) INTO v_drift_count
    FROM public.accounts a
   WHERE a.owner_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.account_members m
        WHERE m.account_id = a.id
          AND m.user_id    = a.owner_user_id
          AND m.role       = 'בעלים'
          AND m.status     = 'פעיל'
     );

  RAISE NOTICE 'ownership-integrity: % account(s) with NULL owner_user_id (orphans — resolve before NOT NULL)', v_null_count;
  RAISE NOTICE 'ownership-integrity: % account(s) where owner_user_id has no matching active בעלים row (drift — review)', v_drift_count;

  IF v_null_count = 0 THEN
    BEGIN
      ALTER TABLE public.accounts ALTER COLUMN owner_user_id SET NOT NULL;
      RAISE NOTICE 'ownership-integrity: owner_user_id is now NOT NULL';
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'ownership-integrity: could NOT set NOT NULL (%). Resolve and re-run.', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'ownership-integrity: NOT NULL NOT enforced — % orphan account(s) remain. Resolve, then re-run.', v_null_count;
  END IF;
END $$;


-- ── 3. delete_my_account — read owner_user_id + block orphaning members ─────
--    Two changes vs supabase-delete-account-rpc-b2b.sql:
--      (a) Owned accounts are collected via accounts.owner_user_id = uid
--          (single source of truth), not by counting role='בעלים'.
--      (b) GUARD: if an owned account still has OTHER active members, the RPC
--          raises 'must_transfer_ownership' instead of silently wiping a
--          shared business fleet. The owner must transfer ownership (or remove
--          members) first. Applies to BOTH modes — 'data' would also destroy
--          the shared fleet (vehicles/routes/expenses), so it is blocked too.
--    Everything else (delete order, community cleanup, leave-shared, notifs)
--    is preserved verbatim from the b2b patch.
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
  v_blocked text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if mode not in ('data', 'account') then
    raise exception 'invalid_mode: must be "data" or "account"';
  end if;

  -- Owned accounts — single source of truth is accounts.owner_user_id.
  -- (Previously counted role='בעלים', which could drift from owner_user_id.)
  select array_agg(id)
    into v_account_ids
    from public.accounts
   where owner_user_id = uid;

  if v_account_ids is null then
    v_account_ids := array[]::uuid[];
  end if;

  -- GUARD (ג7): never destroy a shared business account. If any owned account
  -- still has OTHER active members, block and require ownership transfer first.
  -- Applies to both modes — 'data' mode also deletes the (shared) vehicles.
  select string_agg(a.name, ', ')
    into v_blocked
    from public.accounts a
   where a.id = any(v_account_ids)
     and exists (
       select 1 from public.account_members m
        where m.account_id = a.id
          and m.user_id <> uid
          and m.status   = 'פעיל'
     );

  if v_blocked is not null and length(v_blocked) > 0 then
    raise exception 'must_transfer_ownership'
      using detail = 'חשבונות עם חברים פעילים: ' || v_blocked;
  end if;

  -- 0. workspace_audit_log first — cascade SET NULL would trip its immutable
  --    BEFORE UPDATE trigger. The trigger does NOT block DELETE.
  foreach v_account_id in array v_account_ids
  loop
    delete from public.workspace_audit_log where account_id = v_account_id;
  end loop;

  -- 1. B2B data BEFORE vehicles, in dependency order (routes.vehicle_id is
  --    ON DELETE RESTRICT).
  foreach v_account_id in array v_account_ids
  loop
    delete from public.driver_assignments where account_id = v_account_id;
    delete from public.routes              where account_id = v_account_id;
    delete from public.vehicle_expenses    where account_id = v_account_id;
  end loop;

  -- 2. Vehicles (ON DELETE CASCADE handles child tables).
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
  delete from public.user_profiles              where user_id = uid;
  delete from public.reminder_settings          where user_id = uid;
  delete from public.maintenance_reminder_prefs where user_id = uid;
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

  -- 5. 'account' mode: leave shared workspaces (notify their owners/managers),
  --    then drop the accounts this user owns (guard above guarantees they have
  --    no other active members → safe to destroy).
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

  -- Destroy owned accounts (sole-member, per the guard above). Everything
  -- else cascades via account_id FKs.
  foreach v_account_id in array v_account_ids
  loop
    delete from public.accounts where id = v_account_id;
    v_accounts_deleted := v_accounts_deleted + 1;
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

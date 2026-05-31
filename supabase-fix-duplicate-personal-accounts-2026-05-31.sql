-- ═══════════════════════════════════════════════════════════════════════════
-- Fix duplicate personal accounts — 2026-05-31
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG: signup created TWO `personal` accounts ~3ms apart. Root cause = a
-- race between two non-atomic "SELECT-then-INSERT" provisioning paths:
--   1. DB trigger handle_new_user (AFTER INSERT ON auth.users)
--   2. Client RPC ensure_user_account() (fired on SIGNED_IN in GuestContext)
-- Both check "does the user have an active membership?" → both see 0 (the
-- other's INSERT hasn't committed) → both INSERT. No UNIQUE constraint
-- prevented a user from owning two personal accounts.
--
-- Symptom: admin user list showed inflated vehicle/member counts (it
-- aggregates across both accounts) while the detail drawer showed the
-- oldest (often empty) account. 45 users affected as of this migration.
--
-- Diagnostic confirmed EVERY affected user is a clean case — either one
-- account has vehicles + one is empty, or both are empty. NO user has data
-- in BOTH accounts, so every repair is a safe "delete the empty duplicate".
--
-- RUN ORDER MATTERS — this file is ordered correctly:
--   1. Harden ensure_user_account so it tolerates the new unique index
--      (loser of the race returns the existing account instead of throwing).
--   2. Repair existing data (delete empty duplicate personal accounts).
--   3. Create the partial unique index (makes a 2nd personal account
--      physically impossible going forward).
-- The index MUST come after the repair, or it fails on existing dupes.
--
-- Re-runnable. Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- STEP 1 — Harden ensure_user_account(): recover from unique_violation
-- ════════════════════════════════════════════════════════════════════
-- Once the partial unique index (step 3) exists, the loser of a
-- trigger-vs-client race will hit a unique_violation on the accounts
-- INSERT. Instead of throwing (which would surface as a provisioning
-- error to a brand-new user), we catch it and return the account the
-- winning path just created. The handle_new_user trigger already wraps
-- its INSERTs in EXCEPTION WHEN OTHERS (warning-only), so it's safe too.
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

  -- Fast path: user already has an active membership.
  select account_id into existing_account_id
    from public.account_members
   where user_id = uid
     and status = 'פעיל'
   order by (role = 'בעלים') desc, joined_at asc nulls last
   limit 1;

  if existing_account_id is not null then
    return existing_account_id;
  end if;

  -- Slow path: create a personal account. Wrapped so that if a
  -- concurrent path (the signup trigger) already created one and the
  -- unique index rejects this INSERT, we recover by returning theirs
  -- rather than failing the caller.
  begin
    insert into public.accounts (owner_user_id, type, created_via)
      values (uid, 'personal', 'bootstrap')
      returning id into new_account_id;

    insert into public.account_members (account_id, user_id, role, status, joined_at)
      values (new_account_id, uid, 'בעלים', 'פעיל', now());

    return new_account_id;
  exception when unique_violation then
    -- Lost the race — return the account the other path created.
    select account_id into existing_account_id
      from public.account_members
     where user_id = uid
       and status = 'פעיל'
     order by (role = 'בעלים') desc, joined_at asc nulls last
     limit 1;
    return existing_account_id;
  end;
end;
$$;

revoke all on function public.ensure_user_account() from public;
grant execute on function public.ensure_user_account() to authenticated;


-- ════════════════════════════════════════════════════════════════════
-- STEP 2 — Repair existing duplicates (delete the EMPTY duplicate)
-- ════════════════════════════════════════════════════════════════════
-- For each user owning >1 personal account, keep the one with the most
-- vehicles (tie-break: oldest), delete the other. A HARD GUARD aborts
-- the whole operation if any delete-target has vehicles or documents —
-- so we can NEVER destroy real data. DELETE FROM accounts cascades to
-- account_members and all account-scoped rows (ON DELETE CASCADE).
DO $$
DECLARE
  v_deleted int := 0;
  v_unsafe  int := 0;
BEGIN
  CREATE TEMP TABLE _dupe_delete ON COMMIT DROP AS
  WITH owned_personal AS (
    SELECT am.user_id, am.account_id, a.created_at,
           (SELECT COUNT(*) FROM public.vehicles  v WHERE v.account_id = am.account_id) AS vehicles,
           (SELECT COUNT(*) FROM public.documents d WHERE d.account_id = am.account_id) AS docs
    FROM public.account_members am
    JOIN public.accounts a ON a.id = am.account_id
    WHERE am.role IN ('בעלים','owner') AND am.status = 'פעיל' AND a.type = 'personal'
  ),
  dupes AS (
    SELECT user_id FROM owned_personal GROUP BY user_id HAVING COUNT(*) > 1
  ),
  ranked AS (
    SELECT op.*,
      ROW_NUMBER() OVER (
        PARTITION BY op.user_id
        ORDER BY op.vehicles DESC, op.docs DESC, op.created_at ASC
      ) AS rn
    FROM owned_personal op
    JOIN dupes d ON d.user_id = op.user_id
  )
  SELECT account_id, vehicles, docs
  FROM ranked
  WHERE rn >= 2;  -- everything except the keeper (rn=1)

  -- HARD GUARD: refuse to delete anything that holds data.
  SELECT COUNT(*) INTO v_unsafe FROM _dupe_delete WHERE vehicles > 0 OR docs > 0;
  IF v_unsafe > 0 THEN
    RAISE EXCEPTION 'ABORT: % delete-target(s) have vehicles/documents — manual review required, nothing deleted', v_unsafe;
  END IF;

  DELETE FROM public.accounts WHERE id IN (SELECT account_id FROM _dupe_delete);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted % empty duplicate personal account(s)', v_deleted;
END $$;


-- ════════════════════════════════════════════════════════════════════
-- STEP 3 — Prevent recurrence: one personal account per owner
-- ════════════════════════════════════════════════════════════════════
-- Partial unique index. Any second personal-account INSERT for the same
-- owner now fails with unique_violation, which both creation paths
-- (trigger + ensure_user_account) tolerate gracefully. NOT CONCURRENTLY
-- because the table is small and this runs once in a maintenance window.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_personal_per_owner_uq
  ON public.accounts (owner_user_id)
  WHERE type = 'personal';


-- ════════════════════════════════════════════════════════════════════
-- Verification (run after the above):
-- ════════════════════════════════════════════════════════════════════
--   -- Should return ZERO rows (no user owns >1 personal account):
--   SELECT am.user_id, COUNT(*)
--   FROM account_members am JOIN accounts a ON a.id = am.account_id
--   WHERE am.role IN ('בעלים','owner') AND am.status = 'פעיל' AND a.type='personal'
--   GROUP BY am.user_id HAVING COUNT(*) > 1;
--
--   -- Index exists:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename='accounts' AND indexname='accounts_one_personal_per_owner_uq';

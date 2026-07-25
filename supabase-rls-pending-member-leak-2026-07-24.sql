-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-rls-pending-member-leak-2026-07-24.sql
-- SECURITY FIX — pending members can read AND write six tables.
--
-- THE BUG
--   invite_account_member_by_email writes an account_members row with
--   status = 'ממתין' and waits for the invitee to accept. Access is supposed
--   to begin only once they do.
--
--   21 policies across 6 tables test membership WITHOUT the status column:
--
--     account_id IN (SELECT account_id FROM account_members
--                     WHERE user_id = auth.uid())
--
--   That matches a 'ממתין' row. Someone who was merely INVITED — who never
--   accepted, and may have never seen the invite — can already SELECT,
--   INSERT, UPDATE and DELETE accident details, repair logs, repair
--   attachments, vessel checklists, checklist runs and vessel issues in an
--   account they are not a member of.
--
--   The same tables' siblings got it right. accounts and vehicles both route
--   through user_account_ids(), which selects `status = 'פעיל'`, so the
--   inconsistency is per-policy rather than by design.
--
-- THE FIX
--   Route every one of the 21 through public.user_account_ids(), the helper
--   that already encodes the correct rule and is already used by the core
--   tables. Nothing else about the predicates changes.
--
--   It is also SECURITY DEFINER STABLE, so it evaluates account_members
--   without re-entering that table's own RLS — the recursion the helper was
--   introduced to avoid.
--
-- BLAST RADIUS
--   Verified against production 2026-07-24: account_members holds 590 'פעיל',
--   2 'ממתין', 0 NULL, 0 'הוסר'. Every active member keeps exactly the access
--   they have today. The 2 pending rows lose access they should never have
--   had.
--
-- ROLLBACK
--   Both original shapes are recorded below. To revert, recreate the policy
--   with its shape, substituting the table's own column.
--
--     shape A:  account_id IN (SELECT account_id FROM account_members
--                               WHERE user_id = auth.uid())
--     shape B:  repair_log_id IN (SELECT id FROM repair_logs
--                                  WHERE account_id IN (
--                                    SELECT account_id FROM account_members
--                                     WHERE user_id = auth.uid()))
--
--   No TO clause is specified, matching the originals (default PUBLIC).
--   Functionally moot: auth.uid() is NULL for anon, so user_account_ids()
--   returns '{}' and nothing matches.
--
-- Transactional: either all 21 change or none do. Re-runnable.
-- HOW TO APPLY: paste into Supabase SQL Editor and Run.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── shape A — direct account_id ───────────────────────────────────────────

-- repair_logs
drop policy if exists repair_logs_select on public.repair_logs;
create policy repair_logs_select on public.repair_logs
  for select using (account_id = any(public.user_account_ids()));

drop policy if exists repair_logs_insert on public.repair_logs;
create policy repair_logs_insert on public.repair_logs
  for insert with check (account_id = any(public.user_account_ids()));

drop policy if exists repair_logs_update on public.repair_logs;
create policy repair_logs_update on public.repair_logs
  for update using (account_id = any(public.user_account_ids()));

-- vessel_checklists
drop policy if exists vessel_checklists_select on public.vessel_checklists;
create policy vessel_checklists_select on public.vessel_checklists
  for select using (account_id = any(public.user_account_ids()));

drop policy if exists vessel_checklists_insert on public.vessel_checklists;
create policy vessel_checklists_insert on public.vessel_checklists
  for insert with check (account_id = any(public.user_account_ids()));

drop policy if exists vessel_checklists_update on public.vessel_checklists;
create policy vessel_checklists_update on public.vessel_checklists
  for update using (account_id = any(public.user_account_ids()));

drop policy if exists vessel_checklists_delete on public.vessel_checklists;
create policy vessel_checklists_delete on public.vessel_checklists
  for delete using (account_id = any(public.user_account_ids()));

-- vessel_checklist_runs
drop policy if exists vessel_checklist_runs_select on public.vessel_checklist_runs;
create policy vessel_checklist_runs_select on public.vessel_checklist_runs
  for select using (account_id = any(public.user_account_ids()));

drop policy if exists vessel_checklist_runs_insert on public.vessel_checklist_runs;
create policy vessel_checklist_runs_insert on public.vessel_checklist_runs
  for insert with check (account_id = any(public.user_account_ids()));

drop policy if exists vessel_checklist_runs_update on public.vessel_checklist_runs;
create policy vessel_checklist_runs_update on public.vessel_checklist_runs
  for update using (account_id = any(public.user_account_ids()));

drop policy if exists vessel_checklist_runs_delete on public.vessel_checklist_runs;
create policy vessel_checklist_runs_delete on public.vessel_checklist_runs
  for delete using (account_id = any(public.user_account_ids()));

-- vessel_issues
drop policy if exists vessel_issues_select on public.vessel_issues;
create policy vessel_issues_select on public.vessel_issues
  for select using (account_id = any(public.user_account_ids()));

drop policy if exists vessel_issues_insert on public.vessel_issues;
create policy vessel_issues_insert on public.vessel_issues
  for insert with check (account_id = any(public.user_account_ids()));

drop policy if exists vessel_issues_update on public.vessel_issues;
create policy vessel_issues_update on public.vessel_issues
  for update using (account_id = any(public.user_account_ids()));


-- ── shape B — reached through repair_logs ─────────────────────────────────
-- Only the innermost membership test changes; the repair_log_id hop is
-- preserved verbatim so these keep following their parent row's account.

-- accident_details
drop policy if exists accident_details_select on public.accident_details;
create policy accident_details_select on public.accident_details
  for select using (
    repair_log_id in (
      select id from public.repair_logs
       where account_id = any(public.user_account_ids())
    )
  );

drop policy if exists accident_details_insert on public.accident_details;
create policy accident_details_insert on public.accident_details
  for insert with check (
    repair_log_id in (
      select id from public.repair_logs
       where account_id = any(public.user_account_ids())
    )
  );

drop policy if exists accident_details_update on public.accident_details;
create policy accident_details_update on public.accident_details
  for update using (
    repair_log_id in (
      select id from public.repair_logs
       where account_id = any(public.user_account_ids())
    )
  );

drop policy if exists accident_details_delete on public.accident_details;
create policy accident_details_delete on public.accident_details
  for delete using (
    repair_log_id in (
      select id from public.repair_logs
       where account_id = any(public.user_account_ids())
    )
  );

-- repair_attachments
drop policy if exists repair_attachments_select on public.repair_attachments;
create policy repair_attachments_select on public.repair_attachments
  for select using (
    repair_log_id in (
      select id from public.repair_logs
       where account_id = any(public.user_account_ids())
    )
  );

drop policy if exists repair_attachments_insert on public.repair_attachments;
create policy repair_attachments_insert on public.repair_attachments
  for insert with check (
    repair_log_id in (
      select id from public.repair_logs
       where account_id = any(public.user_account_ids())
    )
  );

drop policy if exists repair_attachments_delete on public.repair_attachments;
create policy repair_attachments_delete on public.repair_attachments
  for delete using (
    repair_log_id in (
      select id from public.repair_logs
       where account_id = any(public.user_account_ids())
    )
  );

commit;

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- Verification — run after COMMIT. Expect ZERO rows.
-- ═══════════════════════════════════════════════════════════════════════════
--   select tablename, policyname, cmd
--     from pg_policies
--    where schemaname = 'public'
--      and (coalesce(qual,'') || coalesce(with_check,'')) like '%account_members%'
--      and (coalesce(qual,'') || coalesce(with_check,'')) not like '%פעיל%'
--      and (coalesce(qual,'') || coalesce(with_check,'')) not like '%user_account_ids%';
--
--   -- Sanity: an active member still reads their own repair logs.
--   -- Run while signed in as a normal user; expect their own rows.
--   select count(*) from public.repair_logs;
-- ═══════════════════════════════════════════════════════════════════════════

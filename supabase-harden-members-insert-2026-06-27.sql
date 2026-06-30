-- ==========================================================================
-- SECURITY: close the account_members INSERT IDOR — 2026-06-27
--
-- The live policy `members_insert_weak` had:
--     WITH CHECK ((user_id = auth.uid()) AND (role = 'שותף') AND (status = 'פעיל'))
-- There is NO predicate on account_id, so ANY authenticated user could
--     INSERT account_members(account_id = <any account>, user_id = self,
--                            role = 'שותף', status = 'פעיל')
-- and immediately become an active VIEWER of that account — gaining read
-- access to its vehicles, documents, members, etc. (members_select /
-- vehicles_select are driven by user_account_ids()). That is a cross-account
-- data-exposure IDOR.
--
-- FIX: deny ALL direct client INSERTs into account_members. Every legitimate
-- membership write already goes through a SECURITY DEFINER RPC, which bypasses
-- RLS and is therefore unaffected:
--   - invite_account_member_by_email  (creates pending rows)
--   - accept_account_invite / decline_account_invite (UPDATE/DELETE)
--   - redeem_invite_token             (unregistered join)
--   - ensure_user_account / handle_new_user (personal-account bootstrap)
--   - transfer_ownership / change_member_role / remove_member / leave_account
-- No client path inserts a row directly (the only db.account_members.create —
-- the Base44 claim in Dashboard.jsx — already failed this policy because it
-- inserts role='בעלים', and is being moved to a SECURITY DEFINER RPC).
--
-- PROD-SAFE: shared staging/prod DB. Prod's client never direct-inserts a
-- 'שותף' membership, so denying it breaks nothing live; it only removes the
-- attack surface.
--
-- Idempotent. Run in Supabase SQL Editor. Reversible (restore the old WITH
-- CHECK if ever needed).
-- ==========================================================================

alter policy "members_insert_weak" on public.account_members
  with check (false);

notify pgrst, 'reload schema';

-- Verify (should show with_check = false):
--   select policyname, with_check from pg_policies
--    where schemaname='public' and tablename='account_members' and cmd='INSERT';

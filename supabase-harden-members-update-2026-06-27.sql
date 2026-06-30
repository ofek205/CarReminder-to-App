-- ==========================================================================
-- SECURITY (defense-in-depth): no minting a 2nd owner via direct UPDATE
-- 2026-06-27
--
-- The live members_update_role policy already restricts WHO can update member
-- rows (USING + WITH CHECK = caller is an active 'בעלים' of that account). But
-- the WITH CHECK didn't constrain the NEW role, so an owner could promote any
-- member to 'בעלים' via a direct UPDATE — breaking the "exactly one owner"
-- invariant. Ownership transfer must go through transfer_ownership (SECURITY
-- DEFINER, atomic, demotes the previous owner), which bypasses RLS and is
-- unaffected by this constraint.
--
-- PROD-SAFE: the deployed client makes NO direct account_members UPDATE — role
-- changes / removals / transfers all go through SECURITY DEFINER RPCs that
-- bypass RLS. So tightening the WITH CHECK breaks no live flow; it only removes
-- the direct-escalation path.
--
-- Idempotent (re-running ALTER POLICY restates the same WITH CHECK).
-- Run in Supabase SQL Editor.
-- ==========================================================================

alter policy "members_update_role" on public.account_members
  with check (
    (account_id in (
      select am.account_id
        from public.account_members am
       where am.user_id = auth.uid()
         and am.role    = 'בעלים'
         and am.status  = 'פעיל'
    ))
    and (role <> 'בעלים')
  );

notify pgrst, 'reload schema';

-- Verify (with_check should now include "AND (role <> 'בעלים')"):
--   select policyname, with_check from pg_policies
--    where schemaname='public' and tablename='account_members' and cmd='UPDATE';

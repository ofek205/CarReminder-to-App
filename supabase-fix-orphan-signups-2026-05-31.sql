-- ═══════════════════════════════════════════════════════════════════════════
-- Fix orphan signups — 2026-05-31 (the real root cause)
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG: ~50% of new signups ended up with ZERO account + ZERO membership
-- ("orphans"), so they hit "לא נמצא חשבון פעיל" and could not add vehicles.
-- This persisted even on installed/old apps because the failure is in the
-- DB signup trigger, not the client.
--
-- ROOT CAUSE: public.accounts.name is NOT NULL with NO default. The live
-- handle_new_user() trigger inserts accounts WITHOUT a name:
--     INSERT INTO public.accounts (owner_user_id) VALUES (NEW.id)
-- → every such insert violates the not-null constraint (23502) →
--   the trigger's `EXCEPTION WHEN OTHERS` swallowed it as a bare
--   RAISE WARNING (NOT logged to provisioning_errors) → the whole
--   begin/exception block rolled back (account + membership both lost)
--   → silent orphan, no trace anywhere. ensure_user_account() (client
--   self-heal) omits name too, so it failed identically.
--
-- Diagnosis that pinned it: running the trigger's exact insert manually
--   INSERT INTO public.accounts (owner_user_id) VALUES ('<orphan>')
-- returned: 23502 null value in column "name" violates not-null constraint.
--
-- FIX (server-side → reaches every client, old and new, immediately):
--   1. Give accounts.name a default so NO insert path can ever fail on it
--      again (trigger, ensure_user_account, provision_orphan_users, future).
--   2. Backfill: provision an account+owner membership for every existing
--      orphan (now succeeds).
--
-- Re-runnable. Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────
-- STEP 1 — Bulletproof: accounts.name can never be null again
-- ────────────────────────────────────────────────────────────────────
-- Metadata-only change (no table rewrite, instant). Every insert that
-- omits name now gets 'חשבון' instead of throwing. Inserts that DO set
-- name (e.g. the email-prefix name in provision/backfill) keep theirs.
ALTER TABLE public.accounts ALTER COLUMN name SET DEFAULT 'חשבון';


-- ────────────────────────────────────────────────────────────────────
-- STEP 2 — Provision every existing orphan (account + owner membership)
-- ────────────────────────────────────────────────────────────────────
-- Raw DO block (runs as the privileged SQL-editor role — bypasses the
-- is_admin() gate on provision_orphan_users(), which can't pass in the
-- editor). Names the account from the email prefix for a friendlier label.
DO $$
DECLARE
  u record;
  new_account_id uuid;
BEGIN
  FOR u IN
    SELECT id, email
      FROM auth.users
     WHERE NOT EXISTS (
       SELECT 1 FROM public.account_members
        WHERE user_id = auth.users.id AND status = 'פעיל'
     )
  LOOP
    INSERT INTO public.accounts (owner_user_id, name)
      VALUES (u.id, COALESCE(NULLIF(split_part(u.email, '@', 1), ''), 'חשבון'))
      RETURNING id INTO new_account_id;

    INSERT INTO public.account_members (account_id, user_id, role, status, joined_at)
      VALUES (new_account_id, u.id, 'בעלים', 'פעיל', now());
  END LOOP;
END $$;


-- ────────────────────────────────────────────────────────────────────
-- Verification — should return 0
-- ────────────────────────────────────────────────────────────────────
--   SELECT COUNT(*) AS orphans FROM auth.users u
--   WHERE NOT EXISTS (
--     SELECT 1 FROM public.account_members am
--      WHERE am.user_id = u.id AND am.status = 'פעיל'
--   );
--
-- And confirm the default is set:
--   SELECT column_default FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='accounts' AND column_name='name';
--   -- expect: 'חשבון'::text
--
-- ────────────────────────────────────────────────────────────────────
-- FOLLOW-UP (recommended, not required for the fix):
-- Harden handle_new_user() to (a) set name explicitly from the email
-- prefix (nicer than the generic default), and (b) log failures to
-- public.provisioning_errors instead of a bare RAISE WARNING — so the
-- NEXT silent provisioning failure is visible in a table, not lost to
-- the Postgres log. The default above already prevents THIS failure;
-- the hardening is about observability for future ones.
-- ────────────────────────────────────────────────────────────────────

-- ==========================================================================
-- HOTFIX: accept/decline_account_invite — "column full_name does not exist"
-- 2026-07-02
--
-- BUG (user-visible, high severity — user_visible_error_spike, 6x/15m):
-- accept_account_invite + decline_account_invite resolve the acting user's
-- display name via  SELECT coalesce(full_name, email, 'משתמש') FROM
-- public.user_profiles.  user_profiles has NO full_name/email columns → the
-- SELECT fails at plan time with "column full_name does not exist", BEFORE the
-- auth.users fallback (IF ... IS NULL) can ever run. Result: EVERY invite
-- accept/decline throws, and the invited user sees the raw error right after
-- tapping the bell notification. Invite-SEND was already fixed to read
-- auth.users (view-as Section D); accept/decline were missed.
--
-- FIX: read the name from auth.users directly (same pattern as
-- workspace_team_directory + invite_account_member_by_email), dropping the
-- broken user_profiles read entirely. Everything else is preserved verbatim.
--
-- Idempotent (CREATE OR REPLACE). Fixes the shared prod DB immediately — no
-- web deploy needed (RPCs live in the DB, not the bundle). Run in SQL Editor.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.accept_account_invite(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_row public.account_members%rowtype;
  v_acceptor_name text;
  v_inviter_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_row
    FROM public.account_members
   WHERE id = p_member_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF v_row.user_id <> uid THEN
    RAISE EXCEPTION 'not_your_invite';
  END IF;

  IF v_row.status <> 'ממתין' THEN
    RAISE EXCEPTION 'invite_not_pending';
  END IF;

  UPDATE public.account_members
     SET status = 'פעיל', joined_at = now()
   WHERE id = p_member_id;

  -- Notify the inviter. Name comes from auth.users (user_profiles has no
  -- full_name/email — reading it there was the bug this hotfix removes).
  v_inviter_id := v_row.invited_by;
  IF v_inviter_id IS NOT NULL THEN
    SELECT coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
      INTO v_acceptor_name
      FROM auth.users WHERE id = uid;

    INSERT INTO public.app_notifications (user_id, type, title, body, data)
    VALUES (
      v_inviter_id,
      'account_invite_accepted',
      coalesce(v_acceptor_name, 'משתמש') || ' הצטרף/ה לחשבון',
      coalesce(v_acceptor_name, 'משתמש') || ' אישר/ה את ההזמנה והצטרף/ה לחשבון כ' || v_row.role || '.',
      jsonb_build_object(
        'member_id',     p_member_id,
        'account_id',    v_row.account_id,
        'acceptor_id',   uid,
        'acceptor_name', coalesce(v_acceptor_name, 'משתמש'),
        'role',          v_row.role
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'member_id',  p_member_id,
    'account_id', v_row.account_id,
    'role',       v_row.role,
    'status',     'פעיל'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_account_invite(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_account_invite(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.decline_account_invite(p_member_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_row public.account_members%rowtype;
  v_decliner_name text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_row
    FROM public.account_members
   WHERE id = p_member_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;

  IF v_row.user_id <> uid THEN
    RAISE EXCEPTION 'not_your_invite';
  END IF;

  IF v_row.status <> 'ממתין' THEN
    RAISE EXCEPTION 'invite_not_pending';
  END IF;

  DELETE FROM public.account_members WHERE id = p_member_id;

  -- Notify the inviter. Name from auth.users (see accept fix above).
  IF v_row.invited_by IS NOT NULL THEN
    SELECT coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
      INTO v_decliner_name
      FROM auth.users WHERE id = uid;

    INSERT INTO public.app_notifications (user_id, type, title, body, data)
    VALUES (
      v_row.invited_by,
      'account_invite_declined',
      coalesce(v_decliner_name, 'משתמש') || ' דחה את ההזמנה לחשבון',
      coalesce(v_decliner_name, 'משתמש') || ' דחה את ההזמנה להצטרף לחשבון.',
      jsonb_build_object(
        'member_id',     p_member_id,
        'account_id',    v_row.account_id,
        'decliner_id',   uid,
        'decliner_name', coalesce(v_decliner_name, 'משתמש')
      )
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.decline_account_invite(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.decline_account_invite(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Verify (should NOT contain "user_profiles"):
--   select pg_get_functiondef('public.accept_account_invite(uuid)'::regprocedure) like '%user_profiles%' as still_broken;

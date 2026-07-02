-- ==========================================================================
-- HOTFIX: "column full_name does not exist" — 2026-07-02
--
-- public.user_profiles has NO full_name/email columns (only phone, birth_date,
-- driver_license_number, license_expiration_date, license_image_url). Several
-- SECURITY DEFINER RPCs resolved a user's display name with
--   SELECT coalesce(full_name, email, 'משתמש') FROM public.user_profiles ...
-- which fails at plan time with "column full_name does not exist" — before any
-- auth.users fallback can run. Every call throws; the acting user sees the raw
-- error (user_visible_error_spike alert). A live-DB scan
--   (pg_get_functiondef ~* 'coalesce\(\s*full_name')
-- found exactly these 5 still-broken functions. This recreates all of them to
-- read the name from auth.users directly (the pattern already used by the live
-- invite RPC + workspace_team_directory). All other logic is preserved verbatim.
--
-- Idempotent (CREATE OR REPLACE). Fixes the shared prod DB immediately — no web
-- deploy needed (RPCs live in the DB). Run in Supabase SQL Editor.
-- Supersedes supabase-fix-invite-accept-fullname-2026-07-02.sql.
-- ==========================================================================

-- ── 1. accept_account_invite ──────────────────────────────────────────────
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

  v_inviter_id := v_row.invited_by;
  IF v_inviter_id IS NOT NULL THEN
    SELECT coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
      INTO v_acceptor_name FROM auth.users WHERE id = uid;

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


-- ── 2. decline_account_invite ─────────────────────────────────────────────
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

  IF v_row.invited_by IS NOT NULL THEN
    SELECT coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
      INTO v_decliner_name FROM auth.users WHERE id = uid;

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


-- ── 3. transfer_ownership ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_ownership(
  p_account_id        uuid,
  p_new_owner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_current_owner uuid;
  v_account_name  text;
  v_heir_status   text;
  v_actor_name    text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT owner_user_id, name INTO v_current_owner, v_account_name
    FROM public.accounts WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found';
  END IF;
  IF v_current_owner <> uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_new_owner_user_id = uid THEN
    RAISE EXCEPTION 'cannot_transfer_to_self';
  END IF;

  SELECT status INTO v_heir_status
    FROM public.account_members
   WHERE account_id = p_account_id AND user_id = p_new_owner_user_id
   FOR UPDATE;
  IF NOT FOUND OR v_heir_status <> 'פעיל' THEN
    RAISE EXCEPTION 'heir_not_active_member';
  END IF;

  UPDATE public.accounts SET owner_user_id = p_new_owner_user_id
   WHERE id = p_account_id;

  UPDATE public.account_members
     SET role = 'מנהל'
   WHERE account_id = p_account_id
     AND role = 'בעלים'
     AND user_id <> p_new_owner_user_id;

  UPDATE public.account_members
     SET role = 'בעלים'
   WHERE account_id = p_account_id
     AND user_id = p_new_owner_user_id;

  SELECT coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') INTO v_actor_name
    FROM auth.users WHERE id = uid;

  INSERT INTO public.app_notifications (user_id, type, title, body, data)
  VALUES (
    p_new_owner_user_id,
    'account_ownership_received',
    'הפכת לבעלים של החשבון',
    coalesce(v_actor_name, 'הבעלים הקודם') || ' העביר/ה אליך את הבעלות על "'
      || coalesce(v_account_name, 'החשבון') || '". כעת יש לך שליטה מלאה.',
    jsonb_build_object('account_id', p_account_id, 'previous_owner_id', uid)
  );

  INSERT INTO public.app_notifications (user_id, type, title, body, data)
  VALUES (
    uid,
    'account_ownership_transferred',
    'העברת את הבעלות על החשבון',
    'הבעלות על "' || coalesce(v_account_name, 'החשבון')
      || '" הועברה. התפקיד שלך עודכן ל"מנהל".',
    jsonb_build_object('account_id', p_account_id, 'new_owner_id', p_new_owner_user_id)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'new_owner_id', p_new_owner_user_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_ownership(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.transfer_ownership(uuid, uuid) TO authenticated;


-- ── 4. leave_account ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.leave_account(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_owner_uid uuid;
  v_my_status text;
  v_others int;
  v_actor_name text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT owner_user_id INTO v_owner_uid
    FROM public.accounts WHERE id = p_account_id;
  IF v_owner_uid IS NULL THEN
    RAISE EXCEPTION 'account_not_found';
  END IF;

  SELECT status INTO v_my_status
    FROM public.account_members
   WHERE account_id = p_account_id AND user_id = uid
   FOR UPDATE;
  IF NOT FOUND OR v_my_status <> 'פעיל' THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  IF uid = v_owner_uid THEN
    SELECT count(*) INTO v_others
      FROM public.account_members
     WHERE account_id = p_account_id AND user_id <> uid AND status = 'פעיל';
    IF v_others > 0 THEN
      RAISE EXCEPTION 'must_transfer_first';
    ELSE
      RAISE EXCEPTION 'owner_cannot_leave_use_delete';
    END IF;
  END IF;

  UPDATE public.account_members
     SET status = 'הוסר'
   WHERE account_id = p_account_id AND user_id = uid;

  UPDATE public.driver_assignments
     SET status = 'revoked', valid_to = now()
   WHERE account_id = p_account_id AND driver_user_id = uid AND status = 'active';

  SELECT coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') INTO v_actor_name
    FROM auth.users WHERE id = uid;

  INSERT INTO public.app_notifications (user_id, type, title, body, data)
  SELECT m.user_id, 'workspace_member_left', 'חבר עזב את החשבון',
         coalesce(v_actor_name, 'משתמש') || ' עזב את החשבון "' || coalesce(a.name, 'חשבון') || '".',
         jsonb_build_object('account_id', p_account_id, 'left_user_id', uid)
    FROM public.account_members m
    JOIN public.accounts a ON a.id = m.account_id
   WHERE m.account_id = p_account_id AND m.user_id <> uid
     AND m.status = 'פעיל' AND m.role IN ('בעלים', 'מנהל');

  RETURN jsonb_build_object('ok', true, 'account_id', p_account_id);
END;
$$;
REVOKE ALL ON FUNCTION public.leave_account(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.leave_account(uuid) TO authenticated;


-- ── 5. notify_invitee_by_email ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_invitee_by_email(
  p_email      text,
  p_invite_id  uuid,
  p_role       text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_uid   uuid;
  inviter_name text;
  inviter_uid  uuid := auth.uid();
BEGIN
  IF inviter_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_email IS NULL OR p_email = '' OR p_invite_id IS NULL THEN
    RETURN true;                             -- silent no-op
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.invites
    WHERE id = p_invite_id
      AND invited_by_user_id = inviter_uid
  ) THEN
    RAISE EXCEPTION 'invite_not_owned';
  END IF;

  IF p_role NOT IN ('מנהל', 'שותף') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  SELECT id INTO target_uid
    FROM auth.users
   WHERE lower(email) = lower(p_email)
   LIMIT 1;

  IF target_uid IS NULL OR target_uid = inviter_uid THEN
    RETURN true;
  END IF;

  SELECT coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
    INTO inviter_name
    FROM auth.users WHERE id = inviter_uid;

  INSERT INTO public.app_notifications (user_id, type, title, body, data)
  VALUES (
    target_uid,
    'share_offered',
    coalesce(inviter_name, 'משתמש') || ' מזמין/ה אותך לשתף רכב',
    'אתה מוזמן להצטרף לחשבון כ־' || p_role || '. פתח את ההזמנה מקישור המייל.',
    jsonb_build_object(
      'invite_id',   p_invite_id,
      'inviter_id',  inviter_uid,
      'inviter_name',coalesce(inviter_name, 'משתמש'),
      'role',        p_role
    )
  );
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notify_invitee_by_email(text, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Verify — this should return ZERO rows after applying:
--   with fns as materialized (
--     select p.oid, p.proname from pg_proc p
--     join pg_namespace n on n.oid=p.pronamespace
--     join pg_language  l on l.oid=p.prolang
--     where n.nspname='public' and p.prokind='f' and l.lanname in ('plpgsql','sql'))
--   select proname from fns where pg_get_functiondef(oid) ~* 'coalesce\(\s*full_name';

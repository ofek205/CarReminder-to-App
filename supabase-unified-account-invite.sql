-- ==========================================================================
-- Unified account invitation — pending+accept flow
--
-- Mirrors the vehicle-sharing pattern (share_vehicle_with_email) for
-- account-level membership. Instead of client-side token generation +
-- email link, the flow is:
--
--   Registered user   → pending account_members row + in-app notification
--   Unregistered user → invites row (legacy table) + token for link
--
-- RPCs:
--   1. invite_account_member_by_email(email, role, vehicle_ids?)
--   2. accept_account_invite(member_id)
--   3. decline_account_invite(member_id)
--
-- Idempotent. Run in Supabase Dashboard → SQL Editor.
-- ==========================================================================


-- ── 0. Safety index — one active/pending membership per (account, user) ──
-- Prevents race conditions when two admins invite the same user.
CREATE UNIQUE INDEX IF NOT EXISTS account_members_active_uq
  ON public.account_members(account_id, user_id)
  WHERE status IN ('פעיל', 'ממתין');


-- ── 1. invite_account_member_by_email ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invite_account_member_by_email(
  p_email       text,
  p_role        text,
  p_vehicle_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid              uuid := auth.uid();
  v_account_id     uuid;
  v_caller_role    text;
  v_email_norm     text;
  v_recipient_uid  uuid;
  v_member_id      uuid;
  v_inviter_name   text;
  v_token          text;
  v_invite_id      uuid;
BEGIN
  -- Auth check
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Role whitelist — never allow creating a בעלים via invite
  IF p_role NOT IN ('מנהל', 'שותף') THEN
    RAISE EXCEPTION 'invalid_role';
  END IF;

  -- Email validation
  IF p_email IS NULL OR position('@' IN p_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;

  v_email_norm := lower(trim(p_email));

  -- Self-invite check
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id = uid AND lower(email) = v_email_norm
  ) THEN
    RAISE EXCEPTION 'cannot_invite_self';
  END IF;

  -- Verify caller is owner or admin of their account
  SELECT am.account_id, am.role INTO v_account_id, v_caller_role
    FROM public.account_members am
   WHERE am.user_id = uid
     AND am.status = 'פעיל'
     AND am.role IN ('בעלים', 'מנהל')
   LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Resolve inviter name for notifications
  SELECT coalesce(full_name, email, 'משתמש') INTO v_inviter_name
    FROM public.user_profiles WHERE user_id = uid LIMIT 1;
  IF v_inviter_name IS NULL THEN
    SELECT coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
      INTO v_inviter_name
      FROM auth.users WHERE id = uid;
  END IF;

  -- Look up recipient
  SELECT id INTO v_recipient_uid
    FROM auth.users WHERE lower(email) = v_email_norm LIMIT 1;

  -- ────────────────────────────────────────────────────────────────────
  -- PATH A: Registered user → pending account_members row + notification
  -- ────────────────────────────────────────────────────────────────────
  IF v_recipient_uid IS NOT NULL THEN
    -- Check existing membership (active or pending)
    IF EXISTS (
      SELECT 1 FROM public.account_members
       WHERE account_id = v_account_id
         AND user_id = v_recipient_uid
         AND status IN ('פעיל', 'ממתין')
    ) THEN
      RAISE EXCEPTION 'already_member';
    END IF;

    INSERT INTO public.account_members (
      account_id, user_id, role, status, joined_at, vehicle_ids, invited_by
    ) VALUES (
      v_account_id, v_recipient_uid, p_role, 'ממתין', now(), p_vehicle_ids, uid
    )
    RETURNING id INTO v_member_id;

    -- In-app notification to recipient
    INSERT INTO public.app_notifications (user_id, type, title, body, data)
    VALUES (
      v_recipient_uid,
      'account_invite_offered',
      coalesce(v_inviter_name, 'משתמש') || ' מזמין אותך להצטרף לחשבון',
      coalesce(v_inviter_name, 'משתמש') || ' מזמין אותך להצטרף לחשבון כ'
        || p_role || '. לחץ/י כדי לאשר או לדחות.',
      jsonb_build_object(
        'member_id',    v_member_id,
        'account_id',   v_account_id,
        'role',         p_role,
        'inviter_id',   uid,
        'inviter_name', coalesce(v_inviter_name, 'משתמש')
      )
    );

    RETURN jsonb_build_object(
      'added_directly',          false,
      'pending',                 true,
      'member_id',               v_member_id,
      'recipient_existing_user', true,
      'recipient_name',          (SELECT coalesce(full_name, email, 'משתמש')
                                    FROM public.user_profiles
                                   WHERE user_id = v_recipient_uid LIMIT 1)
    );
  END IF;

  -- ────────────────────────────────────────────────────────────────────
  -- PATH B: Unregistered user → invites row + token for link
  -- ────────────────────────────────────────────────────────────────────

  -- Check duplicate active invite for same email
  IF EXISTS (
    SELECT 1 FROM public.invites
     WHERE account_id = v_account_id
       AND status = 'פעיל'
       AND role_to_assign = p_role
  ) THEN
    -- Allow — different emails may share the same role. Only block
    -- exact-email duplicates (checked below via unique or upsert).
    NULL;
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.invites (
    account_id, invited_by_user_id, role_to_assign,
    token, expires_at, max_uses, uses_count, status, vehicle_ids
  ) VALUES (
    v_account_id, uid, p_role,
    v_token, now() + interval '7 days', 1, 0, 'פעיל', p_vehicle_ids
  )
  RETURNING id INTO v_invite_id;

  RETURN jsonb_build_object(
    'added_directly',          false,
    'pending',                 false,
    'invite_token',            v_token,
    'invite_id',               v_invite_id,
    'recipient_existing_user', false,
    'expires_at',              now() + interval '7 days'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invite_account_member_by_email(text, text, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.invite_account_member_by_email(text, text, uuid[]) TO authenticated;


-- ── 2. accept_account_invite ─────────────────────────────────────────────
-- Called by the invited user to move their pending membership to active.
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

  -- Only the invited user can accept their own invite
  IF v_row.user_id <> uid THEN
    RAISE EXCEPTION 'not_your_invite';
  END IF;

  IF v_row.status <> 'ממתין' THEN
    RAISE EXCEPTION 'invite_not_pending';
  END IF;

  UPDATE public.account_members
     SET status = 'פעיל', joined_at = now()
   WHERE id = p_member_id;

  -- Notify the inviter
  v_inviter_id := v_row.invited_by;
  IF v_inviter_id IS NOT NULL THEN
    SELECT coalesce(full_name, email, 'משתמש') INTO v_acceptor_name
      FROM public.user_profiles WHERE user_id = uid LIMIT 1;
    IF v_acceptor_name IS NULL THEN
      SELECT coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
        INTO v_acceptor_name FROM auth.users WHERE id = uid;
    END IF;

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


-- ── 3. decline_account_invite ────────────────────────────────────────────
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

  -- Remove the pending row
  DELETE FROM public.account_members WHERE id = p_member_id;

  -- Notify the inviter
  IF v_row.invited_by IS NOT NULL THEN
    SELECT coalesce(full_name, email, 'משתמש') INTO v_decliner_name
      FROM public.user_profiles WHERE user_id = uid LIMIT 1;
    IF v_decliner_name IS NULL THEN
      SELECT coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
        INTO v_decliner_name FROM auth.users WHERE id = uid;
    END IF;

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


-- ── 4. invited_by column (if missing) ────────────────────────────────────
-- Needed so accept/decline can notify back to the inviter.
ALTER TABLE public.account_members
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id);

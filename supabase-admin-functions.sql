-- ═══════════════════════════════════════════════════════════════════════════
-- Admin RPCs — power the /AdminDashboard users tab.
-- Run ONCE in Supabase Dashboard → SQL Editor.
--
-- These functions are SECURITY DEFINER so they can read auth.users (which the
-- anon key can't). Each function re-checks is_current_user_admin() on every
-- call so a regular user with a leaked JWT still can't invoke them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Admin check ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_current_user_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND (
        raw_user_meta_data->>'role' = 'admin'
        OR email = 'ofek205@gmail.com'   -- fallback: app owner
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION is_current_user_admin() TO authenticated;

-- ── List all accounts with owner email + activity counts ───────────────────
DROP FUNCTION IF EXISTS admin_list_accounts();

CREATE FUNCTION admin_list_accounts()
RETURNS TABLE (
  account_id          uuid,
  account_name        text,
  account_created_at  timestamptz,
  owner_user_id       uuid,
  owner_email         text,
  owner_name          text,
  owner_role          text,
  member_count        integer,
  vehicle_count       integer,
  document_count      integer,
  last_sign_in_at     timestamptz,
  email_confirmed_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id                                                         AS account_id,
    a.name                                                       AS account_name,
    a.created_at                                                 AS account_created_at,
    owner_m.user_id                                              AS owner_user_id,
    u.email::text                                                AS owner_email,
    COALESCE(u.raw_user_meta_data->>'full_name', '')::text       AS owner_name,
    COALESCE(u.raw_user_meta_data->>'role', 'user')::text        AS owner_role,
    (SELECT COUNT(*)::integer FROM account_members m WHERE m.account_id = a.id)  AS member_count,
    (SELECT COUNT(*)::integer FROM vehicles v WHERE v.account_id = a.id)         AS vehicle_count,
    (SELECT COUNT(*)::integer FROM documents d WHERE d.account_id = a.id)        AS document_count,
    u.last_sign_in_at,
    u.email_confirmed_at
  FROM accounts a
  LEFT JOIN LATERAL (
    -- Pick one "owner" per account — prefer role='owner', otherwise oldest member
    SELECT m.user_id
    FROM account_members m
    WHERE m.account_id = a.id
    ORDER BY (m.role = 'owner') DESC NULLS LAST, m.created_at ASC
    LIMIT 1
  ) owner_m ON TRUE
  LEFT JOIN auth.users u ON u.id = owner_m.user_id
  ORDER BY a.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_accounts() TO authenticated;

-- ── Delete an account (cascades to all app data) ───────────────────────────
-- Note: we DON'T delete from auth.users — that's a Supabase-managed table and
-- requires the service role. An admin can delete the auth user separately in
-- the Supabase dashboard if they need to free up the email for re-signup.
CREATE OR REPLACE FUNCTION admin_delete_account(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM accounts WHERE id = p_account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_account(uuid) TO authenticated;

-- ── Promote / demote an account owner to admin role ───────────────────────
CREATE OR REPLACE FUNCTION admin_set_role(p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_role NOT IN ('admin', 'user') THEN
    RAISE EXCEPTION 'invalid role';
  END IF;

  UPDATE auth.users
  SET raw_user_meta_data = jsonb_set(
        COALESCE(raw_user_meta_data, '{}'::jsonb),
        '{role}',
        to_jsonb(p_role)
      )
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_set_role(uuid, text) TO authenticated;

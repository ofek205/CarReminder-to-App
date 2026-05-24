-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-user-list.sql — Stream 4 backend.
--
-- New RPC: admin_user_list() — returns one row per auth.users entry.
-- Unlike admin_list_accounts() (which is account-centric), this is
-- user-centric: every signed-up user appears, even if they're only a
-- "driver" on someone else's account. Owned vs shared vehicles are
-- counted separately so an admin can tell "this user has access to N
-- vehicles he doesn't own" — the case the old RPC missed.
--
-- birth_date / phone come from public.user_profiles (which already has
-- these columns — no schema change needed).
--
-- Gated by public.is_admin(). Run ONCE in Supabase SQL Editor.
-- Re-runnable thanks to CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_user_list();

CREATE FUNCTION public.admin_user_list()
RETURNS TABLE (
  user_id              uuid,
  email                text,
  full_name            text,
  phone                text,
  birth_date           date,
  role                 text,
  signup_at            timestamptz,
  email_confirmed_at   timestamptz,
  last_sign_in_at      timestamptz,
  days_since_signup    integer,
  primary_account_id   uuid,
  primary_account_name text,
  vehicles_owned       integer,
  vehicles_shared      integer,
  documents_total      integer,
  members_total        integer,
  has_business         boolean,
  is_driver            boolean,
  activity_status      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH
  -- All memberships rolled up per user, split owner vs non-owner.
  --
  -- The project uses Hebrew role names ('בעלים' = owner, 'מנהל' = manager,
  -- 'שותף' = viewer, 'driver') with English fallbacks from the Base44
  -- migration era. Anything matching בעלים/owner counts as owner.
  member_rollup AS (
    SELECT
      m.user_id,
      m.account_id,
      m.joined_at,
      (m.role IN ('בעלים', 'owner')) AS is_owner
    FROM public.account_members m
  ),
  -- Primary account = oldest owned account, or NULL if user is owner of nothing.
  primary_account AS (
    SELECT DISTINCT ON (mr.user_id)
      mr.user_id,
      mr.account_id,
      a.name AS account_name
    FROM member_rollup mr
    JOIN public.accounts a ON a.id = mr.account_id
    WHERE mr.is_owner = true
    ORDER BY mr.user_id, mr.joined_at ASC
  ),
  -- Vehicle counts split by ownership of the containing account.
  vehicle_counts AS (
    SELECT
      mr.user_id,
      COUNT(*) FILTER (WHERE mr.is_owner)        AS owned,
      COUNT(*) FILTER (WHERE NOT mr.is_owner)    AS shared
    FROM member_rollup mr
    JOIN public.vehicles v ON v.account_id = mr.account_id
    GROUP BY mr.user_id
  ),
  -- Documents across all accounts the user is a member of (owner or not).
  doc_counts AS (
    SELECT mr.user_id, COUNT(*) AS c
    FROM member_rollup mr
    JOIN public.documents d ON d.account_id = mr.account_id
    GROUP BY mr.user_id
  ),
  -- Members across all accounts the user OWNS (so a workspace owner sees
  -- their team size; a driver-only user sees 0 here, by design).
  member_counts AS (
    SELECT mr.user_id, COUNT(*) AS c
    FROM member_rollup mr
    JOIN public.account_members m2 ON m2.account_id = mr.account_id
    WHERE mr.is_owner = true
    GROUP BY mr.user_id
  ),
  -- Does the user belong to any business workspace?
  business_check AS (
    SELECT DISTINCT am.user_id
    FROM public.account_members am
    JOIN public.accounts a ON a.id = am.account_id
    WHERE a.type = 'business' AND am.status = 'פעיל'
  ),
  -- Does the user have a driver role in any workspace?
  driver_check AS (
    SELECT DISTINCT am.user_id
    FROM public.account_members am
    WHERE am.role = 'driver' AND am.status = 'פעיל'
  )
  SELECT
    u.id                                                              AS user_id,
    u.email::text                                                     AS email,
    COALESCE(u.raw_user_meta_data->>'full_name', '')::text            AS full_name,
    COALESCE(up.phone, u.phone::text)::text                           AS phone,
    up.birth_date                                                     AS birth_date,
    COALESCE(u.raw_user_meta_data->>'role', 'user')::text             AS role,
    u.created_at                                                      AS signup_at,
    u.email_confirmed_at                                              AS email_confirmed_at,
    u.last_sign_in_at                                                 AS last_sign_in_at,
    GREATEST(0, EXTRACT(day FROM (now() - u.created_at))::integer)    AS days_since_signup,
    pa.account_id                                                     AS primary_account_id,
    pa.account_name                                                   AS primary_account_name,
    COALESCE(vc.owned,  0)::integer                                   AS vehicles_owned,
    COALESCE(vc.shared, 0)::integer                                   AS vehicles_shared,
    COALESCE(dc.c,      0)::integer                                   AS documents_total,
    COALESCE(mc.c,      0)::integer                                   AS members_total,
    (bc.user_id IS NOT NULL)                                           AS has_business,
    (drc.user_id IS NOT NULL)                                          AS is_driver,
    CASE
      WHEN u.last_sign_in_at IS NULL                              THEN 'never'
      WHEN u.last_sign_in_at >= now() - interval '7 days'         THEN 'active_7d'
      WHEN u.last_sign_in_at >= now() - interval '30 days'        THEN 'active_30d'
      ELSE                                                              'dormant'
    END                                                               AS activity_status
  FROM auth.users u
  LEFT JOIN public.user_profiles up ON up.user_id = u.id
  LEFT JOIN primary_account       pa ON pa.user_id = u.id
  LEFT JOIN vehicle_counts        vc ON vc.user_id = u.id
  LEFT JOIN doc_counts            dc ON dc.user_id = u.id
  LEFT JOIN member_counts         mc ON mc.user_id = u.id
  LEFT JOIN business_check        bc ON bc.user_id = u.id
  LEFT JOIN driver_check         drc ON drc.user_id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_user_list() TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- admin_user_email_summary(p_user_id) — per-user email engagement stats.
-- Powers the new "מיילים" tab in AdminUserDrawer.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_user_email_summary(uuid);

CREATE FUNCTION public.admin_user_email_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_totals  jsonb;
  v_recent  jsonb;
  v_per_key jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Aggregate counts across the user's entire email history.
  WITH user_logs AS (
    SELECT l.id, l.notification_key, l.sent_at, l.status, l.recipient_email
    FROM public.email_send_log l
    WHERE l.user_id = p_user_id
  ),
  event_agg AS (
    SELECT
      ul.id AS log_id,
      bool_or(e.event_type = 'delivered')   AS delivered,
      bool_or(e.event_type = 'opened')      AS opened,
      bool_or(e.event_type = 'clicked')     AS clicked,
      bool_or(e.event_type IN ('bounced','complained')) AS failed
    FROM user_logs ul
    LEFT JOIN public.email_events e ON e.send_log_id = ul.id
    GROUP BY ul.id
  )
  SELECT
    jsonb_build_object(
      'sent',      (SELECT COUNT(*) FROM user_logs),
      'delivered', COUNT(*) FILTER (WHERE ea.delivered),
      'opened',    COUNT(*) FILTER (WHERE ea.opened),
      'clicked',   COUNT(*) FILTER (WHERE ea.clicked),
      'failed',    COUNT(*) FILTER (WHERE ea.failed)
    )
  INTO v_totals
  FROM event_agg ea;

  -- Last 10 emails sent (any status).
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT
      l.id,
      l.notification_key,
      l.recipient_email,
      l.sent_at,
      l.status,
      EXISTS (SELECT 1 FROM public.email_events e WHERE e.send_log_id = l.id AND e.event_type = 'opened') AS opened,
      EXISTS (SELECT 1 FROM public.email_events e WHERE e.send_log_id = l.id AND e.event_type = 'clicked') AS clicked
    FROM public.email_send_log l
    WHERE l.user_id = p_user_id
    ORDER BY l.sent_at DESC
    LIMIT 10
  ) t;

  -- Per-template breakdown (template_key → counts).
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
  INTO v_per_key
  FROM (
    SELECT
      l.notification_key AS k,
      jsonb_build_object(
        'sent',   COUNT(*),
        'opened', COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM public.email_events e WHERE e.send_log_id = l.id AND e.event_type = 'opened'
        ))
      ) AS v
    FROM public.email_send_log l
    WHERE l.user_id = p_user_id
    GROUP BY l.notification_key
  ) t;

  RETURN jsonb_build_object(
    'totals',     v_totals,
    'recent',     v_recent,
    'per_template', v_per_key
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_user_email_summary(uuid) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST — uncomment to verify:
--   SELECT * FROM public.admin_user_list() LIMIT 5;
--   SELECT public.admin_user_email_summary('a9ee042c-1607-4574-94c0-a0851bf4aac3');
-- ═══════════════════════════════════════════════════════════════════════════

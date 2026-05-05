-- ═══════════════════════════════════════════════════════════════════════════
-- admin_account_details — single-RPC backend for the per-user drawer in
-- /AdminDashboard. Returns one denormalized JSON blob with everything an
-- admin needs to see on a user without making 8 separate queries from the
-- client.
--
-- Run ONCE in Supabase Dashboard → SQL Editor.
-- Idempotent — DROP + CREATE so re-running picks up shape changes.
--
-- Why one big JSON return instead of multiple TABLE returns:
--   • The drawer needs ALL of these sections to render at once (vehicles,
--     documents, members, activity timeline, totals). One RPC = one HTTP
--     round trip from the client; multiple RPCs would force sequential
--     awaits and a flicker between sections.
--   • JSON columns are easy to evolve — adding a new field doesn't
--     break callers that don't read it. With a wide TABLE return we'd
--     have to bump the function signature on every change.
--   • Supabase-js is happy with .rpc('name', args) returning JSON.
--
-- Security: SECURITY DEFINER so we can read auth.users (owner email,
-- last_sign_in_at) from the anon side. is_current_user_admin() gate is
-- re-checked on every call — the function is GRANTed to authenticated,
-- but only admins can actually use it.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_account_details(uuid);

CREATE FUNCTION public.admin_account_details(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account            record;
  v_owner_id           uuid;
  v_owner              record;
  v_vehicles           jsonb;
  v_vehicles_by_type   jsonb;
  v_documents          jsonb;
  v_docs_by_category   jsonb;
  v_members            jsonb;
  v_activity           jsonb;
  v_expenses_total     numeric;
  v_expenses_by_cat    jsonb;
  v_routes_count       integer;
  v_repairs_count      integer;
  v_maintenance_count  integer;
  v_expiring_docs      integer;
BEGIN
  -- Gate: admin only.
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Account row + owner (oldest 'בעלים' / 'owner' membership wins).
  SELECT * INTO v_account FROM accounts WHERE id = p_account_id;
  IF v_account.id IS NULL THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT user_id INTO v_owner_id
  FROM account_members
  WHERE account_id = p_account_id
  ORDER BY (role IN ('בעלים', 'owner')) DESC NULLS LAST, joined_at ASC
  LIMIT 1;

  -- Owner identity (from auth.users — needs SECURITY DEFINER).
  IF v_owner_id IS NOT NULL THEN
    SELECT
      u.id,
      u.email::text                                          AS email,
      COALESCE(u.raw_user_meta_data->>'full_name', '')::text AS full_name,
      COALESCE(u.raw_user_meta_data->>'role', 'user')::text  AS role,
      u.created_at,
      u.last_sign_in_at,
      u.email_confirmed_at,
      u.phone::text                                          AS phone
    INTO v_owner
    FROM auth.users u
    WHERE u.id = v_owner_id;
  END IF;

  -- Vehicles (full row data, with photo URL deliberately included so the
  -- drawer can render thumbnails — heavy egress is fine here because
  -- this is admin-only and called once per drawer open).
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',                  v.id,
      'nickname',            v.nickname,
      'manufacturer',        v.manufacturer,
      'model',               v.model,
      'year',                v.year,
      'vehicle_type',        v.vehicle_type,
      'license_plate',       v.license_plate,
      'current_km',          v.current_km,
      'test_due_date',       v.test_due_date,
      'insurance_due_date',  v.insurance_due_date,
      'created_at',          v.created_at,
      'photo_url',           v.vehicle_photo
    ) ORDER BY v.created_at DESC
  ), '[]'::jsonb)
  INTO v_vehicles
  FROM vehicles v
  WHERE v.account_id = p_account_id;

  -- Vehicles by type — counts grouped by vehicle_type for the chart.
  SELECT COALESCE(jsonb_object_agg(t, c), '{}'::jsonb)
  INTO v_vehicles_by_type
  FROM (
    SELECT COALESCE(NULLIF(vehicle_type, ''), 'לא מוגדר') AS t, COUNT(*) AS c
    FROM vehicles
    WHERE account_id = p_account_id
    GROUP BY t
  ) sub;

  -- Documents (metadata only — file_url is NOT included to avoid leaking
  -- signed URLs and to keep payload small. Admin can deep-link per doc.).
  --
  -- Schema note: this project's documents table uses `document_type` and
  -- `expiry_date` (not `category` / `expires_at` like other Supabase apps).
  -- We alias to category/expires_at in the JSON output so the frontend
  -- drawer can stay schema-agnostic (it reads d.category / d.expires_at).
  -- created_at falls back to legacy created_date for migrated rows.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',           d.id,
      'vehicle_id',   d.vehicle_id,
      'title',        d.title,
      'category',     d.document_type,
      'expires_at',   d.expiry_date,
      'created_at',   COALESCE(d.created_at, d.created_date)
    ) ORDER BY COALESCE(d.created_at, d.created_date) DESC
  ), '[]'::jsonb)
  INTO v_documents
  FROM documents d
  WHERE d.account_id = p_account_id;

  -- Documents grouped by document_type — for the breakdown chart.
  SELECT COALESCE(jsonb_object_agg(cat, c), '{}'::jsonb)
  INTO v_docs_by_category
  FROM (
    SELECT COALESCE(NULLIF(document_type, ''), 'לא מסווג') AS cat, COUNT(*) AS c
    FROM documents
    WHERE account_id = p_account_id
    GROUP BY cat
  ) sub;

  -- Documents expiring within 30 days (or already expired) — admins want
  -- to see at a glance whether an account has compliance pressure.
  SELECT COUNT(*)::integer
  INTO v_expiring_docs
  FROM documents
  WHERE account_id = p_account_id
    AND expiry_date IS NOT NULL
    AND expiry_date <= now() + interval '30 days';

  -- Members.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id',       m.user_id,
      'role',          m.role,
      'joined_at',     m.joined_at,
      'display_name',  COALESCE(au.raw_user_meta_data->>'full_name', '')::text,
      'email',         au.email::text
    ) ORDER BY m.joined_at ASC
  ), '[]'::jsonb)
  INTO v_members
  FROM account_members m
  LEFT JOIN auth.users au ON au.id = m.user_id
  WHERE m.account_id = p_account_id;

  -- Recent activity timeline — last 30 events across maintenance + repair
  -- + expenses. Returned as a unified shape so the drawer can render one
  -- list. Each item carries enough context for a one-line label.
  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'occurred_at' DESC), '[]'::jsonb)
  INTO v_activity
  FROM (
    -- maintenance entries
    SELECT jsonb_build_object(
      'kind',         'maintenance',
      'occurred_at',  ml.performed_at,
      'title',        ml.title,
      'cost',         ml.cost,
      'vehicle_id',   ml.vehicle_id
    ) AS item
    FROM maintenance_logs ml
    JOIN vehicles v ON v.id = ml.vehicle_id
    WHERE v.account_id = p_account_id

    UNION ALL

    -- repair entries
    SELECT jsonb_build_object(
      'kind',         CASE WHEN rl.is_accident THEN 'accident' ELSE 'repair' END,
      'occurred_at',  rl.occurred_at,
      'title',        rl.title,
      'cost',         rl.cost,
      'vehicle_id',   rl.vehicle_id
    )
    FROM repair_logs rl
    WHERE rl.account_id = p_account_id

    UNION ALL

    -- free-form vehicle_expenses (excluding fuel — same exclusion as /Reports)
    SELECT jsonb_build_object(
      'kind',         'expense',
      'occurred_at',  ve.expense_date,
      'title',        COALESCE(ve.note, ve.category, 'הוצאה'),
      'cost',         ve.amount,
      'vehicle_id',   ve.vehicle_id,
      'category',     ve.category
    )
    FROM vehicle_expenses ve
    WHERE ve.account_id = p_account_id
      AND ve.category != 'fuel'

    ORDER BY 1 DESC
    LIMIT 30
  ) sub;

  -- Money totals — sum across all expense sources excluding fuel
  -- (same accounting view as /Reports).
  SELECT
    COALESCE((SELECT SUM(amount) FROM vehicle_expenses
              WHERE account_id = p_account_id AND category != 'fuel'), 0)
  + COALESCE((SELECT SUM(cost) FROM repair_logs
              WHERE account_id = p_account_id AND cost > 0), 0)
  + COALESCE((SELECT SUM(cost) FROM maintenance_logs ml
              JOIN vehicles v ON v.id = ml.vehicle_id
              WHERE v.account_id = p_account_id AND ml.cost > 0), 0)
  INTO v_expenses_total;

  -- Spending by category — repair / insurance / other (mirrors /Reports).
  -- Maintenance + repair logs are bucketed as 'repair'. Free-form
  -- expenses use their own category (already 'repair' / 'insurance' /
  -- 'other' / 'fuel'; fuel excluded).
  SELECT jsonb_build_object(
    'repair',
      COALESCE((SELECT SUM(cost) FROM repair_logs
                WHERE account_id = p_account_id AND cost > 0), 0)
    + COALESCE((SELECT SUM(cost) FROM maintenance_logs ml
                JOIN vehicles v ON v.id = ml.vehicle_id
                WHERE v.account_id = p_account_id AND ml.cost > 0), 0)
    + COALESCE((SELECT SUM(amount) FROM vehicle_expenses
                WHERE account_id = p_account_id AND category = 'repair'), 0),
    'insurance',
      COALESCE((SELECT SUM(amount) FROM vehicle_expenses
                WHERE account_id = p_account_id AND category = 'insurance'), 0),
    'other',
      COALESCE((SELECT SUM(amount) FROM vehicle_expenses
                WHERE account_id = p_account_id AND category = 'other'), 0)
  )
  INTO v_expenses_by_cat;

  -- Counts.
  SELECT COUNT(*)::integer INTO v_routes_count       FROM routes WHERE account_id = p_account_id;
  SELECT COUNT(*)::integer INTO v_repairs_count      FROM repair_logs WHERE account_id = p_account_id;
  SELECT COUNT(*)::integer INTO v_maintenance_count
    FROM maintenance_logs ml
    JOIN vehicles v ON v.id = ml.vehicle_id
    WHERE v.account_id = p_account_id;

  -- Final assembly. The `kind` field on the JSON is sourced from the
  -- DB's `account_type` column (this project uses account_type rather
  -- than kind). The frontend reads `account.kind === 'business'` so
  -- aliasing here keeps it schema-agnostic.
  RETURN jsonb_build_object(
    'account', jsonb_build_object(
      'id',            v_account.id,
      'name',          v_account.name,
      'kind',          v_account.account_type,
      'created_at',    v_account.created_at,
      'business_meta', v_account.business_meta
    ),
    'owner', CASE WHEN v_owner.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',                  v_owner.id,
      'email',               v_owner.email,
      'full_name',           v_owner.full_name,
      'role',                v_owner.role,
      'phone',               v_owner.phone,
      'created_at',          v_owner.created_at,
      'last_sign_in_at',     v_owner.last_sign_in_at,
      'email_confirmed_at',  v_owner.email_confirmed_at
    ) END,
    'vehicles',           v_vehicles,
    'vehicles_by_type',   v_vehicles_by_type,
    'documents',          v_documents,
    'documents_by_category', v_docs_by_category,
    'expiring_docs_30d',  v_expiring_docs,
    'members',            v_members,
    'activity',           v_activity,
    'totals', jsonb_build_object(
      'spend_total',       v_expenses_total,
      'spend_by_category', v_expenses_by_cat,
      'routes',            v_routes_count,
      'repairs',           v_repairs_count,
      'maintenance',       v_maintenance_count,
      'vehicles',          jsonb_array_length(v_vehicles),
      'documents',         jsonb_array_length(v_documents),
      'members',           jsonb_array_length(v_members)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_account_details(uuid) TO authenticated;

-- Quick smoke test (run after creating). Uncomment + replace UUID:
-- SELECT admin_account_details('00000000-0000-0000-0000-000000000000');

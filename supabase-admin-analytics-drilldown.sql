-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-analytics-drilldown.sql — Phase 2/3 of analytics.
--
-- RPC: admin_analytics_drilldown(p_segment jsonb)
--
-- One generic RPC that powers every drill-down click on /AdminAnalytics.
-- Caller passes a `segment` describing what was clicked; function returns
-- title + columns + rows. The frontend feeds it into a single reusable
-- Sheet component.
--
-- Segment shapes:
--   {"type": "age_bucket",   "bucket": "25-34"}          -- pie slice
--   {"type": "age_bucket",   "bucket": "לא הוזן"}        -- unknown
--   {"type": "vehicle_type", "vehicle_type": "פרטי"}     -- types bar
--   {"type": "signup_day",   "day": "2026-05-24"}        -- signups bar
--   {"type": "wau_week",     "week_start": "2026-05-18"} -- WAU point
--   {"type": "vehicles_week","week_start": "2026-05-18"} -- vehicles bar
--   {"type": "docs_week",    "week_start": "2026-05-18"} -- docs bar
--   {"type": "errors_day",   "day": "2026-05-24"}        -- errors bar
--   {"type": "kpi_total_users"}                          -- total signups KPI
--   {"type": "kpi_active_week"}                          -- WAU latest KPI
--   {"type": "kpi_total_vehicles"}                       -- all vehicles KPI
--   {"type": "kpi_errors_14d"}                           -- errors KPI
--
-- Returns:
--   { "title": "משתמשים בגיל 25-34", "columns": [{"key":"email","label":"אימייל"},...],
--     "rows": [ {...}, {...} ],
--     "total": 12 }
--
-- Gated by public.is_admin(). Re-runnable via CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_analytics_drilldown(jsonb);

CREATE FUNCTION public.admin_analytics_drilldown(p_segment jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type    text;
  v_title   text;
  v_columns jsonb;
  v_rows    jsonb := '[]'::jsonb;
  v_total   integer := 0;

  -- Column definition shortcuts to keep each branch readable.
  v_cols_user        constant jsonb := jsonb_build_array(
    jsonb_build_object('key','email',          'label','אימייל'),
    jsonb_build_object('key','full_name',      'label','שם'),
    jsonb_build_object('key','phone',          'label','טלפון'),
    jsonb_build_object('key','signup_at',      'label','נרשם'),
    jsonb_build_object('key','last_sign_in_at','label','התחבר לאחרונה')
  );
  v_cols_user_with_age constant jsonb := jsonb_build_array(
    jsonb_build_object('key','email',          'label','אימייל'),
    jsonb_build_object('key','full_name',      'label','שם'),
    jsonb_build_object('key','age',            'label','גיל'),
    jsonb_build_object('key','signup_at',      'label','נרשם'),
    jsonb_build_object('key','last_sign_in_at','label','התחבר לאחרונה')
  );
  v_cols_vehicle     constant jsonb := jsonb_build_array(
    jsonb_build_object('key','license_plate',  'label','לוחית רישוי'),
    jsonb_build_object('key','vehicle_type',   'label','סוג'),
    jsonb_build_object('key','make',           'label','יצרן'),
    jsonb_build_object('key','model',          'label','דגם'),
    jsonb_build_object('key','year',           'label','שנה'),
    jsonb_build_object('key','owner_email',    'label','בעלים'),
    jsonb_build_object('key','created_at',     'label','נוסף')
  );
  v_cols_error       constant jsonb := jsonb_build_array(
    jsonb_build_object('key','type',           'label','סוג'),
    jsonb_build_object('key','message',        'label','הודעה'),
    jsonb_build_object('key','url',            'label','כתובת'),
    jsonb_build_object('key','user_email',     'label','משתמש'),
    jsonb_build_object('key','created_at',     'label','זמן')
  );
  v_cols_document    constant jsonb := jsonb_build_array(
    jsonb_build_object('key','doc_type',       'label','סוג'),
    jsonb_build_object('key','title',          'label','כותרת'),
    jsonb_build_object('key','owner_email',    'label','בעלים'),
    jsonb_build_object('key','created_at',     'label','נוסף')
  );
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  v_type := p_segment->>'type';

  -- ═══════════════════════════════════════════════════════════════════
  -- age_bucket — users in a specific age bucket (or unknown)
  -- ═══════════════════════════════════════════════════════════════════
  IF v_type = 'age_bucket' THEN
    DECLARE v_bucket text := p_segment->>'bucket';
    BEGIN
      v_title   := 'משתמשים: ' || v_bucket;
      v_columns := v_cols_user_with_age;
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.signup_at DESC), '[]'::jsonb), COUNT(*)
      INTO v_rows, v_total
      FROM (
        SELECT
          u.email,
          COALESCE(u.raw_user_meta_data->>'full_name','')                   AS full_name,
          CASE WHEN p.birth_date IS NULL THEN NULL
               ELSE EXTRACT(YEAR FROM age(p.birth_date))::int
          END                                                                AS age,
          u.created_at                                                       AS signup_at,
          u.last_sign_in_at
        FROM auth.users u
        LEFT JOIN public.user_profiles p ON p.user_id = u.id
        WHERE
          (v_bucket = 'לא הוזן' AND p.birth_date IS NULL)
          OR (v_bucket = '18-24' AND p.birth_date > (now()-interval '25 years')::date)
          OR (v_bucket = '25-34' AND p.birth_date <= (now()-interval '25 years')::date AND p.birth_date > (now()-interval '35 years')::date)
          OR (v_bucket = '35-44' AND p.birth_date <= (now()-interval '35 years')::date AND p.birth_date > (now()-interval '45 years')::date)
          OR (v_bucket = '45-54' AND p.birth_date <= (now()-interval '45 years')::date AND p.birth_date > (now()-interval '55 years')::date)
          OR (v_bucket = '55-64' AND p.birth_date <= (now()-interval '55 years')::date AND p.birth_date > (now()-interval '65 years')::date)
          OR (v_bucket = '65+'   AND p.birth_date <= (now()-interval '65 years')::date)
      ) r;
    END;

  -- ═══════════════════════════════════════════════════════════════════
  -- vehicle_family — vehicles in a Tier-1 marketing family (e.g.
  -- "דו-גלגלי" contains אופנוע כביש + קטנוע + אנדורו + מוטוקרוס).
  -- The family→subtype map is duplicated client-side in AdminAnalytics
  -- (FAMILY_MAP); keep them in sync if you add a new family or subtype.
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'vehicle_family' THEN
    DECLARE
      v_family text := p_segment->>'family';
      v_subtypes text[] := CASE v_family
        WHEN 'רכבים פרטיים'   THEN ARRAY['רכב','רכב פרטי','רכב אספנות']
        WHEN 'דו-גלגלי'        THEN ARRAY['אופנוע','אופנוע כביש','קטנוע','אנדורו','מוטוקרוס']
        WHEN 'מסחרי / מקצועי' THEN ARRAY['משאית','אוטובוס','רכב תפעולי','נגרר','קרוואן','מחרשה','טרקטור','רכב מסחרי','גרור','נתמך']
        WHEN 'כלי שייט'        THEN ARRAY['מפרשית','סירה מנועית','אופנוע ים','סירת גומי']
        WHEN 'כלי טיס'         THEN ARRAY['מטוס פרטי','רחפן']
        WHEN 'כלי צמ"ה'        THEN ARRAY[
          'מחפר','מחפר זחלי','מחפר אופני','מיני מחפר','מחפרון',
          'דחפור','דחפור זחלי','שופל','מעמיס אופני','מעמיס זחלי',
          'מלגזה','מלגזת שטח','טלהנדלר','גלגלת','גלגלת אספלט','גלגלת רטט',
          'משאבת בטון','מערבל בטון','עגלת מערבל','עגורן','עגורן צריח',
          'מנוף','מנוף שטח','מקדח','מקדח שטח','רכב צמ"ה'
        ]
        ELSE NULL
      END;
    BEGIN
      v_title   := 'רכבים: משפחת ' || v_family;
      v_columns := v_cols_vehicle;
      IF v_subtypes IS NULL THEN
        -- "אחר" / unknown family: show vehicles whose type is NOT in any mapped family.
        SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb), COUNT(*)
        INTO v_rows, v_total
        FROM (
          SELECT
            v.license_plate, v.vehicle_type, v.make, v.model, v.year,
            owner.email AS owner_email, v.created_at
          FROM public.vehicles v
          LEFT JOIN public.account_members am ON am.account_id = v.account_id
                AND am.role IN ('בעלים','owner')
          LEFT JOIN auth.users owner ON owner.id = am.user_id
          WHERE COALESCE(v.vehicle_type, '') NOT IN (
            'רכב','רכב פרטי','רכב אספנות',
            'אופנוע','אופנוע כביש','קטנוע','אנדורו','מוטוקרוס',
            'משאית','אוטובוס','רכב תפעולי','נגרר','קרוואן','מחרשה','טרקטור','רכב מסחרי','גרור','נתמך',
            'מפרשית','סירה מנועית','אופנוע ים','סירת גומי',
            'מטוס פרטי','רחפן',
            'מחפר','מחפר זחלי','מחפר אופני','מיני מחפר','מחפרון',
            'דחפור','דחפור זחלי','שופל','מעמיס אופני','מעמיס זחלי',
            'מלגזה','מלגזת שטח','טלהנדלר','גלגלת','גלגלת אספלט','גלגלת רטט',
            'משאבת בטון','מערבל בטון','עגלת מערבל','עגורן','עגורן צריח',
            'מנוף','מנוף שטח','מקדח','מקדח שטח','רכב צמ"ה'
          )
        ) r;
      ELSE
        SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb), COUNT(*)
        INTO v_rows, v_total
        FROM (
          SELECT
            v.license_plate, v.vehicle_type, v.make, v.model, v.year,
            owner.email AS owner_email, v.created_at
          FROM public.vehicles v
          LEFT JOIN public.account_members am ON am.account_id = v.account_id
                AND am.role IN ('בעלים','owner')
          LEFT JOIN auth.users owner ON owner.id = am.user_id
          WHERE v.vehicle_type = ANY(v_subtypes)
        ) r;
      END IF;
    END;

  -- ═══════════════════════════════════════════════════════════════════
  -- vehicle_type — vehicles of a specific type + their owner
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'vehicle_type' THEN
    DECLARE v_vt text := p_segment->>'vehicle_type';
    BEGIN
      v_title   := 'רכבים: ' || v_vt;
      v_columns := v_cols_vehicle;
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb), COUNT(*)
      INTO v_rows, v_total
      FROM (
        SELECT
          v.license_plate,
          v.vehicle_type,
          v.make,
          v.model,
          v.year,
          owner.email AS owner_email,
          v.created_at
        FROM public.vehicles v
        LEFT JOIN public.account_members am ON am.account_id = v.account_id
              AND am.role IN ('בעלים','owner')
        LEFT JOIN auth.users owner ON owner.id = am.user_id
        WHERE COALESCE(v.vehicle_type, 'לא צוין') = v_vt
      ) r;
    END;

  -- ═══════════════════════════════════════════════════════════════════
  -- signup_day — users who signed up on a specific date
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'signup_day' THEN
    DECLARE v_day date := (p_segment->>'day')::date;
    BEGIN
      v_title   := 'הרשמות ' || to_char(v_day, 'DD/MM/YYYY');
      v_columns := v_cols_user;
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.signup_at DESC), '[]'::jsonb), COUNT(*)
      INTO v_rows, v_total
      FROM (
        SELECT
          u.email,
          COALESCE(u.raw_user_meta_data->>'full_name','') AS full_name,
          COALESCE(p.phone, u.phone::text)                AS phone,
          u.created_at                                    AS signup_at,
          u.last_sign_in_at
        FROM auth.users u
        LEFT JOIN public.user_profiles p ON p.user_id = u.id
        WHERE u.created_at::date = v_day
      ) r;
    END;

  -- ═══════════════════════════════════════════════════════════════════
  -- wau_week — users who signed in during a specific week
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'wau_week' THEN
    DECLARE v_ws date := (p_segment->>'week_start')::date;
    BEGIN
      v_title   := 'פעילים בשבוע ' || to_char(v_ws, 'DD/MM/YYYY');
      v_columns := v_cols_user;
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.last_sign_in_at DESC), '[]'::jsonb), COUNT(*)
      INTO v_rows, v_total
      FROM (
        SELECT DISTINCT
          u.email,
          COALESCE(u.raw_user_meta_data->>'full_name','') AS full_name,
          COALESCE(p.phone, u.phone::text)                AS phone,
          u.created_at                                    AS signup_at,
          u.last_sign_in_at
        FROM auth.users u
        LEFT JOIN public.user_profiles p ON p.user_id = u.id
        WHERE u.last_sign_in_at >= v_ws
          AND u.last_sign_in_at <  v_ws + interval '7 days'
      ) r;
    END;

  -- ═══════════════════════════════════════════════════════════════════
  -- vehicles_week — vehicles added during a specific week
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'vehicles_week' THEN
    DECLARE v_ws date := (p_segment->>'week_start')::date;
    BEGIN
      v_title   := 'רכבים שנוספו בשבוע ' || to_char(v_ws, 'DD/MM/YYYY');
      v_columns := v_cols_vehicle;
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb), COUNT(*)
      INTO v_rows, v_total
      FROM (
        SELECT
          v.license_plate,
          v.vehicle_type,
          v.make,
          v.model,
          v.year,
          owner.email AS owner_email,
          v.created_at
        FROM public.vehicles v
        LEFT JOIN public.account_members am ON am.account_id = v.account_id
              AND am.role IN ('בעלים','owner')
        LEFT JOIN auth.users owner ON owner.id = am.user_id
        WHERE v.created_at >= v_ws
          AND v.created_at <  v_ws + interval '7 days'
      ) r;
    END;

  -- ═══════════════════════════════════════════════════════════════════
  -- docs_week — documents uploaded during a specific week
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'docs_week' THEN
    DECLARE v_ws date := (p_segment->>'week_start')::date;
    BEGIN
      v_title   := 'מסמכים שהועלו בשבוע ' || to_char(v_ws, 'DD/MM/YYYY');
      v_columns := v_cols_document;
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb), COUNT(*)
      INTO v_rows, v_total
      FROM (
        SELECT
          d.doc_type,
          d.title,
          owner.email AS owner_email,
          d.created_at
        FROM public.documents d
        LEFT JOIN public.account_members am ON am.account_id = d.account_id
              AND am.role IN ('בעלים','owner')
        LEFT JOIN auth.users owner ON owner.id = am.user_id
        WHERE d.created_at >= v_ws
          AND d.created_at <  v_ws + interval '7 days'
      ) r;
    END;

  -- ═══════════════════════════════════════════════════════════════════
  -- errors_day — app errors on a specific day
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'errors_day' THEN
    DECLARE v_day date := (p_segment->>'day')::date;
    BEGIN
      v_title   := 'שגיאות ' || to_char(v_day, 'DD/MM/YYYY');
      v_columns := v_cols_error;
      BEGIN
        SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb), COUNT(*)
        INTO v_rows, v_total
        FROM (
          SELECT
            e.type,
            LEFT(e.message, 200) AS message,
            e.url,
            owner.email          AS user_email,
            e.created_at
          FROM public.app_errors e
          LEFT JOIN auth.users owner ON owner.id = e.user_id
          WHERE e.created_at::date = v_day
            AND e.type NOT IN ('boot_stage')
            AND e.message NOT LIKE 'Lock was stolen%'
            AND e.message NOT LIKE 'Lock broken%'
          LIMIT 200
        ) r;
      EXCEPTION WHEN undefined_table THEN
        v_rows  := '[]'::jsonb;
        v_total := 0;
      END;
    END;

  -- ═══════════════════════════════════════════════════════════════════
  -- KPI total cards — global aggregates with no date filter
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'kpi_total_users' THEN
    v_title   := 'כל המשתמשים';
    v_columns := v_cols_user;
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.signup_at DESC), '[]'::jsonb), COUNT(*)
    INTO v_rows, v_total
    FROM (
      SELECT
        u.email,
        COALESCE(u.raw_user_meta_data->>'full_name','') AS full_name,
        COALESCE(p.phone, u.phone::text)                AS phone,
        u.created_at                                    AS signup_at,
        u.last_sign_in_at
      FROM auth.users u
      LEFT JOIN public.user_profiles p ON p.user_id = u.id
    ) r;

  ELSIF v_type = 'kpi_active_week' THEN
    v_title   := 'פעילים השבוע';
    v_columns := v_cols_user;
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.last_sign_in_at DESC NULLS LAST), '[]'::jsonb), COUNT(*)
    INTO v_rows, v_total
    FROM (
      SELECT
        u.email,
        COALESCE(u.raw_user_meta_data->>'full_name','') AS full_name,
        COALESCE(p.phone, u.phone::text)                AS phone,
        u.created_at                                    AS signup_at,
        u.last_sign_in_at
      FROM auth.users u
      LEFT JOIN public.user_profiles p ON p.user_id = u.id
      WHERE u.last_sign_in_at >= now() - interval '7 days'
    ) r;

  ELSIF v_type = 'kpi_total_vehicles' THEN
    v_title   := 'כל הרכבים במערכת';
    v_columns := v_cols_vehicle;
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb), COUNT(*)
    INTO v_rows, v_total
    FROM (
      SELECT
        v.license_plate,
        v.vehicle_type,
        v.make,
        v.model,
        v.year,
        owner.email AS owner_email,
        v.created_at
      FROM public.vehicles v
      LEFT JOIN public.account_members am ON am.account_id = v.account_id
            AND am.role IN ('בעלים','owner')
      LEFT JOIN auth.users owner ON owner.id = am.user_id
    ) r;

  ELSIF v_type = 'kpi_errors_14d' THEN
    v_title   := 'שגיאות (14 ימים)';
    v_columns := v_cols_error;
    BEGIN
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb), COUNT(*)
      INTO v_rows, v_total
      FROM (
        SELECT
          e.type,
          LEFT(e.message, 200) AS message,
          e.url,
          owner.email          AS user_email,
          e.created_at
        FROM public.app_errors e
        LEFT JOIN auth.users owner ON owner.id = e.user_id
        WHERE e.created_at >= now() - interval '14 days'
          AND e.type NOT IN ('boot_stage')
          AND e.message NOT LIKE 'Lock was stolen%'
          AND e.message NOT LIKE 'Lock broken%'
        LIMIT 200
      ) r;
    EXCEPTION WHEN undefined_table THEN
      v_rows  := '[]'::jsonb;
      v_total := 0;
    END;

  -- ═══════════════════════════════════════════════════════════════════
  -- kpi_power_users — leaderboard of users with ≥3 vehicles AND ≥10 docs
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'kpi_power_users' THEN
    v_title   := 'Power Users — 3+ רכבים, 10+ מסמכים';
    v_columns := jsonb_build_array(
      jsonb_build_object('key','email',          'label','אימייל'),
      jsonb_build_object('key','full_name',      'label','שם'),
      jsonb_build_object('key','vehicles',       'label','רכבים'),
      jsonb_build_object('key','documents',      'label','מסמכים'),
      jsonb_build_object('key','signup_at',      'label','נרשם'),
      jsonb_build_object('key','last_sign_in_at','label','התחבר לאחרונה')
    );
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.documents DESC, r.vehicles DESC), '[]'::jsonb), COUNT(*)
    INTO v_rows, v_total
    FROM (
      SELECT
        u.email,
        COALESCE(u.raw_user_meta_data->>'full_name','')  AS full_name,
        COUNT(DISTINCT v.id) AS vehicles,
        COUNT(DISTINCT d.id) AS documents,
        u.created_at         AS signup_at,
        u.last_sign_in_at
      FROM auth.users u
      JOIN public.account_members am ON am.user_id = u.id AND am.status = 'פעיל'
      LEFT JOIN public.vehicles  v ON v.account_id = am.account_id
      LEFT JOIN public.documents d ON d.account_id = am.account_id
      GROUP BY u.id, u.email, u.raw_user_meta_data, u.created_at, u.last_sign_in_at
      HAVING COUNT(DISTINCT v.id) >= 3 AND COUNT(DISTINCT d.id) >= 10
    ) r;

  -- ═══════════════════════════════════════════════════════════════════
  -- kpi_churn_risk — leaderboard: signed up >30d, ≤1 vehicle, idle 14d+
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'kpi_churn_risk' THEN
    v_title   := 'בסכנת נטישה — נרשם, לא מתקדם, לא חוזר';
    v_columns := jsonb_build_array(
      jsonb_build_object('key','email',          'label','אימייל'),
      jsonb_build_object('key','full_name',      'label','שם'),
      jsonb_build_object('key','vehicles',       'label','רכבים'),
      jsonb_build_object('key','days_idle',      'label','ימים ללא כניסה'),
      jsonb_build_object('key','signup_at',      'label','נרשם'),
      jsonb_build_object('key','last_sign_in_at','label','התחבר לאחרונה')
    );
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.days_idle DESC NULLS FIRST), '[]'::jsonb), COUNT(*)
    INTO v_rows, v_total
    FROM (
      SELECT
        u.email,
        COALESCE(u.raw_user_meta_data->>'full_name','') AS full_name,
        COALESCE(vc.vehicles, 0)                        AS vehicles,
        CASE WHEN u.last_sign_in_at IS NULL THEN NULL
             ELSE EXTRACT(day FROM now() - u.last_sign_in_at)::int
        END                                             AS days_idle,
        u.created_at                                    AS signup_at,
        u.last_sign_in_at
      FROM auth.users u
      LEFT JOIN (
        SELECT am.user_id, COUNT(DISTINCT v.id) AS vehicles
        FROM public.account_members am
        LEFT JOIN public.vehicles v ON v.account_id = am.account_id
        WHERE am.status = 'פעיל'
        GROUP BY am.user_id
      ) vc ON vc.user_id = u.id
      WHERE u.created_at < now() - interval '30 days'
        AND COALESCE(vc.vehicles, 0) <= 1
        AND (u.last_sign_in_at IS NULL OR u.last_sign_in_at < now() - interval '14 days')
    ) r;

  -- ═══════════════════════════════════════════════════════════════════
  -- kpi_north_star — users who got a reminder in 30d, did they return?
  -- Row marker: returned=true/false based on the 48h window.
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'kpi_north_star' THEN
    v_title   := 'תזכורות 30 ימים — מי חזר תוך 48 שעות?';
    v_columns := jsonb_build_array(
      jsonb_build_object('key','email',          'label','אימייל'),
      jsonb_build_object('key','full_name',      'label','שם'),
      jsonb_build_object('key','returned',       'label','חזר?'),
      jsonb_build_object('key','sent_at',        'label','תזכורת אחרונה'),
      jsonb_build_object('key','last_sign_in_at','label','התחבר לאחרונה')
    );
    BEGIN
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.sent_at DESC), '[]'::jsonb), COUNT(*)
      INTO v_rows, v_total
      FROM (
        WITH last_reminder AS (
          SELECT DISTINCT ON (user_id) user_id, sent_at
          FROM public.email_send_log
          WHERE notification_key LIKE 'reminder_%'
            AND sent_at >= now() - interval '30 days'
            AND user_id IS NOT NULL
          ORDER BY user_id, sent_at DESC
        )
        SELECT
          u.email,
          COALESCE(u.raw_user_meta_data->>'full_name','')  AS full_name,
          CASE WHEN u.last_sign_in_at IS NOT NULL
                AND u.last_sign_in_at >= lr.sent_at
                AND u.last_sign_in_at <  lr.sent_at + interval '48 hours'
               THEN 'כן' ELSE 'לא' END                     AS returned,
          lr.sent_at,
          u.last_sign_in_at
        FROM last_reminder lr
        JOIN auth.users u ON u.id = lr.user_id
      ) r;
    EXCEPTION WHEN undefined_table THEN
      v_rows  := '[]'::jsonb;
      v_total := 0;
    END;

  -- ═══════════════════════════════════════════════════════════════════
  -- kpi_activation_rate — last 30d signups, with completion status
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'kpi_activation_rate' THEN
    v_title   := 'הרשמות 30 ימים — סטטוס אקטיבציה';
    v_columns := jsonb_build_array(
      jsonb_build_object('key','email',          'label','אימייל'),
      jsonb_build_object('key','full_name',      'label','שם'),
      jsonb_build_object('key','has_vehicle',    'label','רכב?'),
      jsonb_build_object('key','has_reminder',   'label','תזכורת?'),
      jsonb_build_object('key','has_doc',        'label','מסמך?'),
      jsonb_build_object('key','signup_at',      'label','נרשם'),
      jsonb_build_object('key','last_sign_in_at','label','התחבר לאחרונה')
    );
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.signup_at DESC), '[]'::jsonb), COUNT(*)
    INTO v_rows, v_total
    FROM (
      SELECT
        u.email,
        COALESCE(u.raw_user_meta_data->>'full_name','') AS full_name,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.account_members am
          JOIN public.vehicles v ON v.account_id = am.account_id
          WHERE am.user_id = u.id AND v.created_at >= u.created_at
        ) THEN 'כן' ELSE 'לא' END AS has_vehicle,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.account_members am
          JOIN public.vehicles v ON v.account_id = am.account_id
          WHERE am.user_id = u.id AND v.first_reminder_armed_at IS NOT NULL
        ) THEN 'כן' ELSE 'לא' END AS has_reminder,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.account_members am
          JOIN public.documents d ON d.account_id = am.account_id
          WHERE am.user_id = u.id AND d.created_at >= u.created_at
        ) THEN 'כן' ELSE 'לא' END AS has_doc,
        u.created_at                                    AS signup_at,
        u.last_sign_in_at
      FROM auth.users u
      WHERE u.created_at >= now() - interval '30 days'
    ) r;

  -- ═══════════════════════════════════════════════════════════════════
  -- funnel_stage — drill-down on a specific stage of the activation funnel
  -- segment: { type: 'funnel_stage', stage: 'signup'|'email_verified'|... }
  -- Shows users who REACHED this stage (cumulative).
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'funnel_stage' THEN
    DECLARE v_stage text := p_segment->>'stage';
    BEGIN
      v_title := 'משפך אקטיבציה — שלב: ' ||
        CASE v_stage
          WHEN 'signup'         THEN 'הרשמה'
          WHEN 'email_verified' THEN 'אימות אימייל'
          WHEN 'first_vehicle'  THEN 'רכב ראשון'
          WHEN 'first_reminder' THEN 'תזכורת ראשונה'
          WHEN 'first_document' THEN 'מסמך ראשון'
          ELSE v_stage
        END;
      v_columns := v_cols_user;
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.signup_at DESC), '[]'::jsonb), COUNT(*)
      INTO v_rows, v_total
      FROM (
        SELECT
          u.email,
          COALESCE(u.raw_user_meta_data->>'full_name','') AS full_name,
          COALESCE(p.phone, u.phone::text)                AS phone,
          u.created_at                                    AS signup_at,
          u.last_sign_in_at
        FROM auth.users u
        LEFT JOIN public.user_profiles p ON p.user_id = u.id
        WHERE u.created_at >= now() - interval '30 days'
          AND CASE v_stage
                WHEN 'signup'         THEN TRUE
                WHEN 'email_verified' THEN u.email_confirmed_at IS NOT NULL
                WHEN 'first_vehicle'  THEN EXISTS (
                  SELECT 1 FROM public.account_members am
                  JOIN public.vehicles v ON v.account_id = am.account_id
                  WHERE am.user_id = u.id AND v.created_at >= u.created_at
                )
                WHEN 'first_reminder' THEN EXISTS (
                  SELECT 1 FROM public.account_members am
                  JOIN public.vehicles v ON v.account_id = am.account_id
                  WHERE am.user_id = u.id AND v.first_reminder_armed_at IS NOT NULL
                )
                WHEN 'first_document' THEN EXISTS (
                  SELECT 1 FROM public.account_members am
                  JOIN public.documents d ON d.account_id = am.account_id
                  WHERE am.user_id = u.id AND d.created_at >= u.created_at
                )
                ELSE FALSE
              END
      ) r;
    END;

  -- ═══════════════════════════════════════════════════════════════════
  -- retention_segment — Phase 3 head-to-head segments.
  -- segment: {type:'retention_segment', bucket:'multi'|'single'|'docrich'|'docpoor'}
  -- Cohort = signed up 30-90 days ago. Returns the bucket's users with
  -- a "returned_d30" flag column.
  -- ═══════════════════════════════════════════════════════════════════
  ELSIF v_type = 'retention_segment' THEN
    DECLARE v_bucket text := p_segment->>'bucket';
    BEGIN
      v_title := 'שימור D30 — ' || CASE v_bucket
        WHEN 'multi'   THEN 'חשבונות עם 2+ חברים'
        WHEN 'single'  THEN 'חשבון יחיד (חבר אחד)'
        WHEN 'docrich' THEN '3+ מסמכים'
        WHEN 'docpoor' THEN '0 מסמכים'
        ELSE v_bucket
      END;
      v_columns := jsonb_build_array(
        jsonb_build_object('key','email',          'label','אימייל'),
        jsonb_build_object('key','full_name',      'label','שם'),
        jsonb_build_object('key','returned_d30',   'label','חזר D30?'),
        jsonb_build_object('key','doc_count',      'label','מסמכים'),
        jsonb_build_object('key','signup_at',      'label','נרשם'),
        jsonb_build_object('key','last_sign_in_at','label','התחבר לאחרונה')
      );
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.signup_at DESC), '[]'::jsonb), COUNT(*)
      INTO v_rows, v_total
      FROM (
        WITH eligible AS (
          SELECT u.id, u.email, u.raw_user_meta_data, u.created_at, u.last_sign_in_at
          FROM auth.users u
          WHERE u.created_at <= now() - interval '30 days'
            AND u.created_at >  now() - interval '90 days'
        ),
        enriched AS (
          SELECT
            e.*,
            EXISTS (
              SELECT 1 FROM public.account_members am1
              WHERE am1.user_id = e.id
                AND (SELECT COUNT(*) FROM public.account_members am2
                     WHERE am2.account_id = am1.account_id AND am2.status = 'פעיל') >= 2
            ) AS is_multi_member,
            (SELECT COUNT(DISTINCT d.id)
               FROM public.account_members am
               JOIN public.documents d ON d.account_id = am.account_id
              WHERE am.user_id = e.id) AS doc_count
          FROM eligible e
        )
        SELECT
          email,
          COALESCE(raw_user_meta_data->>'full_name','') AS full_name,
          CASE WHEN last_sign_in_at > created_at + interval '30 days' THEN 'כן' ELSE 'לא' END AS returned_d30,
          doc_count,
          created_at        AS signup_at,
          last_sign_in_at
        FROM enriched
        WHERE
          (v_bucket = 'multi'   AND is_multi_member)
          OR (v_bucket = 'single'  AND NOT is_multi_member)
          OR (v_bucket = 'docrich' AND doc_count >= 3)
          OR (v_bucket = 'docpoor' AND doc_count = 0)
      ) r;
    END;

  ELSE
    RAISE EXCEPTION 'unknown drilldown type: %', v_type;
  END IF;

  RETURN jsonb_build_object(
    'title',   v_title,
    'columns', v_columns,
    'rows',    v_rows,
    'total',   v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_analytics_drilldown(jsonb) TO authenticated;

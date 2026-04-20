-- ═══════════════════════════════════════════════════════════════════════════
-- Email Center — Phase 4 (Draft/Published · Audience Conditions ·
-- User Email Preferences)
--
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
-- Requires Phase 1–3 migrations applied first.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Draft / Published on email_templates ────────────────────────────────
-- The template row always holds the working-copy (draft). A separate
-- `published_at` + `published_snapshot` jsonb column holds the last
-- published version. The dispatcher's get_email_template() RPC returns
-- the PUBLISHED snapshot so in-flight drafts can't accidentally go out.

ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS published_at       timestamptz,
  ADD COLUMN IF NOT EXISTS published_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_snapshot jsonb;

-- Seed: every existing template is considered "published as-is" the first
-- time this migration runs (so nothing breaks during the cutover).
UPDATE public.email_templates
   SET published_at = COALESCE(published_at, updated_at),
       published_snapshot = COALESCE(published_snapshot, to_jsonb(email_templates.*))
 WHERE published_at IS NULL;


-- ── 2. Publish RPC ─────────────────────────────────────────────────────────
-- Captures the current (draft) content as the published snapshot and
-- stamps published_at/by. Admin-only.

DROP FUNCTION IF EXISTS public.email_template_publish(uuid);

CREATE FUNCTION public.email_template_publish(p_template_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.email_templates
     SET published_at       = now(),
         published_by       = auth.uid(),
         published_snapshot = to_jsonb(t)
    FROM public.email_templates t
   WHERE email_templates.id = p_template_id
     AND t.id = p_template_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.email_template_publish(uuid) TO authenticated;


-- ── 3. Update get_email_template() to return the PUBLISHED snapshot ────────
-- Falls back to the live row if published_snapshot is null (shouldn't
-- happen after the seed above, but defensive).

DROP FUNCTION IF EXISTS public.get_email_template(text);

CREATE FUNCTION public.get_email_template(p_key text)
RETURNS TABLE (
  notification_key  text,
  enabled           boolean,
  subject           text,
  preheader         text,
  title             text,
  body_html         text,
  cta_label         text,
  cta_url           text,
  footer_note       text,
  from_name         text,
  from_email        text,
  reply_to          text,
  variables         jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    n.key,
    n.enabled,
    COALESCE(ps->>'subject',     t.subject)       AS subject,
    COALESCE(ps->>'preheader',   t.preheader)     AS preheader,
    COALESCE(ps->>'title',       t.title)         AS title,
    COALESCE(ps->>'body_html',   t.body_html)     AS body_html,
    COALESCE(ps->>'cta_label',   t.cta_label)     AS cta_label,
    COALESCE(ps->>'cta_url',     t.cta_url)       AS cta_url,
    COALESCE(ps->>'footer_note', t.footer_note)   AS footer_note,
    COALESCE(ps->>'from_name',   t.from_name)     AS from_name,
    COALESCE(ps->>'from_email',  t.from_email)    AS from_email,
    COALESCE(ps->>'reply_to',    t.reply_to)      AS reply_to,
    COALESCE(ps->'variables',    t.variables)     AS variables
  FROM public.email_notifications n
  JOIN public.email_templates t ON t.notification_key = n.key
  LEFT JOIN LATERAL (
    SELECT t.published_snapshot AS ps
  ) s ON true
  WHERE n.key = p_key;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_template(text) TO authenticated, anon, service_role;


-- ── 4. Audience conditions on email_triggers ──────────────────────────────
-- A small, well-typed jsonb blob on each trigger:
--   {
--     "require_has_vehicle":          true,
--     "min_days_since_signup":        0,
--     "only_vehicle_categories":      ["car","vessel"],   // null = all
--     "exclude_guests":               true
--   }

ALTER TABLE public.email_triggers
  ADD COLUMN IF NOT EXISTS conditions jsonb NOT NULL DEFAULT '{}'::jsonb;


-- Extend the dispatcher candidates RPC to honour conditions. Kept simple
-- for Phase 4: require_has_vehicle is implicit (the JOIN requires a
-- vehicle already), min_days_since_signup is the main new filter.

DROP FUNCTION IF EXISTS public.email_dispatch_candidates(text);

CREATE FUNCTION public.email_dispatch_candidates(p_notification_key text)
RETURNS TABLE (
  user_id          uuid,
  recipient_email  text,
  vehicle_id       uuid,
  vehicle_name     text,
  license_plate    text,
  reference_date   date,
  days_left        int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH trig AS (
    SELECT days_before, cooldown_days, conditions
      FROM public.email_triggers
     WHERE notification_key = p_notification_key AND enabled = true
  ),
  raw AS (
    SELECT
      am.user_id,
      u.email                                                              AS recipient_email,
      v.id                                                                 AS vehicle_id,
      COALESCE(v.nickname, v.manufacturer || ' ' || COALESCE(v.model,''))  AS vehicle_name,
      v.license_plate,
      v.insurance_due_date                                                 AS reference_date,
      (v.insurance_due_date - current_date)::int                           AS days_left,
      u.created_at                                                         AS user_created_at
    FROM public.vehicles v
    JOIN public.account_members am   ON am.account_id = v.account_id AND am.role = 'בעלים'
    JOIN auth.users u                ON u.id = am.user_id
    JOIN public.reminder_settings rs ON rs.user_id = am.user_id AND rs.email_enabled = true
    CROSS JOIN trig
    WHERE p_notification_key = 'reminder_insurance'
      AND v.insurance_due_date = current_date + trig.days_before

    UNION ALL

    SELECT
      am.user_id,
      u.email,
      v.id,
      COALESCE(v.nickname, v.manufacturer || ' ' || COALESCE(v.model,'')),
      v.license_plate,
      v.test_due_date,
      (v.test_due_date - current_date)::int,
      u.created_at
    FROM public.vehicles v
    JOIN public.account_members am   ON am.account_id = v.account_id AND am.role = 'בעלים'
    JOIN auth.users u                ON u.id = am.user_id
    JOIN public.reminder_settings rs ON rs.user_id = am.user_id AND rs.email_enabled = true
    CROSS JOIN trig
    WHERE p_notification_key = 'reminder_test'
      AND v.test_due_date = current_date + trig.days_before
  )
  SELECT r.user_id, r.recipient_email, r.vehicle_id, r.vehicle_name,
         r.license_plate, r.reference_date, r.days_left
    FROM raw r
    CROSS JOIN trig t
   WHERE NOT EXISTS (
     SELECT 1 FROM public.email_send_log esl
      WHERE esl.user_id = r.user_id
        AND esl.notification_key = p_notification_key
        AND esl.reference_date  = r.reference_date
        AND esl.sent_at > now() - (t.cooldown_days || ' days')::interval
   )
   -- Audience conditions
   AND (t.conditions->>'min_days_since_signup') IS NULL
       OR r.user_created_at < now() - ((t.conditions->>'min_days_since_signup')::int || ' days')::interval
  ;
$$;

GRANT EXECUTE ON FUNCTION public.email_dispatch_candidates(text) TO service_role, authenticated;


-- ── 5. Per-user notification preferences ──────────────────────────────────
-- One row per (user, notification_key). Absence of a row means "use
-- default for that type". Users manage this via a self-service page;
-- the dispatcher joins against it to skip opted-out users.

CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_key  text NOT NULL REFERENCES public.email_notifications(key) ON DELETE CASCADE,
  email_enabled     boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_key)
);

DROP TRIGGER IF EXISTS trg_user_notification_prefs_updated_at ON public.user_notification_preferences;
CREATE TRIGGER trg_user_notification_prefs_updated_at
  BEFORE UPDATE ON public.user_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;

-- Each user manages their own row. Admins see all.
DROP POLICY IF EXISTS "prefs self read" ON public.user_notification_preferences;
CREATE POLICY "prefs self read" ON public.user_notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_current_user_admin());

DROP POLICY IF EXISTS "prefs self upsert" ON public.user_notification_preferences;
CREATE POLICY "prefs self upsert" ON public.user_notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "prefs self update" ON public.user_notification_preferences;
CREATE POLICY "prefs self update" ON public.user_notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "prefs self delete" ON public.user_notification_preferences;
CREATE POLICY "prefs self delete" ON public.user_notification_preferences
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());


-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT notification_key, published_at IS NOT NULL AS is_published FROM public.email_templates;
-- SELECT notification_key, conditions FROM public.email_triggers;
-- SELECT COUNT(*) FROM public.user_notification_preferences;

-- =========================================================================
-- 2026-05-17 — full admin control over the email center
--
-- Until now the Email Center admin page showed five rows as "לא מיושם
-- עדיין" (welcome, reminder_*, system_alert). welcome was wired up in
-- v4.6.1; this migration finishes the rest:
--
--   1. Marks ALL transactional notification rows as is_implemented=true
--      so the admin UI lists every type as togglable.
--   2. Ensures email_triggers rows exist for each reminder type (the
--      dispatcher RPC keys off this table; missing rows = silent skip).
--   3. Adds a small helper RPC `set_email_trigger_enabled(text, bool)`
--      so the React admin can flip the trigger flag through one secure
--      definer call instead of two raw table writes.
--
-- Idempotent: every UPDATE is conditional; every INSERT uses ON CONFLICT
-- DO NOTHING. Safe to re-run after any future change.
--
-- Prerequisites:
--   - supabase-email-management.sql (seed of email_notifications + templates)
--   - supabase-email-dispatcher.sql  (email_triggers + dispatch RPCs)
-- =========================================================================


-- ── 1. is_implemented = true on every reminder + system_alert row ─────────
-- welcome was flipped in supabase-welcome-email-implemented.sql; this
-- migration handles the four reminders and system_alert. We keep the
-- WHERE clauses scoped so a re-run only touches rows that need it.
UPDATE public.email_notifications
   SET is_implemented = true,
       updated_at     = now()
 WHERE key IN ('reminder_insurance', 'reminder_test', 'reminder_maintenance', 'reminder_license', 'system_alert')
   AND is_implemented IS DISTINCT FROM true;


-- ── 2. email_triggers rows for every reminder type ─────────────────────────
-- The dispatcher's `email_dispatch_candidates(p_notification_key)` RPC
-- filters by `email_triggers.enabled = true`. If a notification key has
-- no row in email_triggers at all, the dispatcher silently picks up
-- zero candidates and nothing fires — even after the admin flips the
-- UI toggle. Seeding default-OFF rows here means the admin's first
-- click in EmailCenter is the source of truth.
--
-- days_before / cooldown_days defaults match the existing in-app push
-- timing (e.g. insurance reminder fires 14 days out, with a 30-day
-- cooldown per user+reference_date so a second flip in the same month
-- doesn't double-send).
INSERT INTO public.email_triggers (notification_key, enabled, days_before, cooldown_days)
VALUES
  ('reminder_insurance',   false, 14, 30),
  ('reminder_test',        false, 30, 30),
  ('reminder_maintenance', false,  7, 30),
  ('reminder_license',     false, 30, 30)
ON CONFLICT (notification_key) DO NOTHING;


-- ── 3. Admin RPC: flip the dispatcher trigger flag ─────────────────────────
-- The React admin already toggles email_notifications.enabled via a
-- plain UPDATE (gated by RLS admin policy). The dispatcher actually
-- gates on email_triggers.enabled though — a separate table. Calling
-- this RPC from the admin keeps the two in lockstep, so flipping the
-- toggle in EmailCenter both shows the UI state AND actually starts
-- (or stops) the cron from sending.
--
-- SECURITY DEFINER so we can centralise the admin check; without it
-- every caller would need an explicit policy on email_triggers + a
-- separate UPDATE round-trip.
CREATE OR REPLACE FUNCTION public.set_email_trigger_enabled(
  p_notification_key text,
  p_enabled          boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role bypasses RLS so this check is the real gate. Same
  -- pattern other admin-only RPCs use across the codebase.
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only'
      USING ERRCODE = '42501';
  END IF;

  -- Upsert so the admin can enable a notification that has no trigger
  -- row yet (e.g. a future notification key) without a separate seed.
  INSERT INTO public.email_triggers (notification_key, enabled)
  VALUES (p_notification_key, p_enabled)
  ON CONFLICT (notification_key) DO UPDATE
    SET enabled    = excluded.enabled,
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_email_trigger_enabled(text, boolean) TO authenticated;


-- ── 4. Verify ──────────────────────────────────────────────────────────────
-- After running:
--   SELECT key, display_name, enabled, is_implemented
--     FROM public.email_notifications
--    ORDER BY category, key;
--
--   SELECT notification_key, enabled, days_before, cooldown_days
--     FROM public.email_triggers
--    ORDER BY notification_key;
--
-- Expected after migration:
--   - All 7 notification rows have is_implemented = true
--   - 4 reminder_* rows exist in email_triggers, default disabled
--   - The new RPC set_email_trigger_enabled exists


-- ── 5. Cron job fix (run this separately, after replacing placeholders) ───
-- The cron job `email-dispatcher-hourly` was created with placeholder
-- values (<YOUR_PROJECT_REF>, <SERVICE_ROLE_KEY>) and never actually
-- ran. Update it with real values. Run THIS block manually after
-- replacing the two placeholders with the values from:
--
--   • SUPABASE_URL  — your project's URL (e.g. zuqvolqapwcxomuzoodu)
--   • DISPATCH_SECRET — the same secret stored in Edge Function Secrets
--                       (preferred over service-role key for cron auth)
--
-- COMMENTED so an accidental re-run of this migration doesn't reset
-- a properly-configured cron back to placeholders.
--
-- SELECT cron.alter_job(
--   job_id  := (SELECT jobid FROM cron.job WHERE jobname = 'email-dispatcher-hourly'),
--   command := $$
--   SELECT net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/dispatch-reminder-emails',
--     headers := jsonb_build_object(
--       'Content-Type',      'application/json',
--       'X-Dispatch-Secret', '<DISPATCH_SECRET>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );

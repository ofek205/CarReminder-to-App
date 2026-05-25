-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-reminder-snoozes.sql — per-vehicle reminder snooze
--
-- WHY: Users get recurring reminders (test, insurance, license, maintenance)
-- and currently have no way to silence a specific one. The only option is
-- disabling ALL reminders for a vehicle — which means they forget to
-- re-enable and miss future alerts. Snooze lets the user say "I know,
-- remind me later" without turning off the system.
--
-- Snooze is per (user, vehicle, reminder_type). When active, ALL channels
-- (push, email, in-app) are silenced for that combination.
--
-- Re-runnable. Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reminder_snoozes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id      uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  reminder_type   text NOT NULL,
  snoozed_until   timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.reminder_snoozes IS
'Per-vehicle reminder snooze. One active row = "don''t remind me about this until snoozed_until". Channels: push + email + in-app. Expires automatically — the scheduler/cron checks snoozed_until > now().';

-- UNIQUE: one snooze per user + vehicle + type. Upsert pattern (ON CONFLICT UPDATE).
CREATE UNIQUE INDEX IF NOT EXISTS reminder_snoozes_uq
  ON public.reminder_snoozes (user_id, vehicle_id, reminder_type);

CREATE INDEX IF NOT EXISTS reminder_snoozes_user_idx
  ON public.reminder_snoozes (user_id);

-- Note: partial index with `WHERE snoozed_until > now()` is not allowed
-- because now() is not IMMUTABLE. A plain index works fine — the query
-- planner filters expired rows at query time.
CREATE INDEX IF NOT EXISTS reminder_snoozes_until_idx
  ON public.reminder_snoozes (snoozed_until);

ALTER TABLE public.reminder_snoozes ENABLE ROW LEVEL SECURITY;

-- Users can read/write/delete their own snoozes only.
DROP POLICY IF EXISTS reminder_snoozes_own_select ON public.reminder_snoozes;
CREATE POLICY reminder_snoozes_own_select ON public.reminder_snoozes
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS reminder_snoozes_own_insert ON public.reminder_snoozes;
CREATE POLICY reminder_snoozes_own_insert ON public.reminder_snoozes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS reminder_snoozes_own_update ON public.reminder_snoozes;
CREATE POLICY reminder_snoozes_own_update ON public.reminder_snoozes
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS reminder_snoozes_own_delete ON public.reminder_snoozes;
CREATE POLICY reminder_snoozes_own_delete ON public.reminder_snoozes
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Admin read for support / analytics.
DROP POLICY IF EXISTS reminder_snoozes_admin_read ON public.reminder_snoozes;
CREATE POLICY reminder_snoozes_admin_read ON public.reminder_snoozes
  FOR SELECT TO authenticated USING (public.is_admin());


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS:
--   INSERT INTO public.reminder_snoozes (user_id, vehicle_id, reminder_type, snoozed_until)
--     VALUES (auth.uid(), '<vehicle-uuid>', 'test', now() + interval '7 days')
--     ON CONFLICT (user_id, vehicle_id, reminder_type)
--     DO UPDATE SET snoozed_until = EXCLUDED.snoozed_until;
--
--   SELECT * FROM public.reminder_snoozes WHERE user_id = auth.uid();
--   DELETE FROM public.reminder_snoozes WHERE user_id = auth.uid() AND vehicle_id = '<vid>' AND reminder_type = 'test';
-- ═══════════════════════════════════════════════════════════════════════════

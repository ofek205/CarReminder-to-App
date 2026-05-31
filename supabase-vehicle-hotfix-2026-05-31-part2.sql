-- ═══════════════════════════════════════════════════════════════════════════
-- Vehicle hotfix 2026-05-31 (part 2) — missing user_id indexes
-- ═══════════════════════════════════════════════════════════════════════════
-- Follow-up to supabase-vehicle-hotfix-2026-05-30.sql.
--
-- After fixing vehicles.account_id, the Telegram slow_query alerts still
-- showed multiple ~5s queries on /vehicle-check page load. Production
-- app_errors row inspection (2026-05-31 06:53 cluster) revealed FOUR
-- tables hitting the threshold in parallel on the same mount:
--
--   • vehicles.filter         (fixed by part 1's idx_vehicles_account_id)
--   • account_members.filter  (already covered — see
--                              supabase-account-members-perf-index.sql)
--   • user_profiles.filter    ← THIS FILE: missing user_id index
--   • reminder_settings.filter ← THIS FILE: missing user_id index
--
-- Why they all race in parallel:
--   - NotificationBell mounts on every authed page → fires
--     account_members + reminder_settings + user_profiles
--   - useNotificationScheduler fires reminder_settings
--   - useUserProfile fires user_profiles
--   - GuestDataContext fires account_members
-- → 4 concurrent seq scans, all crossing the 3s slow_query threshold.
--
-- Both filters always use `user_id = auth.uid()` (every call site
-- audited). Plain B-tree on (user_id) is enough.
--
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS user_profiles_user_id_perf_idx
  ON public.user_profiles (user_id);

CREATE INDEX IF NOT EXISTS reminder_settings_user_id_perf_idx
  ON public.reminder_settings (user_id);

-- Help the planner pick up the new indexes immediately. Without ANALYZE
-- the optimizer may still choose a seq scan based on stale statistics
-- until autovacuum catches up (could be hours).
ANALYZE public.user_profiles;
ANALYZE public.reminder_settings;


-- ════════════════════════════════════════════════════════════════════
-- Verification (paste into SQL Editor after running the above):
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  up_idx boolean;
  rs_idx boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='user_profiles'
      AND indexname='user_profiles_user_id_perf_idx'
  ) INTO up_idx;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='reminder_settings'
      AND indexname='reminder_settings_user_id_perf_idx'
  ) INTO rs_idx;

  RAISE NOTICE 'user_profiles_user_id_perf_idx exists: %', up_idx;
  RAISE NOTICE 'reminder_settings_user_id_perf_idx exists: %', rs_idx;
END $$;

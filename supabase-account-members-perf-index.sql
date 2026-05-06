-- Performance index for the hottest membership lookup in the app.
--
-- Why this index is needed:
--   account_members(user_id, status) is read on every workspace boot,
--   inside the v_user_workspaces view, in the my_vehicles_v owned-arm
--   subquery, and in every page-level fallback that bypasses the
--   workspace context (Dashboard.jsx init useEffect, Vehicles.jsx
--   fallbackAccountId effect). The same column pair is filtered with
--   `where user_id = auth.uid() and status = 'פעיל'` in all of these
--   call sites.
--
--   Without this index PostgreSQL can pick a sequential scan once the
--   table grows, and the planner cost estimate for the IN-subquery
--   inside my_vehicles_v becomes unstable across user data sizes —
--   contributing to intermittent "stuck on loading" reports where
--   one cold-start session times out and the next one is fast.
--
--   Status values in this codebase are Hebrew strings ('פעיל', 'הוסר',
--   'ממתין'). The index is partial on status='פעיל' because the
--   read-path almost always filters to active memberships only, and
--   a partial index keeps the on-disk footprint small (≈ 1 row per
--   active user).
--
-- Idempotent: safe to apply on staging and production without
-- coordination. CONCURRENTLY avoids locking the table during creation.

CREATE INDEX CONCURRENTLY IF NOT EXISTS account_members_user_active_perf_idx
  ON public.account_members(user_id)
  WHERE status = 'פעיל';

-- Companion non-partial index for code paths that read all statuses
-- (Dashboard.jsx init filters to 'פעיל' in JS but pulls all statuses
-- first to handle legacy NULL/'active'/'ממתין' rows). Without this
-- the broader filter still triggers a seq scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS account_members_user_id_perf_idx
  ON public.account_members(user_id);

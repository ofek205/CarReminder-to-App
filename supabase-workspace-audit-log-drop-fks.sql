-- ==========================================================================
-- workspace_audit_log — drop FK cascades that conflict with immutability
--
-- 🐞 Production bug fix (2026-05-15):
-- Deleting any vehicle (and any route) failed with
--   "activity_log_immutable: rows in workspace_audit_log cannot be
--    updated. Create a new log entry instead."
--
-- Root cause: Phase 7 (supabase-phase7-activity-log.sql) introduced two
-- FK columns on workspace_audit_log with ON DELETE SET NULL:
--
--   alter table public.workspace_audit_log
--     add column vehicle_id uuid references public.vehicles(id) on delete set null,
--     add column route_id   uuid references public.routes(id)   on delete set null;
--
-- The same migration also installed an immutability trigger
-- (prevent_audit_log_update) that raises restrict_violation on ANY
-- UPDATE against the table. When the parent vehicle/route is deleted,
-- Postgres internally issues an UPDATE on the audit_log rows to null out
-- the foreign key — that update trips the immutability trigger and the
-- whole DELETE rolls back.
--
-- Fix: drop the FK constraints. The audit log is a historical record;
-- it is acceptable (and desirable) for it to retain a vehicle_id or
-- route_id that points to a now-deleted parent — that is exactly what
-- "history" means. The columns themselves are kept so existing rows
-- remain queryable.
--
-- Alternative considered: teach the trigger to allow a no-op cascade
-- update where only vehicle_id/route_id changes to NULL. Rejected
-- because the trigger logic becomes brittle and a future column added
-- with the same cascade pattern would silently fail. Removing the FK
-- is the simpler, more durable answer.
--
-- Idempotent. Safe to re-run on any env.
-- ==========================================================================

ALTER TABLE public.workspace_audit_log
  DROP CONSTRAINT IF EXISTS workspace_audit_log_vehicle_id_fkey;

ALTER TABLE public.workspace_audit_log
  DROP CONSTRAINT IF EXISTS workspace_audit_log_route_id_fkey;

NOTIFY pgrst, 'reload schema';

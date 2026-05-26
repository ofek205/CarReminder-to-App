-- ==========================================================================
-- ai_usage_logs.surface — add 'maintenance_log_scan' to the allow-list
--
-- Garage receipt scans from MaintenanceSection used to go through
-- aiRequest without a `feature` or `surface` tag, so they landed in
-- ai_usage_logs with both fields NULL. We now pass:
--   feature: 'scan_extraction'
--   surface: 'maintenance_log_scan'
--
-- The Edge Function's ALLOWED_SURFACES set was updated in the same
-- commit. This migration brings the DB CHECK constraint in line so the
-- new value isn't silently dropped to NULL on insert.
--
-- Idempotent: drops the old constraint by name first, then re-adds
-- with the extended set.
-- ==========================================================================

ALTER TABLE public.ai_usage_logs
  DROP CONSTRAINT IF EXISTS ai_usage_logs_surface_check;

ALTER TABLE public.ai_usage_logs
  ADD CONSTRAINT ai_usage_logs_surface_check
  CHECK (
    surface IS NULL
    OR surface IN (
      'chat_assistant',
      'community_reply',
      'vehicle_scan',
      'vessel_scan',
      'vehicle_inline_scan',
      'driver_license_scan',
      'expense_personal_scan',
      'expense_business_scan',
      'document_scan',
      'maintenance_log_scan'        -- added 2026-05-26
    )
  );

NOTIFY pgrst, 'reload schema';

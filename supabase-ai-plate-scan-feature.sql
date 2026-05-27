-- ==========================================================================
-- ai_usage_logs — allow 'plate_scan' in the feature + surface CHECKs
--
-- PlateScanButton (Dashboard hero + /VehicleCheck) sends
-- feature: 'plate_scan'. It is intentionally NOT 'scan_extraction' so
-- the license-plate camera shortcut keeps working even when the
-- document-scan kill switch is off.
--
-- Until now 'plate_scan' was not in either CHECK list, so every plate
-- scan's usage-log insert hit a 23514 constraint violation. The proxy
-- swallows the error (logging is best-effort), so the scan still
-- worked — but it produced a console warning per scan and left plate
-- scans invisible in /AdminAiUsage.
--
-- This migration adds 'plate_scan' to both constraints. The Edge
-- Function (ALLOWED_SURFACES) and the client (PlateScanButton surface)
-- are updated in the same commit.
--
-- Idempotent — drops each constraint by name first, then re-adds.
-- ==========================================================================

ALTER TABLE public.ai_usage_logs
  DROP CONSTRAINT IF EXISTS ai_usage_logs_feature_check;
ALTER TABLE public.ai_usage_logs
  ADD CONSTRAINT ai_usage_logs_feature_check
  CHECK (
    feature IS NULL
    OR feature IN (
      'community_expert',
      'yossi_chat',
      'scan_extraction',
      'plate_scan'                  -- added 2026-05-26
    )
  );

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
      'maintenance_log_scan',
      'plate_scan'                  -- added 2026-05-26
    )
  );

NOTIFY pgrst, 'reload schema';

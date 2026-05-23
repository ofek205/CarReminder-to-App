-- supabase-maintenance-receipt-columns.sql
--
-- Adds receipt_url + receipt_storage_path to maintenance_logs so the
-- MaintenanceSection receipt-photo upload can persist.
--
-- Previously the code tried to write to a non-existent `receipt_photo`
-- column, which silently broke the INSERT when a receipt was attached.
--
-- Run ONCE in Supabase Dashboard → SQL Editor.
-- Re-runnable (IF NOT EXISTS).

ALTER TABLE public.maintenance_logs
  ADD COLUMN IF NOT EXISTS receipt_url          text,
  ADD COLUMN IF NOT EXISTS receipt_storage_path text;

COMMENT ON COLUMN public.maintenance_logs.receipt_url
  IS 'Signed URL of the receipt image in Supabase Storage (valid ~7 days, refreshed on read via storage_path).';
COMMENT ON COLUMN public.maintenance_logs.receipt_storage_path
  IS 'Stable bucket path used to re-sign receipt_url when it expires.';

-- Add notification-type toggle columns to reminder_settings
-- Run this in Supabase SQL Editor to unlock per-type notification control.
--
-- Before this migration: the UI toggles (notify_test, notify_insurance, etc.)
-- are persisted to localStorage so they don't vanish on refresh. Save works
-- but the preferences don't reach the backend.
-- After this migration: the toggles persist to Supabase and are available
-- to edge functions (device push dispatch, email sending) server-side.

ALTER TABLE reminder_settings
  ADD COLUMN IF NOT EXISTS notify_test        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_insurance   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_maintenance BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_document    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_safety      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS device_notifications_enabled BOOLEAN NOT NULL DEFAULT true;

-- After running this, update src/pages/ReminderSettingsPage.jsx:
--   Add the new columns to the DB_COLUMNS array so handleSave() includes them:
--     'notify_test','notify_insurance','notify_maintenance','notify_document',
--     'notify_safety','device_notifications_enabled'

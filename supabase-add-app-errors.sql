-- App Errors Table — remote crash reporting
-- Run this in Supabase SQL Editor to enable remote error collection.
-- Without this table, the crash reporter silently queues errors and the
-- Admin Bugs tab falls back to localStorage.

CREATE TABLE IF NOT EXISTS app_errors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT now(),
  type        TEXT NOT NULL,                -- 'Error' | 'Promise' | 'React' | custom
  message     TEXT NOT NULL,
  stack       TEXT,
  url         TEXT,
  user_agent  TEXT,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  extra       JSONB,
  resolved    BOOLEAN DEFAULT false,
  timestamp   BIGINT                         -- legacy JS timestamp (ms) from crashReporter
);

CREATE INDEX IF NOT EXISTS app_errors_created_at_idx ON app_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS app_errors_resolved_idx   ON app_errors (resolved);

ALTER TABLE app_errors ENABLE ROW LEVEL SECURITY;

-- Anyone (incl. anon/guest) may INSERT so crashes are captured even before login
DROP POLICY IF EXISTS app_errors_insert ON app_errors;
CREATE POLICY app_errors_insert ON app_errors FOR INSERT TO authenticated, anon WITH CHECK (true);

-- Only admins may read / update / resolve
DROP POLICY IF EXISTS app_errors_admin_read ON app_errors;
CREATE POLICY app_errors_admin_read ON app_errors FOR SELECT TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'ofek205@gmail.com'
    OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS app_errors_admin_update ON app_errors;
CREATE POLICY app_errors_admin_update ON app_errors FOR UPDATE TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'ofek205@gmail.com'
    OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );

-- Contact Messages Table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied', 'closed')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: authenticated users can insert, only admins can read
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_insert ON contact_messages;
CREATE POLICY contact_insert ON contact_messages FOR INSERT TO authenticated, anon WITH CHECK (true);

DROP POLICY IF EXISTS contact_admin_read ON contact_messages;
CREATE POLICY contact_admin_read ON contact_messages FOR SELECT TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'ofek205@gmail.com'
    OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );

DROP POLICY IF EXISTS contact_admin_update ON contact_messages;
CREATE POLICY contact_admin_update ON contact_messages FOR UPDATE TO authenticated
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'ofek205@gmail.com'
    OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );

-- Add to supabaseEntities
-- Run in JS: db.contact_messages.create({ ... })

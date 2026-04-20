-- ═══════════════════════════════════════════════════════════════════════════
-- Email Management Center — Phase 1 schema
--
-- Run ONCE in Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE / ON
-- CONFLICT DO NOTHING everywhere.
--
-- Creates:
--   • email_notifications          — catalog of notification types (7 seeded)
--   • email_templates              — editable content layer per notification
--   • email_template_versions      — snapshots (prepared for Phase 2)
--   • email_settings               — single-row kill switch + globals
--   • get_email_template(key)      — SECURITY DEFINER read path for server code
--
-- Reuses the existing is_current_user_admin() function (already created by
-- supabase-admin-functions.sql). Don't redefine it here.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tables ─────────────────────────────────────────────────────────────────

-- Catalog of all notifications the system knows about. `key` is the stable
-- identifier referenced from application code (sendEmail('invite', …)).
CREATE TABLE IF NOT EXISTS public.email_notifications (
  key              text PRIMARY KEY,
  display_name     text NOT NULL,
  description      text,
  category         text NOT NULL DEFAULT 'transactional'
                     CHECK (category IN ('auth','transactional','reminder','system','marketing')),
  enabled          boolean NOT NULL DEFAULT true,
  trigger_type     text NOT NULL DEFAULT 'event'
                     CHECK (trigger_type IN ('event','time','manual')),
  is_implemented   boolean NOT NULL DEFAULT false,  -- false = template exists but no dispatcher yet
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One editable template per notification (UNIQUE on notification_key).
-- Drop the UNIQUE constraint later if we need A/B variants (Phase 3+).
CREATE TABLE IF NOT EXISTS public.email_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_key  text NOT NULL REFERENCES public.email_notifications(key) ON DELETE CASCADE,
  subject           text NOT NULL,
  preheader         text,
  title             text NOT NULL,
  body_html         text NOT NULL,
  cta_label         text,
  cta_url           text,
  footer_note       text,
  from_name         text NOT NULL DEFAULT 'CarReminder',
  from_email        text NOT NULL DEFAULT 'no-reply@car-reminder.app',
  reply_to          text,
  variables         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- e.g. ["inviterName","roleLabel","inviteLink"]
  updated_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_template_per_notification UNIQUE (notification_key)
);

CREATE INDEX IF NOT EXISTS email_templates_key_idx
  ON public.email_templates(notification_key);

-- Version history — unused in Phase 1 (UI not built yet) but schema is ready
-- so Phase 2 doesn't need a migration.
CREATE TABLE IF NOT EXISTS public.email_template_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES public.email_templates(id) ON DELETE CASCADE,
  snapshot      jsonb NOT NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_template_versions_tpl_idx
  ON public.email_template_versions(template_id, created_at DESC);

-- Single-row settings table (enforced via CHECK (id = 1)). Hosts the global
-- kill switch and any future app-wide email toggles.
CREATE TABLE IF NOT EXISTS public.email_settings (
  id               int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  emails_paused    boolean NOT NULL DEFAULT false,
  pause_reason     text,
  paused_at        timestamptz,
  paused_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.email_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;


-- ── updated_at trigger ─────────────────────────────────────────────────────
-- Generic trigger — reuse if one already exists elsewhere.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_notifications_updated_at ON public.email_notifications;
CREATE TRIGGER trg_email_notifications_updated_at
  BEFORE UPDATE ON public.email_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_email_templates_updated_at ON public.email_templates;
CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_email_settings_updated_at ON public.email_settings;
CREATE TRIGGER trg_email_settings_updated_at
  BEFORE UPDATE ON public.email_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── Server-side read path ──────────────────────────────────────────────────
-- SECURITY DEFINER so Edge Functions (service-role context, where auth.uid()
-- is NULL and RLS would otherwise block reads) can fetch a template.
-- It's read-only and returns only the published template for a key — no
-- admin check, because the caller is trusted server code, not user code.
DROP FUNCTION IF EXISTS public.get_email_template(text);

CREATE FUNCTION public.get_email_template(p_key text)
RETURNS TABLE (
  notification_key  text,
  enabled           boolean,
  subject           text,
  preheader         text,
  title             text,
  body_html         text,
  cta_label         text,
  cta_url           text,
  footer_note       text,
  from_name         text,
  from_email        text,
  reply_to          text,
  variables         jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    n.key,
    n.enabled,
    t.subject,
    t.preheader,
    t.title,
    t.body_html,
    t.cta_label,
    t.cta_url,
    t.footer_note,
    t.from_name,
    t.from_email,
    t.reply_to,
    t.variables
  FROM public.email_notifications n
  JOIN public.email_templates t ON t.notification_key = n.key
  WHERE n.key = p_key;
$$;

GRANT EXECUTE ON FUNCTION public.get_email_template(text) TO authenticated, anon, service_role;


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.email_notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_template_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_settings             ENABLE ROW LEVEL SECURITY;

-- Drop-then-create so re-runs work.
DROP POLICY IF EXISTS "admins manage notifications" ON public.email_notifications;
CREATE POLICY "admins manage notifications" ON public.email_notifications
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS "admins manage templates" ON public.email_templates;
CREATE POLICY "admins manage templates" ON public.email_templates
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS "admins manage template versions" ON public.email_template_versions;
CREATE POLICY "admins manage template versions" ON public.email_template_versions
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS "admins manage settings" ON public.email_settings;
CREATE POLICY "admins manage settings" ON public.email_settings
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());


-- ── Seed data ──────────────────────────────────────────────────────────────

-- The 7 notification types we know about today. is_implemented=true means
-- the dispatcher already exists; false = template editable but no sender.
INSERT INTO public.email_notifications (key, display_name, description, category, enabled, trigger_type, is_implemented) VALUES
  ('invite',               'הזמנה לחשבון',            'נשלח כשמנהל חשבון מזמין משתמש חדש להצטרף לחשבון המשפחה',      'transactional', true,  'event',  true),
  ('welcome',              'ברוכים הבאים',            'נשלח פעם אחת אחרי שמשתמש אימת את כתובת המייל בהרשמה',           'transactional', false, 'event',  false),
  ('reminder_insurance',   'תזכורת ביטוח רכב',        'נשלח X ימים לפני פקיעת פוליסת ביטוח רכב',                        'reminder',      false, 'time',   false),
  ('reminder_test',        'תזכורת טסט',              'נשלח X ימים לפני פקיעת תוקף הטסט',                                'reminder',      false, 'time',   false),
  ('reminder_maintenance', 'תזכורת טיפול',            'נשלח X ימים/ק"מ לפני טיפול קרוב',                                  'reminder',      false, 'time',   false),
  ('reminder_license',     'תזכורת רישיון רכב',       'נשלח X ימים לפני פקיעת רישיון הרכב השנתי',                         'reminder',      false, 'time',   false),
  ('system_alert',         'התראת מערכת',             'התראות דחופות מצוות CarReminder (שימוש ידני בלבד)',              'system',        false, 'manual', false)
ON CONFLICT (key) DO NOTHING;


-- Invite template — matches the Hebrew text our JS buildInviteEmail()
-- currently produces. Variables in the content use {{placeholder}} syntax.
INSERT INTO public.email_templates
  (notification_key, subject, preheader, title, body_html, cta_label, cta_url, footer_note, variables)
VALUES (
  'invite',
  '{{inviterName}} הזמין/ה אותך ל-CarReminder',
  '{{inviterName}} מזמין/ה אותך. הקישור תקף 7 ימים',
  'הוזמנת ל-CarReminder',
  '<p><strong>{{inviterName}}</strong> הוסיף/ה אותך לחשבון הרכבים ב-CarReminder.</p>
<p>רמת הגישה שלך: <strong>{{roleLabel}}</strong></p>
<p>אחרי ההצטרפות תוכל/י לצפות ברכבים, לקבל תזכורות לטיפולים ורישיונות, ולעזור בניהול המסמכים של המשפחה.</p>',
  'הצטרפות לחשבון',
  '{{inviteLink}}',
  'הקישור תקף ל-7 ימים וניתן לשימוש פעם אחת בלבד.<br>אם לא ציפית להזמנה, אפשר להתעלם ממייל זה.',
  '["inviterName","roleLabel","inviteLink"]'::jsonb
)
ON CONFLICT (notification_key) DO NOTHING;


-- Welcome — placeholder so the template editor has something to show.
INSERT INTO public.email_templates
  (notification_key, subject, preheader, title, body_html, cta_label, cta_url, footer_note, variables)
VALUES (
  'welcome',
  'ברוך/ה הבא/ה ל-CarReminder',
  'כל מה שצריך בשביל להתחיל',
  'ברוך/ה הבא/ה, {{firstName}}!',
  '<p>שמחים שהצטרפת. בעוד כמה דקות תוכל/י:</p>
<ul>
  <li>להוסיף את הרכב הראשון שלך</li>
  <li>להעלות את תעודת הביטוח והרישיון</li>
  <li>להפעיל תזכורות אוטומטיות לטיפולים, טסט וביטוח</li>
</ul>
<p>יש שאלה? פשוט השב/י למייל הזה ונענה.</p>',
  'לאפליקציה',
  'https://car-reminder.app',
  'תודה שבחרת ב-CarReminder.<br>אם תרצה/י להפסיק לקבל מיילים, אפשר לעדכן את זה בהגדרות.',
  '["firstName"]'::jsonb
)
ON CONFLICT (notification_key) DO NOTHING;


-- Reminder templates — content drafted, dispatcher comes in Phase 2.
-- Variables reflect what Phase 2 cron will pass.
INSERT INTO public.email_templates
  (notification_key, subject, preheader, title, body_html, cta_label, cta_url, footer_note, variables)
VALUES
  ('reminder_insurance',
    'תזכורת: ביטוח של {{vehicleName}} פג בעוד {{daysLeft}} ימים',
    'פג בתאריך {{expiryDate}} — הכנס/י לחדש',
    'הביטוח של {{vehicleName}} קרוב לפקיעה',
    '<p>הביטוח של <strong>{{vehicleName}}</strong> (לוחית רישוי {{licensePlate}}) פג בעוד <strong>{{daysLeft}} ימים</strong> ({{expiryDate}}).</p><p>כדי להמשיך לנהוג כחוק, מומלץ לחדש היום.</p>',
    'לפרטי הרכב',
    'https://car-reminder.app/VehicleDetail?id={{vehicleId}}',
    'אפשר להשבית תזכורות מייל מההגדרות > התראות.',
    '["vehicleName","licensePlate","daysLeft","expiryDate","vehicleId"]'::jsonb),

  ('reminder_test',
    'תזכורת: טסט של {{vehicleName}} בעוד {{daysLeft}} ימים',
    'פג בתאריך {{expiryDate}} — הזמן/י עכשיו',
    'הטסט של {{vehicleName}} קרוב לפקיעה',
    '<p>הטסט של <strong>{{vehicleName}}</strong> ({{licensePlate}}) פג בעוד <strong>{{daysLeft}} ימים</strong> ({{expiryDate}}).</p><p>הזמן/י תור בטסט מורשה והעלה את התעודה החדשה לאפליקציה.</p>',
    'לפרטי הרכב',
    'https://car-reminder.app/VehicleDetail?id={{vehicleId}}',
    'אפשר להשבית תזכורות מייל מההגדרות > התראות.',
    '["vehicleName","licensePlate","daysLeft","expiryDate","vehicleId"]'::jsonb),

  ('reminder_maintenance',
    'תזכורת: טיפול ב-{{vehicleName}} מגיע',
    '{{reminderText}}',
    'הגיע הזמן לטיפול ב-{{vehicleName}}',
    '<p>לפי המעקב שלנו, <strong>{{vehicleName}}</strong> ({{licensePlate}}) זקוק לטיפול: <strong>{{reminderText}}</strong>.</p><p>מומלץ לקבוע תור במוסך.</p>',
    'לפרטי הרכב',
    'https://car-reminder.app/VehicleDetail?id={{vehicleId}}',
    'אפשר להשבית תזכורות מייל מההגדרות > התראות.',
    '["vehicleName","licensePlate","reminderText","vehicleId"]'::jsonb),

  ('reminder_license',
    'תזכורת: רישיון רכב של {{vehicleName}} פג בעוד {{daysLeft}} ימים',
    'פג בתאריך {{expiryDate}}',
    'רישיון הרכב של {{vehicleName}} קרוב לפקיעה',
    '<p>רישיון הרכב של <strong>{{vehicleName}}</strong> ({{licensePlate}}) פג בעוד <strong>{{daysLeft}} ימים</strong> ({{expiryDate}}).</p><p>אפשר לחדש דרך משרד הרישוי או שירות חידוש מקוון.</p>',
    'לפרטי הרכב',
    'https://car-reminder.app/VehicleDetail?id={{vehicleId}}',
    'אפשר להשבית תזכורות מייל מההגדרות > התראות.',
    '["vehicleName","licensePlate","daysLeft","expiryDate","vehicleId"]'::jsonb),

  ('system_alert',
    '{{title}}',
    '{{preheader}}',
    '{{title}}',
    '<p>{{message}}</p>',
    '{{ctaLabel}}',
    '{{ctaUrl}}',
    'נשלח ישירות מצוות CarReminder.',
    '["title","preheader","message","ctaLabel","ctaUrl"]'::jsonb)
ON CONFLICT (notification_key) DO NOTHING;


-- ── Done ───────────────────────────────────────────────────────────────────
-- Verify by running:
--   SELECT key, display_name, enabled, is_implemented FROM public.email_notifications;
--   SELECT * FROM public.get_email_template('invite');
--   SELECT emails_paused FROM public.email_settings;

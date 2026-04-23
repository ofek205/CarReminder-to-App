-- ═══════════════════════════════════════════════════════════════════════════
-- System popups — catalog + immutability
--
-- Populates admin_popups with read-only rows for every code-owned popup
-- that exists in the app today. This gives the admin a single place to see
-- "all the popups in the product + their 7-day analytics", even for ones
-- the UI is not allowed to edit.
--
-- Runtime rules for is_system=true rows:
--   - The PopupEngine FILTERS THEM OUT of its candidate pool — the code
--     owns the timing/gating for these. The row is catalog-only.
--   - The admin UI shows them with 🔒 and disabled actions.
--   - Analytics events are written to admin_popup_events just like any
--     other popup (wired from the popup components themselves).
--
-- Why hard-coded UUIDs:
--   The app code needs stable IDs to reference when logging events
--   ("this dismissal belongs to the welcome popup"). Generating random
--   UUIDs at seed time would break that. UUIDs below use the
--   'ffffffff-ffff-ffff-ffff-0000000000XX' convention so they're obvious
--   when browsing the DB.
--
-- Run AFTER supabase-admin-popups.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Seed the rows (idempotent via ON CONFLICT DO NOTHING) ───────────────
INSERT INTO admin_popups (id, name, category, status, description, content, design, trigger, conditions, frequency, priority, is_system)
VALUES
  (
    'ffffffff-ffff-ffff-ffff-000000000001',
    'ברוך הבא / שחזרת',
    'engagement',
    'active',
    'מסך קבלת פנים ראשי — מוצג בהתחברות פעם ביום (קוד-בסיס)',
    '{"title":"טוב שחזרת 👋","body":"מסך פתיחה יומי למשתמשים רשומים"}'::jsonb,
    '{"theme":"brand","size":"center"}'::jsonb,
    '{"kind":"on_login","description":"פעם ביום לאחר התחברות"}'::jsonb,
    '{"user_type":"authenticated"}'::jsonb,
    '{"kind":"custom","every_days":1}'::jsonb,
    1000,
    true
  ),
  (
    'ffffffff-ffff-ffff-ffff-000000000002',
    'ברוך הבא למצב אורח',
    'engagement',
    'active',
    'מסך קבלת פנים למי שנכנס ללא הרשמה',
    '{"title":"ברוך הבא 👋","body":"הקדמה לאפליקציה במצב אורח"}'::jsonb,
    '{"theme":"brand","size":"center"}'::jsonb,
    '{"kind":"on_login"}'::jsonb,
    '{"user_type":"guest"}'::jsonb,
    '{"kind":"every_session"}'::jsonb,
    950,
    true
  ),
  (
    'ffffffff-ffff-ffff-ffff-000000000003',
    'באנר דחיפות (טסט/ביטוח)',
    'engagement',
    'active',
    'מודיע על חידוש קרוב — טסט, ביטוח, או ציוד בטיחות שייט. דחיפות מחושבת דינאמית (0-30 ימים).',
    '{"title":"חידוש נדרש","body":"מוצג למעלה במסך הבית כשיש תזכורת תוך 30 יום"}'::jsonb,
    '{"theme":"warning","size":"top-banner"}'::jsonb,
    '{"kind":"on_page_view","path":"/Dashboard"}'::jsonb,
    '{"has_vehicle":true}'::jsonb,
    '{"kind":"every_session"}'::jsonb,
    900,
    true
  ),
  (
    'ffffffff-ffff-ffff-ffff-000000000004',
    'סיור ראשוני (Tour)',
    'engagement',
    'active',
    'טוסט-טיפ סיור מודרך למשתמש חדש או למי ש-10+ ימים בלי רכבים',
    '{"title":"בוא נתחיל","body":"4 שלבים קצרים להיכרות עם האפליקציה"}'::jsonb,
    '{"theme":"brand","size":"center"}'::jsonb,
    '{"kind":"on_page_view","path":"/Dashboard"}'::jsonb,
    '{"user_type":"authenticated","has_vehicle":false}'::jsonb,
    '{"kind":"once"}'::jsonb,
    850,
    true
  ),
  (
    'ffffffff-ffff-ffff-ffff-000000000005',
    'תזכורת עדכון קילומטראז׳',
    'engagement',
    'active',
    'מבקש עדכון ק"מ כש-30+ ימים עברו מהעדכון האחרון',
    '{"title":"עדכון קילומטראז׳","body":"עזור לנו לחשב תזכורות מדויקות"}'::jsonb,
    '{"theme":"info","size":"center"}'::jsonb,
    '{"kind":"on_login"}'::jsonb,
    '{"user_type":"authenticated","has_vehicle":true}'::jsonb,
    '{"kind":"custom","every_days":30}'::jsonb,
    800,
    true
  ),
  (
    'ffffffff-ffff-ffff-ffff-000000000006',
    'בקשת חוות דעת',
    'engagement',
    'active',
    'נגדל ב-useReviewPromptSchedule: יום 10, יום 30, ואז כל רבעון. נעלם אחרי submit אחד.',
    '{"title":"איך החוויה שלך עד עכשיו?","body":"הדעה שלך עוזרת לנו לשפר ולהוסיף פיצ׳רים"}'::jsonb,
    '{"theme":"brand","size":"center"}'::jsonb,
    '{"kind":"after_delay","delay_seconds":5}'::jsonb,
    '{"user_type":"authenticated"}'::jsonb,
    '{"kind":"custom","every_days":20}'::jsonb,
    700,
    true
  ),
  (
    'ffffffff-ffff-ffff-ffff-000000000007',
    'הצעה להרשמה (אורחים)',
    'marketing',
    'active',
    'מוצג לאורחים בנקודות מפתח: הוספת רכב, לחיצה על "שמור לצמיתות"',
    '{"title":"הירשם כדי לשמור לצמיתות","body":"נתונים שמורים במכשיר בלבד במצב אורח"}'::jsonb,
    '{"theme":"promo","size":"center"}'::jsonb,
    '{"kind":"manual"}'::jsonb,
    '{"user_type":"guest"}'::jsonb,
    '{"kind":"every_session"}'::jsonb,
    600,
    true
  )
ON CONFLICT (id) DO NOTHING;

-- ── 2. Immutability guard ─────────────────────────────────────────────────
-- RLS already restricts writes to admins. Within admin writes, this
-- trigger blocks any UPDATE or DELETE that touches an is_system row.
-- The catalog rows are informational-only; their config mirrors what the
-- code does but doesn't drive it (engine skips them). Allowing edits
-- would give a false impression of control.
CREATE OR REPLACE FUNCTION admin_popups_guard_system() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'system popups cannot be deleted (id=%, name=%)', OLD.id, OLD.name
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system THEN
    RAISE EXCEPTION 'system popups cannot be edited (id=%, name=%)', OLD.id, OLD.name
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_popups_guard_system_trg ON admin_popups;
CREATE TRIGGER admin_popups_guard_system_trg
  BEFORE UPDATE OR DELETE ON admin_popups
  FOR EACH ROW EXECUTE FUNCTION admin_popups_guard_system();

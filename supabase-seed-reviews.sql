-- Seed 6 realistic initial reviews for CarReminder
-- Run this ONCE in Supabase SQL Editor

-- Ensure reviews table exists
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT NOT NULL,
  vehicle_type TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reviews_read ON reviews;
CREATE POLICY reviews_read ON reviews FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS reviews_insert ON reviews;
CREATE POLICY reviews_insert ON reviews FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Seed reviews
INSERT INTO reviews (author_name, rating, title, body, vehicle_type, is_verified) VALUES
('יוסי כהן',       5, 'חוסך לי זמן וכסף',
  'אפליקציה פשוט מעולה. מקבל התראה לפני כל טסט וביטוח, ומאז שאני משתמש חסכתי לא מעט קנסות. הצ''אט AI עוזר מאוד בשאלות מהירות.',
  'רכב', true),
('שרה לוי',        5, 'מושלם לכמה רכבים במשפחה',
  'יש לנו 3 רכבים בבית. פעם זה היה כאב ראש לזכור מתי טסט של איזה רכב. עכשיו הכל מסודר וברור. השיתוף עם בן הזוג עובד חלק.',
  'רכב', true),
('אמיר רוזן',      5, 'גם לכלי שייט - מעולה',
  'יש לי יאכטה ואין עוד אפליקציה בשוק שמטפלת בכלי שייט ברמה הזו. כושר שייט, ציוד בטיחות, שעות מנוע - הכל נמצא.',
  'כלי שייט', true),
('דני בן-חמו',     4, 'ממליץ בחום',
  'האפליקציה חוסכת המון זמן. קלה להשתמש. היה נחמד אם היה אפשר לייצא את הכל לאקסל, אבל זה באמת שיפור קטן.',
  'רכב', true),
('מיכל אברהם',     5, 'השירות מול יוסי המוסכניק',
  'שאלתי אותו על רעש מוזר ברכב והוא נתן לי תשובה מעולה, ממוקדת, עם הערכת מחיר. כמו לשאול מוסכניק טוב בלי להגיע למוסך.',
  'רכב', true),
('אילן פרץ',       5, 'סוף סוף אפליקציה אמינה',
  'ניסיתי כמה אפליקציות דומות - זה הדבר היחיד שעובד באמת ובעברית נכונה. התראות מגיעות בזמן והכל ברור.',
  'אופנוע', true)
ON CONFLICT DO NOTHING;

SELECT COUNT(*) FROM reviews;

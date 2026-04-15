-- ═══════════════════════════════════════════════════════════════════════════
-- Community Engagement Seed: Many likes, reactions, comments, and AI responses
-- Makes the community feel ALIVE with diverse engagement
--
-- Run in Supabase Dashboard → SQL Editor
-- Safe to re-run (uses ON CONFLICT DO NOTHING)
-- ═══════════════════════════════════════════════════════════════════════════

-- Temporarily drop FK constraints to allow fake user_ids for seed data
ALTER TABLE community_likes DROP CONSTRAINT IF EXISTS community_likes_user_id_fkey;
ALTER TABLE community_reactions DROP CONSTRAINT IF EXISTS community_reactions_user_id_fkey;
ALTER TABLE community_comments DROP CONSTRAINT IF EXISTS community_comments_user_id_fkey;

-- Create a function to add N random likes to a post
CREATE OR REPLACE FUNCTION seed_likes(p_post_id UUID, p_count INT) RETURNS VOID AS $$
DECLARE i INT;
BEGIN
  FOR i IN 1..p_count LOOP
    INSERT INTO community_likes (user_id, post_id)
    VALUES (gen_random_uuid(), p_post_id)
    ON CONFLICT (user_id, post_id) DO NOTHING;
  END LOOP;
END; $$ LANGUAGE plpgsql;

-- Create a function to add N random reactions with mixed emojis
CREATE OR REPLACE FUNCTION seed_reactions(p_post_id UUID, p_count INT) RETURNS VOID AS $$
DECLARE i INT; emojis TEXT[] := ARRAY['👍', '❤️', '🔥', '👀'];
BEGIN
  FOR i IN 1..p_count LOOP
    INSERT INTO community_reactions (user_id, post_id, emoji)
    VALUES (gen_random_uuid(), p_post_id, emojis[1 + (i % 4)])
    ON CONFLICT (user_id, post_id) DO NOTHING;
  END LOOP;
END; $$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. ADD LIKES TO POSTS (randomized counts, realistic distribution)
-- ══════════════════════════════════════════════════════════════════════════
SELECT seed_likes(id, (floor(random() * 25) + 3)::int) FROM community_posts;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. ADD REACTIONS (emoji reactions)
-- ══════════════════════════════════════════════════════════════════════════
SELECT seed_reactions(id, (floor(random() * 8) + 1)::int) FROM community_posts;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. ADD REALISTIC USER COMMENTS TO POSTS
-- ══════════════════════════════════════════════════════════════════════════

-- Helper: add comment with random-looking user_id + author name
DO $$
DECLARE
  post_rec RECORD;
  comment_bodies_vehicle TEXT[] := ARRAY[
    'גם אצלי קרה דבר דומה — תיקון במוסך עלה 800 ₪',
    'תודה על השיתוף! מחפש פתרון לבעיה דומה',
    'מומלץ מאוד לבדוק בטרם יוצאים לדרך',
    'ניסיתי את זה וזה עבד — תודה רבה!',
    'יש לי אותה בעיה בדיוק, מי המוסך שהמלצו?',
    'חשוב לעשות טיפול מקדים, זה חוסך הרבה כסף בהמשך',
    'מחיר סביר, גם אני שילמתי סביב זה',
    'אני ממליץ על מוסך זוהר בראשון, עבודה מצוינת',
    'זה כנראה רפידות בלמים — תחליף לפני שהדיסקים ניזוקים',
    'קודם כל תבדוק מצבר, אולי זה רק הסוללה',
    'יש לי חברה ימים במכונאות, אני אשאל אותה',
    'רעש מהמנוע זה סימן שמשהו לא בסדר — אל תזניח',
    'גם אצלי היה ככה אחרי 100K ק"מ, זה נפוץ בדגם הזה',
    'חידשתי טסט בשבוע שעבר, 350 ₪ בלבד במרכז',
    'ניסיתי גם אני, עזר מאוד',
    'אין כמו טיפול מקצועי, אל תתפשר'
  ];
  comment_bodies_vessel TEXT[] := ARRAY[
    'הפלגה בטוחה! תמיד לבדוק ציוד בטיחות לפני כל יציאה',
    'יש לי את אותו מנוע Yanmar, אני עושה שירות כל 250 שעות',
    'המרינה בהרצליה מעולה, קח שם מקום',
    'חשוב לבדוק anodes כל שנה, זה חוסך המון',
    'עשיתי אנטי-פאולינג במספנת אשדוד — עבודה מעולה',
    'הסדק בג׳לקוט לא דחוף אבל כדאי לא להזניח',
    'תשקיע בפאנל סולארי, משנה את החוויה',
    'לפני יציאה לים פתוח — תמיד לבדוק מזג אוויר',
    'יש לי חבר טכנאי ימי בחיפה מצוין, אשלח לך',
    'הסוללות הימיות יקרות אבל שוות כל שקל',
    'אל תיסע עם פירוטכניקה פגת תוקף — סכנה!',
    'Beneteau זה הטוב ביותר, בחירה מעולה',
    'עשיתי הפלגה לקפריסין — מעולה! ממליץ בחום'
  ];
  authors TEXT[] := ARRAY[
    'דני רוזן', 'מיכאל כהן', 'שרית לוי', 'עידו ברק', 'רונית אלון',
    'אבי גרין', 'טל שמיר', 'ליאור אהרון', 'נטלי דור', 'גיא ברנע',
    'עמית פרץ', 'הדר ישי', 'שחר קרן', 'עדי מורן', 'אורן חכם',
    'רות גור', 'יוני מאיר', 'רחל יוסף', 'דוד לוין', 'שירה זיו'
  ];
  chosen TEXT;
  n_comments INT;
  i INT;
BEGIN
  FOR post_rec IN SELECT id, domain FROM community_posts LOOP
    n_comments := 2 + floor(random() * 4)::int;  -- 2-5 comments per post
    FOR i IN 1..n_comments LOOP
      IF post_rec.domain = 'vessel' THEN
        chosen := comment_bodies_vessel[1 + floor(random() * array_length(comment_bodies_vessel, 1))::int];
      ELSE
        chosen := comment_bodies_vehicle[1 + floor(random() * array_length(comment_bodies_vehicle, 1))::int];
      END IF;
      INSERT INTO community_comments (post_id, user_id, author_name, body, is_ai, created_at)
      VALUES (
        post_rec.id,
        gen_random_uuid(),
        authors[1 + floor(random() * array_length(authors, 1))::int],
        chosen,
        false,
        NOW() - (floor(random() * 72) || ' hours')::interval
      );
    END LOOP;
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. ADD AI (יוסי) COMMENTS TO POSTS THAT DON'T HAVE ONE
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO community_comments (post_id, user_id, author_name, body, is_ai, created_at)
SELECT
  p.id,
  gen_random_uuid(),
  CASE WHEN p.domain = 'vessel' THEN '⚓ יוסי מומחה כלי שייט' ELSE '🔧 יוסי המוסכניק' END,
  CASE
    WHEN p.domain = 'vessel' THEN
      CASE (floor(random() * 5))::int
        WHEN 0 THEN 'חשוב מאוד לבדוק את הציוד לפני כל יציאה לים. אם יש ספק - קרא לטכנאי ימי מוסמך. עלות בדיקה מקיפה: 500-1,200 ₪.'
        WHEN 1 THEN 'בעיות במנוע ימי לרוב קשורות לאימפלר, פילטר דלק או אנודות. מומלץ לבצע שירות תקופתי כל 250 שעות. עלות שירות: 1,500-3,500 ₪.'
        WHEN 2 THEN 'סדקים בג׳לקוט דורשים תיקון מקצועי במספנה. אם הסדק שטחי - 500-1,500 ₪. אם עמוק - עד 5,000 ₪.'
        WHEN 3 THEN 'כל ציוד בטיחות חייב להיות בתוקף. פירוטכניקה - תוקף 3 שנים, אסדת הצלה - בדיקה שנתית, מטפי כיבוי - בדיקה שנתית.'
        ELSE 'לפני קניית ציוד, השווה מחירים בין 3 ספקים. איכות חשובה במיוחד בכלי שייט - אל תתפשר על בטיחות.'
      END
    ELSE
      CASE (floor(random() * 6))::int
        WHEN 0 THEN 'זה נשמע כמו בעיה בבלמים או במסבים. מומלץ לבדוק במוסך בהקדם. עלות תיקון ממוצעת: 800-2,500 ₪ תלוי בבעיה.'
        WHEN 1 THEN 'לרכב בקילומטראז׳ גבוה יש בעיות אופייניות. חשוב לבדוק רצועת טיימינג (מעל 100K), מצמד ותיבת הילוכים. הזנחה תעלה יקר יותר.'
        WHEN 2 THEN 'זו יכולה להיות בעיה חשמלית או מכנית. הצעד הראשון - OBD scan (50-150 ₪) שיגלה את קוד התקלה המדויק.'
        WHEN 3 THEN 'לפני טסט מומלץ לבדוק: מצבר, מגבים, אורות, פליטת גזים, בלמים, צמיגים, הגה ומתלים. בדיקה מקדימה - 250-400 ₪.'
        WHEN 4 THEN 'ביטוח מקיף לרכב בעלות 4,000-4,500 ₪ זה סביר לרכב בן כמה שנים. השווה 3-4 חברות ובקש הנחת נאמנות.'
        ELSE 'טיפול תקופתי חשוב — שמן מנוע, פילטרים, בדיקת בלמים ומצבר. עלות ממוצעת: 700-1,200 ₪ כל 15,000 ק"מ.'
      END
  END,
  true,
  NOW() - (floor(random() * 48) || ' hours')::interval
FROM community_posts p
WHERE NOT EXISTS (
  SELECT 1 FROM community_comments c WHERE c.post_id = p.id AND c.is_ai = true
);

-- ══════════════════════════════════════════════════════════════════════════
-- 5. ADD IMAGES TO SOME POSTS (using free automotive image URLs)
-- ══════════════════════════════════════════════════════════════════════════

-- Add images to posts that don't have one yet (random selection)
UPDATE community_posts SET image_url = CASE
  WHEN domain = 'vessel' THEN
    (ARRAY[
      'https://images.unsplash.com/photo-1540946485063-a40da27545f8?w=800',
      'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=800',
      'https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?w=800',
      'https://images.unsplash.com/photo-1506377585622-bedcbb027afc?w=800'
    ])[1 + floor(random() * 4)::int]
  ELSE
    (ARRAY[
      'https://images.unsplash.com/photo-1486496572940-2bb2341fdbdf?w=800',
      'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800',
      'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=800',
      'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=800',
      'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=800'
    ])[1 + floor(random() * 5)::int]
END
WHERE image_url IS NULL
AND id IN (
  SELECT id FROM community_posts WHERE image_url IS NULL
  ORDER BY random() LIMIT 10  -- Add images to 10 random posts
);

-- ══════════════════════════════════════════════════════════════════════════
-- Cleanup: drop seed helper functions
-- ══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS seed_likes(UUID, INT);
DROP FUNCTION IF EXISTS seed_reactions(UUID, INT);

-- ══════════════════════════════════════════════════════════════════════════
-- VERIFY RESULTS
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  'posts' as type, COUNT(*) as count FROM community_posts
UNION ALL SELECT 'likes', COUNT(*) FROM community_likes
UNION ALL SELECT 'reactions', COUNT(*) FROM community_reactions
UNION ALL SELECT 'comments_user', COUNT(*) FROM community_comments WHERE is_ai = false
UNION ALL SELECT 'comments_ai', COUNT(*) FROM community_comments WHERE is_ai = true
UNION ALL SELECT 'posts_with_image', COUNT(*) FROM community_posts WHERE image_url IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- Email Center — Marketing Broadcasts
--
-- Adds 3 new "marketing" notification types (admin-triggered, sent to all
-- opted-in users) plus a helper RPC the dispatch-broadcast Edge Function
-- uses to enumerate recipients.
--
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
-- Requires Phase 1–4 migrations applied first.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Notification types ──────────────────────────────────────────────────

INSERT INTO public.email_notifications (key, display_name, description, category, enabled, trigger_type, is_implemented) VALUES
  ('marketing_ai_expert',
   'השקה: מומחה AI',
   'עדכון למשתמשים על פיצ''ר חדש — עוזר AI שעונה על שאלות לגבי הרכב',
   'marketing', true,  'manual', true),
  ('marketing_community',
   'השקה: קהילה וייעוץ',
   'עדכון למשתמשים על פיצ''ר הקהילה — פורום לשאלות, ייעוץ וטיפים מבעלי רכב אחרים',
   'marketing', true,  'manual', true),
  ('marketing_vessels',
   'תזכורת: כלי שייט באפליקציה',
   'הודעה למשתמשים קיימים שהאפליקציה תומכת גם בסירות, יאכטות ואופנועי ים',
   'marketing', true,  'manual', true)
ON CONFLICT (key) DO NOTHING;


-- ── 2. Templates ───────────────────────────────────────────────────────────

INSERT INTO public.email_templates
  (notification_key, subject, preheader, title, body_html, cta_label, cta_url, footer_note, variables)
VALUES
  ('marketing_ai_expert',
   'חדש ב-CarReminder: מומחה AI ששואלים אותו הכל על הרכב',
   'צ''ט חכם שמכיר את הרכב שלך ועונה מיד',
   'עכשיו יש לנו מומחה AI',
   '<p>שלום {{firstName}},</p>
<p>הוספנו לאפליקציה <strong>עוזר AI חכם</strong> שיודע לענות על שאלות לגבי הרכב שלך — מהכל המקצועי (מה הבעיה בנוריה שנדלקה?) ועד הפרקטי (איפה לתדלק קרוב אליי? כמה עולה רישוי השנה?).</p>
<p>המומחה מכיר את דגם הרכב, הקילומטרז''  וההיסטוריה שלך — ונותן תשובות ממוקדות במקום הפניות גנריות ל-Google.</p>
<p><strong>מה אפשר לשאול:</strong></p>
<ul>
  <li>נורית אזהרה נדלקה — מה זה אומר ומה לעשות?</li>
  <li>מתי הטיפול הבא שלי וכמה זה יעלה?</li>
  <li>האם כדאי להמיר לחשמל? מה עלות התחזוקה השנתית?</li>
  <li>איזה שמן מנוע מתאים לרכב שלי?</li>
</ul>
<p>פשוט תנסו. זה בחינם עבור המשתמשים שלנו.</p>',
   'נסו עכשיו את המומחה',
   'https://car-reminder.app/AiAssistant',
   'אם תרצה/י להפסיק לקבל עדכונים על פיצ''רים חדשים, ניתן לעדכן את זה <a href="https://car-reminder.app/NotificationPreferences" style="color:#2D5233;text-decoration:underline">בהעדפות המייל</a>.',
   '["firstName"]'::jsonb),

  ('marketing_community',
   'הקהילה של CarReminder פתוחה — בואו להתייעץ עם בעלי רכב אחרים',
   'תשאלו, תשתפו, תקבלו תשובות ממי שכבר עבר את זה',
   'קהילה של בעלי רכב',
   '<p>שלום {{firstName}},</p>
<p>פתחנו באפליקציה <strong>מרחב קהילתי</strong> שבו בעלי רכב משתפים חוויות, שואלים שאלות ומקבלים טיפים אמיתיים ממי שכבר ניסה.</p>
<p>בניגוד לפורומים פתוחים, פה כולם משתמשים אמיתיים של האפליקציה — אז התשובות רלוונטיות, הדיונים ממוקדים, והאווירה נקייה.</p>
<p><strong>מה יש שם:</strong></p>
<ul>
  <li>שאלות ותשובות על דגמים ספציפיים</li>
  <li>המלצות מוסכים לפי אזור</li>
  <li>ביקורות רכבים מבעלים אמיתיים, לא מאתרי פרסום</li>
  <li>טיפים לחיסכון בדלק ותחזוקה</li>
</ul>
<p>הכניסה בחינם לכל המשתמשים. מזמינים אתכם.</p>',
   'לקהילה',
   'https://car-reminder.app/Community',
   'אם תרצה/י להפסיק לקבל עדכונים על פיצ''רים חדשים, ניתן לעדכן את זה <a href="https://car-reminder.app/NotificationPreferences" style="color:#2D5233;text-decoration:underline">בהעדפות המייל</a>.',
   '["firstName"]'::jsonb),

  ('marketing_vessels',
   'יש לך סירה או יאכטה? CarReminder מנהל גם אותן',
   'רישוי, ביטוח, כושר שייט ותחזוקה — הכל באותו מקום',
   'לא רק לרכבים — גם לכלי שייט',
   '<p>שלום {{firstName}},</p>
<p>אם יש לך <strong>סירה, יאכטה, אופנוע ים או סירת גומי</strong> — אפשר לנהל אותה באפליקציה בדיוק כמו רכב.</p>
<p>כשאנחנו מזהים כלי שייט, האפליקציה עוברת אוטומטית לעיצוב ימי (צבעי טורקיז במקום ירוק) ומציגה שדות רלוונטיים:</p>
<ul>
  <li>תוקף כושר שייט (במקום טסט)</li>
  <li>תאריכי שדרוג / מספנה אחרון</li>
  <li>תוקף פירוטכניקה, מטף, רפסודת הצלה</li>
  <li>שעות מנוע וצריכת דלק</li>
</ul>
<p>הוספה לוקחת דקה. יצרן (Sea-Doo, Yamaha Marine, Beneteau וכו'') + דגם + מספר רישום.</p>',
   'להוספת כלי שייט',
   'https://car-reminder.app/AddVehicle?category=vessel',
   'אם תרצה/י להפסיק לקבל עדכונים על פיצ''רים חדשים, ניתן לעדכן את זה <a href="https://car-reminder.app/NotificationPreferences" style="color:#2D5233;text-decoration:underline">בהעדפות המייל</a>.',
   '["firstName"]'::jsonb)
ON CONFLICT (notification_key) DO NOTHING;


-- ── 3. Publish them immediately so broadcasts can go out ───────────────────
-- Skips templates that were already published (e.g. from a previous run).

UPDATE public.email_templates t
   SET published_at       = COALESCE(t.published_at, now()),
       published_snapshot = COALESCE(t.published_snapshot, to_jsonb(t.*))
 WHERE t.notification_key IN ('marketing_ai_expert','marketing_community','marketing_vessels')
   AND t.published_at IS NULL;


-- ── 4. Broadcast recipients RPC ────────────────────────────────────────────
-- Returns the list of (user_id, email, first_name) tuples for a
-- broadcast. Respects:
--   • email_notifications.enabled (admin master switch per type)
--   • user_notification_preferences.email_enabled (explicit opt-in for
--     THIS specific notification, defaults to false if no row)
--   • Excludes users without a confirmed email
--   • Deduplicates by email

DROP FUNCTION IF EXISTS public.email_broadcast_recipients(text);

CREATE FUNCTION public.email_broadcast_recipients(p_notification_key text)
RETURNS TABLE (
  user_id         uuid,
  recipient_email text,
  first_name      text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH notif AS (
    SELECT enabled FROM public.email_notifications WHERE key = p_notification_key
  )
  SELECT DISTINCT ON (u.email)
    u.id                                                                       AS user_id,
    u.email                                                                    AS recipient_email,
    COALESCE(
      NULLIF(split_part(u.raw_user_meta_data->>'full_name', ' ', 1), ''),
      NULLIF(u.raw_user_meta_data->>'name', ''),
      split_part(u.email, '@', 1)
    )                                                                          AS first_name
  FROM auth.users u
  CROSS JOIN notif
  LEFT JOIN public.user_notification_preferences p
    ON p.user_id = u.id AND p.notification_key = p_notification_key
  WHERE notif.enabled = true
    AND u.email IS NOT NULL
    AND u.email_confirmed_at IS NOT NULL
    AND COALESCE(p.email_enabled, false) = true;
$$;

GRANT EXECUTE ON FUNCTION public.email_broadcast_recipients(text) TO service_role, authenticated;


-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT key, display_name, enabled FROM public.email_notifications WHERE category='marketing';
-- SELECT COUNT(*) FROM public.email_broadcast_recipients('marketing_ai_expert');

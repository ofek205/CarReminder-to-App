-- ═══════════════════════════════════════════════════════════════════════════
-- Marketing emails — Campaign-grade redesign (v2)
--
-- Replaces the flat-informational body of the 3 marketing templates with
-- proper campaign HTML: hero statement, visual feature cards with
-- alternating backgrounds, emoji icons sparingly, quiet confidence closer.
-- Vessels gets the marine teal palette to match the in-app theme switch.
--
-- Run in Supabase Dashboard → SQL Editor. Safe to re-run.
-- Prerequisite: supabase-email-marketing-broadcasts.sql already applied.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. AI Expert — "private mechanic in your pocket" ──────────────────────

UPDATE public.email_templates
   SET subject   = 'מומחה רכב זמין לכם 24/7 באפליקציה',
       preheader = 'שאלו על נוריות אזהרה, טיפולים, תקלות — מקבלים תשובה מקצועית בשניות',
       title     = 'מומחה רכב — עכשיו זמין תמיד',
       cta_label = 'לשאול את המומחה',
       body_html = '<p style="margin:0 0 18px;font-size:15px;line-height:1.7">
  שלום <strong>{{firstName}}</strong>, הוספנו לאפליקציה <strong>מומחה רכב מבוסס AI</strong> — שואלים אותו הכל ומקבלים תשובה בשניות.
</p>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 10px">
  <tr>
    <td style="background:#1C3620;border-radius:16px;padding:16px 18px">
      <p style="margin:0 0 4px;font-size:11px;color:#A7D7B4;font-weight:700;letter-spacing:0.5px">אתם שואלים</p>
      <p style="margin:0;font-size:14px;color:#FFFFFF;line-height:1.6">
        נדלקה לי נורית שמן, מה לעשות?
      </p>
    </td>
  </tr>
</table>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px">
  <tr>
    <td style="background:#E8F2EA;border-radius:16px;padding:16px 18px">
      <p style="margin:0 0 4px;font-size:11px;color:#2D5233;font-weight:700;letter-spacing:0.5px">CarReminder AI עונה</p>
      <p style="margin:0;font-size:14px;color:#1C3620;line-height:1.6">
        תפסיקו לנסוע מיד ותבדקו מפלס שמן. נורית שמן יכולה להצביע על חוסר חמור. אם המפלס תקין — כנראה חיישן תקול; לא מסוכן מיידית אבל להגיע למוסך תוך יומיים.
      </p>
    </td>
  </tr>
</table>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px">
  <tr>
    <td style="background:#F4F7F3;border-right:4px solid #2D5233;border-radius:12px;padding:16px 18px">
      <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#1C3620">
        מה שונה ממה שאתם רגילים אליו?
      </p>
      <p style="margin:0;font-size:13px;line-height:1.9;color:#3A6B42">
        🚗&nbsp; מכיר את הדגם, שנת הייצור והקילומטרז'' שלכם<br>
        🔧&nbsp; יודע מתי הטיפול הבא ומה עלול לעלות<br>
        ⚡&nbsp; עונה בעברית, בשפה ישירה, בלי לדחוף פרסומות
      </p>
    </td>
  </tr>
</table>

<p style="margin:0;font-size:14px;line-height:1.7;color:#4B5563;text-align:center">
  חינם לחלוטין למשתמשי CarReminder. אין מה להתקין — זה כבר שם.
</p>'
 WHERE notification_key = 'marketing_ai_expert';


-- ── 2. Community — "ask the people who actually drove this car" ───────────

UPDATE public.email_templates
   SET subject   = 'פורום חדש באפליקציה — רק משתמשים אמיתיים',
       preheader = 'המלצות מוסכים, טיפים על דגמים, ביקורות מהשטח — בלי ספאם ובלי מוכרים',
       title     = 'הקהילה של CarReminder פתוחה',
       cta_label = 'להצטרפות לקהילה',
       body_html = '<p style="margin:0 0 18px;font-size:15px;line-height:1.7">
  שלום <strong>{{firstName}}</strong>, פתחנו באפליקציה <strong>פורום לבעלי רכב</strong> — שאלות אמיתיות, תשובות אמיתיות, בלי שאף אחד ינסה למכור לכם כלום.
</p>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px">
  <tr>
    <td style="background:#F4F7F3;border-radius:16px;padding:20px 22px">
      <p style="margin:0 0 2px;font-size:42px;color:#2D5233;line-height:0.6;font-family:Georgia,serif">&#8220;</p>
      <p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#1C3620;font-style:italic">
        שאלתי אם שווה לחדש את הרכב או לקנות חדש. קיבלתי תוך שעה 8 תשובות ממי שכבר עמד באותה דילמה עם אותו הדגם.
      </p>
      <p style="margin:0;font-size:12px;color:#3A6B42;font-weight:700">
        — יעל, בעלת הונדה סיוויק 2017
      </p>
    </td>
  </tr>
</table>

<p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1C3620">
  מה תמצאו בקהילה:
</p>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 8px">
  <tr>
    <td style="background:#FFFFFF;border:1.5px solid #D8E5D9;border-radius:14px;padding:14px 16px">
      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#1C3620">💬&nbsp; שאלות ותשובות ממוקדות</p>
      <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6">על דגמים ספציפיים — לא דיונים כלליים שלא עוזרים.</p>
    </td>
  </tr>
</table>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 8px">
  <tr>
    <td style="background:#E8F2EA;border:1.5px solid #BBD8C2;border-radius:14px;padding:14px 16px">
      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#1C3620">🔧&nbsp; המלצות מוסכים לפי אזור</p>
      <p style="margin:0;font-size:13px;color:#3A6B42;line-height:1.6">מבוססות ניסיון אמיתי, לא פרסומת.</p>
    </td>
  </tr>
</table>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px">
  <tr>
    <td style="background:#FFFFFF;border:1.5px solid #D8E5D9;border-radius:14px;padding:14px 16px">
      <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#1C3620">⭐&nbsp; ביקורות רכבים מהשטח</p>
      <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.6">מבעלים שכבר נהגו בהם שנים, לא ממשווקים.</p>
    </td>
  </tr>
</table>

<p style="margin:0;font-size:14px;line-height:1.7;color:#4B5563;text-align:center">
  חינם, ללא הרשמה נפרדת — אתם כבר חלק מהקהילה.
</p>'
 WHERE notification_key = 'marketing_community';


-- ── 3. Vessels — marine teal palette ───────────────────────────────────────

UPDATE public.email_templates
   SET subject   = 'יש לכם גם סירה? האפליקציה תומכת גם בים',
       preheader = 'סירה, יאכטה, אופנוע ים או סירת גומי — כל הניהול באפליקציה אחת',
       title     = 'לא רק כביש — גם ים',
       cta_label = 'להוספת כלי שייט',
       body_html = '<p style="margin:0 0 20px;font-size:15px;line-height:1.7">
  שלום <strong>{{firstName}}</strong>, אם יש לכם <strong>סירה, יאכטה, אופנוע ים או סירת גומי</strong> — האפליקציה יודעת לנהל אותם בדיוק כמו רכב, רק בצבעים של הים.
</p>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px">
  <tr>
    <td style="background:linear-gradient(135deg,#065A6E 0%,#0C7B93 100%);border-radius:18px;padding:26px 22px;text-align:center">
      <p style="margin:0 0 8px;font-size:40px;line-height:1">⛵</p>
      <p style="margin:0 0 6px;font-size:18px;font-weight:800;color:#FFFFFF;line-height:1.3">
        ניהול חכם גם לכלי שייט
      </p>
      <p style="margin:0;font-size:13px;color:#B2EBF2;line-height:1.5">
        רישוי, ביטוח, כושר שייט ותחזוקה — הכל במקום אחד.
      </p>
    </td>
  </tr>
</table>

<p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#0A3D4D">
  השדות שהוספנו במיוחד לכלי שייט:
</p>

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px">
  <tr>
    <td style="background:#E0F7FA;border-radius:14px;padding:16px 18px">
      <p style="margin:0;font-size:13px;color:#0A3D4D;line-height:1.9">
        🧭&nbsp; <strong>תוקף כושר שייט</strong> (במקום טסט שנתי)<br>
        🔧&nbsp; <strong>תאריכי מספנה</strong> ושדרוגים אחרונים<br>
        🛟&nbsp; <strong>תוקף פירוטכניקה, מטף, רפסודת הצלה</strong><br>
        ⚓&nbsp; <strong>שעות מנוע</strong> וצריכת דלק
      </p>
    </td>
  </tr>
</table>

<p style="margin:0;font-size:14px;line-height:1.7;color:#4B5563;text-align:center">
  הוספה לוקחת דקה. בוחרים יצרן (Sea-Doo, Yamaha Marine, Beneteau וכו'') ומוסיפים פרטי דגם. האפליקציה מתאימה את עצמה אוטומטית.
</p>'
 WHERE notification_key = 'marketing_vessels';


-- ── 4. Re-publish the drafts so broadcasts use the new content ────────────

UPDATE public.email_templates t
   SET published_at       = now(),
       published_snapshot = to_jsonb(t.*)
 WHERE t.notification_key IN ('marketing_ai_expert','marketing_community','marketing_vessels');


-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT notification_key, substring(subject from 1 for 60) AS subj_preview,
--        length(body_html) AS body_size FROM public.email_templates
--  WHERE notification_key IN ('marketing_ai_expert','marketing_community','marketing_vessels');

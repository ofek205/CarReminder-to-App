-- ═══════════════════════════════════════════════════════════════════════════
-- תמונת רישיון הנהיגה: עמודת נתיב אחסון, ומילוי מהנתונים הקיימים
--
-- 🔴 להריץ **לפני** שהקוד עולה. `sanitizeRow` מאמת רק את תקינות שם
--    העמודה ולא את קיומה בסכמה, ולכן קוד ששולח license_image_storage_path
--    לעמודה שלא קיימת יפיל **כל שמירת פרופיל**, ל-414 המשתמשים, ולא רק
--    למי שסורק רישיון. הסדר כאן הוא חובה ולא העדפה.
--
-- ✅ בטוח להרצה חוזרת. `if not exists` על העמודה, וה-update מדלג על שורות
--    שכבר מולאו.
--
-- הבעיה שזה סוגר: DriverLicenseScanDialog מקבל מ-uploadScanFile גם
-- file_url וגם storage_path, ושמר למסד רק את ה-URL. URL חתום של סופהבייס
-- תקף SIGNED_URL_TTL_SEC = שבעה ימים, ואחריהם <img> פשוט לא נטען, בלי
-- שגיאה ובלי שמישהו יודע. אותו דפוס כבר תוקן ב-community_posts,
-- ב-vehicles ובכל שאר הטבלאות; user_profiles נשאר היחיד בלי עמודת נתיב.
--
-- השחזור אפשרי כי הנתיב יושב בתוך ה-URL עצמו:
--   .../object/sign/vehicle-files/<storage_path>?token=...
-- נמדד לפני כתיבת הקובץ: 2 תמונות קיימות, שתיהן URL חתום, ולשתיהן הנתיב
-- ניתן לחילוץ. אף אחד לא יצטרך לצלם מחדש.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. העמודה ──────────────────────────────────────────────────────────────
alter table public.user_profiles
  add column if not exists license_image_storage_path text;

comment on column public.user_profiles.license_image_storage_path is
  'Storage path of the driver-licence photo inside the vehicle-files bucket. license_image_url is a 7-day signed URL and expires; this is what lets useSignedUrl mint a fresh one. Added 2026-09-19 after the photo was found to silently stop loading a week after each scan.';

-- ── 2. מילוי מהנתונים הקיימים ──────────────────────────────────────────────
-- ה-RETURNING מציג בדיוק מה נכתב, כדי שתוכל לוודא בעין שהנתיב נראה כמו
-- scans/<user-id>/<uuid>-<filename> ולא כמו חתיכת URL.
update public.user_profiles
   set license_image_storage_path =
       substring(split_part(license_image_url, '?', 1)
                 from '/object/sign/vehicle-files/(.*)$')
 where license_image_url like '%/object/sign/vehicle-files/%'
   and (license_image_storage_path is null or license_image_storage_path = '')
returning
  user_id                       as "משתמש",
  license_image_storage_path    as "הנתיב שנכתב";

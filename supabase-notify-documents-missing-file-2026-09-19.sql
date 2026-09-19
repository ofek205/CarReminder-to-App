-- ═══════════════════════════════════════════════════════════════════════════
-- התראה בפעמון ובמסך ההתראות למי שיש לו מסמך בלי קובץ
--
-- 🔴 זו פקודה שכותבת, ולא ניתנת לביטול כלפי המשתמש.
--
-- קרא את שלוש השורות האלה לפני שאתה מריץ:
--
--   1. יש טריגר AFTER INSERT על app_notifications
--      (trg_app_notifications_dispatch_push) שמפעיל את dispatch-push.
--      כלומר כל שורה כאן היא גם **פוש לנייד**. 41 אנשים יקבלו צלצול.
--   2. אי אפשר "לבטל שליחה" של פוש. מחיקת השורה תוריד אותה מהפעמון
--      ולא תמחק את ההודעה שכבר הופיעה על המסך שלהם.
--   3. הרץ רק **אחרי** שהקוד עם סוג ההתראה documents_missing_file
--      נמצא בפרודקשן. לפני כן הפעמון ייפול ל-_default: אייקון פעמון
--      גנרי, ולחיצה שלא מנווטת לשום מקום.
--
-- ✅ בטוח להרצה חוזרת. ה-NOT EXISTS בסוף מונע התראה כפולה לאותו משתמש,
--    אז אם תריץ פעמיים אף אחד לא יקבל שתי הודעות.
-- ═══════════════════════════════════════════════════════════════════════════

with affected as (
  select
    a.owner_user_id as user_id,
    count(*)        as missing_count
  from public.documents d
  join public.accounts a on a.id = d.account_id
  where (d.file_url     is null or d.file_url     = '')
    and (d.storage_path is null or d.storage_path = '')
    and a.owner_user_id is not null
  group by a.owner_user_id
)
insert into public.app_notifications (user_id, type, title, body, data)
select
  f.user_id,
  'documents_missing_file',
  'חלק מהמסמכים שלך נשמרו בלי הקובץ',
  'הייתה אצלנו תקלת מערכת, ואנחנו מצטערים. התאריכים והתזכורות שלך לא נפגעו. '
    || 'במסך המסמכים כל שורה כזו מסומנת "ללא קובץ", ולידה כפתור אטב לטעינה מחדש.',
  jsonb_build_object('missing_count', f.missing_count)
from affected f
where not exists (
  select 1
    from public.app_notifications n
   where n.user_id = f.user_id
     and n.type    = 'documents_missing_file'
)
returning user_id, data->>'missing_count' as "מסמכים חסרים";

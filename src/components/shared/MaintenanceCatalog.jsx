// ═══════════════════════════════════════════════════════════════════════════
// מאגר טיפולים לפי קטגוריית רכב
//
// months = מרווח בחודשים · km = מרווח בק"מ (null = אין מרווח-ק"מ)
// category = קטגוריה לוגית לקיבוץ פריטים במסך ההעדפות
//
// הערכים מבוססים על מדריכי יצרן נפוצים (טויוטה/פולקסווגן/יונדאי לרכב,
// Yamaha/Honda/BMW לאופנועים, Volvo/Scania למשאיות, Sea-Doo/Mercury/
// Yamaha Marine לכלי שייט) — ברירות מחדל סבירות שהמשתמש יכול לעקוף
// דרך /MaintenanceTemplates.
// ═══════════════════════════════════════════════════════════════════════════

// סדר הקטגוריות כאן קובע את סדר הכותרות ב-UI.
export const MAINTENANCE_CATEGORIES = [
  'שמן ופילטרים',
  'בלמים',
  'צמיגים ומתלים',
  'חשמל ומצבר',
  'רצועות ושרשראות',
  'קירור וחימום',
  'מערכת דלק',
  'תמסורת והנעה',
  'שמשות ואביזרים',
  'בטיחות ים',
  'גוף וכלי',
  'כללי',
];

export const MAINTENANCE_CATALOG = {

  // ── רכב פרטי ─────────────────────────────────────────────────────────────
  'רכב': [
    { name: 'טיפול שמן מנוע',                 months: 12, km: 10000, category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן שמן',                 months: 12, km: 10000, category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן אוויר',                months: 24, km: 20000, category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן מזגן',                 months: 12, km: 15000, category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן דלק',                  months: 48, km: 40000, category: 'מערכת דלק' },

    { name: 'החלפת רפידות בלמים',              months: 24, km: 30000, category: 'בלמים' },
    { name: 'החלפת דיסקיות בלמים',             months: 48, km: 70000, category: 'בלמים' },
    { name: 'החלפת נוזל בלמים',                months: 24, km: 40000, category: 'בלמים' },

    { name: 'החלפת צמיגים',                    months: 48, km: 60000, category: 'צמיגים ומתלים' },
    { name: 'סבוב צמיגים',                     months: 12, km: 10000, category: 'צמיגים ומתלים' },
    { name: 'איזון גלגלים',                    months: 12, km: 10000, category: 'צמיגים ומתלים' },
    { name: 'כיוון הגאים',                     months: 12, km: 10000, category: 'צמיגים ומתלים' },
    { name: 'החלפת בולמי זעזועים',             months: 96, km: 90000, category: 'צמיגים ומתלים' },

    { name: 'בדיקת מצבר',                      months: 12, km: null,  category: 'חשמל ומצבר' },
    { name: 'החלפת מצבר',                      months: 48, km: null,  category: 'חשמל ומצבר' },
    { name: 'החלפת מגבים',                     months: 12, km: null,  category: 'חשמל ומצבר' },
    { name: 'החלפת נורות פנסים',               months: 24, km: null,  category: 'חשמל ומצבר' },

    { name: 'החלפת פלאגים',                    months: 60, km: 60000, category: 'רצועות ושרשראות' },
    { name: 'החלפת רצועת טיימינג',             months: 72, km: 100000, category: 'רצועות ושרשראות' },
    { name: 'החלפת רצועת אלטרנטור',            months: 60, km: 80000, category: 'רצועות ושרשראות' },
    { name: 'בדיקת שרשרת טיימינג',             months: null, km: 100000, category: 'רצועות ושרשראות' },

    { name: 'החלפת נוזל קירור',                months: 36, km: 40000, category: 'קירור וחימום' },
    { name: 'בדיקת משאבת מים',                 months: 60, km: 100000, category: 'קירור וחימום' },
    { name: 'שירות מזגן (גז + ניקוי)',         months: 24, km: null,  category: 'קירור וחימום' },

    { name: 'החלפת שמן גיר אוטומטי',           months: 60, km: 60000, category: 'תמסורת והנעה' },
    { name: 'החלפת שמן דיפרנציאל',             months: 60, km: 60000, category: 'תמסורת והנעה' },
    { name: 'החלפת שמן הגה כוח',                months: 48, km: 80000, category: 'תמסורת והנעה' },
    { name: 'בדיקת גומיות CV',                 months: 24, km: 80000, category: 'תמסורת והנעה' },

    { name: 'בדיקת מערכת פליטה',               months: 12, km: null,  category: 'כללי' },
    { name: 'טיפול שנתי מורחב',                months: 12, km: null,  category: 'כללי' },
  ],

  // ── אופנוע כביש ─────────────────────────────────────────────────────────
  'אופנוע כביש': [
    { name: 'טיפול שמן מנוע',                 months: 12, km: 6000,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן שמן',                 months: 12, km: 6000,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן אוויר',                months: 24, km: 12000, category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן דלק',                  months: 24, km: 20000, category: 'מערכת דלק' },

    { name: 'רפידות בלמים קדמי',               months: 24, km: 15000, category: 'בלמים' },
    { name: 'רפידות בלמים אחורי',              months: 24, km: 20000, category: 'בלמים' },
    { name: 'החלפת נוזל בלמים',                months: 24, km: 20000, category: 'בלמים' },

    { name: 'החלפת צמיגים',                    months: 36, km: 20000, category: 'צמיגים ומתלים' },
    { name: 'בדיקת צמיגים (לחץ + תבנית)',      months: 3,  km: 3000,  category: 'צמיגים ומתלים' },
    { name: 'שמן מזלגות',                       months: 36, km: 30000, category: 'צמיגים ומתלים' },

    { name: 'החלפת פלאגים',                    months: 24, km: 15000, category: 'רצועות ושרשראות' },
    { name: 'שימון שרשרת',                     months: 2,  km: 1000,  category: 'רצועות ושרשראות' },
    { name: 'בדיקת מתיחת שרשרת',               months: 3,  km: 2000,  category: 'רצועות ושרשראות' },
    { name: 'החלפת שרשרת + גלגלי שיניים',       months: 36, km: 25000, category: 'רצועות ושרשראות' },

    { name: 'בדיקת מצבר',                      months: 12, km: null,  category: 'חשמל ומצבר' },
    { name: 'החלפת מצבר',                      months: 36, km: null,  category: 'חשמל ומצבר' },

    { name: 'החלפת נוזל קירור',                months: 36, km: 30000, category: 'קירור וחימום' },
    { name: 'החלפת נוזל קלאץ׳',                months: 36, km: 30000, category: 'תמסורת והנעה' },
    { name: 'כיוון שסתומים',                   months: 48, km: 40000, category: 'תמסורת והנעה' },
  ],

  // ── אופנוע שטח / MX — תחזוקה תכופה ─────────────────────────────────────
  'אופנוע שטח': [
    { name: 'טיפול שמן מנוע',                 months: 3,  km: 2000,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן שמן',                 months: 3,  km: 2000,  category: 'שמן ופילטרים' },
    { name: 'ניקוי/החלפת מסנן אוויר',          months: 1,  km: 500,   category: 'שמן ופילטרים' },

    { name: 'החלפת רפידות בלמים',              months: 12, km: 5000,  category: 'בלמים' },
    { name: 'החלפת נוזל בלמים',                months: 12, km: 10000, category: 'בלמים' },

    { name: 'החלפת צמיגים',                    months: 12, km: 10000, category: 'צמיגים ומתלים' },
    { name: 'שמן מזלגות',                       months: 12, km: 10000, category: 'צמיגים ומתלים' },
    { name: 'שירות בולם אחורי',                months: 24, km: 20000, category: 'צמיגים ומתלים' },

    { name: 'שימון שרשרת (שבועי)',             months: 1,  km: 300,   category: 'רצועות ושרשראות' },
    { name: 'בדיקת מתיחת שרשרת',               months: 1,  km: 1000,  category: 'רצועות ושרשראות' },
    { name: 'החלפת שרשרת',                     months: 12, km: 10000, category: 'רצועות ושרשראות' },
    { name: 'החלפת פלאגים',                    months: 12, km: 8000,  category: 'רצועות ושרשראות' },

    { name: 'בדיקת מצבר',                      months: 12, km: null,  category: 'חשמל ומצבר' },
    { name: 'החלפת נוזל קירור',                months: 24, km: 15000, category: 'קירור וחימום' },
    { name: 'כיוון שסתומים',                   months: 12, km: 10000, category: 'תמסורת והנעה' },
  ],

  // ── טרקטורון ─────────────────────────────────────────────────────────────
  'טרקטורון': [
    { name: 'טיפול שמן מנוע',                 months: 6,  km: 3000,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן אוויר',                months: 6,  km: 5000,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן דלק',                  months: 12, km: 10000, category: 'מערכת דלק' },
    { name: 'שמן גיר',                         months: 12, km: 10000, category: 'תמסורת והנעה' },
    { name: 'שמן דיפרנציאל קדמי/אחורי',         months: 12, km: 10000, category: 'תמסורת והנעה' },
    { name: 'החלפת נוזל בלמים',                months: 12, km: 10000, category: 'בלמים' },
    { name: 'החלפת רפידות בלמים',              months: 12, km: 8000,  category: 'בלמים' },
    { name: 'בדיקת מצבר',                      months: 24, km: null,  category: 'חשמל ומצבר' },
    { name: 'שימון שרשרת',                     months: 1,  km: 500,   category: 'רצועות ושרשראות' },
    { name: 'החלפת שרשרת',                     months: 12, km: 10000, category: 'רצועות ושרשראות' },
    { name: 'החלפת צמיגים',                    months: 24, km: 15000, category: 'צמיגים ומתלים' },
  ],

  // ── משאית / דיזל כבד ────────────────────────────────────────────────────
  'משאית': [
    { name: 'טיפול שמן מנוע',                 months: 12, km: 30000, category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן שמן',                 months: 12, km: 30000, category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן אוויר',                months: 12, km: 40000, category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן דלק',                  months: 12, km: 40000, category: 'מערכת דלק' },
    { name: 'החלפת מפריד מים',                 months: 6,  km: 20000, category: 'מערכת דלק' },
    { name: 'בדיקת AdBlue',                    months: 3,  km: null,  category: 'מערכת דלק' },

    { name: 'החלפת רפידות/תופי בלמים',          months: 24, km: 80000, category: 'בלמים' },
    { name: 'החלפת נוזל בלמים',                months: 24, km: 60000, category: 'בלמים' },
    { name: 'בדיקת מערכת אוויר בלמים',          months: 6,  km: null,  category: 'בלמים' },

    { name: 'סבוב צמיגים',                     months: 6,  km: 30000, category: 'צמיגים ומתלים' },
    { name: 'החלפת צמיגים',                    months: 48, km: 120000, category: 'צמיגים ומתלים' },
    { name: 'בדיקת בולמי זעזועים',             months: 12, km: 50000, category: 'צמיגים ומתלים' },

    { name: 'בדיקת מצבר',                      months: 12, km: null,  category: 'חשמל ומצבר' },
    { name: 'החלפת מצבר',                      months: 36, km: null,  category: 'חשמל ומצבר' },

    { name: 'החלפת שמן גיר',                   months: 36, km: 120000, category: 'תמסורת והנעה' },
    { name: 'החלפת שמן דיפרנציאל',             months: 36, km: 120000, category: 'תמסורת והנעה' },
    { name: 'שימון ציר העגלה (5th wheel)',     months: 1,  km: null,   category: 'תמסורת והנעה' },

    { name: 'החלפת נוזל קירור',                months: 36, km: 100000, category: 'קירור וחימום' },
    { name: 'בדיקת פליטה + DPF',              months: 12, km: 100000, category: 'כללי' },
  ],

  // ── נגרר ────────────────────────────────────────────────────────────────
  'נגרר': [
    { name: 'שימון ציר / נושאי גלגלים',        months: 12, km: 10000, category: 'צמיגים ומתלים' },
    { name: 'בדיקת צמיגים + לחץ',              months: 6,  km: 10000, category: 'צמיגים ומתלים' },
    { name: 'החלפת צמיגים',                    months: 60, km: 40000, category: 'צמיגים ומתלים' },
    { name: 'בדיקת בלמים',                     months: 12, km: null,  category: 'בלמים' },
    { name: 'בדיקת חיבורי חשמל ותאורה',         months: 6,  km: null,  category: 'חשמל ומצבר' },
    { name: 'בדיקת מצמד גרירה',                months: 12, km: null,  category: 'כללי' },
    { name: 'בדיקת מסגרת וריתוכים',            months: 24, km: null,  category: 'גוף וכלי' },
  ],

  // ── ג'יפ שטח ───────────────────────────────────────────────────────────
  "ג'יפ שטח": [
    { name: 'טיפול שמן מנוע',                 months: 6,  km: 5000,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן שמן',                 months: 6,  km: 5000,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן אוויר',                months: 6,  km: 8000,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן דלק',                  months: 24, km: 20000, category: 'מערכת דלק' },

    { name: 'החלפת נוזל בלמים',                months: 12, km: 15000, category: 'בלמים' },
    { name: 'החלפת רפידות בלמים',              months: 24, km: 30000, category: 'בלמים' },

    { name: 'בדיקת מתלים וזרועות',             months: 12, km: 10000, category: 'צמיגים ומתלים' },
    { name: 'בדיקת מיגון תחתון',               months: 6,  km: null,  category: 'צמיגים ומתלים' },
    { name: 'החלפת צמיגי שטח',                 months: 36, km: 40000, category: 'צמיגים ומתלים' },

    { name: 'שמן גיר ומעביר (transfer case)',  months: 36, km: 40000, category: 'תמסורת והנעה' },
    { name: 'שמן דיפרנציאל קדמי',              months: 24, km: 30000, category: 'תמסורת והנעה' },
    { name: 'שמן דיפרנציאל אחורי',             months: 24, km: 30000, category: 'תמסורת והנעה' },
    { name: 'בדיקת גומיות CV/הנעה',             months: 12, km: 15000, category: 'תמסורת והנעה' },

    { name: 'בדיקת כננת + שימון',              months: 12, km: null,  category: 'חשמל ומצבר' },
    { name: 'החלפת נוזל קירור',                months: 24, km: 30000, category: 'קירור וחימום' },
    { name: 'בדיקת מצבר',                      months: 12, km: null,  category: 'חשמל ומצבר' },
  ],

  // ── RZR / Side-by-Side ─────────────────────────────────────────────────
  'RZR': [
    { name: 'טיפול שמן מנוע',                 months: 6,  km: null,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן אוויר',                months: 3,  km: null,  category: 'שמן ופילטרים' },
    { name: 'בדיקת חגורת CVT',                 months: 12, km: null,  category: 'תמסורת והנעה' },
    { name: 'החלפת חגורת CVT',                 months: 24, km: null,  category: 'תמסורת והנעה' },
    { name: 'שמן גיר',                         months: 24, km: null,  category: 'תמסורת והנעה' },
    { name: 'שמן דיפרנציאל',                    months: 24, km: null,  category: 'תמסורת והנעה' },
    { name: 'החלפת נוזל בלמים',                months: 24, km: null,  category: 'בלמים' },
    { name: 'החלפת רפידות בלמים',              months: 12, km: null,  category: 'בלמים' },
    { name: 'החלפת נוזל קירור',                months: 24, km: null,  category: 'קירור וחימום' },
    { name: 'שימון מפרקים וציוד',              months: 3,  km: null,  category: 'תמסורת והנעה' },
    { name: 'בדיקת מצבר',                      months: 12, km: null,  category: 'חשמל ומצבר' },
  ],

  // ── מיול / UTV עבודה ───────────────────────────────────────────────────
  'מיול': [
    { name: 'טיפול שמן מנוע',                 months: 6,  km: null,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן אוויר',                months: 6,  km: null,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן דלק',                  months: 12, km: null,  category: 'מערכת דלק' },
    { name: 'החלפת רפידות בלמים',              months: 12, km: null,  category: 'בלמים' },
    { name: 'שמן גיר / CVT',                   months: 24, km: null,  category: 'תמסורת והנעה' },
    { name: 'שמן דיפרנציאל',                    months: 24, km: null,  category: 'תמסורת והנעה' },
    { name: 'החלפת צמיגים',                    months: 60, km: null,  category: 'צמיגים ומתלים' },
    { name: 'החלפת נוזל קירור',                months: 36, km: null,  category: 'קירור וחימום' },
  ],

  // ── סירה מנועית ────────────────────────────────────────────────────────
  'סירה מנועית': [
    { name: 'טיפול שמן מנוע',                 months: 12, km: null,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן שמן',                 months: 12, km: null,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן דלק',                  months: 12, km: null,  category: 'מערכת דלק' },
    { name: 'החלפת מפריד מים — דלק',           months: 6,  km: null,  category: 'מערכת דלק' },
    { name: 'החלפת פלאגים',                    months: 12, km: null,  category: 'רצועות ושרשראות' },

    { name: 'החלפת משאבת מים / impeller',       months: 12, km: null,  category: 'קירור וחימום' },
    { name: 'שטיפת מערכת קירור במים מתוקים',    months: 12, km: null,  category: 'קירור וחימום' },

    { name: 'בדיקת אנודות אבץ',                months: 6,  km: null,  category: 'גוף וכלי' },
    { name: 'החלפת אנודות אבץ',                months: 12, km: null,  category: 'גוף וכלי' },

    { name: 'החלפת שמן רגל (gearcase)',        months: 12, km: null,  category: 'תמסורת והנעה' },
    { name: 'בדיקת פרופלור + שימון ציר',       months: 6,  km: null,  category: 'תמסורת והנעה' },

    { name: 'בדיקת רצועות',                    months: 12, km: null,  category: 'רצועות ושרשראות' },
    { name: 'בדיקת מצבר',                      months: 6,  km: null,  category: 'חשמל ומצבר' },

    { name: 'בדיקת ציוד בטיחות',               months: 12, km: null,  category: 'בטיחות ים' },
    { name: 'בדיקת תוקף פירוטכניקה',           months: 3,  km: null,  category: 'בטיחות ים' },
    { name: 'בדיקת מטף כיבוי',                 months: 12, km: null,  category: 'בטיחות ים' },
    { name: 'שירות רפסודת הצלה',               months: 12, km: null,  category: 'בטיחות ים' },
    { name: 'ניקוי תחתית + antifouling',       months: 12, km: null,  category: 'גוף וכלי' },
  ],

  // ── מפרשית ─────────────────────────────────────────────────────────────
  'מפרשית': [
    { name: 'טיפול שמן מנוע עזר',              months: 12, km: null,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן דלק',                  months: 12, km: null,  category: 'מערכת דלק' },
    { name: 'החלפת אנודות אבץ',                months: 12, km: null,  category: 'גוף וכלי' },
    { name: 'בדיקת פרופלור',                    months: 6,  km: null,  category: 'תמסורת והנעה' },
    { name: 'בדיקת חבלים וציוד מפרשים (rigging)', months: 12, km: null,  category: 'גוף וכלי' },
    { name: 'בדיקת מפרשים (תפרים, נזק UV)',    months: 12, km: null,  category: 'גוף וכלי' },
    { name: 'ניקוי תחתית + antifouling',       months: 12, km: null,  category: 'גוף וכלי' },
    { name: 'בדיקת הגאים ומערכת הגוי',          months: 12, km: null,  category: 'גוף וכלי' },
    { name: 'בדיקת ציוד בטיחות',               months: 12, km: null,  category: 'בטיחות ים' },
    { name: 'בדיקת תוקף פירוטכניקה',           months: 3,  km: null,  category: 'בטיחות ים' },
    { name: 'שירות רפסודת הצלה',               months: 12, km: null,  category: 'בטיחות ים' },
  ],

  // ── אופנוע ים (PWC) ────────────────────────────────────────────────────
  'אופנוע ים': [
    { name: 'טיפול שמן מנוע',                 months: 12, km: null,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן שמן',                 months: 12, km: null,  category: 'שמן ופילטרים' },
    { name: 'החלפת פלאגים',                    months: 12, km: null,  category: 'רצועות ושרשראות' },
    { name: 'שטיפה במים מתוקים אחרי שימוש',    months: 0,  km: null,  category: 'כללי' },
    { name: 'flush מערכת קירור',                months: 1,  km: null,  category: 'קירור וחימום' },
    { name: 'החלפת שמן משאבת סילון',           months: 12, km: null,  category: 'תמסורת והנעה' },
    { name: 'בדיקת impeller',                   months: 12, km: null,  category: 'תמסורת והנעה' },
    { name: 'החלפת אנודות אבץ',                months: 6,  km: null,  category: 'גוף וכלי' },
    { name: 'בדיקת מצבר',                      months: 6,  km: null,  category: 'חשמל ומצבר' },
    { name: 'בדיקת רצועת חיים / ציוד הצלה',    months: 12, km: null,  category: 'בטיחות ים' },
  ],

  // ── סירת גומי / RIB ────────────────────────────────────────────────────
  'סירת גומי': [
    { name: 'טיפול שמן מנוע',                 months: 12, km: null,  category: 'שמן ופילטרים' },
    { name: 'החלפת מסנן דלק',                  months: 12, km: null,  category: 'מערכת דלק' },
    { name: 'החלפת פלאגים',                    months: 24, km: null,  category: 'רצועות ושרשראות' },
    { name: 'בדיקת/החלפת impeller',             months: 12, km: null,  category: 'קירור וחימום' },
    { name: 'בדיקת אנודות אבץ',                months: 6,  km: null,  category: 'גוף וכלי' },
    { name: 'החלפת שמן רגל',                    months: 12, km: null,  category: 'תמסורת והנעה' },
    { name: 'בדיקת צובות גומי + דליפות',        months: 6,  km: null,  category: 'גוף וכלי' },
    { name: 'ניפוח + בדיקת לחץ בצובות',         months: 3,  km: null,  category: 'גוף וכלי' },
    { name: 'בדיקת ציוד בטיחות',               months: 12, km: null,  category: 'בטיחות ים' },
    { name: 'בדיקת תוקף פירוטכניקה',           months: 3,  km: null,  category: 'בטיחות ים' },
  ],
};

// ── מיפוי כינויי קטגוריה לפי התאמה חלקית ─────────────────────────────────
const ALIASES = [
  { match: /משאית|דיזל|truck/i,               key: 'משאית' },
  { match: /נגרר|trailer/i,                     key: 'נגרר' },
  { match: /rzr|באגי|buggy/i,                   key: 'RZR' },
  { match: /מיול|ריינג'ר|ranger|utv/i,          key: 'מיול' },
  { match: /ג'יפ שטח/i,                         key: "ג'יפ שטח" },
  { match: /טרקטורון|atv/i,                     key: 'טרקטורון' },
  { match: /שטח|דרט|dirt|mx/i,                  key: 'אופנוע שטח' },
  { match: /אופנוע ים|jet|sea-doo|wave|pwc/i,   key: 'אופנוע ים' },
  { match: /גומי|zodiac|rib/i,                  key: 'סירת גומי' },
  { match: /מפרשית|sailboat|sail/i,             key: 'מפרשית' },
  { match: /שייט|סירה|יאכטה|motorboat/i,        key: 'סירה מנועית' },
  { match: /אופנוע|מוטו|motorcycle|bike/i,      key: 'אופנוע כביש' },
];

/**
 * מחזיר את רשימת הטיפולים עבור vehicle_type נתון.
 * התאמה מדויקת → alias חלקי → ברירת מחדל 'רכב'.
 */
export function getCatalogForVehicleType(vehicleType) {
  if (!vehicleType) return MAINTENANCE_CATALOG['רכב'];
  if (MAINTENANCE_CATALOG[vehicleType]) return MAINTENANCE_CATALOG[vehicleType];
  const lower = vehicleType.toLowerCase();
  for (const { match, key } of ALIASES) {
    if (match.test(lower) && MAINTENANCE_CATALOG[key]) return MAINTENANCE_CATALOG[key];
  }
  return MAINTENANCE_CATALOG['רכב'];
}

// ── חישובי מועד + סטטוס (ללא שינוי פונקציונלי) ───────────────────────────

/**
 * חשב מתי מגיע הטיפול הבא.
 * מחזיר תאריך ISO string של מועד הבא (מה שמגיע קודם מבין זמן וק"מ).
 */
export function calcNextDue(lastDate, lastKm, catalogItem, currentKm) {
  let nextByDate = null;
  let nextByKm = null;

  if (lastDate && catalogItem.months) {
    const d = new Date(lastDate);
    d.setMonth(d.getMonth() + catalogItem.months);
    nextByDate = d.toISOString().split('T')[0];
  }

  if (lastKm != null && catalogItem.km != null) {
    nextByKm = lastKm + catalogItem.km;
  }

  return { nextByDate, nextByKm };
}

/**
 * מחשב סטטוס טיפול: 'ok' | 'warning' | 'danger'
 * warning = פחות מחודש / פחות מ-1000 ק"מ
 * danger = עבר המועד
 */
export function getMaintenanceStatus(lastDate, lastKm, catalogItem, currentKm, today = new Date()) {
  let status = 'ok';

  if (lastDate && catalogItem.months) {
    const nextDate = new Date(lastDate);
    nextDate.setMonth(nextDate.getMonth() + catalogItem.months);
    const diffDays = Math.floor((nextDate - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) status = 'danger';
    else if (diffDays <= 30 && status !== 'danger') status = 'warning';
  }

  if (lastKm != null && catalogItem.km != null && currentKm != null) {
    const targetKm = lastKm + catalogItem.km;
    const remaining = targetKm - currentKm;
    if (remaining < 0 && status !== 'danger') status = 'danger';
    else if (remaining <= 1000 && status === 'ok') status = 'warning';
  }

  return status;
}

// מאגר טיפולים לפי קטגוריית רכב
// months = מרווח בחודשים, km = מרווח בק"מ (null = ללא ק"מ)

export const MAINTENANCE_CATALOG = {
  'רכב': [
    { name: 'טיפול שמן', months: 12, km: 10000 },
    { name: 'החלפת מסנן אוויר', months: 24, km: 20000 },
    { name: 'החלפת נוזל בלמים', months: 24, km: 40000 },
    { name: 'החלפת רפידות בלמים', months: 24, km: 30000 },
    { name: 'החלפת צמיגים', months: 36, km: 80000 },
    { name: 'איזון גלגלים', months: 12, km: 10000 },
    { name: 'בדיקת מצבר', months: 24, km: null },
    { name: 'החלפת מסנן מזגן', months: 12, km: 15000 },
  ],
  'אופנוע כביש': [
    { name: 'טיפול שמן מנוע', months: 12, km: 6000 },
    { name: 'החלפת מסנן אוויר', months: 24, km: 12000 },
    { name: 'החלפת נוזל בלמים', months: 24, km: 20000 },
    { name: 'החלפת רפידות בלמים', months: 12, km: 15000 },
    { name: 'החלפת צמיגים', months: 24, km: 20000 },
    { name: 'שרשרת (מתיחה/שימון)', months: 6, km: 5000 },
    { name: 'החלפת שרשרת', months: 24, km: 25000 },
    { name: 'בדיקת מצבר', months: 24, km: null },
  ],
  'אופנוע שטח': [
    { name: 'טיפול שמן מנוע', months: 6, km: 3000 },
    { name: 'החלפת מסנן אוויר', months: 6, km: 5000 },
    { name: 'החלפת נוזל בלמים', months: 12, km: 10000 },
    { name: 'החלפת רפידות בלמים', months: 12, km: 8000 },
    { name: 'החלפת צמיגים', months: 24, km: 15000 },
    { name: 'שרשרת (מתיחה/שימון)', months: 3, km: 1500 },
    { name: 'החלפת שרשרת', months: 12, km: 10000 },
    { name: 'בדיקת מצבר', months: 24, km: null },
  ],
  'טרקטורון': [
    { name: 'טיפול שמן מנוע', months: 6, km: 3000 },
    { name: 'החלפת מסנן אוויר', months: 6, km: 5000 },
    { name: 'החלפת נוזל בלמים', months: 12, km: 10000 },
    { name: 'החלפת רפידות בלמים', months: 12, km: 8000 },
    { name: 'החלפת צמיגים', months: 24, km: 15000 },
    { name: 'שרשרת (מתיחה/שימון)', months: 3, km: 1500 },
    { name: 'החלפת שרשרת', months: 12, km: 10000 },
    { name: 'בדיקת מצבר', months: 24, km: null },
  ],
  'משאית': [
    { name: 'טיפול שמן מנוע', months: 12, km: 20000 },
    { name: 'החלפת מסנן אוויר', months: 24, km: 40000 },
    { name: 'החלפת נוזל בלמים', months: 24, km: 60000 },
    { name: 'החלפת רפידות/תופים', months: 24, km: 80000 },
    { name: 'החלפת צמיגים', months: 36, km: 120000 },
    { name: 'בדיקת מצבר', months: 24, km: null },
    { name: 'בדיקת מערכת הנעה', months: 12, km: 40000 },
    { name: 'החלפת מסנן דלק', months: 24, km: 40000 },
    { name: 'החלפת מסנן שמן גיר', months: 36, km: 60000 },
  ],
  'נגרר': [
    { name: 'בדיקת צמיגים', months: 12, km: 15000 },
    { name: 'החלפת צמיגים', months: 48, km: 40000 },
    { name: 'שימון ציר / נושאי גלגלים', months: 12, km: 10000 },
    { name: 'בדיקת חיבורי חשמל ותאורה', months: 12, km: null },
    { name: 'בדיקת מסגרת וחיבורים', months: 24, km: null },
  ],
};

/**
 * מחזיר את רשימת הטיפולים עבור vehicle_type נתון.
 * אם לא נמצאה התאמה מדויקת, מנסה מיפוי חלקי.
 */
export function getCatalogForVehicleType(vehicleType) {
  if (!vehicleType) return [];
  
  // התאמה מדויקת
  if (MAINTENANCE_CATALOG[vehicleType]) return MAINTENANCE_CATALOG[vehicleType];
  
  // התאמה חלקית
  const lower = vehicleType.toLowerCase();
  if (lower.includes('משאית') || lower.includes('דיזל')) return MAINTENANCE_CATALOG['משאית'];
  if (lower.includes('נגרר')) return MAINTENANCE_CATALOG['נגרר'];
  if (lower.includes('טרקטורון')) return MAINTENANCE_CATALOG['טרקטורון'];
  if (lower.includes('שטח') || lower.includes('דרט') || lower.includes('dirt')) return MAINTENANCE_CATALOG['אופנוע שטח'];
  if (lower.includes('אופנוע') || lower.includes('מוטו')) return MAINTENANCE_CATALOG['אופנוע כביש'];
  
  // ברירת מחדל: רכב פרטי
  return MAINTENANCE_CATALOG['רכב'];
}

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
    const targetKm = lastKm + catalogItem.km;
    if (currentKm != null) {
      // הפוך ל-"date equivalent" - כמה ק"מ נשארו → ממיר לתאריך משוער (לא ריאלי, אלא לצורך השוואה)
      // נשמור את הק"מ הגולמי
    }
    nextByKm = targetKm; // ק"מ יעד
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
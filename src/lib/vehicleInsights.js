function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value) {
  const date = parseDate(value);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date - today) / (1000 * 60 * 60 * 24));
}

function vehicleAge(year) {
  const n = Number(year);
  if (!n || n < 1900) return null;
  return Math.max(0, new Date().getFullYear() - n);
}

function detectedType(vehicle) {
  return vehicle._detectedType || '';
}

function isVintage(vehicle, age) {
  if (vehicle.is_vintage || vehicle.vehicle_type === 'רכב אספנות') return true;
  return age !== null && age >= 30;
}

function testLabelFor(vehicle) {
  const type = detectedType(vehicle);
  if (type === 'cme') return 'תסקיר / בדיקת כשירות';
  if (type === 'trailer') return 'בדיקת רישוי לנגרר';
  if (type === 'motorcycle') return 'טסט לדו־גלגלי';
  if (type === 'heavy' || type === 'truck' || type === 'bus') return 'בדיקת רישוי';
  return 'טסט';
}

function typeInsight(vehicle) {
  const type = detectedType(vehicle);
  const label = vehicle._detectedTypeLabel || vehicle.vehicle_type;
  if (!type && !label) return null;

  const copy = {
    motorcycle: 'הנתונים הגיעו ממאגר דו־גלגלי. שים לב לפרטי נפח, רישוי וטסט המתאימים לאופנוע או קטנוע.',
    cme: 'הנתונים הגיעו ממאגר כלי צמ״ה. בכלים כאלה חשוב במיוחד לעקוב אחרי תסקיר, שעות מנוע וכשירות תקופתית.',
    trailer: 'הנתונים מזהים נגרר. בנגררים יש דגש על רישוי, משקל וכושר גרירה במקום נתוני מנוע.',
    truck: 'הנתונים מזהים רכב כבד או משאית. כדאי לשים לב למשקל, רישוי וסיווג תקינה.',
    bus: 'הנתונים מזהים אוטובוס. מומלץ לבדוק רישוי, מספר מושבים וסיווג שימוש.',
    commercial: 'הנתונים מזהים רכב מסחרי. כדאי לבדוק בעלות, משקל ושימוש בפועל.',
    car: 'הנתונים מזהים רכב פרטי. אפשר להמשיך לבדוק בעלות, טסט ומפרט טכני.',
  }[type];

  return insight(
    'detected-type',
    type === 'cme' || type === 'trailer' || type === 'truck' || type === 'bus' ? 'info' : 'success',
    label ? `סוג הכלי: ${label}` : 'סוג כלי זוהה',
    copy || 'סוג הכלי זוהה לפי מאגר משרד התחבורה ומתאים את התובנות לשדה המתאים.',
    'סוג כלי'
  );
}

function insight(id, tone, title, description, label) {
  return { id, tone, title, description, label };
}

export function generateVehicleInsights(vehicle = {}) {
  const insights = [];
  const age = vehicleAge(vehicle.year);
  const hand = Number(vehicle.ownership_hand);
  const testDays = daysUntil(vehicle.test_due_date || vehicle.inspection_report_expiry_date);
  const typeBasedInsight = typeInsight(vehicle);
  const testLabel = testLabelFor(vehicle);

  if (typeBasedInsight) {
    insights.push(typeBasedInsight);
  }

  if (vehicle._isInactive) {
    insights.push(insight(
      'inactive',
      'danger',
      'הרכב נמצא בסטטוס לא פעיל',
      vehicle._cancellationDate
        ? `הרכב מופיע כירד מהכביש. תאריך ביטול: ${vehicle._cancellationDate}.`
        : 'הרכב מופיע במאגר רכב לא פעיל. כדאי לבדוק לפני רכישה או שימוש.',
      'דורש בדיקה'
    ));
  }

  if (isVintage(vehicle, age)) {
    insights.push(insight(
      'vintage',
      'info',
      'רכב אספנות',
      age !== null
        ? `לפי שנת הייצור הרכב בן ${age} שנים ולכן מתאים לסיווג אספנות במעקב האפליקציה.`
        : 'הרכב מסומן כרכב אספנות לפי המידע הזמין.',
      'אספנות'
    ));
  }

  if (age !== null) {
    insights.push(insight(
      'age',
      age <= 3 ? 'success' : age >= 30 ? 'info' : age >= 12 ? 'warning' : 'info',
      age === 0 ? 'כלי חדש מאוד' : `גיל הכלי: ${age} שנים`,
      age <= 3
        ? 'כלי צעיר יחסית, בדרך כלל עם פחות בלאי מצטבר.'
        : age >= 30
          ? 'כלי ותיק מאוד. מומלץ לבדוק היסטוריית טיפולים, רישוי וחלקים זמינים.'
          : age >= 12
            ? 'כלי ותיק. מומלץ לבדוק היסטוריית טיפולים ובלאי לפני החלטה.'
            : 'גיל הכלי תקין למעקב שוטף אחר רישוי, ביטוח וטיפולים.',
      age <= 3 ? 'צעיר' : age >= 30 ? 'אספנות' : age >= 12 ? 'ותיק' : 'סטנדרטי'
    ));
  }

  if (Number.isFinite(hand) && hand > 0) {
    insights.push(insight(
      'ownership-hand',
      hand <= 2 ? 'success' : hand >= 5 ? 'warning' : 'info',
      `יד ${hand}`,
      hand <= 2
        ? 'מספר בעלויות נמוך יחסית, נתון חיובי בבדיקת רקע.'
        : hand >= 5
          ? 'מספר בעלויות גבוה יחסית. כדאי לבדוק מדוע הרכב החליף ידיים רבות.'
          : 'מספר בעלויות סביר, אך עדיין כדאי להשוות לגיל הרכב.',
      'בעלות'
    ));
  }

  if (age !== null && Number.isFinite(hand) && hand > 0 && age <= 5 && hand >= 4) {
    insights.push(insight(
      'ownership-pattern',
      'warning',
      'החלפת בעלויות מהירה',
      'הכלי צעיר יחסית אך עבר כמה בעלויות. זה לא בהכרח בעייתי, אבל שווה בדיקה.',
      'חריג'
    ));
  }

  if (testDays !== null) {
    if (testDays < 0) {
      insights.push(insight(
        'test-expired',
        'danger',
        `${testLabel} פג תוקף`,
        `תוקף ${testLabel} פג לפני ${Math.abs(testDays)} ימים.`,
        'לא בתוקף'
      ));
    } else if (testDays <= 45) {
      insights.push(insight(
        'test-soon',
        'warning',
        `${testLabel} מתקרב`,
        `נותרו ${testDays} ימים עד תוקף ${testLabel}.`,
        'בקרוב'
      ));
    } else {
      insights.push(insight(
        'test-valid',
        'success',
        `${testLabel} נראה בתוקף`,
        `נותרו ${testDays} ימים עד תוקף ${testLabel}.`,
        'בתוקף'
      ));
    }
  }

  if (vehicle.is_personal_import) {
    insights.push(insight(
      'personal-import',
      'info',
      'יבוא אישי',
      vehicle.personal_import_type
        ? `הרכב מופיע במאגר יבוא אישי: ${vehicle.personal_import_type}.`
        : 'הרכב מופיע כרכב יבוא אישי.',
      'יבוא'
    ));
  }

  if (vehicle.safety_rating) {
    const rating = Number(vehicle.safety_rating);
    insights.push(insight(
      'safety',
      rating >= 6 ? 'success' : rating <= 2 ? 'warning' : 'info',
      `רמת בטיחות ${vehicle.safety_rating}`,
      rating >= 6
        ? 'נתון בטיחות חיובי ביחס למידע הזמין.'
        : rating <= 2
          ? 'רמת הבטיחות נמוכה יחסית. כדאי לקחת זאת בחשבון.'
          : 'נתון בטיחות זמין להשוואה מול רכבים דומים.',
      'בטיחות'
    ));
  }

  return insights;
}

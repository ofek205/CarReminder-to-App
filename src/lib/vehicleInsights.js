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

function numericValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function detectedType(vehicle) {
  return vehicle._detectedType || '';
}

function isRoadVehicle(vehicle) {
  return ['car', 'commercial', 'motorcycle', 'truck', 'bus'].includes(detectedType(vehicle));
}

function isWorkTool(vehicle) {
  return ['cme', 'trailer'].includes(detectedType(vehicle));
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

function riskLevel({ vehicle, age, hand, testDays, km, annualKm, rating }) {
  let score = 0;
  if (vehicle._isInactive) score += 5;
  if (testDays !== null && testDays < 0) score += 3;
  else if (testDays !== null && testDays <= 45) score += 1;
  if (Number.isFinite(hand) && hand >= 5) score += 2;
  if (age !== null && age <= 5 && Number.isFinite(hand) && hand >= 4) score += 2;
  if (age !== null && age >= 12) score += 1;
  if (annualKm !== null && annualKm >= 30000) score += 2;
  if (annualKm !== null && age >= 5 && annualKm <= 2500) score += 1;
  if (isRoadVehicle(vehicle) && !km) score += 1;
  if (Number.isFinite(rating) && rating <= 2) score += 1;

  if (score >= 5) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

function decisionInsight(level) {
  if (level === 'high') {
    return insight(
      'decision-summary',
      'danger',
      'דורש בדיקה מעמיקה לפני החלטה',
      'יש כאן כמה סימני סיכון שיכולים להשפיע על בטיחות, מחיר או כשירות. מומלץ לא להתקדם בלי בדיקה מקצועית ומסמכים משלימים.',
      'המלצה'
    );
  }
  if (level === 'medium') {
    return insight(
      'decision-summary',
      'warning',
      'מתאים להמשך בדיקה, לא להחלטה מהירה',
      'הנתונים לא חוסמים, אבל יש נקודות שחשוב לאמת מול המוכר או בעל הכלי לפני שמתקדמים.',
      'המלצה'
    );
  }
  return insight(
    'decision-summary',
    'success',
    'אין דגלים אדומים בולטים בנתונים הזמינים',
    'לפי המידע שנמצא, אין כרגע סימן חריג מרכזי. עדיין מומלץ לוודא היסטוריית טיפולים, מסמכים ומצב מכני בפועל.',
    'המלצה'
  );
}

export function generateVehicleInsights(vehicle = {}) {
  const insights = [];
  const age = vehicleAge(vehicle.year);
  const hand = Number(vehicle.ownership_hand);
  const testDays = daysUntil(vehicle.test_due_date || vehicle.inspection_report_expiry_date);
  const typeBasedInsight = typeInsight(vehicle);
  const testLabel = testLabelFor(vehicle);
  const km = numericValue(vehicle.current_km);
  const annualKm = km && age ? Math.round(km / Math.max(age, 1)) : null;
  const rating = Number(vehicle.safety_rating);
  const level = riskLevel({ vehicle, age, hand, testDays, km, annualKm, rating });

  insights.push(decisionInsight(level));

  if (typeBasedInsight) {
    insights.push(typeBasedInsight);
  }

  if (vehicle._isInactive) {
    insights.push(insight(
      'inactive',
      'danger',
      'סטטוס לא פעיל במאגר',
      vehicle._cancellationDate
        ? `הכלי מופיע כירד מהכביש. תאריך ביטול: ${vehicle._cancellationDate}. זה נתון שחייבים לברר לפני שימוש או רכישה.`
        : 'הכלי מופיע במאגר כלי רכב לא פעילים. זה דגל אדום שדורש אימות מול רישיון הרכב והמוכר.',
      'דגל אדום'
    ));
  }

  if (isVintage(vehicle, age)) {
    insights.push(insight(
      'vintage',
      'info',
      'רכב אספנות',
      age !== null
        ? `לפי שנת הייצור הכלי בן ${age} שנים. כדאי לבדוק רישום אספנות, זמינות חלקים ותדירות בדיקות לפני קנייה.`
        : 'הכלי מסומן כאספנות לפי המידע הזמין. כדאי לוודא שהסיווג מופיע גם במסמכים.',
      'אספנות'
    ));
  }

  if (km) {
    const title = annualKm ? `קילומטראז׳ אחרון: ${km.toLocaleString('he-IL')}` : `קילומטראז׳: ${km.toLocaleString('he-IL')}`;
    let tone = 'info';
    let text = 'זה נתון חשוב להשוואה מול גיל הכלי, היסטוריית טיפולים ומצב מכני בפועל.';
    let label = 'קילומטראז׳';
    if (annualKm !== null) {
      if (annualKm >= 30000) {
        tone = 'warning';
        text = `ממוצע משוער של כ־${annualKm.toLocaleString('he-IL')} ק״מ לשנה נחשב גבוה יחסית. כדאי לבדוק בלאי, טיפולים ושימוש מסחרי.`;
        label = 'שימוש גבוה';
      } else if (age >= 5 && annualKm <= 2500) {
        tone = 'warning';
        text = `ממוצע משוער של כ־${annualKm.toLocaleString('he-IL')} ק״מ לשנה נמוך מאוד. כדאי לוודא שהקריאה הגיונית מול היסטוריית טיפולים וטסטים.`;
        label = 'דורש אימות';
      } else {
        tone = 'success';
        text = `ממוצע משוער של כ־${annualKm.toLocaleString('he-IL')} ק״מ לשנה נראה סביר ביחס לגיל הכלי.`;
        label = 'שימוש סביר';
      }
    }
    insights.push(insight('mileage', tone, title, text, label));
  } else if (isRoadVehicle(vehicle)) {
    insights.push(insight(
      'missing-mileage',
      'warning',
      'חסר קילומטראז׳ מאומת',
      'לא נמצא נתון קילומטראז׳ במידע הזמין. לפני קנייה כדאי לבקש צילום מד אוץ, היסטוריית טיפולים ונתוני טסט אחרון.',
      'נתון חסר'
    ));
  } else if (isWorkTool(vehicle)) {
    insights.push(insight(
      'work-tool-hours',
      'info',
      'לבדוק שעות עבודה בפועל',
      'בכלי עבודה, נגררים או כלי צמ״ה הקילומטראז׳ פחות משמעותי. כדאי לבקש שעות מנוע, תסקיר תקף ותיעוד תחזוקה.',
      'שימוש'
    ));
  }

  if (age !== null) {
    insights.push(insight(
      'age',
      age <= 3 ? 'success' : age >= 30 ? 'info' : age >= 12 ? 'warning' : 'info',
      age === 0 ? 'כלי חדש מאוד' : `גיל הכלי: ${age} שנים`,
      age <= 3
        ? 'כלי צעיר יחסית. עדיין חשוב לוודא אחריות, טיפולים ראשונים והיעדר תאונות.'
        : age >= 30
          ? 'כלי ותיק מאוד. הערך תלוי במצב, מקוריות, רישוי וזמינות חלקים יותר מאשר בגיל בלבד.'
          : age >= 12
            ? 'כלי ותיק. כדאי לבדוק טיפולים יקרים צפויים, בלאי ומצב מערכות בטיחות.'
            : 'גיל הכלי סביר, ולכן כדאי להתמקד בקילומטראז׳, בעלויות והיסטוריית טיפולים.',
      age <= 3 ? 'צעיר' : age >= 30 ? 'אספנות' : age >= 12 ? 'ותיק' : 'סטנדרטי'
    ));
  }

  if (Number.isFinite(hand) && hand > 0) {
    insights.push(insight(
      'ownership-hand',
      hand <= 2 ? 'success' : hand >= 5 ? 'warning' : 'info',
      `יד ${hand}`,
      hand <= 2
        ? 'מספר בעלויות נמוך יחסית. זה נתון חיובי, במיוחד אם יש רצף טיפולים ומסמכים מסודרים.'
        : hand >= 5
          ? 'מספר בעלויות גבוה יחסית. זה יכול להשפיע על מחיר ועל אמון, לכן כדאי להבין למה הכלי החליף ידיים רבות.'
          : 'מספר בעלויות סביר. כדאי להשוות אותו לגיל הכלי ולשימוש בפועל.',
      'בעלות'
    ));
  }

  if (age !== null && Number.isFinite(hand) && hand > 0 && age <= 5 && hand >= 4) {
    insights.push(insight(
      'ownership-pattern',
      'warning',
      'החלפת בעלויות מהירה',
      'הכלי צעיר יחסית אך עבר כמה בעלויות. זה לא מוכיח בעיה, אבל זו נקודה טובה לשיחה עם המוכר ולבדיקת היסטוריה.',
      'חריג'
    ));
  }

  if (testDays !== null) {
    if (testDays < 0) {
      insights.push(insight(
        'test-expired',
        'danger',
        `${testLabel} פג תוקף`,
        `תוקף ${testLabel} פג לפני ${Math.abs(testDays)} ימים. זה יכול למנוע שימוש חוקי ומהווה נקודת מיקוח ברורה.`,
        'מיקוח'
      ));
    } else if (testDays <= 45) {
      insights.push(insight(
        'test-soon',
        'warning',
        `${testLabel} מתקרב`,
        `נותרו ${testDays} ימים עד תוקף ${testLabel}. כדאי לברר מי משלם על הבדיקה הקרובה ומה צפוי להידרש.`,
        'עלות קרובה'
      ));
    } else {
      insights.push(insight(
        'test-valid',
        'success',
        `${testLabel} נראה בתוקף`,
        `נותרו ${testDays} ימים עד תוקף ${testLabel}. זה מפחית חיכוך מיידי, אבל לא מחליף בדיקה מכנית.`,
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
        ? `הכלי מופיע במאגר יבוא אישי: ${vehicle.personal_import_type}. כדאי לבדוק זמינות חלפים, תאימות תקינה והיסטוריית שירות.`
        : 'הכלי מופיע כיבוא אישי. כדאי לבדוק זמינות חלפים, תאימות תקינה והיסטוריית שירות.',
      'יבוא'
    ));
  }

  if (vehicle.safety_rating) {
    insights.push(insight(
      'safety',
      rating >= 6 ? 'success' : rating <= 2 ? 'warning' : 'info',
      `רמת בטיחות ${vehicle.safety_rating}`,
      rating >= 6
        ? 'נתון בטיחות חיובי ביחס למידע הזמין. זה יתרון במיוחד לרכב משפחתי או נסועה גבוהה.'
        : rating <= 2
          ? 'רמת הבטיחות נמוכה יחסית. כדאי לקחת זאת בחשבון בהחלטת קנייה ובשימוש יומיומי.'
          : 'נתון בטיחות בינוני. מומלץ להשוות מול דגמים דומים באותה קטגוריה.',
      'בטיחות'
    ));
  }

  if (vehicle.has_tow_hitch || vehicle.tow_capacity) {
    insights.push(insight(
      'tow-capability',
      'info',
      'יש יכולת גרירה או וו גרירה',
      vehicle.tow_capacity
        ? `נמצא נתון כושר גרירה: ${vehicle.tow_capacity}. כדאי לוודא שהוא מתאים לצורך ולרישיון.`
        : 'נמצא סימון לוו גרירה. כדאי לוודא שהוא רשום ומותקן כחוק.',
      'גרירה'
    ));
  }

  if (detectedType(vehicle) === 'cme' && !vehicle.test_due_date && !vehicle.inspection_report_expiry_date) {
    insights.push(insight(
      'cme-certificate-missing',
      'warning',
      'לא נמצא תוקף כשירות לכלי צמ״ה',
      'בכלי צמ״ה תסקיר וכשירות תקופתית הם נתונים קריטיים. אם אין תוקף במאגר, כדאי לבקש מסמך עדכני לפני שימוש.',
      'תסקיר'
    ));
  }

  // Curate to 3-4 high-value insights only. Goal: decision-impacting
  // signals, not obvious/general info overload.
  const isHighValue = (item) => {
    if (!item) return false;
    if (['inactive', 'test-expired', 'test-soon', 'missing-mileage', 'ownership-pattern', 'cme-certificate-missing'].includes(item.id)) return true;
    if (item.id === 'mileage') return item.tone !== 'success';
    if (item.id === 'ownership-hand') return item.tone === 'warning';
    if (item.id === 'safety') return item.tone === 'warning';
    if (item.id === 'personal-import') return true;
    if (item.id === 'work-tool-hours') return true;
    return false;
  };

  const priorityById = {
    inactive: 100,
    'test-expired': 96,
    'test-soon': 84,
    'cme-certificate-missing': 82,
    'ownership-pattern': 80,
    'missing-mileage': 78,
    mileage: 76,
    'ownership-hand': 74,
    safety: 72,
    'personal-import': 70,
    'work-tool-hours': 68,
    'decision-summary': 40,
    'detected-type': 30,
  };
  const toneWeight = { danger: 10, warning: 6, info: 2, success: 0 };

  const selected = insights.filter(isHighValue);

  // If data is sparse, backfill with concise context cards.
  if (selected.length < 3) {
    const fallback = insights.filter(item =>
      ['decision-summary', 'detected-type', 'tow-capability'].includes(item.id)
    );
    fallback.forEach(item => {
      if (selected.find(s => s.id === item.id)) return;
      selected.push(item);
    });
  }

  selected.sort((a, b) => {
    const pa = (priorityById[a.id] || 0) + (toneWeight[a.tone] || 0);
    const pb = (priorityById[b.id] || 0) + (toneWeight[b.tone] || 0);
    return pb - pa;
  });

  return selected.slice(0, 4);
}

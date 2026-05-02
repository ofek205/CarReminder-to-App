// Vehicle insights engine.
//
// Design philosophy (rewritten from a previous "every fact is an insight"
// approach that produced things like "גיל הכלי: 8 שנים — סטנדרטי" — true
// but useless):
//
//   1. EVERY insight must cross-reference at least two data points OR
//      compare a data point against the national fleet. Single-fact
//      restatement is banned.
//   2. Quality > quantity. We return 0..3 insights. NEVER pad to a
//      target count — if there's nothing sharp to say, return [] and
//      the UI hides the section entirely.
//   3. Each insight must give the reader information they couldn't
//      compute from the rest of the report. Concrete numbers,
//      concrete actions, concrete comparisons.
//   4. Tone reflects the buyer's risk: 'danger' for must-not-miss,
//      'warning' for "ask the seller", 'info' for "know-your-purchase",
//      'success' for genuinely positive surprises (rare).

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

function testLabelFor(vehicle) {
  const type = detectedType(vehicle);
  if (type === 'cme') return 'תסקיר';
  if (type === 'trailer') return 'בדיקת רישוי לנגרר';
  if (type === 'motorcycle') return 'טסט';
  if (type === 'heavy' || type === 'truck' || type === 'bus') return 'בדיקת רישוי';
  return 'טסט';
}

function insight(id, tone, title, description, label) {
  return { id, tone, title, description, label };
}

// ─── Israeli national context ──────────────────────────────────────────
// Sources used as comparison baselines. These are public statistics —
// not guesses. CBS publishes per-driver km/year; the gov.il fleet API
// gives us per-model counts directly. CO2 per-household vehicle figure
// comes from the Ministry of Environmental Protection.
const IL_AVG_ANNUAL_KM = 17000;        // CBS — average Israeli driver
const IL_AVG_VEHICLE_CO2_TONS = 3.0;   // approx 17K km × 175 g/km

// ────────────────────────────────────────────────────────────────────────
// Individual insight builders. Each returns either an insight object or
// null. The orchestrator below collects only the non-null results — no
// padding, no fallback, no "well at least say something" cards.
// ────────────────────────────────────────────────────────────────────────

function inactiveInsight(vehicle) {
  if (!vehicle._isInactive) return null;
  return insight(
    'inactive',
    'danger',
    'הרכב מופיע במאגר רכבים לא פעילים',
    vehicle._cancellationDate
      ? `תאריך ביטול: ${vehicle._cancellationDate}. אי אפשר לרשום אותו על שמך, אי אפשר לבטח אותו, וגם לא לעבור איתו טסט. דגל אדום ברור לקנייה.`
      : 'הרכב לא פעיל לפי משרד התחבורה. צריך לברר את זה מול המוכר ורישיון הרכב לפני כל רכישה.',
    'דגל אדום',
  );
}

function openRecallInsight(vehicle) {
  const count = Number(vehicle.open_recalls_count);
  if (!Number.isFinite(count) || count <= 0) return null;
  const recalls = Array.isArray(vehicle.open_recalls) ? vehicle.open_recalls : [];
  const sample = recalls[0]?.description ? recalls[0].description.slice(0, 140) : null;
  const isSafety = recalls.some(r => /בטיחות/i.test(r.defectType || '') || /בטיחות/i.test(r.type || ''));
  return insight(
    'open-recalls',
    'danger',
    count === 1 ? 'יש קריאת recall פתוחה לרכב הזה' : `יש ${count} קריאות recall פתוחות`,
    [
      isSafety ? 'אחת מהקריאות מסווגת כליקוי בטיחותי.' : null,
      sample ? `הראשונה: "${sample}${recalls[0].description.length > 140 ? '…' : ''}".` : null,
      'את התיקון אצל היבואן עושים בחינם. אם אתה קונה, זו נקודת מיקוח טובה. בקש שהתיקון יבוצע לפני העברת בעלות.',
    ].filter(Boolean).join(' '),
    'recall',
  );
}

function testStatusInsight(vehicle) {
  const days = daysUntil(vehicle.test_due_date || vehicle.inspection_report_expiry_date);
  if (days === null) return null;
  const label = testLabelFor(vehicle);
  if (days < 0) {
    return insight(
      'test-expired',
      'danger',
      `${label} פג לפני ${Math.abs(days)} ימים`,
      `אסור לנסוע איתו, וביטוח עלול לא לכסות במקרה תאונה. ${label} מיידי עולה בערך 200 עד 500 שקל, ועוד תיקונים אם דרושים. נקודת מיקוח טובה במו"מ.`,
      'מיקוח',
    );
  }
  if (days <= 30) {
    return insight(
      'test-soon',
      'warning',
      `${label} מתחדש בעוד ${days} ימים`,
      `סכם עם המוכר מי משלם ומי אחראי לתיקונים. אם הרכב לא יעבור, התיקון יכול להגיע לאלפי שקלים.`,
      'עלות קרובה',
    );
  }
  return null; // valid test = no insight, not interesting on its own
}

// Rapid ownership handover — flags rate-of-change, not just count. A
// 6-year-old yad-3 is normal; a 4-year-old yad-5 is very unusual.
function rapidHandoverInsight(vehicle, age) {
  const hand = Number(vehicle.ownership_hand);
  if (!Number.isFinite(hand) || hand < 3 || age === null || age <= 0) return null;
  const yearsPerOwner = age / hand;
  if (yearsPerOwner >= 2.2) return null;
  return insight(
    'rapid-handover',
    'warning',
    `החלפת בעלים כל ${yearsPerOwner.toFixed(1)} שנים בערך`,
    `${hand} בעלים ב-${age} שנים. בארץ הממוצע הוא בערך 3 שנים בין כל החלפת ידיים. שווה לברר עם המוכר למה הקצב כאן מהיר יותר.`,
    'תבנית חריגה',
  );
}

// Past leasing / rental episode in the ownership chain. The CURRENT
// owner is private but somewhere up the chain there was a fleet
// operator. Concrete value to the buyer: leasing cars typically run
// 25K-35K km/year vs ~17K civilian, and maintenance is "minimum to
// pass return" rather than "preserve value".
function pastFleetEpisodeInsight(vehicle) {
  const history = Array.isArray(vehicle.ownership_history) ? vehicle.ownership_history : [];
  if (history.length < 2) return null;
  const current = vehicle.ownership || history[history.length - 1]?.baalut || '';
  if (current === 'ליסינג' || current === 'השכרה') return null; // current state, not a "past" insight
  const past = history.find(h => h.baalut === 'ליסינג' || h.baalut === 'השכרה');
  if (!past) return null;
  return insight(
    'past-fleet',
    'warning',
    `הרכב היה ב${past.baalut} בעבר`,
    past.baalut === 'ליסינג'
      ? 'רכבי ליסינג נוסעים בדרך כלל הרבה יותר מרכב פרטי, בערך 25 עד 35 אלף ק"מ בשנה, וגם הטיפולים בהם ממוקדים בלהעביר מבחנים ולא בשמירת ערך לטווח ארוך. בקש מסמכי טיפולים מהתקופה הזאת.'
      : 'ברכבי השכרה הנהגים מתחלפים תכופות, וגם הטיפולים בהם ממוקדים בלהעביר מבחנים ולא בשמירת ערך לטווח ארוך. בקש מסמכי טיפולים מהתקופה הזאת.',
    'היסטוריה',
  );
}

// Past commercial registration (taxi, delivery, work-vehicle) that's
// now private. Unlike leasing, commercial use can include heavy load,
// long stops with engine running, etc.
function pastCommercialInsight(vehicle) {
  const history = Array.isArray(vehicle.ownership_history) ? vehicle.ownership_history : [];
  if (history.length < 2) return null;
  const current = vehicle.ownership || history[history.length - 1]?.baalut || '';
  if (current === 'מסחרי') return null;
  const past = history.find(h => h.baalut === 'מסחרי');
  if (!past) return null;
  return insight(
    'past-commercial',
    'warning',
    'הרכב היה ברישום מסחרי בעבר',
    'רכבים בשימוש מסחרי כמו מונית, חלוקה או רכב עבודה חווים בלאי שונה מרכב פרטי, גם באופי הנסיעה וגם בעומס. בקש מהמוכר פירוט שימוש מהתקופה הזאת.',
    'היסטוריה',
  );
}

// Mileage vs the Israeli average — only flags when the deviation is
// large enough to matter (>=30%). Ignores small differences that look
// like noise.
function mileageVsFleetInsight(vehicle, age) {
  const km = numericValue(vehicle.current_km);
  if (!km || age === null || age < 1) return null;
  const annualKm = Math.round(km / age);
  const diffPct = Math.round(((annualKm - IL_AVG_ANNUAL_KM) / IL_AVG_ANNUAL_KM) * 100);
  if (Math.abs(diffPct) < 30) return null;
  if (diffPct > 0) {
    return insight(
      'mileage-high',
      'warning',
      `נסועה גבוהה ב-${diffPct}% מהממוצע הישראלי`,
      `הרכב נסע בערך ${annualKm.toLocaleString('he-IL')} ק"מ בשנה, לעומת ${IL_AVG_ANNUAL_KM.toLocaleString('he-IL')} ממוצע ארצי. צפוי בלאי גבוה במנוע, בהנעה ובבלמים. שווה לברר עם המוכר באיזה אופי שימוש הרכב היה.`,
      'נסועה',
    );
  }
  if (age >= 4) {
    return insight(
      'mileage-stored',
      'info',
      `נסועה נמוכה ב-${Math.abs(diffPct)}% מהממוצע`,
      `הרכב נסע רק ${annualKm.toLocaleString('he-IL')} ק"מ בשנה, לעומת ${IL_AVG_ANNUAL_KM.toLocaleString('he-IL')} בממוצע. בלאי נמוך זה יתרון, אבל רכב שעמד הרבה זמן יכול לפתח בעיות בצמיגים, בסוללה ובבלמים. ודא עם המוכר שלא היה תקופת חניה ארוכה.`,
      'נסועה נמוכה',
    );
  }
  return null;
}

// Fleet rarity — based on number of identical models active in Israel.
// Either extreme is interesting: <80 means parts/service nightmare,
// >50K means a commodity car with predictable resale.
function fleetRarityInsight(vehicle) {
  const total = Number(vehicle.active_same_model_count);
  if (!Number.isFinite(total)) return null;
  if (total <= 0) return null;
  if (total < 80) {
    return insight(
      'fleet-rarity',
      'warning',
      `דגם נדיר בארץ. רק ${total} רכבים פעילים`,
      'כשיש רק כמה רכבים מהדגם בארץ, החלפים יקרים, זמני ההזמנה ארוכים, והשירות זמין בעיקר במוסכים מומחים. גם ערך הרכב ביד שנייה פחות צפוי.',
      'נדיר',
    );
  }
  if (total > 50000) {
    return insight(
      'fleet-popular',
      'success',
      `דגם נפוץ. מעל ${Math.round(total / 1000)}K בארץ`,
      'שוק חלפים מפותח, מחירי ביטוח סטנדרטיים, ומחירוני יד שנייה ידועים. קל יחסית להעריך כמה הרכב יהיה שווה כשתרצה למכור.',
      'נפוץ',
    );
  }
  return null;
}

// Color rarity within the same model. Only computed when the model
// fleet is large enough (>= 200) for percentages to be meaningful.
function colorRarityInsight(vehicle) {
  const total = Number(vehicle.active_same_model_count);
  const ofColor = Number(vehicle.active_same_model_color_count);
  const colorName = vehicle.active_same_model_color_name;
  if (!Number.isFinite(total) || total < 200) return null;
  if (!Number.isFinite(ofColor) || ofColor <= 0) return null;
  const pct = (ofColor / total) * 100;
  if (pct >= 4) return null;
  return insight(
    'color-rare',
    'info',
    `צבע נדיר לדגם הזה (${pct.toFixed(1)}%)`,
    `רק ${ofColor.toLocaleString('he-IL')} מתוך ${total.toLocaleString('he-IL')} רכבים מהדגם הזה בצבע ${colorName || 'הזה'}. צבע נדיר יכול להאריך זמן מכירה, אבל גם להבליט את הרכב לקונה הנכון.`,
    'נדיר',
  );
}

// Annual emissions translation — concrete tons of CO2 per year. Only
// flags when significantly above the national household-vehicle avg.
function emissionsContextInsight(vehicle, age) {
  const co2PerKm = numericValue(vehicle.co2);
  const km = numericValue(vehicle.current_km);
  if (!co2PerKm || !km || age === null || age < 1) return null;
  const annualKm = km / age;
  const tonsPerYear = (co2PerKm * annualKm) / 1_000_000;
  if (tonsPerYear < IL_AVG_VEHICLE_CO2_TONS * 1.4) return null; // <40% above avg → not interesting
  return insight(
    'emissions-context',
    'info',
    `כ-${tonsPerYear.toFixed(1)} טון CO₂ לשנה`,
    `לפי הפליטה של ${co2PerKm} ג' לק"מ ולפי הנסועה המשוערת. זה גבוה ב-${Math.round(((tonsPerYear / IL_AVG_VEHICLE_CO2_TONS) - 1) * 100)}% מממוצע רכב במשק בית בארץ. עלול להשפיע על דמי האקלים העתידיים.`,
    'פליטה',
  );
}

function personalImportInsight(vehicle) {
  if (!vehicle.is_personal_import) return null;
  return insight(
    'personal-import',
    'info',
    'רכב ביבוא אישי',
    vehicle.personal_import_type
      ? `סיווג: ${vehicle.personal_import_type}. חלפים יכולים להיות פחות זמינים אצל היבואן הרשמי, ולפעמים צריך לחפש מקור חלופי. בדוק זמינות שירות לפני שאתה קונה.`
      : 'בדוק זמינות חלפים ושירות אצל היבואן הרשמי. לפעמים צריך לחפש מקור חלופי.',
    'יבוא',
  );
}

// CME / construction-machinery without a valid certificate of fitness.
// Specific to a non-road category that lives by certificate dates, not
// the standard test/insurance cadence.
function cmeMissingCertInsight(vehicle) {
  if (detectedType(vehicle) !== 'cme') return null;
  if (vehicle.test_due_date || vehicle.inspection_report_expiry_date) return null;
  return insight(
    'cme-cert-missing',
    'warning',
    'אין תוקף תסקיר בנתונים',
    'בכלי צמ"ה תסקיר תקף הוא תנאי להפעלה חוקית. אם המוכר לא מציג תסקיר עדכני, אל תחתום עד שיביא אחד תקף.',
    'תסקיר',
  );
}

// ────────────────────────────────────────────────────────────────────────
// Orchestrator
// ────────────────────────────────────────────────────────────────────────
export function generateVehicleInsights(vehicle = {}) {
  const age = vehicleAge(vehicle.year);

  // Build all candidate insights. Each builder returns null when its
  // data isn't there or the deviation isn't worth flagging.
  const candidates = [
    inactiveInsight(vehicle),
    openRecallInsight(vehicle),
    testStatusInsight(vehicle),
    cmeMissingCertInsight(vehicle),
    rapidHandoverInsight(vehicle, age),
    mileageVsFleetInsight(vehicle, age),
    pastFleetEpisodeInsight(vehicle),
    pastCommercialInsight(vehicle),
    fleetRarityInsight(vehicle),
    colorRarityInsight(vehicle),
    emissionsContextInsight(vehicle, age),
    personalImportInsight(vehicle),
  ].filter(Boolean);

  // Priority — a plate that's been deregistered out-trumps everything;
  // an open recall out-trumps an expired test; etc. Tone tiebreaker
  // means within the same priority, danger > warning > info > success.
  const priorityById = {
    inactive:           100,
    'open-recalls':      98,
    'test-expired':      96,
    'cme-cert-missing':  90,
    'rapid-handover':    82,
    'mileage-high':      78,
    'past-fleet':        76,
    'past-commercial':   74,
    'fleet-rarity':      70,
    'mileage-stored':    66,
    'test-soon':         64,
    'color-rare':        56,
    'emissions-context': 52,
    'personal-import':   48,
    'fleet-popular':     30,
  };
  const toneWeight = { danger: 10, warning: 6, info: 2, success: 0 };

  candidates.sort((a, b) => {
    const pa = (priorityById[a.id] || 0) + (toneWeight[a.tone] || 0);
    const pb = (priorityById[b.id] || 0) + (toneWeight[b.tone] || 0);
    return pb - pa;
  });

  // Cap at 3 — anything beyond that becomes a feed of facts again, the
  // exact thing this rewrite was meant to fix. NEVER pad to a minimum:
  // an empty array is a valid result and the UI hides the section.
  return candidates.slice(0, 3);
}

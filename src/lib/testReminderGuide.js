// Extra copy for /website/guides/test-reminder.
// Kept out of the guide tuples that PR 73 edits, and rendered by
// TestReminderAdditions so those lines stay untouched.

export const TEST_REMINDER_PATH = '/website/guides/test-reminder';

export const TEST_REMINDER_TITLE = 'בדיקת תאריך טסט ותוקף רישיון רכב: איך בודקים';

export const TEST_REMINDER_HEADING = 'מתי הטסט של הרכב? בדיקת תאריך טסט ותוקף רישיון';

export const TEST_REMINDER_DESCRIPTION = 'איך בודקים מתי הטסט ועד מתי רישיון הרכב בתוקף: ברישיון עצמו, במאגר של משרד התחבורה או באזור האישי. ואיך מגדירים תזכורת כדי לא לפספס את המועד.';

export const TEST_REMINDER_ANSWER = 'את התאריך רואים ברישיון הרכב, במאגר מספרי הרישוי של משרד התחבורה או באזור האישי הממשלתי. שומרים את המועד שבדקתם, ומגדירים תזכורת ב־Car Reminder לפני שהוא מגיע.';

export const WAYS_HEADING = '3 דרכים לבדוק את תאריך הטסט ותוקף הרישיון';

export const COLLECTOR_URL = 'https://www.gov.il/he/departments/dynamiccollectors/private-and-commercial-vehicles';

export const FEE_HEADING = 'תשלום האגרה והטסט הם שני דברים שונים';

// Pointer only. The renewal page could not be re-read from this environment
// (Cloudflare returned 403), so this sentence adds no rule of its own.
export const FEE_NOTE = 'את ההנחיות העדכניות רואים בעמוד השירות הרשמי לחידוש רישיון רכב, בקישור שבמקורות שבהמשך.';

// The collector page also returned 403 here, so the second way does not name
// fields such as license expiry or last test. The on-site check is included
// because VehicleCheck shows "תוקף בדיקה" when tokef_dt comes back
// (vehicleLookup.js maps that field to the next test date).
export const WAYS = [
  { parts: [{ text: 'ברישיון הרכב עצמו: פותחים את הרישיון העדכני ובודקים את תאריך התוקף.' }] },
  {
    parts: [
      { text: 'במאגר של משרד התחבורה, ' },
      { href: COLLECTOR_URL, label: 'מספרי רישוי של כלי רכב פרטיים ומסחריים' },
      { text: ': אפשר לחפש לפי מספר רישוי ולראות את פרטי הרישוי של הרכב.' },
    ],
  },
  { parts: [{ text: 'באזור האישי הממשלתי אפשר לצפות בפרטי הרכב ובמועד החידוש.' }] },
  {
    parts: [
      { to: '/website/vehicle-lookup', label: 'בבדיקת רכב לפי מספר רישוי כאן באתר' },
      { text: '. כשהמאגר מחזיר תאריך, הדוח מציג תוקף בדיקה. אם התאריך לא חזר, הוא לא מוצג.' },
    ],
  },
];

export const TEST_REMINDER_FAQ = [
  ['איך בודקים מתי הטסט של הרכב?', 'בודקים את תאריך התוקף ברישיון הרכב, מחפשים לפי מספר רישוי במאגר מספרי הרישוי של משרד התחבורה, או צופים בפרטי הרכב ובמועד החידוש באזור האישי הממשלתי. אם יש פער בין המסמך לבין הרישום הרשמי, מבררים את המועד מול משרד התחבורה.'],
  ['איך בודקים את תוקף רישיון הרכב לפי מספר רישוי?', 'במאגר מספרי הרישוי של כלי רכב פרטיים ומסחריים אפשר לחפש לפי מספר רישוי ולראות את פרטי הרישוי של הרכב. בבדיקת הרכב באתר, כשהמאגר מחזיר תאריך, הדוח מציג תוקף בדיקה.'],
  ['תשלום האגרה זה אותו דבר כמו טסט?', 'לא. תהליך חידוש הרישיון כולל תשלום אגרה, ובמקרים שבהם נדרש מבחן רישוי גם ביצוע טסט. הדרישה למבחן תלויה ברכב, ואת ההנחיות שמתאימות לרכב בודקים בעמוד השירות הרשמי.'],
  ['איך מקבלים תזכורת לפני הטסט?', 'מוסיפים את המועד לפרטי הרכב ב־Car Reminder, בודקים את הגדרות התזכורת ואת הרשאות ההתראות במכשיר, ובוחרים מועד שמאפשר להתארגן מראש.'],
];

export const CROSS_LINKS = {
  'test-insurance-reminders': {
    before: 'לפני שמגדירים תזכורת, כדאי לדעת ',
    label: 'איך בודקים מתי הטסט ועד מתי הרישיון בתוקף',
    after: '.',
    to: TEST_REMINDER_PATH,
  },
  'vehicle-lookup': {
    before: 'אחרי שמזהים את הרכב, המדריך מסביר ',
    label: 'איך בודקים את תוקף רישיון הרכב',
    after: '.',
    to: TEST_REMINDER_PATH,
  },
  'plate-check': {
    before: 'כאן אפשר לקרוא על ',
    label: 'בדיקת תאריך טסט ותוקף רישיון',
    after: '.',
    to: TEST_REMINDER_PATH,
  },
};

export function appendFeeNote(section) {
  if (!section || section[0] !== FEE_HEADING) return section;
  return [section[0], `${section[1]} ${FEE_NOTE}`, ...section.slice(2)];
}

export function buildTestReminderArticle(article, nodes) {
  if (!article || article.slug !== 'test-reminder') return article;
  return {
    ...article,
    text: nodes.lead,
    sections: [
      ...article.sections.map(appendFeeNote),
      [WAYS_HEADING, nodes.waysBody],
    ],
  };
}

export function crossLinkFor({ article, product } = {}) {
  const slug = article?.slug || product?.slug;
  return CROSS_LINKS[slug] || null;
}

export function testReminderFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: TEST_REMINDER_FAQ.map(([name, text]) => ({
      '@type': 'Question',
      name,
      acceptedAnswer: { '@type': 'Answer', text },
    })),
  };
}

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';

/**
 * Accessibility statement (הצהרת נגישות).
 *
 * Mandatory under the Equal Rights for Persons with Disabilities (Service
 * Accessibility Accommodations) Regulations, 2013, which incorporate IS 5568
 * Part 1 at level AA by reference.
 *
 * EVERY CLAIM BELOW WAS MEASURED on 2026-09-11 against the live site, and the
 * limitations section lists what actually failed rather than being left empty.
 * That is deliberate: the regulation requires known limitations to be
 * declared, and a statement that claims more than the site delivers is worse
 * for the operator than one that is candid, because the claim itself becomes
 * evidence in a complaint.
 *
 * AUDIT_DATE is the single source for the date shown, so updating it after a
 * re-audit cannot leave a stale date in one place and a fresh one in another.
 */
const AUDIT_DATE = '11 בספטמבר 2026';
const SUPPORT_EMAIL = 'support@car-reminder.app';

const IMPLEMENTED = [
  'האתר מוגדר בעברית ובכיוון ימין לשמאל, כך שקוראי מסך מקריאים אותו בסדר הנכון.',
  'ניווט מלא באמצעות מקלדת, כולל קישור "דילוג לתוכן" שמעביר את המיקוד לתוכן העמוד.',
  'סימון מיקוד גלוי בכל רכיב שאפשר להגיע אליו במקלדת.',
  'לכל התמונות באתר יש טקסט חלופי, ותמונות קישוט מסומנות ככאלה.',
  'ניגודיות של 4.5:1 לפחות בכל טקסט התוכן, ו-3:1 בכותרות גדולות.',
  'כותרת ראשית אחת בכל עמוד והיררכיית כותרות רציפה, בלי דילוג על רמות.',
  'לשדות הטפסים יש תוויות, והודעות השגיאה נכתבות בעברית ומוקראות על ידי קורא מסך.',
];

const LIMITATIONS = [
  'דוח בדיקת הרכב שניתן להוריד כקובץ PDF מופק כתמונה, ולכן אינו נגיש לקוראי מסך ואי אפשר לסמן בו טקסט או לחפש בו. זוהי מגבלה מול חלק 2 של תקן 5568. כל המידע שבדוח מוצג גם בעמוד עצמו בפורמט נגיש, ואפשר לקרוא אותו שם בקורא מסך.',
  'הבדיקה שבוצעה היא בדיקה טכנית פנימית. חוות דעת של מורשה נגישות שירות טרם נערכה.',
];

export default function MarketingAccessibilityPage() {
  return <article className="cm-section cm-wrap cm-article" lang="he" dir="rtl">
    <Link className="cm-text-link" to="/website">חזרה לאתר <ArrowLeft size={17} /></Link>
    <span className="cm-kicker">נגישות</span>
    <h1>הצהרת נגישות</h1>
    <p className="cm-article-lead">
      אנחנו ב-Car Reminder רואים בנגישות האתר והאפליקציה חלק מהשירות ולא תוספת לו, ופועלים
      להנגיש אותם לאנשים עם מוגבלות בהתאם לתקן הישראלי 5568, המעוגן ב-WCAG 2.0 ברמה AA.
    </p>

    <section>
      <h2>מה כבר מונגש באתר</h2>
      <ul className="cm-a11y-list">{IMPLEMENTED.map(item => <li key={item}>{item}</li>)}</ul>
    </section>

    <section>
      <h2>מגבלות נגישות ידועות</h2>
      <p>
        התקנות מחייבות לפרט מה עדיין אינו נגיש, ולא רק את מה שכן. אלה הדברים שאנחנו יודעים
        עליהם נכון לתאריך הבדיקה:
      </p>
      <ul className="cm-a11y-list">{LIMITATIONS.map(item => <li key={item}>{item}</li>)}</ul>
    </section>

    <section>
      <h2>נתקלתם בבעיית נגישות?</h2>
      <p>
        אם נתקלתם ברכיב שאינו נגיש, נשמח שתספרו לנו מה ניסיתם לעשות, באיזה עמוד, ובאיזו
        טכנולוגיה מסייעת השתמשתם. אנחנו מטפלים בפניות נגישות ומשיבים עליהן.
      </p>
      <p className="cm-a11y-contact">
        <Mail size={17} aria-hidden="true" />{' '}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('פנייה בנושא נגישות')}`} dir="ltr">{SUPPORT_EMAIL}</a>
      </p>
      <p>
        אפשר גם לפנות דרך <Link to="/Contact">עמוד יצירת הקשר</Link>, ולציין שהפנייה בנושא נגישות.
      </p>
    </section>

    <section>
      <h2>פרטי ההצהרה</h2>
      <p>תאריך בדיקת הנגישות האחרונה: {AUDIT_DATE}.</p>
      <p>תאריך עדכון ההצהרה: {AUDIT_DATE}.</p>
      <p>התקן שלפיו נבדק האתר: תקן ישראלי 5568 חלק 1, ברמת התאמה AA.</p>
    </section>
  </article>;
}

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, BatteryCharging, BellRing, Bluetooth,
  CalendarDays, Camera, Car, Check, CheckCircle2, Clock3, ExternalLink,
  HelpCircle, Image, Mail, MapPin, MessageCircle, Music2, Phone,
  Settings, ShieldCheck, Smartphone,
} from 'lucide-react';
import { marketingEvent } from '@/lib/marketingEvents';

const faqs = [
  ['האם זו מערכת למניעת שכחת ילדים ברכב?', 'Car Reminder היא אפליקציית תזכורת וכלי עזר נוסף. היא אינה חיישן ואינה יודעת אם יש ילד ברכב. בסיום הנסיעה היא מזכירה לכם לבדוק את המושב האחורי.'],
  ['באילו מכשירים הפיצ׳ר זמין?', 'התזכורת זמינה באפליקציית Car Reminder ל-iPhone ול-Android.'],
  ['האם השימוש בתזכורת עולה כסף?', 'לא. תזכורת הבטיחות כלולה בחינם ב-Car Reminder ואינה דורשת רכישה נפרדת.'],
  ['האם צריך להתקין ציוד ברכב?', 'לא. צריך מערכת Bluetooth שהטלפון יכול להתחבר אליה. בוחרים באפליקציה את המכשיר המזווג של הרכב.'],
  ['מה קורה אם ה-Bluetooth או ההתראות כבויים?', 'מחוון המצב באפליקציה מציג שההגנה אינה פעילה ומסביר מה צריך לתקן. ללא Bluetooth והרשאת התראות לא ניתן לשלוח את התזכורת.'],
  ['אפשר לבחור יותר מרכב אחד?', 'כן. אפשר לסמן יותר ממכשיר Bluetooth אחד כרכב שלכם.'],
  ['האם אפשר לבחור ימים ושעות?', 'כן. ניתן לבחור ימים, טווח שעות ומשך נסיעה מינימלי. מומלץ להשאיר חלון רחב כדי שהתזכורת תוכל לפעול גם כשהשגרה משתנה.'],
];

function PlatformLinks() {
  return <div className="cm-child-platform-links" onClick={() => marketingEvent('store_click', 'child_reminder')} aria-label="הורדת Car Reminder">
    <a href="https://apps.apple.com/app/carreminder/id6764073107" target="_blank" rel="noopener noreferrer">
      <img src="/marketing/apple.svg" width="18" height="21" alt="" />
      <span>App Store</span>
    </a>
    <a href="https://play.google.com/store/apps/details?id=com.carreminder.app" target="_blank" rel="noopener noreferrer">
      <img src="/marketing/google-play.svg" width="18" height="21" alt="" />
      <span>Google Play</span>
    </a>
  </div>;
}

function PhoneShell({ label, children, className = '' }) {
  return <figure className={`cm-child-phone ${className}`}>
    <div className="cm-child-phone-frame">
      <div className="cm-child-island" aria-hidden="true" />
      <div className="cm-child-phone-screen">{children}</div>
    </div>
    <figcaption>{label}</figcaption>
  </figure>;
}

function IntroScreen() {
  return <PhoneShell label="מסך ההסבר לפני ההפעלה">
    <div className="cm-child-appbar"><span>‹</span><strong>בטיחות ילדים</strong><ShieldCheck /></div>
    <div className="cm-child-screen-pad">
      <span className="cm-child-app-icon"><ShieldCheck /></span>
      <h3>איך זה עובד</h3>
      <p>כשהטלפון יתנתק מה-Bluetooth של הרכב, נשלח תזכורת רוטטת לבדוק שכל הילדים ירדו.</p>
      <div className="cm-child-app-info"><BellRing /><span>השאירו את הרשאות ההתראות וה-Bluetooth פעילות.</span></div>
      <div className="cm-child-app-warning"><AlertTriangle /><span><strong>חשוב להבין</strong>זו תזכורת נוספת, לא תחליף לבדיקה ידנית ולא ערובה.</span></div>
      <div className="cm-child-app-check"><i><Check /></i><span>הבנתי שזו עזרה נוספת ולא תחליף לבדיקה שלי</span></div>
      <span className="cm-child-app-button">הבנתי, בואו נתחיל</span>
    </div>
  </PhoneShell>;
}

function ActiveScreen() {
  return <PhoneShell label="המסך הפעיל והגדרות הרכב">
    <div className="cm-child-appbar"><span>‹</span><strong>בטיחות ילדים</strong><ShieldCheck /></div>
    <div className="cm-child-screen-pad">
      <div className="cm-child-active"><span><ShieldCheck /></span><strong>ההגנה פעילה</strong><small>נזכיר לכם בנסיעה הבאה.</small></div>
      <div className="cm-child-setting"><span><ShieldCheck />הפעל את ההגנה</span><i className="is-on" /></div>
      <div className="cm-child-app-section">
        <strong><Car /> הרכבים שלי</strong>
        <p>מערכת השמע שנבחרה לזיהוי הנסיעה</p>
        <div className="cm-child-device"><span><Car /> Toyota Multimedia</span><i className="is-on" /></div>
      </div>
      <div className="cm-child-app-section">
        <strong><CalendarDays /> מתי ההגנה פעילה</strong>
        <div className="cm-child-days"><i>א</i><i>ב</i><i>ג</i><i>ד</i><i>ה</i><i>ו</i><i>ש</i></div>
        <p><Clock3 /> כל היום · נסיעה של 2 דקות ומעלה</p>
      </div>
    </div>
  </PhoneShell>;
}

function NotificationScreen() {
  return <PhoneShell label="ההתראה שמופיעה בסיום הנסיעה" className="cm-child-notification-phone">
    <div className="cm-child-lockscreen">
      <div className="cm-child-ios-status"><strong>17:42</strong><span>● ◔ ▰</span></div>
      <div className="cm-child-ios-apps" aria-hidden="true">
        <span><i className="is-green"><Phone /></i><small>טלפון</small></span>
        <span><i className="is-blue"><Mail /></i><small>דואר</small></span>
        <span><i className="is-pink"><Image /></i><small>תמונות</small></span>
        <span><i className="is-gray"><Camera /></i><small>מצלמה</small></span>
        <span><i className="is-maps"><MapPin /></i><small>מפות</small></span>
        <span><i className="is-purple"><Music2 /></i><small>מוזיקה</small></span>
        <span><i className="is-green"><MessageCircle /></i><small>הודעות</small></span>
        <span><i className="is-gray"><Settings /></i><small>הגדרות</small></span>
      </div>
      <div className="cm-child-notification">
        <div><span className="cm-child-notification-logo"><ShieldCheck /></span><strong>Car Reminder</strong><time>עכשיו</time></div>
        <h3>סיימתם נסיעה</h3>
        <p>ודאו שכל הילדים ירדו מהרכב</p>
        <div><span>בדקתי, הכל בסדר</span><span>אין ילדים ברכב</span></div>
      </div>
    </div>
  </PhoneShell>;
}

const walkthroughSteps = [
  { title: 'מבינים מה התזכורת עושה', text: 'בכניסה הראשונה מופיע הסבר קצר על זיהוי סיום הנסיעה ועל ההרשאות שנדרשות לקבלת ההתראה.', Screen: IntroScreen },
  { title: 'בוחרים רכב ומפעילים', text: 'מסמנים את חיבור ה-Bluetooth של הרכב ורואים מיד אם ההרשאות וההגדרות מאפשרות לתזכורת לפעול.', Screen: ActiveScreen },
  { title: 'מקבלים תזכורת בסיום', text: 'כשהטלפון מתנתק מהרכב מתקבלת התראה ברורה. בודקים את המושב האחורי ואז מאשרים במסך.', Screen: NotificationScreen },
];

function AnimatedWalkthrough() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => setStep(value => (value + 1) % walkthroughSteps.length), 4800);
    return () => window.clearInterval(timer);
  }, []);

  const current = walkthroughSteps[step];
  const CurrentScreen = current.Screen;
  return <div className="cm-child-walkthrough">
    <div className="cm-child-walk-device" key={step}><CurrentScreen /></div>
    <aside className="cm-child-callout">
      <span>שלב {step + 1} מתוך {walkthroughSteps.length}</span>
      <h3>{current.title}</h3>
      <p>{current.text}</p>
      <div className="cm-child-walk-dots" aria-hidden="true">{walkthroughSteps.map((item, index) => <i key={item.title} className={index === step ? 'is-active' : ''} />)}</div>
    </aside>
  </div>;
}

export default function MarketingChildReminderPage() {
  useEffect(() => {
    const schema = document.createElement('script');
    schema.id = 'cm-child-reminder-schema';
    schema.type = 'application/ld+json';
    schema.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Car Reminder', item: '/website' },
            { '@type': 'ListItem', position: 2, name: 'תזכורת ילד ברכב' },
          ],
        },
        {
          '@type': 'FAQPage',
          mainEntity: faqs.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })),
        },
      ],
    });
    document.head.appendChild(schema);
    return () => schema.remove();
  }, []);

  return <article className="cm-child-page">
    <section className="cm-child-page-hero">
      <div className="cm-wrap cm-child-page-hero-grid">
        <div className="cm-child-page-copy">
          <Link className="cm-text-link" to="/website">חזרה לעמוד הראשי <ArrowLeft size={17} /></Link>
          <span className="cm-kicker">כלי חינמי ל-iPhone ול-Android</span>
          <h1>אפליקציה חינמית לתזכורת{' '}<br /><em>ילדים ברכב.</em></h1>
          <p>Car Reminder מוסיפה הרגל קטן לסוף הנסיעה: כשהטלפון מתנתק מהרכב, מתקבלת תזכורת לבדוק את המושב האחורי. ההפעלה בחינם ואינה דורשת התקנת ציוד נוסף.</p>
          <div className="cm-child-page-actions"><a className="cm-button cm-gold" href="#how-it-works">איך מפעילים? <ArrowLeft size={17} /></a></div>
          <p className="cm-child-safety-line"><ShieldCheck /> התזכורת אינה מזהה ילד ברכב ואינה מחליפה בדיקה ידנית.</p>
        </div>
        <div className="cm-child-page-photo"><img src="/marketing/child-seat-reminder.webp" alt="כיסא בטיחות ריק המותקן במושב האחורי של רכב" width="1536" height="1024" /><span><BellRing /> תזכורת בסיום הנסיעה</span></div>
      </div>
    </section>

    <section className="cm-section cm-child-why">
      <div className="cm-wrap cm-child-narrow">
        <span className="cm-kicker">עוד הרגל קטן ברגע חשוב</span>
        <h2>איך מצמצמים את הסיכון לשכחת ילדים ברכב?</h2>
        <p>עייפות, מתח, הסחת דעת או נסיעה שלא מתנהלת כרגיל עלולים לגרום גם לאנשים אחראים לפעול מתוך הרגל. לכן כדאי לבנות כמה שכבות של תשומת לב: להביט במושב האחורי בכל יציאה, להשאיר ליד הילד חפץ שתצטרכו לקחת, ולהפעיל תזכורת נוספת בטלפון.</p>
        <div className="cm-child-source-note"><ShieldCheck /><p><strong>בונים יותר מהרגל אחד.</strong> משרד הבריאות ממליץ לאמץ הרגלי מניעה קבועים ולהתייחס לכל אמצעי טכנולוגי ככלי עזר נוסף.</p></div>
      </div>
    </section>

    <section id="how-it-works" className="cm-section cm-child-how">
      <div className="cm-wrap">
        <div className="cm-section-heading"><span className="cm-kicker">הפעלה חד פעמית</span><h2>ארבעה צעדים,{' '}<br /><em>ואז התזכורת מוכנה.</em></h2></div>
        <ol className="cm-child-process">
          <li><b>01</b><Bluetooth /><h3>מחברים את הטלפון לרכב</h3><p>מתחברים פעם אחת למערכת ה-Bluetooth של הרכב, כמו בחיבור למוזיקה או לדיבורית.</p></li>
          <li><b>02</b><Car /><h3>בוחרים את הרכב</h3><p>במסך בטיחות ילדים מסמנים את מערכת הרכב ומאשרים הרשאות Bluetooth והתראות.</p></li>
          <li><b>03</b><CalendarDays /><h3>בוחרים מתי להזכיר</h3><p>אפשר לקבוע ימים ושעות. מומלץ להשאיר טווח רחב כדי לכסות גם שינוי בשגרה.</p></li>
          <li><b>04</b><BellRing /><h3>בודקים ומאשרים</h3><p>בסיום הנסיעה מתקבלת תזכורת. מביטים מאחור ורק אז מאשרים שהבדיקה בוצעה.</p></li>
        </ol>
      </div>
    </section>

    <section id="feature-walkthrough" className="cm-section cm-child-screens">
      <div className="cm-wrap">
        <div className="cm-child-screens-heading"><span className="cm-kicker">כך זה עובד באפליקציה</span><h2>מסך אחד שמלווה אתכם{' '}<br />מההפעלה ועד לבדיקה.</h2><p>האנימציה עוברת בין ההסבר הראשוני, בחירת הרכב וההתראה שמתקבלת בסיום הנסיעה.</p></div>
        <AnimatedWalkthrough />
      </div>
    </section>

    <section className="cm-section cm-child-boundaries">
      <div className="cm-wrap cm-child-boundaries-grid">
        <div className="cm-child-do"><span className="cm-child-block-icon"><CheckCircle2 /></span><h2>מה התזכורת עושה</h2><ul><li>מזהה התחברות וניתוק מה-Bluetooth שבחרתם</li><li>מתחשבת בימים, בשעות ובמשך הנסיעה</li><li>מציגה אם ההגנה פעילה ומה מונע ממנה לפעול</li><li>שולחת התראה רוטטת ותזכורת חוזרת ללא אישור</li></ul></div>
        <div className="cm-child-dont"><span className="cm-child-block-icon"><HelpCircle /></span><h2>מה חשוב לדעת</h2><ul><li>היא אינה מזהה אם ילד נמצא ברכב</li><li>היא אינה חיישן מושב ואינה מודדת טמפרטורה</li><li>Bluetooth והרשאת התראות חייבים להיות פעילים</li><li>היא אינה מחליפה מבט ובדיקה של הנהג או הנהגת</li></ul></div>
      </div>
    </section>

    <section className="cm-section cm-child-reliability">
      <div className="cm-wrap cm-child-reliability-grid">
        <div><span className="cm-kicker">מצב שאפשר להבין</span><h2>רואים אם התזכורת מוכנה לפני שיוצאים.</h2><p>מחוון ברור מציג אם ההגנה פעילה. אם Bluetooth כבוי, הרשאה חסרה או שלא נבחר רכב, האפליקציה מציגה את הסיבה ומובילה לתיקון.</p></div>
        <div className="cm-child-reliability-list"><span><Bluetooth /><strong>חיבור לרכב</strong><small>המכשיר שבחרתם מחובר ומזוהה</small></span><span><BellRing /><strong>הרשאות התראה</strong><small>הטלפון רשאי להציג ולרטוט</small></span><span><BatteryCharging /><strong>פעילות ברקע</strong><small>האפליקציה מסבירה אם הגבלת הסוללה עלולה להפריע</small></span></div>
      </div>
    </section>

    <section className="cm-section cm-faq cm-child-faq">
      <div className="cm-wrap cm-faq-grid"><div><span className="cm-kicker">לפני שמפעילים</span><h2>שאלות נפוצות</h2><p>כל מה שכדאי לדעת על החיבור, ההרשאות והזמינות.</p></div><div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></div>
    </section>

    <section className="cm-child-resources">
      <div className="cm-wrap"><span className="cm-kicker">מקורות והמשך קריאה</span><h2>הרגלי בטיחות שכדאי לאמץ</h2><div><a href="https://me.health.gov.il/parenting/raising-children/safe-environment/outdoor-safety/child-unattended-car/" target="_blank" rel="noopener noreferrer">משרד הבריאות: מניעת שכחת ילדים ברכב <ExternalLink /></a><a href="https://www.nhtsa.gov/campaign/heatstroke" target="_blank" rel="noopener noreferrer">NHTSA: מניעת פגיעת חום בילדים ברכב <ExternalLink /></a><Link to="/website/test-insurance-reminders">תזכורות נוספות ב-Car Reminder <ArrowLeft /></Link></div></div>
    </section>

    <section className="cm-child-final"><div className="cm-wrap"><Smartphone /><span className="cm-kicker">זמין ב-iPhone וב-Android</span><h2>מוסיפים עוד רגע של בדיקה{' '}<br />לסוף כל נסיעה.</h2><p>הפיצ׳ר כלול בחינם ב-Car Reminder.</p><PlatformLinks /><small>זמינות ההתראה תלויה בחיבור ובהרשאות המכשיר. תמיד בדקו את הרכב בעצמכם.</small></div></section>
  </article>;
}

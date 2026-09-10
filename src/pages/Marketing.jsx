import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, BellRing, BriefcaseBusiness, Car, FileText, Menu, Search, ShieldCheck, Ship, Sparkles, Users, Wallet, X } from 'lucide-react';
import { guides, productPages } from '@/lib/marketingContent';
import { businessFeatures, specialtyPages } from '@/lib/marketingSpecialties';
import MarketingProductPage from '@/components/MarketingProductPage';
import MarketingHeroBackground from '@/components/MarketingHeroBackground';
import MarketingPhone from '@/components/MarketingPhone';
import MarketingBusinessPreview from '@/components/MarketingBusinessPreview';
const logo = '/marketing/logo.webp';
import './Marketing.css';
import { applyMarketingSeo } from '@/lib/marketingSeo';
import { marketingEvent } from '@/lib/marketingEvents';

const VehicleCheck = lazy(() => import('./VehicleCheck'));
const screens = [
  { name: 'מצא מוסך', title: 'מוצאים מוסך וממשיכים אליו', text: 'מחפשים לפי עיר וסוג שירות, משווים את התוצאות ופותחים ניווט ב־Waze או ב־Google Maps. כשמספר טלפון זמין, אפשר להתקשר ישירות מכרטיס העסק.', image: 'garage-cards-live', extension: 'jpg', icon: Search },
  { name: 'שאלות על הרכב', title: 'לפני שמתקשרים למוסך, מבינים קצת יותר', text: 'שאלות על טיפולים, תקלות או קניית רכב? בצ׳אט עם עוזר ה־AI אפשר לנסח שאלה ולצרף תמונה או מסמך. התשובות עשויות לטעות ואינן מחליפות בדיקה במוסך.', image: 'ai-live', extension: 'jpg', icon: Sparkles },
  { name: 'מה מתקרב', title: 'הרכבים והמועדים הקרובים', text: 'הרכבים, כלי השיט והמועדים החשובים מרוכזים במקום אחד.', image: 'dashboard', icon: BellRing },
  { name: 'הרכבים שלי', title: 'פרטי הרכב זמינים כשצריך', text: 'פרטי הרכב ומועדי החידוש זמינים כשצריך אותם.', image: 'vehicles', icon: Car },
  { name: 'המסמכים שלי', title: 'רישיון, ביטוח וקבלות', text: 'רישיון, ביטוח וקבלות מסודרים לצד הרכב שאליו הם שייכים.', image: 'documents', icon: FileText },
];
const categoryArt = {
  offroad: { title: 'אופנועים וכלי שטח', text: 'שעות מנוע, טיפולים וכל מה שצריך לפני היציאה לשטח.', image: '/marketing/hero-ktm.webp' },
  trucks: { title: 'משאיות ורכבי עבודה', text: 'תיקי רכב, נהגים ומסמכים במקום אחד.', image: '/marketing/category-full-trailer.webp' },
  'heavy-equipment': { title: 'טרקטורים וכלי צמ״ה', text: 'תיעוד שימוש, תחזוקה ותוקף תסקירים.', image: '/marketing/hero-loader.webp' },
  'classic-cars': { title: 'רכבי אספנות', text: 'שומרים את היסטוריית הטיפולים והשיקום.', image: '/marketing/category-classic-beetle.webp' },
  'inactive-vehicles': { title: 'רכבים לא פעילים', text: 'בודקים את המידע ומרכזים את התיעוד.', image: '/marketing/category-inactive-car.webp' },
};
const categoryCards = [
  ...specialtyPages.map(page => ({ ...categoryArt[page.slug], slug: page.slug, href: '/website/' + page.slug })),
  { slug: 'jet-skis', href: '/website/vessels', title: 'אופנועי ים', text: 'שעות מנוע, טיפולים ומסמכים לקראת היציאה למים.', image: '/marketing/hero-jet-ski.webp' },
  { slug: 'motorboats', href: '/website/vessels', title: 'סירות מנוע', text: 'מרכזים את פרטי הסירה, שעות המנוע ומועדי התחזוקה.', image: '/marketing/category-motorboat.webp' },
  { slug: 'sailing-yachts', href: '/website/vessels', title: 'יאכטות מפרשיות', text: 'מסמכים, מועדי חידוש ותיעוד טיפולים בתיק אחד ליאכטה.', image: '/marketing/category-sailing-yacht.webp' },
];
const featuredGuideSlugs = ['test-reminder', 'plate-check', 'engine-hours'];
const faqs = [
  ['אפשר לבדוק רכב בלי להירשם?', 'כן. אפשר לבצע בדיקה ראשונה ללא חשבון ולהוריד את המסמך. כדי לבדוק רכב נוסף או לשמור את הרכב בחשבון יש להתחבר.'],
  ['איזה מידע מופיע בבדיקת הרכב?', 'פרטי רישוי, מפרט ותובנות בהתאם למידע שנמצא במקורות הזמינים. לא לכל רכב קיימים כל הנתונים. אפשר לפתוח תצוגה מקדימה ולהוריד את הדוח כ־PDF.'],
  ['אפשר להשתמש גם באתר?', 'כן. אפשר להיכנס לחשבון מהדפדפן. זמינות התראות והרשאות תלויה במכשיר ובהגדרות שלו.'],
  ['מה המחיר ומה כלול?', 'האפשרויות והמסלולים הזמינים מוצגים בתוך המערכת. אפשר להתחיל מבדיקת הרכב כאורח; לפרטים על התאמה עסקית ניתן לפנות אלינו.'],
  ['ומה לגבי כלי שיט?', 'אפשר לרכז גם כלי שיט, מסמכים, מועדים ושעות מנוע. בדיקת מספר הרישוי באתר מציגה מידע רק לכלים שמכוסים במקורות הבדיקה.'],
  ['איך מצטרפים עם עסק?', 'חשבון עסקי נפתח לאחר הגשת בקשה ואישור. בעמוד העסקים אפשר להכיר את היכולות ולפנות לגבי התאמה לצוות שלכם.'],
];

function StoreLinks() {
  return <div className="cm-stores" onClick={() => marketingEvent('store_click', 'download')}><a href="https://apps.apple.com/app/carreminder/id6764073107" target="_blank" rel="noopener noreferrer"><img src="/marketing/apple.svg" width="28" height="32" alt="" /><span><small>להורדה ב־</small><strong>App Store</strong></span></a><a href="https://play.google.com/store/apps/details?id=com.carreminder.app" target="_blank" rel="noopener noreferrer"><img src="/marketing/google-play.svg" width="28" height="32" alt="" /><span><small>להורדה ב־</small><strong>Google Play</strong></span></a></div>;
}

export default function Marketing() {
  const location = useLocation();
  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [plate, setPlate] = useState('');
  const plateInput = useRef(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [screen, setScreen] = useState(0);
  const dialog = useRef(null);
  const checkPage = pathname === '/website/vehicle-check';
  const businessPage = pathname === '/website/business';
  const article = guides.find(item => pathname === `/website/guides/${item.slug}`);
  const product = productPages.find(item => pathname === `/website/${item.slug}`);
  const home = !checkPage && !businessPage && !article && !product;

  useEffect(() => {
    const restoreSeo = applyMarketingSeo(pathname);
    setMenu(false);
    const scrollFrame = requestAnimationFrame(() => {
      if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
      else window.scrollTo(0, 0);
    });
    return () => {
      cancelAnimationFrame(scrollFrame);
      restoreSeo();
    };
  }, [pathname, article, product, checkPage, businessPage, location.hash]);

  async function startCheck(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const { validateQuickCheckPlate } = await import('@/services/vehicleQuickCheck');
      const validation = validateQuickCheckPlate(plate);
      if (!validation.ok) { setError(validation.message); plateInput.current?.focus(); marketingEvent('check_validation_error', 'home'); return; }
      // Router state keeps the plate out of URLs and referrer/analytics logs.
      marketingEvent('check_submit', 'home');
      navigate('/website/vehicle-check', { state: { marketingPlate: validation.plate } });
    } catch { setError('לא הצלחנו לפתוח את הבדיקה. נסו שוב.'); }
    finally { setSubmitting(false); }
  }

  const BusinessHeading = businessPage ? 'h1' : 'h2';
  const business = <section id="business" className="cm-business"><div className="cm-wrap cm-business-grid"><div><span className="cm-kicker">Car Reminder לעסקים</span><BusinessHeading>ניהול רכבים ונהגים<br /><em>לצוות שלכם.</em></BusinessHeading><p>מרכזים את רכבי העסק, מקצים משימות לנהגים ועוקבים אחרי הוצאות. לכל חבר צוות ניתנת גישה בהתאם לתפקידו.</p><Link className="cm-button cm-gold" to={businessPage ? '/Contact' : '/website/business'}>{businessPage ? 'לפנייה בנושא חשבון עסקי' : 'מכירים את הפתרון לעסקים'} <ArrowLeft size={18} /></Link><small>פתיחת חשבון עסקי כפופה להגשת בקשה ואישור.</small></div><div className="cm-business-showcase"><MarketingBusinessPreview /><div className="cm-business-flow"><span className="cm-kicker">מה אפשר לנהל בחשבון העסקי</span>{[[BriefcaseBusiness, '01', 'מרכזים את הצי', 'רכבי העסק והמסמכים שלהם תחת סביבת עבודה משותפת.'], [Users, '02', 'מחברים את הצוות', 'נהגים, תפקידים ומשימות עם הרשאות מתאימות.'], [Wallet, '03', 'עוקבים אחרי הפעילות', 'הוצאות, דוחות ויומן פעילות כדי לחזור לפרטים.']].map(([Icon, number, title, text]) => <div key={number}><span className="cm-flow-icon"><Icon size={23} /></span><div><h3>{title}</h3><p>{text}</p></div><b>{number}</b></div>)}</div></div></div></section>;

  return <div className="cm-site" dir="rtl">
    <a className="cm-skip" href="#cm-main">דילוג לתוכן</a>
    <header className="cm-header"><div className="cm-wrap cm-nav"><Link to="/website" className="cm-brand"><img src={logo} width="44" height="44" alt="" /><span>Car Reminder<small>כל מה שחשוב, איתך בדרך</small></span></Link><button className="cm-menu-toggle" aria-label={menu ? 'סגירת תפריט' : 'פתיחת תפריט'} aria-expanded={menu} aria-controls="cm-navigation" onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button><nav id="cm-navigation" className={menu ? 'cm-menu is-open' : 'cm-menu'} aria-label="ניווט ראשי"><a href="/website#how" onClick={() => setMenu(false)}>איך זה עובד</a><a href="/website#check" onClick={() => setMenu(false)}>בדיקת רכב</a><Link to="/website/business">לעסקים</Link><a href="/website#guides">מדריכים</a><Link to="/Auth">כניסה לחשבון</Link></nav><a className="cm-button cm-header-cta" href="/website#download">להורדת האפליקציה <ArrowLeft size={16} /></a></div></header>
    <main id="cm-main">
      {home && <>
        <section className="cm-hero"><MarketingHeroBackground /><div className="cm-wrap cm-hero-grid"><div className="cm-hero-copy"><h1>תזכורות לרכב.<br /><em>מסמכים מסודרים.</em></h1><p className="cm-hero-lead">תזכורות לטסט, לביטוח ולטיפולים.<br />כל המועדים, המסמכים וההוצאות נשמרים לצד הרכב.</p><div className="cm-actions"><a href="#download" className="cm-button cm-gold">להורדת האפליקציה <ArrowLeft size={19} /></a><a href="#check" className="cm-text-link">קודם בודקים את הרכב <Search size={17} /></a></div></div><div className="cm-hero-visual"><div className="cm-orbit" /><MarketingPhone src="/marketing/dashboard.webp" alt="לוח הבקרה באפליקציה עם נתוני הדגמה" priority /><span className="cm-photo-note">מסך מהאפליקציה במסגרת להמחשה</span></div></div></section>
        <div className="cm-audiences cm-wrap"><a href="#features"><Car /> לרכב שלי <ArrowLeft size={16} /></a><a href="#vessels"><Ship /> לכלי השיט שלי <ArrowLeft size={16} /></a><Link to="/website/business"><BriefcaseBusiness /> לעסק שלי <ArrowLeft size={16} /></Link></div>
        <section id="check" className="cm-section cm-check-section"><div className="cm-wrap cm-check-grid"><div><span className="cm-kicker">בדיקת רכב לפי מספר רישוי</span><h2>מה ידוע על הרכב?<br /><em>בדקו לפי מספר הרישוי.</em></h2><p>הזינו מספר רישוי וקבלו את פרטי הרכב שנמצאו במקורות הזמינים. אפשר להוריד את הנתונים גם כקובץ PDF.</p><div className="cm-report-preview"><FileText size={25} /><div><strong>מה מחכה בדוח?</strong><span>פרטי זיהוי · שנת ייצור · מפרט זמין</span><small>המחשת מבנה בלבד. התוכן משתנה לפי הרכב; התובנות שעל המסך אינן כלולות ב־PDF.</small></div></div><div className="cm-inline-tags"><span><FileText size={17} /> דוח להורדה</span><span><ShieldCheck size={17} /> מקורות מידע ציבוריים</span></div></div><form className="cm-check-form cm-check-interactive" onSubmit={startCheck} noValidate aria-label="בדיקת רכב לפי מספר רישוי" aria-busy={submitting}>
          <div className="cm-check-form-heading"><span className="cm-check-badge"><Search size={15} /> בדיקה ישירות באתר</span><h3>איזה רכב בודקים?</h3><p>הקלידו את המספר בלוחית ולחצו לבדיקה.</p></div>
          <label htmlFor="cm-plate">מספר הרישוי <Pencil size={15} aria-hidden="true" /></label>
          <div className={`cm-plate${plate ? ' has-value' : ''}${error ? ' has-error' : ''}`}><span aria-hidden="true">IL</span><input ref={plateInput} id="cm-plate" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} value={plate} onChange={event => { setPlate(event.target.value.replace(/[^0-9-]/g, '').slice(0, 10)); setError(''); }} placeholder="הקלידו מספר" aria-invalid={!!error} aria-describedby={`cm-plate-hint cm-check-note${error ? ' cm-plate-error' : ''}`} /></div>
          <p id="cm-plate-hint" className="cm-input-hint">אפשר גם להדביק מספר, עם מקפים או בלעדיהם.</p>
          {error && <p id="cm-plate-error" role="alert" className="cm-error">{error}</p>}
          <button className="cm-button cm-check-submit" disabled={submitting} type="submit">{submitting ? 'פותחים את הבדיקה…' : plate ? 'בדקו את הרכב' : 'להתחלת הבדיקה'} <ArrowLeft size={19} /></button>
          <p id="cm-check-note" className="cm-check-access"><ShieldCheck size={16} /> הבדיקה הראשונה ללא הרשמה</p>
          <details className="cm-check-fineprint"><summary>מה חשוב לדעת לפני הבדיקה?</summary><p>לבדיקת רכב נוסף או לשמירה בחשבון יש להתחבר. המידע עשוי להיות חלקי או לא מעודכן ואינו מחליף בדיקה מקצועית.</p></details>
        </form></div></section>
        <section id="how" className="cm-section"><div className="cm-wrap"><div className="cm-section-heading"><span className="cm-kicker">מהבדיקה הראשונה לשגרה מסודרת</span><h2>איך מתחילים<br /><em>לנהל את הרכב?</em></h2></div><div className="cm-steps">{[['01', 'מוסיפים את הרכב', 'מרכזים את פרטי הכלי בחשבון שלכם.'], ['02', 'משלימים את מה שחשוב', 'מועדים, מסמכים והוצאות, כל אחד במקום שלו.'], ['03', 'רואים מה מגיע בהמשך', 'מגדירים תזכורות ובודקים שהרשאות ההתראה פעילות.']].map(([num, title, text]) => <div key={num}><span>{num}</span><h3>{title}</h3><p>{text}</p></div>)}</div></div></section>
        <section id="features" className="cm-section cm-product"><div className="cm-wrap cm-product-grid"><div><span className="cm-kicker">המסכים שתשתמשו בהם</span><h2>{screens[screen].title}</h2><p>{screens[screen].text}</p><div className="cm-screen-select" aria-label="בחירת תצוגה">{screens.map((item, index) => <button key={item.image} aria-pressed={screen === index} onClick={() => setScreen(index)}><item.icon size={19} /><span>{item.name}</span><ArrowLeft size={17} /></button>)}</div><div className="cm-product-links"><Link to="/website/reminders">על התזכורות</Link><Link to="/website/documents">מסמכים והוצאות</Link></div><div className="cm-benefits">{[[BellRing, 'מועדים ותזכורות'], [FileText, 'מסמכים זמינים'], [Wallet, 'מעקב הוצאות'], [Users, 'שיתוף והרשאות']].map(([Icon, text]) => <span key={text}><Icon size={19} />{text}</span>)}</div></div><div className="cm-product-screen cm-unified-screen"><button onClick={() => dialog.current?.showModal()} aria-label={`הגדלת מסך ${screens[screen].name}`}><MarketingPhone src={`/marketing/${screens[screen].image}.${screens[screen].extension || 'webp'}`} alt={`${screens[screen].name} באפליקציה, במסגרת להמחשה`} /></button><small>מסך מהאפליקציה במסגרת להמחשה · לחצו להגדלה</small></div></div></section>
        <section className="cm-section"><div className="cm-wrap cm-special-grid"><article id="vessels" className="cm-vessel"><Ship size={36} /><span className="cm-kicker">גם על המים</span><h2>גם לכלי השיט<br />יש מקום משלו.</h2><p>שמרו מסמכים, מועדים ושעות מנוע תחת כלי השיט המתאים.</p><Link to="/website/vessels" className="cm-text-link">לניהול כלי שיט <ArrowLeft size={18} /></Link></article><article className="cm-intelligence"><Sparkles size={32} /><span className="cm-kicker">פחות עבודה ידנית</span><h2>סריקת מסמכים<br />ועזרה בשאלות על הרכב</h2><p>סריקת מסמכים ועוזר חכם כחלק מניהול הרכב. בודקים את הפרטים שמתקבלים ומאשרים לפני שממשיכים.</p><ol><li>מעלים מסמך</li><li>בודקים את הפרטים שחולצו</li><li>מאשרים ושומרים</li></ol><Link to="/Auth" className="cm-text-link">לכניסה למערכת <ArrowLeft size={18} /></Link></article></div></section>
        <section id="child-reminder" className="cm-section cm-child-reminder"><div className="cm-wrap cm-child-grid"><div><span className="cm-kicker">בפיתוח ובבדיקות · טרם פתוח לכל המשתמשים</span><h2>בסוף הנסיעה,<br /><em>זוכרים לבדוק מאחור.</em></h2><p>אנחנו עובדים על תזכורת לבדוק שכל הילדים יצאו מהרכב. היא מיועדת לפעול בטלפון בעקבות ניתוק מחיבור ה־Bluetooth של הרכב, לפי ההגדרות שבחרתם.</p><p className="cm-child-note">זו תזכורת בלבד: אין זיהוי של תינוק או ילד ברכב, והיא אינה מחליפה בדיקה שלכם. הפעולה תלויה בהרשאות, בחיבור ובהגדרות הטלפון.</p></div><details className="cm-child-steps"><summary>איך התזכורת אמורה לעבוד?</summary><ol><li><strong>בוחרים את הרכב</strong><p>מסמנים את חיבור ה־Bluetooth של הרכב ומאפשרים את ההרשאות הנדרשות.</p></li><li><strong>מגדירים מתי להזכיר</strong><p>בוחרים ימים ושעות ומפעילים את התזכורת בחשבון האישי.</p></li><li><strong>מקבלים תזכורת בסיום</strong><p>לאחר נסיעה שעומדת בתנאי ההגדרה, הניתוק מהרכב מפעיל התראה לבדוק שכל הילדים יצאו.</p></li><li><strong>בודקים ומאשרים</strong><p>מאשרים בהתראה לאחר שבדקתם. בגרסה הנבדקת קיימת גם תזכורת חוזרת אם לא התקבל אישור.</p></li></ol><small>הפיתוח הנוכחי מיועד ל־Android. התמיכה ב־iPhone עדיין אינה זמינה.</small></details></div></section>
        <section className="cm-section cm-specialties"><div className="cm-wrap"><span className="cm-kicker">לכל כלי יש דרך עבודה משלו</span><h2>לא רק רכב פרטי</h2><div className="cm-specialties-grid">{categoryCards.map(card => <Link key={card.slug} to={card.href}><div className="cm-category-art"><img src={card.image} alt="" loading="lazy" width="1672" height="941" /></div><h3>{card.title}</h3><p>{card.text}</p><span>לפרטים <ArrowLeft size={17} /></span></Link>)}</div></div></section>
        {business}
        <section id="guides" className="cm-section"><div className="cm-wrap"><span className="cm-kicker">ידע שימושי, גם בין נסיעות</span><h2>מדריכים לניהול<br /><em>הרכב וכלי השיט</em></h2><div className="cm-guides">{guides.filter(item => featuredGuideSlugs.includes(item.slug)).map(item => <Link to={`/website/guides/${item.slug}`} key={item.slug}><FileText size={26} /><h3>{item.title}</h3><p>{item.text}</p><span>למדריך <ArrowLeft size={17} /></span></Link>)}</div><details className="cm-more-guides"><summary>לכל המדריכים</summary><div className="cm-guide-index">{guides.filter(item => !featuredGuideSlugs.includes(item.slug)).map(item => <Link key={item.slug} to={`/website/guides/${item.slug}`}>{item.title}<ArrowLeft size={17} /></Link>)}</div></details></div></section>
        <section className="cm-section cm-faq"><div className="cm-wrap cm-faq-grid"><div><span className="cm-kicker">לפני שמתחילים</span><h2>שאלות נפוצות</h2><p>משהו נוסף שחשוב לכם לדעת?</p><Link to="/Contact" className="cm-text-link">אנחנו כאן <ArrowLeft size={17} /></Link></div><div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></div></section>
      </>}
      {checkPage && <section className="cm-report"><div className="cm-wrap"><Link className="cm-text-link" to="/website#check">חזרה לאתר <ArrowLeft size={17} /></Link></div><Suspense fallback={<p className="cm-loading" role="status">טוענים את בדיקת הרכב…</p>}><VehicleCheck marketingPlate={location.state?.marketingPlate} /></Suspense></section>}
      {businessPage && <>{business}<section className="cm-section"><div className="cm-wrap cm-business-details"><h2>הרכבים והצוות באותה מערכת</h2><p>מרכזים את הרכבים והמסמכים, מחברים נהגים ומשתמשים ומנהלים משימות לפי תפקיד. אפשר לעקוב אחרי הוצאות ופעילות ולהשתמש בכלי הייבוא והדוחות הקיימים במערכת.</p><div className="cm-business-feature-grid">{businessFeatures.map(([title, text]) => <section key={title}><h2>{title}</h2><p>{text}</p></section>)}</div><nav className="cm-related" aria-label="סוגי כלים לעסקים"><Link to="/website/trucks">ניהול משאיות</Link><Link to="/website/heavy-equipment">טרקטורים וכלי צמ״ה</Link><Link to="/website/offroad">כלי שטח</Link></nav><h3>איך מתחילים?</h3><p>מכירים את הצרכים של העסק, מגישים בקשה לפתיחת חשבון עסקי וממתינים לאישור. אם כבר יש לכם חשבון, אפשר להגיע לתהליך הבקשה מתוך המערכת.</p><Link className="cm-button" to="/Contact">פנייה בנושא התאמה לעסק <ArrowLeft size={18} /></Link></div></section></>}
      {article && <article className="cm-section cm-article cm-wrap"><Link className="cm-text-link" to="/website#guides">כל המדריכים <ArrowLeft size={17} /></Link><span className="cm-kicker">מדריך לשימוש מסודר</span><h1>{article.title}</h1><p className="cm-article-lead">{article.text}</p>{article.sections.map(([heading, paragraph]) => <section key={heading}><h2>{heading}</h2><p>{paragraph}</p></section>)}{article.sources && <aside className="cm-article-sources"><h2>מקורות והמשך קריאה</h2>{article.sources.map(item => <a href={item.url} key={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>)}</aside>}<p className="cm-article-related"><Link to={`/website/${article.related}`}>איך משתמשים בזה ב־Car Reminder?</Link></p><Link className="cm-button" to="/website#check">מתחילים מבדיקת הרכב <ArrowLeft size={17} /></Link></article>}
      {product && <MarketingProductPage product={product} />}
      {!checkPage && <section id="download" className="cm-download"><div className="cm-wrap cm-download-grid"><div><img src={logo} width="64" height="64" alt="" loading="lazy" /><span className="cm-kicker">הצעד הבא שלכם</span><h2>מתחילים עם<br /><em>הרכב שלכם.</em></h2><p className="cm-download-lead">המועדים, המסמכים והטיפולים שלכם, במקום שקל לחזור אליו.</p><StoreLinks /><Link className="cm-text-link" to="/Auth">מעדיפים דפדפן? לכניסה באתר <ArrowLeft size={17} /></Link></div><div className="cm-download-phone"><MarketingPhone src="/marketing/documents.webp" alt="מסמכי הרכב באפליקציה עם נתוני הדגמה" /><small>נתוני הדגמה</small></div></div></section>}
    </main>
    <footer className="cm-footer"><div className="cm-wrap"><Link className="cm-brand" to="/website"><img src={logo} width="35" height="35" alt="" />Car Reminder</Link><nav aria-label="מידע וקשר"><Link to="/Contact">יצירת קשר</Link><Link to="/PrivacyPolicy">פרטיות</Link><Link to="/TermsOfService">תנאי שימוש</Link><Link to="/Auth">כניסה לחשבון</Link></nav><span>כל מה שחשוב, איתך בדרך.</span></div></footer>
    <dialog ref={dialog} className="cm-lightbox" aria-label="צילום מסך מהאפליקציה"><button autoFocus onClick={() => dialog.current?.close()} aria-label="סגירת צילום המסך"><X /></button><MarketingPhone src={`/marketing/${screens[screen].image}.${screens[screen].extension || 'webp'}`} alt={`${screens[screen].name} באפליקציה, במסגרת להמחשה`} /></dialog>
  </div>;
}







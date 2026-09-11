import React, { lazy, Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BellRing, BriefcaseBusiness, Car, Database, FileText, Loader2, LockKeyhole, Menu, Pencil, ShieldCheck, Ship, Smartphone, Sparkles, Trash2, Users, Wallet, X } from 'lucide-react';
import { guides, productPages } from '@/lib/marketingContent';
import { businessFeatures, specialtyPages } from '@/lib/marketingSpecialties';
import MarketingProductPage from '@/components/MarketingProductPage';
import MarketingHeroBackground from '@/components/MarketingHeroBackground';
import MarketingPhone from '@/components/MarketingPhone';
import MarketingReviewsPhone from '@/components/MarketingReviewsPhone';
import MarketingBusinessPreview from '@/components/MarketingBusinessPreview';
import MarketingChildReminderPage from '@/components/MarketingChildReminderPage';
const logo = '/marketing/logo.webp';
import './Marketing.css';
import { applyMarketingSeo } from '@/lib/marketingSeo';
import { marketingEvent } from '@/lib/marketingEvents';
import { DEMO_HOME_ID } from '@/lib/demoScreens';
import { onDemoMessage, DEMO_MSG_SCREEN } from '@/lib/demoBridge';
import MarketingDemoEmbed from '@/components/MarketingDemoEmbed';

const VehicleCheck = lazy(() => import('./VehicleCheck'));
/**
 * The selector's five items, keyed by the screen IDs in lib/demoScreens.
 *
 * `מצא מוסך` and `שאלות על הרכב` used to be here and were removed once the
 * selector started driving a live app instead of swapping pictures: FindGarage
 * asks for geolocation, queries Overpass through the shared proxy and sweeps
 * the visitor's cache keys, all on mount, and the AI surface has no demo gate
 * and costs money per question. Both keep their own sections on this page.
 *
 * `image` is only ever seen in the degraded states (loading, failed, offline,
 * dismissed); when the frame is live the real screen is showing.
 *   - vessels reuses vehicles.webp honestly: the vessel screen IS the vehicle
 *     list, filtered.
 *   - detail has no accurate asset. A VehicleDetail screenshot is OWED; until
 *     then the vehicle list stands in, which is a mismatch a visitor can only
 *     ever hit with a dead frame.
 */
const screens = [
  { id: 'dashboard', name: 'מה מתקרב', title: 'המועדים הקרובים, במסך הראשון', text: 'הכלים ומה שמתקרב לכל אחד מהם, מרוכזים במסך שנפתח ראשון. טיפול, טסט או ביטוח, לפי מה שקרוב.', image: 'dashboard', icon: BellRing },
  { id: 'vehicles', name: 'הרכבים שלי', title: 'כל הכלים ברשימה אחת', text: 'רשימת הכלים עם המצב של כל אחד. אפשר לפתוח כלי ולראות את הפרטים שלו.', image: 'vehicles', icon: Car },
  { id: 'detail', name: 'כרטיס רכב', title: 'כל מה שידוע על כלי אחד', text: 'שנת ייצור, קילומטראז׳, מועדים, מסמכים והיסטוריית טיפולים, בכרטיס אחד לכל כלי.', image: 'vehicles', icon: FileText },
  { id: 'documents', name: 'המסמכים שלי', title: 'רישיון, ביטוח וקבלות', text: 'כל מסמך שמור לצד הכלי שאליו הוא שייך, עם תאריך התוקף שלו.', image: 'documents', icon: FileText },
  { id: 'vessels', name: 'כלי שיט', title: 'גם מה שלא נוסע על כביש', text: 'סירה או אופנוע ים מנוהלים כמו כל כלי אחר, עם שעות מנוע במקום קילומטרים.', image: 'vehicles', icon: Ship },
];
const OFF_LIST_COPY = {
  title: 'אתם מנווטים באפליקציה בעצמכם',
  text: 'המסך שפתוח כרגע אינו אחד מהחמישה שברשימה. אפשר להמשיך, או לבחור מהרשימה כדי לחזור להסבר.',
};
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
  const dialog = useRef(null);
  const selectRef = useRef(null);

  /**
   * Selector state. Three pieces, because the mark means exactly one thing:
   * "this is what the device is showing now".
   *
   *   selectedId  what the visitor last chose. Drives the copy and the
   *               screenshot whenever the frame is NOT live, which is also
   *               the whole of the old behaviour.
   *   deviceId    what the frame reports it is showing. null means the
   *               visitor navigated somewhere off the list of five.
   *   requestedId a screen asked for but not yet confirmed by the frame.
   *               Non-null IS the pending state.
   */
  const [selectedId, setSelectedId] = useState(DEMO_HOME_ID);
  const [deviceId, setDeviceId] = useState(null);
  const [requestedId, setRequestedId] = useState(null);
  const [demoStatus, setDemoStatus] = useState('resting');

  const demoLive = demoStatus === 'live';
  // `loading` counts: a click then has somewhere to land once the frame boots.
  const demoCanDrive = demoLive || demoStatus === 'loading';
  const markedId = demoLive ? deviceId : selectedId;
  const pendingId = demoCanDrive ? requestedId : null;
  // Pending wins over the device, so the copy describes where you are going
  // rather than the screen you are leaving.
  const copyId = pendingId || (demoLive ? deviceId : selectedId);
  const activeScreen = screens.find(s => s.id === copyId) || screens[0];
  const offList = demoLive && !deviceId && !pendingId;

  const onDemoStatus = useCallback(status => setDemoStatus(status), []);

  // No effect keeps the marked chip in view any more, and that absence is the
  // point. The mobile chips WRAP instead of scrolling horizontally, so every
  // one of the five is always on screen and there is nothing to scroll to.
  // The scrolling version needed such an effect, and it was removed with the
  // strip: scrollLeft could not be moved on that RTL snap container at all,
  // and the effect fought the vertical scroll that brings the device into
  // view, cancelling it out exactly. See the note in Marketing.css.

  // The frame reporting in is the reverse direction of the sync. Clearing
  // `requestedId` on a match is what ends the pending state; without it, a
  // later in-frame navigation would look pending again forever.
  useEffect(() => onDemoMessage(DEMO_MSG_SCREEN, screenId => {
    setDeviceId(screenId);
    if (screenId) setSelectedId(screenId);
    setRequestedId(current => (current === screenId ? null : current));
  }), []);

  const pickScreen = useCallback(id => {
    setSelectedId(id);
    // Already there: no request, and drop anything still in flight. Without
    // the first half this asked the frame to navigate to the screen it was
    // already on, which is not a location change and so produced no
    // confirmation; the item sat pending forever. The bridge now answers
    // every request too, so this is the cheap half of a two-sided fix.
    if (demoCanDrive) setRequestedId(id === deviceId ? null : id);
    marketingEvent('demo_screen', 'home');
    // On mobile the selector sits ABOVE the device, so without this the tap
    // changes something below the fold and reads as a dead click.
    //
    // Queried rather than held in a ref. The ref was forwarded down to the
    // embed and read back null here every single time, while the very same
    // node scrolled 1788px when the identical call was made by hand, so the
    // plumbing was the fault and not the scroll. There is exactly one of
    // these on the page.
    // `behavior: 'auto'`, and it is not a preference. Smooth was written
    // first and measured moving the page exactly 0px, while the identical
    // call with 'auto' on the same node moved it 2738px: smooth scrolling
    // does not work on this page, most likely because the scroll crosses
    // .cm-site's overflow-x:clip. Instant is also the better behaviour here,
    // since the visitor just tapped and wants the result now, so there is no
    // reduced-motion branch to make: this is already the reduced-motion path.
    if (window.innerWidth <= 900) {
      document.querySelector('.cm-demo-host')?.scrollIntoView({
        block: 'nearest',
        behavior: 'auto',
      });
    }
  }, [demoCanDrive, deviceId]);

  const checkPage = pathname === '/website/vehicle-check';
  const businessPage = pathname === '/website/business';
  const article = guides.find(item => pathname === `/website/guides/${item.slug}`);
  const product = productPages.find(item => pathname === `/website/${item.slug}`);
  const childReminderPage = product?.slug === 'child-in-car-reminder';
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
  const business = <section id="business" className="cm-business"><div className="cm-wrap cm-business-grid"><div><span className="cm-kicker">Car Reminder לעסקים</span><BusinessHeading>ניהול רכבים ונהגים{' '}<br /><em>לצוות שלכם.</em></BusinessHeading><p>מרכזים את רכבי העסק, מקצים משימות לנהגים ועוקבים אחרי הוצאות. לכל חבר צוות ניתנת גישה בהתאם לתפקידו.</p><Link className="cm-button cm-gold" to={businessPage ? '/Contact' : '/website/business'}>{businessPage ? 'לפנייה בנושא חשבון עסקי' : 'מכירים את הפתרון לעסקים'} <ArrowLeft size={18} /></Link><small>פתיחת חשבון עסקי כפופה להגשת בקשה ואישור.</small></div><div className="cm-business-showcase"><MarketingBusinessPreview /><div className="cm-business-flow"><span className="cm-kicker">מה אפשר לנהל בחשבון העסקי</span>{[[BriefcaseBusiness, '01', 'מרכזים את הצי', 'רכבי העסק והמסמכים שלהם תחת סביבת עבודה משותפת.'], [Users, '02', 'מחברים את הצוות', 'נהגים, תפקידים ומשימות עם הרשאות מתאימות.'], [Wallet, '03', 'עוקבים אחרי הפעילות', 'הוצאות, דוחות ויומן פעילות כדי לחזור לפרטים.']].map(([Icon, number, title, text]) => <div key={number}><span className="cm-flow-icon"><Icon size={23} /></span><div><h3>{title}</h3><p>{text}</p></div><b>{number}</b></div>)}</div></div></div></section>;

  return <div className="cm-site" dir="rtl">
    <a className="cm-skip" href="#cm-main">דילוג לתוכן</a>
    <header className="cm-header"><div className="cm-wrap cm-nav"><Link to="/website" className="cm-brand"><img src={logo} width="44" height="44" alt="" /><span>Car Reminder<small>כל מה שחשוב לכלי התחבורה שלך</small></span></Link><button className="cm-menu-toggle" aria-label={menu ? 'סגירת תפריט' : 'פתיחת תפריט'} aria-expanded={menu} aria-controls="cm-navigation" onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button><nav id="cm-navigation" className={menu ? 'cm-menu is-open' : 'cm-menu'} aria-label="ניווט ראשי"><a href="/website#how" onClick={() => setMenu(false)}>איך זה עובד</a><a href="/website#check" onClick={() => setMenu(false)}>בדיקת רכב</a><a href="/website#trust" onClick={() => setMenu(false)}>אמינות ופרטיות</a><Link to="/website/business">לעסקים</Link><a href="/website#guides">מדריכים</a><Link to="/Auth">כניסה לחשבון</Link></nav><a className="cm-button cm-header-cta" href="/website#download">להורדת האפליקציה <ArrowLeft size={16} /></a></div></header>
    <main id="cm-main">
      {home && <>
        <section className="cm-hero"><MarketingHeroBackground /><div className="cm-wrap cm-hero-grid"><div className="cm-hero-copy"><span className="cm-kicker">הרכב, האופנוע וכלי השיט שלכם</span><h1>הטסט, הביטוח והטיפול הבא.{' '}<br /><em>הכול במקום אחד.</em></h1><p className="cm-hero-lead">Car Reminder מרכזת מועדים, מסמכים והוצאות ומזכירה לכם לפני שמגיע הזמן.</p><div className="cm-actions"><a href="#download" className="cm-button cm-gold">מורידים את Car Reminder <ArrowLeft size={19} /></a></div></div><div className="cm-hero-visual"><div className="cm-orbit" /><MarketingPhone src="/marketing/dashboard.webp" alt="לוח הבקרה באפליקציה עם נתוני הדגמה" priority /><span className="cm-photo-note">מסך מהאפליקציה במסגרת להמחשה</span></div></div></section>
        <div className="cm-audiences cm-wrap"><a href="#features"><Car /> לרכב שלי <ArrowLeft size={16} /></a><a href="#vessels"><Ship /> לכלי השיט שלי <ArrowLeft size={16} /></a><Link to="/website/business"><BriefcaseBusiness /> לעסק שלי <ArrowLeft size={16} /></Link></div>
        <section id="check" className="cm-section cm-check-section"><div className="cm-wrap cm-check-grid"><div><span className="cm-kicker">בדיקה ראשונה בלי הרשמה</span><h2>בדיקת רכב לפי מספר רישוי{' '}<br /><em>ממקורות משרד התחבורה.</em></h2><p>הזינו מספר רישוי וראו את פרטי הזיהוי, שנת הייצור והמפרט שנמצאו במקורות הציבוריים הזמינים. אפשר להוריד את התוצאה גם כקובץ PDF.</p><div className="cm-report-preview"><FileText size={25} /><div><strong>מה מחכה בדוח?</strong><span>פרטי זיהוי · שנת ייצור · מפרט זמין</span><small>אנחנו מציגים רק את המידע שנמצא. התוכן משתנה בין כלי לכלי ואינו מחליף בדיקה מקצועית.</small></div></div><div className="cm-inline-tags"><span><FileText size={17} /> דוח להורדה</span><span><ShieldCheck size={17} /> מקור המידע מוצג בשקיפות</span></div></div><form className="cm-check-form cm-check-interactive" onSubmit={startCheck} noValidate aria-label="בדיקת רכב לפי מספר רישוי" aria-busy={submitting}>
          <div className="cm-check-form-heading"><p>הקלידו את המספר בלוחית ולחצו לבדיקה.</p></div>
          <label htmlFor="cm-plate">מספר הרישוי <Pencil size={15} aria-hidden="true" /></label>
          <div className={`cm-plate${plate ? ' has-value' : ''}${error ? ' has-error' : ''}`}><span aria-hidden="true">IL</span><input ref={plateInput} id="cm-plate" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} value={plate} onChange={event => { setPlate(event.target.value.replace(/[^0-9-]/g, '').slice(0, 10)); setError(''); }} placeholder="הקלידו מספר" aria-invalid={!!error} aria-describedby={`cm-plate-hint cm-check-note${error ? ' cm-plate-error' : ''}`} /></div>
          <p id="cm-plate-hint" className="cm-input-hint">אפשר גם להדביק מספר, עם מקפים או בלעדיהם.</p>
          {error && <p id="cm-plate-error" role="alert" className="cm-error">{error}</p>}
          <button className="cm-button cm-check-submit" disabled={submitting} type="submit">{submitting ? 'פותחים את הבדיקה…' : plate ? 'בדקו את הרכב' : 'להתחלת הבדיקה'} <ArrowLeft size={19} /></button>
          <p id="cm-check-note" className="cm-check-access"><ShieldCheck size={16} /> הבדיקה הראשונה ללא הרשמה</p>
          <details className="cm-check-fineprint"><summary>מה חשוב לדעת לפני הבדיקה?</summary><p>לבדיקת רכב נוסף או לשמירה בחשבון יש להתחבר. המידע עשוי להיות חלקי או לא מעודכן ואינו מחליף בדיקה מקצועית.</p></details>
        </form></div></section>
        <section id="trust" className="cm-section cm-trust"><div className="cm-wrap"><div className="cm-trust-heading"><span className="cm-kicker">אמינות ופרטיות</span><h2>האמינות מתחילה במה{' '}<br /><em>שהמשתמשים אומרים.</em></h2></div><div className="cm-trust-proof"><div className="cm-trust-reviews"><MarketingReviewsPhone /><small><Smartphone size={15} /> כל חוות הדעת שמופיעות במערכת</small></div></div><div className="cm-security-panel"><div className="cm-security-copy"><span className="cm-kicker">אבטחת מידע</span><h3>שכבות הגנה שאפשר להבין.</h3><p>המידע בחשבון מאוחסן ב־Supabase עם הצפנה ומוגן ברמת כל רשומה. במצב אורח פרטי הכלים נשמרים במכשיר, ואפשר למחוק את החשבון והמידע מתוך המערכת.</p><Link to="/PrivacyPolicy" className="cm-text-link">איך אנחנו שומרים ומשתפים מידע <ArrowLeft size={17} /></Link></div><div className="cm-security-map" aria-label="אמצעי הגנה ופרטיות"><div className="cm-security-rings" aria-hidden="true" /><span className="cm-security-core"><ShieldCheck /><strong>המידע שלכם</strong></span>{[[LockKeyhole, 'אחסון מוצפן'], [Database, 'הגנה ברמת הרשומה'], [Smartphone, 'מידע אורח במכשיר'], [Users, 'הרשאות לצוות'], [Trash2, 'מחיקת חשבון'], [Sparkles, 'שימוש ב־AI בשקיפות']].map(([Icon, label], index) => <span key={label} className={`cm-security-chip cm-security-chip-${index + 1}`}><Icon />{label}</span>)}</div></div></div></section>
        <section id="how" className="cm-section"><div className="cm-wrap"><div className="cm-section-heading"><h2>שלושה צעדים,{' '}<br /><em>ופחות דברים לזכור לבד.</em></h2></div><div className="cm-steps">{[['01', 'מוסיפים כלי פעם אחת', 'רכב, אופנוע או כלי שיט. הפרטים נשמרים בתיק של הכלי.'], ['02', 'מרכזים תוקפים ומסמכים', 'טסט, ביטוח, טיפולים, קבלות והוצאות נשארים במקום שקל למצוא.'], ['03', 'מקבלים תזכורת לפני המועד', 'מגדירים מתי להזכיר ומוודאים שההתראות פעילות במכשיר.']].map(([num, title, text]) => <div key={num}><span>{num}</span><h3>{title}</h3><p>{text}</p></div>)}</div></div></section>
        <section id="features" className="cm-section cm-product"><div className="cm-wrap cm-product-grid"><div><span className="cm-kicker">תנסו את האפליקציה כאן</span><h2>{offList ? OFF_LIST_COPY.title : activeScreen.title}</h2><p>{offList ? OFF_LIST_COPY.text : activeScreen.text}</p><div ref={selectRef} className="cm-screen-select" role="group" aria-label="בחירת מסך להדגמה">{screens.map(item => { const isMarked = markedId === item.id; const isPending = pendingId === item.id; return <button key={item.id} type="button" aria-pressed={isMarked} data-state={isPending ? 'pending' : isMarked ? 'marked' : 'plain'} onClick={() => pickScreen(item.id)}><item.icon size={19} /><span>{item.name}</span><i className="cm-screen-slot" aria-hidden="true">{isPending ? <Loader2 size={16} className="cm-screen-spin" /> : <ArrowLeft size={17} />}</i></button>; })}</div><p className="cm-sr-live" role="status" aria-live="polite">{pendingId ? 'טוענים את המסך…' : ''}</p><div className="cm-product-links"><Link to="/website/reminders">על התזכורות</Link><Link to="/website/documents">מסמכים והוצאות</Link></div><div className="cm-benefits">{[[BellRing, 'מועדים ותזכורות'], [FileText, 'מסמכים זמינים'], [Wallet, 'מעקב הוצאות'], [Users, 'שיתוף והרשאות']].map(([Icon, text]) => <span key={text}><Icon size={19} />{text}</span>)}</div></div><MarketingDemoEmbed gotoScreen={requestedId} onStatusChange={onDemoStatus} src={`/marketing/${activeScreen.image}.${activeScreen.extension || 'webp'}`} alt={`${activeScreen.name} באפליקציה, במסגרת להמחשה`} screenName={activeScreen.name} onEnlarge={() => dialog.current?.showModal()} /></div></section>
        <section className="cm-section"><div className="cm-wrap cm-special-grid"><article id="vessels" className="cm-vessel"><Ship size={36} /><span className="cm-kicker">גם על המים</span><h2>ניהול כלי שיט{' '}<br />עם כושר שיט וציוד בטיחות.</h2><p>שמרו מסמכים, מועדים ושעות מנוע תחת כלי השיט המתאים.</p><Link to="/website/vessels" className="cm-text-link">לניהול כלי שיט <ArrowLeft size={18} /></Link></article><article className="cm-intelligence"><Sparkles size={32} /><span className="cm-kicker">פחות עבודה ידנית</span><h2>סריקת מסמכים בעזרת AI{' '}<br />הפרטים נכנסים לבד, אתם מאשרים.</h2><p>סריקת מסמכים ועוזר חכם כחלק מניהול הרכב. בודקים את הפרטים שמתקבלים ומאשרים לפני שממשיכים.</p><ol><li>מעלים מסמך</li><li>בודקים את הפרטים שחולצו</li><li>מאשרים ושומרים</li></ol><Link to="/Auth" className="cm-text-link">לכניסה למערכת <ArrowLeft size={18} /></Link></article></div></section>
        <section id="child-reminder" className="cm-section cm-child-reminder"><div className="cm-wrap cm-child-home-grid"><div className="cm-child-home-copy"><span className="cm-kicker">פיצ׳ר חינמי ב-Car Reminder</span><h2>בסוף הנסיעה,{' '}<br /><em>תזכורת לבדוק מאחור.</em></h2><p>בוחרים את חיבור ה־Bluetooth של הרכב. כשהטלפון מתנתק בסיום הנסיעה, Car Reminder שולחת תזכורת לבדוק שכל הילדים יצאו.</p><Link className="cm-button cm-gold" to="/website/child-in-car-reminder">איך מפעילים את התזכורת <ArrowLeft size={18} /></Link><p className="cm-child-note"><ShieldCheck size={17} /> התזכורת אינה מזהה ילד ברכב ואינה מחליפה בדיקה ידנית.</p></div><Link to="/website/child-in-car-reminder" className="cm-child-home-photo" aria-label="למידע על תזכורת לבדוק ילדים ברכב"><img src="/marketing/child-seat-reminder.webp" alt="כיסא בטיחות ריק המותקן במושב האחורי של רכב" width="1536" height="1024" loading="lazy" /><span><BellRing size={19} /><strong>תזכורת בסיום הנסיעה</strong><small>זמין ב-iPhone וב-Android</small></span></Link></div></section>
        <section className="cm-section cm-specialties"><div className="cm-wrap"><span className="cm-kicker">לכל כלי יש דרך עבודה משלו</span><h2>ניהול אופנועים, משאיות וכלי צמ״ה{' '}<br />לא רק רכב פרטי.</h2><p className="cm-specialties-list">רכב פרטי ומסחרי, אופנועים וקטנועים, אנדורו ומוטוקרוס, טרקטורונים ורכבי שטח, משאיות ורכבי עבודה, אוטובוסים ומיניבוסים, טרקטורים וכלי צמ״ה, מחפרים, שופלים, מלגזות, מכבשים ומנופים, רכבי אספנות, נגררים וקראוונים, וכלי שיט: אופנועי ים, סירות מנוע, סירות גומי ומפרשיות.</p><div className="cm-specialties-grid">{categoryCards.map(card => <Link key={card.slug} to={card.href}><div className="cm-category-art"><img src={card.image} alt="" loading="lazy" width="1672" height="941" /></div><h3>{card.title}</h3><p>{card.text}</p><span>לפרטים <ArrowLeft size={17} /></span></Link>)}</div></div></section>
        {business}
        <section id="guides" className="cm-section"><div className="cm-wrap"><span className="cm-kicker">ידע שימושי, גם בין נסיעות</span><h2>מדריכים לניהול רכב{' '}<br /><em>וכלי שיט.</em></h2><div className="cm-guides">{guides.filter(item => featuredGuideSlugs.includes(item.slug)).map(item => <Link to={`/website/guides/${item.slug}`} key={item.slug}><FileText size={26} /><h3>{item.heading || item.title}</h3><p>{item.text}</p><span>למדריך <ArrowLeft size={17} /></span></Link>)}</div><details className="cm-more-guides"><summary>לכל המדריכים</summary><div className="cm-guide-index">{guides.filter(item => !featuredGuideSlugs.includes(item.slug)).map(item => <Link key={item.slug} to={`/website/guides/${item.slug}`}>{item.heading || item.title}<ArrowLeft size={17} /></Link>)}</div></details></div></section>
        <section className="cm-section cm-faq"><div className="cm-wrap cm-faq-grid"><div><span className="cm-kicker">לפני שמתחילים</span><h2>שאלות נפוצות</h2><p>משהו נוסף שחשוב לכם לדעת?</p><Link to="/Contact" className="cm-text-link">אנחנו כאן <ArrowLeft size={17} /></Link></div><div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></div></section>
      </>}
      {checkPage && <section className="cm-report"><div className="cm-wrap"><Link className="cm-text-link" to="/website#check">חזרה לאתר <ArrowLeft size={17} /></Link></div><Suspense fallback={<p className="cm-loading" role="status">טוענים את בדיקת הרכב…</p>}><VehicleCheck marketingPlate={location.state?.marketingPlate} /></Suspense></section>}
      {businessPage && <>{business}<section className="cm-section"><div className="cm-wrap cm-business-details"><h2>הרכבים והצוות באותה מערכת</h2><p>מרכזים את הרכבים והמסמכים, מחברים נהגים ומשתמשים ומנהלים משימות לפי תפקיד. אפשר לעקוב אחרי הוצאות ופעילות ולהשתמש בכלי הייבוא והדוחות הקיימים במערכת.</p><div className="cm-business-feature-grid">{businessFeatures.map(([title, text]) => <section key={title}><h2>{title}</h2><p>{text}</p></section>)}</div><nav className="cm-related" aria-label="סוגי כלים לעסקים"><Link to="/website/trucks">ניהול משאיות</Link><Link to="/website/heavy-equipment">טרקטורים וכלי צמ״ה</Link><Link to="/website/offroad">כלי שטח</Link></nav><h3>איך מתחילים?</h3><p>מכירים את הצרכים של העסק, מגישים בקשה לפתיחת חשבון עסקי וממתינים לאישור. אם כבר יש לכם חשבון, אפשר להגיע לתהליך הבקשה מתוך המערכת.</p><Link className="cm-button" to="/Contact">פנייה בנושא התאמה לעסק <ArrowLeft size={18} /></Link></div></section></>}
      {article && <article className="cm-section cm-article cm-wrap"><Link className="cm-text-link" to="/website#guides">כל המדריכים <ArrowLeft size={17} /></Link><span className="cm-kicker">מדריך לשימוש מסודר</span><h1>{article.heading || article.title}</h1><p className="cm-article-lead">{article.text}</p>{article.sections.map(([heading, paragraph]) => <section key={heading}><h2>{heading}</h2><p>{paragraph}</p></section>)}{article.sources && <aside className="cm-article-sources"><h2>מקורות והמשך קריאה</h2>{article.sources.map(item => <a href={item.url} key={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>)}</aside>}<p className="cm-article-related"><Link to={`/website/${article.related}`}>איך משתמשים בזה ב־Car Reminder?</Link></p><Link className="cm-button" to="/website#check">מתחילים מבדיקת הרכב <ArrowLeft size={17} /></Link></article>}
      {childReminderPage && <MarketingChildReminderPage />}
      {product && !childReminderPage && <MarketingProductPage product={product} />}
      {!checkPage && !childReminderPage && <section id="download" className="cm-download"><div className="cm-wrap cm-download-simple"><span className="cm-kicker">הצעד הבא שלכם</span><h2>הרכב הראשון שלכם{' '}<br /><em>יכול להיות מסודר כבר היום.</em></h2><p className="cm-download-lead">מורידים את Car Reminder, מוסיפים כלי ומרכזים את המועד הבא במקום אחד.</p><StoreLinks /><Link className="cm-text-link" to="/Auth">מעדיפים דפדפן? לכניסה באתר <ArrowLeft size={17} /></Link></div></section>}
    </main>
    <footer className="cm-footer"><div className="cm-wrap"><Link className="cm-brand" to="/website"><img src={logo} width="35" height="35" alt="" />Car Reminder</Link><nav aria-label="מידע וקשר"><Link to="/Contact">יצירת קשר</Link><Link to="/PrivacyPolicy">מדיניות פרטיות</Link><Link to="/TermsOfService">תנאי שימוש</Link><Link to="/Auth">כניסה לחשבון</Link></nav><span>תזכורות, מסמכים ותחזוקה לכל כלי תחבורה.</span></div></footer>
    <dialog ref={dialog} className="cm-lightbox" aria-label="צילום מסך מהאפליקציה"><button autoFocus onClick={() => dialog.current?.close()} aria-label="סגירת צילום המסך"><X /></button><MarketingPhone src={`/marketing/${activeScreen.image}.${activeScreen.extension || 'webp'}`} alt={`${activeScreen.name} באפליקציה, במסגרת להמחשה`} /></dialog>
  </div>;
}







import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowUpRight, Bell, Car, Check, ChevronLeft, ChevronDown, FileText, Gauge, Home, Menu, MessageCircle, Plus, Search, ShieldCheck, Smartphone, Monitor, X, MapPin, Phone, Clock, Camera, AlertTriangle, Sparkles, Ship, Wallet, FileSignature, Users, Settings, Star, UserRound, Briefcase, LogOut } from 'lucide-react';
import IsraeliPlateBadge from '../components/shared/IsraeliPlateBadge';
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/600.css';
import '@fontsource/rubik/700.css';
import './home-mockup.css';

// Presentation-only entry point. No app providers, network services or storage.
const baseVehicles = [
  { id: 'car', name: 'הקורולה שלי', model: 'טויוטה קורולה', year: '2016', plate: '12-345-67', meter: 148200, unit: 'ק״מ', photo: '/demo-corolla.jpg', next: 'ביטוח הרכב', date: '15.09.2026', status: 'מתחדש בעוד 5 ימים', warning: true },
  { id: 'bike', name: 'לסוף השבוע', model: 'KTM EXC 350', year: '2023', plate: '87-654-32', meter: 126, unit: 'שעות מנוע', photo: '/marketing/hero-ktm.webp', next: 'טיפול תקופתי', date: 'בעוד 24 שעות מנוע', status: 'התוקפים מעודכנים' },
  { id: 'boat', name: 'הרוח שלנו', model: 'Beneteau Oceanis 38', year: '2020', plate: '48721', meter: 342, unit: 'שעות מנוע', photo: '/marketing/category-sailing-yacht.webp', next: 'כושר שייט', date: '22.10.2026', status: 'התוקפים מעודכנים' },
];
const initialVehicles = baseVehicles.map((v, i) => ({ ...v, testDate: ['01.08.2027', '12.06.2027', '22.10.2026'][i], insuranceDate: ['15.09.2026', '12.06.2027', '01.03.2027'][i] }));
const scenarios = { populated:'שלושה כלים', single:'רכב יחיד', empty:'חשבון חדש', missing:'תוקפים חסרים', expired:'תוקף שפג', loading:'טעינה', offline:'ללא חיבור', error:'שגיאת טעינה', long:'שם ארוך' };
function VehicleDates({ vehicle }) {
  return <div className="expiry-list">
    <div><span>{vehicle.id === 'boat' ? 'כושר שייט' : 'טסט'}</span><strong className={vehicle.expired ? 'expired-text' : ''}><bdi>{vehicle.testDate || 'לא הוזן'}</bdi>{vehicle.expired && <small>פג תוקף</small>}</strong></div>
    <div><span>{vehicle.id === 'boat' ? 'ביטוח ימי' : 'ביטוח'}</span><strong className={vehicle.warning ? 'warning-text' : ''}><bdi>{vehicle.insuranceDate || 'לא הוזן'}</bdi></strong></div>
    {vehicle.id === 'bike' && <div className="service-next"><span>טיפול הבא</span><strong>בעוד 24 ש׳ מנוע</strong></div>}
  </div>;
}
const events = [
  { day: '15', month: 'ספט׳', title: 'חידוש ביטוח', vehicle: 'הקורולה שלי', detail: 'בעוד 5 ימים', warning: true },
  { day: '22', month: 'אוק׳', title: 'חידוש כושר שייט', vehicle: 'הרוח שלנו', detail: 'בעוד 42 ימים' },
];
function formatIsraeliPlate(value) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length === 8) return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  if (digits.length === 7) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return digits;
}
const personalMenu = [
  { items: [[Home, 'דף הבית', 'home'], [Search, 'בדוק רכב', 'focus-check'], [Car, 'רכבים', 'focus-vehicles'], [Ship, 'כלי שייט', 'vessels']] },
  { title: 'תחזוקה', items: [[Wallet, 'מחשבון הוצאות', 'expenses'], [FileText, 'מסמכים', 'documents'], [FileSignature, 'טפסים', 'forms'], [AlertTriangle, 'תאונות', 'accidents'], [MapPin, 'מצא מוסך', 'garage']] },
  { title: 'קהילה', items: [[Users, 'קהילה וייעוץ', 'community'], [Sparkles, 'מומחה AI', 'expert']] },
  { title: 'חשבון', items: [[Settings, 'הגדרות', 'settings'], [Star, 'חוות דעת', 'reviews'], [MessageCircle, 'צור קשר', 'contact']] },
];
const secondaryPreviews = {
  expenses: ['מחשבון הוצאות', 'ריכוז הוצאות לפי כלי תחבורה ותקופה.'],
  forms: ['טפסים', 'הטפסים הקיימים באפליקציה נשארים נגישים מהתפריט.'],
  community: ['קהילה וייעוץ', 'שאלות ודיונים עם משתמשים נוספים.'],
  settings: ['הגדרות', 'הפרופיל, שיתוף כלי תחבורה והעדפות התראות, כולל תזכורת ילד ברכב.'],
  reviews: ['חוות דעת', 'צפייה בחוות דעת ושיתוף החוויה שלך.'],
  contact: ['צור קשר', 'פנייה לצוות Car Reminder.'],
  business: ['חשבון עסקי', 'הצטרפות לחשבון עסקי וניהול ההרשאות מתבצעים באפליקציה.'],
};
function App() {
  const [mode, setMode] = useState('mobile');
  const [view, setView] = useState('new');
  const [vehicles, setVehicles] = useState(initialVehicles);
  const [scenario, setScenario] = useState('populated');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('default');
  const [plate, setPlate] = useState('');
  const [plateError, setPlateError] = useState('');
  const [sheet, setSheet] = useState(null);
  const [notificationsRead, setNotificationsRead] = useState(false);
  const [drawerPosition, setDrawerPosition] = useState({});
  const [toast, setToast] = useState('');
  const unreadCount = !notificationsRead && vehicles.length > 0 ? 2 : 0;
  const dialog = useRef(null);
  const timeout = useRef(null);
  const scroll = useRef(null);
  const open = (type, data) => {
    if (type === 'menu') {
      const bounds = scroll.current.parentElement.getBoundingClientRect();
      setDrawerPosition({ top: Math.max(0, bounds.top), right: Math.max(0, window.innerWidth - bounds.right), width: bounds.width, height: Math.min(bounds.height, window.innerHeight - Math.max(0, bounds.top)) });
    }
    setSheet({ type, data }); dialog.current.showModal();
  };
  const close = () => dialog.current.close();
  const chooseScenario = (value) => {
    setScenario(value); setQuery(''); setSort('default');setToast('');clearTimeout(timeout.current);
    const examples = initialVehicles.map(v => ({...v}));
    if (value === 'missing') Object.assign(examples[0], {testDate:null,insuranceDate:null,warning:false,status:'יש להשלים תוקפים'});
    if (value === 'expired') Object.assign(examples[0], {testDate:'01.09.2026',expired:true,status:'תוקף הטסט פג לפני 9 ימים'});
    if (value === 'long') examples[0].name = 'הרכב המשפחתי לנסיעות ולטיולים בסופ״ש';
    setVehicles(value === 'empty' ? [] : value === 'single' ? [examples[0]] : examples);
    scroll.current?.scrollTo({top:0});
  };
  const renderMainNav = () => <nav className="bottom-nav original-nav" aria-label="ניווט ראשי">{[[Home, 'ראשי', 'home'], [FileText, 'מסמכים', 'documents'], [MapPin, 'מצא מוסך', 'garage'], [AlertTriangle, 'תאונות', 'accidents'], [Sparkles, 'מומחה AI', 'expert']].map(([Icon, label, type]) => <button key={type} className={type === 'expert' ? 'ai-tab' : undefined} aria-current={type === 'home' ? 'page' : undefined} onClick={() => {if(type === 'home'){close();scroll.current.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}else open(type);}}><span className="nav-icon"><Icon size={20} strokeWidth={type === 'home' ? 2.5 : 1.8}/></span><span>{label}</span></button>)}</nav>;
  const menuAction = (type) => {
    if (['home', 'focus-check', 'focus-vehicles', 'vessels'].includes(type)) {
      close();
      setQuery(type === 'vessels' ? 'Beneteau' : '');
      requestAnimationFrame(() => {
        const target = type === 'focus-check' ? '.quick-check input' : type === 'home' ? '.greeting' : '.garage-section';
        scroll.current.querySelector(target)?.scrollIntoView({ block: 'start' });
        if (type === 'focus-check') scroll.current.querySelector(target)?.focus();
      });
    } else setSheet({ type });
  };
  const notify = (message) => { setToast(message); clearTimeout(timeout.current); timeout.current = setTimeout(() => setToast(''), 3200); };
  const checkPlate = (e) => {
    e.preventDefault();
    if (plate.length < 4) return setPlateError('יש להזין מספר רישוי באורך 4 עד 8 ספרות.');
    setPlateError(''); open('check');
  };
  const listed = vehicles.filter(v => `${v.name} ${v.model} ${v.plate.replaceAll('-', '')}`.toLowerCase().includes(query.toLowerCase().replaceAll('-', ''))).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'he') : 0);
  const titles = { vehicle: sheet?.data?.name, meter: 'עדכון מונה', add: 'הוספת כלי תחבורה', check: 'תוצאת בדיקה לדוגמה', reminders: 'התזכורות שלך', notifications: 'התראות', workspace: 'החשבון שלי', documents: 'המסמכים שלך', garage: 'מצא מוסך', accidents: 'תאונות', expert: 'מומחה AI', menu: 'Car Reminder', scan: 'סריקת מספר רישוי', help: 'עזרה בדרך' };
  return (
    <div className={`lab ${mode}`} dir="rtl">
      <header className="lab-toolbar">
        <div className="lab-title"><span className="lab-dot" /><select className="scenario-picker" aria-label="מצב נתוני דוגמה" value={scenario} onChange={e=>chooseScenario(e.target.value)}>{Object.entries(scenarios).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><span className="lab-separator">/</span><b dir="ltr">Car Reminder</b></div>
        <div className="lab-tools">
          <div className="lab-switch" aria-label="בחירת תצוגה">
            <button aria-pressed={view === 'new'} onClick={() => setView('new')}>העיצוב החדש</button>
            <button aria-pressed={view === 'before'} onClick={() => setView('before')}>לפני הליטוש</button>
          </div>
          <div className="lab-device-switch"><button aria-label="תצוגת מובייל" aria-pressed={mode === 'mobile'} onClick={() => setMode('mobile')}><Smartphone size={18} /></button><button aria-label="תצוגה רחבה" aria-pressed={mode === 'wide'} onClick={() => setMode('wide')}><Monitor size={18} /></button></div>
        </div>
      </header>
      <div className="lab-stage">
        <aside className="lab-notes">
          <div className="lab-eyebrow">CAR REMINDER / HOME</div>
          <h1>הפרטים הקטנים.<br />ההבדל הגדול.</h1>
          <p>בית מוכר, עם סדר ברור יותר בין כלי התחבורה, התוקפים והפעולה הבאה.</p>
          <div className="lab-rule" />
          <div className="lab-note"><span>01</span><div><b>מידע שקודם לקישוט</b><p>תוקף, מונה ופעולה קרובה מקבלים מקום ברור.</p></div></div>
          <div className="lab-note"><span>02</span><div><b>שפה אחת לכל הכלים</b><p>רכב, אופנוע וכלי שייט. אותו סדר, הפרטים המתאימים.</p></div></div>
          <div className="lab-note"><span>03</span><div><b>נעים בשימוש יומיומי</b><p>כתב אחיד, משטחים שקטים וכפתורים שקל לזהות.</p></div></div>
          <small>נתוני דוגמה בלבד · אפשר ללחוץ ולהתנסות</small>
        </aside>
        <div className="device-wrap">
          <div className="device-caption"><span>דף הבית</span><span dir="ltr">{mode === 'mobile' ? 'MOBILE / 420' : 'RESPONSIVE'}</span></div>
          {view === 'before' ? <div className="before-frame"><img src="/design-lab/before-polish.png" alt="מוקאפ דף הבית לפני סבב הליטוש, עם שלושת כלי התחבורה לדוגמה" /><p>הגרסה שלפני הליטוש, עם שלושת כלי התחבורה המקוריים. השוואה בתצוגת מובייל.</p></div> :
          <div className="app-shell">
            <header className="app-header">
              <button className="icon-button hamburger-button" aria-label="פתח תפריט" aria-haspopup="dialog" aria-expanded={sheet?.type === 'menu'} onClick={() => open('menu')}><Menu /></button>
              <div className="app-brand"><img src="/marketing/logo.webp" alt="" /><strong dir="ltr">Car Reminder</strong></div>
              <button className="account-switch" aria-label="החלפת חשבון, חשבון אישי" aria-haspopup="dialog" onClick={() => open('workspace')}><UserRound size={17}/><span>אישי</span><ChevronDown size={13}/></button>
              <button className="icon-button notification-button" aria-label={`התראות, ${unreadCount ? '2 התראות שלא נקראו' : 'אין התראות חדשות'}`} aria-haspopup="dialog" onClick={() => open('notifications')}><Bell/>{unreadCount > 0 && <span className="notification-count" aria-hidden="true">{unreadCount}</span>}</button>
            </header>
            <div className="app-scroll" ref={scroll}>
              {scenario === 'offline' && <p className="offline-state" role="status">אין חיבור לאינטרנט. מוצגים הנתונים השמורים.</p>}
              <div className="greeting"><div><p>יום חמישי, 10 בספטמבר</p><h2>בוקר טוב, אופק</h2></div><span className="greeting-line" /></div>
              <section className="quick-check" aria-labelledby="check-title">
                <div className="section-heading"><h3 id="check-title">בדיקת רכב</h3><button className="text-button scan-button" type="button" aria-label="סריקת לוחית רישוי" onClick={() => open('scan')}><Camera size={18} /> סריקה מצילום</button></div>
                <form onSubmit={checkPlate}>
                  <div className="plate-field israeli-plate"><IsraeliPlateBadge height={52} fill /><input aria-label="מספר רישוי לבדיקה" aria-invalid={!!plateError} aria-describedby={plateError ? 'plate-error' : undefined} inputMode="numeric" autoComplete="off" dir="ltr" value={formatIsraeliPlate(plate)} onChange={e => {setPlate(e.target.value.replace(/\D/g, '').slice(0, 8)); setPlateError('');}} placeholder="הזן מספר רישוי" /></div>
                  <button className="primary-button check-button" type="submit">בדיקה <ArrowLeft size={18} /></button>
                </form>
                {plateError && <p id="plate-error" className="field-error" role="alert">{plateError}</p>}
              </section>
              <section className="garage-section" aria-labelledby="vehicles-title">
                <div className="section-heading garage-heading"><div className="title-count"><h2 id="vehicles-title">כלי התחבורה שלי</h2><span>{vehicles.length.toString().padStart(2, '0')}</span></div><button className="text-button" onClick={() => open('add')}><Plus size={17} /> הוספה</button></div>
                {!['empty','missing','loading','error'].includes(scenario) && <button className={`attention-row ${scenario === 'expired' ? 'expired-alert' : ''}`} onClick={() => scenario === 'expired' ? open('vehicle',vehicles[0]) : open('reminders')}><span className="attention-mark">{scenario === 'expired' ? <AlertTriangle size={19}/> : <Clock size={19} />}</span><span><strong>{scenario === 'expired' ? 'תוקף הטסט של הקורולה פג לפני 9 ימים' : 'ביטוח הקורולה מתחדש בעוד 5 ימים'}</strong><small>{scenario === 'expired' ? 'פג בתאריך 01.09.2026 · לפתיחת תיק הרכב' : 'יום שלישי, 15 בספטמבר'}</small></span><ChevronLeft size={18} /></button>}
                {vehicles.length > 1 && !['loading','error'].includes(scenario) && <div className="list-controls"><label className="vehicle-search"><Search size={17} /><input aria-label="חיפוש בכלי התחבורה" value={query} onChange={e => setQuery(e.target.value)} placeholder="חיפוש לפי שם או מספר" />{query && <button aria-label="נקה חיפוש" onClick={() => setQuery('')}><X size={16}/></button>}</label><select aria-label="מיון כלי התחבורה" value={sort} onChange={e => setSort(e.target.value)}><option value="default">לפי חשיבות</option><option value="name">לפי שם</option></select></div>}
                {scenario === 'loading' ? <div className="loading-state" role="status" aria-label="טוען את כלי התחבורה"><span className="loading-label">טוען את כלי התחבורה…</span>{[0,1].map(i=><div className="vehicle-skeleton" key={i} aria-hidden="true"><div/><section><span/><span/><span/></section></div>)}</div> : scenario === 'error' ? <div className="empty-state" role="alert"><AlertTriangle/><h3>לא הצלחנו לטעון את כלי התחבורה</h3><p>אפשר לנסות שוב. הנתונים שלך נשמרו.</p><button className="primary-button" onClick={()=>chooseScenario('populated')}>ניסיון נוסף</button></div> : <div className="vehicles">
                  {listed.map(v => <article className={`vehicle ${v.id}`} key={v.id}>
                    <button className="vehicle-main" onClick={() => open('vehicle', v)} aria-label={`פתיחת תיק ${v.name}`}>
                      <div className="vehicle-photo"><img src={v.photo} alt={v.model} /></div>
                      <div className="vehicle-description"><h3>{v.name}</h3><p><bdi>{v.model}</bdi> · {v.year}</p>{v.id === 'boat' ? <div className="vehicle-id" dir="ltr">{v.plate}</div> : <div className="vehicle-id israeli-small" dir="ltr"><span className="small-plate-flag" aria-hidden="true"><IsraeliPlateBadge height={18}/></span><span>{formatIsraeliPlate(v.plate)}</span></div>}</div><ChevronLeft className="vehicle-chevron" size={18} />
                    </button>
                    <div className="vehicle-details"><button className="meter-button" onClick={() => open('meter', v)} aria-label={`עדכון מונה עבור ${v.name}`}><span><Gauge size={14} />{v.unit}</span><strong dir="ltr">{v.meter.toLocaleString('en-US')}</strong><span className="meter-edit">עדכון <ArrowUpRight size={13}/></span></button><VehicleDates vehicle={v}/></div>
                  </article>)}
                  {!listed.length && <div className="empty-state">{vehicles.length ? <><Search /><p>לא נמצאו כלי תחבורה</p><button className="text-button" onClick={() => setQuery('')}>ניקוי החיפוש</button></> : <><Car/><h3>כלי התחבורה הראשון שלך</h3><p>הוסף רכב, אופנוע או כלי שייט כדי להתחיל לרכז את התוקפים והמסמכים.</p></>}</div>}
                </div>}
                {!['loading','error'].includes(scenario) && <button className="add-vehicle" onClick={() => open('add')}><Plus size={18} /> הוספת כלי תחבורה</button>}
              </section>
              {!['empty','missing','loading','error'].includes(scenario) && <section className="upcoming" aria-labelledby="upcoming-title"><div className="section-heading"><h2 id="upcoming-title">ביומן הקרוב</h2><button className="text-button" onClick={() => open('reminders')}>הכול <ChevronLeft size={16}/></button></div>{events.filter(e=>scenario !== 'single'||e.vehicle === 'הקורולה שלי').map(e => <button key={e.day} className="event-row" onClick={() => open('reminders')}><span className={`event-date ${e.warning ? 'soon' : ''}`}><b>{e.day}</b><small>{e.month}</small></span><span className="event-name"><strong>{e.title}</strong><small>{e.vehicle}</small></span><span className="event-due">{e.detail}</span><ChevronLeft size={16} /></button>)}</section>}
              <div className="roadside"><Phone size={19} /><div><strong>צריכים יד בדרך?</strong><small>סיוע בדרכים של ארגון ידידים</small></div><button className="text-button" onClick={() => open('help')}>1230 <ArrowUpRight size={15}/></button></div>
              <div className="end-mark"><span />Car Reminder<span /></div>
            </div>
            {/* Mirror the personal BottomNav's labels, order and appearance; actions stay local to the mock. */}
            {renderMainNav()}
          </div>}
        </div>
      </div>
      <dialog ref={dialog} className={`mock-dialog ${sheet?.type === 'menu' ? 'menu-drawer' : 'task-sheet'}`} style={sheet?.type === 'menu' ? drawerPosition : undefined} onClose={() => setSheet(null)} onClick={e => {if (e.target === dialog.current) close();}} aria-labelledby="sheet-title">
        <div className="dialog-panel">
        <header><div><small>נתוני דוגמה</small><h2 id="sheet-title">{titles[sheet?.type] || secondaryPreviews[sheet?.type]?.[0]}</h2></div><button className="icon-button" aria-label="סגירה" onClick={close}><X /></button></header>
        <div className="sheet-body">
          {sheet?.type === 'vehicle' && <><img className="sheet-photo" src={sheet.data.photo} alt={sheet.data.model} /><p className="sheet-subtitle">{sheet.data.model} · {sheet.data.year} · <bdi>{sheet.data.plate}</bdi></p><VehicleDates vehicle={sheet.data}/><div className="sheet-data"><span>{sheet.data.unit}</span><strong>{sheet.data.meter.toLocaleString('en-US')}</strong></div><p className="status-note"><ShieldCheck size={18}/>{sheet.data.status}</p><button className="primary-button" onClick={() => setSheet({type: 'meter', data: sheet.data})}>עדכון מונה <Gauge size={18}/></button></>}
          {sheet?.type === 'meter' && <form onSubmit={e => {e.preventDefault(); const n = Number(new FormData(e.currentTarget).get('meter')); if (n < sheet.data.meter) return; setVehicles(items => items.map(v => v.id === sheet.data.id ? {...v, meter:n} : v)); close(); notify('המונה עודכן בנתוני הדוגמה');}}><p>{sheet.data.name} · {sheet.data.unit}</p><label className="form-label">קריאת המונה החדשה<input name="meter" type="number" min={sheet.data.meter} max="99999999" defaultValue={sheet.data.meter} required dir="ltr" /></label><p className="helper">הקריאה הקודמת: {sheet.data.meter.toLocaleString('en-US')}</p><button className="primary-button">שמירת עדכון <Check size={18}/></button></form>}
          {sheet?.type === 'add' && <form onSubmit={e => {e.preventDefault(); const f = new FormData(e.currentTarget); setVehicles(v => [...v, {id:`sample-${v.length}`, name:f.get('name'), model:'טויוטה קורולה', year:'2016', plate:f.get('plate'), meter:0, unit:'ק״מ', photo:'/demo-corolla.jpg', next:'רישיון רכב', date:'לא הוזן תוקף', status:'יש להשלים תוקפים'}]); close(); notify('כלי התחבורה נוסף לתצוגת הניסוי');}}><p>הוספה לתצוגת הדוגמה בלבד.</p><label className="form-label">שם כלי התחבורה<input name="name" placeholder="למשל, הרכב המשפחתי" required maxLength={35}/></label><label className="form-label">מספר רישוי<input name="plate" inputMode="numeric" pattern="[0-9]{4,8}" placeholder="4 עד 8 ספרות" required dir="ltr" /></label><button className="primary-button">הוספה <Plus size={18}/></button></form>}
          {sheet?.type === 'check' && <><p className="sample-notice">המספר שהוזן: <bdi>{plate}</bdi>. בניסוי מוצגים נתונים קבועים של רכב לדוגמה.</p><img className="sheet-photo" src="/demo-corolla.jpg" alt="טויוטה קורולה לדוגמה"/><h3>טויוטה קורולה · 2016</h3><div className="sheet-data"><span>סוג מנוע</span><strong>בנזין · 1,598 סמ״ק</strong></div><div className="sheet-data"><span>תיבת הילוכים</span><strong>אוטומטית</strong></div><button className="primary-button" onClick={close}>חזרה לבית <ArrowLeft size={18}/></button></>}
          {sheet?.type === 'scan' && <><div className="scan-example"><Camera size={36}/><span dir="ltr">12-345-67</span></div><p>הדגמה של זיהוי לוחית מצילום. אפשר למלא את מספר הדוגמה בשדה הבדיקה.</p><button className="primary-button" onClick={() => {setPlate('1234567'); setPlateError(''); close();}}>שימוש במספר לדוגמה <Check size={18}/></button></>}
          {sheet?.type === 'reminders' && <>{events.map(e => <div className="sheet-list-item" key={e.day}><Clock size={19}/><div><strong>{e.title}</strong><p>{e.vehicle} · {e.day} {e.month} 2026</p></div><small>{e.detail}</small></div>)}<p className="helper">התאריכים בניסוי מחושבים ביחס ל־10.09.2026.</p></>}
          {sheet?.type === 'documents' && <>{['ביטוח חובה · הקורולה שלי', 'רישיון רכב · הקורולה שלי', 'כושר שייט · הרוח שלנו'].map(t => <div className="sheet-list-item" key={t}><FileText size={22}/><div><strong>{t}</strong><p>רשומה לדוגמה · PDF</p></div><Check size={17}/></div>)}<p className="helper">תצוגת רשימת מסמכים. אין קבצים אישיים בניסוי.</p></>}
          {sheet?.type === 'garage' && <><div className="sheet-list-item"><MapPin/><div><strong>מוסך לדוגמה · שירות כללי</strong><p>טיפולים שוטפים, בלמים ומיזוג</p></div></div><p>זהו המקום שבו נפתח חיפוש המוסכים באפליקציה. תצוגת הניסוי אינה משתמשת במיקום שלך.</p><button className="primary-button" onClick={close}>חזרה לבית</button></>}
          {sheet?.type === 'accidents' && <><div className="sheet-list-item"><AlertTriangle size={22}/><div><strong>אין תאונות מתועדות</strong><p>זהו מצב ריק לדוגמה של אזור התאונות.</p></div></div><p className="helper">באפליקציה ניתן לתעד אירוע ולרכז את הפרטים והמסמכים הקשורים אליו.</p><button className="primary-button" onClick={close}>חזרה לבית</button></>}
          {sheet?.type === 'expert' && <><div className="chat-example"><MessageCircle size={20}/><p>שלום אופק, על איזה כלי תחבורה תרצה לשאול?</p></div><button className="choice-row" onClick={() => notify('דוגמה בלבד. צ׳אט עם המומחה זמין באפליקציה.')}>הקורולה שלי <ChevronLeft size={17}/></button><button className="choice-row" onClick={() => notify('דוגמה בלבד. צ׳אט עם המומחה זמין באפליקציה.')}>הרוח שלנו <ChevronLeft size={17}/></button></>}
          {sheet?.type === 'menu' && <><button className="drawer-profile" onClick={() => setSheet({type:'workspace'})}><span className="avatar">א</span><span><strong>אופק</strong><small>חשבון אישי</small></span><ChevronLeft size={17}/></button><nav aria-label="תפריט צד">{personalMenu.map((group, index) => <section className="drawer-group" key={index}>{group.title && <h3>{group.title}</h3>}{group.items.map(([Icon, label, type]) => <button className="drawer-item" key={type} aria-current={type === 'home' ? 'page' : undefined} onClick={() => menuAction(type)}><Icon size={19}/><span>{label}</span></button>)}</section>)}</nav><button className="drawer-item drawer-logout" onClick={() => notify('זהו חשבון לדוגמה. החשבון שלך באפליקציה נשאר מחובר.')}><LogOut size={18}/>התנתקות</button></>}
          {sheet?.type === 'notifications' && (vehicles.length === 0 ? <div className="empty-state"><Bell/><h3>אין התראות חדשות</h3><p>התראות על כלי התחבורה שלך יופיעו כאן.</p></div> : <><div className="notification-summary"><span>{notificationsRead ? 'כל ההתראות נקראו' : '2 התראות חדשות'}</span><button className="text-button" disabled={notificationsRead} onClick={() => setNotificationsRead(true)}>סימון הכול כנקרא</button></div><button className={`notification-item ${notificationsRead ? '' : 'unread'}`} onClick={() => setSheet({type:'vehicle',data:vehicles[0]})}><Clock size={21}/><span><strong>ביטוח הרכב מתחדש בקרוב</strong><p>הקורולה שלי · תוקף עד 15.09.2026</p><small>היום, 08:30</small></span><ChevronLeft size={16}/></button><button className={`notification-item ${notificationsRead ? '' : 'unread'}`} onClick={() => setSheet({type:'documents'})}><FileText size={21}/><span><strong>מסמך נוסף לתיק</strong><p>המסמך זמין לצפייה</p><small>אתמול, 17:15</small></span><ChevronLeft size={16}/></button></>)}
          {sheet?.type === 'workspace' && <><div className="profile-example"><span className="avatar">א</span><div><strong>אופק</strong><p>חשבון לדוגמה</p></div></div><button className="choice-row" onClick={close}><UserRound size={20}/><span>החשבון האישי שלי</span><Check size={18}/></button><button className="choice-row" onClick={() => setSheet({type:'business'})}><Briefcase size={20}/><span>הצטרפות לחשבון עסקי</span><ChevronLeft size={18}/></button><button className="choice-row" onClick={() => setSheet({type:'settings'})}><Settings size={20}/>הגדרות החשבון<ChevronLeft size={18}/></button></>}
          {secondaryPreviews[sheet?.type] && <><p>{secondaryPreviews[sheet.type][1]}</p><p className="helper">המסך הזה נשאר חלק מהאפליקציה. כאן מוצגת הכניסה אליו בלבד כחלק מניסוי דף הבית.</p><button className="primary-button" onClick={() => open('menu')}>חזרה לתפריט</button></>}
          {sheet?.type === 'help' && <><p>ידידים מסייעים בתקלות בדרך, כמו מצבר ריק או מפתח שננעל ברכב.</p><div className="help-number" dir="ltr">1230</div><p className="helper">תצוגת דוגמה. לא מתבצעת שיחה מהניסוי.</p></>}
        </div>
        </div>
        {sheet?.type === 'menu' && renderMainNav()}
      </dialog>
      <div className={`mock-toast ${toast ? 'visible' : ''}`} role="status">{toast && <><Check size={18}/>{toast}</>}</div>
    </div>
  );
}
createRoot(document.getElementById('root')).render(<App />);

import React, { useEffect, useState } from 'react';
import {
  Bell, CalendarCheck, Car, Check, ChevronLeft,
  CirclePlus, FileSpreadsheet, LayoutDashboard, Menu, Route,
  Receipt, Settings, ShieldCheck, TriangleAlert,
} from 'lucide-react';

const views = [
  {
    id: 'overview', label: 'לוח בקרה', icon: LayoutDashboard,
    image: '/marketing/business-dashboard-real.webp',
    alt: 'לוח הבקרה העסקי של Car Reminder עם מצב הצי, משימות, הוצאות והתראות',
  },
  {
    id: 'fleet', label: 'צי הרכבים', icon: Car,
    image: '/marketing/business-fleet-real.webp',
    alt: 'מסך צי הרכבים העסקי של Car Reminder עם חיפוש, מיון וסינון',
  },
  {
    id: 'expenses', label: 'הוצאות וסריקה', icon: Receipt,
    image: '/marketing/business-expense-real.webp',
    alt: 'מסך הוספת הוצאה לרכב עם צילום וסריקת קבלה במערכת העסקית',
  },
  {
    id: 'import', label: 'ייבוא צי', icon: FileSpreadsheet,
    image: '/marketing/business-bulk-import-real.webp',
    alt: 'מסך ייבוא מרובה של רכבים מקובץ אקסל או מרשימת מספרי רישוי',
  },
  {
    id: 'add', label: 'הוספת כלי', icon: CirclePlus,
    image: '/marketing/business-add-vehicle-real.webp',
    alt: 'מסך הוספת כלי תחבורה למערכת העסקית לפי סוג כלי ומספר רישוי',
  },
  {
    id: 'accidents', label: 'תאונות ודוחות', icon: TriangleAlert,
    image: '/marketing/business-accident-real.webp',
    alt: 'מסך צפייה, הורדה ושיתוף של דוח תאונה במערכת העסקית',
  },
];

function RealBusinessScreen({ src, alt }) {
  return <div className="cm-biz-real-screen">
    <img src={src} alt={alt} />
    <span className="cm-biz-real-badge"><ShieldCheck size={10} /> צילום אנונימי מתוך המערכת</span>
  </div>;
}

function DriverPhone() {
  return <div className="cm-biz-phone" aria-label="אפליקציית הנהג">
    <div className="cm-biz-phone-rim"><div className="cm-biz-island" /><div className="cm-biz-phone-screen">
      <header><button type="button" aria-label="תפריט"><Menu size={14} /></button><b>Car Reminder</b><span><Bell size={13} /><i /></span></header>
      <div className="cm-biz-driver-welcome"><small>יום עבודה נעים, דניאל</small><strong>המשימות שלי</strong></div>
      <div className="cm-biz-driver-date"><CalendarCheck size={14} /><span><b>היום</b><small>3 משימות · 5 תחנות</small></span></div>
      <article className="cm-biz-driver-task"><div><span>בביצוע</span><small>משימה 1842</small></div><strong>איסוף ציוד מהמרכז הלוגיסטי</strong><p><Car size={12} /> רכב שירות 12</p><ol><li className="is-done"><i><Check size={9} /></i><span>יציאה מהמחסן<small>הושלם ב־09:10</small></span></li><li className="is-current"><i>2</i><span>מרכז לוגיסטי, ראשון לציון<small>8 דקות מהיעד</small></span></li><li><i>3</i><span>חזרה למשרד<small>ממתין</small></span></li></ol><button type="button">לפרטי המשימה <ChevronLeft size={13} /></button></article>
      <nav><span><LayoutDashboard size={13} />ראשי</span><span className="is-active"><Route size={13} />משימות</span><span><Car size={13} />כלים</span><span><Settings size={13} />הגדרות</span></nav>
    </div></div>
  </div>;
}

export default function MarketingBusinessPreview() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % views.length), 5000);
    return () => window.clearInterval(timer);
  }, [paused]);

  const currentView = views[active];
  const scene = <RealBusinessScreen src={currentView.image} alt={currentView.alt} />;

  return <figure className="cm-biz-preview" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
    <div className="cm-biz-device-stage">
      <div className="cm-biz-browser">
        <div className="cm-biz-browser-bar"><span /><span /><span /><b>Car Reminder</b><em>app.car-reminder.co.il</em></div>
        <div className="cm-biz-browser-shell"><main key={views[active].id}>{scene}</main></div>
      </div>
      <DriverPhone />
    </div>
    <div className="cm-biz-view-switch" aria-label="בחירת מסך להדגמה">{views.map((view, index) => { const Icon = view.icon; return <button type="button" key={view.id} className={index === active ? 'is-active' : ''} onClick={() => setActive(index)} aria-pressed={index === active}><Icon size={14} />{view.label}</button>; })}</div>
    <figcaption>מסכי ניהול אמיתיים מהווב ואפליקציה אישית לכל נהג</figcaption>
  </figure>;
}

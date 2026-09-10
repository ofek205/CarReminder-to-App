import React from 'react';
import { Truck, Tractor, Car, FileText, Users, Wallet } from 'lucide-react';

export default function MarketingBusinessPreview() {
  return <figure className="cm-desktop-preview">
    <div className="cm-desktop-bar"><span /><span /><span /><b>Car Reminder</b></div>
    <div className="cm-desktop-body">
      <div className="cm-desktop-heading"><strong>כלי הרכב של העסק</strong><span>סביבת עבודה משותפת</span></div>
      <div className="cm-desktop-tabs"><span>כלי רכב</span><span>צוות</span><span>מסמכים</span></div>
      <div className="cm-fleet-rows">{[[Truck, 'משאית חלוקה', 'רישוי ומסמכי רכב'], [Tractor, 'שופל', 'שעות מנוע ותסקירים'], [Car, 'רכב שירות', 'טיפולים והוצאות']].map(([Icon, title, text]) => <div key={title}><Icon size={24} /><span><strong>{title}</strong><small>{text}</small></span><FileText size={18} /></div>)}</div>
      <div className="cm-desktop-tools"><span><Users size={16} /> צוות והרשאות</span><span><Wallet size={16} /> הוצאות ודוחות</span></div>
    </div>
    <figcaption>המחשת יכולות החשבון העסקי · אינה צילום מסך</figcaption>
  </figure>;
}

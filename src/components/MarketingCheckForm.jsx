import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, ShieldCheck } from 'lucide-react';
import { marketingEvent } from '@/lib/marketingEvents';

/**
 * The plate-check form on the home page.
 *
 * Split out of Marketing() because its four pieces of state are a self
 * contained machine that nothing else reads, and leaving them in the page
 * component meant a visitor reading a guide still allocated them and anyone
 * reading the demo-sync logic had to scroll past them.
 *
 * The validator is imported lazily inside the submit handler, not at module
 * scope: it is only needed once the visitor actually submits, and pulling it
 * eagerly would put it on the critical path of every marketing page.
 */
export default function MarketingCheckForm() {
  const navigate = useNavigate();
  const [plate, setPlate] = useState('');
  const plateInput = useRef(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  return <form className="cm-check-form cm-check-interactive" onSubmit={startCheck} noValidate aria-label="בדיקת רכב לפי מספר רישוי" aria-busy={submitting}>
          <div className="cm-check-form-heading"><p>הקלידו את המספר בלוחית ולחצו לבדיקה.</p></div>
          <label htmlFor="cm-plate">מספר הרישוי <Pencil size={15} aria-hidden="true" /></label>
          <div className={`cm-plate${plate ? ' has-value' : ''}${error ? ' has-error' : ''}`}><span aria-hidden="true">IL</span><input ref={plateInput} id="cm-plate" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} value={plate} onChange={event => { setPlate(event.target.value.replace(/[^0-9-]/g, '').slice(0, 10)); setError(''); }} placeholder="הקלידו מספר" aria-invalid={!!error} aria-describedby={`cm-plate-hint cm-check-note${error ? ' cm-plate-error' : ''}`} /></div>
          <p id="cm-plate-hint" className="cm-input-hint">אפשר גם להדביק מספר, עם מקפים או בלעדיהם.</p>
          {error && <p id="cm-plate-error" role="alert" className="cm-error">{error}</p>}
          <button className="cm-button cm-check-submit" disabled={submitting} type="submit">{submitting ? 'פותחים את הבדיקה…' : plate ? 'בדקו את הרכב' : 'להתחלת הבדיקה'} <ArrowLeft size={19} /></button>
          <p id="cm-check-note" className="cm-check-access"><ShieldCheck size={16} /> הבדיקה הראשונה ללא הרשמה</p>
          <details className="cm-check-fineprint"><summary>מה חשוב לדעת לפני הבדיקה?</summary><p>לבדיקת רכב נוסף או לשמירה בחשבון יש להתחבר. המידע עשוי להיות חלקי או לא מעודכן ואינו מחליף בדיקה מקצועית.</p></details>
        </form>;
}

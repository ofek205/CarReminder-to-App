import React, { useRef, useState } from 'react';
import { faqPageJsonLd } from '@/lib/marketingSchema';
import { appStoreUrl, googlePlayUrl } from '@/lib/storeLinks';
import {
  lookupTestValidity,
  normalizePlateDigits,
  presentTestValidity,
  trackTestCheckSubmit,
} from '@/lib/testValidityCheck';

const ERRORS = {
  not_found: 'לא מצאנו את המספר במאגר הרכב הפרטי. בדקו את הספרות ונסו שוב.',
  network: 'לא הצלחנו להגיע למאגר. בדקו את החיבור ונסו שוב.',
  error: 'המאגר לא החזיר תשובה תקינה. נסו שוב בעוד רגע.',
};

function StoreButtons() {
  return <div className="cm-stores" data-link-location="test_check">
    <a href={appStoreUrl('test_check')} target="_blank" rel="noopener noreferrer">
      <img src="/marketing/apple.svg" width="28" height="32" alt="" />
      <span><small>להורדה ב־</small><strong>App Store</strong></span>
    </a>
    <a href={googlePlayUrl('test_check')} target="_blank" rel="noopener noreferrer">
      <img src="/marketing/google-play.svg" width="28" height="32" alt="" />
      <span><small>להורדה ב־</small><strong>Google Play</strong></span>
    </a>
  </div>;
}

function ResultCard({ record }) {
  const view = presentTestValidity(record);
  return <div className={`cm-test-check-card${view.expired ? ' is-expired' : ''}`}>
    {view.identityLine && <p className="cm-test-check-vehicle">{view.identityLine}</p>}
    {view.dueLabel ? <dl>
      <div>
        <dt>תוקף הטסט עד</dt>
        <dd>{view.dueLabel}</dd>
      </div>
      <div>
        <dt>מצב התוקף</dt>
        <dd className={view.expired ? 'cm-test-check-expired' : 'cm-test-check-ok'}>{view.duePhrase}</dd>
      </div>
      {view.lastTestLabel && <div>
        <dt>טסט אחרון</dt>
        <dd>{view.lastTestLabel}</dd>
      </div>}
    </dl> : <p>במאגר אין תאריך תוקף לרכב הזה.</p>}
    {view.missingDue && view.lastTestLabel && <p>טסט אחרון: {view.lastTestLabel}</p>}
  </div>;
}

export default function MarketingTestValidityCheck({ faq = [] }) {
  const inputRef = useRef(null);
  const requestRef = useRef(0);
  const pendingRef = useRef(false);
  const [plate, setPlate] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('idle');
  const [record, setRecord] = useState(null);
  const loading = status === 'loading';

  function resetForEdit(next) {
    requestRef.current += 1;
    pendingRef.current = false;
    setPlate(next);
    setError('');
    setRecord(null);
    setStatus('idle');
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (pendingRef.current) return;
    const validation = normalizePlateDigits(plate);
    if (!validation.ok) {
      requestRef.current += 1;
      setRecord(null);
      setStatus('idle');
      setError(validation.message);
      inputRef.current?.focus();
      trackTestCheckSubmit('invalid');
      return;
    }
    pendingRef.current = true;
    const ticket = requestRef.current + 1;
    requestRef.current = ticket;
    setError('');
    setRecord(null);
    setStatus('loading');
    try {
      const outcome = await lookupTestValidity(validation.plate);
      if (ticket !== requestRef.current) return;
      if (outcome.status === 'found') {
        setRecord(outcome.record);
        setStatus('found');
      } else {
        setRecord(null);
        setStatus(outcome.status);
        setError(ERRORS[outcome.status] || ERRORS.error);
      }
      trackTestCheckSubmit(outcome.status);
    } catch {
      if (ticket !== requestRef.current) return;
      setRecord(null);
      setStatus('network');
      setError(ERRORS.network);
      trackTestCheckSubmit('network');
    } finally {
      if (ticket === requestRef.current) pendingRef.current = false;
    }
  }

  return <>
    {faq.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageJsonLd(faq)).replaceAll('<', '\\u003c') }} />}
    <section className="cm-test-check" aria-labelledby="cm-test-check-heading">
      <h2 id="cm-test-check-heading">בדיקת תוקף טסט לפי מספר רכב</h2>
      <p>הקלידו מספר רישוי של 7 או 8 ספרות, ונבדוק את תאריך התוקף במאגר הציבורי.</p>
      <form className="cm-test-check-form" method="get" action="/website/guides/test-reminder" onSubmit={onSubmit} noValidate aria-busy={loading}>
        <label htmlFor="cm-test-plate">מספר רישוי</label>
        <div className="cm-test-check-row">
          <div className={`cm-plate${error ? ' has-error' : ''}`}>
            <span aria-hidden="true">IL</span>
            <input
              ref={inputRef}
              id="cm-test-plate"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={plate}
              onChange={event => resetForEdit(event.target.value.replace(/[^\d\- ]/g, '').slice(0, 12))}
              placeholder="7 או 8 ספרות"
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={`cm-test-plate-hint${error ? ' cm-test-plate-error' : ''}`}
            />
          </div>
          <button className="cm-button cm-gold" type="submit" disabled={loading}>{loading ? 'בודקים' : 'בדיקה'}</button>
        </div>
        <p id="cm-test-plate-hint" className="cm-test-check-hint">אפשר גם עם מקפים. המספר לא נשמר אצלנו.</p>
        {error && <p id="cm-test-plate-error" role="alert" className="cm-error">{error}</p>}
      </form>
      <div className="cm-test-check-result" role="status" aria-live="polite" aria-atomic="true">
        {loading && <p>בודקים במאגר.</p>}
        {status === 'found' && record && <ResultCard record={record} />}
      </div>
      <div className="cm-test-check-cta">
        <p>קבלו תזכורת לפני שהטסט פג</p>
        <StoreButtons />
      </div>
      <p className="cm-test-check-note">הנתונים ממאגר הרכב הציבורי של משרד התחבורה באתר data.gov.il. ייתכן שהמידע אינו מעודכן. זה אינו אתר ממשלתי.</p>
      <noscript><p>בלי JavaScript אי אפשר להריץ את הבדיקה מכאן. את מועד התוקף אפשר לראות ברישיון הרכב או באזור האישי הממשלתי.</p></noscript>
    </section>
    {faq.length > 0 && <section className="cm-test-faq" aria-labelledby="cm-test-faq-heading">
      <h2 id="cm-test-faq-heading">שאלות על תוקף הטסט</h2>
      {faq.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}
    </section>}
  </>;
}

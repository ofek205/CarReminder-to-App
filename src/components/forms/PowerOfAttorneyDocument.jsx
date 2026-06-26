import React from 'react';

/**
 * PowerOfAttorneyDocument — faithful render of the Ministry of Transport
 * power-of-attorney form (ייפוי כוח לשינוי במירשם כלי הרכב), in both the
 * private-individual and corporate variants.
 *
 * Rendered black-on-white to match the official gov.il form (which is a
 * B&W document), NOT the app's green brand — a green form would look
 * "unofficial" to a licensing clerk. The element is captured by
 * html2canvas → A4 PDF / Word via @/lib/pdfExport, so everything lives in
 * a single scoped <style> block (offscreen computed styles don't survive
 * the canvas capture; an inline <style> does).
 *
 * Data shape (all optional — blanks render as empty lines so a
 * half-filled preview still reads like the real form):
 *   variant        'personal' | 'business'
 *   purpose        'sale' | 'purchase' | 'other'
 *   plate          string
 *   owners         [{ name, id }]            (personal, up to 3)
 *   representative { name, id }
 *   validUntil     ISO date string
 *   corpName       string                    (business)
 *   corpNumber     string                    (business, ח.פ)
 *   signatories    [{ name }]                (business, 2)
 *   lawyer         { name, address, validUntil } (business)
 */

const PURPOSES = [
  { key: 'sale', label: 'למכירת הרכב (מטעם בעל הרכב).' },
  { key: 'purchase', label: 'לקניית הרכב (מטעם בעל הקונה).' },
  { key: 'other', label: 'לפעולה אחרת מטעם בעל הרכב.' },
];

function formatHe(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

function fmtDateTime(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

// A fixed row of digit cells (right-to-left visually, digits read LTR).
// Empty positions render as blank cells so the form looks authentic even
// when no value is entered yet.
function DigitCells({ value, count = 9 }) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, count);
  const cells = [];
  for (let i = 0; i < count; i++) cells.push(digits[i] || '');
  return (
    <span className="poa-digits" dir="ltr">
      {cells.map((c, i) => (
        <span key={i} className="poa-digit-cell">{c}</span>
      ))}
    </span>
  );
}

// A labelled value sitting on an underline — the "fill in the blank" look.
function FilledLine({ label, value, className = '' }) {
  return (
    <div className={`poa-line ${className}`}>
      <span className="poa-line-value">{value || ' '}</span>
      <span className="poa-line-label">{label}</span>
    </div>
  );
}

function Checkbox({ checked, label }) {
  return (
    <div className="poa-check-row">
      <span className={`poa-check ${checked ? 'is-on' : ''}`}>{checked ? '✕' : ''}</span>
      <span className="poa-check-label">{label}</span>
    </div>
  );
}

export default function PowerOfAttorneyDocument({ data = {}, variant = 'personal' }) {
  const isBusiness = variant === 'business';
  const {
    purpose = 'other',
    plate = '',
    owners = [],
    representative = {},
    validUntil = '',
    corpName = '',
    corpNumber = '',
    signatories = [],
    lawyer = {},
    includeLawyer = true,
    signatures = {},
  } = data;

  const title = isBusiness ? 'ייפוי כוח – של תאגיד' : 'ייפוי כוח – של אדם פרטי';
  const instructionLead = isBusiness
    ? 'לביצוע שינוי במירשם כלי הרכב – כאשר המבקש הוא תאגיד (אינו אדם פרטי).'
    : 'לביצוע שינוי במירשם כלי הרכב – כאשר המבקש אינו מבצע את הפעולה בעצמו.';
  const instructionBullets = isBusiness
    ? ['טופס זה.', 'תעודת זהות שלו.', 'רישיון הרכב (כאשר המבקש הוא בעל הרכב).', 'טופס זה יוחזר לשליח.', 'השליח אחראי לכל פעולה שביצע בהסתמך על טופס זה.']
    : ['טופס זה.', 'תעודת זהות שלו ושל המבקשים.', 'רישיון הרכב (כאשר הוא שליח של בעל הרכב).', 'טופס זה יוחזר לשליח.', 'השליח אחראי לכל פעולה שביצע בהסתמך על טופס זה.'];

  // Personal: always render 3 owner rows (the official form has a 3-row
  // table); fill the ones we have.
  const ownerRows = [];
  for (let i = 0; i < 3; i++) ownerRows.push(owners[i] || {});

  return (
    <article className="poa-doc" dir="rtl">
      <PowerOfAttorneyStyles />

      {/* ── Header: title + vehicle number ─────────────────────────── */}
      <div className="poa-titlebar">
        <div className="poa-plate-box">
          <span className="poa-plate-label">רכב מספר</span>
          <span className="poa-plate-value" dir="ltr">{plate || ' '}</span>
        </div>
        <h1 className="poa-title">{title}</h1>
      </div>

      {/* ── Authority box + purpose checkboxes ─────────────────────── */}
      <div className="poa-top">
        <div className="poa-authority">
          <p className="poa-state">מדינת ישראל</p>
          <p className="poa-ministry">משרד התחבורה</p>
          <p className="poa-dept">מינהל התנועה – אגף הרישוי</p>
          <p className="poa-lead">{instructionLead}</p>
          <p className="poa-present">מציג המבקש (השליח) יציג:</p>
          <ul className="poa-bullets">
            {instructionBullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
        <div className="poa-purposes">
          {PURPOSES.map((p) => (
            <Checkbox key={p.key} checked={purpose === p.key} label={p.label} />
          ))}
        </div>
      </div>

      {isBusiness ? (
        <>
          {/* ── 1. Corporation details ─────────────────────────────── */}
          <section className="poa-section">
            <p className="poa-section-title">1. פרטי התאגיד – בעל הרכב הרשום או הקונה</p>
            <FilledLine label="שם התאגיד וחותמת התאגיד" value={corpName} />
            <div className="poa-id-line">
              <span className="poa-line-label">מספר התאגיד</span>
              <DigitCells value={corpNumber} count={9} />
            </div>
          </section>

          {/* ── 2. Authorized signatories ──────────────────────────── */}
          <section className="poa-section">
            <p className="poa-section-title">
              2. המורשים לחתום בשם התאגיד, המאשרים בחתימתם כי נציגם לביצוע הפעולה הוא מי שרשום בסעיף 3 להלן:
            </p>
            <div className="poa-signers">
              {[0, 1].map((i) => (
                <div className="poa-signer" key={i}>
                  <FilledLine label="שם משפחה ופרטי" value={signatories[i]?.name} />
                  {signatures[`sig${i}`] ? (
                    <div className="poa-sign-mark">
                      <img className="poa-sign-img" src={signatures[`sig${i}`].dataUrl} alt="חתימה" />
                      <span className="poa-line-label">נחתם דיגיטלית</span>
                    </div>
                  ) : (
                    <div className="poa-sign-blank">
                      <span className="poa-sign-rule" />
                      <span className="poa-line-label">חתימה</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── 3. Representative ──────────────────────────────────── */}
          <section className="poa-section">
            <p className="poa-section-title">3. פרטי מיופה הכוח (נציגו ושליחו של התאגיד)</p>
            <FilledLine label="שם משפחה ופרטי" value={representative.name} />
            <div className="poa-id-line">
              <span className="poa-line-label">מספר הזהות</span>
              <DigitCells value={representative.id} count={9} />
            </div>
          </section>

          {/* ── 4. Lawyer certification (optional) ──────────────────── */}
          {includeLawyer && (
          <section className="poa-section">
            <p className="poa-section-title">4. אישור עורך דין</p>
            <p className="poa-section-note">
              הריני לאשר כי נותני ייפוי הכוח, שפרטיהם בסעיף 2, מורשים לחתום בשם התאגיד.
            </p>
            <FilledLine label="שם משפחה ופרטי של עורך הדין" value={lawyer.name} />
            <FilledLine label="כתובת משרד עורך הדין" value={lawyer.address} />
            <div className="poa-row-2">
              <FilledLine label="תאריך האישור בתוקף עד" value={formatHe(lawyer.validUntil)} />
              <div className="poa-sign-blank">
                <span className="poa-sign-rule" />
                <span className="poa-line-label">חתימה וחותמת של עורך הדין</span>
              </div>
            </div>
          </section>
          )}
        </>
      ) : (
        <>
          {/* ── 1. Authorizers (owners) ────────────────────────────── */}
          <section className="poa-section">
            <p className="poa-section-title">1. פרטי נותן ייפוי הכוח – בעל הרכב הרשום או הקונה</p>
            <p className="poa-section-note">
              המאשר בחתימתו כי נציגו לביצוע הפעולה הוא מי שרשום בסעיף 2 להלן:
            </p>
            <table className="poa-table">
              <thead>
                <tr>
                  <th className="poa-th-name">שם משפחה ופרטי</th>
                  <th className="poa-th-id">מספר זהות</th>
                  <th className="poa-th-sign">חתימה</th>
                </tr>
              </thead>
              <tbody>
                {ownerRows.map((o, i) => (
                  <tr key={i}>
                    <td className="poa-td-name">{o.name || ' '}</td>
                    <td className="poa-td-id"><DigitCells value={o.id} count={9} /></td>
                    <td className="poa-td-sign">
                      {signatures[`owner${i}`]
                        ? <img className="poa-td-sign-img" src={signatures[`owner${i}`].dataUrl} alt="חתימה" />
                        : ' '}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* ── 2. Representative ──────────────────────────────────── */}
          <section className="poa-section">
            <p className="poa-section-title">2. פרטי מיופה הכוח (נציגו של המבקש)</p>
            <FilledLine label="שם משפחה ופרטי" value={representative.name} />
            <div className="poa-id-line">
              <span className="poa-line-label">מספר הזהות</span>
              <DigitCells value={representative.id} count={9} />
            </div>
            <FilledLine label="תאריך האישור בתוקף עד" value={formatHe(validUntil)} />
          </section>
        </>
      )}

      {Object.keys(signatures).length > 0 && (
        <section className="poa-cert">
          <p className="poa-cert-title">אימות חתימה אלקטרונית</p>
          {Object.entries(signatures).map(([key, s]) => (
            <p className="poa-cert-row" key={key}>
              <strong>{s.name || ''}</strong>
              {s.id ? <> (ת.ז <span dir="ltr">{s.id}</span>)</> : null}
              {' '}חתם/ה אלקטרונית בתאריך {fmtDateTime(s.ts)}
              {s.hash ? <> · טביעת אצבע <span dir="ltr">{s.hash}</span></> : null}
            </p>
          ))}
          <p className="poa-cert-note">
            חתימות אלקטרוניות שנעשו במכשיר בהסכמת החותמים. טביעת האצבע מזהה את תוכן המסמך בעת החתימה.
          </p>
        </section>
      )}

      {/* ── App-generated disclaimer ───────────────────────────────── */}
      <footer className="poa-disclaimer">
        מסמך זה הופק באמצעות CarReminder על בסיס טופס משרד התחבורה. יש לבדוק את נכונות הפרטים, להדפיס ולחתום ביד.
        ייתכן שיידרשו חתימות וחותמות מקוריות במעמד ההגשה.
        {isBusiness && includeLawyer && ' סעיף 4 מחייב אישור, חתימה וחותמת של עורך דין.'}
      </footer>
    </article>
  );
}

// Scoped styles. Black-on-white official look. Heebo to match the app's
// Hebrew rendering; falls back to system fonts for the html2canvas pass.
export function PowerOfAttorneyStyles() {
  return (
    <style>{`
      .poa-doc {
        background: #ffffff;
        color: #111111;
        font-family: 'Heebo', system-ui, -apple-system, sans-serif;
        font-size: 13px;
        line-height: 1.55;
        padding: 26px 28px;
        max-width: 800px;
        margin: 0 auto;
        box-sizing: border-box;
      }
      .poa-doc * { box-sizing: border-box; }

      /* Title bar */
      .poa-titlebar {
        display: flex;
        align-items: stretch;
        justify-content: space-between;
        gap: 12px;
        border: 1.5px solid #111;
        margin-bottom: 14px;
      }
      .poa-title {
        font-size: 17px;
        font-weight: 800;
        margin: 0;
        padding: 10px 14px;
        flex: 1;
        display: flex;
        align-items: center;
      }
      .poa-plate-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 6px 14px;
        border-inline-start: 1.5px solid #111;
        min-width: 150px;
      }
      .poa-plate-label { font-size: 11px; font-weight: 700; color: #333; }
      .poa-plate-value {
        font-size: 18px; font-weight: 800; letter-spacing: 0.08em;
        min-height: 22px;
      }

      /* Authority + purposes */
      .poa-top {
        display: grid;
        grid-template-columns: 1.1fr 1fr;
        gap: 14px;
        margin-bottom: 16px;
      }
      .poa-authority {
        border: 1.5px solid #111;
        border-radius: 14px;
        padding: 10px 14px;
      }
      .poa-state { font-weight: 800; font-size: 13px; margin: 0; }
      .poa-ministry { font-weight: 700; font-size: 12.5px; margin: 1px 0 0; }
      .poa-dept { font-size: 11.5px; color: #333; margin: 0 0 6px; }
      .poa-lead { font-size: 11.5px; font-weight: 700; margin: 0 0 6px; }
      .poa-present { font-size: 11.5px; font-weight: 700; margin: 0 0 2px; text-decoration: underline; }
      .poa-bullets { margin: 0; padding-inline-start: 16px; }
      .poa-bullets li { font-size: 11px; color: #222; margin: 1px 0; }

      .poa-purposes {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 10px;
      }
      .poa-check-row { display: flex; align-items: center; gap: 8px; }
      .poa-check {
        width: 18px; height: 18px;
        border: 1.4px solid #111;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: 800; line-height: 1;
        flex-shrink: 0;
      }
      .poa-check-label { font-size: 12.5px; }

      /* Sections */
      .poa-section {
        border: 1.2px solid #111;
        border-radius: 10px;
        padding: 10px 14px;
        margin-bottom: 12px;
      }
      .poa-section-title { font-size: 13px; font-weight: 800; margin: 0 0 6px; }
      .poa-section-note { font-size: 11.5px; color: #333; margin: 0 0 8px; }

      /* Filled "blank" lines */
      .poa-line { display: flex; flex-direction: column-reverse; margin: 8px 0; }
      .poa-line-value {
        min-height: 22px;
        border-bottom: 1px solid #111;
        font-size: 14px; font-weight: 700;
        padding: 0 4px 2px;
      }
      .poa-line-label { font-size: 11px; color: #444; margin-top: 3px; }

      .poa-id-line { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
      .poa-id-line .poa-line-label { margin: 0; font-size: 12px; font-weight: 600; color: #222; }

      /* Digit cells */
      .poa-digits { display: inline-flex; gap: 3px; }
      .poa-digit-cell {
        width: 20px; height: 24px;
        border: 1px solid #111;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 14px; font-weight: 700;
        font-variant-numeric: tabular-nums;
      }

      /* Signature blanks */
      .poa-sign-blank { display: flex; flex-direction: column-reverse; margin: 8px 0; }
      .poa-sign-rule { display: block; min-height: 22px; border-bottom: 1px solid #111; }
      .poa-sign-blank .poa-line-label { margin-top: 3px; }

      .poa-signers { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .poa-signer { display: flex; flex-direction: column; }
      .poa-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: end; }

      /* Owners table */
      .poa-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
      .poa-table th, .poa-table td {
        border: 1px solid #111;
        padding: 6px 8px;
        text-align: center;
        font-size: 12px;
      }
      .poa-table th { font-weight: 800; background: #f2f2f2; }
      .poa-th-name { width: 42%; }
      .poa-th-sign { width: 24%; }
      .poa-td-name { font-weight: 700; height: 34px; text-align: right; }
      .poa-td-id { padding: 6px 4px; }
      .poa-td-sign { height: 34px; }
      .poa-td-sign-img { max-height: 30px; max-width: 95%; display: block; margin: 0 auto; }
      .poa-sign-mark { display: flex; flex-direction: column-reverse; margin: 8px 0; align-items: center; }
      .poa-sign-img { max-height: 44px; max-width: 90%; display: block; margin: 0 auto 2px; }
      .poa-cert { margin-top: 12px; border: 1.2px solid #111; border-radius: 10px; padding: 8px 14px; }
      .poa-cert-title { font-size: 12px; font-weight: 800; margin: 0 0 5px; }
      .poa-cert-row { font-size: 10.5px; margin: 2px 0; color: #222; }
      .poa-cert-note { font-size: 9.5px; color: #555; margin: 6px 0 0; }

      /* Disclaimer */
      .poa-disclaimer {
        font-size: 9.5px;
        line-height: 1.5;
        color: #555;
        text-align: center;
        margin-top: 14px;
        padding-top: 8px;
        border-top: 1px dashed #999;
      }
    `}</style>
  );
}

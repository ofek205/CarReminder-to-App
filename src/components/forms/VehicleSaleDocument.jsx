import React from 'react';

/**
 * VehicleSaleDocument — renderable vehicle sale agreement (חוזה מכירת רכב),
 * based on the standard "המלצה לעריכת חוזה למכירת רכב" template Ofek
 * provided. The source is explicitly a RECOMMENDATION (not an official gov
 * form), so the wording is clean standard contract language and the
 * disclaimer makes the advisory nature clear.
 *
 * Black-on-white, single scoped <style> block (captured by html2canvas →
 * PDF/Word). Blanks render as thin underlines so a half-filled preview
 * still reads like a contract.
 *
 * Data shape (all optional):
 *   vehicle   { type, manufacturer, model, plate, year }
 *   seller    { name, id, address, phone }
 *   buyer     { name, id, address, phone }
 *   price     { total, totalWords, down, downWords, balance, balanceWords, balanceDate }
 *   condition { km, ownership, hands, hadAccident }
 *   date      ISO contract date
 */

function he(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const p = iso.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}
function fmtNum(n) {
  const v = Number(n);
  if (!v) return '';
  return v.toLocaleString('en-US');
}

// Inline filled value sitting on an underline (the "blank" look).
function B({ value, w = 90 }) {
  return <span className="sale-blank" style={{ minWidth: w }}>{value || ' '}</span>;
}

function fmtDateTime(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function SignParty({ title, party = {}, signature = null }) {
  return (
    <div className="sale-sign-col">
      <p className="sale-sign-title">{title}</p>
      <div className="sale-sign-row"><span className="sale-sign-k">שם מלא</span><span className="sale-sign-v">{party.name || ''}</span></div>
      <div className="sale-sign-row"><span className="sale-sign-k">ת.ז</span><span className="sale-sign-v" dir="ltr">{party.id || ''}</span></div>
      <div className="sale-sign-row"><span className="sale-sign-k">כתובת</span><span className="sale-sign-v">{party.address || ''}</span></div>
      <div className="sale-sign-row"><span className="sale-sign-k">טלפון</span><span className="sale-sign-v" dir="ltr">{party.phone || ''}</span></div>
      {signature ? (
        <div className="sale-sign-mark">
          <img className="sale-sign-img" src={signature.dataUrl} alt="חתימה" />
          <span className="sale-sign-cap">נחתם דיגיטלית</span>
        </div>
      ) : (
        <>
          <div className="sale-sign-line" />
          <p className="sale-sign-cap">חתימה</p>
        </>
      )}
    </div>
  );
}

export default function VehicleSaleDocument({ data = {} }) {
  const { vehicle = {}, seller = {}, buyer = {}, price = {}, condition = {}, date = '', signatures = {} } = data;

  return (
    <article className="sale-doc" dir="rtl">
      <VehicleSaleStyles />

      <h1 className="sale-title">העברת בעלות רכב – זכרון דברים</h1>

      <p className="sale-note">
        מסמך זה הוא המלצה לעריכת זכרון דברים בלבד ואינו מהווה ייעוץ משפטי. הצדדים אחראים לתוכנו ורשאים
        להוסיף, לגרוע או לתקן סעיפים. מומלץ להיוועץ בעורך דין לפני החתימה.
      </p>

      {/* Preamble */}
      <section className="sale-pre">
        <p>
          הואיל והמוכר מצהיר כי הוא הבעלים הרשום של רכב מסוג <B value={vehicle.type} /> תוצרת <B value={vehicle.manufacturer} />
          {' '}דגם <B value={vehicle.model} /> מספר רישוי <B value={vehicle.plate} w={110} /> שנת ייצור <B value={vehicle.year} w={60} /> (להלן: ״הרכב״);
        </p>
        <p>והואיל והמוכר מצהיר כי הרכב נקי מכל חוב, שעבוד, עיקול או הגבלה כלשהי;</p>
        <p>והואיל והמוכר מעוניין למכור את הרכב לקונה, והקונה מעוניין לרכוש אותו;</p>
        <p className="sale-lead">לפיכך הוסכם, הוצהר והותנה בין הצדדים כדלקמן:</p>
      </section>

      {/* Clauses */}
      <ol className="sale-clauses">
        <li>המוכר מוכר בזאת לקונה את הרכב, והקונה רוכש אותו, בהתאם לתנאי זכרון דברים זה.</li>
        <li>
          מחיר הרכב הכולל והמוסכם הוא <B value={fmtNum(price.total)} /> ₪ (במילים: <B value={price.totalWords} w={180} /> ש״ח), אשר ישולם כך:
          <ol className="sale-sub">
            <li>
              סך של <B value={fmtNum(price.down)} /> ₪ (במילים: <B value={price.downWords} w={150} /> ש״ח) שולם במעמד חתימת זכרון דברים זה,
              והמוכר מאשר את קבלתו.
            </li>
            <li>
              היתרה בסך <B value={fmtNum(price.balance)} /> ₪ (במילים: <B value={price.balanceWords} w={150} /> ש״ח) תשולם בשיק בנקאי
              או במזומן ביום <B value={he(price.balanceDate)} w={100} />, במעמד העברת הבעלות על שם הקונה ומסירת הרכב.
            </li>
          </ol>
        </li>
        <li>
          המוכר מתחייב להעביר לקונה את הבעלות ברכב כשהיא נקייה מכל חוב, שעבוד, עיקול או הגבלה, ולשאת בכל המסים
          והאגרות החלים על הרכב עד למועד העברת הבעלות.
        </li>
        <li>
          המוכר מצהיר כי קריאת מונה הקילומטרים של הרכב היא <B value={fmtNum(condition.km)} /> ק״מ, סוג הבעלות הוא{' '}
          <B value={condition.ownership} /> ומספר הידיים ברכב הוא <B value={condition.hands} w={50} />.
        </li>
        <li>
          {condition.hadAccident
            ? 'המוכר מצהיר כי הרכב היה מעורב בתאונה, וכי גילה זאת לקונה.'
            : 'המוכר מצהיר כי למיטב ידיעתו הרכב לא היה מעורב בתאונה שגרמה לירידת ערך מסחרית.'}
        </li>
        <li>המוכר מצהיר כי גילה לקונה את כל הפגמים והליקויים המהותיים הידועים לו ברכב.</li>
        <li>הקונה מצהיר כי ראה ובדק את הרכב, התרשם ממצבו ומצא אותו מתאים לצרכיו, והוא רוכש אותו במצבו הנוכחי (AS-IS).</li>
        <li>הפרה יסודית של זכרון דברים זה תזכה את הצד הנפגע בכל הסעדים העומדים לרשותו על פי דין.</li>
        <li>כל שינוי בזכרון דברים זה ייעשה בכתב ובחתימת שני הצדדים.</li>
        <li>ידוע לקונה כי ממועד העברת הבעלות, ביטוח הרכב והאחריות עליו עוברים אליו ועל שמו.</li>
        <li>הצדדים מצהירים כי קראו והבינו את זכרון דברים זה, כי הוא משקף את המוסכם ביניהם, וחתמו עליו מרצונם החופשי.</li>
      </ol>

      <p className="sale-date-line">ולראיה באו הצדדים על החתום ביום <B value={he(date)} w={100} />:</p>

      <section className="sale-signs">
        <SignParty title="המוכר" party={seller} signature={signatures.seller} />
        <SignParty title="הקונה" party={buyer} signature={signatures.buyer} />
      </section>

      {(signatures.seller || signatures.buyer) && (
        <section className="sale-cert">
          <p className="sale-cert-title">אימות חתימה אלקטרונית</p>
          {['seller', 'buyer'].map((k) => {
            const s = signatures[k];
            if (!s) return null;
            return (
              <p className="sale-cert-row" key={k}>
                {k === 'seller' ? 'המוכר' : 'הקונה'}: <strong>{s.name || ''}</strong>
                {s.id ? <> (ת.ז <span dir="ltr">{s.id}</span>)</> : null}
                {' '}חתם/ה אלקטרונית בתאריך {fmtDateTime(s.ts)}
                {s.hash ? <> · טביעת אצבע <span dir="ltr">{s.hash}</span></> : null}
              </p>
            );
          })}
          <p className="sale-cert-note">
            החתימות לעיל הן חתימות אלקטרוניות שנעשו במכשיר בהסכמת החותמים. טביעת האצבע מזהה את תוכן המסמך בעת החתימה.
          </p>
        </section>
      )}

      <footer className="sale-disclaimer">
        הופק באמצעות CarReminder. אינו מסמך משפטי רשמי — יש לבדוק את הפרטים, להתאים את הסעיפים לצורך, ולחתום ביד.
      </footer>
    </article>
  );
}

export function VehicleSaleStyles() {
  return (
    <style>{`
      .sale-doc {
        background: #fff; color: #111;
        font-family: 'Heebo', system-ui, -apple-system, sans-serif;
        font-size: 12.5px; line-height: 1.6;
        padding: 26px 30px; max-width: 800px; margin: 0 auto;
        box-sizing: border-box;
      }
      .sale-doc * { box-sizing: border-box; }
      .sale-title { font-size: 19px; font-weight: 800; text-align: center; margin: 0 0 10px; }
      .sale-note {
        font-size: 10.5px; color: #555; line-height: 1.5;
        border: 1px solid #ccc; border-radius: 8px; padding: 7px 10px; margin: 0 0 14px;
        background: #fafafa;
      }
      .sale-pre p { margin: 4px 0; }
      .sale-lead { font-weight: 800; margin-top: 10px !important; }
      .sale-blank {
        display: inline-block; border-bottom: 1px solid #111;
        padding: 0 6px; min-height: 16px; font-weight: 700; text-align: center;
        line-height: 1.4;
      }
      .sale-clauses { margin: 12px 0; padding-inline-start: 20px; }
      .sale-clauses > li { margin: 7px 0; padding-inline-start: 4px; }
      .sale-sub { margin: 6px 0; padding-inline-start: 22px; list-style: hebrew; }
      .sale-sub > li { margin: 4px 0; }
      .sale-date-line { font-weight: 700; margin: 16px 0 8px; }
      .sale-signs { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 6px; }
      .sale-sign-col { border: 1px solid #111; border-radius: 8px; padding: 10px 12px; }
      .sale-sign-title { font-size: 13px; font-weight: 800; margin: 0 0 8px; text-align: center; border-bottom: 1px solid #111; padding-bottom: 5px; }
      .sale-sign-row { display: grid; grid-template-columns: 52px 1fr; gap: 6px; font-size: 11.5px; margin: 3px 0; }
      .sale-sign-k { color: #555; font-weight: 600; }
      .sale-sign-v { border-bottom: 1px dotted #999; font-weight: 700; min-height: 16px; }
      .sale-sign-line { height: 1px; background: #111; margin-top: 20px; }
      .sale-sign-cap { font-size: 10px; color: #555; text-align: center; margin: 3px 0 0; }
      .sale-sign-mark { text-align: center; margin-top: 8px; }
      .sale-sign-img { max-height: 48px; max-width: 92%; display: block; margin: 0 auto 2px; }
      .sale-cert { margin-top: 12px; border: 1px solid #111; border-radius: 8px; padding: 8px 12px; }
      .sale-cert-title { font-size: 11.5px; font-weight: 800; margin: 0 0 5px; }
      .sale-cert-row { font-size: 10.5px; margin: 2px 0; color: #222; }
      .sale-cert-note { font-size: 9.5px; color: #555; margin: 6px 0 0; }
      .sale-disclaimer {
        font-size: 9.5px; line-height: 1.5; color: #555; text-align: center;
        margin-top: 14px; padding-top: 8px; border-top: 1px dashed #999;
      }
    `}</style>
  );
}

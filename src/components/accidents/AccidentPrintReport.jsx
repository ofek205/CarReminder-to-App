import React from 'react';

/**
 * AccidentPrintReport — single-page case summary.
 *
 * Design rewrite (v2): the previous version was a vertically stacked
 * 10-section form. Insurance adjusters and police clerks scan, they
 * don't read top-to-bottom. v2 collapses everything into a one-page
 * brief:
 *
 *   • Header strip with brand + report id + production date.
 *   • Summary card: date/time, location, parties' plates, status pills.
 *     (The reader gets 80% of the briefing in 3 lines here.)
 *   • Description + damage as tight inline blocks (no section bars).
 *   • Two-column comparison of "המדווח" vs "הצד הפוגע" — efficient at
 *     showing equivalent fields side by side.
 *   • Witnesses, police, injuries collapsed into thin bars / pills.
 *   • Photo grid (4 per row in preview, 3 in print).
 *   • Signature line + footer disclaimer.
 *
 * Used by AddAccident in two modes:
 *   variant="preview" — visible in the in-app modal, sheet styling.
 *   variant="print"   — hidden until window.print() flips it visible.
 */
export default function AccidentPrintReport({
  accident,
  vehicle,
  reporter, // { name, phone } from auth/profile, both optional
  variant = 'print',
}) {
  if (!accident) return null;
  const cls = variant === 'preview' ? 'accident-report-preview' : 'accident-report-print';
  const reportId = (accident.id || '').slice(0, 8).toUpperCase();
  const todayStr = formatDate(new Date().toISOString());

  const myParty = {
    name:  reporter?.name || '',
    phone: reporter?.phone || '',
    plate: vehicle?.license_plate || '',
    car:   [vehicle?.manufacturer, vehicle?.model, vehicle?.year].filter(Boolean).join(' '),
    color: vehicle?.color || '',
    insurance: vehicle?.insurance_company || '',
    vin:   vehicle?.vin || '',
  };
  const otherParty = {
    name:  accident.other_driver_name || '',
    phone: accident.other_driver_phone || '',
    plate: accident.other_driver_plate || '',
    car:   [accident.other_driver_manufacturer, accident.other_driver_model, accident.other_driver_year].filter(Boolean).join(' '),
    insurance: accident.other_driver_insurance_company || '',
  };
  const hasOther = Object.values(otherParty).some(Boolean) || !!accident.other_driver_insurance_photo;

  return (
    <article className={cls} dir="rtl" aria-hidden={variant === 'print'}>
      {/* ── 1. Compact header strip ────────────────────────────────── */}
      <header className="rep-head">
        <div className="rep-head-brand">
          <div className="rep-logo">CR</div>
          <div>
            <p className="rep-title">דוח תאונת דרכים</p>
            <p className="rep-subtitle">CarReminder · דוח רשמי</p>
          </div>
        </div>
        <div className="rep-meta">
          {reportId && <span>מזהה: {reportId}</span>}
          <span>הופק: {todayStr}</span>
        </div>
      </header>

      {/* ── 2. Summary card — the at-a-glance briefing ─────────────── */}
      <section className="rep-summary">
        <div className="rep-summary-line rep-summary-when">
          {[formatDate(accident.date), accident.time].filter(Boolean).join(' · ')}
        </div>
        {accident.location && (
          <div className="rep-summary-line rep-summary-where">
            {accident.location}
            {(accident.latitude != null && accident.longitude != null) && (
              <span className="rep-summary-coords"> ({Number(accident.latitude).toFixed(4)}, {Number(accident.longitude).toFixed(4)})</span>
            )}
          </div>
        )}

        {(myParty.car || myParty.plate || hasOther) && (
          <div className="rep-summary-line rep-summary-parties">
            {(myParty.car || myParty.plate) && (
              <span className="rep-party-tag rep-party-mine">
                {[myParty.car, myParty.plate ? `(${myParty.plate})` : ''].filter(Boolean).join(' ')}
              </span>
            )}
            {hasOther && (myParty.car || myParty.plate) && <span className="rep-vs">↔</span>}
            {hasOther && (
              <span className="rep-party-tag rep-party-other">
                {[otherParty.car, otherParty.plate ? `(${otherParty.plate})` : ''].filter(Boolean).join(' ') || 'הצד הפוגע'}
              </span>
            )}
          </div>
        )}

        <div className="rep-pills">
          {accident.status && <Pill kind={statusKind(accident.status)}>{accident.status}</Pill>}
          {accident.injured && <Pill kind="alert">נפגעים</Pill>}
          {accident.police_report_number && <Pill kind="muted">משטרה: {accident.police_report_number}</Pill>}
          {Array.isArray(accident.photos) && accident.photos.length > 0 && (
            <Pill kind="muted">{accident.photos.length} תמונות</Pill>
          )}
        </div>
      </section>

      {/* ── 3. Description + damage (tight inline blocks) ──────────── */}
      {(accident.description || accident.damage_description) && (
        <section className="rep-prose">
          {accident.description && (
            <div className="rep-prose-block">
              <p className="rep-prose-label">נסיבות</p>
              <p className="rep-prose-text">{accident.description}</p>
            </div>
          )}
          {accident.damage_description && (
            <div className="rep-prose-block">
              <p className="rep-prose-label">נזק לרכב המדווח</p>
              <p className="rep-prose-text">{accident.damage_description}</p>
            </div>
          )}
        </section>
      )}

      {/* ── 4. Parties — two-column compare ────────────────────────── */}
      <section className="rep-parties">
        <PartyColumn title="המדווח" party={myParty} />
        <PartyColumn title="הצד הפוגע" party={otherParty} muted={!hasOther} />
      </section>

      {/* ── 5. Insurance proof photo (if present) ──────────────────── */}
      {accident.other_driver_insurance_photo && (
        <section className="rep-prose">
          <p className="rep-prose-label">צילום תעודת ביטוח של הצד הפוגע</p>
          <img className="rep-doc-photo" src={accident.other_driver_insurance_photo} alt="" />
        </section>
      )}

      {/* ── 6. Optional details (injuries, police station, witnesses) ── */}
      {(accident.injured && accident.injuries_details) && (
        <section className="rep-prose">
          <p className="rep-prose-label">פרטי נפגעים</p>
          <p className="rep-prose-text">{accident.injuries_details}</p>
        </section>
      )}

      {accident.police_station && (
        <p className="rep-inline-line">תחנת משטרה: <strong>{accident.police_station}</strong></p>
      )}

      {Array.isArray(accident.witnesses) && accident.witnesses.length > 0 && (
        <section className="rep-witnesses">
          <p className="rep-prose-label">עדים ({accident.witnesses.length})</p>
          <div className="rep-witness-list">
            {accident.witnesses.map((w, i) => (
              <div key={i} className="rep-witness-row">
                <span className="rep-witness-name">{w.name || `עד ${i + 1}`}</span>
                {w.phone && <span className="rep-witness-phone">{w.phone}</span>}
                {w.statement && <span className="rep-witness-statement">{w.statement}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 7. Photos — denser grid ────────────────────────────────── */}
      {Array.isArray(accident.photos) && accident.photos.length > 0 && (
        <section className="rep-photos">
          <p className="rep-prose-label">תמונות מהאירוע</p>
          <div className="rep-photo-grid">
            {accident.photos.map((src, i) => (
              <div key={i} className="rep-photo-cell">
                <img src={src} alt="" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 8. Signature row ──────────────────────────────────────── */}
      <section className="rep-sign">
        <div>
          <div className="rep-sign-line"></div>
          <p>חתימת המדווח {reporter?.name ? `· ${reporter.name}` : ''}</p>
        </div>
        <div>
          <div className="rep-sign-line"></div>
          <p>תאריך החתימה · {todayStr}</p>
        </div>
      </section>

      {/* ── 9. Footer disclaimer ──────────────────────────────────── */}
      <footer className="rep-disclaimer">
        הופק אוטומטית מ-CarReminder לפי המידע שהוזן ע"י בעל הרכב. אינו מהווה מסמך משפטי או הצהרה רשמית. יש לאמת את הפרטים לפני הגשה לחברת הביטוח או למשטרה.
      </footer>
    </article>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function Pill({ children, kind = 'muted' }) {
  return <span className={`rep-pill rep-pill-${kind}`}>{children}</span>;
}

function PartyColumn({ title, party, muted = false }) {
  const rows = [
    ['שם',    party.name],
    ['טלפון', party.phone],
    ['רכב',   [party.car, party.plate ? `(${party.plate})` : ''].filter(Boolean).join(' ')],
    ['ביטוח', party.insurance],
  ].filter(([, v]) => !!v);

  if (rows.length === 0) {
    return (
      <div className={`rep-party-col ${muted ? 'rep-party-muted' : ''}`}>
        <p className="rep-party-title">{title}</p>
        <p className="rep-party-empty">לא הוזנו פרטים</p>
      </div>
    );
  }
  return (
    <div className={`rep-party-col ${muted ? 'rep-party-muted' : ''}`}>
      <p className="rep-party-title">{title}</p>
      {rows.map(([k, v]) => (
        <p key={k} className="rep-party-row">
          <span className="rep-party-key">{k}</span>
          <span className="rep-party-val">{v}</span>
        </p>
      ))}
    </div>
  );
}

function statusKind(status) {
  if (status === 'פתוח')   return 'alert';
  if (status === 'בטיפול') return 'warn';
  if (status === 'סגור')   return 'ok';
  return 'muted';
}

function formatDate(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  } catch { return String(value); }
}

/**
 * Print + preview styles. v2 design notes:
 *   • Tighter type scale (10.5-12px body, 13px summary, 14.5px page title).
 *   • Section bars dropped — labels are short bold inline strings.
 *   • Two-column party block carries the bulk of the data with minimal
 *     vertical real estate.
 *   • Photos packed 4-up in preview, 3-up in print.
 */
export function AccidentPrintStyles() {
  return (
    <style>{`
      .accident-report-print { display: none; }

      .accident-report-preview {
        background: #fff;
        color: #1a1a1a;
        font-family: 'Heebo', system-ui, -apple-system, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        padding: 22px 26px;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.08);
        max-width: 760px;
        margin: 0 auto;
      }

      /* Shared structural styles between preview and print. */
      .accident-report-preview *,
      .accident-report-print  * { box-sizing: border-box; }

      /* ── Header strip ─────────────────────────────────────────── */
      .accident-report-preview .rep-head,
      .accident-report-print .rep-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding-bottom: 10px;
        border-bottom: 2px solid #1f2937;
        margin-bottom: 12px;
      }
      .accident-report-preview .rep-head-brand,
      .accident-report-print .rep-head-brand {
        display: flex;
        align-items: center;
        gap: 9px;
      }
      .accident-report-preview .rep-logo,
      .accident-report-print .rep-logo {
        width: 36px;
        height: 36px;
        background: #1f2937;
        color: #fff;
        font-weight: 800;
        font-size: 14px;
        letter-spacing: 0.05em;
        border-radius: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .accident-report-preview .rep-title,
      .accident-report-print .rep-title {
        font-size: 14.5px;
        font-weight: 800;
        color: #1f2937;
        margin: 0;
      }
      .accident-report-preview .rep-subtitle,
      .accident-report-print .rep-subtitle {
        font-size: 10.5px;
        color: #6b7280;
        margin: 1px 0 0;
      }
      .accident-report-preview .rep-meta,
      .accident-report-print .rep-meta {
        display: flex;
        gap: 14px;
        font-size: 10.5px;
        color: #4b5563;
        font-weight: 600;
      }

      /* ── Summary card ────────────────────────────────────────── */
      .accident-report-preview .rep-summary,
      .accident-report-print .rep-summary {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 10px 14px;
        margin-bottom: 10px;
      }
      .accident-report-preview .rep-summary-line,
      .accident-report-print .rep-summary-line {
        margin: 0 0 4px;
      }
      .accident-report-preview .rep-summary-when,
      .accident-report-print .rep-summary-when {
        font-size: 13.5px;
        font-weight: 800;
        color: #1f2937;
      }
      .accident-report-preview .rep-summary-where,
      .accident-report-print .rep-summary-where {
        font-size: 11.5px;
        color: #4b5563;
        font-weight: 600;
      }
      .accident-report-preview .rep-summary-coords,
      .accident-report-print .rep-summary-coords {
        font-size: 10px;
        color: #9ca3af;
        font-weight: 500;
      }
      .accident-report-preview .rep-summary-parties,
      .accident-report-print .rep-summary-parties {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11.5px;
        color: #1f2937;
        margin-top: 6px;
      }
      .accident-report-preview .rep-party-tag,
      .accident-report-print .rep-party-tag {
        font-weight: 700;
      }
      .accident-report-preview .rep-vs,
      .accident-report-print .rep-vs {
        color: #9ca3af;
        font-weight: 700;
      }

      /* ── Pills ────────────────────────────────────────────────── */
      .accident-report-preview .rep-pills,
      .accident-report-print .rep-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .accident-report-preview .rep-pill,
      .accident-report-print .rep-pill {
        display: inline-block;
        padding: 2px 9px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 700;
        line-height: 1.6;
      }
      .accident-report-preview .rep-pill-alert,
      .accident-report-print .rep-pill-alert { background: #fee2e2; color: #991b1b; }
      .accident-report-preview .rep-pill-warn,
      .accident-report-print .rep-pill-warn  { background: #fef3c7; color: #92400e; }
      .accident-report-preview .rep-pill-ok,
      .accident-report-print .rep-pill-ok    { background: #dcfce7; color: #166534; }
      .accident-report-preview .rep-pill-muted,
      .accident-report-print .rep-pill-muted { background: #e5e7eb; color: #1f2937; }

      /* ── Prose blocks (description, damage, prefilled labels) ──── */
      .accident-report-preview .rep-prose,
      .accident-report-print .rep-prose {
        margin-bottom: 10px;
      }
      .accident-report-preview .rep-prose-block,
      .accident-report-print .rep-prose-block {
        margin: 0 0 6px;
      }
      .accident-report-preview .rep-prose-label,
      .accident-report-print .rep-prose-label {
        font-size: 10.5px;
        font-weight: 800;
        color: #1f2937;
        margin: 0 0 2px;
        letter-spacing: 0.02em;
      }
      .accident-report-preview .rep-prose-text,
      .accident-report-print .rep-prose-text {
        font-size: 11.5px;
        color: #1f2937;
        white-space: pre-wrap;
        margin: 0;
      }
      .accident-report-preview .rep-doc-photo,
      .accident-report-print .rep-doc-photo {
        max-width: 220px;
        max-height: 130px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        margin-top: 4px;
      }

      /* ── Parties (two-column compare) ──────────────────────────── */
      .accident-report-preview .rep-parties,
      .accident-report-print .rep-parties {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-bottom: 10px;
      }
      .accident-report-preview .rep-party-col,
      .accident-report-print .rep-party-col {
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 8px 12px;
      }
      .accident-report-preview .rep-party-muted,
      .accident-report-print .rep-party-muted {
        opacity: 0.7;
        background: #f9fafb;
      }
      .accident-report-preview .rep-party-title,
      .accident-report-print .rep-party-title {
        font-size: 11px;
        font-weight: 800;
        color: #1f2937;
        margin: 0 0 5px;
        padding-bottom: 4px;
        border-bottom: 1px solid #e5e7eb;
      }
      .accident-report-preview .rep-party-row,
      .accident-report-print .rep-party-row {
        display: grid;
        grid-template-columns: 50px 1fr;
        gap: 6px;
        font-size: 11px;
        margin: 2px 0;
        line-height: 1.5;
      }
      .accident-report-preview .rep-party-key,
      .accident-report-print .rep-party-key {
        color: #6b7280;
        font-weight: 600;
      }
      .accident-report-preview .rep-party-val,
      .accident-report-print .rep-party-val {
        color: #1f2937;
        font-weight: 700;
        word-break: break-word;
      }
      .accident-report-preview .rep-party-empty,
      .accident-report-print .rep-party-empty {
        font-size: 10.5px;
        color: #9ca3af;
        font-style: italic;
        margin: 0;
      }

      /* ── Inline single-line label ───────────────────────────────── */
      .accident-report-preview .rep-inline-line,
      .accident-report-print .rep-inline-line {
        font-size: 11px;
        color: #1f2937;
        margin: 0 0 8px;
      }

      /* ── Witnesses (compact rows) ───────────────────────────────── */
      .accident-report-preview .rep-witnesses,
      .accident-report-print .rep-witnesses {
        margin-bottom: 10px;
      }
      .accident-report-preview .rep-witness-list,
      .accident-report-print .rep-witness-list {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .accident-report-preview .rep-witness-row,
      .accident-report-print .rep-witness-row {
        font-size: 11px;
        line-height: 1.5;
        padding: 3px 6px;
        background: #f9fafb;
        border-radius: 4px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: baseline;
      }
      .accident-report-preview .rep-witness-name,
      .accident-report-print .rep-witness-name {
        font-weight: 700;
        color: #1f2937;
      }
      .accident-report-preview .rep-witness-phone,
      .accident-report-print .rep-witness-phone {
        color: #4b5563;
        font-weight: 500;
        font-size: 10.5px;
      }
      .accident-report-preview .rep-witness-statement,
      .accident-report-print .rep-witness-statement {
        color: #4b5563;
        font-style: italic;
        font-size: 10.5px;
      }

      /* ── Photos (denser grid) ──────────────────────────────────── */
      .accident-report-preview .rep-photos,
      .accident-report-print .rep-photos {
        margin-bottom: 12px;
      }
      .accident-report-preview .rep-photo-grid,
      .accident-report-print .rep-photo-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 5px;
        margin-top: 4px;
      }
      .accident-report-preview .rep-photo-cell,
      .accident-report-print .rep-photo-cell {
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
        border-radius: 5px;
        overflow: hidden;
      }
      .accident-report-preview .rep-photo-cell img,
      .accident-report-print .rep-photo-cell img {
        width: 100%;
        height: 90px;
        object-fit: cover;
        display: block;
      }

      /* ── Signature row ─────────────────────────────────────────── */
      .accident-report-preview .rep-sign,
      .accident-report-print .rep-sign {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 28px;
        margin-top: 12px;
      }
      .accident-report-preview .rep-sign p,
      .accident-report-print .rep-sign p {
        font-size: 10px;
        color: #6b7280;
        margin: 4px 0 0;
        text-align: center;
        font-weight: 600;
      }
      .accident-report-preview .rep-sign-line,
      .accident-report-print .rep-sign-line {
        height: 1px;
        background: #1f2937;
      }

      /* ── Footer disclaimer ─────────────────────────────────────── */
      .accident-report-preview .rep-disclaimer,
      .accident-report-print .rep-disclaimer {
        font-size: 9px;
        line-height: 1.45;
        color: #9ca3af;
        text-align: center;
        margin-top: 12px;
        padding-top: 8px;
        border-top: 1px dashed #e5e7eb;
      }

      /* ── Print mode ────────────────────────────────────────────── */
      @media print {
        @page { size: A4 portrait; margin: 10mm 12mm; }
        body * { visibility: hidden !important; }
        .accident-report-print, .accident-report-print * { visibility: visible !important; }
        .accident-report-print {
          display: block !important;
          position: absolute;
          inset: 0;
          width: 100%;
          padding: 0;
          background: #fff;
          color: #1a1a1a;
          font-family: 'Heebo', system-ui, -apple-system, sans-serif;
          font-size: 10.5px;
          line-height: 1.45;
        }
        /* Photo grid drops to 3 columns in print so each thumb fills more
           of the row and stays legible at A4 widths. */
        .accident-report-print .rep-photo-grid {
          grid-template-columns: repeat(3, 1fr);
        }
        .accident-report-print .rep-photo-cell img {
          height: 110px;
        }
        /* Avoid awkward page splits inside any "block" of related info. */
        .accident-report-print .rep-summary,
        .accident-report-print .rep-prose,
        .accident-report-print .rep-parties,
        .accident-report-print .rep-witnesses,
        .accident-report-print .rep-photos,
        .accident-report-print .rep-sign {
          page-break-inside: avoid;
        }
      }
    `}</style>
  );
}

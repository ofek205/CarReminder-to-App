import React from 'react';
import { AlertTriangle, Phone, ExternalLink, Wrench } from 'lucide-react';

/**
 * RecallCard — surfaces OPEN manufacturer recalls (קריאות שירות / ריקול)
 * for a vehicle as an actionable, safety-toned card.
 *
 * Data shape (per recall), as returned by vehicleLookup.fetchOpenRecallsForPlate
 * / the lookup's `open_recalls`:
 *   { id, type, defectType, description, openedDate, fixMethod, importer, phone, website }
 *
 * States:
 *   • loading  → thin skeleton (non-blocking; the rest of the screen renders).
 *   • empty / error → render NOTHING (no "no recalls" noise, no false negative).
 *   • populated → red card, one block per recall, with call / website actions.
 *
 * The recall data is gov-sourced and best-effort: the parent passes
 * `recalls={null}` when it has nothing to show, so this component simply
 * returns null in that case.
 */

// gov.il WEBSITE values come without a scheme (e.g. "WWW.TOYOTA.CO.IL/..."),
// which would resolve relative to our origin. Force an absolute https URL.
function toHref(website) {
  const w = String(website || '').trim();
  if (!w) return null;
  if (/^https?:\/\//i.test(w)) return w;
  return `https://${w}`;
}

function isSafety(rec) {
  return /בטיחות/i.test(rec?.defectType || '') || /בטיחות/i.test(rec?.type || '');
}

export default function RecallCard({ recalls, loading = false }) {
  if (loading) {
    return (
      <div
        className="rounded-2xl px-4 py-3 animate-pulse"
        style={{ background: '#FEF2F2', border: '1.5px solid #FECACA' }}
        dir="rtl"
        aria-busy="true"
      >
        <div className="h-3 w-40 rounded" style={{ background: '#FECACA' }} />
        <div className="h-2.5 w-full mt-2 rounded" style={{ background: '#FEE2E2' }} />
      </div>
    );
  }

  const list = Array.isArray(recalls) ? recalls.filter(Boolean) : [];
  if (list.length === 0) return null;

  const anySafety = list.some(isSafety);

  return (
    <div
      className="rounded-2xl px-3.5 py-2.5"
      style={{ background: '#FEF2F2', border: '1.5px solid #FECACA' }}
      dir="rtl"
      role="group"
      aria-label="קריאות ריקול פתוחות"
    >
      {/* Header — single compact row */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: '#B91C1C' }} />
        <p className="flex-1 min-w-0 text-[13px] font-bold leading-tight" style={{ color: '#B91C1C' }}>
          {list.length === 1 ? 'קריאת ריקול פתוחה' : `${list.length} קריאות ריקול פתוחות`}
          <span className="font-medium" style={{ color: '#DC2626' }}> · תיקון חינם אצל היבואן</span>
        </p>
        {anySafety && (
          <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-bold"
            style={{ background: '#B91C1C', color: '#fff' }}>
            בטיחותי
          </span>
        )}
      </div>

      {/* One block per recall */}
      <div className="mt-2 space-y-2">
        {list.map((rec, idx) => {
          const href = toHref(rec.website);
          const phone = (rec.phone || '').trim();
          // Match + dates, condensed into one muted line (model/years confirm
          // relevance; "פתוח עד התיקון" clarifies there is no end date —
          // an open recall stays open until performed).
          const matchBits = [
            [rec.campaignManufacturer, rec.campaignModel].filter(Boolean).join(' ').trim(),
            (rec.buildFrom && rec.buildTo) ? `ייצור ${rec.buildFrom}–${rec.buildTo}` : null,
          ].filter(Boolean).join(' · ');
          const dateBits = [
            rec.openedDate ? `נפתח ${rec.openedDate}` : null,
            'פתוח עד לביצוע התיקון (ללא תאריך סיום)',
          ].filter(Boolean).join(' · ');
          return (
            <div
              key={rec.id || idx}
              className="rounded-xl p-2.5"
              style={{ background: '#fff', border: '1px solid #FECACA' }}
            >
              {rec.description && (
                <p className="text-[11px] leading-snug" style={{ color: '#1C2E20' }}>
                  {rec.description}
                </p>
              )}

              {/* Compact meta chips */}
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold"
                  style={{ background: '#FEF3C7', color: '#92400E' }}>
                  טרם טופל
                </span>
                {rec.defectType && (
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold"
                    style={{ background: '#FEF2F2', color: '#B91C1C' }}>
                    {rec.defectType}
                  </span>
                )}
                {rec.fixMethod && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold"
                    style={{ background: '#F0F4F1', color: '#2D5233' }}>
                    <Wrench className="w-2.5 h-2.5" /> {rec.fixMethod}
                  </span>
                )}
              </div>

              {/* Match + dates line (incl. the "no end date" clarification) */}
              <p className="text-[10px] leading-snug mt-1" style={{ color: '#8B9C8E' }}>
                {matchBits ? `חל על: ${matchBits} · ` : ''}{dateBits}
              </p>

              {/* Actions — compact */}
              {(phone || href) && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {phone && (
                    <a
                      href={`tel:${phone.replace(/\s/g, '')}`}
                      className="inline-flex items-center justify-center gap-1 h-8 px-2.5 rounded-lg text-[11px] font-bold text-white active:scale-[0.98] transition-transform"
                      style={{ background: '#2D5233' }}
                    >
                      <Phone className="w-3.5 h-3.5" /> התקשר ליבואן
                    </a>
                  )}
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1 h-8 px-2.5 rounded-lg text-[11px] font-bold active:scale-[0.98] transition-transform"
                      style={{ background: '#fff', color: '#2D5233', border: '1.5px solid #2D5233' }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> לאתר הריקול
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
      className="rounded-2xl overflow-hidden"
      style={{ background: '#FEF2F2', border: '1.5px solid #FECACA' }}
      dir="rtl"
      role="group"
      aria-label="קריאות ריקול פתוחות"
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
        <span
          className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center"
          style={{ background: '#FEE2E2' }}
        >
          <AlertTriangle className="w-5 h-5" style={{ color: '#B91C1C' }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight" style={{ color: '#B91C1C' }}>
            {list.length === 1 ? 'קריאת ריקול פתוחה' : `${list.length} קריאות ריקול פתוחות`}
          </p>
          <p className="text-[11px] font-medium leading-tight mt-0.5" style={{ color: '#DC2626' }}>
            לפי משרד התחבורה · התיקון מתבצע אצל היבואן ללא עלות
          </p>
        </div>
        {anySafety && (
          <span
            className="shrink-0 px-2 py-0.5 rounded-lg text-[10px] font-bold"
            style={{ background: '#B91C1C', color: '#fff' }}
          >
            ליקוי בטיחותי
          </span>
        )}
      </div>

      {/* One block per recall */}
      <div className="px-4 pb-3.5 space-y-2.5">
        {list.map((rec, idx) => {
          const href = toHref(rec.website);
          const phone = (rec.phone || '').trim();
          return (
            <div
              key={rec.id || idx}
              className="rounded-xl p-3"
              style={{ background: '#fff', border: '1px solid #FECACA' }}
            >
              {rec.description && (
                <p className="text-xs leading-relaxed" style={{ color: '#1C2E20' }}>
                  {rec.description}
                </p>
              )}

              {/* Meta chips */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {rec.defectType && (
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold"
                    style={{ background: '#FEF2F2', color: '#B91C1C' }}>
                    {rec.defectType}
                  </span>
                )}
                {rec.fixMethod && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold"
                    style={{ background: '#F0F4F1', color: '#2D5233' }}>
                    <Wrench className="w-3 h-3" /> אופן תיקון: {rec.fixMethod}
                  </span>
                )}
                {rec.openedDate && (
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-medium" style={{ color: '#8B9C8E' }}>
                    נפתח: {rec.openedDate}
                  </span>
                )}
              </div>

              {/* Actions */}
              {(phone || href) && (
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {phone && (
                    <a
                      href={`tel:${phone.replace(/\s/g, '')}`}
                      className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl text-xs font-bold text-white active:scale-[0.98] transition-transform"
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
                      className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl text-xs font-bold active:scale-[0.98] transition-transform"
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

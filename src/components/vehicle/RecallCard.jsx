import React, { useState } from 'react';
import { AlertTriangle, Phone, ExternalLink, Wrench, ChevronDown } from 'lucide-react';

/**
 * RecallCard — surfaces OPEN manufacturer recalls (קריאות שירות / ריקול)
 * for a vehicle.
 *
 * Design (per owner feedback 2026-06): recalls are useful but NOT the most
 * important thing on the vehicle screen, so this renders COLLAPSED by
 * default — a single compact title row ("N קריאות ריקול פתוחות"). Whoever
 * wants the details taps it to expand the full per-recall blocks (defect
 * text, fix method, call / website actions). It also lives low on the
 * screen, below the day-to-day status cards.
 *
 * Data shape (per recall) from vehicleLookup.fetchOpenRecallsForPlate:
 *   { id, type, defectType, description, openedDate, fixMethod, importer, phone, website }
 *
 * States:
 *   • loading  → thin skeleton (non-blocking).
 *   • empty / error → render NOTHING (no "no recalls" noise).
 *   • populated → collapsed title row; tap to expand.
 */

// gov.il WEBSITE values come without a scheme — force an absolute https URL.
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
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <div
        className="rounded-xl px-3 py-2 animate-pulse"
        style={{ background: '#FEF6F6', border: '1px solid #F3D0D0' }}
        dir="rtl"
        aria-busy="true"
      >
        <div className="h-2.5 w-40 rounded" style={{ background: '#F3D0D0' }} />
      </div>
    );
  }

  const list = Array.isArray(recalls) ? recalls.filter(Boolean) : [];
  if (list.length === 0) return null;

  const anySafety = list.some(isSafety);
  const title = list.length === 1 ? 'קריאת ריקול פתוחה' : `${list.length} קריאות ריקול פתוחות`;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: '#FEF6F6', border: '1px solid #F3D0D0' }}
      dir="rtl"
      role="group"
      aria-label="קריאות ריקול פתוחות"
    >
      {/* Collapsed header — compact, de-emphasized, tap to expand */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-right"
      >
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: '#B91C1C' }} />
        <span className="flex-1 min-w-0 text-[12.5px] font-bold leading-tight" style={{ color: '#B91C1C' }}>
          {title}
        </span>
        {anySafety && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold"
            style={{ background: '#B91C1C', color: '#fff' }}>
            בטיחותי
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          style={{ color: '#B91C1C' }}
        />
      </button>

      {/* Expanded — one block per recall */}
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[11px] font-medium -mt-1 mb-1" style={{ color: '#DC2626' }}>
            תיקון חינם אצל היבואן
          </p>
          {list.map((rec, idx) => {
            const href = toHref(rec.website);
            const phone = (rec.phone || '').trim();
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

                <p className="text-[10px] leading-snug mt-1" style={{ color: '#8B9C8E' }}>
                  {matchBits ? `חל על: ${matchBits} · ` : ''}{dateBits}
                </p>

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
      )}
    </div>
  );
}

import React from 'react';
import { Phone } from 'lucide-react';

/**
 * RoadsideHelpCard — compact quick-dial tile for ידידים (volunteer roadside
 * assistance, hotline 1230). Sized like the logo (~150px square), NOT a
 * full-width row, so several quick-dial tiles can sit in a wrapping grid.
 *
 * The whole tile is the dial target (tel:1230). The section-level "how it
 * works?" explainer lives next to the "חיוג מהיר" title (see Dashboard), not
 * inside the tile, to keep the tile clean.
 *
 * Logo is object-contain at a fixed height / auto width → keeps aspect ratio.
 */
export default function RoadsideHelpCard() {
  return (
    <a
      href="tel:1230"
      dir="rtl"
      aria-label="חיוג מהיר לידידים, עזרה בכביש, 1230"
      className="w-[150px] aspect-square flex flex-col items-center justify-center text-center gap-1.5 p-3 rounded-2xl active:scale-[0.97] transition-transform"
      style={{ background: '#fff', border: '1.5px solid #E5EBE6', boxShadow: '0 2px 12px rgba(45,82,51,0.06)' }}
    >
      <img
        src="/logo-1230.png"
        alt="ידידים 1230"
        className="h-11 w-auto object-contain"
        loading="lazy"
      />
      <p className="text-[13px] font-bold leading-tight" style={{ color: '#1C2E20' }}>ידידים</p>
      <span
        className="inline-flex items-center gap-1 text-xs font-bold"
        style={{ color: '#2D5233' }}
      >
        <Phone className="w-3 h-3" /> 1230
      </span>
    </a>
  );
}

import React from 'react';
import { Phone } from 'lucide-react';

/**
 * RoadsideHelpCard — single quick-dial card for ידידים (volunteer roadside
 * assistance, hotline 1230). A centered, width-bounded card (not a
 * full-width row, not a lonely tiny square): logo + name + a clear "חייג
 * 1230" call button. The whole card dials tel:1230.
 *
 * The "how it works?" explainer lives next to the "חיוג מהיר" title in the
 * Dashboard, not inside the card. Logo is object-contain → keeps its aspect
 * ratio.
 */
export default function RoadsideHelpCard() {
  return (
    <a
      href="tel:1230"
      dir="rtl"
      aria-label="חיוג מהיר לידידים, עזרה בכביש, 1230"
      className="mx-auto max-w-xs flex items-center gap-3 rounded-2xl px-4 py-3 active:scale-[0.98] transition-transform"
      style={{ background: '#fff', border: '1.5px solid #E5EBE6', boxShadow: '0 2px 12px rgba(45,82,51,0.06)' }}
    >
      <img
        src="/logo-1230.png"
        alt="ידידים 1230"
        className="h-12 w-auto object-contain shrink-0"
        loading="lazy"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-tight" style={{ color: '#1C2E20' }}>ידידים</p>
        <p className="text-xs leading-tight mt-0.5" style={{ color: '#8B9C8E' }}>עזרה בכביש · זמינים 24/7</p>
      </div>
      <span
        className="shrink-0 inline-flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-bold text-white"
        style={{ background: '#2D5233' }}
      >
        <Phone className="w-4 h-4" /> חייג 1230
      </span>
    </a>
  );
}

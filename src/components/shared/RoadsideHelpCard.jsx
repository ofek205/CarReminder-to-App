import React from 'react';
import { Phone, HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * RoadsideHelpCard — square quick-dial tile for ידידים (volunteer roadside
 * assistance, hotline 1230, 24/7). Designed to sit in a grid alongside more
 * quick-dial tiles, so it's a SQUARE, not a full-width row.
 *
 * Layout note: the dial target is an <a href="tel:1230"> filling the tile.
 * The "?" explainer is a SEPARATE button overlaid in the corner (sibling of
 * the <a>, not nested — interactive content can't live inside an anchor),
 * so tapping it opens the info popover without dialing.
 *
 * The logo is object-contain at a fixed height / auto width, so it keeps its
 * aspect ratio and never stretches.
 */
export default function RoadsideHelpCard() {
  return (
    <div
      dir="rtl"
      className="relative rounded-2xl overflow-hidden"
      style={{ background: '#fff', border: '1.5px solid #E5EBE6', boxShadow: '0 2px 12px rgba(45,82,51,0.06)' }}
    >
      <a
        href="tel:1230"
        aria-label="חיוג מהיר לידידים, עזרה בכביש, 1230"
        className="aspect-square flex flex-col items-center justify-center text-center gap-1.5 p-3 active:scale-[0.97] transition-transform"
      >
        <img
          src="/logo-1230.png"
          alt="ידידים 1230"
          className="h-11 w-auto object-contain"
          loading="lazy"
        />
        <p className="text-[13px] font-bold leading-tight" style={{ color: '#1C2E20' }}>ידידים</p>
        <p className="text-[11px] leading-tight" style={{ color: '#8B9C8E' }}>עזרה בכביש · 24/7</p>
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-white"
          style={{ background: '#2D5233' }}
        >
          <Phone className="w-3.5 h-3.5" /> חייג 1230
        </span>
      </a>

      {/* "?" explainer — overlaid in the corner, outside the <a>, never dials */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="מה זה ידידים?"
            className="absolute top-1.5 left-1.5 w-7 h-7 flex items-center justify-center rounded-full"
            style={{ color: '#8B9C8E', background: '#F0F4F1' }}
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" dir="rtl" className="w-64 text-xs leading-relaxed">
          <b style={{ color: '#1C2E20' }}>ידידים</b> הוא ארגון מתנדבים שעוזר בחינם בתקלות בדרך:
          פנצ'ר, מצבר ריק, מפתחות שננעלו ברכב, דלק שנגמר ועוד. זמינים מסביב לשעון בחיוג 1230.
        </PopoverContent>
      </Popover>
    </div>
  );
}

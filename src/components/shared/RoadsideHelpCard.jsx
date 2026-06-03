import React from 'react';
import { Phone, HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * RoadsideHelpCard — one-tap dial to ידידים (the volunteer roadside-assistance
 * org, hotline 1230, 24/7). Pinned at the bottom of the home screen so a
 * stranded driver reaches free help in a single tap.
 *
 * Layout note: the dial target is an <a href="tel:1230"> covering the logo +
 * text + phone icon. The "?" explainer is a SEPARATE button OUTSIDE that <a>
 * (interactive content can't nest inside an anchor) — tapping it opens the
 * info popover without triggering a call.
 *
 * The logo is rendered object-contain at a fixed height with auto width, so
 * it keeps its aspect ratio and never stretches.
 */
export default function RoadsideHelpCard() {
  return (
    <div
      dir="rtl"
      className="mt-6 mb-2 flex items-center gap-1.5 rounded-2xl px-3 py-2.5"
      style={{ background: '#fff', border: '1.5px solid #E5EBE6', boxShadow: '0 2px 12px rgba(45,82,51,0.06)' }}
    >
      {/* Dial area — the whole row except the (?) */}
      <a
        href="tel:1230"
        aria-label="חיוג מהיר לידידים — עזרה בכביש, 1230"
        className="flex-1 min-w-0 flex items-center gap-3 active:scale-[0.98] transition-transform"
      >
        <img
          src="/logo-1230.png"
          alt="ידידים 1230"
          className="h-12 w-auto object-contain shrink-0"
          loading="lazy"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight" style={{ color: '#1C2E20' }}>
            ידידים — עזרה בכביש
          </p>
          <p className="text-xs leading-tight mt-0.5" style={{ color: '#8B9C8E' }}>
            חיוג מהיר · 1230 · זמינים 24/7
          </p>
        </div>
        <span
          className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl"
          style={{ background: '#2D5233' }}
          aria-hidden="true"
        >
          <Phone className="w-5 h-5 text-white" />
        </span>
      </a>

      {/* "?" explainer — outside the <a>, never dials */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="מה זה ידידים?"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{ color: '#8B9C8E' }}
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" dir="rtl" className="w-64 text-xs leading-relaxed">
          <b style={{ color: '#1C2E20' }}>ידידים</b> — ארגון מתנדבים שעוזר בחינם בתקלות בדרך:
          פנצ'ר, מצבר ריק, מפתחות שננעלו ברכב, דלק שנגמר ועוד. זמינים מסביב לשעון בחיוג 1230.
        </PopoverContent>
      </Popover>
    </div>
  );
}

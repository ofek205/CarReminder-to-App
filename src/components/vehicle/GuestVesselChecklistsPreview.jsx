/**
 * GuestVesselChecklistsPreview — read-only "what checklists look like"
 * card for the demo vessel in guest mode.
 *
 * Why exists:
 *   The authenticated vessel detail page surfaces a `<ChecklistsEntryCard>`
 *   that opens /ChecklistHub. Guests don't have data to back the hub
 *   (no DB rows, no runs), so the card was simply omitted — leaving the
 *   feature invisible in the demo. Users walking through the app
 *   couldn't tell that vessel checklists existed at all.
 *
 *   This component fills that gap: a static preview of the three phase
 *   checklists (engine / pre / post) with sample items, all
 *   non-interactive. Tapping the locked CTA at the bottom routes to
 *   /Auth so curious users can register and try it for real.
 *
 * Designed by PM:
 *   - Three short, recognisable items per phase (not exhaustive — the
 *     point is the *shape* of the feature, not full coverage).
 *   - Visual structure mirrors the real Checklist screen so what you
 *     see in guest mode matches what you'll get after signup.
 *   - Locked-icon affordance + "הירשם כדי להפעיל" line so it's clear
 *     this is a preview, not a bug.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Wrench, Anchor, ArrowDownToLine, Check, Lock, ChevronDown, ChevronUp } from 'lucide-react';

// 3 short, illustrative checklists. Items are deliberately concrete so
// the preview is recognisable to anyone who's set foot on a boat — not
// abstract templates.
const DEMO_PHASES = [
  {
    key: 'engine',
    label: 'בדיקות מנוע',
    icon: Wrench,
    color: '#0277BD',
    bg:    '#E1F5FE',
    items: [
      'בדיקת שמן + רמת מים',
      'בדיקת חיווי טמפרטורה במכשירים',
      'הרצת מנוע למספר דקות לפני הפלגה',
    ],
  },
  {
    key: 'pre',
    label: 'לפני יציאה',
    icon: Anchor,
    color: '#00695C',
    bg:    '#E0F2F1',
    items: [
      'מספר נוסעים + חגורות הצלה במקום',
      'דלק מספיק לכל מסלול ההפלגה',
      'מצברים תקינים, ציוד ניווט פעיל',
    ],
  },
  {
    key: 'post',
    label: 'סיום וקיפול',
    icon: ArrowDownToLine,
    color: '#5E35B1',
    bg:    '#EDE7F6',
    items: [
      'שטיפה במים מתוקים אחרי שייט במלוח',
      'כיבוי ברז דלק + ניתוק מצברים',
      'נעילת התא + כיסוי הגוף',
    ],
  },
];

export default function GuestVesselChecklistsPreview() {
  // One phase open at a time keeps the section compact on mobile —
  // user can browse phases without flooding the screen with items.
  const [openPhase, setOpenPhase] = useState('pre');

  return (
    <div className="rounded-2xl overflow-hidden" dir="rtl"
      style={{ background: '#fff', border: '1.5px solid #E5E7EB' }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2"
        style={{ background: 'linear-gradient(135deg, #E0F7FA, #E0F2F1)' }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: '#fff', border: '1.5px solid #B2EBF2' }}>
          <Anchor className="w-4 h-4" style={{ color: '#00695C' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold" style={{ color: '#1C2E20' }}>צ׳ק ליסטים לים</p>
          <p className="text-[11px]" style={{ color: '#5F6B5F' }}>מה שצריך לבדוק לפני, בזמן ואחרי הפלגה</p>
        </div>
        <span className="text-[10px] font-bold px-2 py-1 rounded-full inline-flex items-center gap-1 shrink-0"
          style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>
          <Lock className="w-3 h-3" />
          תצוגה לדוגמה
        </span>
      </div>

      {/* Phase cards */}
      <div className="divide-y" style={{ borderColor: '#F3F4F6' }}>
        {DEMO_PHASES.map(phase => {
          const Icon = phase.icon;
          const open = openPhase === phase.key;
          return (
            <div key={phase.key}>
              <button
                type="button"
                onClick={() => setOpenPhase(open ? null : phase.key)}
                className="w-full px-4 py-3 flex items-center gap-3 text-right transition-all hover:bg-gray-50"
                aria-expanded={open}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: phase.bg }}>
                  <Icon className="w-4 h-4" style={{ color: phase.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold" style={{ color: '#1C2E20' }}>{phase.label}</p>
                  <p className="text-[11px]" style={{ color: '#9CA3AF' }}>{phase.items.length} פריטים</p>
                </div>
                {open
                  ? <ChevronUp className="w-4 h-4 text-gray-400" />
                  : <ChevronDown className="w-4 h-4 text-gray-400" />
                }
              </button>

              {open && (
                <div className="pb-3 px-4 space-y-2 bg-gray-50/40">
                  {phase.items.map((item, i) => (
                    <div key={i}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl"
                      style={{ background: '#fff', border: '1px solid #E5E7EB' }}>
                      {/* Disabled checkbox shape — not a real <input>
                          because the demo is read-only. Keeps the
                          "what it'll feel like" cue without offering
                          fake interaction. */}
                      <div className="w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center"
                        style={{ borderColor: '#D1D5DB', background: '#F9FAFB' }}>
                        <Check className="w-3 h-3" style={{ color: '#D1D5DB' }} />
                      </div>
                      <span className="text-xs flex-1" style={{ color: '#374151' }}>{item}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer CTA */}
      <Link to={createPageUrl('Auth')}
        className="block px-4 py-3 text-center text-xs font-bold transition-all"
        style={{ background: '#FFF8E1', color: '#92400E', borderTop: '1px solid #FDE68A' }}>
        🔒 הירשם כדי להפעיל את הצ׳ק ליסטים, לסמן פריטים ולשמור היסטוריה
      </Link>
    </div>
  );
}

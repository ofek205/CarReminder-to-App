import React from 'react';
import { Paperclip, ExternalLink, Pencil } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { categoryEmoji, categoryLabel, SOURCE_BADGE } from '@/services/expenses';

/**
 * ExpenseRow — single row in the Expenses feed.
 *
 * Layout (RTL):
 *   ┌──────────────────────────────────────────────┐
 *   │ [date]                       [amount LTR][📎] │
 *   │ [emoji] [category] · [vendor]                │
 *   │ [source badge]                  [→ chevron] │
 *   └──────────────────────────────────────────────┘
 *
 * Editable rows (source_type='expense') are clickable → opens edit
 * dialog. Read-only rows (maintenance/repair) navigate to their
 * source dialog via onSourceClick (page-level handler).
 */
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function fmtMoney(n, currency = 'ILS') {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: currency || 'ILS',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

const SOURCE_TONE = {
  neutral: { bg: '#F3F4F6', color: '#374151' },
  info:    { bg: '#EFF6FF', color: '#1D4ED8' },
};

export default function ExpenseRow({ row, onClick }) {
  const cat   = row.category;
  const badge = SOURCE_BADGE[row.source_type] || SOURCE_BADGE.expense;
  const tone  = SOURCE_TONE[badge.tone] || SOURCE_TONE.neutral;

  const handleClick = () => onClick?.(row);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full text-right rounded-2xl bg-white p-3.5 transition-all active:scale-[0.99]"
      style={{ border: `1px solid ${C.border}`, boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}
      dir="rtl"
    >
      {/* Top row: date + amount + attachment */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium" style={{ color: C.muted }}>
          {fmtDate(row.expense_date)}
        </span>
        <div className="flex items-center gap-1.5">
          {row.receipt_url && (
            <Paperclip className="w-3.5 h-3.5" style={{ color: C.muted }} />
          )}
          <span
            className="text-base font-bold tabular-nums"
            style={{ color: C.text }}
            dir="ltr"
          >
            {fmtMoney(row.amount, row.currency)}
          </span>
        </div>
      </div>

      {/* Middle row: category + headline.
          Display priority for the secondary text:
            1. title (user-curated headline — "טסט שנתי 2026")
            2. vendor (merchant name — "תחנת פז")
            3. note (free text — first words)
          Only one is shown to keep the row compact; the rest are
          revealed in the edit dialog when the user taps the row. */}
      <div className="flex items-baseline gap-1.5 mt-1.5">
        <span className="text-base leading-none">{categoryEmoji(cat)}</span>
        <span className="text-sm font-bold" style={{ color: C.text }}>
          {categoryLabel(cat)}
        </span>
        {(row.title || row.vendor || row.note) && (
          <span className="text-xs truncate" style={{ color: C.muted }}>
            · {row.title || row.vendor || row.note}
          </span>
        )}
      </div>

      {/* Bottom row: source badge + action affordance icon.
          The icon hints at what tapping the row does:
            • editable rows  → Pencil  (opens the edit dialog inline)
            • read-only rows → ExternalLink (navigates out to VehicleDetail)
          Uniform ChevronLeft was confusing because the same arrow promised
          two different behaviours. */}
      <div className="flex items-center justify-between mt-2.5">
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: tone.bg, color: tone.color }}
        >
          {badge.label}
        </span>
        {row.editable
          ? <Pencil       className="w-3.5 h-3.5" style={{ color: C.muted, opacity: 0.6 }} aria-label="ערוך" />
          : <ExternalLink className="w-3.5 h-3.5" style={{ color: C.muted, opacity: 0.6 }} aria-label="פתח בפרטי הרכב" />
        }
      </div>
    </button>
  );
}

import React, { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tag, ChevronDown, Check, X } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { EXPENSE_CATEGORIES } from '@/services/expenses';

/**
 * CategoryFilter — multi-select chip dropdown.
 *
 * Empty selection = "all categories". The chip label shows the count
 * when filtered ("3 קטגוריות") for compactness. A small × button
 * inside the chip clears the filter without opening the popover.
 */
export default function CategoryFilter({ value = [], onChange }) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);
  const isAll = selected.size === 0;

  const toggle = (code) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(Array.from(next));
  };

  const clear = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onChange([]);
  };

  let label;
  if (isAll)               label = 'כל הקטגוריות';
  else if (selected.size === 1) {
    const c = EXPENSE_CATEGORIES.find(c => c.code === [...selected][0]);
    label = c ? c.label : '1 קטגוריה';
  } else                   label = `${selected.size} קטגוריות`;

  // The trigger is a button, but when filtered we render the "clear"
  // affordance OUTSIDE the popover trigger so it's a real <button>
  // (proper a11y + keyboard support). Visually it sits in the same
  // chip via a flex container.
  return (
    <div className="relative inline-flex">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`h-10 ${isAll ? 'px-3' : 'pr-3 pl-9'} rounded-xl flex items-center gap-1.5 text-sm font-bold border bg-white`}
            style={{ borderColor: C.border, color: C.text }}
          >
            <Tag className="w-4 h-4" style={{ color: C.primary }} />
            {label}
            {isAll && <ChevronDown className="w-3.5 h-3.5 opacity-60" />}
          </button>
        </PopoverTrigger>
        {!isAll && (
          <button
            type="button"
            onClick={clear}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors"
            aria-label="נקה סינון קטגוריה"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      <PopoverContent dir="rtl" className="w-72 p-2 rounded-2xl max-h-[60vh] overflow-y-auto" align="end">
        <p className="text-[10px] font-bold px-2 pt-1 pb-1.5" style={{ color: C.muted }}>
          סנן לפי קטגוריה (ניתן לבחור כמה)
        </p>
        <div className="space-y-0.5">
          {EXPENSE_CATEGORIES.map(c => {
            const isSel = selected.has(c.code);
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => toggle(c.code)}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-right transition-colors hover:bg-gray-50"
                style={isSel ? { background: '#F0FDF4' } : {}}
              >
                <span className="text-base leading-none w-5 shrink-0">{c.emoji}</span>
                <span className="flex-1" style={{ color: C.text }}>{c.label}</span>
                {isSel && <Check className="w-4 h-4" style={{ color: C.primary }} />}
              </button>
            );
          })}
        </div>
        {!isAll && (
          <button
            type="button"
            onClick={() => { onChange([]); setOpen(false); }}
            className="mt-2 w-full h-9 rounded-lg text-xs font-bold border"
            style={{ borderColor: C.border, color: C.muted, background: '#fff' }}
          >
            נקה הכל
          </button>
        )}
      </PopoverContent>
      </Popover>
    </div>
  );
}

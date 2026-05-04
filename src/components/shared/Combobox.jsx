import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ChevronDown, X, Check, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';

/**
 * Custom RTL-friendly combobox with search-as-you-type.
 *
 * Same visual / interaction model as DriverPicker in CreateRoute, so the
 * picker family reads as one product. Pure presentational — caller owns
 * the data + filtering.
 *
 * Props:
 *   value            — currently selected string (free-typed or picked).
 *   onChange(value)  — fires on every keystroke + on item select.
 *   options          — array of { value, label, sub? } OR plain string[].
 *   placeholder      — text in the trigger when empty.
 *   loading          — show a spinner inside the panel (data fetching).
 *   emptyText        — message when no options match the typed query.
 *   disabled         — gray out + ignore clicks (used while gating
 *                      street picker on city).
 *   id               — DOM id for the trigger button (a11y).
 *   maxResults       — cap suggestions list to keep mobile dropdown short
 *                      (default 50).
 */
export default function Combobox({
  value,
  onChange,
  options = [],
  placeholder = 'התחל להקליד...',
  loading = false,
  emptyText = 'אין תוצאות',
  disabled = false,
  id,
  maxResults = 50,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  // Click-outside-closes — same pattern as DriverPicker.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  // Auto-focus the search input when the panel opens; reset query on close.
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30);
    else setQuery('');
  }, [open]);

  // Normalize options to {value, label}. Accept plain strings for callers
  // that don't need a separate display label.
  const normalized = useMemo(
    () =>
      (options || []).map((o) =>
        typeof o === 'string' ? { value: o, label: o } : o
      ),
    [options]
  );

  // Filter by query (substring, case-insensitive). Stable Hebrew match.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? normalized.filter(
          (o) =>
            o.label.toLowerCase().includes(q) ||
            (o.sub && o.sub.toLowerCase().includes(q))
        )
      : normalized;
    return list.slice(0, maxResults);
  }, [normalized, query, maxResults]);

  const handlePick = (label) => {
    onChange(label);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative" dir="rtl">
      {/* Trigger — looks like an Input so it blends with the rest of the
          form. Click opens the panel. */}
      <button
        id={id}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 h-10 px-3 rounded-xl border border-gray-200 bg-white text-sm text-right transition-colors focus:outline-none focus:ring-2 focus:ring-[#2D5233]/20 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className={`flex-1 min-w-0 truncate ${value ? 'text-gray-900' : 'text-gray-400'}`}>
          {value || placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onChange('');
                }
              }}
              aria-label="נקה בחירה"
              className="p-0.5 rounded hover:bg-gray-100"
            >
              <X className="h-3.5 w-3.5 text-gray-400" />
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-[10001] top-full mt-1 inset-x-0 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <Input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חפש..."
                dir="rtl"
                className="h-9 rounded-xl pr-8 pl-2 text-xs bg-gray-50 focus:bg-white"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-gray-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                טוען...
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <p className="text-center text-[11px] text-gray-400 py-6">{emptyText}</p>
            )}
            {!loading &&
              filtered.map((o) => {
                const isSelected = o.label === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handlePick(o.label)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-right border-b border-gray-50 last:border-0 transition-colors ${
                      isSelected ? 'bg-[#E8F2EA]' : 'hover:bg-gray-50 active:bg-gray-100'
                    }`}
                  >
                    <span
                      className={`flex-1 min-w-0 truncate text-sm ${
                        isSelected ? 'font-bold text-[#2D5233]' : 'text-gray-700'
                      }`}
                    >
                      {o.label}
                    </span>
                    {o.sub && (
                      <span className="text-[10px] text-gray-400 shrink-0">{o.sub}</span>
                    )}
                    {isSelected && <Check className="shrink-0 h-4 w-4 text-[#2D5233]" />}
                  </button>
                );
              })}
            {!loading && normalized.length > maxResults && (
              <p className="text-center text-[10px] text-gray-400 py-2">
                מציג {maxResults} ראשונים — דייק חיפוש לעוד
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

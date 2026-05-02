import React, { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { DateInput } from '@/components/ui/date-input';

/**
 * PeriodFilter — Year / Month / Date-range picker.
 *
 * Default mode: year. Tap the chip → popover with three tabs:
 *   • שנה   — dropdown of years (current..earliest with data, or last 7)
 *   • חודש — month grid for the selected year
 *   • טווח — two date inputs (validates from <= to before applying)
 *
 * Year range derives from `earliestYear` prop when provided so we don't
 * show empty years that have no data.
 */
const HEBREW_MONTHS = [
  'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר',
];

function formatPeriod(period) {
  if (!period) return 'כל הזמן';
  if (period.type === 'year')  return String(period.year);
  if (period.type === 'month') return `${HEBREW_MONTHS[period.month - 1]} ${period.year}`;
  if (period.type === 'range') {
    const f = period.from?.split('-').reverse().join('/');
    const t = period.to?.split('-').reverse().join('/');
    return `${f} – ${t}`;
  }
  return '';
}

export default function PeriodFilter({ period, onChange, earliestYear }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab]   = useState(period?.type || 'year');

  // Year list — current year down to (earliestYear OR currentYear-6).
  // Capped at 15 entries so a brand-new vehicle from 1995 doesn't
  // produce a 30-row scroll. earliestYear comes from
  // fn_vehicle_expense_date_bounds and reflects only years that
  // actually have data → no empty options.
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const minYear = Math.min(
      currentYear,
      Number.isFinite(earliestYear) ? Math.max(earliestYear, currentYear - 14) : currentYear - 6
    );
    const out = [];
    for (let y = currentYear; y >= minYear; y--) out.push(y);
    return out;
  }, [earliestYear]);

  const setYear = (year) => { onChange({ type: 'year', year }); setOpen(false); };
  const setMonth = (year, month) => { onChange({ type: 'month', year, month }); setOpen(false); };

  const [rangeFrom, setRangeFrom] = useState(period?.type === 'range' ? period.from : '');
  const [rangeTo,   setRangeTo]   = useState(period?.type === 'range' ? period.to   : '');
  // Apply blocks when from/to are missing OR when from > to (a backwards
  // range produces an empty result with no obvious cause).
  const rangeInvalid = !rangeFrom || !rangeTo || rangeFrom > rangeTo;
  const applyRange = () => {
    if (rangeInvalid) return;
    onChange({ type: 'range', from: rangeFrom, to: rangeTo });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-10 px-3 rounded-xl flex items-center gap-1.5 text-sm font-bold border bg-white"
          style={{ borderColor: C.border, color: C.text }}
        >
          <Calendar className="w-4 h-4" style={{ color: C.primary }} />
          {formatPeriod(period)}
          <ChevronDown className="w-3.5 h-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent dir="rtl" className="w-72 p-2 rounded-2xl" align="end">
        {/* Tab strip */}
        <div className="grid grid-cols-3 gap-1 mb-2 p-1 rounded-xl" style={{ background: '#F3F4F6' }}>
          {[['year','שנה'], ['month','חודש'], ['range','טווח']].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className="h-8 rounded-lg text-xs font-bold transition-colors"
              style={tab === k
                ? { background: '#fff', color: C.primary, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
                : { background: 'transparent', color: '#6B7280' }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'year' && (
          <div className="grid grid-cols-2 gap-1 max-h-64 overflow-y-auto">
            {years.map(y => {
              const selected = period?.type === 'year' && period.year === y;
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYear(y)}
                  className="h-9 rounded-lg text-sm font-bold flex items-center justify-center gap-1 transition-colors"
                  style={selected
                    ? { background: C.primary, color: '#fff' }
                    : { background: '#F9FAFB', color: C.text }}
                >
                  {selected && <Check className="w-3.5 h-3.5" />}
                  {y}
                </button>
              );
            })}
          </div>
        )}

        {tab === 'month' && (
          <div className="space-y-2">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] font-bold ml-1" style={{ color: C.muted }}>שנה:</span>
              {years.map(y => (
                <button
                  key={y}
                  type="button"
                  onClick={() => onChange({ type: 'month', year: y, month: period?.month || (new Date().getMonth() + 1) })}
                  className="h-7 px-2 rounded-md text-[11px] font-bold transition-colors"
                  style={(period?.year === y)
                    ? { background: C.primary, color: '#fff' }
                    : { background: '#F3F4F6', color: '#374151' }}
                >
                  {y}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {HEBREW_MONTHS.map((m, i) => {
                const monthNum = i + 1;
                const yearForBtn = period?.year || currentYear;
                const selected = period?.type === 'month' && period.year === yearForBtn && period.month === monthNum;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMonth(yearForBtn, monthNum)}
                    className="h-9 rounded-lg text-xs font-bold transition-colors"
                    style={selected
                      ? { background: C.primary, color: '#fff' }
                      : { background: '#F9FAFB', color: C.text }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'range' && (
          <div className="space-y-2">
            <div>
              <label className="text-[11px] font-bold block mb-1" style={{ color: C.muted }}>מתאריך</label>
              <DateInput value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} className="rounded-xl text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-bold block mb-1" style={{ color: C.muted }}>עד תאריך</label>
              <DateInput value={rangeTo} onChange={e => setRangeTo(e.target.value)} className="rounded-xl text-sm" />
            </div>
            {rangeFrom && rangeTo && rangeFrom > rangeTo && (
              <p className="text-[11px] text-red-600 leading-snug">
                התאריך "מ" חייב להיות לפני התאריך "עד".
              </p>
            )}
            <button
              type="button"
              onClick={applyRange}
              disabled={rangeInvalid}
              className="w-full h-10 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
              style={{ background: C.primary }}
            >
              החל טווח
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

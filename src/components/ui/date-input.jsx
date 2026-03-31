import * as React from "react";
import { cn } from "@/lib/utils";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useNavigation } from "react-day-picker";

// YYYY-MM-DD → DD/MM/YYYY
function isoToDisplay(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// DD/MM/YYYY → YYYY-MM-DD (returns '' if incomplete/invalid)
function displayToIso(str) {
  const digits = str.replace(/\D/g, '');
  if (digits.length < 8) return '';
  const d = digits.slice(0, 2);
  const m = digits.slice(2, 4);
  const y = digits.slice(4, 8);
  const date = new Date(`${y}-${m}-${d}`);
  if (isNaN(date.getTime())) return '';
  return `${y}-${m}-${d}`;
}

// Auto-insert slashes as user types: 15/07/2026
function autoFormat(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i === 2 || i === 4) out += '/';
    out += digits[i];
  }
  return out;
}

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני',
                   'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

// Custom caption: [ ← ]  Month  [ − YYYY + ]  [ → ]
function CustomCaption({ displayMonth }) {
  const { goToMonth, nextMonth, previousMonth } = useNavigation();
  const year  = displayMonth.getFullYear();
  const month = displayMonth.getMonth();
  const btnBase = "h-8 w-8 rounded-xl border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors shrink-0";

  return (
    <div className="flex items-center justify-between px-1 pb-1 gap-1" dir="ltr">
      {/* Prev month */}
      <button type="button" onClick={() => previousMonth && goToMonth(previousMonth)}
        disabled={!previousMonth} className={btnBase}>
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* Month name + Year ± */}
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 select-none">
        <span className="min-w-[52px] text-center">{HE_MONTHS[month]}</span>
        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-2xl px-1.5 py-0.5">
          <button type="button"
            onClick={() => goToMonth(new Date(year - 1, month))}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-600 text-base leading-none font-bold transition-colors">
            −
          </button>
          <span className="w-11 text-center tabular-nums text-sm">{year}</span>
          <button type="button"
            onClick={() => goToMonth(new Date(year + 1, month))}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-200 text-gray-600 text-base leading-none font-bold transition-colors">
            +
          </button>
        </div>
      </div>

      {/* Next month */}
      <button type="button" onClick={() => nextMonth && goToMonth(nextMonth)}
        disabled={!nextMonth} className={btnBase}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

const DateInput = React.forwardRef(({ className, value, onChange, ...props }, ref) => {
  const [display, setDisplay] = React.useState(() => isoToDisplay(value));
  const [open, setOpen] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);
  const [calMonth, setCalMonth] = React.useState(() => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T12:00:00');
    return new Date();
  });

  React.useEffect(() => {
    setDisplay(isoToDisplay(value));
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setCalMonth(new Date(value + 'T12:00:00'));
    }
  }, [value]);

  const handleChange = (e) => {
    const newDisplay = autoFormat(e.target.value);
    setDisplay(newDisplay);
    const iso = displayToIso(newDisplay);
    setInvalid(newDisplay.length === 10 && !iso);
    if (iso) { onChange?.({ target: { value: iso } }); setInvalid(false); }
    else if (!newDisplay) { onChange?.({ target: { value: '' } }); setInvalid(false); }
  };

  const handleCalendarSelect = (date) => {
    if (!date) return;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    setDisplay(isoToDisplay(iso));
    onChange?.({ target: { value: iso } });
    setInvalid(false);
    setOpen(false);
  };

  const selectedDate = value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(value + 'T12:00:00')
    : undefined;

  return (
    <div className="relative flex items-center flex-wrap">
      <input
        ref={ref}
        type="text"
        dir="ltr"
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        value={display}
        onChange={handleChange}
        className={cn(
          "flex h-12 w-full rounded-2xl border border-[#E5E0D8] bg-white px-4 py-2 pl-11 text-sm font-medium text-[#1C2E20] text-right shadow-sm transition-all placeholder:text-[#C0B8AD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B7A53]/20 focus-visible:border-[#4B7A53] disabled:cursor-not-allowed disabled:opacity-50",
          invalid && "border-red-400",
          className
        )}
        {...props}
      />
      {invalid && <p className="text-xs text-red-500 mt-0.5 pe-1 w-full">תאריך לא תקין</p>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            tabIndex={-1}
            className="absolute left-3 text-[#4B7A53] hover:text-[#2D5233] transition-colors p-0.5"
            aria-label="בחר תאריך"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end" side="bottom">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleCalendarSelect}
            month={calMonth}
            onMonthChange={setCalMonth}
            components={{ Caption: CustomCaption }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
});
DateInput.displayName = "DateInput";

export { DateInput };

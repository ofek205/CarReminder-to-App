import * as React from "react";
import { format, parseISO, isValid } from "date-fns";
import { he } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { isIOS } from "@/lib/capacitor";

/**
 * DateInput — date picker with platform-conditional rendering.
 *
 * iOS (Capacitor):
 *   Uses the native `<input type="date">` which on iOS displays the
 *   wheel picker styled like the Notes app. The wheel already lets the
 *   user spin years fast, so the typing/year-dropdown affordances below
 *   aren't needed there. This is the look Ofek explicitly asked for
 *   ("every date picker in iOS should look exactly like פתקים").
 *
 * Android + Web:
 *   A typable text field (DD/MM/YYYY) PLUS a calendar button that opens
 *   a Popover with react-day-picker. Two ways in:
 *     1. TYPE the date directly — fastest for known dates like a birth
 *        date. Accepts "15/03/1987" or bare digits "15031987".
 *     2. PICK from the calendar — whose caption now has month + year
 *        DROPDOWNS (captionLayout="dropdown-buttons"). Jumping 40 years
 *        back for a birth date is one tap on the year dropdown instead
 *        of ~480 taps on the prev-month arrow (the bug this fixes).
 *
 *   Opt-out: pass `native` to force the HTML5 native picker on Android
 *   too. Use this when the field is rendered inside a vaul Drawer — the
 *   Drawer eats Radix Popover pointer events, so a calendar click never
 *   reaches onSelect (silently broken in VehicleCompletionSheet). The
 *   native picker has no such conflict.
 *
 * Year range:
 *   fromYear / toYear bound the year dropdown. Defaults cover 1900 →
 *   currentYear+10 (births of centenarians through near-future renewals).
 *   Callers with a tighter need (e.g. birth date → toYear={thisYear})
 *   pass their own. The `max`/`min` ISO props still disable out-of-range
 *   DAYS in the grid and reject out-of-range typed input.
 *
 * Contract (unchanged):
 *   • value prop is ISO YYYY-MM-DD or empty string.
 *   • onChange receives a synthetic event whose target.value is
 *     ISO YYYY-MM-DD or empty string.
 *   • min / max props accepted as YYYY-MM-DD strings.
 *   • native prop (optional) — force the HTML5 native picker.
 *   • fromYear / toYear (optional) — year dropdown bounds.
 *   • forwardRef preserved.
 */
const DateInput = React.forwardRef(({ className, value, onChange, min, max, disabled, placeholder, native, fromYear, toYear, ...props }, ref) => {
  if (isIOS || native) {
    // iOS / forced-native path — keep native input.
    return (
      <input
        ref={ref}
        type="date"
        // Coerce to string — a non-string value (Date/number) would make
        // the native date input behave unpredictably. Defensive, same
        // spirit as safeParseISO on the Popover path.
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
        min={typeof min === "string" ? min : undefined}
        max={typeof max === "string" ? max : undefined}
        disabled={disabled}
        placeholder={placeholder}
        dir="ltr"
        className={cn(
          "flex h-12 w-full min-w-0 max-w-full rounded-2xl border border-[#E5E0D8] bg-white px-4 py-2 text-sm font-medium text-[#1C2E20] shadow-sm transition-all placeholder:text-[#C0B8AD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B7A53]/20 focus-visible:border-[#4B7A53] disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }

  // Android + Web path — typable field + Popover calendar.
  return (
    <DateInputPopover
      ref={ref}
      className={className}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      disabled={disabled}
      placeholder={placeholder}
      fromYear={fromYear}
      toYear={toYear}
      {...props}
    />
  );
});
DateInput.displayName = "DateInput";

// Turn a raw digit string into the masked DD/MM/YYYY display as the user
// types — auto-inserts the slashes so they never type punctuation.
function maskDigits(raw) {
  const d = String(raw).replace(/\D/g, "").slice(0, 8);
  let out = d.slice(0, 2);
  if (d.length >= 3) out += "/" + d.slice(2, 4);
  if (d.length >= 5) out += "/" + d.slice(4, 8);
  return out;
}

// Parse a fully-typed DD/MM/YYYY (8 digits) into an ISO string, or null.
// Rejects impossible dates (31/02), and anything outside min/max. The
// round-trip format check catches month/day overflow that parseISO would
// otherwise silently roll over.
function typedToISO(text, minDate, maxDate) {
  const d = String(text).replace(/\D/g, "");
  if (d.length !== 8) return null;
  const dd = d.slice(0, 2), mm = d.slice(2, 4), yyyy = d.slice(4, 8);
  const iso = `${yyyy}-${mm}-${dd}`;
  const parsed = parseISO(iso);
  if (!isValid(parsed)) return null;
  if (format(parsed, "yyyy-MM-dd") !== iso) return null; // rejects 31/02 etc.
  if (minDate && isValid(minDate) && parsed < minDate) return null;
  if (maxDate && isValid(maxDate) && parsed > maxDate) return null;
  return iso;
}

// Crash-proof parseISO. date-fns parseISO does `argument.split(...)`
// internally, so passing ANYTHING that isn't a string (a Date object, a
// number, gov.il sometimes returns these) throws "e.split is not a
// function" — which crashed /vehicle-check's completion drawer for real
// users (5 errors, 2026-05-28→31). A shared date primitive must never
// crash on bad input: coerce non-strings to "no date" instead.
function safeParseISO(v) {
  if (!v || typeof v !== "string") return undefined;
  const d = parseISO(v);
  return isValid(d) ? d : undefined;
}

const DateInputPopover = React.forwardRef(({ className, value, onChange, min, max, disabled, placeholder = "DD/MM/YYYY", fromYear, toYear, ...props }, ref) => {
  const [open, setOpen] = React.useState(false);

  // ISO YYYY-MM-DD → Date object for the calendar.
  const selectedDate = React.useMemo(() => safeParseISO(value), [value]);

  // min/max as Date objects for the calendar's disabled function + typed
  // validation.
  const minDate = safeParseISO(min);
  const maxDate = safeParseISO(max);
  const isDisabledDay = (date) => {
    if (minDate && isValid(minDate) && date < minDate) return true;
    if (maxDate && isValid(maxDate) && date > maxDate) return true;
    return false;
  };

  // Year dropdown bounds. Default wide enough for any birth date through
  // a near-future renewal; callers override for tighter ranges.
  const currentYear = new Date().getFullYear();
  const resolvedFromYear = fromYear ?? 1900;
  const resolvedToYear = toYear ?? currentYear + 10;

  // The text the user sees/edits. Kept in sync with `value` so an external
  // change (calendar pick, parent reset) reflects in the field, while local
  // typing only propagates once it forms a complete valid date.
  const [text, setText] = React.useState(
    selectedDate ? format(selectedDate, "dd/MM/yyyy") : ""
  );
  React.useEffect(() => {
    setText(selectedDate ? format(selectedDate, "dd/MM/yyyy") : "");
  }, [selectedDate]);

  const commit = (iso) => onChange?.({ target: { value: iso } });

  const handleType = (e) => {
    const masked = maskDigits(e.target.value);
    setText(masked);
    const digits = masked.replace(/\D/g, "");
    if (digits.length === 0) {
      commit(""); // user cleared the field
    } else if (digits.length === 8) {
      const iso = typedToISO(masked, minDate, maxDate);
      if (iso) commit(iso); // only propagate a complete, valid date
    }
  };

  // On blur, reconcile: a complete valid date commits; anything partial or
  // invalid reverts to the last committed value so the field never shows
  // garbage. Empty stays empty.
  const handleBlur = () => {
    const digits = text.replace(/\D/g, "");
    if (digits.length === 0) return;
    const iso = typedToISO(text, minDate, maxDate);
    if (iso) { commit(iso); return; }
    setText(selectedDate ? format(selectedDate, "dd/MM/yyyy") : "");
  };

  const handleSelect = (date) => {
    const iso = date ? format(date, "yyyy-MM-dd") : "";
    commit(iso);
    setOpen(false);
  };

  return (
    <div
      dir="rtl"
      className={cn(
        "flex h-12 w-full min-w-0 max-w-full items-center gap-1 rounded-2xl border border-[#E5E0D8] bg-white pr-4 pl-1 shadow-sm transition-all focus-within:ring-2 focus-within:ring-[#4B7A53]/20 focus-within:border-[#4B7A53]",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={text}
        onChange={handleType}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={placeholder}
        // text-right keeps the LTR date visually anchored to the field's
        // start edge in this RTL row.
        className="min-w-0 flex-1 bg-transparent py-2 text-right text-sm font-medium tabular-nums text-[#1C2E20] placeholder:text-[#C0B8AD] focus:outline-none disabled:cursor-not-allowed"
        {...props}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="פתח לוח שנה"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#4B7A53] transition-colors hover:bg-[#4B7A53]/10 disabled:cursor-not-allowed"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto p-0 z-[1000]"
          // Don't let body scroll-lock fight with the trigger inside dialogs.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Calendar
            mode="single"
            captionLayout="dropdown-buttons"
            fromYear={resolvedFromYear}
            toYear={resolvedToYear}
            defaultMonth={selectedDate}
            selected={selectedDate}
            onSelect={handleSelect}
            disabled={isDisabledDay}
            initialFocus
            locale={he}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
});
DateInputPopover.displayName = "DateInputPopover";

export { DateInput };

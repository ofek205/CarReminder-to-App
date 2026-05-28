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
 *   wheel picker styled like the Notes app. This is the look Ofek
 *   explicitly asked for ("every date picker in iOS should look
 *   exactly like the one in פתקים").
 *
 * Android + Web:
 *   Uses a Popover + react-day-picker Calendar. The native
 *   `<input type="date">` on Samsung OneUI renders broken on some
 *   devices (transparent dialog backdrop revealing the launch theme
 *   green) — the popover calendar is fully app-rendered and works
 *   consistently.
 *
 *   Opt-out: pass `native` to force the HTML5 native picker on Android
 *   too. Use this when the field is rendered inside a vaul Drawer —
 *   the Drawer eats Radix Popover pointer events, so a date click in
 *   the Calendar never reaches its onSelect handler (silently broken
 *   in VehicleCompletionSheet 2026-05-27). The native picker has no
 *   such conflict.
 *
 * Contract (unchanged from the old wrapper):
 *   • value prop is ISO YYYY-MM-DD or empty string.
 *   • onChange receives a synthetic event whose target.value is
 *     ISO YYYY-MM-DD or empty string.
 *   • min / max props accepted as YYYY-MM-DD strings.
 *   • native prop (optional) — force the HTML5 native picker.
 *   • forwardRef preserved.
 */
const DateInput = React.forwardRef(({ className, value, onChange, min, max, disabled, placeholder, native, ...props }, ref) => {
  if (isIOS || native) {
    // iOS path — keep native input.
    return (
      <input
        ref={ref}
        type="date"
        value={value || ""}
        onChange={onChange}
        min={min}
        max={max}
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

  // Android + Web path — Popover + Calendar.
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
      {...props}
    />
  );
});
DateInput.displayName = "DateInput";

const DateInputPopover = React.forwardRef(({ className, value, onChange, min, max, disabled, placeholder = "בחר תאריך", ...props }, ref) => {
  const [open, setOpen] = React.useState(false);

  // ISO YYYY-MM-DD → Date object for the calendar.
  const selectedDate = React.useMemo(() => {
    if (!value) return undefined;
    const d = parseISO(value);
    return isValid(d) ? d : undefined;
  }, [value]);

  // Date display in Hebrew DD/MM/YYYY format.
  const displayText = selectedDate
    ? format(selectedDate, "dd/MM/yyyy", { locale: he })
    : placeholder;

  // min/max as Date objects for the calendar's disabled function.
  const minDate = min ? parseISO(min) : undefined;
  const maxDate = max ? parseISO(max) : undefined;
  const isDisabledDay = (date) => {
    if (minDate && isValid(minDate) && date < minDate) return true;
    if (maxDate && isValid(maxDate) && date > maxDate) return true;
    return false;
  };

  const handleSelect = (date) => {
    const iso = date ? format(date, "yyyy-MM-dd") : "";
    // Synthetic event to preserve the existing onChange contract.
    onChange?.({ target: { value: iso } });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          dir="rtl"
          className={cn(
            "flex h-12 w-full min-w-0 max-w-full items-center justify-between gap-2 rounded-2xl border border-[#E5E0D8] bg-white px-4 py-2 text-sm font-medium text-[#1C2E20] shadow-sm transition-all hover:border-[#4B7A53]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B7A53]/20 focus-visible:border-[#4B7A53] disabled:cursor-not-allowed disabled:opacity-50",
            !selectedDate && "text-[#C0B8AD]",
            className
          )}
          {...props}
        >
          <span dir="ltr" className="tabular-nums">{displayText}</span>
          <CalendarIcon className="h-4 w-4 opacity-60" />
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
          selected={selectedDate}
          onSelect={handleSelect}
          disabled={isDisabledDay}
          initialFocus
          locale={he}
        />
      </PopoverContent>
    </Popover>
  );
});
DateInputPopover.displayName = "DateInputPopover";

export { DateInput };

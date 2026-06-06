import * as React from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateInput } from "@/components/ui/date-input";

/**
 * DateTimeInput — date + time entry, fully in-app and keyboard-typable.
 *
 * Why this exists:
 *   The native <input type="datetime-local"> on Android opens the
 *   full-screen green native date picker for its date portion and offers
 *   no reliable way to TYPE the value. This composes the shared DateInput
 *   (typable DD/MM/YYYY + in-app calendar popover, native wheel on iOS)
 *   with a typable HH:mm time field, so the whole control is in-app.
 *
 * Contract (drop-in for the datetime-local consumers it replaces):
 *   • value     — "YYYY-MM-DDTHH:mm" (datetime-local string) or "".
 *   • onChange  — fired with a synthetic event { target: { value } } whose
 *                 value is "YYYY-MM-DDTHH:mm" when BOTH parts are valid,
 *                 or "" while either part is missing/invalid. This matches
 *                 the old behavior: AdminPopupEditor does
 *                 `new Date(value).toISOString()` and CreateRoute stores
 *                 the string as-is; both treat "" as "no value".
 *
 * Layout: date field (flex-1) + compact time field, gap-2 RTL row. Both
 * boxes reuse DateInput's visual language (h-12, rounded-2xl, #E5E0D8
 * border, green focus ring).
 */

// Split "YYYY-MM-DDTHH:mm" → { date: "YYYY-MM-DD", time: "HH:mm" }.
function splitValue(v) {
  if (typeof v !== "string" || !v) return { date: "", time: "" };
  const [date = "", time = ""] = v.split("T");
  return { date, time: time.slice(0, 5) };
}

// Mask raw digits into HH:mm as the user types (auto-inserts the colon).
function maskTime(raw) {
  const d = String(raw).replace(/\D/g, "").slice(0, 4);
  let out = d.slice(0, 2);
  if (d.length >= 3) out += ":" + d.slice(2, 4);
  return out;
}

// Validate a complete HH:mm (4 digits, 00-23 / 00-59). Returns the
// normalized "HH:mm" or null.
function validTime(text) {
  const d = String(text).replace(/\D/g, "");
  if (d.length !== 4) return null;
  const hh = Number(d.slice(0, 2));
  const mm = Number(d.slice(2, 4));
  if (hh > 23 || mm > 59) return null;
  return `${d.slice(0, 2)}:${d.slice(2, 4)}`;
}

const DateTimeInput = React.forwardRef(({ className, value, onChange, disabled, ...props }, ref) => {
  const { date: valueDate, time: valueTime } = splitValue(value);

  // Local text for the time field, kept in sync with the incoming value
  // while local typing only propagates once it forms a complete value.
  const [timeText, setTimeText] = React.useState(valueTime);
  React.useEffect(() => { setTimeText(valueTime); }, [valueTime]);

  // Emit the combined value only when BOTH parts are valid; otherwise "".
  const commit = (datePart, timePart) => {
    const t = validTime(timePart);
    onChange?.({ target: { value: datePart && t ? `${datePart}T${t}` : "" } });
  };

  const handleDateChange = (e) => {
    commit(e?.target?.value || "", timeText);
  };

  const handleTimeChange = (e) => {
    const masked = maskTime(e.target.value);
    setTimeText(masked);
    commit(valueDate, masked);
  };

  // On blur, revert an incomplete/invalid time to the last valid one so
  // the field never shows garbage.
  const handleTimeBlur = () => {
    if (validTime(timeText)) return;
    if (timeText.replace(/\D/g, "").length === 0) return; // empty stays empty
    setTimeText(valueTime);
  };

  return (
    <div dir="rtl" className={cn("flex items-start gap-2", className)}>
      <DateInput
        ref={ref}
        className="flex-1"
        value={valueDate}
        onChange={handleDateChange}
        disabled={disabled}
        {...props}
      />
      <div
        dir="rtl"
        className={cn(
          "flex h-12 w-[92px] shrink-0 items-center gap-1 rounded-2xl border border-[#E5E0D8] bg-white px-2 shadow-sm transition-all focus-within:ring-2 focus-within:ring-[#4B7A53]/20 focus-within:border-[#4B7A53]",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <Clock className="h-4 w-4 shrink-0 text-[#4B7A53]" />
        <input
          type="text"
          inputMode="numeric"
          dir="ltr"
          value={timeText}
          onChange={handleTimeChange}
          onBlur={handleTimeBlur}
          disabled={disabled}
          placeholder="HH:mm"
          aria-label="שעה"
          className="min-w-0 flex-1 bg-transparent py-2 text-center text-sm font-medium tabular-nums text-[#1C2E20] placeholder:text-[#C0B8AD] focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
});
DateTimeInput.displayName = "DateTimeInput";

export { DateTimeInput };

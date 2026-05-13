import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * DateInput — thin wrapper around the native HTML `<input type="date">`.
 *
 * Previous implementation used a custom DD/MM/YYYY text input with a
 * popover calendar (react-day-picker). On iOS the popover felt
 * out of place compared to the OS date wheel; user requested
 * "every date picker in iOS should look exactly like the one in
 * notes (פתקים)" — which is the native date input.
 *
 * Behaviour notes:
 *   • value prop is ISO YYYY-MM-DD (unchanged).
 *   • onChange receives a normal change event whose target.value is
 *     ISO YYYY-MM-DD (unchanged).
 *   • The browser/OS handles the locale-appropriate display. iOS in
 *     Hebrew renders DD/MM/YYYY natively.
 *   • min / max props accepted as YYYY-MM-DD strings — native
 *     `<input type="date">` honours them.
 *   • forwardRef preserved so caller refs still work.
 */
const DateInput = React.forwardRef(({ className, value, onChange, ...props }, ref) => {
  return (
    <input
      ref={ref}
      type="date"
      value={value || ''}
      onChange={onChange}
      // dir LTR so the calendar icon sits where the OS expects;
      // the surrounding form layout stays RTL.
      dir="ltr"
      className={cn(
        // Match the existing visual style of other inputs across the
        // app: 12-unit height, rounded 2xl, off-white background,
        // subtle border + focus ring.
        //
        // `min-w-0 max-w-full` is critical on iOS: the native date
        // input has an intrinsic minimum width (~280px) and without
        // these classes it refuses to shrink inside a `grid-cols-2`
        // or flex parent on a narrow phone, pushing the column past
        // the viewport edge. The min-w-0 lets the flex/grid child
        // shrink below its content size, the max-w-full clamps any
        // overflow as a safety net.
        "flex h-12 w-full min-w-0 max-w-full rounded-2xl border border-[#E5E0D8] bg-white px-4 py-2 text-sm font-medium text-[#1C2E20] shadow-sm transition-all placeholder:text-[#C0B8AD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B7A53]/20 focus-visible:border-[#4B7A53] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});
DateInput.displayName = "DateInput";

export { DateInput };

import * as React from "react"
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react"
import { DayPicker, useNavigation, useDayPicker } from "react-day-picker"
import { format } from "date-fns"
import { he } from "date-fns/locale"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

// Custom caption: month + year as borderless native <select>s, with the
// prev/next month arrows pinned to the edges. We render this ourselves
// instead of react-day-picker's built-in captionLayout="dropdown-buttons"
// because that layout depends on rdp's bundled stylesheet (which this
// project doesn't import — it's a Tailwind/shadcn setup), so the native
// select and the caption label both render and overlap into a doubled
// "מאי/מאי 2026/2026" mess. Owning the caption gives clean RTL control:
// month select on the right, year on the left, arrows at the edges.
// Native <select> is deliberate — on Android it opens the OS picker, the
// fast way to jump 40+ years for a birth date.
function CalendarCaption({ displayMonth }) {
  const { goToMonth, nextMonth, previousMonth } = useNavigation();
  const { fromDate, toDate } = useDayPicker();

  const fromYear = fromDate ? fromDate.getFullYear() : 1900;
  const toYear = toDate ? toDate.getFullYear() : new Date().getFullYear() + 10;

  const month = displayMonth.getMonth();
  const year = displayMonth.getFullYear();

  const months = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        value: i,
        label: format(new Date(2020, i, 1), "LLLL", { locale: he }),
      })),
    []
  );
  // Most-recent year first — a birth date is far likelier to be recent
  // than 1900, so the list opens near where the user is heading.
  const years = React.useMemo(() => {
    const out = [];
    for (let y = toYear; y >= fromYear; y--) out.push(y);
    return out;
  }, [fromYear, toYear]);

  const selectCls =
    "appearance-none bg-transparent text-center font-bold text-sm text-[#2D5233] cursor-pointer rounded-lg py-1 pr-2 pl-5 hover:bg-[#4B7A53]/10 focus:outline-none focus:ring-2 focus:ring-[#4B7A53]/30 transition-colors";

  return (
    <div className="relative flex items-center justify-center pt-1">
      {/* prev-month — RTL: right edge, points inward */}
      <button
        type="button"
        aria-label="חודש קודם"
        disabled={!previousMonth}
        onClick={() => previousMonth && goToMonth(previousMonth)}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "absolute right-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 disabled:opacity-20"
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-1.5">
        {/* month */}
        <div className="relative inline-flex items-center">
          <select
            aria-label="חודש"
            value={month}
            onChange={(e) => goToMonth(new Date(year, Number(e.target.value), 1))}
            className={selectCls}
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute left-1 h-3 w-3 opacity-50" />
        </div>
        {/* year — LTR numerals */}
        <div className="relative inline-flex items-center">
          <select
            aria-label="שנה"
            dir="ltr"
            value={year}
            onChange={(e) => goToMonth(new Date(Number(e.target.value), month, 1))}
            className={cn(selectCls, "tabular-nums")}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute left-1 h-3 w-3 opacity-50" />
        </div>
      </div>

      {/* next-month — RTL: left edge, points inward */}
      <button
        type="button"
        aria-label="חודש הבא"
        disabled={!nextMonth}
        onClick={() => nextMonth && goToMonth(nextMonth)}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "absolute left-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 disabled:opacity-20"
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
    </div>
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  fixedWeeks = true,
  ...props
}) {
  return (
    (<DayPicker
      dir="rtl"
      showOutsideDays={showOutsideDays}
      fixedWeeks={fixedWeeks}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute right-1",
        nav_button_next: "absolute left-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground rounded-2xl w-8 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected].day-range-end)]:rounded-r-md",
          props.mode === "range"
            ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            : "[&:has([aria-selected])]:rounded-2xl"
        ),
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-8 w-8 p-0 font-normal aria-selected:opacity-100"
        ),
        day_range_start: "day-range-start",
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground aria-selected:bg-accent/50 aria-selected:text-muted-foreground",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        // Custom caption — see CalendarCaption above. Replaces both the
        // default label layout AND the broken dropdown-buttons layout.
        Caption: CalendarCaption,
      }}
      {...props} />)
  );
}
Calendar.displayName = "Calendar"

export { Calendar }

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const inputBase = "flex h-12 w-full rounded-2xl border border-[#E5E0D8] bg-white px-4 py-2 text-sm font-medium text-[#1C2E20] text-right shadow-sm transition-all placeholder:text-[#C0B8AD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B7A53]/20 focus-visible:border-[#4B7A53] disabled:cursor-not-allowed disabled:opacity-50";

const Input = React.forwardRef(({ className, type, onClear, ...props }, ref) => {
  const hasValue = props.value !== undefined && props.value !== '' && props.value !== null;
  const showClearBtn = onClear && hasValue && !props.disabled && !props.readOnly && type !== 'file';

  if (!onClear || type === 'file') {
    return (
      <input
        type={type}
        dir="rtl"
        className={cn(inputBase, className)}
        ref={ref}
        {...props}
      />
    );
  }

  return (
    <div className="relative w-full">
      <input
        type={type}
        dir="rtl"
        className={cn(inputBase, "pl-8", className)}
        ref={ref}
        {...props}
      />
      {showClearBtn && (
        <button
          type="button"
          tabIndex={-1}
          onClick={onClear}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="נקה שדה"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
})
Input.displayName = "Input"

export { Input }

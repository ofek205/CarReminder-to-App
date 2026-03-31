import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    (<textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-2xl border border-[#E5E0D8] bg-white px-4 py-3 text-sm font-medium text-[#1C2E20] text-right shadow-sm placeholder:text-[#C0B8AD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4B7A53]/20 focus-visible:border-[#4B7A53] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props} />)
  );
})
Textarea.displayName = "Textarea"

export { Textarea }

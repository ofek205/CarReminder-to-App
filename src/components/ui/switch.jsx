import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3A7D44] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[#3A7D44] data-[state=unchecked]:bg-gray-300",
      className
    )}
    style={{ width: 50, height: 28, padding: 2 }}
    {...props}
    ref={ref}>
    <SwitchPrimitives.Thumb
      className="pointer-events-none block rounded-full bg-white transition-transform duration-200 ease-in-out data-[state=unchecked]:translate-x-0 data-[state=checked]:-translate-x-[22px]"
      style={{ width: 24, height: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.1)' }} />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }

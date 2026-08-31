import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-[10px] border border-input/80 bg-card px-3 py-2 text-base shadow-[inset_0_1px_1px_rgba(0,0,0,.025)] transition-[border-color,box-shadow,background-color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/18 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/16 md:text-sm dark:bg-white/[.045] dark:disabled:bg-white/[.03]",
        className
      )}
      {...props}
    />
  )
}

export { Input }

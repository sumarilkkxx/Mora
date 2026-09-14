import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full rounded-[12px] border border-input/80 bg-card px-3 py-2.5 text-base leading-6 shadow-[inset_0_1px_1px_rgba(0,0,0,.025)] transition-[border-color,box-shadow,background-color] outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/14 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/14 md:text-sm dark:bg-white/[.045] dark:disabled:bg-white/[.03]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

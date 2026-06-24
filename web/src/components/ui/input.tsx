import * as React from "react";
import { cn } from "../../lib-utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-[0.95rem] border border-[hsl(var(--input)/0.96)] bg-[hsl(var(--card)/0.98)] px-3.5 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))] shadow-[inset_0_1px_0_hsl(0_0%_100%/0.28)] transition-[border-color,box-shadow,background-color] duration-200 ease-out focus-visible:border-[hsl(var(--primary)/0.5)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring)/0.18)]",
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };

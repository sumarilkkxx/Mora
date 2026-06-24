import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib-utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[0.95rem] text-sm font-medium transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring)/0.22)] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]",
  {
    variants: {
      variant: {
        default:
          "bg-[hsl(var(--foreground))] text-[hsl(var(--background))] shadow-[0_16px_30px_hsl(22_16%_12%/0.12)] hover:-translate-y-px hover:bg-[hsl(var(--primary))] hover:shadow-[0_18px_36px_hsl(18_42%_28%/0.2)] active:translate-y-0 active:scale-[0.99]",
        secondary:
          "bg-[hsl(var(--muted)/0.72)] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted)/0.95)] active:scale-[0.99]",
        outline:
          "border border-[hsl(var(--border)/0.92)] bg-[hsl(var(--card)/0.92)] text-[hsl(var(--foreground))] shadow-[0_8px_20px_hsl(22_18%_20%/0.04)] hover:-translate-y-px hover:border-[hsl(var(--primary)/0.26)] hover:bg-[hsl(var(--background))] active:translate-y-0 active:scale-[0.99]",
        ghost:
          "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted)/0.52)] active:scale-[0.99]",
        destructive:
          "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] shadow-[0_14px_28px_hsl(4_64%_40%/0.16)] hover:-translate-y-px hover:opacity-95 active:translate-y-0 active:scale-[0.99]",
      },
      size: {
        default: "h-11 px-4 py-2.5",
        sm: "h-9 px-3.5",
        lg: "h-12 px-6 text-[15px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

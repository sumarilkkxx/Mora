import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib-utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
  {
    variants: {
      variant: {
        default: "bg-[hsl(var(--foreground))] text-[hsl(var(--background))] shadow-sm hover:-translate-y-0.5 hover:bg-[hsl(var(--primary))]",
        secondary: "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:bg-[hsl(var(--secondary)/0.85)]",
        outline: "border border-[hsl(var(--border))] bg-[hsl(var(--card)/0.72)] hover:-translate-y-0.5 hover:bg-[hsl(var(--accent))]",
        ghost: "hover:bg-[hsl(var(--muted)/0.56)]",
        destructive: "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:opacity-90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-12 px-6",
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

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib-utils";

const badgeVariants = cva(
  "inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors [overflow-wrap:anywhere]",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]",
        secondary: "border-transparent bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
        warning: "border-transparent bg-amber-100 text-amber-700",
        success: "border-transparent bg-emerald-100 text-emerald-700",
        destructive: "border-transparent bg-red-100 text-red-700",
        outline: "text-[hsl(var(--foreground))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

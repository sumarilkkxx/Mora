import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib-utils";

const alertVariants = cva("relative w-full rounded-lg border p-4", {
  variants: {
    variant: {
      default: "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]",
      info: "border-blue-200 bg-blue-50 text-blue-900",
      warning: "border-amber-200 bg-amber-50 text-amber-900",
      destructive: "border-red-200 bg-red-50 text-red-900",
      success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(
  ({ className, variant, ...props }, ref) => <div ref={ref} className={cn(alertVariants({ variant }), className)} role="alert" {...props} />,
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h5 ref={ref} className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />,
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />,
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };

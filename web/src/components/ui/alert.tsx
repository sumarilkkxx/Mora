import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib-utils";

const alertVariants = cva("relative w-full rounded-[1.15rem] border p-4 shadow-[var(--shadow-xs)]", {
  variants: {
    variant: {
      default:
        "border-[hsl(var(--border)/0.82)] bg-[hsl(var(--card)/0.94)] text-[hsl(var(--foreground))]",
      info: "border-[hsl(210_60%_84%)] bg-[hsl(210_90%_97%)] text-[hsl(210_58%_28%)]",
      warning: "border-[hsl(38_70%_82%)] bg-[hsl(40_88%_96%)] text-[hsl(32_70%_28%)]",
      destructive: "border-[hsl(var(--destructive)/0.2)] bg-[hsl(var(--destructive)/0.08)] text-[hsl(var(--destructive))]",
      success: "border-[hsl(144_42%_80%)] bg-[hsl(142_60%_96%)] text-[hsl(152_54%_28%)]",
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

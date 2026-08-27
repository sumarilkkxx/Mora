import type { HTMLAttributes, ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";

import { cn } from "@/lib/utils";

const icons = {
  info: Info,
  success: CircleCheck,
  warning: CircleAlert,
  danger: CircleX,
};

export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  tone?: keyof typeof icons;
  title?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = icons[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      data-slot="notice"
      data-tone={tone}
      className={cn("mora-notice", className)}
      {...props}
    >
      <Icon className="mora-notice-icon" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <div className="mora-notice-title">{title}</div>}
        {children && <div className="mora-notice-body">{children}</div>}
      </div>
      {action && <div className="mora-notice-action">{action}</div>}
    </div>
  );
}

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageFrame({
  children,
  className,
  width = "wide",
}: {
  children: ReactNode;
  className?: string;
  width?: "content" | "wide" | "full";
}) {
  const widths = {
    content: "max-w-4xl",
    wide: "max-w-6xl",
    full: "max-w-[1600px]",
  };

  return (
    <main className={cn("studio-page", widths[width], className)}>
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  description,
  context,
  variant = "default",
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  context?: ReactNode;
  variant?: "default" | "compact";
  actions?: ReactNode;
}) {
  return (
    <header className="studio-page-header" data-variant={variant}>
      {context && <div className="studio-page-context">{context}</div>}
      <div className="studio-page-heading">
        <h1 className="studio-title">{title}</h1>
        {description && <p className="studio-subtitle">{description}</p>}
      </div>
      {actions && <div className="studio-page-actions">{actions}</div>}
    </header>
  );
}

export function Surface({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <section className={cn("studio-surface", interactive && "studio-surface-interactive", className)}>
      {children}
    </section>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="studio-section-header">
      <div className="min-w-0">
        <h2 className="studio-section-title">{title}</h2>
        {description && <p className="studio-section-description">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function SegmentedControl({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="studio-segmented" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function SegmentedItem({
  children,
  selected,
  onClick,
}: {
  children: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn("studio-segmented-item", selected && "is-selected")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("studio-skeleton", className)} />;
}

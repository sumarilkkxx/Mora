"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

type ChoiceCardProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> & {
  selected: boolean;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
};

export function ChoiceCard({ selected, title, description, icon, meta, className, ...props }: ChoiceCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-slot="choice-card"
      data-selected={selected || undefined}
      className={cn("mora-choice-card", className)}
      {...props}
    >
      <span className="mora-choice-card-heading">
        {icon && <span className="mora-choice-card-icon" aria-hidden="true">{icon}</span>}
        <span className="mora-choice-card-title">{title}</span>
        <span className="mora-choice-card-indicator" aria-hidden="true">
          {selected && <Check className="size-3" strokeWidth={2.7} />}
        </span>
      </span>
      {description && <span className="mora-choice-card-description">{description}</span>}
      {meta && <span className="mora-choice-card-meta">{meta}</span>}
    </button>
  );
}

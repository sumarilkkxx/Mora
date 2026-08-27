"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: ReactNode;
  description?: ReactNode;
};

export function Checkbox({ label, description, className, id, ...props }: CheckboxProps) {
  const control = (
    <span className="relative mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-border/90 bg-card text-transparent shadow-[inset_0_1px_1px_rgba(0,0,0,.03)] transition-[border-color,background-color,color,box-shadow] peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/20 peer-disabled:opacity-45">
      <Check className="size-3.5" strokeWidth={2.8} aria-hidden="true" />
    </span>
  );

  return (
    <label className={cn("group/checkbox flex min-w-0 cursor-pointer items-start gap-2.5 text-sm select-none has-[:disabled]:cursor-not-allowed", className)}>
      <input id={id} type="checkbox" className="peer sr-only" {...props} />
      {control}
      {label || description ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          {label ? <span className="font-medium leading-5 text-foreground">{label}</span> : null}
          {description ? <span className="text-xs leading-5 text-muted-foreground">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

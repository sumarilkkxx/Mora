"use client";

import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "value"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export function Switch({ checked, onCheckedChange, className, disabled, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border border-transparent bg-foreground/16 p-0.5 outline-none transition-[background-color,box-shadow,opacity] duration-150 focus-visible:ring-3 focus-visible:ring-ring/22 disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:bg-primary",
        className,
      )}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    >
      <span
        aria-hidden="true"
        className="block size-[17px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.24)] transition-transform duration-150 data-[state=checked]:translate-x-4"
        data-state={checked ? "checked" : "unchecked"}
      />
    </button>
  );
}

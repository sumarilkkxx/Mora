import * as React from "react";
import { cn } from "../../lib-utils";

type Option = { value: string; label: string };

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  options: Option[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}

export function Select({ className, options, value, onValueChange, placeholder, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "flex h-11 w-full rounded-[0.95rem] border border-[hsl(var(--input)/0.96)] bg-[hsl(var(--card)/0.98)] px-3.5 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none shadow-[inset_0_1px_0_hsl(0_0%_100%/0.28)] transition-[border-color,box-shadow,background-color] duration-200 ease-out focus-visible:border-[hsl(var(--primary)/0.5)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring)/0.18)]",
        className,
      )}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

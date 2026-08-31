"use client";

import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export function StudioUtilities({ className, compactLanguage = false }: { className?: string; compactLanguage?: boolean }) {
  return (
    <div className={cn("studio-utilities", className)}>
      <LanguageToggle compact={compactLanguage} />
      <span className="studio-utilities-divider" aria-hidden="true" />
      <ThemeToggle compact />
    </div>
  );
}

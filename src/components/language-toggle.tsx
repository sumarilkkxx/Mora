"use client";

import { ChevronDown, Globe2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale, useSetLocale } from "@/lib/i18n";
import { LOCALE_LABELS, type Locale } from "@/lib/i18n/config";

/**
 * Global language picker. A named trigger and anchored menu make this setting
 * discoverable without taking attention away from the current task.
 */
export function LanguageToggle({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const label = locale === "zh" ? "简体中文" : "English";
  const menuLabel = locale === "zh" ? "界面语言" : "Interface language";
  const triggerLabel = locale === "zh" ? "选择界面语言" : "Choose interface language";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={triggerLabel}
        title={triggerLabel}
        className={`language-toggle${compact ? " is-compact" : ""} ${className}`}
      >
        <Globe2 className="language-toggle-globe" strokeWidth={1.8} />
        <span>{compact ? (locale === "zh" ? "中文" : "EN") : label}</span>
        <ChevronDown className="language-toggle-chevron" strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="language-menu-content min-w-56">
        <div className="language-menu-label">{menuLabel}</div>
        <DropdownMenuRadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
          {(["zh", "en"] as const).map((item) => (
            <DropdownMenuRadioItem key={item} value={item} className="language-menu-item">
              <span className="language-menu-code">{item === "zh" ? "中" : "EN"}</span>
              <span className="language-menu-copy">
                <strong>{item === "zh" ? "简体中文" : LOCALE_LABELS[item]}</strong>
                <small>{item === "zh" ? "Chinese, Simplified" : "English"}</small>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

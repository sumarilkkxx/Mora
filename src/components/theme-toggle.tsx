"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide";
import { MorphIcon } from "morphicons/react";
import { useT } from "@/lib/i18n";
import { ICON_STROKE_WIDTH } from "@/lib/iconography";

const THEME_KEY = "mora_theme";
const THEME_EVENT = "mora-theme-change";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function subscribe(listener: () => void) {
  window.addEventListener(THEME_EVENT, listener);
  return () => window.removeEventListener(THEME_EVENT, listener);
}

function getThemeSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const t = useT("common");
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, getServerThemeSnapshot);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: next }));
  };

  const nextLabel = t(theme === "dark" ? "themeSwitchLight" : "themeSwitchDark");

  return (
    <button type="button" onClick={toggle} className={`apple-theme-toggle${compact ? " is-compact" : ""}`} aria-label={nextLabel} title={nextLabel}>
      <span className="apple-theme-toggle-track" aria-hidden="true">
        <span className={`apple-theme-toggle-thumb ${theme === "dark" ? "is-dark" : ""}`}>
          <MorphIcon icon={theme === "dark" ? Moon : Sun} size={13} strokeWidth={ICON_STROKE_WIDTH} spring="smooth" reducedMotion="user" />
        </span>
      </span>
      {!compact && <span>{t("themeAppearance")} · {t(theme === "dark" ? "themeDark" : "themeLight")}</span>}
    </button>
  );
}

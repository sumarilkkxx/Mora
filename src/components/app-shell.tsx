"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, ChevronLeft, Clapperboard, FolderKanban, ImagePlus, Library, Menu, Plus, Settings2, Sparkles, UserRound, WandSparkles, Workflow } from "lucide-react";

import { LanguageToggle } from "@/components/language-toggle";
import { StudioUtilities } from "@/components/studio-utilities";
import { ThemeToggle } from "@/components/theme-toggle";
import { TaskCenter } from "@/components/task-center";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* eslint-disable @next/next/no-img-element -- local vector mark does not benefit from optimization */

interface NavItem {
  key: string;
  href: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}

const NAV_SECTIONS: { labelKey: string; icon: ComponentType<{ className?: string }>; items: NavItem[] }[] = [
  {
    labelKey: "navSectionCreate",
    icon: Sparkles,
    items: [
      { key: "navHome", href: "/start", icon: WandSparkles },
      { key: "navProjects", href: "/projects", icon: FolderKanban },
    ],
  },
  {
    labelKey: "navSectionLibrary",
    icon: Library,
    items: [
      { key: "navProducts", href: "/products", icon: Boxes },
      { key: "navPresenters", href: "/presenters", icon: UserRound },
      { key: "navMediaLab", href: "/media-lab", icon: ImagePlus },
    ],
  },
  {
    labelKey: "navSectionAutomation",
    icon: Workflow,
    items: [
      { key: "navClone", href: "/project/clone", icon: Clapperboard },
      { key: "navBatch", href: "/batch", icon: Workflow },
    ],
  },
];

const NAV_COLLAPSED_KEY = "mora_nav_collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT("common");
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const isProjectWorkspace = /^\/project\/[^/]+\/(script|assets|video|export|production|transcript)/.test(pathname ?? "");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try { setCollapsed(localStorage.getItem(NAV_COLLAPSED_KEY) === "1"); } catch { /* optional */ }
    });
    return () => { cancelled = true; };
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0"); } catch { /* optional */ }
      return next;
    });
  };

  const allItems = NAV_SECTIONS.flatMap((section) => section.items);
  const activeHref = allItems.reduce<string | null>((match, item) => {
    const studioRoute = item.href === "/start" && (pathname === "/start" || pathname === "/project/new" || pathname === "/project/topic");
    const matches = studioRoute || pathname === item.href || pathname?.startsWith(`${item.href}/`);
    if (!matches) return match;
    return !match || item.href.length > match.length ? item.href : match;
  }, null);

  return (
    <div className="studio-app-shell">
      <aside className={cn("studio-sidebar", collapsed && "is-collapsed")}>
        <div className="studio-sidebar-top">
          <Link href="/start" className="studio-wordmark" aria-label="Mora Studio">
            <img src="/icon.svg" alt="" width={32} height={32} />
            {!collapsed && <span><strong>Mora</strong><small>Studio</small></span>}
          </Link>
          <div className="studio-sidebar-actions">
            <button type="button" onClick={toggleCollapsed} className="studio-icon-button hidden md:inline-flex" aria-label={t(collapsed ? "navExpand" : "navCollapse")} title={t(collapsed ? "navExpand" : "navCollapse")}> 
              <ChevronLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
            </button>
          </div>
        </div>

        <Link href="/start" className={cn("studio-new-button", collapsed && "is-icon-only")}>
          <Plus className="size-4" strokeWidth={2.25} />
          {!collapsed && <span>{t("navNew")}</span>}
        </Link>

        <nav className="studio-nav" aria-label="Primary">
          {NAV_SECTIONS.map((section) => (
            <div className="studio-nav-section" key={section.labelKey}>
              {!collapsed && <div className="studio-nav-label">{t(section.labelKey)}</div>}
              {section.items.map((item) => {
                const Icon = item.icon;
                const selected = activeHref === item.href;
                return (
                  <Link key={item.href} href={item.href} aria-current={selected ? "page" : undefined} title={collapsed ? t(item.key) : undefined} className={cn("studio-nav-item", selected && "is-active")}>
                    <Icon className="size-[18px]" strokeWidth={1.8} />
                    {!collapsed && <span>{t(item.key)}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="studio-sidebar-footer">
          <TaskCenter collapsed={collapsed} />
          <Link href="/settings" aria-current={pathname?.startsWith("/settings") ? "page" : undefined} title={collapsed ? t("settings") : undefined} className={cn("studio-nav-item", pathname?.startsWith("/settings") && "is-active")}> 
            <Settings2 className="size-[18px]" strokeWidth={1.8} />
            {!collapsed && <span>{t("settings")}</span>}
          </Link>
        </div>
      </aside>

      <div className="studio-content-column">
        {!isProjectWorkspace && (
          <header className="studio-desktop-topbar">
            <StudioUtilities />
          </header>
        )}
        <header className="studio-mobile-header">
          <Link href="/start" className="studio-mobile-brand"><img src="/icon.svg" alt="" width={28} height={28} /><span>Mora</span></Link>
          <div className="flex items-center gap-1">
            <TaskCenter collapsed />
            <ThemeToggle compact />
            <LanguageToggle compact />
            <DropdownMenu>
              <DropdownMenuTrigger aria-label={t("navMenu")} className="studio-icon-button"><Menu className="size-[18px]" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem render={<Link href="/start" />}>{t("navNew")}</DropdownMenuItem>
                {allItems.map((item) => <DropdownMenuItem key={item.href} render={<Link href={item.href} />}>{t(item.key)}</DropdownMenuItem>)}
                <DropdownMenuItem render={<Link href="/settings" />}>{t("settings")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

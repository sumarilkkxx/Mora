"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ProjectStepper } from "@/components/project-stepper";
import { StudioUtilities } from "@/components/studio-utilities";
import type { ProductionMode } from "@/lib/production-mode";

/**
 * Slim sticky context strip for the four project pipeline pages
 * (script / assets / video / export). The global chrome (logo, nav,
 * navigation) lives in AppShell. Project-scoped preferences live here so
 * they remain aligned with the task navigation instead of floating over it.
 *
 * Sticky offset: sits below the mobile top bar (h-12) on small screens,
 * flush to the top on md+ where the sidebar replaces the top bar.
 */
export function ProjectHeader({
  projectName,
  showStepper = true,
  centerLabel,
  backHref,
  backLabel,
  productionMode,
}: {
  projectName?: string;
  showStepper?: boolean;
  centerLabel?: string;
  backHref?: string;
  backLabel?: string;
  productionMode?: ProductionMode | null;
}) {
  const hasCenter = showStepper || Boolean(centerLabel);
  return (
    <div className="project-workspace-header sticky top-[54px] z-40 border-b border-border/70 bg-background/82 backdrop-blur-2xl md:top-0">
      <div className={`project-header-inner mx-auto grid h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-8 ${hasCenter ? "" : "is-compact"}`}>
        <div className="project-header-title flex min-w-0 items-center gap-2.5">
          {backHref ? (
            <Link href={backHref} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-primary/[.055] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{backLabel}</span>
            </Link>
          ) : null}
          <span className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground">{projectName ?? ""}</span>
        </div>
        {showStepper ? <div className="project-header-stepper"><ProjectStepper productionMode={productionMode} /></div> : centerLabel ? <div className="project-header-stepper text-[13px] font-semibold tracking-[-0.01em] text-foreground">{centerLabel}</div> : null}
        <StudioUtilities className="project-header-utilities" compactLanguage />
      </div>
    </div>
  );
}

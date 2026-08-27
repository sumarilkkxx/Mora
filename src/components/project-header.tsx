"use client";

import { ProjectStepper } from "@/components/project-stepper";
import { StudioUtilities } from "@/components/studio-utilities";

/**
 * Slim sticky context strip for the four project pipeline pages
 * (script / assets / video / export). The global chrome (logo, nav,
 * navigation) lives in AppShell. Project-scoped preferences live here so
 * they remain aligned with the task navigation instead of floating over it.
 *
 * Sticky offset: sits below the mobile top bar (h-12) on small screens,
 * flush to the top on md+ where the sidebar replaces the top bar.
 */
export function ProjectHeader({ projectName }: { projectName?: string }) {
  return (
    <div className="project-workspace-header sticky top-[54px] z-40 border-b border-border/70 bg-background/82 backdrop-blur-2xl md:top-0">
      <div className="project-header-inner mx-auto grid h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-8">
        <span className="project-header-title min-w-0 truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground">
          {projectName ?? ""}
        </span>
        <div className="project-header-stepper"><ProjectStepper /></div>
        <StudioUtilities className="project-header-utilities" compactLanguage />
      </div>
    </div>
  );
}

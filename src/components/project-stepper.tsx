"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useT } from "@/lib/i18n";

// Pipeline steps in order; `path` is the route suffix under /project/[id]/
const STEPS = [
  { key: "stepScript", path: "script" },
  { key: "stepAssets", path: "assets" },
  { key: "stepVideo", path: "video" },
  { key: "stepExport", path: "export" },
] as const;

/**
 * Clickable four-step progress pills shared by the project pipeline pages
 * (script / assets / export). Visually identical to the legacy inline
 * stepper, but every pill is a real link so users can jump between steps:
 * the current step is highlighted, completed steps show a check mark, and
 * future steps are muted — all remain navigable.
 *
 * The current step is derived from the pathname suffix (no props needed);
 * the project id comes from useParams.
 *
 * NOTE: video/page.tsx still renders its own legacy inline (non-clickable)
 * stepper because that file is owned by a parallel session (avoidance).
 * Once the avoidance is lifted, replace its inline stepper with this
 * component as well.
 */
export function ProjectStepper() {
  const t = useT("common");
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  // Current step index from the route suffix; clamp to 0 if no suffix matches
  const current = Math.max(
    0,
    STEPS.findIndex((s) => pathname?.endsWith(`/${s.path}`))
  );

  return (
    <>
      {/* mobile: full step pills don't fit, show a compact "current step / total" badge instead */}
      <div className="sm:hidden flex h-8 items-center gap-1.5 rounded-[10px] bg-muted px-3 text-xs font-medium text-foreground">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
          {current + 1}
        </span>
        {t(STEPS[current].key)}
        <span className="text-muted-foreground">{current + 1}/{STEPS.length}</span>
      </div>
      {/* desktop: full pills; every step links to its page for free navigation */}
      <div className="studio-segmented hidden sm:flex">
        {STEPS.map((step, i) => (
          <div key={step.key} className="flex items-center">
            <Link
              href={`/project/${id}/${step.path}`}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-[background-color,color,transform,box-shadow] active:scale-[.98] ${
                i === current
                  ? "bg-card text-foreground shadow-sm"
                  : i < current
                  ? "text-primary hover:bg-primary/10"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  i === current ? "bg-primary text-primary-foreground" : i < current ? "bg-primary/15" : "bg-muted"
                }`}
              >
                {i < current ? "✓" : i + 1}
              </span>
              <span className="project-step-label">{t(step.key)}</span>
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}

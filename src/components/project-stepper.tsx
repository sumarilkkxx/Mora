"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Check, HardDrive, Sparkles } from "lucide-react";
import { useT } from "@/lib/i18n";
import { normalizeProductionMode, type ProductionMode } from "@/lib/production-mode";

const AI_STEPS = [
  { key: "stepScript", path: "script", matches: ["script"] },
  { key: "stepAiAssets", path: "assets", matches: ["assets"] },
  { key: "stepAiVideo", path: "ai-video", matches: ["ai-video"] },
  { key: "stepExport", path: "export", matches: ["export"] },
] as const;

const LOCAL_STEPS = [
  { key: "stepScript", path: "script", matches: ["script"] },
  { key: "stepLocalAssets", path: "assets", matches: ["assets"] },
  { key: "stepCompose", path: "compose", matches: ["compose", "video"] },
  { key: "stepExport", path: "export", matches: ["export"] },
] as const;

/**
 * Mode-aware progress pills shared by the project pipeline pages. AI and
 * local production deliberately use different step definitions so helper
 * workspaces never leak into or replace the project's primary navigation.
 *
 * The current step is derived from the pathname suffix (no props needed);
 * the project id comes from useParams.
 *
 */
export function ProjectStepper({ productionMode }: { productionMode?: ProductionMode | null }) {
  const t = useT("common");
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const mode = normalizeProductionMode(productionMode);
  const steps = mode === "ai" ? AI_STEPS : LOCAL_STEPS;
  const routeSuffix = pathname?.split("/").filter(Boolean).at(-1) ?? "script";
  // Current step index from the route suffix; clamp to 0 if no suffix matches
  const current = Math.max(
    0,
    steps.findIndex((step) => (step.matches as readonly string[]).includes(routeSuffix))
  );
  const ModeIcon = mode === "ai" ? Sparkles : HardDrive;

  return (
    <nav className={`project-flow project-flow-${mode}`} aria-label={t(mode === "ai" ? "modeAi" : "modeLocal")}>
      <div className="project-flow-context">
        <span className="project-flow-context-icon" aria-hidden="true"><ModeIcon /></span>
        <span className="project-flow-context-copy">
          <strong>{t(mode === "ai" ? "modeAiShort" : "modeLocalShort")}</strong>
        </span>
      </div>
      <span className="project-flow-divider" aria-hidden="true" />
      <div className="project-flow-steps">
        {steps.map((step, i) => {
          const state = i === current ? "current" : i < current ? "complete" : "upcoming";
          return (
            <div key={step.key} className="project-flow-step-wrap">
              {i > 0 ? <span className={`project-flow-line ${i <= current ? "is-complete" : ""}`} aria-hidden="true" /> : null}
              <Link
                href={`/project/${id}/${step.path}`}
                className={`project-flow-step is-${state}`}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span className="project-flow-index" aria-hidden="true">
                  {state === "complete" ? <Check /> : i + 1}
                </span>
                <span className="project-step-label">{t(step.key)}</span>
              </Link>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

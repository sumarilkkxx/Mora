/**
 * Stage model for the server-side hands-off pipeline (pipeline_runs table).
 *
 * Pure data + functions so both the runner and the UI share one source of truth
 * for ordering, resume slicing and progress labels.
 */

/** Execution order of the free hands-off chain. */
export const PIPELINE_STAGES = ["judge", "stock_fill", "compose"] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export function isPipelineStage(v: unknown): v is PipelineStage {
  return typeof v === "string" && (PIPELINE_STAGES as readonly string[]).includes(v);
}

/**
 * Stages left to run when starting (or resuming) from `from`. An unknown value
 * falls back to the full chain — resuming too early is safe (stages are
 * re-runnable), resuming too late would skip work.
 */
export function stagesFrom(from: unknown): PipelineStage[] {
  const idx = isPipelineStage(from) ? PIPELINE_STAGES.indexOf(from) : 0;
  return PIPELINE_STAGES.slice(idx) as PipelineStage[];
}

/** script-namespace i18n key for each stage's progress line. */
export const STAGE_LABEL_KEYS: Record<PipelineStage, string> = {
  judge: "autoJudging",
  stock_fill: "autoFinishAssets",
  compose: "autoFinishComposing",
};

export type ProductionMode = "ai" | "local";
export type VideoOrigin = "local_render" | "cloud_ai";

export function normalizeProductionMode(value: unknown): ProductionMode {
  return value === "ai" ? "ai" : "local";
}

export function productionModeForCreation(value: unknown): ProductionMode {
  return normalizeProductionMode(value);
}

/**
 * Final-video provenance overrides the creation-time preference. AI-generated
 * images, voiceovers and copy never call this function and therefore cannot
 * accidentally turn a locally rendered project into an AI-video workflow.
 */
export function productionModeForVideoOrigin(
  videoOrigin: unknown,
  fallback: unknown = "local",
): ProductionMode {
  if (videoOrigin === "cloud_ai") return "ai";
  if (videoOrigin === "local_render") return "local";
  return normalizeProductionMode(fallback);
}

/** Newly generated scripts always stop at review; project mode lives in the DB. */
export function projectScriptReviewPath(projectId: string, presenterId?: string): string {
  const base = `/project/${projectId}/script`;
  return presenterId ? `${base}?presenter=${encodeURIComponent(presenterId)}` : base;
}

export function projectContinuePath(
  projectId: string,
  status: string,
  productionMode: unknown,
  workflowType?: string
): string {
  if (workflowType === "edit") return `/project/${projectId}/edit`;
  if (status === "done") return `/project/${projectId}/export`;
  const mode = normalizeProductionMode(productionMode);
  if (mode === "local" && (status === "video" || status === "composing")) {
    return `/project/${projectId}/compose`;
  }
  if (status === "assets" || status === "video" || status === "composing") {
    return mode === "ai" && (status === "video" || status === "composing")
      ? `/project/${projectId}/ai-video`
      : `/project/${projectId}/assets`;
  }
  return `/project/${projectId}/script`;
}

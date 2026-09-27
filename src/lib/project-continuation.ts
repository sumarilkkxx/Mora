import { normalizeProductionMode, type ProductionMode, type VideoOrigin } from "./production-mode";

export const PROJECT_WORKFLOW_MODES = [
  "auto_edit",
  "guided_edit",
  "transcript_edit",
  "local_generate",
  "cloud_generate",
] as const;

export type ProjectWorkflowMode = typeof PROJECT_WORKFLOW_MODES[number];

type RunEvidence = { id: string; status: string; stage?: string | null };
type CompositionEvidence = { id: string; status: string; videoOrigin?: VideoOrigin | null };

export interface ProjectContinuationInput {
  projectId: string;
  workflowType?: string | null;
  workflowMode?: string | null;
  productionMode?: unknown;
  projectStatus?: string | null;
  hasScript?: boolean;
  hasAssets?: boolean;
  latestAutoEditRun?: RunEvidence | null;
  latestGuidedPlan?: RunEvidence | null;
  latestMediaEdit?: RunEvidence | null;
  latestPipelineRun?: RunEvidence | null;
  latestComposition?: CompositionEvidence | null;
}

export interface ProjectContinuation {
  mode: ProjectWorkflowMode;
  stage: string;
  href: string;
  operation?: { id: string; status: string; resumable: boolean };
}

function declaredMode(value: unknown): ProjectWorkflowMode | null {
  return typeof value === "string" && (PROJECT_WORKFLOW_MODES as readonly string[]).includes(value)
    ? value as ProjectWorkflowMode
    : null;
}

function generationMode(input: ProjectContinuationInput): "local_generate" | "cloud_generate" {
  if (input.latestComposition?.videoOrigin === "cloud_ai") return "cloud_generate";
  if (input.latestComposition?.videoOrigin === "local_render") return "local_generate";
  const explicit = declaredMode(input.workflowMode);
  if (explicit === "cloud_generate" || explicit === "local_generate") return explicit;
  return normalizeProductionMode(input.productionMode) === "ai" ? "cloud_generate" : "local_generate";
}

function resolveMode(input: ProjectContinuationInput): ProjectWorkflowMode {
  const explicit = declaredMode(input.workflowMode);
  if (explicit === "auto_edit" || explicit === "guided_edit" || explicit === "transcript_edit") return explicit;
  if (input.latestAutoEditRun) return "auto_edit";
  if (input.latestGuidedPlan) return "guided_edit";
  if (input.latestMediaEdit) return "transcript_edit";
  if (input.workflowType === "edit") return "guided_edit";
  return generationMode(input);
}

function operation(run: RunEvidence | null | undefined) {
  if (!run) return undefined;
  return {
    id: run.id,
    status: run.status,
    resumable: ["failed", "cancelled", "interrupted", "waiting_input", "needs_review"].includes(run.status),
  };
}

export function resolveProjectContinuation(input: ProjectContinuationInput): ProjectContinuation {
  const mode = resolveMode(input);
  const base = `/project/${encodeURIComponent(input.projectId)}`;

  if (mode === "auto_edit") {
    const run = input.latestAutoEditRun;
    return {
      mode,
      stage: run?.stage || "source",
      ...(run ? { operation: operation(run) } : {}),
      href: `${base}/auto-edit${run ? `?run=${encodeURIComponent(run.id)}` : ""}`,
    };
  }
  if (mode === "guided_edit") {
    const plan = input.latestGuidedPlan;
    return { mode, stage: plan?.status || "source", ...(plan ? { operation: operation(plan) } : {}), href: `${base}/edit` };
  }
  if (mode === "transcript_edit") {
    const edit = input.latestMediaEdit;
    return { mode, stage: edit?.status || "transcript", ...(edit ? { operation: operation(edit) } : {}), href: `${base}/transcript` };
  }

  const composition = input.latestComposition;
  if (composition?.status === "done") return { mode, stage: "export", href: `${base}/export` };

  const renderHref = mode === "cloud_generate" ? `${base}/ai-video` : `${base}/compose`;
  if (composition) {
    return {
      mode,
      stage: "render",
      operation: operation(composition)!,
      href: renderHref,
    };
  }
  if (input.latestPipelineRun) {
    const pipeline = input.latestPipelineRun;
    const stage = pipeline.stage || "production";
    return {
      mode,
      stage,
      operation: operation(pipeline)!,
      href: stage === "compose" ? renderHref : `${base}/production`,
    };
  }
  if (input.hasAssets) return { mode, stage: mode === "cloud_generate" ? "video" : "compose", href: renderHref };
  if (input.hasScript) return { mode, stage: "assets", href: `${base}/assets` };

  // Legacy projects created before detailed continuation evidence existed retain
  // their previous status-based destination until the next persisted operation.
  if (input.projectStatus === "done") return { mode, stage: "export", href: `${base}/export` };
  if (input.projectStatus === "video" || input.projectStatus === "composing") {
    return { mode, stage: "render", href: renderHref };
  }
  if (input.projectStatus === "assets") return { mode, stage: "assets", href: `${base}/assets` };
  return { mode, stage: "script", href: `${base}/script` };
}

export function workflowModeForCreation(workflowType: unknown, productionMode: unknown, workflowMode: unknown): ProjectWorkflowMode {
  const explicit = declaredMode(workflowMode);
  if (workflowType === "edit") {
    return explicit === "auto_edit" || explicit === "guided_edit" || explicit === "transcript_edit"
      ? explicit
      : "guided_edit";
  }
  return explicit === "cloud_generate" || explicit === "local_generate"
    ? explicit
    : normalizeProductionMode(productionMode) === "ai" ? "cloud_generate" : "local_generate";
}

export function productionModeForWorkflow(mode: ProjectWorkflowMode): ProductionMode {
  return mode === "cloud_generate" ? "ai" : "local";
}

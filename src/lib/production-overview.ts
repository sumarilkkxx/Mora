export type ProductionOverviewState = "empty" | "ready" | "running" | "attention" | "failed" | "complete";
export type ProductionStageState = "blocked" | "empty" | "idle" | "ready" | "running" | "attention" | "failed" | "done";
export type ProductionStageId = "script" | "assets" | "operation" | "composition" | "qc" | "release";

interface ProjectFact { id: string; name: string; productionWorkflow?: unknown }
interface ScriptFact { id: string; selected?: boolean | null; shots?: unknown[] | null }
interface AssetFact { id: string; shotId: number; status: string }
interface TaskFact { id: string; status: string; mediaType?: string | null; error?: string | null }
interface CompositionFact { id: string; status: string; outputPath?: string | null; label?: string | null }
interface OperationFact { id: string; kind: string; status: string; stage: string; checkpoint?: Record<string, unknown> | null; error?: string | null }
interface SnapshotFact { id: string; label: string; createdAt: string; assetIds: string[]; compositionId?: string }

export interface ProductionOverviewInput {
  project: ProjectFact;
  scripts: ScriptFact[];
  assets: AssetFact[];
  tasks: TaskFact[];
  compositions: CompositionFact[];
  operations: OperationFact[];
  snapshots: SnapshotFact[];
}

export interface ProductionAction {
  id: ProductionStageId;
  href: string | null;
  enabled: boolean;
  reason?: "script_required" | "assets_required" | "composition_required" | "no_operation";
}

export interface ProductionStage {
  id: ProductionStageId;
  state: ProductionStageState;
  detail: string | null;
  current: number;
  total: number;
  action: ProductionAction;
}

export interface ProductionOverviewModel {
  summary: { state: ProductionOverviewState; progress: number; nextAction: ProductionAction };
  stages: ProductionStage[];
  cost: { submittedCalls: number; activeCalls: number; completedCalls: number; failedCalls: number; currency: null; amount: null };
  versions: { scripts: number; assets: number; compositions: number; snapshots: number };
  failure: { source: "operation" | "task" | "composition"; id: string; error: string; recoverable: boolean } | null;
  legacyWorkflowIgnored: boolean;
}

const activeOperation = new Set(["queued", "running", "cancel_requested"]);
const attentionOperation = new Set(["waiting_input", "interrupted"]);
const activeTask = new Set(["submitted", "processing", "unknown"]);

function action(projectId: string, id: ProductionStageId, enabled: boolean, reason?: ProductionAction["reason"]): ProductionAction {
  const href = id === "script" ? `/project/${projectId}/script`
    : id === "assets" ? `/project/${projectId}/assets`
    : id === "operation" ? "/tasks"
    : id === "composition" || id === "qc" ? `/project/${projectId}/video`
    : `/project/${projectId}/export`;
  return { id, href: enabled ? href : null, enabled, ...(!enabled && reason ? { reason } : {}) };
}

/**
 * The single derivation seam for the production overview. Stored workflow plans
 * are intentionally absent from the decision tree: every state comes from a
 * durable domain row or OperationRun.
 */
export function deriveProductionOverview(input: ProductionOverviewInput): ProductionOverviewModel {
  const selectedScript = input.scripts.find(row => row.selected) ?? input.scripts[0];
  const shotCount = selectedScript?.shots?.length ?? 0;
  const latestAssetByShot = new Map<number, AssetFact>();
  for (const row of input.assets) if (!latestAssetByShot.has(row.shotId)) latestAssetByShot.set(row.shotId, row);
  const effectiveAssets = [...latestAssetByShot.values()];
  const doneAssets = effectiveAssets.filter(row => row.status === "done").length;
  const failedAssets = effectiveAssets.filter(row => row.status === "failed").length;
  const activeAssets = effectiveAssets.filter(row => row.status === "pending" || row.status === "generating").length;
  const latestOperation = input.operations[0];
  const latestTask = input.tasks[0];
  const latestComposition = input.compositions[0];
  const hasScript = Boolean(selectedScript && shotCount > 0);
  const assetsReady = hasScript && doneAssets >= shotCount;
  const operationState: ProductionStageState = latestOperation
    ? activeOperation.has(latestOperation.status) ? "running"
      : attentionOperation.has(latestOperation.status) ? "attention"
      : latestOperation.status === "failed" ? "failed"
      : latestOperation.status === "done" ? "done" : "idle"
    : !latestTask ? "idle"
      : latestTask.status === "submitted" || latestTask.status === "processing" ? "running"
      : latestTask.status === "unknown" ? "attention"
      : latestTask.status === "failed" ? "failed"
      : latestTask.status === "completed" ? "done" : "idle";
  const compositionState: ProductionStageState = latestComposition?.status === "done" ? "done"
    : latestComposition?.status === "composing" || latestComposition?.status === "pending" ? "running"
    : latestComposition?.status === "failed" ? "failed"
    : !hasScript ? "blocked" : assetsReady ? "ready" : "blocked";

  const stages: ProductionStage[] = [
    { id: "script", state: hasScript ? "done" : "empty", detail: selectedScript?.id ?? null, current: hasScript ? 1 : 0, total: 1, action: action(input.project.id, "script", true) },
    {
      id: "assets",
      state: !hasScript ? "blocked" : failedAssets > 0 && doneAssets === 0 ? "failed" : assetsReady ? "done" : activeAssets > 0 || doneAssets > 0 ? "running" : "empty",
      detail: null, current: doneAssets, total: shotCount,
      action: action(input.project.id, "assets", hasScript, hasScript ? undefined : "script_required"),
    },
    {
      id: "operation", state: operationState, detail: latestOperation?.stage ?? latestTask?.mediaType ?? null,
      current: latestOperation || latestTask ? 1 : 0, total: 1,
      action: action(input.project.id, "operation", Boolean(latestOperation || latestTask), "no_operation"),
    },
    {
      id: "composition", state: compositionState, detail: latestComposition?.label ?? latestComposition?.id ?? null,
      current: latestComposition?.status === "done" ? 1 : 0, total: 1,
      action: action(
        input.project.id,
        "composition",
        assetsReady || Boolean(latestComposition),
        !hasScript ? "script_required" : "assets_required",
      ),
    },
    {
      id: "qc", state: latestComposition?.status === "done" ? "ready" : "blocked", detail: null,
      current: 0, total: 1,
      action: action(input.project.id, "qc", latestComposition?.status === "done", "composition_required"),
    },
    {
      id: "release", state: latestComposition?.status === "done" ? "ready" : "blocked", detail: null,
      current: latestComposition?.status === "done" ? 1 : 0, total: 1,
      action: action(input.project.id, "release", latestComposition?.status === "done", "composition_required"),
    },
  ];

  const operationFailure = latestOperation && (attentionOperation.has(latestOperation.status) || latestOperation.status === "failed") ? latestOperation : undefined;
  const taskFailure = latestComposition?.status === "done" ? undefined
    : latestTask && (latestTask.status === "unknown" || latestTask.status === "failed") ? latestTask : undefined;
  const compositionFailure = latestComposition?.status === "failed" ? latestComposition : undefined;
  const failure = operationFailure ? { source: "operation" as const, id: operationFailure.id, error: operationFailure.error || operationFailure.status, recoverable: true }
    : taskFailure ? { source: "task" as const, id: taskFailure.id, error: taskFailure.error || taskFailure.status, recoverable: true }
    : compositionFailure ? { source: "composition" as const, id: compositionFailure.id, error: "composition_failed", recoverable: true }
    : null;

  const hasActive = Boolean(latestOperation && activeOperation.has(latestOperation.status))
    || input.tasks.some(row => row.status === "submitted" || row.status === "processing")
    || effectiveAssets.some(row => row.status === "generating")
    || latestComposition?.status === "composing" || latestComposition?.status === "pending";
  const hasAttention = Boolean(latestOperation && attentionOperation.has(latestOperation.status)) || input.tasks.some(row => row.status === "unknown");
  const hasFailed = latestOperation?.status === "failed" || latestTask?.status === "failed"
    || effectiveAssets.some(row => row.status === "failed") || latestComposition?.status === "failed";
  const state: ProductionOverviewState = hasActive ? "running" : hasAttention ? "attention" : hasFailed ? "failed"
    : latestComposition?.status === "done" ? "complete" : !hasScript ? "empty" : "ready";
  const nextAction = state === "empty" ? stages[0].action
    : state === "running" || state === "attention" ? stages[2].action
    : state === "failed" ? (failedAssets || taskFailure?.mediaType === "image" ? stages[1].action : latestComposition?.status === "failed" ? stages[3].action : stages[2].action)
    : state === "complete" ? stages[5].action
    : assetsReady ? stages[3].action : stages[1].action;
  const progress = state === "complete" ? 100 : state === "empty" ? 0
    : state === "running" || state === "attention" ? latestOperation ? 33 : latestComposition?.status === "composing" ? 50 : 17
    : hasScript ? assetsReady ? 50 : 17 : 0;

  return {
    summary: { state, progress, nextAction },
    stages,
    cost: {
      submittedCalls: input.tasks.length,
      activeCalls: input.tasks.filter(row => activeTask.has(row.status)).length,
      completedCalls: input.tasks.filter(row => row.status === "completed").length,
      failedCalls: input.tasks.filter(row => row.status === "failed").length,
      currency: null,
      amount: null,
    },
    versions: { scripts: input.scripts.length, assets: input.assets.length, compositions: input.compositions.length, snapshots: input.snapshots.length },
    failure,
    legacyWorkflowIgnored: Array.isArray(input.project.productionWorkflow),
  };
}

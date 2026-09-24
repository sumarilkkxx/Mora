export interface ModelTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
}

export interface ModelPrice {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  cachedInputUsdPerMillionTokens?: number;
  source: string;
  effectiveAt: string;
}

export interface ModelCallTrace {
  kind: "model_call";
  id: string;
  sequence: number;
  stage: string;
  model: string;
  vision: boolean;
  allowedTools: string[];
  startedAt: string;
  durationMs?: number;
  status: "pending" | "succeeded" | "failed";
  usage?: ModelTokenUsage;
  costUsd?: number;
  costStatus: "pending" | "recorded" | "unavailable";
  error?: string;
}

export interface ToolDecisionTrace {
  kind: "tool_decision";
  sequence: number;
  modelCallId: string;
  stage: string;
  tool: string;
  allowed: boolean;
  arguments: unknown;
}

export interface EvaluationTrace {
  schemaVersion: 1;
  runId: string;
  caseId: string;
  datasetVersion: string;
  startedAt: string;
  completedAt?: string;
  modelCalls: ModelCallTrace[];
  toolDecisions: ToolDecisionTrace[];
  budget: {
    stopLimitUsd: number;
    absoluteLimitUsd: number;
    spentUsd: number;
    reservedUsd?: number;
    locked: boolean;
    lockReason?: string;
  };
  metadata: Record<string, unknown>;
}

export interface DeterministicRunFacts {
  terminalState: string;
  allowedTerminalStates: string[];
  compositionExists: boolean;
  technicalPass: boolean;
  modelCalls: number;
  maxModelCalls: number;
  renders: number;
  maxRenders: number;
  spentUsd: number;
  stopLimitUsd: number;
  completionRecorded?: boolean;
  requiredTools: string[];
  mustDecode: boolean;
  mustHaveVideo: boolean;
  outputDecodes: boolean;
  outputHasVideo: boolean;
  actions: Array<{
    tool: string;
    allowed: boolean;
    error?: string;
  }>;
}

export interface EvaluationScore {
  name: "task_success" | "tool_validity" | "required_tools" | "output_verification" | "sequence_compliance" | "completion_honesty" | "budget_compliance";
  score: 0 | 1;
  detail: string;
}

export type EvaluationDatasetSplit = "smoke" | "dev" | "holdout";
export type EvaluationCategory = "product" | "process" | "service" | "difficult";

export interface AgentEvaluationCase {
  caseId: string;
  source: {
    id: string;
    path: string;
    sha256: string;
    page: string;
    author: string;
    group: string;
    category: EvaluationCategory;
    preprocessing: "none" | "remove-silent-audio-stream-copy";
  };
  brief: {
    target: 15 | 20 | 25 | 30;
    aspect: "9:16" | "16:9" | "1:1";
    audio: "voiceover" | "muted";
    style: "auto" | "concise" | "highlights" | "story";
    captions: boolean;
    locale: "zh" | "en";
    instruction: string;
  };
  expected: {
    terminalStates: Array<"done" | "needs_review">;
    requiredTools: string[];
    forbiddenBehaviors: string[];
    maxModelCalls: number;
    maxRenders: number;
    mustDecode: boolean;
    mustHaveVideo: boolean;
  };
  annotation: {
    version: string;
    status: "pending-human-review" | "human-reviewed";
    visibleFacts: string[];
    forbiddenClaims: string[];
  };
}

export interface AgentEvaluationDataset {
  schemaVersion: 1;
  datasetId: string;
  version: string;
  split: EvaluationDatasetSplit;
  independentHoldout: boolean;
  baselineEligible: boolean;
  sourceManifest: { path: string; sha256: string };
  cases: AgentEvaluationCase[];
}

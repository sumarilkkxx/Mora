import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { calculateModelCost, CostLedger, DEFAULT_EVALUATION_ABSOLUTE_LIMIT_USD, DEFAULT_EVALUATION_STOP_LIMIT_USD, EvaluationBudgetError } from "./cost-ledger";
import type { EvaluationTrace, ModelCallTrace, ModelPrice, ModelTokenUsage, ToolDecisionTrace } from "./types";
import type { AutoEditObserver, ModelUsage } from "../../../src/lib/auto-edit/observer";

export interface EvaluationRecorderConfig {
  runId: string;
  caseId: string;
  datasetVersion: string;
  prices: Record<string, ModelPrice>;
  maxRequestCostUsd: number;
  stopLimitUsd?: number;
  absoluteLimitUsd?: number;
  ledger?: CostLedger;
  secrets?: string[];
  metadata?: Record<string, unknown>;
}

function finiteToken(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export function normalizeModelUsage(usage: ModelUsage | null | undefined): ModelTokenUsage | undefined {
  if (!usage) return undefined;
  const promptTokens = finiteToken(usage.prompt_tokens);
  const completionTokens = finiteToken(usage.completion_tokens);
  if (promptTokens === undefined || completionTokens === undefined) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens: finiteToken(usage.total_tokens) ?? promptTokens + completionTokens,
    cachedPromptTokens: finiteToken(usage.prompt_tokens_details?.cached_tokens) ?? 0,
  };
}

function redactedString(value: string, secrets: readonly string[]) {
  let result = value;
  for (const secret of secrets) if (secret) result = result.split(secret).join("[redacted]");
  if (/^data:[^;,]+[;,]/i.test(result)) return "[data-url omitted]";
  return result.length > 4_000 ? `${result.slice(0, 4_000)}...[truncated]` : result;
}

export function redactEvaluationValue(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") return redactedString(value, secrets);
  if (Array.isArray(value)) return value.map(item => redactEvaluationValue(item, secrets));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = /api.?key|authorization|password|secret|token$/i.test(key)
      ? "[redacted]"
      : redactEvaluationValue(item, secrets);
  }
  return output;
}

export class AgentEvaluationRecorder implements AutoEditObserver {
  readonly ledger: CostLedger;
  private readonly trace: EvaluationTrace;
  private readonly started = new Map<string, number>();
  private sequence = 0;

  constructor(private readonly config: EvaluationRecorderConfig) {
    if (!Number.isFinite(config.maxRequestCostUsd) || config.maxRequestCostUsd <= 0) throw new Error("maxRequestCostUsd must be positive");
    if (config.ledger && (config.stopLimitUsd !== undefined || config.absoluteLimitUsd !== undefined)) throw new Error("shared ledger cannot be combined with per-recorder limits");
    this.ledger = config.ledger ?? new CostLedger(config.stopLimitUsd ?? DEFAULT_EVALUATION_STOP_LIMIT_USD, config.absoluteLimitUsd ?? DEFAULT_EVALUATION_ABSOLUTE_LIMIT_USD);
    this.trace = {
      schemaVersion: 1,
      runId: config.runId,
      caseId: config.caseId,
      datasetVersion: config.datasetVersion,
      startedAt: new Date().toISOString(),
      modelCalls: [],
      toolDecisions: [],
      budget: this.ledger.snapshot(),
      metadata: redactEvaluationValue(config.metadata ?? {}, config.secrets) as Record<string, unknown>,
    };
  }

  beginModelCall(input: { stage: string; model: string; vision: boolean; allowedTools?: readonly string[]; estimatedInputTokens: number; requestedMaxOutputTokens: number }) {
    const price = this.config.prices[input.model];
    if (!price) {
      this.ledger.lock(`missing price for model ${input.model}`);
      throw new EvaluationBudgetError(`Agent evaluation has no verified price for model ${input.model}`);
    }
    const inputCostUsd = input.estimatedInputTokens * price.inputUsdPerMillionTokens / 1_000_000;
    const remainingForOutputUsd = this.config.maxRequestCostUsd - inputCostUsd;
    if (remainingForOutputUsd <= 0) {
      throw new EvaluationBudgetError(`Estimated input for model ${input.model} exceeds the per-request cost limit`);
    }
    const affordableOutputTokens = price.outputUsdPerMillionTokens > 0
      ? Math.floor(remainingForOutputUsd * 1_000_000 / price.outputUsdPerMillionTokens)
      : input.requestedMaxOutputTokens;
    const maxOutputTokens = Math.min(input.requestedMaxOutputTokens, affordableOutputTokens);
    if (maxOutputTokens < 128) {
      throw new EvaluationBudgetError(`Per-request cost limit leaves too few output tokens for model ${input.model}`);
    }
    const reservedCostUsd = inputCostUsd + maxOutputTokens * price.outputUsdPerMillionTokens / 1_000_000;
    const id = randomUUID();
    this.ledger.reserve(id, reservedCostUsd);
    const event: ModelCallTrace = {
      kind: "model_call",
      id,
      sequence: ++this.sequence,
      stage: input.stage,
      model: input.model,
      vision: input.vision,
      allowedTools: [...(input.allowedTools ?? [])],
      startedAt: new Date().toISOString(),
      status: "pending",
      costStatus: "pending",
    };
    this.trace.modelCalls.push(event);
    this.started.set(id, performance.now());
    return { id, maxOutputTokens };
  }

  completeModelCall(id: string, rawUsage: ModelUsage | null | undefined) {
    const event = this.modelCall(id);
    event.durationMs = this.duration(id);
    event.status = "succeeded";
    const usage = normalizeModelUsage(rawUsage);
    if (!usage) {
      event.costStatus = "unavailable";
      this.ledger.release(id);
      this.ledger.lock(`model ${event.model} did not return token usage`);
      this.syncBudget();
      return;
    }
    event.usage = usage;
    event.costUsd = calculateModelCost(usage, this.config.prices[event.model]);
    event.costStatus = "recorded";
    this.ledger.record(event.costUsd, id);
    this.syncBudget();
  }

  failModelCall(id: string, error: unknown) {
    const event = this.modelCall(id);
    event.durationMs = this.duration(id);
    event.status = "failed";
    event.costStatus = "unavailable";
    event.error = redactedString(error instanceof Error ? error.message : String(error), this.config.secrets ?? []);
    this.ledger.release(id);
    this.ledger.lock(`failed model request ${id} has unavailable billing usage`);
    this.syncBudget();
  }

  recordToolDecision(modelCallId: string, input: { stage: string; tool: string; allowed: boolean; arguments: unknown }) {
    const event: ToolDecisionTrace = {
      kind: "tool_decision",
      sequence: ++this.sequence,
      modelCallId,
      stage: input.stage,
      tool: input.tool,
      allowed: input.allowed,
      arguments: redactEvaluationValue(input.arguments, this.config.secrets),
    };
    this.trace.toolDecisions.push(event);
  }

  snapshot(complete = false): EvaluationTrace {
    this.syncBudget();
    const copy = structuredClone(this.trace);
    if (complete) copy.completedAt = new Date().toISOString();
    return copy;
  }

  private modelCall(id: string) {
    const event = this.trace.modelCalls.find(call => call.id === id);
    if (!event) throw new Error(`Unknown evaluation model call ${id}`);
    if (event.status !== "pending") throw new Error(`Evaluation model call ${id} is already settled`);
    return event;
  }

  private duration(id: string) {
    const started = this.started.get(id);
    this.started.delete(id);
    return started === undefined ? undefined : Math.max(0, Math.round(performance.now() - started));
  }

  private syncBudget() {
    this.trace.budget = this.ledger.snapshot();
  }
}

export async function appendEvaluationTraceJsonl(path: string, trace: EvaluationTrace) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(trace)}\n`, "utf8");
}

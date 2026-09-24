// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateModelCost, CostLedger, EvaluationBudgetError } from "../core/cost-ledger";
import { scoreDeterministicRun } from "../core/scorers";
import { AgentEvaluationRecorder, appendEvaluationTraceJsonl, normalizeModelUsage } from "../core/trace";
import { summarizeEvaluationMetrics, wilsonScoreInterval } from "../core/metrics";
import type { ModelPrice } from "../core/types";
import { fingerprintSourcePaths, reconcileTerminalTraces, type StoredEvaluationSession } from "../evaluation-session";

const price: ModelPrice = {
  inputUsdPerMillionTokens: 1,
  cachedInputUsdPerMillionTokens: 0.1,
  outputUsdPerMillionTokens: 2,
  source: "test fixture",
  effectiveAt: "2026-09-15",
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("agent evaluation cost ledger", () => {
  it("calculates uncached, cached, and output token cost separately", () => {
    const usage = { promptTokens: 1_000, cachedPromptTokens: 400, completionTokens: 500, totalTokens: 1_500 };
    expect(calculateModelCost(usage, price)).toBe(0.00164);
  });

  it("refuses a request before it would cross the operational stop limit", () => {
    const ledger = new CostLedger();
    ledger.record(5.8);
    expect(() => ledger.assertCanStart(0.25)).toThrow(EvaluationBudgetError);
    expect(ledger.snapshot()).toMatchObject({ spentUsd: 5.8, stopLimitUsd: 6, absoluteLimitUsd: 7 });
  });

  it("includes concurrent in-flight reservations when enforcing the stop limit", () => {
    const ledger = new CostLedger(0.05, 0.1);
    ledger.reserve("first", 0.03);
    expect(ledger.snapshot()).toMatchObject({ spentUsd: 0, reservedUsd: 0.03 });
    expect(() => ledger.reserve("second", 0.03)).toThrow(EvaluationBudgetError);
    ledger.record(0.01, "first");
    ledger.reserve("second", 0.03);
    expect(ledger.snapshot()).toMatchObject({ spentUsd: 0.01, reservedUsd: 0.03 });
  });

  it("normalizes OpenAI-compatible usage without inventing missing values", () => {
    expect(normalizeModelUsage({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, prompt_tokens_details: { cached_tokens: 3 } })).toEqual({
      promptTokens: 10, completionTokens: 4, totalTokens: 14, cachedPromptTokens: 3,
    });
    expect(normalizeModelUsage({ prompt_tokens: 10 })).toBeUndefined();
  });
});

describe("agent evaluation trace", () => {
  it("fingerprints non-TypeScript runtime and dependency inputs", async () => {
    await expect(fingerprintSourcePaths()).resolves.toEqual(expect.arrayContaining([
      "scripts/auto-edit-asr.mjs",
      "package.json",
      "pnpm-lock.yaml",
    ]));
  });
  it("locks future calls when a provider omits billing usage", () => {
    const recorder = new AgentEvaluationRecorder({ runId: "run", caseId: "case", datasetVersion: "v1", prices: { text: price }, maxRequestCostUsd: 0.25 });
    const call = recorder.beginModelCall({ stage: "promotion_copy", model: "text", vision: false, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 6_000 });
    recorder.completeModelCall(call.id, undefined);
    expect(recorder.snapshot().budget).toMatchObject({ spentUsd: 0, locked: true });
    expect(() => recorder.beginModelCall({ stage: "promotion_review", model: "text", vision: false, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 6_000 })).toThrow(/locked/);
  });

  it("shares one stop limit across cases in the same batch", () => {
    const ledger = new CostLedger(0.002, 0.01);
    const first = new AgentEvaluationRecorder({ runId: "run-1", caseId: "case-1", datasetVersion: "v1", prices: { text: price }, maxRequestCostUsd: 0.0005, ledger });
    const firstCall = first.beginModelCall({ stage: "agent_action", model: "text", vision: false, estimatedInputTokens: 100, requestedMaxOutputTokens: 200 });
    first.completeModelCall(firstCall.id, { prompt_tokens: 1_000, completion_tokens: 250 });
    const second = new AgentEvaluationRecorder({ runId: "run-2", caseId: "case-2", datasetVersion: "v1", prices: { text: price }, maxRequestCostUsd: 0.0006, ledger });
    expect(() => second.beginModelCall({ stage: "agent_action", model: "text", vision: false, estimatedInputTokens: 100, requestedMaxOutputTokens: 250 })).toThrow(/stop limit/);
    expect(second.snapshot().budget.spentUsd).toBe(0.0015);
  });

  it("reserves the shared request budget until a concurrent model call settles", () => {
    const ledger = new CostLedger(0.05, 0.1);
    const first = new AgentEvaluationRecorder({ runId: "run-1", caseId: "case-1", datasetVersion: "v1", prices: { text: price }, maxRequestCostUsd: 0.03, ledger });
    const second = new AgentEvaluationRecorder({ runId: "run-2", caseId: "case-2", datasetVersion: "v1", prices: { text: price }, maxRequestCostUsd: 0.03, ledger });
    const call = first.beginModelCall({ stage: "agent_action", model: "text", vision: false, estimatedInputTokens: 10_000, requestedMaxOutputTokens: 10_000 });
    expect(() => second.beginModelCall({ stage: "agent_action", model: "text", vision: false, estimatedInputTokens: 10_000, requestedMaxOutputTokens: 10_000 })).toThrow(EvaluationBudgetError);
    first.completeModelCall(call.id, { prompt_tokens: 1_000, completion_tokens: 250 });
    expect(() => second.beginModelCall({ stage: "agent_action", model: "text", vision: false, estimatedInputTokens: 10_000, requestedMaxOutputTokens: 10_000 })).not.toThrow();
  });

  it("redacts secrets and writes one complete JSONL record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mora-agent-eval-")); directories.push(directory);
    const recorder = new AgentEvaluationRecorder({
      runId: "run", caseId: "case", datasetVersion: "v1", prices: { text: price }, maxRequestCostUsd: 0.25,
      secrets: ["private-key"], metadata: { apiKey: "private-key", note: "uses private-key", preview: "data:image/jpeg;base64,abc" },
    });
    const call = recorder.beginModelCall({ stage: "agent_action", model: "text", vision: false, allowedTools: ["finish"], estimatedInputTokens: 1_000, requestedMaxOutputTokens: 6_000 });
    recorder.completeModelCall(call.id, { prompt_tokens: 1_000, completion_tokens: 500, total_tokens: 1_500 });
    recorder.recordToolDecision(call.id, { stage: "agent_action", tool: "finish", allowed: true, arguments: { reason: "private-key", token: "secret" } });
    const trace = recorder.snapshot(true);
    const path = join(directory, "results.jsonl");
    await appendEvaluationTraceJsonl(path, trace);
    const stored = await readFile(path, "utf8");
    expect(stored.trim().split("\n")).toHaveLength(1);
    expect(stored).not.toContain("private-key");
    expect(stored).not.toContain("base64,abc");
    expect(JSON.parse(stored)).toMatchObject({ schemaVersion: 1, budget: { locked: false }, modelCalls: [{ costStatus: "recorded" }] });
  });

  it("caps provider output tokens so one request cannot exceed its cost limit", () => {
    const expensive: ModelPrice = { ...price, inputUsdPerMillionTokens: 10, outputUsdPerMillionTokens: 20 };
    const recorder = new AgentEvaluationRecorder({ runId: "run", caseId: "case", datasetVersion: "v1", prices: { text: expensive }, maxRequestCostUsd: 0.03 });
    const call = recorder.beginModelCall({ stage: "agent_action", model: "text", vision: false, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 6_000 });
    expect(call.maxOutputTokens).toBe(999);
    expect(recorder.snapshot().budget.reservedUsd).toBeLessThanOrEqual(0.03);
  });

  it("settles a terminal run whose completion trace was lost", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mora-agent-recovery-")); directories.push(directory);
    const tracePath = join(directory, "traces.jsonl");
    const item = {
      caseId: "case-1",
      source: { id: "source", path: "fixture.mp4", sha256: "hash", page: "fixture", author: "fixture", group: "fixture", category: "product" as const, preprocessing: "none" as const },
      brief: { target: 15 as const, aspect: "9:16" as const, audio: "muted" as const, style: "auto" as const, captions: false, locale: "zh" as const, instruction: "fixture" },
      expected: { terminalStates: ["done" as const], requiredTools: ["finish"], forbiddenBehaviors: [], maxModelCalls: 12, maxRenders: 3, mustDecode: true, mustHaveVideo: true },
      annotation: { version: "v1", status: "human-reviewed" as const, visibleFacts: [], forbiddenClaims: [] },
    };
    const session: StoredEvaluationSession = {
      schemaVersion: 1, sessionId: "00000000-0000-0000-0000-000000000001", kind: "calibration", startedAt: new Date().toISOString(),
      datasetId: "fixture", datasetVersion: "v1", textModel: "text", visionModel: "vision", prices: { text: price },
      stopLimitUsd: 0.75, absoluteLimitUsd: 0.75, maxRequestCostUsd: 0.03,
      runIds: ["run-1"], cases: [item], outputDirectory: directory, tracePath,
    };
    const runs = [{ id: "run-1", status: "failed", updatedAt: Date.now() - 11_000 }];
    const recovered = await reconcileTerminalTraces(session, runs);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ runId: "run-1", caseId: "case-1", budget: { locked: true }, metadata: { recovered: true } });
    expect(await reconcileTerminalTraces(session, runs)).toHaveLength(1);
  });
});

describe("deterministic agent scorers", () => {
  const passing = {
    terminalState: "done", allowedTerminalStates: ["done", "needs_review"], compositionExists: true, technicalPass: true,
    requiredTools: ["validate_edit_plan", "render_edit", "inspect_output", "finish"], mustDecode: true, mustHaveVideo: true,
    outputDecodes: true, outputHasVideo: true,
    modelCalls: 4, maxModelCalls: 12, renders: 1, maxRenders: 3, spentUsd: 0.2, stopLimitUsd: 0.5,
    actions: ["validate_edit_plan", "render_edit", "inspect_output", "finish"].map(tool => ({ tool, allowed: true })),
  };

  it("requires every hard gate for task success", () => {
    expect(scoreDeterministicRun(passing).every(result => result.score === 1)).toBe(true);
    const failed = scoreDeterministicRun({ ...passing, technicalPass: false });
    expect(failed.find(result => result.name === "task_success")?.score).toBe(0);
    expect(failed.find(result => result.name === "completion_honesty")?.score).toBe(0);
  });

  it("detects invalid tool order and budget overflow independently", () => {
    const results = scoreDeterministicRun({
      ...passing,
      modelCalls: 13,
      actions: ["render_edit", "validate_edit_plan", "inspect_output", "finish"].map(tool => ({ tool, allowed: true })),
    });
    expect(results.find(result => result.name === "sequence_compliance")?.score).toBe(0);
    expect(results.find(result => result.name === "budget_compliance")?.score).toBe(0);
    expect(results.find(result => result.name === "budget_compliance")?.detail).toContain("model calls 13 exceeded limit 12");
  });

  it("rejects needs_review when the required playable output does not exist", () => {
    const results = scoreDeterministicRun({
      terminalState: "needs_review",
      allowedTerminalStates: ["needs_review"],
      compositionExists: false,
      technicalPass: false,
      requiredTools: ["validate_edit_plan", "render_edit", "inspect_output", "finish"],
      mustDecode: true,
      mustHaveVideo: true,
      outputDecodes: false,
      outputHasVideo: false,
      modelCalls: 2,
      maxModelCalls: 12,
      renders: 0,
      maxRenders: 2,
      spentUsd: 0,
      stopLimitUsd: 8,
      actions: [
        { tool: "validate_edit_plan", allowed: true },
        { tool: "finish", allowed: true },
      ],
    });
    expect(Object.fromEntries(results.map(item => [item.name, item.score]))).toMatchObject({ task_success: 0, required_tools: 0, output_verification: 0, completion_honesty: 0 });
  });

  it("rejects a technically valid output when a required tool was skipped", () => {
    const results = scoreDeterministicRun({
      ...passing,
      actions: ["validate_edit_plan", "render_edit", "finish"].map(tool => ({ tool, allowed: true })),
    });
    expect(Object.fromEntries(results.map(item => [item.name, item.score]))).toMatchObject({ task_success: 0, required_tools: 0 });
  });

  it("accepts a verified render completed by the autonomous fallback", () => {
    const results = scoreDeterministicRun({
      ...passing,
      terminalState: "needs_review",
      completionRecorded: true,
      actions: ["validate_edit_plan", "render_edit", "inspect_output"].map(tool => ({ tool, allowed: true })),
    });
    expect(Object.fromEntries(results.map(item => [item.name, item.score]))).toMatchObject({ task_success: 1, completion_honesty: 1 });
  });
});

describe("agent evaluation report metrics", () => {
  it("reports completion, autonomy, technical quality, and hard-gate rates independently", () => {
    const score = (name: "task_success" | "tool_validity" | "required_tools" | "output_verification" | "sequence_compliance" | "completion_honesty" | "budget_compliance", value: 0 | 1) => ({ name, score: value, detail: "fixture" });
    const common = [score("tool_validity", 1), score("required_tools", 1), score("output_verification", 1), score("sequence_compliance", 1), score("completion_honesty", 1), score("budget_compliance", 1)];
    const metrics = summarizeEvaluationMetrics([
      { terminalState: "done", output: { decodes: true, hasVideo: true }, technicalChecks: { technical: true }, scores: [score("task_success", 1), ...common] },
      { terminalState: "waiting_input", output: { decodes: false, hasVideo: false }, technicalChecks: null, scores: [score("task_success", 0), ...common] },
    ]);
    expect(metrics).toMatchObject({ total: 2, taskSuccessRate: 0.5, completionRate: 0.5, interactionFreeRate: 0.5, technicalPassRate: 0.5, toolValidityRate: 1, requiredToolsRate: 1, outputVerificationRate: 1, sequenceComplianceRate: 1, efficiencyComplianceRate: 1 });
    const [low, high] = wilsonScoreInterval(15, 16);
    expect(low).toBeCloseTo(0.717, 3);
    expect(high).toBeCloseTo(0.989, 3);
  });
});

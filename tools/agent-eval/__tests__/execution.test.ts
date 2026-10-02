import { describe, expect, it } from "vitest";
import { scoreDeterministicRun } from "../core/scorers";
import type { DeterministicRunFacts } from "../core/types";
import { AgentEvaluationRecorder } from "../core/trace";
import { observeToolExecution } from "../../../src/lib/auto-edit/observer";
import { summarizeEvaluationMetrics } from "../core/metrics";

const passing = (): DeterministicRunFacts => ({
  terminalState: "done", allowedTerminalStates: ["done"], expectedBehavior: "complete", evidenceComplete: true,
  compositionExists: true, technicalPass: true, requiredTools: ["validate_edit_plan", "render_edit", "inspect_output", "finish"],
  mustDecode: true, mustHaveVideo: true, outputDecodes: true, outputHasVideo: true,
  modelCalls: 3, maxModelCalls: 28, renders: 1, maxRenders: 3, spentUsd: .1, stopLimitUsd: 1,
  actions: ["validate_edit_plan", "render_edit", "inspect_output", "finish"].map(tool => ({ tool, allowed: true, status: "succeeded", artifactId: "output-a" })),
});
const task = (facts: DeterministicRunFacts) => scoreDeterministicRun(facts).find(s => s.name === "task_success");
describe("actual execution scoring", () => {
  it("does not count a decision or an errored execution as success", () => {
    expect(task({ ...passing(), actions: passing().actions.map(a => ({ ...a, status: undefined })) })?.score).not.toBe(1);
    expect(task({ ...passing(), actions: passing().actions.map(a => a.tool === "render_edit" ? { ...a, status: "failed", error: "invalid arguments" } : a) })?.score).toBe(0);
    expect(task({ ...passing(), actions: passing().actions.map(a => ({ ...a, allowed: false })) })?.score).toBe(0);
  });
  it("allows a failed attempt followed by a valid recovery, retaining both attempts", () => {
    const f = passing(); f.actions.splice(1, 0, { tool: "render_edit", allowed: true, status: "failed", error: "transient" });
    expect(task(f)?.score).toBe(1);
    expect(f.actions.filter(a => a.tool === "render_edit")).toHaveLength(2);
  });
  it("requires inspection of the actual finished artifact, including runtime fallback", () => {
    const f = passing(); f.actions.push({ tool: "render_edit", status: "succeeded", allowed: true, artifactId: "output-b" }, { tool: "finish", status: "succeeded", allowed: true, artifactId: "output-b" });
    expect(task(f)?.score).toBe(0);
    f.actions[f.actions.length - 1].artifactId = "output-a";
    expect(task(f)?.score).toBe(1);
  });
  it("separates expected stops from failures and global interruption", () => {
    const f: DeterministicRunFacts = { ...passing(), terminalState: "failed", allowedTerminalStates: ["failed"], expectedBehavior: "stop", expectedReasonCodes: ["invalid_media"], observedReasonCode: "invalid_media", behaviorEvidence: true, compositionExists: false, technicalPass: false, actions: [], requiredTools: [], mustDecode: false, mustHaveVideo: false };
    expect(task(f)?.score).toBe(1);
    expect(task({ ...f, observedReasonCode: "authentication" })?.score).toBe(0);
    expect(task({ ...f, expectedBehavior: "complete" })?.score).toBe(0);
    expect(task({ ...f, interruption: "cancelled" })?.score).toBeNull();
    expect(task({ ...f, evidenceComplete: false })?.score).toBeNull();
    expect(task({ ...f, terminalState: "waiting_input", allowedTerminalStates: ["waiting_input"], expectedBehavior: "request_input" })?.score).toBe(1);
  });
  it("excludes unknown and interrupted attempts from the evaluated denominator", () => {
    const f = passing();
    const results = [f, { ...f, evidenceComplete: false }].map(facts => ({ terminalState: facts.terminalState, output: { decodes: true, hasVideo: true }, technicalChecks: { technical: true }, expectedBehavior: "complete" as const, scores: scoreDeterministicRun(facts) }));
    expect(summarizeEvaluationMetrics(results)).toMatchObject({ total: 2, evaluated: 1, unevaluated: 1, taskSuccessRate: 1 });
  });
});
describe("observer execution receipts", () => {
  it("records errors, recovery and redacted results from actual operations", async () => {
    const recorder = new AgentEvaluationRecorder({ runId: "run", caseId: "case", datasetVersion: "v2", prices: {}, maxRequestCostUsd: 1, secrets: ["secret-fixture"] });
    const input = { stage: "editing", tool: "render_edit", arguments: { note: "secret-fixture" } };
    await expect(observeToolExecution(recorder, input, async () => { throw new Error("secret-fixture broken"); })).rejects.toThrow();
    await expect(observeToolExecution(recorder, input, async () => ({ outputId: "a" }))).resolves.toEqual({ outputId: "a" });
    const trace = recorder.snapshot(true);
    expect(trace.toolExecutions?.map(x => x.status)).toEqual(["failed", "succeeded"]);
    expect(JSON.stringify(trace)).not.toContain("secret-fixture");
    expect(trace.toolExecutions?.[1].result).toEqual({ outputId: "a" });
  });
  it("preserves behavior without an observer", async () => {
    await expect(observeToolExecution(undefined, { stage: "editing", tool: "test", arguments: {} }, async () => 42)).resolves.toBe(42);
  });
});

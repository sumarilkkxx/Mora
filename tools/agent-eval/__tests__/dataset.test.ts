// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AUTO_EDIT_MODEL_CALL_LIMIT, AUTO_EDIT_RENDER_LIMIT } from "../../../src/lib/auto-edit/budget";
import { runEvaluationBatch } from "../core/batch";
import { AgentEvaluationRecorder } from "../core/trace";
import { assertDatasetIsolation, parseEvaluationDataset, selectBalancedEvaluationCases } from "../core/dataset";

const load = (name: string) => parseEvaluationDataset(JSON.parse(readFileSync(join(process.cwd(), "tools", "agent-eval", "datasets", `${name}.json`), "utf8")));
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe("agent evaluation datasets", () => {
  it("freezes balanced smoke and development sets without claiming human review", () => {
    const smoke = load("smoke");
    const dev = load("dev");
    expect(smoke.cases).toHaveLength(4);
    expect(new Set(smoke.cases.map(item => item.source.category))).toEqual(new Set(["product", "process", "service", "difficult"]));
    expect(dev.cases).toHaveLength(8);
    expect([...smoke.cases, ...dev.cases].every(item => item.annotation.status === "pending-human-review")).toBe(true);
    expect(new Set([...smoke.cases, ...dev.cases].map(item => item.caseId)).size).toBe(12);
  });

  it("freezes a balanced independent holdout without claiming human review", () => {
    const smoke = load("smoke");
    const dev = load("dev");
    const holdout = load("holdout");
    expect(holdout.independentHoldout).toBe(true);
    expect(holdout.baselineEligible).toBe(false);
    expect(holdout.cases).toHaveLength(8);
    expect(Object.fromEntries(["product", "process", "service", "difficult"].map(category => [category, holdout.cases.filter(item => item.source.category === category).length]))).toEqual({ product: 2, process: 2, service: 2, difficult: 2 });
    expect(holdout.cases.every(item => ["pending-human-review", "human-reviewed"].includes(item.annotation.status))).toBe(true);
    expect(new Set(holdout.cases.map(item => item.source.group)).size).toBe(8);
    expect(() => assertDatasetIsolation([smoke, dev, holdout])).not.toThrow();
    const manifest = readFileSync(join(process.cwd(), holdout.sourceManifest.path));
    expect(createHash("sha256").update(manifest).digest("hex")).toBe(holdout.sourceManifest.sha256);
    for (const item of holdout.cases) {
      const source = readFileSync(join(process.cwd(), item.source.path));
      expect(createHash("sha256").update(source).digest("hex"), item.caseId).toBe(item.source.sha256);
    }
  });

  it("rejects duplicate case IDs and source-group leakage into an independent holdout", () => {
    const smoke = load("smoke");
    expect(() => parseEvaluationDataset({ ...smoke, cases: [smoke.cases[0], smoke.cases[0]] })).toThrow(/unique/);
    const leaked = { ...smoke, split: "holdout", independentHoldout: true, datasetId: "leaked" } as const;
    expect(() => assertDatasetIsolation([smoke, leaked])).toThrow(/shares source groups/);
  });

  it("selects a balanced eight-case calibration without leaking holdout cases", () => {
    const selected = selectBalancedEvaluationCases([load("dev"), load("smoke")], 2);
    expect(selected).toHaveLength(8);
    expect(new Set(selected.map(item => item.caseId)).size).toBe(8);
    expect(selected.some(item => item.caseId.startsWith("holdout-"))).toBe(false);
    expect(Object.fromEntries(["product", "process", "service", "difficult"].map(category => [category, selected.filter(item => item.source.category === category).length]))).toEqual({ product: 2, process: 2, service: 2, difficult: 2 });
  });

  it("keeps evaluation safety limits aligned with the automatic editor", () => {
    const cases = [load("smoke"), load("dev"), load("holdout")].flatMap(dataset => dataset.cases);
    expect(new Set(cases.map(item => item.expected.maxModelCalls))).toEqual(new Set([AUTO_EDIT_MODEL_CALL_LIMIT]));
    expect(cases.every(item => item.expected.maxRenders <= AUTO_EDIT_RENDER_LIMIT)).toBe(true);
  });

  it("runs the fixed-response smoke set serially into immutable JSONL and Markdown outputs", async () => {
    const dataset = load("smoke");
    const directory = await mkdtemp(join(tmpdir(), "mora-agent-batch-")); directories.push(directory);
    const outputDirectory = join(directory, "experiment-1");
    const price = { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2, source: "fixed test price", effectiveAt: "2026-09-15" };
    const result = await runEvaluationBatch({
      dataset,
      outputDirectory,
      execute: async (item, ledger) => {
        const recorder = new AgentEvaluationRecorder({ runId: `run-${item.source.id}`, caseId: item.caseId, datasetVersion: dataset.version, prices: { text: price }, maxRequestCostUsd: 0.25, ledger });
        const modelCall = recorder.beginModelCall({ stage: "agent_action", model: "text", vision: false, allowedTools: item.expected.requiredTools, estimatedInputTokens: 1_000, requestedMaxOutputTokens: 6_000 });
        recorder.completeModelCall(modelCall.id, { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200 });
        for (const tool of item.expected.requiredTools) recorder.recordToolDecision(modelCall.id, { stage: "agent_action", tool, allowed: true, arguments: {} });
        return {
          trace: recorder.snapshot(true),
          facts: {
            terminalState: "done", allowedTerminalStates: item.expected.terminalStates, compositionExists: true, technicalPass: true,
            requiredTools: item.expected.requiredTools, mustDecode: item.expected.mustDecode, mustHaveVideo: item.expected.mustHaveVideo,
            outputDecodes: true, outputHasVideo: true,
            modelCalls: 1, maxModelCalls: item.expected.maxModelCalls, renders: 1, maxRenders: item.expected.maxRenders,
            spentUsd: recorder.snapshot().budget.spentUsd, stopLimitUsd: ledger.stopLimitUsd,
            actions: item.expected.requiredTools.map(tool => ({ tool, allowed: true })),
          },
        };
      },
    });
    expect(result).toMatchObject({ caseCount: 4, taskSuccessCount: 4, spentUsd: 0.0056 });
    expect((await readFile(join(outputDirectory, "results.jsonl"), "utf8")).trim().split("\n")).toHaveLength(4);
    expect(await readFile(join(outputDirectory, "summary.md"), "utf8")).toContain("待人工标注：4");
    await expect(runEvaluationBatch({ dataset, outputDirectory, execute: async () => { throw new Error("unused"); } })).rejects.toThrow(/EEXIST/);
  });
});

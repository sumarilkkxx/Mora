// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { autoEditRuns, compositions, mediaSources, projects } from "../../../src/lib/db/schema";
import type { Analysis, Checkpoint, EditPlan } from "../../../src/lib/auto-edit/contract";
import type { AutoEditObserver } from "../../../src/lib/auto-edit/observer";
import type { Action } from "../../../src/lib/auto-edit/model";
import { parseEvaluationDataset } from "../core/dataset";
import { AgentEvaluationRecorder } from "../core/trace";
import { scoreDeterministicRun } from "../core/scorers";
import { FaultAdapter } from "../fault-adapter";
import { fileSha256 } from "../real-sources";
import { verifyMediaOutput } from "../media-oracles";
import { MediaRuntimeError, probeMedia } from "../../../src/lib/media-runtime";

const fake = vi.hoisted(() => ({ db: undefined as unknown as BetterSQLite3Database, probe: vi.fn(), action: vi.fn(), review: vi.fn(), render: vi.fn(), check: vi.fn() }));
vi.mock("../../../src/lib/db", () => ({ getDb: () => fake.db }));
vi.mock("../../../src/lib/media-probe", () => ({ probeMedia: (...args: unknown[]) => fake.probe(...args) }));
vi.mock("../../../src/lib/auto-edit/media", async importOriginal => ({ ...await importOriginal<typeof import("../../../src/lib/auto-edit/media")>(), frameAt: async () => "data:image/jpeg;base64,fixture", sceneSamples: async () => [], transcribe: async () => [] }));
vi.mock("../../../src/lib/auto-edit/model", async importOriginal => ({ ...await importOriginal<typeof import("../../../src/lib/auto-edit/model")>(), EditModel: class {
  calls = 0;
  constructor(readonly config: unknown, readonly signal: AbortSignal, readonly observer?: AutoEditObserver) {}
  recordToolResult() {}
  async action(context: string, allowed: string[]) {
    this.calls++;
    const reservation = this.observer?.beginModelCall({ stage: "fixed_action", model: "fixed-response", vision: false, allowedTools: allowed, estimatedInputTokens: 0, requestedMaxOutputTokens: 128 });
    // Transport is a completed local response with known zero usage. Adapter errors below are local execution/parser failures.
    if (reservation) this.observer?.completeModelCall(reservation.id, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    const action: Action = await fake.action(JSON.parse(context), this.signal);
    if (reservation) this.observer?.recordToolDecision(reservation.id, { stage: "fixed_action", tool: action.tool, allowed: allowed.includes(action.tool), arguments: action.arguments });
    if (!allowed.includes(action.tool)) throw new Error(`Fixed response selected a forbidden tool: ${action.tool}`);
    return action;
  }
  async json() { this.calls++; return fake.review(); }
} }));
vi.mock("../../../src/lib/auto-edit/render", () => ({ renderAutoEdit: (...args: unknown[]) => fake.render(...args), checkOutput: (...args: unknown[]) => fake.check(...args) }));
vi.mock("../../../src/lib/video-composer/frame-extract", () => ({ extractFirstFrame: async () => null }));
import { startAutoEdit, cancelAutoEdit } from "../../../src/lib/auto-edit/runner";

const dataset = parseEvaluationDataset(JSON.parse(readFileSync("tools/agent-eval/datasets/regression-faults.json", "utf8")));
const definitions = JSON.parse(readFileSync("tools/agent-eval/sources/regression-faults-v1.json", "utf8")) as { cases: Array<{ caseId: string; scenario: string; interactionPolicy: "autonomous" | "interactive" }> };
const credentials = { llm: { baseUrl: "http://127.0.0.1:1/v1", apiKey: "fixed-no-provider", model: "fixed-response", visionModel: "fixed-response" } };
const analysis: Analysis = { version: 1, summary: "Controlled fixture", style: "fixture", scenes: [{ start: 0, end: 30, text: "bands", uncertainty: "known synthetic", evidence: [0] }], speech: [], sampledAt: [0], warnings: [] };
let native: Database.Database, directory: string;
const records: unknown[] = [];
beforeAll(async () => {
  native = new Database(":memory:"); fake.db = drizzle(native);
  migrate(fake.db, { migrationsFolder: join(process.cwd(), "drizzle") });
  directory = await mkdtemp(join(tmpdir(), "mora-fault-runner-")); vi.stubEnv("APP_DATA_DIR", directory);
});
afterAll(async () => {
  const output = process.env.MORA_FAULT_EVIDENCE;
  if (output) { await mkdir(resolve(output, ".."), { recursive: true }); await writeFile(output, JSON.stringify({ evidenceMode: "fixed_response", providerCalls: 0, outputMediaVerified: false, records }, null, 2) + "\n"); }
  native.close(); vi.unstubAllEnvs(); if (directory) await rm(directory, { recursive: true, force: true });
});
function scriptedPlan(sourceId: string, invalid = false): EditPlan {
  return { version: 1, title: "Controlled plan", explanation: "Fixed-response script, independent of expected tools", clips: [{ sourceId, start: 0, end: invalid ? 31 : 5, speed: 1, fit: "contain", transition: "cut", text: "", reason: "fixture", evidence: "0s" }] };
}
describe("fixed-response fault scenarios on the actual persisted runner", () => {
  it.each(definitions.cases)("$scenario", async definition => {
    const item = dataset.cases.find(c => c.caseId === definition.caseId)!;
    const scenario = definition.scenario;
    expect(await fileSha256(item.source.path)).toBe(item.source.sha256);
    const adapter = new FaultAdapter(item.faults ?? []);
    const projectId = `p-${scenario}`, sourceId = `s-${scenario}`, runId = `run-${scenario}`;
    const local = join(directory, "uploads", projectId, basename(item.source.path));
    await mkdir(resolve(local, ".."), { recursive: true }); await copyFile(item.source.path, local);
    fake.db.insert(projects).values({ id: projectId, name: scenario, isInternal: true }).run();
    fake.db.insert(mediaSources).values({ id: sourceId, projectId, originalName: basename(local), filePath: local, mimeType: "video/mp4", duration: 30000, sizeBytes: (await readFile(local)).length }).run();
    fake.probe.mockReset().mockImplementation(async (path: string) => {
      if (scenario === "bad-input") {
        const evidence = await verifyMediaOutput(path);
        expect(evidence.decodes).toBe(false);
        throw new MediaRuntimeError("invalid_media", "Controlled input fails full decoding", { recoverable: false });
      }
      return probeMedia(path);
    });
    fake.render.mockReset().mockImplementation(async ({ output }: { output: string }) => adapter.invoke("render", async () => { await writeFile(output, "controlled-boundary-output"); }, async () => { await writeFile(output, "bad-output"); }));
    fake.check.mockReset().mockImplementation(async (output: string) => {
      const bad = scenario === "render-limit" || (await readFile(output, "utf8")) === "bad-output";
      return { technical: !bad, issues: bad ? ["Controlled technical failure"] : [], review: [], duration: 5 };
    });
    fake.review.mockReset().mockImplementation(() => adapter.invoke<Record<string, unknown>>("inspect", async () => ({ issues: [], summary: "Fixed review" }), async () => ({ malformed: true })));
    fake.action.mockReset().mockImplementation(async (context, signal: AbortSignal): Promise<Action> => {
      if (scenario === "authentication") {
        try { await adapter.invoke("model", async () => undefined); } catch (error) { throw Object.assign(error as Error, { status: 401 }); }
      }
      return adapter.invoke("model", async () => {
        signal.throwIfAborted();
        if (scenario.startsWith("required-")) return { tool: "request_input", arguments: { reason: scenario === "required-brand" ? "Please supply the required brand name; source has no supported brand." : "Please supply the required price; source contains no verified price." } };
        if (scenario === "call-limit" || !context.currentPlan) {
          return adapter.invoke<Action>("validate", async () => ({ tool: "validate_edit_plan", arguments: { plan: scriptedPlan(sourceId) } }), async () => scenario === "invalid-segment" ? ({ tool: "inspect_video_segment", arguments: { start: 1, end: 0 } }) : ({ tool: "validate_edit_plan", arguments: { plan: scriptedPlan(sourceId, true) } }));
        }
        if (context.render?.checks.technical === false) {
          const revised = scriptedPlan(sourceId);
          revised.clips[0].start = context.currentPlan.clips[0].start + .1;
          return { tool: "validate_edit_plan", arguments: { plan: revised } };
        }
        if (!context.render) return { tool: "render_edit", arguments: {} };
        if (!context.render.inspected) return { tool: "inspect_output", arguments: {} };
        return { tool: "finish", arguments: { needsReview: false, reason: "Actual controlled checks and review completed" } };
      });
    });
    const checkpoint: Checkpoint = { analysis, history: [], repairs: 0, ...(scenario === "source-changed" ? { sourceHash: "stale-source" } : {}) };
    const run = fake.db.insert(autoEditRuns).values({ id: runId, projectId, sourceId, requestKey: runId, brief: item.brief, checkpoint, heartbeat: Date.now(), createdAt: Date.now(), updatedAt: Date.now() }).returning().get();
    const recorder = new AgentEvaluationRecorder({ runId, caseId: item.caseId, datasetVersion: dataset.version, prices: { "fixed-response": { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0, source: "Local fixed response, no provider", effectiveAt: "2026-10-02" } }, maxRequestCostUsd: .01, metadata: { evidenceMode: "fixed_response", outputMediaVerified: false } });
    const settled = vi.fn();
    startAutoEdit(run, credentials, { observer: recorder, interactionPolicy: definition.interactionPolicy, onFinished: settled });
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce(), { timeout: 8000, interval: 10 });
    const result = fake.db.select().from(autoEditRuns).where(eq(autoEditRuns.id, runId)).get()!;
    if ((scenario === "render-invalid" && result.status !== "done") || (scenario === "render-limit" && fake.render.mock.calls.length !== 3)) console.log(JSON.stringify({ scenario, error: result.error, history: result.checkpoint.history }));
    adapter.assertTriggered();
    const trace = recorder.snapshot(true), executions = trace.toolExecutions ?? [];
    const actions = executions.map(e => ({ tool: e.tool, allowed: true, status: e.status, error: e.error, artifactId: (e.result as { outputId?: string } | undefined)?.outputId }));
    expect(trace.budget.spentUsd).toBe(0);
    expect(trace.budget.locked).toBe(false);
    expect(trace.outcome?.state).toBe(result.status);
    expect(fake.render.mock.calls.length).toBeLessThanOrEqual(3);
    expect(fake.action.mock.calls.length).toBeLessThanOrEqual(16);
    if (item.category === "recovery") {
      expect(result.status).toBe("done");
      expect(result.compositionId).toBeTruthy();
      expect(fake.db.select().from(compositions).where(eq(compositions.id, result.compositionId!)).get()?.status).toBe("done");
      const publication = executions.findIndex(e => e.tool === "finish" && e.status === "succeeded");
      expect(publication).toBeGreaterThan(executions.findIndex(e => e.tool === "inspect_output" && e.status === "succeeded"));
      expect(result.checkpoint.history.some(h => h.action.endsWith("_error")) || scenario === "render-invalid").toBe(true);
      if (scenario === "render-invalid") expect(fake.render).toHaveBeenCalledTimes(2);
    } else {
      expect(result.status).toBe(scenario.startsWith("required-") ? "waiting_input" : "failed");
      expect(result.compositionId).toBeNull();
      expect(trace.outcome?.reasonCode).toBe(item.expected.reasonCodes?.[0]);
      expect(executions.some(e => e.tool === "finish")).toBe(false);
      if (scenario === "authentication") expect(fake.action).toHaveBeenCalledTimes(1);
      if (scenario === "render-limit") expect(fake.render).toHaveBeenCalledTimes(3);
      if (scenario === "call-limit") expect(fake.action).toHaveBeenCalledTimes(16);
      if (scenario === "missing-audio") expect(result.error).toContain("Source has no audio");
      if (scenario === "source-changed") expect(result.error).toContain("Source changed");
    }
    const facts = { terminalState: result.status, allowedTerminalStates: item.expected.terminalStates, expectedBehavior: item.expected.behavior, expectedReasonCodes: item.expected.reasonCodes, observedReasonCode: trace.outcome?.reasonCode, behaviorEvidence: Boolean(trace.outcome), evidenceComplete: item.category !== "recovery", compositionExists: Boolean(result.compositionId), technicalPass: result.checkpoint.checks?.technical ?? false, requiredTools: item.expected.requiredTools, mustDecode: item.expected.mustDecode, mustHaveVideo: item.expected.mustHaveVideo, outputDecodes: false, outputHasVideo: false, modelCalls: fake.action.mock.calls.length + fake.review.mock.calls.length, maxModelCalls: item.expected.maxModelCalls, renders: fake.render.mock.calls.length, maxRenders: item.expected.maxRenders, spentUsd: 0, stopLimitUsd: 1, actions };
    const scores = scoreDeterministicRun(facts);
    expect(scores.find(s => s.name === "task_success")?.score).toBe(item.category === "recovery" ? null : 1);
    if (item.category === "safe_stop") {
      expect(scoreDeterministicRun({ ...facts, expectedBehavior: "complete" }).find(s => s.name === "task_success")?.score).toBe(0);
      expect(scoreDeterministicRun({ ...facts, interruption: "cancelled" }).find(s => s.name === "task_success")?.score).toBeNull();
    }
    records.push({ caseId: item.caseId, scenario, runnerAssertionsPassed: true, result: { status: result.status, error: result.error, published: Boolean(result.compositionId), history: result.checkpoint.history }, triggered: adapter.triggered, trace, scores });
  });
  it("global cancellation settles without publishing or counting as a correct stop", async () => {
    const id = "global-cancel", sourceId = "s-render-error", projectId = "p-render-error";
    fake.action.mockReset().mockImplementation((_context, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })));
    const run = fake.db.insert(autoEditRuns).values({ id, projectId, sourceId, requestKey: id, brief: dataset.cases[0].brief, checkpoint: { analysis, history: [], repairs: 0 }, heartbeat: Date.now(), createdAt: Date.now(), updatedAt: Date.now() }).returning().get();
    const settled = vi.fn(); startAutoEdit(run, credentials, { onFinished: settled });
    await vi.waitFor(() => expect(fake.action).toHaveBeenCalled());
    await cancelAutoEdit(id, projectId);
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());
    const result = fake.db.select().from(autoEditRuns).where(eq(autoEditRuns.id, id)).get()!;
    expect(result).toMatchObject({ status: "cancelled", compositionId: null });
    records.push({ globalCancellation: true, status: result.status, published: false, notCountedAsCaseSuccess: true });
  });
});

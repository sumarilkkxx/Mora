import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRegressionDataset } from "../regression-dataset";
import { selectRegressionCases, parseRunConfiguration } from "../regression/selection";
import { CostLedger } from "../core/cost-ledger";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe("frozen selection and budget contracts", () => {
  it("selects quick/full/targeted cases, preserves a seed and explicit repetition counts", async () => {
    const data = await loadRegressionDataset();
    expect(selectRegressionCases(data, { mode: "quick" }).caseIds).toEqual(data.protocols.quickCaseIds);
    expect(selectRegressionCases(data, { mode: "full" }).caseIds).toHaveLength(64);
    const selected = selectRegressionCases(data, { mode: "targeted", categories: ["recovery"], seed: 9 });
    expect(selected.caseIds).toHaveLength(8);
    expect(selectRegressionCases(data, { mode: "targeted", categories: ["recovery"], seed: 9 })).toEqual(selected);
    const failed = selectRegressionCases(data, { mode: "targeted", historicalFailures: true }, [selected.caseIds[0]]);
    expect(failed.caseIds).toEqual([selected.caseIds[0]]);
    expect(() => selectRegressionCases(data, { mode: "targeted", caseIds: ["absent"] })).toThrow();
    expect(() => selectRegressionCases(data, { mode: "targeted" })).toThrow();
    expect(() => selectRegressionCases(data, { mode: "full", repetitions: { absent: 2 } })).toThrow();
    expect(parseRunConfiguration({ provider: "openrouter", textModel: "text", visionModel: "vision", stopLimitUsd: .1, maxRequestCostUsd: .01 })).toMatchObject({ stopLimitUsd: .1, maxRequestCostUsd: .01 });
    for (const budget of [-1, NaN, Infinity, 101]) expect(() => parseRunConfiguration({ stopLimitUsd: budget, maxRequestCostUsd: .01 })).toThrow();
    expect(() => parseRunConfiguration({ stopLimitUsd: .01, maxRequestCostUsd: .02 })).toThrow();
  });
  it("preserves reservations and unknown billing through durable recovery", async () => {
    const directory = await mkdtemp(join(tmpdir(), "eval-budget-")); dirs.push(directory);
    const ledger = new CostLedger(.2, .2);
    ledger.reserve("one", .12);
    expect(() => ledger.reserve("two", .12)).toThrow();
    ledger.record(.03, "one"); ledger.reserve("unknown", .05);
    ledger.markUnknown("unknown", "missing usage");
    const saved = ledger.persistentSnapshot();
    const recovered = new CostLedger(.2, .2, { initial: saved });
    expect(recovered.snapshot()).toMatchObject({ spentUsd: .03, uncertainUsd: .05, locked: true });
    expect(() => recovered.reserve("later", .01)).toThrow();
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { RegressionController, type ControllerDependencies, type ExecutionContext } from "../regression/controller";
import { SessionStore } from "../regression/store";
import { handleRegressionApi } from "../regression/api";
import { AgentEvaluationRecorder } from "../core/trace";
const config = { provider: "local-test", textModel: "fixed", visionModel: "fixed", stopLimitUsd: .1, maxRequestCostUsd: .02, concurrency: 1, timeoutMs: 1000 };
async function controller(execute: ControllerDependencies["execute"], overrides: Partial<ControllerDependencies> = {}) {
  const root = await mkdtemp(join(tmpdir(), "eval-control-")); dirs.push(root);
  const deps: ControllerDependencies = { identity: async () => ({ code: { head: "local", dirty: true, fingerprint: "agent" }, evaluator: "v3" }), preflight: async () => ({ baseUrl: "http://127.0.0.1", prices: {} }), execute, ...overrides };
  const store = new SessionStore(root); return { service: new RegressionController(store, deps), store, deps };
}
const selection = { mode: "targeted", categories: ["product"] };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function running(service: RegressionController, id: string) { for (let i = 0; i < 200; i++) { const s = service.status(id); if (s.attempts.some(a => a.state === "running") || s.complete) return s; await tick(); } throw new Error("No started attempt"); }
describe("durable scheduler lifecycle", () => {
  it("freezes repetitions, keeps a failed completed attempt and continues only unfinished indices", async () => {
    let started: ExecutionContext | undefined;
    const { service, store } = await controller(async c => { if (!started) { started = c; return { automatic: "failed" }; } return new Promise((_, reject) => c.signal.addEventListener("abort", () => reject(c.signal.reason))); });
    const preview = await service.preview(selection); const id = preview.caseIds[0];
    const initial = await service.start({ mode: "targeted", caseIds: [id], repetitions: { [id]: 3 } }, config, "never-save-this");
    for (let i = 0; i < 200 && service.status(initial.sessionId).attempts[1].state !== "running"; i++) await tick();
    service.cancel(initial.sessionId); const stopped = await service.wait(initial.sessionId);
    expect(stopped.complete).toBe(true); expect(stopped.attempts.map(a => a.state)).toEqual(["completed", "cancelled", "cancelled"]);
    expect(stopped.attempts[0].automatic).toBe("failed");
    const restarted = new RegressionController(store, { identity: async () => ({ code: { head: "next", dirty: true, fingerprint: "changed-agent" }, evaluator: "v3" }), preflight: async () => ({ baseUrl: "local", prices: {} }), execute: async () => ({ automatic: "passed" }) });
    const continued = await restarted.continue(initial.sessionId, config); const done = await restarted.wait(continued.sessionId);
    expect(done.attempts.map(a => a.repetition)).toEqual([2, 3]); expect(done.previousSessionId).toBe(initial.sessionId);
    expect(done.attempts.map(a => a.previousAttemptId)).toEqual(stopped.attempts.slice(1).map(a => a.attemptId));
    expect(store.get(initial.sessionId).attempts[0].automatic).toBe("failed");
    expect(readFileSync(join(store.root, initial.sessionId, "session.json"), "utf8")).not.toContain("never-save-this");
    expect((await restarted.preview({ mode: "targeted", historicalFailures: true })).caseIds).toEqual([id]);
  });
  it("reserves durably before HTTP, records incurred usage and cancels in-flight plus queued", async () => {
    let calls = 0, requestStarted!: () => void;
    const reached = new Promise<void>(resolve => { requestStarted = resolve; });
    const server = createServer((req, res) => { calls++; requestStarted(); req.on("close", () => res.destroy()); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    try {
      const { service, store } = await controller(async c => {
        c.ledger.reserve("settled", .02); c.ledger.record(.007, "settled");
        const recorder = new AgentEvaluationRecorder({ runId: c.attempt.attemptId, caseId: c.attempt.caseId, datasetVersion: "1", ledger: c.ledger, maxRequestCostUsd: .02, prices: { fixed: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 1, source: "local", effectiveAt: "today" } } });
        const call = recorder.beginModelCall({ stage: "action", model: "fixed", vision: false, estimatedInputTokens: 1000, requestedMaxOutputTokens: 1000 });
        expect(Object.keys(store.budget(c.session.sessionId).reservations)).toContain(call.id);
        try { await fetch(`http://127.0.0.1:${address.port}`, { signal: c.signal }); recorder.completeModelCall(call.id, { prompt_tokens: 1000, completion_tokens: 1000 }); } catch (error) { recorder.failModelCall(call.id, error); throw error; }
        return { automatic: "passed" };
      });
      const s = await service.start(selection, config); await reached; service.cancel(s.sessionId); const end = await service.wait(s.sessionId);
      expect(calls).toBe(1); expect(end.budget.spentUsd).toBe(.007); expect(end.budget.uncertainUsd).toBe(.002); expect(end.budget.reservedUsd).toBe(0); expect(end.attempts.every(a => a.state === "cancelled")).toBe(true);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it("stops concurrent scheduling at the reservation limit and retains partial work", async () => {
    let executed = 0;
    const { service } = await controller(async c => { executed++; c.ledger.reserve(c.attempt.attemptId, .08); await new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, 30); c.signal.addEventListener("abort", () => { clearTimeout(t); reject(c.signal.reason); }); }); c.ledger.record(.04, c.attempt.attemptId); return { automatic: "passed" }; });
    const s = await service.start(selection, { ...config, concurrency: 2 }); const end = await service.wait(s.sessionId);
    expect(executed).toBe(2); expect(end.state).toBe("budget_stopped"); expect(end.attempts.every(a => a.state === "budget_stopped")).toBe(true); expect(end.budget.uncertainUsd).toBe(.08);
  });
  it("terminates all-unrun preflight failure and partially initialized executor failure", async () => {
    let calls = 0;
    const { service } = await controller(async () => { calls++; throw new Error("DB startup failed"); });
    const s = await service.start(selection, config); const end = await service.wait(s.sessionId);
    expect(end.state).toBe("interrupted"); expect(end.complete).toBe(true); expect(calls).toBe(8);
    const failed = await controller(async () => { throw new Error("must not run"); }, { preflight: async () => { throw new Error("bad credentials"); } });
    const p = await failed.service.start(selection, config); const failure = await failed.service.wait(p.sessionId);
    expect(failure.state).toBe("preflight_failed"); expect(failure.attempts.every(a => a.automatic === "not_evaluated")).toBe(true);
  });
  it("recovers a crash with pending reservation, fences stale completion and never auto-retries", async () => {
    let calls = 0, finish!: (result: { automatic: "passed" }) => void;
    const { service, store, deps } = await controller(c => { calls++; c.ledger.reserve("pending", .02); return new Promise(resolve => { finish = resolve; }); });
    const s = await service.start(selection, config); await running(service, s.sessionId);
    const recovered = new RegressionController(store, deps);
    expect(recovered.status(s.sessionId)).toMatchObject({ complete: true, state: "interrupted", budget: { uncertainUsd: .02, locked: true } });
    finish({ automatic: "passed" }); await service.wait(s.sessionId);
    expect(recovered.status(s.sessionId).attempts.every(a => a.state === "interrupted")).toBe(true); expect(calls).toBe(1);
  });
  it("bounds an executor that never resolves", async () => {
    const { service } = await controller(async () => new Promise(() => {}));
    const preview = await service.preview(selection);
    const s = await service.start({ mode: "targeted", caseIds: [preview.caseIds[0]] }, config);
    expect((await service.wait(s.sessionId)).state).toBe("interrupted");
  });
  it("serves preview/start/cancel/continue/status through local HTTP without saving credentials", async () => {
    const { service, store } = await controller(async c => new Promise((_, reject) => c.signal.addEventListener("abort", () => reject(c.signal.reason))));
    const server = createServer((req, res) => { void handleRegressionApi(req, res, service); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address() as { port: number };
    const post = async (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}/api/regression/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      expect((await (await post("preview", { selection: { mode: "full" } })).json()).caseCount).toBe(64);
      expect((await post("sessions", { selection, configuration: { ...config, stopLimitUsd: -1 } })).status).toBe(400); expect(store.list()).toHaveLength(0);
      const s = await (await post("sessions", { selection, configuration: config, apiKey: "private-key" })).json(); await running(service, s.sessionId);
      await post(`sessions/${s.sessionId}/cancel`, {}); expect((await service.wait(s.sessionId)).complete).toBe(true);
      const next = await (await post(`sessions/${s.sessionId}/continue`, { configuration: config })).json(); await running(service, next.sessionId); await post(`sessions/${next.sessionId}/cancel`, {}); await service.wait(next.sessionId);
      expect(next.previousSessionId).toBe(s.sessionId);
      expect(readdirSync(store.root).map(id => readFileSync(join(store.root, id, "session.json"), "utf8")).join()).not.toContain("private-key");
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

it("settles late billed usage without double-counting uncertain exposure", () => {
  const ledger = new CostLedger(.1, .1); ledger.reserve("late", .04); ledger.markUnknown("late", "cancelled"); ledger.record(.015, "late");
  expect(ledger.snapshot()).toMatchObject({ spentUsd: .015, uncertainUsd: 0, locked: true });
});
it("bounds and cancels a hanging preflight without executing attempts", async () => {
  let executed = 0;
  const { service } = await controller(async () => { executed++; return { automatic: "passed" }; }, { preflight: async () => new Promise(() => {}) });
  const s = await service.start(selection, config); service.cancel(s.sessionId);
  expect((await service.wait(s.sessionId)).state).toBe("cancelled"); expect(executed).toBe(0);
});
it("keeps a returned runner interruption unfinished rather than a completed observation", async () => {
  const { service } = await controller(async c => {
    const recorder = new AgentEvaluationRecorder({ runId: "returned-stop", caseId: c.attempt.caseId, datasetVersion: "1", ledger: c.ledger, prices: {}, maxRequestCostUsd: .01 });
    recorder.recordOutcome({ state: "cancelled", reasonCode: "cancelled", reason: "runner deadline" });
    return { automatic: "unknown", trace: recorder.snapshot(true) };
  });
  const preview = await service.preview(selection);
  const s = await service.start({ mode: "targeted", caseIds: [preview.caseIds[0]] }, config);
  expect((await service.wait(s.sessionId)).attempts[0].state).toBe("interrupted");
});

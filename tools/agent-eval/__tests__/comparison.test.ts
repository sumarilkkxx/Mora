import { describe, expect, it } from "vitest";
import { compareSessions, summarizeSession } from "../regression/comparison";
import type { Session, StoredAttempt } from "../regression/store";
const attempt = (id: string, automatic: StoredAttempt["automatic"], repetition = 1): StoredAttempt => ({ schemaVersion: 2, sessionId: "s", attemptId: `${id}-${repetition}`, caseId: id, repetition, state: "completed", automatic, evidenceMode: "real_model", identity: { case: "case", media: "media", evaluator: "evaluator", agent: "agent" }, item: { expected: { behavior: "complete" }, source: { id: "input", group: "group" }, lineage: { sourceFamily: "family" } }, protocol: { quality: "720p" } } as StoredAttempt);
export function session(attempts: StoredAttempt[], overrides: Partial<Session> = {}): Session { return { schemaVersion: 2, sessionId: "s", owner: "owner", startedAt: "2026-10-02", state: "completed", selection: { mode: "full", caseIds: [...new Set(attempts.map(a => a.caseId))], repetitions: {}, seed: 0 }, configuration: { provider: "provider", textModel: "text", visionModel: "vision", stopLimitUsd: 1, maxRequestCostUsd: .1, concurrency: 1, timeoutMs: 1000 }, datasetVersion: "1", protocolVersion: "1", code: { head: "head", dirty: true, fingerprint: "agent" }, evaluator: "evaluator", prices: {}, attempts, ...overrides }; }
describe("traceable reference comparison", () => {
  it("compares common/new/missing and keeps repetitions rather than rewriting a failed first attempt", () => {
    const reference = session([attempt("regression", "passed"), attempt("recovered", "failed"), attempt("persistent", "failed"), attempt("missing", "passed")]);
    const current = session([attempt("regression", "failed"), attempt("regression", "passed", 2), attempt("recovered", "passed"), attempt("persistent", "failed"), attempt("new", "passed")]);
    const result = compareSessions(current, reference);
    expect(result.newCases).toEqual(["new"]); expect(result.missingCases).toEqual(["missing"]);
    expect(result.cases.find(c => c.caseId === "regression")).toMatchObject({ classification: "new_failure", current: { passed: 1, failed: 1, attempts: 2 } });
    expect(result.cases.find(c => c.caseId === "recovered")?.classification).toBe("recovered");
    expect(result.cases.find(c => c.caseId === "persistent")?.classification).toBe("persistent_failure");
    expect(current.attempts[0].automatic).toBe("failed");
  });
  it("refuses incompatible case/media/evaluator/protocol pairing but permits changed agent code", () => {
    const a = session([attempt("one", "passed")]); const b = structuredClone(a); b.code.fingerprint = "new-agent"; b.attempts[0].identity.agent = "new-agent";
    expect(compareSessions(b, a).cases[0].compatible).toBe(true);
    for (const field of ["case", "media", "evaluator"] as const) { const changed = structuredClone(b); changed.attempts[0].identity[field] = "changed"; expect(compareSessions(changed, a).cases[0]).toMatchObject({ compatible: false, classification: "not_comparable" }); }
    const changed = structuredClone(b); changed.attempts[0].protocol.quality = "different" as "720p"; expect(compareSessions(changed, a).cases[0].compatible).toBe(false);
    b.configuration.provider = "other"; b.configuration.textModel = "other-text"; b.configuration.stopLimitUsd = 2;
    expect(compareSessions(b, a).warnings.join(" ")).toMatch(/provider.*textModel.*stopLimitUsd/);
  });
  it("separates evidence modes and behavior denominators and never counts unrun as failed", () => {
    const completed = attempt("done", "passed"), stopped = attempt("stop", "passed"), pending = attempt("pending", "not_evaluated"), unknown = attempt("unknown", "unknown");
    stopped.item.expected.behavior = "stop"; stopped.evidenceMode = "fixed_response"; pending.state = "interrupted";
    const summary = summarizeSession(session([completed, stopped, pending, unknown]));
    expect(summary).toMatchObject({ planned: 4, evaluated: 2, unevaluated: 2, failed: 0, completed: 3, human: { reviewed: 0, planned: 4 } });
    expect(summary.groups).toEqual(expect.arrayContaining([expect.objectContaining({ expectedBehavior: "stop", evidenceMode: "fixed_response", evaluated: 1 })]));
    expect(compareSessions(session([pending]), session([attempt("pending", "failed")])).cases[0].classification).toBe("unavailable");
    expect(summarizeSession({ schemaVersion: 1, cases: [], runIds: ["old"] })).toMatchObject({ available: false, reason: "not recorded" });
  });
});

import { afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { ComparisonService } from "../regression/comparison";
import { SessionStore } from "../regression/store";
import { RegressionController } from "../regression/controller";
import { handleRegressionApi } from "../regression/api";
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
it("persists replaceable reference snapshots, original attempts and append-only reports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-comparison-")); directories.push(directory);
  const store = new SessionStore(directory);
  const a = session([attempt("one", "failed")], { sessionId: randomUUID() }), b = session([attempt("one", "passed")], { sessionId: randomUUID() }), c = session([attempt("one", "passed")], { sessionId: randomUUID(), code: { head: "next", dirty: true, fingerprint: "dirty-change" } });
  for (const s of [a, b, c]) { store.save(s); store.saveBudget(s.sessionId, { spentUsd: .01, reservations: {}, uncertain: {} }); }
  const before = readFileSync(join(store.directory(c.sessionId), "session.json"), "utf8");
  const service = new ComparisonService(store);
  await service.choose(c.sessionId, a.sessionId); const first = await service.report(c.sessionId);
  expect(first.comparison?.cases[0].classification).toBe("recovered"); expect(first.overview.human.reviewed).toBe(0);
  await service.choose(c.sessionId, b.sessionId); const second = await new ComparisonService(new SessionStore(directory)).report(c.sessionId);
  expect(second.comparison?.cases[0].classification).toBe("unchanged"); expect(service.reference(c.sessionId).history).toHaveLength(2);
  expect(service.reference(c.sessionId).history[0]).toMatchObject({ current: { code: { dirty: true, fingerprint: "dirty-change" } }, reference: { sessionId: a.sessionId } });
  expect(readdirSync(join(store.directory(c.sessionId), "reports"))).toHaveLength(2);
  expect(readFileSync(join(store.directory(c.sessionId), "session.json"), "utf8")).toBe(before);
  await expect(service.choose(c.sessionId, c.sessionId)).rejects.toThrow();
  const oldId = randomUUID(), old = { schemaVersion: 1, sessionId: oldId, runIds: ["unversioned"], textModel: "old" };
  const compatibility = new ComparisonService(store, async id => { if (id !== oldId) throw new Error("Missing legacy run"); return old; });
  await compatibility.choose(c.sessionId, oldId);
  expect((await compatibility.report(c.sessionId)).comparison).toMatchObject({ available: false, reason: "not recorded" });
  expect(old).toEqual({ schemaVersion: 1, sessionId: oldId, runIds: ["unversioned"], textModel: "old" });
});
it("exposes reference/report routes without any human review gate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-comparison-api-")); directories.push(directory); const store = new SessionStore(directory);
  const a = session([attempt("one", "failed")], { sessionId: randomUUID() }), b = session([attempt("one", "passed")], { sessionId: randomUUID() });
  for (const s of [a, b]) { store.save(s); store.saveBudget(s.sessionId, { spentUsd: 0, reservations: {}, uncertain: {} }); }
  const controller = new RegressionController(store, { identity: async () => ({ code: b.code, evaluator: b.evaluator }), preflight: async () => ({ baseUrl: "local", prices: {} }), execute: async () => ({ automatic: "passed" }) });
  const server = createServer((req, res) => { void handleRegressionApi(req, res, controller); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/api/regression/sessions/${b.sessionId}`;
  try {
    const reference = await fetch(endpoint + "/reference", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ referenceSessionId: a.sessionId }) }); expect(reference.status).toBe(200);
    const report = await (await fetch(endpoint + "/report")).json(); expect(report.overview.human.reviewed).toBe(0); expect(report.comparison.cases[0].classification).toBe("recovered");
    expect(report).not.toHaveProperty("combinedScore");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

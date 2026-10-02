import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RegressionController } from "../regression/controller";
import { SessionStore } from "../regression/store";
import { ReviewStore } from "../regression/review";
import { ComparisonService } from "../regression/comparison";
const directories: string[] = [];
afterEach(async () => { for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "eval-review-")); directories.push(directory);
  const store = new SessionStore(directory), service = new RegressionController(store, { identity: async () => ({ code: { head: "head", dirty: true, fingerprint: "agent" }, evaluator: "evaluator" }), preflight: async () => ({ baseUrl: "local", prices: {} }), execute: async () => ({ automatic: "passed" }) });
  const config = { provider: "local", textModel: "text", visionModel: "vision", stopLimitUsd: .1, maxRequestCostUsd: .01 };
  const run = await service.start({ mode: "targeted", categories: ["product"] }, config); const session = await service.wait(run.sessionId);
  return { store, service, config, session, reviews: new ReviewStore(store), comparison: new ComparisonService(store) };
}
describe("optional review persistence independent of automatic facts", () => {
  it("accepts concise negative labels, persists updates and preserves every automatic byte", async () => {
    const { store, session, reviews, comparison } = await setup(); const id = session.sessionId, a = session.attempts[0];
    const before = readFileSync(join(store.directory(id), "session.json"), "utf8"), budget = readFileSync(join(store.directory(id), "budget.json"), "utf8");
    expect(reviews.list(id)).toHaveLength(0); expect((await comparison.report(id)).overview.human.reviewed).toBe(0);
    reviews.save(id, { attemptId: a.attemptId, verdict: "needs_changes", labels: ["editing_audio"], severity: "improvement", atSeconds: 2 });
    const restarted = new ReviewStore(new SessionStore(store.root)); expect(restarted.list(id)[0]).toMatchObject({ verdict: "needs_changes", atSeconds: 2, labels: ["editing_audio"] });
    restarted.save(id, { attemptId: a.attemptId, verdict: "usable", labels: [], note: "fixed in a later output; observation updated" });
    expect(restarted.list(id)).toHaveLength(1); expect(restarted.history(id)).toHaveLength(2);
    expect((await comparison.report(id, restarted.attemptReviews(id))).overview.human.reviewed).toBe(1);
    expect(readFileSync(join(store.directory(id), "session.json"), "utf8")).toBe(before); expect(readFileSync(join(store.directory(id), "budget.json"), "utf8")).toBe(budget);
  });
  it("rejects nonexistent attempt, invalid labels/time, negative without cause and non-whitelisted fields", async () => {
    const { session, reviews } = await setup(), a = session.attempts[0];
    const good = { attemptId: a.attemptId, verdict: "unknown", labels: [] };
    for (const patch of [{ attemptId: "absent" }, { labels: ["invalid"] }, { atSeconds: -1 }, { atSeconds: Infinity }, { atSeconds: 3601 }, { atSeconds: "2" }, { verdict: "worse" }, { verdict: "needs_changes" }, { severity: "catastrophic" }, { apiKey: "secret" }, { note: "x".repeat(2001) }]) expect(() => reviews.save(session.sessionId, { ...good, ...patch })).toThrow();
    expect(reviews.list(session.sessionId)).toHaveLength(0);
  });
  it("binds reference preferences to the chosen run and keeps session-level labels separate", async () => {
    const { session, service, config, reviews, comparison } = await setup();
    const r = await service.start({ mode: "quick" }, config); await service.wait(r.sessionId); await comparison.choose(session.sessionId, r.sessionId);
    const a = session.attempts[0]; reviews.save(session.sessionId, { attemptId: a.attemptId, verdict: "worse", labels: ["facts"], severity: "blocking" });
    expect(reviews.list(session.sessionId)[0]).toMatchObject({ referenceSessionId: r.sessionId, verdict: "worse" });
    reviews.save(session.sessionId, { scope: "session", verdict: "same", labels: [] });
    expect(reviews.list(session.sessionId)).toHaveLength(2); expect(reviews.attemptReviews(session.sessionId)).toHaveLength(1);
    expect(() => reviews.save(session.sessionId, { attemptId: a.attemptId, verdict: "usable", labels: [] })).toThrow();
  });
  it("permits unreviewed, partially reviewed, fully reviewed reports and fresh runs", async () => {
    const { session, service, config, reviews, comparison } = await setup();
    expect((await comparison.report(session.sessionId, reviews.attemptReviews(session.sessionId))).overview.human.reviewed).toBe(0);
    for (const a of session.attempts) reviews.save(session.sessionId, { attemptId: a.attemptId, verdict: "unknown", labels: [] });
    const report = await comparison.report(session.sessionId, reviews.attemptReviews(session.sessionId));
    expect(report.overview).toMatchObject({ evaluated: 8, failed: 0, human: { reviewed: 8, unknown: 8 } });
    const run = await service.start({ mode: "quick" }, config); expect((await service.wait(run.sessionId)).state).toBe("completed");
  });
});

import { createServer } from "node:http";
import { handleRegressionApi } from "../regression/api";
it("persists HTTP labels across a new server and reports them without mutating scores", async () => {
  const { session, store, service, comparison, config } = await setup();
  let server = createServer((req, res) => { void handleRegressionApi(req, res, service); });
  async function open() { await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${(server.address() as { port: number }).port}/api/regression/sessions/${session.sessionId}`; }
  const close = async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); };
  let endpoint = await open();
  const save = (value: unknown) => fetch(endpoint + "/reviews", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const original = readFileSync(join(store.directory(session.sessionId), "session.json"), "utf8");
  try {
    const a = session.attempts[0];
    expect((await save({ attemptId: a.attemptId, verdict: "unusable", labels: [] })).status).toBe(400);
    expect((await save({ attemptId: a.attemptId, verdict: "unknown", labels: [], apiKey: "not-accepted" })).status).toBe(400);
    expect((await save({ attemptId: a.attemptId, verdict: "unknown", labels: [], note: "apiKey=not-accepted" })).status).toBe(400);
    expect((await save({ attemptId: a.attemptId, verdict: "unusable", labels: ["requirements", "captions_copy"], severity: "blocking", atSeconds: 0 })).status).toBe(200);
    await close();
    const restarted = new RegressionController(new SessionStore(store.root), { identity: async () => ({ code: session.code, evaluator: session.evaluator }), preflight: async () => ({ baseUrl: "local", prices: {} }), execute: async () => ({ automatic: "passed" }) });
    server = createServer((req, res) => { void handleRegressionApi(req, res, restarted); }); endpoint = await open();
    expect((await (await fetch(endpoint + "/reviews")).json()).current[0]).toMatchObject({ verdict: "unusable", labels: ["requirements", "captions_copy"] });
    expect((await (await fetch(endpoint + "/report")).json()).overview.human.reviewed).toBe(1);
    expect((await save({ attemptId: a.attemptId, verdict: "usable", labels: [] })).status).toBe(200);
    const reference = await restarted.start({ mode: "quick" }, config); await restarted.wait(reference.sessionId); await comparison.choose(session.sessionId, reference.sessionId);
    expect((await save({ attemptId: a.attemptId, verdict: "worse", labels: ["facts"] })).status).toBe(200);
    expect((await save({ scope: "session", verdict: "same", labels: [] })).status).toBe(200);
    const report = await (await fetch(endpoint + "/report")).json(); expect(report.human[0].referenceSessionId).toBe(reference.sessionId); expect(report.sessionReviews).toHaveLength(1);
    const nextReference = await restarted.start({ mode: "quick" }, config); await restarted.wait(nextReference.sessionId); await comparison.choose(session.sessionId, nextReference.sessionId);
    const switched = await (await fetch(endpoint + "/report")).json(); expect(switched.human[0].referenceSessionId).toBe(reference.sessionId); expect(switched.overview.human.reviewed).toBe(0); expect(switched.reviewContext[0].applicableToSelectedReference).toBe(false);
    expect(readFileSync(join(store.directory(session.sessionId), "session.json"), "utf8")).toBe(original);
  } finally { await close(); }
});
it("preserves legacy report availability and rejects timestamps beyond observed output", async () => {
  const { session, store, reviews, comparison } = await setup();
  const a = store.get(session.sessionId); a.attempts[0].result = { automatic: "passed", evidence: { duration: 3 } }; store.save(a);
  expect(() => reviews.save(session.sessionId, { attemptId: a.attempts[0].attemptId, verdict: "needs_changes", labels: ["editing_audio"], atSeconds: 4 })).toThrow(/exceeds observed/);
  const id = (await import("node:crypto")).randomUUID(); store.save({ schemaVersion: 1, sessionId: id, runIds: [] } as unknown as typeof a);
  expect(reviews.attemptReviews(id)).toEqual([]); expect((await comparison.report(id, reviews.attemptReviews(id))).overview.available).toBe(false);
});

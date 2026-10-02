// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
const state = vi.hoisted(() => ({ db: undefined as unknown as BetterSQLite3Database }));
vi.mock("../../../src/lib/db", () => ({ getDb: () => state.db }));
import { RegressionController } from "../regression/controller";
import { SessionStore } from "../regression/store";
import { executeRegression, preflightModels } from "../regression/executors";
import { autoEditRuns, projects } from "../../../src/lib/db/schema";
let directory: string, native: Database.Database;
const records: unknown[] = [];
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "regression-execution-")); vi.stubEnv("APP_DATA_DIR", directory); native = new Database(":memory:"); state.db = drizzle(native); migrate(state.db, { migrationsFolder: "drizzle" }); });
afterAll(async () => { if (process.env.MORA_CONTROL_EVIDENCE) await writeFile(process.env.MORA_CONTROL_EVIDENCE, JSON.stringify({ externalProviderCalls: 0, records }, null, 2)); native.close(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
const config = { provider: "local-test", textModel: "local", visionModel: "local", stopLimitUsd: .1, maxRequestCostUsd: .01, timeoutMs: 120000, concurrency: 1 };
const identity = async () => ({ code: { head: "offline", dirty: true, fingerprint: "offline-current-runner" }, evaluator: "v3" });
describe("production protocol adapters behind the durable controller", () => {
  it("renders a fresh 720p controlled output and checks the frozen oracle", async () => {
    const service = new RegressionController(new SessionStore(join(directory, "media")), { identity, preflight: async () => { throw new Error("No model should be contacted"); }, execute: executeRegression });
    const s = await service.start({ mode: "targeted", caseIds: ["regression-format_timing-portrait"] }, config); const done = await service.wait(s.sessionId);
    expect(done.state).toBe("completed"); expect(done.attempts[0].automatic).toBe("passed"); expect(done.attempts[0].result?.trace?.modelCalls).toHaveLength(0);
    records.push(done);
  }, 120000);
  it("executes the selected fixed-response case on an isolated actual SQLite runner", async () => {
    const service = new RegressionController(new SessionStore(join(directory, "fault")), { identity, preflight: async () => { throw new Error("No model should be contacted"); }, execute: executeRegression });
    const preview = await service.preview({ mode: "targeted", categories: ["safe_stop"] }); const id = preview.caseIds.find(id => id.endsWith("bad-input"))!;
    const s = await service.start({ mode: "targeted", caseIds: [id] }, config); const done = await service.wait(s.sessionId);
    expect(done.state, done.attempts[0].reason).toBe("completed"); expect(done.attempts[0].automatic).toBe("passed"); expect(done.attempts[0].result?.trace?.outcome?.reasonCode).toBe("invalid_media"); records.push(done);
  }, 120000);
  it("uses real model transport against loopback only, persists unknown billing and publishes no product project", async () => {
    let requests = 0;
    const server = createServer(async (req, res) => { for await (const _chunk of req) { void _chunk; } requests++; res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "local controlled unauthorized", type: "authentication_error" } })); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address() as { port: number };
    try {
      const service = new RegressionController(new SessionStore(join(directory, "model")), { identity, preflight: async () => ({ baseUrl: `http://127.0.0.1:${address.port}/v1`, prices: { local: { inputUsdPerMillionTokens: .01, outputUsdPerMillionTokens: .01, source: "loopback test fixture", effectiveAt: "2026-10-02" } } }), execute: executeRegression });
      const s = await service.start({ mode: "targeted", caseIds: ["regression-product-6724612"] }, config, "local-test-secret"); const done = await service.wait(s.sessionId);
      expect(requests).toBe(1); expect(done.complete).toBe(true); expect(done.budget.locked).toBe(true); expect(done.budget.uncertainUsd).toBeGreaterThan(0);
      expect(state.db.select().from(projects).all().every(p => p.isInternal)).toBe(true); expect(state.db.select().from(autoEditRuns).all().every(r => !["running", "queued"].includes(r.status))).toBe(true);
      expect(JSON.stringify(done)).not.toContain("local-test-secret"); records.push(done);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 120000);
  it("rejects unsupported providers explicitly before a network request", async () => {
    await expect(preflightModels({ ...config, provider: "arbitrary-provider" }, "key")).rejects.toThrow(/No provider substitution/);
  });
});

it("maps actual runner pre-request budget rejection to unfinished attempts and explicit continuation", async () => {
  let requests = 0;
  const server = createServer(async (req, res) => { for await (const chunk of req) { void chunk; } requests++; res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "local unauthorized", type: "authentication_error" } })); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address() as { port: number };
  try {
    const service = new RegressionController(new SessionStore(join(directory, "budget")), { identity, preflight: async () => ({ baseUrl: `http://127.0.0.1:${address.port}/v1`, prices: { local: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 1, source: "loopback fixed rate", effectiveAt: "2026-10-02" } } }), execute: executeRegression });
    const s = await service.start({ mode: "targeted", caseIds: ["regression-product-6724612"] }, { ...config, maxRequestCostUsd: .000001 }); const done = await service.wait(s.sessionId);
    expect(requests).toBe(0); expect(done.state, done.attempts[0].result?.trace?.outcome?.reasonCode).toBe("budget_stopped"); expect(done.attempts[0].state).toBe("budget_stopped"); expect(done.attempts[0].automatic).toBe("not_evaluated"); expect(done.attempts[0].result?.trace?.outcome?.reasonCode).toBe("budget_exhausted");
    const continued = await service.continue(s.sessionId, { ...config, maxRequestCostUsd: .1 }); const end = await service.wait(continued.sessionId);
    expect(end.previousSessionId).toBe(s.sessionId); expect(end.attempts[0].previousAttemptId).toBe(done.attempts[0].attemptId);
    expect(service.status(s.sessionId).attempts[0].state).toBe("budget_stopped");
    records.push(done, end);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 120000);
it("still scores an expected invocation-budget safe stop as a completed observation", async () => {
  const service = new RegressionController(new SessionStore(join(directory, "expected-stop")), { identity, preflight: async () => { throw new Error("No external model"); }, execute: executeRegression });
  const s = await service.start({ mode: "targeted", caseIds: ["regression-safe_stop-call-limit"] }, config); const done = await service.wait(s.sessionId);
  expect(done.state, done.attempts[0].reason).toBe("completed"); expect(done.attempts[0].automatic).toBe("passed"); expect(done.attempts[0].state).toBe("completed"); records.push(done);
}, 120000);

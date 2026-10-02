import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request } from "node:http";
import { randomUUID } from "node:crypto";
import { RegressionController } from "../regression/controller";
import { SessionStore } from "../regression/store";
import { handleDevtool } from "../regression/http";
import type { Session } from "../regression/store";
const directories: string[] = [];
afterEach(async () => { for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });
describe("devtool UI and restricted media HTTP", () => {
  it("serves all workflows and rejects arbitrary/symlink files with verified range access", async () => {
    const root = await mkdtemp(join(tmpdir(), "mora-ui-")); directories.push(root); const store = new SessionStore(join(root, "sessions"));
    const id = randomUUID(), attemptId = randomUUID();
    const session: Session = { schemaVersion: 2, sessionId: id, state: "completed", owner: "owner", startedAt: "today", selection: { mode: "quick", caseIds: [], repetitions: {}, seed: 0 }, configuration: { provider: "local", textModel: "text", visionModel: "vision", stopLimitUsd: .1, maxRequestCostUsd: .01, concurrency: 1, timeoutMs: 1000 }, datasetVersion: "1", protocolVersion: "1", evaluator: "evaluator", code: { head: "head", dirty: true, fingerprint: "agent" }, prices: {}, attempts: [] };
    store.save(session); store.saveBudget(id, { spentUsd: 0, reservations: {}, uncertain: {} });
    const output = join(store.directory(id), "output.mp4"); await writeFile(output, "0123456789");
    session.attempts.push({ schemaVersion: 2, sessionId: id, attemptId, caseId: "case", repetition: 1, state: "completed", automatic: "passed", identity: { case: "case", media: "media", agent: "agent", evaluator: "evaluator" }, evidenceMode: "real_media", item: {} as Session["attempts"][number]["item"], protocol: {} as Session["attempts"][number]["protocol"], result: { automatic: "passed", outputPath: output } }); store.save(session);
    const legacyRoot = join(root, "legacy"); const legacyId = randomUUID();
    await mkdir(join(legacyRoot, `calibration-${legacyId}`), { recursive: true });
    await writeFile(join(legacyRoot, `calibration-${legacyId}`, "summary.md"), "# Preserved orphan report");
    const controller = new RegressionController(store, { identity: async () => ({ code: session.code, evaluator: session.evaluator }), preflight: async () => ({ baseUrl: "local", prices: {} }), execute: async () => ({ automatic: "unknown" }) });
    const server = createServer((req, res) => { void handleDevtool(req, res, { controller, mediaRoots: [root], legacyRoot, catalog: async (_provider, key) => { throw new Error(`Provider rejected Authorization: Bearer ${key}`); } }); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const foreignHostStatus = await new Promise<number | undefined>(resolve => { const r = request(base, { headers: { Host: "untrusted.example" } }, res => { res.resume(); resolve(res.statusCode); }); r.end(); });
      expect(foreignHostStatus).toBe(403);
      expect((await fetch(base + "/api/regression/sessions", { method: "POST", headers: { Origin: "https://untrusted.example" } })).status).toBe(403);
      const models = await fetch(base + "/api/regression/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "openrouter", apiKey: "transient-sensitive-value" }) });
      expect(models.status).toBe(400); expect(await models.text()).not.toContain("transient-sensitive-value");
      const old = await fetch(base + "/api/regression/history"); expect(old.status).toBe(200);
      expect(await old.json()).toEqual([expect.objectContaining({ sessionId: legacyId, startedAt: "not recorded", executionEvidence: "not recorded" })]);
      const preserved = await fetch(base + `/api/regression/legacy/${legacyId}`); expect(preserved.status).toBe(200); expect((await preserved.json()).report).toBe("# Preserved orphan report");
      const pageResponse = await fetch(base); expect(pageResponse.headers.get("content-security-policy")).toContain("script-src 'self'");
      const page = await pageResponse.text(); for (const id of ["quick", "targeted", "full", "cancel", "continue", "reference", "report", "history"]) expect(page).toContain(`id="${id}"`);
      const script = await (await fetch(base + "/ui/client.js")).text(); expect(script).not.toContain("innerHTML"); expect(script).not.toContain("apiKey: $('apiKey').value" + ", model");
      const range = await fetch(`${base}/media/${id}/${attemptId}/output`, { headers: { Range: "bytes=2-5" } }); expect(range.status).toBe(206); expect(await range.text()).toBe("2345");
      expect((await fetch(base + "/media?path=/etc/passwd")).status).toBe(404);
      expect((await fetch(`${base}/media/${id}/${randomUUID()}/output`)).status).toBe(404);
      const outside = join(root, "..", `private-${randomUUID()}.mp4`); await writeFile(outside, "private");
      try { const link = join(store.directory(id), "link.mp4"); await symlink(outside, link); session.attempts[0].result!.outputPath = link; store.save(session); expect((await fetch(`${base}/media/${id}/${attemptId}/output`)).status).toBe(403); } finally { await rm(outside); }
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

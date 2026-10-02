/** Explicit offline test server: injected loopback provider, isolated SQLite/results. Never a product adapter. */
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegressionController } from "../regression/controller";
import { SessionStore } from "../regression/store";
import { currentIdentity, executeRegression } from "../regression/executors";
import { handleDevtool } from "../regression/http";
async function main() {
const root = process.env.MORA_EVAL_TEST_ROOT || await mkdtemp(join(tmpdir(), "mora-eval-browser-"));
process.env.APP_DATA_DIR = join(root, "data");
const requests: Array<{ at: string; model: string; aborted?: boolean }> = [];
let behavior: "malformed" | "hold" = "malformed";
const provider = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") { res.writeHead(404); res.end(); return; }
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const entry = { at: new Date().toISOString(), model: String(body.model), aborted: false }; requests.push(entry);
  if (behavior === "hold") { res.on("close", () => { entry.aborted = true; }); return; }
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: "not valid analysis JSON" } }], usage: { prompt_tokens: 100, completion_tokens: 5 } }));
});
await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
const prices = { "local-text": { inputUsdPerMillionTokens: .001, outputUsdPerMillionTokens: .001, source: "local fixed-response fixture; no external billing", effectiveAt: "2026-10-02" }, "local-vision": { inputUsdPerMillionTokens: .001, outputUsdPerMillionTokens: .001, source: "local fixed-response fixture; no external billing", effectiveAt: "2026-10-02" } };
// Fail closed on remote fetch even if an implementation accidentally tries a network fallback.
const realFetch = globalThis.fetch;
let blockedExternal = 0;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => { const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") { blockedExternal++; throw new Error("External network blocked in offline fixture"); } return realFetch(input, init); }) as typeof fetch;
await mkdir(join(root, "legacy"), { recursive: true });
const legacyId = "11111111-1111-4111-8111-111111111111", legacyDirectory = join(root, "legacy", `calibration-${legacyId}`);
await mkdir(legacyDirectory, { recursive: true });
await writeFile(join(legacyDirectory, "session.json"), JSON.stringify({ schemaVersion: 1, sessionId: legacyId, kind: "calibration", startedAt: "2026-09-15T00:00:00Z", textModel: "legacy", visionModel: "legacy", runIds: [], cases: [] }));
await writeFile(join(legacyDirectory, "summary.md"), "# Preserved historical report\nExecution receipts not recorded.\n");
const service = new RegressionController(new SessionStore(join(root, "sessions")), { identity: currentIdentity, preflight: async c => { if (c.provider !== "local-fixture") throw new Error("Fixture accepts only explicit local-fixture provider"); return { baseUrl, prices }; }, execute: async c => {
  const result = await executeRegression(c);
  if (result.trace) result.trace.metadata = { ...result.trace.metadata, localFixedProvider: c.attempt.evidenceMode === "real_model", externalProviderCalls: 0, offlineQualityNotEvaluated: c.attempt.evidenceMode === "real_model" };
  return result;
} });
const options = { controller: service, mediaRoots: [root, join(process.cwd(), "evals/agent/fixtures"), join(process.cwd(), ".scratch/mora-agent-evaluation")], legacyRoot: join(root, "legacy"), providers: [{ id: "local-fixture", label: "离线固定 Provider · 仅工程验收" }], catalog: async () => ({ provider: "Local fixture", baseUrl, fetchedAt: "2026-10-02", text: [{ id: "local-text", name: "Local fixed text", inputModalities: ["text"], outputModalities: ["text"], toolCalling: true, price: prices["local-text"] }], vision: [{ id: "local-vision", name: "Local fixed vision", inputModalities: ["text", "image"], outputModalities: ["text"], toolCalling: false, price: prices["local-vision"] }] }) };
const server = createServer((req, res) => { void (async () => {
  // Test controls exist only in this explicitly invoked harness, never in normal server.ts.
  if (req.url === "/__fixture/state") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ requests, blockedExternal, externalProviderCalls: 0, root })); return; }
  if (req.url === "/__fixture/hold" || req.url === "/__fixture/malformed") { behavior = req.url.endsWith("hold") ? "hold" : "malformed"; res.end("ok"); return; }
  if (req.url === "/__fixture/restart") { service.recover(); res.end("ok"); return; }
  if (!await handleDevtool(req, res, options)) { res.writeHead(404); res.end("Not found"); }
})().catch(error => { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Fixture failed" })); process.stderr.write(String(error) + "\n"); }); });
await new Promise<void>(resolve => server.listen(Number(process.env.MORA_EVAL_TEST_PORT || 3108), "127.0.0.1", resolve));
await writeFile(join(root, "fixture.json"), JSON.stringify({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, root, externalProviderCalls: 0 }));
process.stdout.write(`Offline Agent Eval fixture listening on ${(server.address() as { port: number }).port}; root ${root}\n`);

}
void main().catch(error => { process.stderr.write(String(error) + "\n"); process.exitCode = 1; });

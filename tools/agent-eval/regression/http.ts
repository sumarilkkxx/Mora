import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { createMediaFileResponse } from "../../../src/lib/media-runtime";
import { getOutputDir } from "../../../src/lib/paths";
import { loadRegressionDataset } from "../regression-dataset";
import { loadEvaluationModelCatalog, type EvaluationModelCatalog } from "../model-catalog";
import { redactEvaluationValue } from "../core/trace";
import { handleRegressionApi, regressionController, reply, requestBody } from "./api";
import type { RegressionController } from "./controller";
export interface DevtoolOptions {
  controller?: RegressionController;
  mediaRoots?: string[];
  legacyRoot?: string;
  providers?: Array<{ id: string; label: string }>;
  catalog?: (provider: string, apiKey: string) => Promise<Pick<EvaluationModelCatalog, "text" | "vision" | "fetchedAt"> & { provider: string; baseUrl: string }>;
}
const uuid = "[0-9a-f-]{36}";
function allowedRequest(req: IncomingMessage) {
  const host = req.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${host}`;
}
async function legacySessions(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  const sessions = [];
  for (const entry of entries) {
    const identity = entry.name.match(new RegExp(`^(calibration|holdout)-(${uuid})$`));
    if (!entry.isDirectory() || !identity) continue;
    const raw = await readFile(join(root, entry.name, "session.json"), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
    // Interrupted legacy runs may have output/report directories without metadata.
    // Preserve the directory/report; absent facts stay explicitly not recorded.
    const s = raw === undefined ? undefined : JSON.parse(raw);
    sessions.push({ sessionId: identity[2], startedAt: s?.startedAt ?? "not recorded", kind: s?.kind ?? identity[1], textModel: s?.textModel ?? "not recorded", visionModel: s?.visionModel ?? "not recorded", executionEvidence: "not recorded", directory: join(root, entry.name) });
  }
  return sessions;
}
export async function handleDevtool(req: IncomingMessage, res: ServerResponse, options: DevtoolOptions = {}): Promise<boolean> {
  if (!allowedRequest(req)) { reply(res, 403, { error: "Only same-origin loopback requests are accepted" }); return true; }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const controller = () => options.controller ?? regressionController();
  let secrets: string[] = [];
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/ui/client.js" || url.pathname === "/ui/style.css")) {
      const file = url.pathname === "/" ? "page.html" : url.pathname.endsWith(".js") ? "client.js" : "style.css";
      const type = file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : "text/css";
      res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(await readFile(resolve("tools/agent-eval/ui", file), "utf8")); return true;
    }
    if (req.method === "GET" && url.pathname === "/api/regression/dataset") {
      const data = await loadRegressionDataset();
      reply(res, 200, { version: data.dataset.version, categories: [...new Set(data.dataset.cases.map(c => c.category))], tags: [...new Set(data.dataset.cases.flatMap(c => c.tags ?? []))].sort(), cases: data.dataset.cases.map(c => ({ caseId: c.caseId, category: c.category, tags: c.tags, brief: c.brief, expectedBehavior: c.expected.behavior, evidenceMode: c.evidenceMode })), providers: options.providers ?? [{ id: "openrouter", label: "OpenRouter" }] }); return true;
    }
    if (req.method === "POST" && url.pathname === "/api/regression/models") {
      const input = await requestBody(req); secrets = [typeof input.apiKey === "string" ? input.apiKey : ""];
      if (!(options.providers ?? [{ id: "openrouter" }]).some(p => p.id === input.provider)) throw new Error("Unsupported provider adapter; no substitution");
      const catalog = options.catalog ? await options.catalog(input.provider, secrets[0]) : await loadEvaluationModelCatalog(secrets[0]);
      reply(res, 200, redactEvaluationValue(catalog, secrets)); return true;
    }
    const legacyRoot = options.legacyRoot ?? resolve("evals/agent/results");
    if (req.method === "GET" && url.pathname === "/api/regression/history") {
      const historical = await legacySessions(legacyRoot);
      reply(res, 200, historical.map(s => ({ sessionId: s.sessionId, startedAt: s.startedAt, kind: s.kind, textModel: s.textModel, visionModel: s.visionModel, executionEvidence: s.executionEvidence }))); return true;
    }
    const legacyMatch = url.pathname.match(new RegExp(`^/api/regression/legacy/(${uuid})$`));
    if (req.method === "GET" && legacyMatch) {
      const s = (await legacySessions(legacyRoot)).find(s => s.sessionId === legacyMatch[1]);
      if (!s) { reply(res, 404, { error: "Historical session not found" }); return true; }
      const report = await readFile(join(s.directory, "summary.md"), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return "not recorded"; throw error; });
      reply(res, 200, { sessionId: s.sessionId, executionEvidence: "not recorded", report }); return true;
    }
    const media = url.pathname.match(new RegExp(`^/media/(${uuid})/(${uuid})/(source|output)$`));
    if ((req.method === "GET" || req.method === "HEAD") && media) {
      const service = controller(), s = service.store.get(media[1]), a = s.attempts.find(a => a.attemptId === media[2]);
      const stored = media[3] === "output" ? a?.result?.outputPath : a?.item.source?.path;
      if (!stored) { reply(res, 404, { error: "Media not recorded for this attempt" }); return true; }
      const path = await realpath(resolve(stored));
      const roots = options.mediaRoots ?? [service.store.root, resolve("evals/agent/fixtures"), resolve(".scratch/mora-agent-evaluation"), getOutputDir()];
      const canonical = await Promise.all(roots.map(root => realpath(root).catch(() => undefined)));
      if (!canonical.some(root => root && path.startsWith(root + sep))) { reply(res, 403, { error: "Media path outside allowed roots" }); return true; }
      const abort = new AbortController(); res.on("close", () => abort.abort());
      const response = await createMediaFileResponse(path, { contentType: "video/mp4", rangeHeader: req.headers.range, cacheControl: "no-store", signal: abort.signal });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (req.method === "HEAD") { await response.body?.cancel(); res.end(); }
      else if (response.body) { const stream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream); stream.on("error", error => { if (!abort.signal.aborted) res.destroy(error); }); stream.pipe(res); }
      else res.end();
      return true;
    }
    if (url.pathname.startsWith("/media")) { reply(res, 404, { error: "Unknown media route" }); return true; }
    if (url.pathname.startsWith("/api/regression")) return handleRegressionApi(req, res, controller());
    return false;
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (!res.headersSent) reply(res, missing ? 404 : 400, { error: redactEvaluationValue(error instanceof Error ? error.message : "Devtool request failed", secrets) }); else res.destroy();
    return true;
  }
}

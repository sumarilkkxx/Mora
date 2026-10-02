import { ReviewStore } from "./review";
import { ComparisonService } from "./comparison";
import type { IncomingMessage, ServerResponse } from "node:http";
import { RegressionController } from "./controller";
import { SessionStore } from "./store";
import { resolve } from "node:path";
import { currentIdentity, executeRegression, preflightModels } from "./executors";
let singleton: RegressionController | undefined;
export function regressionController() { return singleton ??= new RegressionController(new SessionStore(resolve("evals/agent/regression-results")), { identity: currentIdentity, preflight: preflightModels, execute: executeRegression }); }
export function reply(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); }
export async function requestBody(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const b = Buffer.from(chunk); size += b.length; if (size > 1000000) throw new Error("Request body too large"); chunks.push(b); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function handleRegressionApi(req: IncomingMessage, res: ServerResponse, controller = regressionController()) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/regression")) return false;
  try {
    if (req.method === "POST" && url.pathname === "/api/regression/preview") { reply(res, 200, await controller.preview((await requestBody(req)).selection)); return true; }
    if (req.method === "GET" && url.pathname === "/api/regression/sessions") { reply(res, 200, controller.store.list().map(s => ({ sessionId: s.sessionId, state: s.state, startedAt: s.startedAt, selection: s.selection, configuration: s.configuration }))); return true; }
    if (req.method === "POST" && url.pathname === "/api/regression/sessions") { const input = await requestBody(req); reply(res, 202, await controller.start(input.selection, input.configuration, typeof input.apiKey === "string" ? input.apiKey : "")); return true; }
    const reviewMatch = url.pathname.match(/^\/api\/regression\/sessions\/([0-9a-f-]{36})\/reviews$/);
    if (reviewMatch) {
      const reviews = new ReviewStore(controller.store);
      if (req.method === "GET") { reply(res, 200, { current: reviews.list(reviewMatch[1]), history: reviews.history(reviewMatch[1]) }); return true; }
      if (req.method === "POST" || req.method === "PUT") { reply(res, 200, reviews.save(reviewMatch[1], await requestBody(req))); return true; }
    }
    const reportMatch = url.pathname.match(/^\/api\/regression\/sessions\/([0-9a-f-]{36})\/(reference|report)$/);
    if (reportMatch) {
      const comparison = new ComparisonService(controller.store, async id => (await import("../evaluation-session")).loadStoredEvaluationSession(id));
      if (req.method === "GET" && reportMatch[2] === "report") {
        const reviews = new ReviewStore(controller.store);
        const attempts = reviews.attemptReviews(reportMatch[1]);
        let sessionReviews: unknown[] = [];
        try { sessionReviews = reviews.list(reportMatch[1]).filter(r => r.scope === "session"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        reply(res, 200, await comparison.report(reportMatch[1], attempts, sessionReviews)); return true;
      }
      if (req.method === "POST" && reportMatch[2] === "reference") { const input = await requestBody(req); reply(res, 200, await comparison.choose(reportMatch[1], String(input.referenceSessionId ?? ""))); return true; }
    }
    const match = url.pathname.match(/^\/api\/regression\/sessions\/([0-9a-f-]{36})(?:\/(cancel|continue))?$/);
    if (match) {
      if (req.method === "GET" && !match[2]) { reply(res, 200, controller.status(match[1])); return true; }
      if (req.method === "POST" && match[2] === "cancel") { reply(res, 200, controller.cancel(match[1])); return true; }
      if (req.method === "POST" && match[2] === "continue") { const input = await requestBody(req); reply(res, 202, await controller.continue(match[1], input.configuration, typeof input.apiKey === "string" ? input.apiKey : "")); return true; }
    }
    reply(res, 404, { error: "Unknown regression route" });
  } catch (error) { reply(res, 400, { error: error instanceof Error ? error.message : "Regression request failed" }); }
  return true;
}

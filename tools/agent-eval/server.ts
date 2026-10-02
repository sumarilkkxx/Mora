import { handleDevtool } from "./regression/http";
import { storedReportPath } from "./session-results";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEvaluationDataset } from "./core/dataset";
import { evaluationOverview, getEvaluationStatus, loadStoredEvaluationSession, startEvaluation, type EvaluationSessionKind } from "./evaluation-session";
import { loadEvaluationModelCatalog } from "./model-catalog";
import { deriveEvaluationWorkflow, type BaselineGate, type CalibrationGate } from "./workflow";

const HOST = "127.0.0.1";
const PORT = Number(process.env.MORA_EVAL_PORT || 3100);
const DATASET_PATH = resolve(process.cwd(), "tools/agent-eval/datasets/holdout.json");
const SHEETS_PATH = resolve(process.cwd(), ".scratch/mora-agent-evaluation/contact-sheets");

async function dataset() { return parseEvaluationDataset(JSON.parse(await readFile(DATASET_PATH, "utf8"))); }
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const value = Buffer.from(chunk); size += value.length; if (size > 1_000_000) throw new Error("Request body too large"); chunks.push(value); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}


function workflowGate(session: Awaited<ReturnType<typeof evaluationOverview>>["calibration"]): CalibrationGate {
  if (!session) return "idle"; if (!session.complete) return "running"; return session.gatePassed ? "passed" : "failed";
}
function baselineGate(session: Awaited<ReturnType<typeof evaluationOverview>>["baseline"]): BaselineGate {
  if (!session) return "idle"; if (!session.complete) return "running"; if (session.budget.locked && !session.gatePassed) return "stopped"; return session.gatePassed ? "passed" : "failed";
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (await handleDevtool(req, res)) return;
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  if (req.method === "GET" && url.pathname === "/api/holdout") {
    const value = await dataset(); json(res, 200, { datasetId: value.datasetId, version: value.version, cases: value.cases.map(item => ({ caseId: item.caseId, category: item.source.category, author: item.source.author, brief: item.brief, expected: item.expected, annotation: item.annotation, contactSheetUrl: `/contact-sheet/${encodeURIComponent(item.caseId)}` })) }); return;
  }
  if (req.method === "POST" && url.pathname === "/api/models") { const input = await body(req) as { apiKey?: string }; json(res, 200, await loadEvaluationModelCatalog(String(input.apiKey || ""))); return; }
  if (req.method === "GET" && url.pathname === "/api/workflow") {
    const value = await dataset(); const reviewed = value.cases.filter(item => item.annotation.status === "human-reviewed").length;
    const overview = await evaluationOverview(url.searchParams.get("textModel") || undefined, url.searchParams.get("visionModel") || undefined);
    const gates = deriveEvaluationWorkflow({ reviewed, total: value.cases.length, calibration: workflowGate(overview.calibration), calibrationPassedCases: overview.calibration?.taskSuccessCount, calibrationCaseCount: overview.calibration?.caseCount, baseline: baselineGate(overview.baseline), baselineDatasetEligible: value.baselineEligible });
    json(res, 200, { reviewed, total: value.cases.length, ...overview, gates }); return;
  }
  if (req.method === "POST" && url.pathname === "/api/evaluations") {
    const input = await body(req) as { kind?: EvaluationSessionKind; confirmBudget?: boolean; credentials?: Parameters<typeof startEvaluation>[1] };
    if (!input.credentials || !["calibration", "holdout"].includes(String(input.kind))) throw new Error("Evaluation kind and credentials are required");
    if (input.kind === "holdout" && input.confirmBudget !== true) throw new Error("开始正式评测前需要确认预算");
    json(res, 202, await startEvaluation(input.kind as EvaluationSessionKind, input.credentials)); return;
  }
  const evaluationMatch = url.pathname.match(/^\/api\/evaluations\/([0-9a-f-]{36})(\/report)?$/i);
  if (req.method === "GET" && evaluationMatch) {
    if (evaluationMatch[2]) { const session = await loadStoredEvaluationSession(evaluationMatch[1]); await getEvaluationStatus(session.sessionId); const markdown = await readFile(storedReportPath(session), "utf8"); res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" }); res.end(markdown); return; }
    json(res, 200, await getEvaluationStatus(evaluationMatch[1])); return;
  }
  if (req.method === "POST" && url.pathname === "/api/holdout/review") {
    const input = await body(req) as { caseId?: string; visibleFacts?: unknown; forbiddenClaims?: unknown };
    if (!input.caseId || !Array.isArray(input.visibleFacts) || !Array.isArray(input.forbiddenClaims)) throw new Error("Invalid review payload");
    const visibleFacts = input.visibleFacts.map(String).map(value => value.trim()).filter(Boolean); const forbiddenClaims = input.forbiddenClaims.map(String).map(value => value.trim()).filter(Boolean);
    if (!visibleFacts.length || !forbiddenClaims.length) throw new Error("Facts and forbidden claims are required");
    const value = await dataset(); const item = value.cases.find(candidate => candidate.caseId === input.caseId); if (!item) throw new Error("Unknown Holdout case");
    item.annotation = { version: "v1-human-reviewed", status: "human-reviewed", visibleFacts, forbiddenClaims };
    const temporary = `${DATASET_PATH}.reviewing`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await rename(temporary, DATASET_PATH); json(res, 200, { caseId: item.caseId, annotation: item.annotation }); return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/contact-sheet/")) {
    const caseId = decodeURIComponent(url.pathname.slice("/contact-sheet/".length)); const value = await dataset(); const item = value.cases.find(candidate => candidate.caseId === caseId); if (!item) { json(res, 404, { error: "Unknown Holdout case" }); return; }
    const image = await readFile(resolve(SHEETS_PATH, `${item.source.id}.jpg`)); res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" }); res.end(image); return;
  }
  json(res, 404, { error: "Not found" });
}

const server = createServer((req, res) => { void handle(req, res).catch(error => json(res, 400, { error: error instanceof Error ? error.message : "Request failed" })); });
server.listen(PORT, HOST, () => process.stdout.write(`Mora Agent Eval devtool: http://${HOST}:${PORT}\n`));

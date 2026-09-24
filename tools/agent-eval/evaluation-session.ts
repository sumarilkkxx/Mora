import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "../../src/lib/db";
import { autoEditRuns, mediaSources, projects } from "../../src/lib/db/schema";
import { getUploadsDir } from "../../src/lib/paths";
import { probeMedia } from "../../src/lib/media-probe";
import { recoverAutoEdits, startAutoEdit, type Credentials } from "../../src/lib/auto-edit/runner";
import { createLimiter } from "../../src/lib/concurrency";
import { parseBrief, type Checkpoint } from "../../src/lib/auto-edit/contract";
import { CostLedger } from "./core/cost-ledger";
import { assertDatasetIsolation, parseEvaluationDataset, selectBalancedEvaluationCases } from "./core/dataset";
import { AgentEvaluationRecorder, appendEvaluationTraceJsonl } from "./core/trace";
import type { AgentEvaluationCase, EvaluationTrace, ModelPrice } from "./core/types";
import { loadEvaluationModelCatalog, OPENROUTER_BASE_URL, selectedEvaluationPrices } from "./model-catalog";
import { evaluateStoredSession, readStoredTraces, writeStoredSessionReport } from "./session-results";

export type EvaluationSessionKind = "calibration" | "holdout";

export interface StoredEvaluationSession {
  schemaVersion: 1;
  sessionId: string;
  kind: EvaluationSessionKind;
  startedAt: string;
  datasetId: string;
  datasetVersion: string;
  evaluationFingerprint?: string;
  evaluatorVersion?: string;
  textModel: string;
  visionModel: string;
  prices: Record<string, ModelPrice>;
  stopLimitUsd: number;
  absoluteLimitUsd: number;
  maxRequestCostUsd: number;
  runIds: string[];
  cases: AgentEvaluationCase[];
  outputDirectory: string;
  tracePath: string;
}

const RESULTS_ROOT = resolve(process.cwd(), "evals", "agent", "results");
const activeLedgers = new Map<string, CostLedger>();
const evaluationSchedule = createLimiter(2);
const EVALUATOR_VERSION = "2";
const FINGERPRINT_ROOTS = ["src/lib", "tools/agent-eval"] as const;
const FINGERPRINT_FILES = ["scripts/auto-edit-asr.mjs", "package.json", "pnpm-lock.yaml"] as const;

interface EvaluationConfiguration {
  datasets: string[];
  perCategory?: number;
  stopLimitUsd: number;
  absoluteLimitUsd: number;
  maxRequestCostUsd: number;
}

function configuration(kind: EvaluationSessionKind): EvaluationConfiguration {
  return kind === "calibration"
    ? { datasets: ["dev", "smoke"], perCategory: 2, stopLimitUsd: 0.75, absoluteLimitUsd: 0.75, maxRequestCostUsd: 0.03 }
    : { datasets: ["holdout"], stopLimitUsd: 6, absoluteLimitUsd: 7, maxRequestCostUsd: 0.25 };
}

async function fileHash(path: string) { return createHash("sha256").update(await readFile(path)).digest("hex"); }

export async function fingerprintSourcePaths() {
  const root = process.cwd();
  const paths: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") await visit(absolute);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
        paths.push(relative(root, absolute));
      }
    }
  }
  for (const directory of FINGERPRINT_ROOTS) await visit(resolve(root, directory));
  paths.push(...FINGERPRINT_FILES);
  return [...new Set(paths)].sort();
}

async function loadDatasets(names: readonly string[]) {
  return Promise.all(names.map(async name => parseEvaluationDataset(JSON.parse(await readFile(resolve(process.cwd(), "tools", "agent-eval", "datasets", `${name}.json`), "utf8")))));
}

async function evaluationFingerprint(datasets: readonly ReturnType<typeof parseEvaluationDataset>[]) {
  const hash = createHash("sha256");
  hash.update(`mora-agent-evaluator:${EVALUATOR_VERSION}\n`);
  for (const path of await fingerprintSourcePaths()) hash.update(path).update("\0").update(await readFile(resolve(process.cwd(), path))).update("\0");
  for (const dataset of datasets) hash.update(dataset.datasetId).update("@").update(dataset.version).update("\0").update(JSON.stringify(dataset)).update("\0");
  return hash.digest("hex");
}

export async function reconcileTerminalTraces(session: StoredEvaluationSession, runs: Array<{ id: string; status: string; updatedAt: number | null }>) {
  const recorded = await readStoredTraces(session.tracePath);
  const byRunId = new Map(recorded.map(trace => [trace.runId, trace]));
  const caseByRunId = new Map(session.runIds.map((runId, index) => [runId, session.cases[index]]));
  const initialBudget: EvaluationTrace["budget"] = {
    stopLimitUsd: session.stopLimitUsd,
    absoluteLimitUsd: session.absoluteLimitUsd,
    spentUsd: 0,
    reservedUsd: 0,
    locked: false,
  };
  const previousBudget = recorded.reduce<EvaluationTrace["budget"]>((best, trace) => trace.budget.spentUsd >= best.spentUsd ? trace.budget : best, initialBudget);
  let changed = recorded.length !== byRunId.size;
  const now = Date.now();
  for (const run of runs) {
    const terminal = !["queued", "running", "cancel_requested"].includes(run.status);
    const settledLongEnough = typeof run.updatedAt === "number" && run.updatedAt < now - 10_000;
    if (!terminal || !settledLongEnough || byRunId.has(run.id)) continue;
    const item = caseByRunId.get(run.id);
    if (!item) continue;
    const recovered: EvaluationTrace = {
      schemaVersion: 1,
      runId: run.id,
      caseId: item.caseId,
      datasetVersion: session.datasetVersion,
      startedAt: new Date(run.updatedAt ?? now).toISOString(),
      completedAt: new Date().toISOString(),
      modelCalls: [],
      toolDecisions: [],
      budget: { ...previousBudget, reservedUsd: 0, locked: true, lockReason: "terminal run completed without a persisted evaluation trace" },
      metadata: { recovered: true, recoveryReason: "missing_terminal_trace" },
    };
    byRunId.set(run.id, recovered);
    changed = true;
  }
  const traces = session.runIds.flatMap(runId => byRunId.get(runId) ?? []);
  if (changed) {
    const temporary = `${session.tracePath}.reconciling-${randomUUID()}`;
    await writeFile(temporary, traces.map(trace => JSON.stringify(trace)).join("\n") + (traces.length ? "\n" : ""), "utf8");
    await rename(temporary, session.tracePath);
  }
  return traces;
}

function subject(item: AgentEvaluationCase) {
  if (item.source.category === "product") return "画面中的产品陈列";
  if (item.source.category === "process") return "画面中的制作过程";
  if (item.source.category === "service") return "画面中的服务过程";
  return "画面中的可见场景";
}

async function persistSession(session: StoredEvaluationSession) {
  const path = join(session.outputDirectory, "session.json");
  const temporary = `${path}.writing`;
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function storedSessions() {
  await mkdir(RESULTS_ROOT, { recursive: true });
  const entries = await readdir(RESULTS_ROOT, { withFileTypes: true });
  const sessions: StoredEvaluationSession[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^(calibration|holdout)-[0-9a-f-]+$/i.test(entry.name)) continue;
    try {
      const value = JSON.parse(await readFile(join(RESULTS_ROOT, entry.name, "session.json"), "utf8")) as StoredEvaluationSession;
      if (value.schemaVersion === 1 && value.sessionId) sessions.push(value);
    } catch {}
  }
  return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function loadStoredEvaluationSession(sessionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("Invalid evaluation session ID");
  const session = (await storedSessions()).find(item => item.sessionId === sessionId);
  if (!session) throw new Error("Evaluation session not found");
  return session;
}

async function createEvaluationRun(sessionId: string, item: AgentEvaluationCase, credentials: Credentials, session: StoredEvaluationSession, ledger: CostLedger) {
  const sourcePath = resolve(process.cwd(), item.source.path);
  const projectId = randomUUID(); const sourceId = randomUUID(); const runId = randomUUID();
  const uploadDirectory = join(getUploadsDir(), projectId, "imported");
  await mkdir(uploadDirectory, { recursive: true });
  const ownedPath = join(uploadDirectory, basename(sourcePath));
  await copyFile(sourcePath, ownedPath);
  const [metadata, sourceStat] = await Promise.all([probeMedia(ownedPath), stat(ownedPath)]);
  const now = Date.now();
  const brief = parseBrief({ ...item.brief, promotion: { subject: subject(item), audience: "未指定；采用通用中性表达", sellingPoints: "只使用画面可见事实", action: "无需行动号召" } });
  const checkpoint: Checkpoint = { operation: "auto", history: [], repairs: 0 };
  const db = getDb();
  await db.insert(projects).values({ id: projectId, name: `[Eval] ${item.caseId}`, workflowType: "edit", productionMode: "local", targetDuration: item.brief.target, productName: subject(item), isInternal: true });
  await db.insert(mediaSources).values({ id: sourceId, projectId, originalName: basename(sourcePath), filePath: ownedPath, mimeType: "video/mp4", sizeBytes: sourceStat.size, duration: Math.round(metadata.duration * 1000), width: metadata.width, height: metadata.height, hasAudio: metadata.hasAudio, status: "ready", progress: 100, createdAt: new Date(now), updatedAt: new Date(now) });
  const [run] = await db.insert(autoEditRuns).values({ id: runId, projectId, sourceId, requestKey: createHash("sha256").update(`${sessionId}:${item.caseId}`).digest("hex"), brief, checkpoint, quality: "720p", status: "queued", heartbeat: now, createdAt: now, updatedAt: now }).returning();
  const recorder = new AgentEvaluationRecorder({
    runId, caseId: item.caseId, datasetVersion: session.datasetVersion, prices: session.prices,
    maxRequestCostUsd: session.maxRequestCostUsd, ledger, secrets: [credentials.llm.apiKey],
    metadata: { mode: session.kind === "calibration" ? "real-model-evaluation" : "real-model-holdout-baseline", provider: "OpenRouter", textModel: session.textModel, visionModel: session.visionModel, priceSnapshotAt: Object.values(session.prices)[0]?.effectiveAt, sourceSha256Verified: true, annotationStatus: item.annotation.status, paidTts: false },
  });
  startAutoEdit(run, credentials, { schedule: evaluationSchedule, interactionPolicy: "autonomous", observer: recorder, onFinished: () => appendEvaluationTraceJsonl(session.tracePath, recorder.snapshot(true)) });
  return runId;
}

export async function getEvaluationStatus(sessionId: string) {
  const session = await loadStoredEvaluationSession(sessionId);
  await recoverAutoEdits();
  const runs = session.runIds.length ? await getDb().select({ id: autoEditRuns.id, status: autoEditRuns.status, stage: autoEditRuns.stage, error: autoEditRuns.error, heartbeat: autoEditRuns.heartbeat, updatedAt: autoEditRuns.updatedAt }).from(autoEditRuns).where(inArray(autoEditRuns.id, session.runIds)) : [];
  const terminal = runs.length === session.runIds.length && runs.every(run => !["queued", "running", "cancel_requested"].includes(run.status));
  const traces = await reconcileTerminalTraces(session, runs);
  const complete = terminal && traces.length === session.runIds.length;
  const results = complete ? await evaluateStoredSession(session) : [];
  const taskSuccessCount = results.filter(result => result.scores.find(score => score.name === "task_success")?.score === 1).length;
  const gatePassed = complete && taskSuccessCount === session.runIds.length;
  if (complete) await writeStoredSessionReport(session, results);
  const recordedBudget = traces.length ? traces.reduce((best, trace) => trace.budget.spentUsd > best.spentUsd ? trace.budget : best, traces[0].budget) : undefined;
  const budget = activeLedgers.get(sessionId)?.snapshot() ?? recordedBudget ?? { stopLimitUsd: session.stopLimitUsd, absoluteLimitUsd: session.absoluteLimitUsd, spentUsd: 0, reservedUsd: 0, locked: false };
  return { sessionId, kind: session.kind, startedAt: session.startedAt, textModel: session.textModel, visionModel: session.visionModel, evaluationFingerprint: session.evaluationFingerprint, evaluatorVersion: session.evaluatorVersion, budget, runs, complete, gatePassed, taskSuccessCount, caseCount: session.runIds.length, results, reportUrl: complete ? `/api/evaluations/${sessionId}/report` : undefined };
}

async function latestStatus(kind: EvaluationSessionKind, textModel?: string, visionModel?: string, fingerprint?: string) {
  const match = (await storedSessions()).find(session => session.kind === kind && (!textModel || session.textModel === textModel) && (!visionModel || session.visionModel === visionModel) && (!fingerprint || session.evaluationFingerprint === fingerprint));
  return match ? getEvaluationStatus(match.sessionId) : undefined;
}

export async function evaluationOverview(textModel?: string, visionModel?: string) {
  const [calibrationDatasets, holdoutDatasets] = await Promise.all([loadDatasets(configuration("calibration").datasets), loadDatasets(configuration("holdout").datasets)]);
  return {
    calibration: await latestStatus("calibration", textModel, visionModel, await evaluationFingerprint(calibrationDatasets)),
    baseline: await latestStatus("holdout", textModel, visionModel, await evaluationFingerprint(holdoutDatasets)),
  };
}

export async function startEvaluation(kind: EvaluationSessionKind, credentials: Credentials) {
  if (!credentials.llm.apiKey || !credentials.llm.model || !credentials.llm.visionModel) throw new Error("OpenRouter API Key、文本模型和视觉模型均为必填项");
  const apiKey = credentials.llm.apiKey;
  const textModel = credentials.llm.model;
  const visionModel = credentials.llm.visionModel;
  credentials = { ...credentials, llm: { ...credentials.llm, baseUrl: OPENROUTER_BASE_URL } };
  const config = configuration(kind);
  const datasets = await loadDatasets(config.datasets);
  const allDatasets = await loadDatasets(["smoke", "dev", "holdout"]);
  assertDatasetIsolation(allDatasets);
  if (kind === "calibration" && datasets.some(dataset => dataset.split === "holdout")) throw new Error("校准数据不能包含 Holdout 案例");
  if (kind === "holdout" && datasets.some(dataset => !dataset.baselineEligible)) throw new Error("当前 Holdout 已用于开发校准，不再是独立盲测集；请准备并复核新的 sealed Holdout 版本");
  const fingerprint = await evaluationFingerprint(datasets);
  const catalog = await loadEvaluationModelCatalog(apiKey);
  const prices = selectedEvaluationPrices(catalog, textModel, visionModel);
  const selectedCases: AgentEvaluationCase[] = config.perCategory
    ? selectBalancedEvaluationCases(datasets, config.perCategory)
    : datasets.flatMap(dataset => dataset.cases);
  if (!selectedCases.length) throw new Error("Evaluation dataset is incomplete");
  for (const item of selectedCases) {
    if (kind === "holdout" && item.annotation.status !== "human-reviewed") throw new Error("Holdout 人工金标准尚未完成 8/8 复核");
    if (await fileHash(resolve(process.cwd(), item.source.path)) !== item.source.sha256) throw new Error(`Source hash mismatch for ${item.caseId}`);
  }
  if (kind === "holdout") {
    const calibrationDatasets = await loadDatasets(configuration("calibration").datasets);
    const calibration = await latestStatus("calibration", textModel, visionModel, await evaluationFingerprint(calibrationDatasets));
    if (!calibration?.gatePassed) throw new Error("当前模型组合尚未通过与当前代码和数据版本一致的开发集校准，不能启动正式盲测");
  }
  const duplicate = await latestStatus(kind, textModel, visionModel, fingerprint);
  if (duplicate && !duplicate.complete) throw new Error(`相同模型组合的 ${kind === "calibration" ? "校准" : "Holdout Baseline"} 已在运行`);
  const sessionId = randomUUID(); const outputDirectory = join(RESULTS_ROOT, `${kind}-${sessionId}`);
  await mkdir(outputDirectory, { recursive: false });
  const session: StoredEvaluationSession = { schemaVersion: 1, sessionId, kind, startedAt: new Date().toISOString(), datasetId: datasets.map(dataset => dataset.datasetId).join("+"), datasetVersion: datasets.map(dataset => dataset.version).join("+"), evaluationFingerprint: fingerprint, evaluatorVersion: EVALUATOR_VERSION, textModel, visionModel, prices, stopLimitUsd: config.stopLimitUsd, absoluteLimitUsd: config.absoluteLimitUsd, maxRequestCostUsd: config.maxRequestCostUsd, runIds: [], cases: selectedCases, outputDirectory, tracePath: join(outputDirectory, "traces.jsonl") };
  await persistSession(session);
  const ledger = new CostLedger(config.stopLimitUsd, config.absoluteLimitUsd); activeLedgers.set(sessionId, ledger);
  for (const item of selectedCases) { session.runIds.push(await createEvaluationRun(sessionId, item, credentials, session, ledger)); await persistSession(session); }
  return getEvaluationStatus(sessionId);
}

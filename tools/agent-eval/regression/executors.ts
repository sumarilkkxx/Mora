import { randomUUID, createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { runMediaProcess } from "../../../src/lib/media-runtime";
import { loadEvaluationModelCatalog, OPENROUTER_BASE_URL, selectedEvaluationPrices } from "../model-catalog";
import { AgentEvaluationRecorder, appendEvaluationTraceJsonl } from "../core/trace";
import { assertProtocolEvidenceMode } from "../regression-dataset";
import { fileSha256 } from "../real-sources";
import { verifyMediaOutput } from "../media-oracles";
import type { ExecutionContext, Runtime } from "./controller";
import type { RunConfiguration } from "./selection";
import type { AttemptResult, Session } from "./store";
import type { EvaluationScore } from "../core/types";
function verdict(scores: EvaluationScore[]) { const score = scores.find(s => s.name === "task_success")?.score; return score === 1 ? "passed" as const : score === 0 ? "failed" as const : "unknown" as const; }
export async function currentIdentity(): Promise<{ code: Session["code"]; evaluator: string }> {
  const hash = createHash("sha256");
  async function visit(dir: string) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "__tests__") await visit(path);
      else if (entry.isFile() && !/\.(test|spec)\./.test(path)) hash.update(path).update(await readFile(path));
    }
  }
  await visit("src/lib");
  for (const path of ["scripts/auto-edit-asr.mjs", "package.json", "pnpm-lock.yaml"]) hash.update(path).update(await readFile(path));
  const evaluator = createHash("sha256");
  for (const path of ["tools/agent-eval/core/scorers.ts", "tools/agent-eval/core/contracts.ts", "tools/agent-eval/media-oracles.ts", "tools/agent-eval/session-results.ts", "tools/agent-eval/regression/executors.ts", "tools/agent-eval/constraint-fixtures.ts", "tools/agent-eval/__tests__/fault-runner.test.ts"]) evaluator.update(path).update(await readFile(path));
  return { code: { head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()), fingerprint: hash.digest("hex") }, evaluator: evaluator.digest("hex") };
}
export async function preflightModels(config: RunConfiguration, apiKey: string): Promise<Runtime> {
  if (config.provider !== "openrouter") throw new Error(`Unsupported regression model adapter: ${config.provider}. Currently supported: openrouter. No provider substitution.`);
  const catalog = await loadEvaluationModelCatalog(apiKey);
  return { baseUrl: OPENROUTER_BASE_URL, prices: selectedEvaluationPrices(catalog, config.textModel, config.visionModel) };
}
export async function executeRegression(context: ExecutionContext): Promise<AttemptResult> {
  const { attempt, signal } = context;
  assertProtocolEvidenceMode(attempt.protocol, attempt.evidenceMode);
  if (signal.aborted) throw signal.reason;
  if (await fileSha256(attempt.item.source.path) !== attempt.item.source.sha256) throw new Error("Frozen source hash changed");
  switch (attempt.protocol.kind) {
    case "agent": return executeAgent(context);
    case "constraint_render": return executeConstraint(context);
    case "fault_runner": return executeFault(context);
  }
}
async function executeConstraint(c: ExecutionContext): Promise<AttemptResult> {
  const { CONSTRAINT_RECIPES, FIXTURE_DIRECTORY } = await import("../constraint-fixtures");
  const { parsePlan } = await import("../../../src/lib/auto-edit/contract");
  const { renderAutoEdit } = await import("../../../src/lib/auto-edit/render");
  const recipe = CONSTRAINT_RECIPES.find(r => r.id === c.attempt.protocol.recipe);
  if (!recipe || JSON.stringify(recipe.brief) !== JSON.stringify(c.attempt.item.brief)) throw new Error("Frozen constraint recipe changed");
  const output = join(c.directory, "output.mp4");
  const recorder = new AgentEvaluationRecorder({ runId: c.attempt.attemptId, caseId: c.attempt.caseId, datasetVersion: c.session.datasetVersion, prices: {}, ledger: c.ledger, maxRequestCostUsd: c.session.configuration.maxRequestCostUsd, metadata: { evidenceMode: "real_media", paidProviderRequest: false, controlledRenderer: true, syntheticVoiceNotTts: true } });
  const operation = async <T>(tool: string, fn: () => Promise<T>) => { const id = recorder.beginToolExecution({ stage: "controlled_renderer", tool, arguments: {}, origin: "runtime" }); try { const result = await fn(); recorder.completeToolExecution(id, result); return result; } catch (error) { recorder.failToolExecution(id, error); throw error; } };
  const plan = await operation("validate_edit_plan", async () => parsePlan(recipe.plan, recipe.plan.clips[0].sourceId, 30, recipe.brief));
  const voices = recipe.brief.audio === "voiceover" ? await operation("create_voiceover", async () => [{ index: 0, file: join(FIXTURE_DIRECTORY, "voice-880.wav"), duration: 14, text: "TEST" }]) : [];
  await operation("render_edit", async () => { await renderAutoEdit({ source: resolve(c.attempt.item.source.path), plan, brief: recipe.brief, quality: c.attempt.protocol.quality, voices, output, directory: join(c.directory, "render"), speech: [{ start: .5, end: 4.5, text: recipe.speechText ?? "HELLO" }], signal: c.signal }); return { output }; });
  const media = await operation("inspect_output", () => verifyMediaOutput(output, c.attempt.item.checks ?? []));
  if (media.passed) await operation("finish", async () => ({ output, verified: true }));
  recorder.recordOutcome({ state: media.passed ? "done" : "failed", reasonCode: media.passed ? "completed" : "media_checks_failed" });
  const trace = recorder.snapshot(true); await writeFile(join(c.directory, "trace.json"), JSON.stringify(trace, null, 2));
  return { automatic: media.passed ? "passed" : media.checks.some(check => check.status === "failed") ? "failed" : "unknown", trace, evidence: media, outputPath: output };
}
async function executeFault(c: ExecutionContext): Promise<AttemptResult> {
  const proof = join(c.directory, "fault-proof.json");
  // The protocol executes actual persisted runner assertions with fixed responses and isolated SQLite.
  const result = await runMediaProcess(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--config", "tools/agent-eval/vitest.config.ts", "tools/agent-eval/__tests__/fault-runner.test.ts", "-t", `'${c.attempt.protocol.scenario}'$`, "--pool=threads", "--maxWorkers=1"], { signal: c.signal, timeoutMs: c.session.configuration.timeoutMs, env: { ...process.env, MORA_FAULT_EVIDENCE: proof } });
  await writeFile(join(c.directory, "runner.log"), result.stdout + result.stderr);
  const evidence = JSON.parse(await readFile(proof, "utf8")) as { records: Array<{ caseId: string; trace: AttemptResult["trace"]; scores: EvaluationScore[] }> };
  const record = evidence.records.find(r => r.caseId === c.attempt.caseId);
  if (!record || evidence.records.length !== 1) throw new Error("Fault protocol did not execute exactly the requested case");
  return { automatic: verdict(record.scores), trace: record.trace, scores: record.scores, evidence };
}
async function executeAgent(c: ExecutionContext): Promise<AttemptResult> {
  const [{ getDb }, { autoEditRuns, mediaSources, projects }, { getUploadsDir }, { probeMedia }, { startAutoEdit, cancelAutoEdit }, { parseBrief }, { evaluateStoredSession }] = await Promise.all([
    import("../../../src/lib/db"), import("../../../src/lib/db/schema"), import("../../../src/lib/paths"), import("../../../src/lib/media-probe"), import("../../../src/lib/auto-edit/runner"), import("../../../src/lib/auto-edit/contract"), import("../session-results"),
  ]);
  const item = c.attempt.item, projectId = randomUUID(), sourceId = randomUUID(), runId = randomUUID();
  const directory = join(getUploadsDir(), projectId, "imported"), ownedPath = join(directory, basename(item.source.path));
  await mkdir(directory, { recursive: true }); await copyFile(item.source.path, ownedPath);
  const [metadata, sourceStat] = await Promise.all([probeMedia(ownedPath), stat(ownedPath)]);
  if (c.signal.aborted) throw c.signal.reason;
  const timestamp = Date.now(), db = getDb();
  const run = db.transaction(tx => {
    tx.insert(projects).values({ id: projectId, name: `[Eval] ${item.caseId}`, workflowType: "edit", productionMode: "local", targetDuration: item.brief.target, isInternal: true }).run();
    tx.insert(mediaSources).values({ id: sourceId, projectId, originalName: basename(ownedPath), filePath: ownedPath, mimeType: "video/mp4", sizeBytes: sourceStat.size, duration: Math.round(metadata.duration * 1000), width: metadata.width, height: metadata.height, hasAudio: metadata.hasAudio, status: "ready", progress: 100 }).run();
    return tx.insert(autoEditRuns).values({ id: runId, projectId, sourceId, requestKey: createHash("sha256").update(c.attempt.attemptId).digest("hex"), brief: parseBrief({ ...item.brief, promotion: { subject: "素材中的主体", audience: "通用中性表达", sellingPoints: "只使用画面可见事实", action: "无需行动号召" } }), checkpoint: { operation: "auto", history: [], repairs: 0 }, quality: c.attempt.protocol.quality, status: "queued", heartbeat: timestamp, createdAt: timestamp, updatedAt: timestamp }).returning().get();
  });
  const recorder = new AgentEvaluationRecorder({ runId, caseId: item.caseId, datasetVersion: c.session.datasetVersion, prices: c.runtime.prices, ledger: c.ledger, maxRequestCostUsd: c.session.configuration.maxRequestCostUsd, secrets: [c.apiKey], metadata: { evidenceMode: "real_model", provider: c.session.configuration.provider, sourceSha256Verified: true, paidTts: false } });
  const tracePath = join(c.directory, "traces.jsonl");
  const credentials = { llm: { baseUrl: c.runtime.baseUrl, apiKey: c.apiKey, model: c.session.configuration.textModel, visionModel: c.session.configuration.visionModel } };
  const stop = () => { void cancelAutoEdit(runId, projectId); };
  c.signal.addEventListener("abort", stop, { once: true });
  try {
    await new Promise<void>((resolveFinished, reject) => {
      startAutoEdit(run, credentials, { schedule: async fn => fn(), observer: recorder, interactionPolicy: c.attempt.protocol.interactionPolicy, onFinished: async () => { try { await appendEvaluationTraceJsonl(tracePath, recorder.snapshot(true)); resolveFinished(); } catch (error) { reject(error); } } });
      if (c.signal.aborted) stop();
    });
    const results = await evaluateStoredSession({ schemaVersion: 1, sessionId: c.session.sessionId, kind: "calibration", startedAt: c.session.startedAt, datasetId: "mora-agent-regression", datasetVersion: c.session.datasetVersion, evaluatorVersion: "3", textModel: credentials.llm.model, visionModel: credentials.llm.visionModel, prices: c.runtime.prices, stopLimitUsd: c.session.configuration.stopLimitUsd, absoluteLimitUsd: c.session.configuration.stopLimitUsd, maxRequestCostUsd: c.session.configuration.maxRequestCostUsd, runIds: [runId], cases: [item], outputDirectory: c.directory, tracePath });
    const result = results[0]; if (!result) throw new Error("Missing completed runner evidence");
    const { eq } = await import("drizzle-orm"); const { compositions } = await import("../../../src/lib/db/schema");
    const terminal = db.select().from(autoEditRuns).where(eq(autoEditRuns.id, runId)).get();
    const output = terminal?.compositionId ? db.select().from(compositions).where(eq(compositions.id, terminal.compositionId)).get()?.outputPath ?? undefined : undefined;
    return { automatic: verdict(result.scores), scores: result.scores, trace: recorder.snapshot(true), evidence: result, outputPath: output };
  } finally { c.signal.removeEventListener("abort", stop); }
}

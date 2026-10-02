import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { inArray } from "drizzle-orm";
import { getDb } from "../../src/lib/db";
import { autoEditRuns, compositions } from "../../src/lib/db/schema";
import { createHash } from "node:crypto";
import { verifyMediaOutput } from "./media-oracles";
import { scoreDeterministicRun } from "./core/scorers";
import { summarizeEvaluationMetrics } from "./core/metrics";
import type { DeterministicRunFacts, EvaluationTrace } from "./core/types";
import type { StoredEvaluationSession } from "./evaluation-session";

async function traces(path: string) {
  if (!existsSync(path)) return [];
  const raw = (await readFile(path, "utf8")).trim();
  return raw ? raw.split(/\n+/).map(line => JSON.parse(line) as EvaluationTrace) : [];
}

export async function evaluateStoredSession(session: StoredEvaluationSession) {
  const recorded = await traces(session.tracePath);
  if (!recorded.length) return [];
  const db = getDb();
  const runs = await db.select({
    id: autoEditRuns.id, status: autoEditRuns.status, stage: autoEditRuns.stage, error: autoEditRuns.error,
    checkpoint: autoEditRuns.checkpoint, compositionId: autoEditRuns.compositionId,
  }).from(autoEditRuns).where(inArray(autoEditRuns.id, session.runIds));
  const compositionIds = runs.flatMap(run => run.compositionId ? [run.compositionId] : []);
  const compositionRows = compositionIds.length
    ? await db.select({ id: compositions.id, status: compositions.status, outputPath: compositions.outputPath }).from(compositions).where(inArray(compositions.id, compositionIds))
    : [];
  const runById = new Map(runs.map(run => [run.id, run]));
  const compositionById = new Map(compositionRows.map(composition => [composition.id, composition]));
  const caseById = new Map(session.cases.map(item => [item.caseId, item]));
  return Promise.all(recorded.map(async trace => {
    const item = caseById.get(trace.caseId);
    const run = runById.get(trace.runId);
    if (!item || !run) throw new Error(`Evaluation result is incomplete for ${trace.caseId}`);
    const composition = run.compositionId ? compositionById.get(run.compositionId) : undefined;
    const media = await verifyMediaOutput(composition?.outputPath, item.checks ?? [], { outputRequired: (item.expected.behavior ?? "complete") === "complete" });
    const evidenceName = `${createHash("sha256").update(trace.runId).digest("hex")}.json`;
    const evidenceDirectory = join(session.outputDirectory, "media-evidence-v3");
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(join(evidenceDirectory, evidenceName), JSON.stringify(media, null, 2) + "\n", "utf8");
    const actions: DeterministicRunFacts["actions"] = (trace.toolExecutions ?? []).map(action => ({
      tool: action.tool, allowed: true, status: action.status, error: action.error,
      artifactId: action.result && typeof action.result === "object" && "outputId" in action.result && typeof action.result.outputId === "string" ? action.result.outputId : undefined,
    }));
    actions.push(...trace.toolDecisions.filter(action => !action.allowed).map(action => ({ tool: action.tool, allowed: false })));
    const outcome = trace.outcome;
    const renders = actions.filter(action => action.tool === "render_edit").length;
    const facts: DeterministicRunFacts = {
      expectedBehavior: item.expected.behavior ?? "complete",
      expectedReasonCodes: item.expected.reasonCodes,
      observedReasonCode: outcome?.reasonCode,
      behaviorEvidence: Boolean(outcome && outcome.state === run.status),
      evidenceComplete: trace.toolExecutions !== undefined && !trace.metadata.recovered && trace.toolExecutions.every(action => action.status !== "pending") && (media.checks.some(check => check.status === "failed") || !media.checks.some(check => check.status === "unknown")),
      interruption: run.status === "cancelled" ? "cancelled" : run.status === "interrupted" ? "interrupted" : undefined,
      terminalState: run.status, allowedTerminalStates: item.expected.terminalStates,
      compositionExists: Boolean(composition?.status === "done" && media.exists),
      technicalPass: Boolean(run.checkpoint.checks?.technical && media.passed),
      requiredTools: item.expected.requiredTools,
      mustDecode: item.expected.mustDecode,
      mustHaveVideo: item.expected.mustHaveVideo,
      outputDecodes: media.decodes,
      outputHasVideo: media.hasVideo,
      modelCalls: trace.modelCalls.length, maxModelCalls: item.expected.maxModelCalls,
      renders, maxRenders: item.expected.maxRenders, spentUsd: trace.budget.spentUsd,
      stopLimitUsd: trace.budget.stopLimitUsd,
      completionRecorded: run.checkpoint.history?.some(entry => entry.action === "finish") === true,
      actions,
    };
    return {
      expectedBehavior: facts.expectedBehavior,
      mediaEvidencePath: `media-evidence-v3/${evidenceName}`,
      caseId: trace.caseId, runId: trace.runId, terminalState: run.status, stage: run.stage, error: run.error,
      modelCalls: trace.modelCalls.length, maxModelCalls: item.expected.maxModelCalls,
      renders, maxRenders: item.expected.maxRenders, repairs: run.checkpoint.repairs ?? 0,
      output: composition?.outputPath ? { file: basename(composition.outputPath), ...media } : media,
      technicalChecks: run.checkpoint.checks ?? null, cumulativeCostUsd: trace.budget.spentUsd,
      scores: scoreDeterministicRun(facts),
    };
  }));
}

export async function writeStoredSessionReport(session: StoredEvaluationSession, results: Awaited<ReturnType<typeof evaluateStoredSession>>) {
  const passed = results.filter(result => result.scores.find(score => score.name === "task_success")?.score === 1).length;
  const totalCost = results.length ? Math.max(...results.map(result => result.cumulativeCostUsd)) : 0;
  const failed = results.filter(result => result.scores.find(score => score.name === "task_success")?.score === 0);
  const unknown = results.length - passed - failed.length;
  const metrics = summarizeEvaluationMetrics(results);
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  const lines = [
    `# Mora Agent ${session.kind === "calibration" ? `${session.runIds.length} 案例自动评测` : "Holdout Baseline"}报告`, "",
    `- Session：${session.sessionId}`, `- 数据集：${session.datasetId}@${session.datasetVersion}`,
    `- 评测器版本：${session.evaluatorVersion ?? "legacy"}`, `- 评测指纹：${session.evaluationFingerprint ?? "legacy-unversioned"}`,
    `- 文本模型：${session.textModel}`, `- 视觉模型：${session.visionModel}`,
    `- 流程与技术硬门禁通过：${passed}/${session.runIds.length}`, `- 实际模型成本：$${totalCost.toFixed(6)}`,
    `- 停止线 / 绝对上限：$${session.stopLimitUsd.toFixed(2)} / $${session.absoluteLimitUsd.toFixed(2)}`, "",
    "## 汇总指标", "",
    `- 已评价：${metrics.evaluated}；未评价（缺证据/中止）：${metrics.unevaluated}`,
    `- 流程进入终态率：${percent(metrics.completionRate)}`,
    `- 无需补充输入率：${percent(metrics.interactionFreeRate)}`,
    `- 视频技术通过率：${percent(metrics.technicalPassRate)}`,
    `- 工具调用合法率：${percent(metrics.toolValidityRate)}`,
    `- 必需步骤完成率：${percent(metrics.requiredToolsRate)}`,
    `- 成片验证通过率：${percent(metrics.outputVerificationRate)}`,
    `- 执行顺序合规率：${percent(metrics.sequenceComplianceRate)}`,
    `- 效率与预算合规率：${percent(metrics.efficiencyComplianceRate)}`,
    `- 流程与技术硬门禁通过率：${percent(metrics.taskSuccessRate)}`, "",
    "- 本报告为开发案例观测，不将相关案例的通过率解释为独立泛化概率。", "",
    `- 内容事实一致性：未自动判定；人工金标准仅作为独立复核依据，不计入上述通过率。`, "",
    "| Case | 终态 | Calls | Renders | Decode | Video | Technical | Task | 累计成本 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map(result => {
      const task = result.scores.find(score => score.name === "task_success")?.score ?? "未评价";
      return `| ${result.caseId} | ${result.terminalState} | ${result.modelCalls} | ${result.renders} | ${Number(result.output.decodes)} | ${Number(result.output.hasVideo)} | ${Number(Boolean(result.technicalChecks?.technical && result.output.passed))} | ${task} | $${result.cumulativeCostUsd.toFixed(6)} |`;
    }), "", "## 结论", "",
    unknown ? `${unknown} 个案例缺少完整执行证据或已中止，未作成功/失败判断；已确认失败 ${failed.length} 个。` : failed.length ? `评测已完成；${failed.length} 个案例未通过流程或技术门禁：${failed.map(result => result.caseId).join("、")}。内容质量仍需独立复核。` : `全部 ${results.length} 条案例通过流程与技术硬门禁。该结果不代表内容质量通过，仍需使用人工金标准独立复核。`, "",
  ];
  const path = storedReportPath(session);
  await writeFile(path, lines.join("\n"), "utf8");
  return path;
}

export async function readStoredTraces(path: string) {
  return traces(path);
}

/** Rechecking legacy runs writes a separate report, never overwrites their original evidence. */
export function storedReportPath(session: Pick<StoredEvaluationSession, "evaluatorVersion" | "outputDirectory">) {
  return join(session.outputDirectory, session.evaluatorVersion === "3" ? "summary.md" : "summary-rechecked-v3.md");
}

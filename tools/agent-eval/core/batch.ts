import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CostLedger, DEFAULT_EVALUATION_ABSOLUTE_LIMIT_USD, DEFAULT_EVALUATION_STOP_LIMIT_USD } from "./cost-ledger";
import { scoreDeterministicRun } from "./scorers";
import type { AgentEvaluationCase, AgentEvaluationDataset, DeterministicRunFacts, EvaluationScore, EvaluationTrace } from "./types";

export interface EvaluationCaseExecution {
  trace: EvaluationTrace;
  facts: DeterministicRunFacts;
}

export interface EvaluationCaseResult extends EvaluationCaseExecution {
  scores: EvaluationScore[];
}

export interface EvaluationBatchResult {
  datasetId: string;
  datasetVersion: string;
  caseCount: number;
  taskSuccessCount: number;
  spentUsd: number;
  outputDirectory: string;
  results: EvaluationCaseResult[];
}

interface RunEvaluationBatchOptions {
  dataset: AgentEvaluationDataset;
  outputDirectory: string;
  execute: (item: AgentEvaluationCase, ledger: CostLedger) => Promise<EvaluationCaseExecution>;
  stopLimitUsd?: number;
  absoluteLimitUsd?: number;
}

function markdownSummary(dataset: AgentEvaluationDataset, results: EvaluationCaseResult[], ledger: CostLedger) {
  const taskSuccessCount = results.filter(result => result.scores.find(item => item.name === "task_success")?.score === 1).length;
  const annotationsPending = dataset.cases.filter(item => item.annotation.status !== "human-reviewed").length;
  const lines = [
    `# ${dataset.datasetId} ${dataset.version} 评测汇总`,
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    `- 数据集：${dataset.datasetId}@${dataset.version}（${dataset.split}）`,
    `- 案例：${results.length}`,
    `- 流程与技术硬门禁：${taskSuccessCount}/${results.length}`,
    `- 记录成本：$${ledger.snapshot().spentUsd.toFixed(6)}`,
    `- 运行停止线：$${ledger.stopLimitUsd.toFixed(2)}`,
    `- 待人工标注：${annotationsPending}`,
    "",
    "| Case | Flow + technical | Tool | Required | Output | Sequence | Completion | Budget | Cumulative cost (USD) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const result of results) {
    const byName = Object.fromEntries(result.scores.map(item => [item.name, item.score]));
    lines.push(`| ${result.trace.caseId} | ${byName.task_success} | ${byName.tool_validity} | ${byName.required_tools} | ${byName.output_verification} | ${byName.sequence_compliance} | ${byName.completion_honesty} | ${byName.budget_compliance} | ${result.trace.budget.spentUsd.toFixed(6)} |`);
  }
  if (annotationsPending) lines.push("", "本汇总仍有待人工标注案例，不能作为最终内容质量或简历结论。", "");
  return lines.join("\n");
}

export async function runEvaluationBatch(options: RunEvaluationBatchOptions): Promise<EvaluationBatchResult> {
  if (!options.dataset.cases.length) throw new Error(`Dataset ${options.dataset.datasetId} has no cases`);
  const ledger = new CostLedger(options.stopLimitUsd ?? DEFAULT_EVALUATION_STOP_LIMIT_USD, options.absoluteLimitUsd ?? DEFAULT_EVALUATION_ABSOLUTE_LIMIT_USD);
  await mkdir(options.outputDirectory, { recursive: true });
  const resultsPath = join(options.outputDirectory, "results.jsonl");
  const summaryPath = join(options.outputDirectory, "summary.md");
  await writeFile(resultsPath, "", { encoding: "utf8", flag: "wx" });
  const results: EvaluationCaseResult[] = [];
  for (const item of options.dataset.cases) {
    const execution = await options.execute(item, ledger);
    if (execution.trace.caseId !== item.caseId) throw new Error(`Trace case mismatch: expected ${item.caseId}, received ${execution.trace.caseId}`);
    const result = { ...execution, scores: scoreDeterministicRun(execution.facts) };
    results.push(result);
    await appendFile(resultsPath, `${JSON.stringify(result)}\n`, "utf8");
  }
  await writeFile(summaryPath, markdownSummary(options.dataset, results, ledger), { encoding: "utf8", flag: "wx" });
  const taskSuccessCount = results.filter(result => result.scores.find(item => item.name === "task_success")?.score === 1).length;
  return {
    datasetId: options.dataset.datasetId,
    datasetVersion: options.dataset.version,
    caseCount: results.length,
    taskSuccessCount,
    spentUsd: ledger.snapshot().spentUsd,
    outputDirectory: options.outputDirectory,
    results,
  };
}

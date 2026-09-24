import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runEvaluationBatch } from "./core/batch";
import { parseEvaluationDataset } from "./core/dataset";
import { AgentEvaluationRecorder } from "./core/trace";

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length);
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
const datasetName = argument("dataset") ?? "smoke";
if (!new Set(["smoke", "dev"]).has(datasetName)) {
  throw new Error("The zero-cost fixed runner accepts only smoke or dev. Holdout remains sealed until human annotations and the paid-run configuration are frozen.");
}
const datasetPath = join(process.cwd(), "tools", "agent-eval", "datasets", `${datasetName}.json`);
const dataset = parseEvaluationDataset(JSON.parse(readFileSync(datasetPath, "utf8")));
for (const item of dataset.cases) {
  const actual = await sha256(resolve(process.cwd(), item.source.path));
  if (actual !== item.source.sha256) throw new Error(`Source hash mismatch for ${item.caseId}`);
}

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputDirectory = resolve(process.cwd(), argument("output") ?? join("evals", "agent", "results", `fixed-${datasetName}-${timestamp}`));
const result = await runEvaluationBatch({
  dataset,
  outputDirectory,
  execute: async (item, ledger) => {
    const recorder = new AgentEvaluationRecorder({
      runId: `fixed-${randomUUID()}`,
      caseId: item.caseId,
      datasetVersion: dataset.version,
      prices: {
        "fixed-response": {
          inputUsdPerMillionTokens: 0,
          outputUsdPerMillionTokens: 0,
          source: "local deterministic fixture; no provider request",
          effectiveAt: "2026-09-15",
        },
      },
      maxRequestCostUsd: 0.01,
      ledger,
      metadata: {
        mode: "fixed-response",
        paidProviderRequest: false,
        sourceSha256Verified: true,
        annotationStatus: item.annotation.status,
      },
    });
    const modelCall = recorder.beginModelCall({ stage: "agent_action", model: "fixed-response", vision: false, allowedTools: item.expected.requiredTools, estimatedInputTokens: 0, requestedMaxOutputTokens: 128 });
    recorder.completeModelCall(modelCall.id, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    for (const tool of item.expected.requiredTools) {
      recorder.recordToolDecision(modelCall.id, { stage: "agent_action", tool, allowed: true, arguments: { fixture: true } });
    }
    const terminalState = item.expected.terminalStates[0];
    return {
      trace: recorder.snapshot(true),
      facts: {
        terminalState,
        allowedTerminalStates: item.expected.terminalStates,
        compositionExists: true,
        technicalPass: true,
        requiredTools: item.expected.requiredTools,
        mustDecode: item.expected.mustDecode,
        mustHaveVideo: item.expected.mustHaveVideo,
        outputDecodes: true,
        outputHasVideo: true,
        modelCalls: 1,
        maxModelCalls: item.expected.maxModelCalls,
        renders: item.expected.requiredTools.includes("render_edit") ? 1 : 0,
        maxRenders: item.expected.maxRenders,
        spentUsd: recorder.snapshot().budget.spentUsd,
        stopLimitUsd: ledger.stopLimitUsd,
        actions: item.expected.requiredTools.map(tool => ({ tool, allowed: true })),
      },
    };
  },
});

process.stdout.write(`${JSON.stringify({ dataset: `${result.datasetId}@${result.datasetVersion}`, cases: result.caseCount, taskSuccess: result.taskSuccessCount, spentUsd: result.spentUsd, outputDirectory: result.outputDirectory }, null, 2)}\n`);
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

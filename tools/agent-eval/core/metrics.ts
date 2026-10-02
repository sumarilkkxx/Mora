import type { ExpectedBehavior } from "./contracts";
import type { EvaluationScore } from "./types";

export interface EvaluationMetricInput {
  terminalState: string;
  expectedBehavior?: ExpectedBehavior;
  output: { decodes: boolean; hasVideo: boolean; passed?: boolean };
  technicalChecks: { technical?: boolean } | null;
  scores: EvaluationScore[];
}

const rate = (passed: number, total: number) => total ? passed / total : 0;
const passed = (result: EvaluationMetricInput, name: EvaluationScore["name"]) => result.scores.find(score => score.name === name)?.score === 1;

export function wilsonScoreInterval(successes: number, total: number, z = 1.96): [number, number] {
  if (!total) return [0, 0];
  const proportion = successes / total;
  const denominator = 1 + z ** 2 / total;
  const center = (proportion + z ** 2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt(proportion * (1 - proportion) / total + z ** 2 / (4 * total ** 2)) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function summarizeEvaluationMetrics(results: EvaluationMetricInput[]) {
  const total = results.length;
  const evaluatedResults = results.filter(result => result.scores.find(s => s.name === "task_success")?.score != null);
  const evaluated = evaluatedResults.length;
  const group = (behavior: ExpectedBehavior) => {
    const values = evaluatedResults.filter(r => (r.expectedBehavior ?? "complete") === behavior);
    return { evaluated: values.length, passed: values.filter(r => passed(r, "task_success")).length };
  };
  const scoreRate = (name: EvaluationScore["name"]) => {
    const values = results.filter(r => r.scores.find(s => s.name === name)?.score != null);
    return rate(values.filter(r => passed(r, name)).length, values.length);
  };
  return {
    total, evaluated, unevaluated: total - evaluated,
    byBehavior: { complete: group("complete"), request_input: group("request_input"), stop: group("stop") },
    taskSuccessRate: rate(evaluatedResults.filter(result => passed(result, "task_success")).length, evaluated),
    completionRate: rate(results.filter(result => ["done", "needs_review"].includes(result.terminalState)).length, total),
    interactionFreeRate: rate(results.filter(result => result.terminalState !== "waiting_input").length, total),
    technicalPassRate: rate(results.filter(result => Boolean(result.technicalChecks?.technical && result.output.decodes && result.output.hasVideo && result.output.passed !== false)).length, total),
    toolValidityRate: scoreRate("tool_validity"),
    requiredToolsRate: scoreRate("required_tools"),
    outputVerificationRate: scoreRate("output_verification"),
    sequenceComplianceRate: scoreRate("sequence_compliance"),
    efficiencyComplianceRate: scoreRate("budget_compliance"),
  };
}

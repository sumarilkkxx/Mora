import type { EvaluationScore } from "./types";

export interface EvaluationMetricInput {
  terminalState: string;
  output: { decodes: boolean; hasVideo: boolean };
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
  return {
    total,
    taskSuccessRate: rate(results.filter(result => passed(result, "task_success")).length, total),
    completionRate: rate(results.filter(result => ["done", "needs_review"].includes(result.terminalState)).length, total),
    interactionFreeRate: rate(results.filter(result => result.terminalState !== "waiting_input").length, total),
    technicalPassRate: rate(results.filter(result => Boolean(result.technicalChecks?.technical && result.output.decodes && result.output.hasVideo)).length, total),
    toolValidityRate: rate(results.filter(result => passed(result, "tool_validity")).length, total),
    requiredToolsRate: rate(results.filter(result => passed(result, "required_tools")).length, total),
    outputVerificationRate: rate(results.filter(result => passed(result, "output_verification")).length, total),
    sequenceComplianceRate: rate(results.filter(result => passed(result, "sequence_compliance")).length, total),
    efficiencyComplianceRate: rate(results.filter(result => passed(result, "budget_compliance")).length, total),
  };
}

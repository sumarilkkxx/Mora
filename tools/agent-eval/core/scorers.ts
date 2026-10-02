import type { DeterministicRunFacts, EvaluationScore } from "./types";

function score(name: EvaluationScore["name"], passed: boolean | null, detail: string): EvaluationScore {
  return { name, score: passed === null ? null : passed ? 1 : 0, detail };
}
const succeeded = (action: DeterministicRunFacts["actions"][number]) => action.status === "succeeded" && !action.error;

function sequenceCompliance(actions: DeterministicRunFacts["actions"]) {
  let validated = false;
  const rendered = new Set<string>();
  const inspected = new Set<string>();
  for (const action of actions) {
    if (!succeeded(action)) continue;
    const artifact = action.artifactId ?? "legacy-fixed-output";
    if (action.tool === "validate_edit_plan") validated = true;
    if (action.tool === "render_edit") {
      if (!validated) return false;
      rendered.add(artifact);
      inspected.delete(artifact);
    }
    if (action.tool === "inspect_output") {
      if (!rendered.has(artifact)) return false;
      inspected.add(artifact);
    }
    if (action.tool === "finish" && !inspected.has(artifact)) return false;
  }
  return true;
}

export function scoreDeterministicRun(facts: DeterministicRunFacts): EvaluationScore[] {
  const behavior = facts.expectedBehavior ?? "complete";
  const expectedStop = behavior === "stop" && facts.behaviorEvidence && facts.observedReasonCode && facts.expectedReasonCodes?.includes(facts.observedReasonCode);
  const interrupted = facts.interruption && !(facts.interruption === "budget_stopped" && expectedStop);
  const unknown = facts.evidenceComplete === false || Boolean(interrupted);
  const terminalAllowed = facts.allowedTerminalStates.includes(facts.terminalState)
    && (behavior === "complete" ? ["done", "needs_review"].includes(facts.terminalState) : facts.terminalState === (behavior === "stop" ? "failed" : "waiting_input"));
  const toolValidity = facts.actions.every(action => action.allowed);
  const successful = new Set(facts.actions.filter(succeeded).map(action => action.tool));
  const required = facts.requiredTools.every(tool => successful.has(tool));
  const sequence = sequenceCompliance(facts.actions);
  const output = behavior !== "complete" || (facts.compositionExists && facts.technicalPass && (!facts.mustDecode || facts.outputDecodes) && (!facts.mustHaveVideo || facts.outputHasVideo));
  const honest = terminalAllowed && (behavior === "complete" ? output && successful.has("finish") : Boolean(facts.behaviorEvidence && facts.observedReasonCode && facts.expectedReasonCodes?.includes(facts.observedReasonCode)));
  const problems = [
    ...(facts.modelCalls > facts.maxModelCalls ? [`model calls ${facts.modelCalls} exceeded limit ${facts.maxModelCalls}`] : []),
    ...(facts.renders > facts.maxRenders ? [`renders ${facts.renders} exceeded limit ${facts.maxRenders}`] : []),
    ...(facts.spentUsd > facts.stopLimitUsd ? [`cost exceeded stop limit $${facts.stopLimitUsd}`] : []),
  ];
  const budget = problems.length === 0;
  const taskSuccess = terminalAllowed && toolValidity && required && sequence && output && honest && budget;
  return [
    score("task_success", unknown ? null : taskSuccess, unknown ? "not evaluated: interrupted or missing execution evidence" : taskSuccess ? `expected ${behavior} verified` : "one or more required checks failed"),
    score("tool_validity", unknown ? null : toolValidity, "allowed tool selections"),
    score("required_tools", unknown ? null : required, "required tools need successful execution receipts"),
    score("output_verification", behavior !== "complete" || unknown ? null : output, behavior === "complete" ? "verified output checks" : "output not required for this behavior"),
    score("sequence_compliance", unknown ? null : sequence, "successful render and inspection must precede publication of that artifact"),
    score("completion_honesty", unknown ? null : honest, "observed behavior must match expected outcome and evidence"),
    score("budget_compliance", unknown ? null : budget, budget ? "call, render, and dollar limits respected" : problems.join("; ")),
  ];
}

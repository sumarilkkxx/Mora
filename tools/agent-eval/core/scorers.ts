import type { DeterministicRunFacts, EvaluationScore } from "./types";

function score(name: EvaluationScore["name"], passed: boolean, detail: string): EvaluationScore {
  return { name, score: passed ? 1 : 0, detail };
}

function sequenceCompliance(actions: DeterministicRunFacts["actions"]) {
  const tools = actions.map(action => action.tool);
  const plan = tools.indexOf("validate_edit_plan");
  const render = tools.indexOf("render_edit");
  const inspect = tools.indexOf("inspect_output");
  const finish = tools.indexOf("finish");
  if (render >= 0 && (plan < 0 || plan > render)) return false;
  if (inspect >= 0 && (render < 0 || render > inspect)) return false;
  if (finish >= 0 && render >= 0 && (inspect < 0 || inspect > finish)) return false;
  return true;
}

function requiredToolsCompliance(facts: DeterministicRunFacts) {
  const successful = new Set(facts.actions.filter(action => !action.error).map(action => action.tool));
  if (facts.completionRecorded) successful.add("finish");
  return facts.requiredTools.every(tool => successful.has(tool));
}

export function scoreDeterministicRun(facts: DeterministicRunFacts): EvaluationScore[] {
  const terminalAllowed = facts.allowedTerminalStates.includes(facts.terminalState);
  const toolValidity = facts.actions.every(action => action.allowed);
  const requiredToolsValid = requiredToolsCompliance(facts);
  const sequenceValid = sequenceCompliance(facts.actions);
  const successfulFinish = facts.completionRecorded ?? facts.actions.some(action => action.tool === "finish" && !action.error);
  const verifiedOutput = facts.compositionExists
    && facts.technicalPass
    && (!facts.mustDecode || facts.outputDecodes)
    && (!facts.mustHaveVideo || facts.outputHasVideo);
  const completionHonest = !facts.allowedTerminalStates.includes(facts.terminalState)
    ? false
    : verifiedOutput && successfulFinish;
  const budgetProblems = [
    ...(facts.modelCalls > facts.maxModelCalls ? [`model calls ${facts.modelCalls} exceeded limit ${facts.maxModelCalls}`] : []),
    ...(facts.renders > facts.maxRenders ? [`renders ${facts.renders} exceeded limit ${facts.maxRenders}`] : []),
    ...(facts.spentUsd > facts.stopLimitUsd ? [`cost $${facts.spentUsd.toFixed(6)} exceeded stop limit $${facts.stopLimitUsd.toFixed(2)}`] : []),
  ];
  const budgetValid = budgetProblems.length === 0;
  const taskSuccess = terminalAllowed && verifiedOutput && toolValidity && requiredToolsValid && sequenceValid && completionHonest && budgetValid;
  return [
    score("task_success", taskSuccess, taskSuccess ? "all hard gates passed" : "one or more hard gates failed"),
    score("tool_validity", toolValidity, toolValidity ? "all tools were allowed" : "an out-of-stage tool was selected"),
    score("required_tools", requiredToolsValid, requiredToolsValid ? "all required tools completed" : "one or more required tools were not completed"),
    score("output_verification", verifiedOutput, verifiedOutput ? "required output checks passed" : "the required playable video output was not verified"),
    score("sequence_compliance", sequenceValid, sequenceValid ? "required tool order was preserved" : "required tool order was violated"),
    score("completion_honesty", completionHonest, completionHonest ? "completion matched verified output state" : "completion was claimed without verified output"),
    score("budget_compliance", budgetValid, budgetValid ? "call, render, and dollar limits were respected" : budgetProblems.join("; ")),
  ];
}

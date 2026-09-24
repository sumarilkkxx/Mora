import type { AgentEvaluationCase, AgentEvaluationDataset, EvaluationCategory, EvaluationDatasetSplit } from "./types";
import { AUTO_EDIT_MODEL_CALL_LIMIT, AUTO_EDIT_RENDER_LIMIT } from "../../../src/lib/auto-edit/budget";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function number(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} must be one of ${allowed.join(", ")}`);
  return value as T;
}

function strings(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error(`${label} must be an array of strings`);
  return value as string[];
}

function parseCase(value: unknown, index: number): AgentEvaluationCase {
  const input = object(value, `cases[${index}]`);
  const source = object(input.source, `cases[${index}].source`);
  const brief = object(input.brief, `cases[${index}].brief`);
  const expected = object(input.expected, `cases[${index}].expected`);
  const annotation = object(input.annotation, `cases[${index}].annotation`);
  const sha256 = string(source.sha256, `cases[${index}].source.sha256`);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`cases[${index}].source.sha256 must be a lowercase SHA-256`);
  const maxModelCalls = number(expected.maxModelCalls, `cases[${index}].expected.maxModelCalls`);
  const maxRenders = number(expected.maxRenders, `cases[${index}].expected.maxRenders`);
  if (!Number.isInteger(maxModelCalls) || maxModelCalls < 1 || maxModelCalls > AUTO_EDIT_MODEL_CALL_LIMIT) throw new Error(`cases[${index}].expected.maxModelCalls must be an integer from 1 to ${AUTO_EDIT_MODEL_CALL_LIMIT}`);
  if (!Number.isInteger(maxRenders) || maxRenders < 1 || maxRenders > AUTO_EDIT_RENDER_LIMIT) throw new Error(`cases[${index}].expected.maxRenders must be an integer from 1 to ${AUTO_EDIT_RENDER_LIMIT}`);
  return {
    caseId: string(input.caseId, `cases[${index}].caseId`),
    source: {
      id: string(source.id, `cases[${index}].source.id`),
      path: string(source.path, `cases[${index}].source.path`),
      sha256,
      page: string(source.page, `cases[${index}].source.page`),
      author: string(source.author, `cases[${index}].source.author`),
      group: string(source.group, `cases[${index}].source.group`),
      category: oneOf(source.category, ["product", "process", "service", "difficult"] satisfies EvaluationCategory[], `cases[${index}].source.category`),
      preprocessing: oneOf(source.preprocessing, ["none", "remove-silent-audio-stream-copy"] as const, `cases[${index}].source.preprocessing`),
    },
    brief: {
      target: oneOf(brief.target, [15, 20, 25, 30] as const, `cases[${index}].brief.target`),
      aspect: oneOf(brief.aspect, ["9:16", "16:9", "1:1"] as const, `cases[${index}].brief.aspect`),
      audio: oneOf(brief.audio, ["voiceover", "muted"] as const, `cases[${index}].brief.audio`),
      style: oneOf(brief.style, ["auto", "concise", "highlights", "story"] as const, `cases[${index}].brief.style`),
      captions: boolean(brief.captions, `cases[${index}].brief.captions`),
      locale: oneOf(brief.locale, ["zh", "en"] as const, `cases[${index}].brief.locale`),
      instruction: string(brief.instruction, `cases[${index}].brief.instruction`),
    },
    expected: {
      terminalStates: strings(expected.terminalStates, `cases[${index}].expected.terminalStates`).map(state => oneOf(state, ["done", "needs_review"] as const, `cases[${index}].expected.terminalStates`)),
      requiredTools: strings(expected.requiredTools, `cases[${index}].expected.requiredTools`),
      forbiddenBehaviors: strings(expected.forbiddenBehaviors, `cases[${index}].expected.forbiddenBehaviors`),
      maxModelCalls,
      maxRenders,
      mustDecode: boolean(expected.mustDecode, `cases[${index}].expected.mustDecode`),
      mustHaveVideo: boolean(expected.mustHaveVideo, `cases[${index}].expected.mustHaveVideo`),
    },
    annotation: {
      version: string(annotation.version, `cases[${index}].annotation.version`),
      status: oneOf(annotation.status, ["pending-human-review", "human-reviewed"] as const, `cases[${index}].annotation.status`),
      visibleFacts: strings(annotation.visibleFacts, `cases[${index}].annotation.visibleFacts`),
      forbiddenClaims: strings(annotation.forbiddenClaims, `cases[${index}].annotation.forbiddenClaims`),
    },
  };
}

export function parseEvaluationDataset(value: unknown): AgentEvaluationDataset {
  const input = object(value, "dataset");
  const sourceManifest = object(input.sourceManifest, "sourceManifest");
  if (input.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (!Array.isArray(input.cases)) throw new Error("cases must be an array");
  const cases = input.cases.map(parseCase);
  const ids = cases.map(item => item.caseId);
  if (new Set(ids).size !== ids.length) throw new Error("caseId values must be unique within a dataset");
  const sha256 = string(sourceManifest.sha256, "sourceManifest.sha256");
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("sourceManifest.sha256 must be a lowercase SHA-256");
  const split = oneOf(input.split, ["smoke", "dev", "holdout"] satisfies EvaluationDatasetSplit[], "split");
  const independentHoldout = boolean(input.independentHoldout, "independentHoldout");
  const baselineEligible = boolean(input.baselineEligible, "baselineEligible");
  if (split !== "holdout" && independentHoldout) throw new Error("only a holdout dataset can be marked independentHoldout");
  if (split !== "holdout" && baselineEligible) throw new Error("only a holdout dataset can be eligible for a baseline");
  if (baselineEligible && !independentHoldout) throw new Error("a baseline-eligible holdout must be independent");
  return {
    schemaVersion: 1,
    datasetId: string(input.datasetId, "datasetId"),
    version: string(input.version, "version"),
    split,
    independentHoldout,
    baselineEligible,
    sourceManifest: { path: string(sourceManifest.path, "sourceManifest.path"), sha256 },
    cases,
  };
}

export function assertDatasetIsolation(datasets: readonly AgentEvaluationDataset[]) {
  const developmentGroups = new Set(datasets.filter(dataset => dataset.split !== "holdout").flatMap(dataset => dataset.cases.map(item => item.source.group)));
  for (const dataset of datasets.filter(dataset => dataset.split === "holdout" && dataset.independentHoldout)) {
    const leaked = [...new Set(dataset.cases.map(item => item.source.group).filter(group => developmentGroups.has(group)))];
    if (leaked.length) throw new Error(`independent holdout shares source groups with development data: ${leaked.join(", ")}`);
  }
}

export function selectBalancedEvaluationCases(datasets: readonly AgentEvaluationDataset[], perCategory: number) {
  if (!Number.isInteger(perCategory) || perCategory < 1) throw new Error("perCategory must be a positive integer");
  const categories: EvaluationCategory[] = ["product", "process", "service", "difficult"];
  const availableCases = datasets.flatMap(dataset => dataset.cases);
  const selectedCases = categories.flatMap(category => {
    const matches = availableCases.filter(item => item.source.category === category);
    if (matches.length < perCategory) throw new Error(`Evaluation dataset needs at least ${perCategory} ${category} cases`);
    return matches.slice(0, perCategory);
  });
  const caseIds = selectedCases.map(item => item.caseId);
  if (new Set(caseIds).size !== caseIds.length) throw new Error("Selected evaluation case IDs must be unique");
  return selectedCases;
}

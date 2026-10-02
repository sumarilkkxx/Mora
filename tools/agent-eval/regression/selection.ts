import { choice, nonempty, record, REGRESSION_CATEGORIES } from "../core/contracts";
import type { loadRegressionDataset } from "../regression-dataset";
export type RegressionData = Awaited<ReturnType<typeof loadRegressionDataset>>;
export interface Selection { mode: "quick" | "targeted" | "full"; caseIds: string[]; repetitions: Record<string, number>; seed: number }
export interface RunConfiguration { provider: string; textModel: string; visionModel: string; stopLimitUsd: number; maxRequestCostUsd: number; concurrency: number; timeoutMs: number }
export function bounded(value: unknown, min: number, max: number, label: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`Invalid ${label}`);
  return value;
}
function strings(value: unknown, known: readonly string[], label: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== "string" || !known.includes(v))) throw new Error(`Invalid ${label}`);
  return [...new Set(value as string[])];
}
export function selectRegressionCases(data: RegressionData, value: unknown, historicalFailures: string[] = []): Selection {
  const input = record(value, "selection"), mode = choice(input.mode, ["quick", "targeted", "full"], "mode");
  const categories = strings(input.categories, REGRESSION_CATEGORIES, "categories");
  const ids = strings(input.caseIds, data.protocols.caseIds, "caseIds");
  const tags = strings(input.tags, [...new Set(data.dataset.cases.flatMap(c => c.tags ?? []))], "tags");
  if (input.historicalFailures !== undefined && typeof input.historicalFailures !== "boolean") throw new Error("Invalid historicalFailures");
  if (mode !== "targeted" && (categories.length || ids.length || tags.length || input.historicalFailures)) throw new Error("Filters require targeted mode");
  if (mode === "targeted" && !(categories.length || ids.length || tags.length || input.historicalFailures)) throw new Error("Targeted selection requires a filter");
  let caseIds = mode === "quick" ? [...data.protocols.quickCaseIds] : data.dataset.cases.filter(c =>
    (!categories.length || categories.includes(c.category!)) && (!ids.length || ids.includes(c.caseId)) &&
    (!tags.length || tags.some(t => c.tags?.includes(t))) && (!input.historicalFailures || historicalFailures.includes(c.caseId))).map(c => c.caseId);
  if (!caseIds.length) throw new Error("Empty selection");
  const seed = bounded(input.seed ?? 0, 0, 0xffffffff, "seed", true);
  if (seed) {
    let state = seed;
    for (let i = caseIds.length - 1; i > 0; i--) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const j = state % (i + 1); [caseIds[i], caseIds[j]] = [caseIds[j], caseIds[i]]; }
  }
  const repeat = input.repetitions === undefined ? {} : record(input.repetitions, "repetitions");
  if (Object.keys(repeat).some(id => !caseIds.includes(id))) throw new Error("Repetitions require selected cases");
  const repetitions = Object.fromEntries(caseIds.map(id => [id, bounded(repeat[id] ?? 1, 1, 20, "repetitions", true)]));
  caseIds = [...new Set(caseIds)];
  return { mode, caseIds, repetitions, seed };
}
export function parseRunConfiguration(value: unknown): RunConfiguration {
  const input = record(value, "configuration");
  const stopLimitUsd = bounded(input.stopLimitUsd, .001, 100, "stopLimitUsd");
  const maxRequestCostUsd = bounded(input.maxRequestCostUsd, .000001, stopLimitUsd, "maxRequestCostUsd");
  return { provider: nonempty(input.provider, "provider"), textModel: nonempty(input.textModel, "textModel"), visionModel: nonempty(input.visionModel, "visionModel"), stopLimitUsd, maxRequestCostUsd, concurrency: bounded(input.concurrency ?? 2, 1, 4, "concurrency", true), timeoutMs: bounded(input.timeoutMs ?? 900000, 1000, 3600000, "timeoutMs", true) };
}

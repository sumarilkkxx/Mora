import { createHash } from "node:crypto";
import type { AgentEvaluationCase } from "./types";

export const REGRESSION_CATEGORIES = ["product", "process", "service", "difficult", "format_timing", "audio_captions", "recovery", "safe_stop"] as const;
export type RegressionCategory = typeof REGRESSION_CATEGORIES[number];
export type EvidenceMode = "fixed_response" | "real_media" | "real_model";
export type ExpectedBehavior = "complete" | "request_input" | "stop";
export type AutomaticVerdict = "passed" | "failed" | "unknown" | "not_evaluated";
export type AttemptState = "not_started" | "running" | "completed" | "cancelled" | "budget_stopped" | "interrupted";
export interface CheckBase { id: string; rationale: string }
export type MediaCheck = CheckBase & (
  | { kind: "decode" }
  | { kind: "dimensions"; width: number; height: number }
  | { kind: "duration"; seconds: number; toleranceSeconds: number }
  | { kind: "audio"; mode: "present" | "absent" | "silent" | "audible"; thresholdDb?: number }
  | { kind: "audio_match"; atSeconds: number; referencePath: string; referenceSha256: string; referenceAtSeconds: number; seconds: number; maxMeanError: number }
  | { kind: "frame_match"; atSeconds: number; referencePath: string; referenceSha256: string; referenceAtSeconds: number; maxMeanError: number; purpose: "source" | "order" | "trim" | "caption"; region?: { x: number; y: number; width: number; height: number } }
);
export interface FaultConfiguration {
  point: "validate" | "render" | "inspect" | "model";
  occurrence: number;
  effect: "error" | "timeout" | "invalid_result";
  code: string;
}
export interface RegressionFields {
  category: RegressionCategory;
  caseVersion: string;
  tags: string[];
  evidenceMode: EvidenceMode;
  lineage: { sourceFamily: string; origin: "existing" | "synthetic" | "retired_holdout"; parentCaseId?: string; exposure?: string };
  checks: MediaCheck[];
  fixture?: { generator: "ffmpeg"; version: string; seed: number; parameters: Record<string, string> };
  faults?: FaultConfiguration[];
}
export interface EvaluationIdentity { case: string; media: string; evaluator: string; agent: string }
export interface AttemptRecord {
  schemaVersion: 2; attemptId: string; sessionId: string; caseId: string; repetition: number;
  state: AttemptState; automatic: AutomaticVerdict; evidenceMode: EvidenceMode;
  identity: EvaluationIdentity; previousAttemptId?: string; reason?: string;
}
export interface ReferenceSnapshot {
  sessionId: string; selectedAt: string; identities: Record<string, EvaluationIdentity>;
  provider: string; textModel: string; visionModel: string;
  configurationHash: string; budgetUsd: number;
}
export interface RegressionSession {
  schemaVersion: 2; sessionId: string; startedAt: string;
  selection: { mode: "quick" | "targeted" | "full"; caseIds: string[]; repetitions: number; seed: number };
  protocol: ReferenceSnapshot;
  attemptIds: string[]; previousSessionId?: string; referenceSessionId?: string;
}
export interface HumanEvaluation {
  attemptId: string; updatedAt: string; referenceSessionId?: string; referenceSelectedAt?: string;
  verdict: "better" | "same" | "worse" | "usable" | "needs_changes" | "unusable" | "unknown";
  labels: Array<"requirements" | "facts" | "editing_audio" | "captions_copy">;
  severity?: "blocking" | "improvement"; atSeconds?: number; note?: string;
}
export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
export function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
  return value;
}
export function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (!values.includes(value as T)) throw new Error(`${label} is unsupported`);
  return value as T;
}
function finite(value: unknown, min: number, max: number, label: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label} is out of range`);
  return value;
}
function hashString(value: unknown, label: string) {
  const result = nonempty(value, label);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${label} must be SHA-256`);
  return result;
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
export function parseMediaChecks(value: unknown): MediaCheck[] {
  const checks = list(value, "checks").map(raw => {
    const c = record(raw, "check");
    const base = { id: nonempty(c.id, "check.id"), rationale: nonempty(c.rationale, "check.rationale") };
    switch (c.kind) {
      case "decode": return { ...base, kind: c.kind };
      case "dimensions": return { ...base, kind: c.kind, width: finite(c.width, 1, 16384, "width", true), height: finite(c.height, 1, 16384, "height", true) };
      case "duration": return { ...base, kind: c.kind, seconds: finite(c.seconds, 0.001, 3600, "seconds"), toleranceSeconds: finite(c.toleranceSeconds, 0, 10, "tolerance") };
        case "audio": return { ...base, kind: c.kind, mode: choice(c.mode, ["present", "absent", "silent", "audible"], "audio mode"), ...(c.thresholdDb === undefined ? {} : { thresholdDb: finite(c.thresholdDb, -120, 0, "thresholdDb") }) };
      case "audio_match": return { ...base, kind: c.kind, atSeconds: finite(c.atSeconds, 0, 3600, "atSeconds"), referencePath: nonempty(c.referencePath, "referencePath"), referenceSha256: hashString(c.referenceSha256, "referenceSha256"), referenceAtSeconds: finite(c.referenceAtSeconds, 0, 3600, "referenceAtSeconds"), seconds: finite(c.seconds, .01, 10, "audio sample seconds"), maxMeanError: finite(c.maxMeanError, 0, 1, "audio mean error") };
      case "frame_match": {
        const r = c.region === undefined ? undefined : record(c.region, "region");
        return { ...base, kind: c.kind, atSeconds: finite(c.atSeconds, 0, 3600, "atSeconds"), referencePath: nonempty(c.referencePath, "referencePath"), referenceSha256: hashString(c.referenceSha256, "referenceSha256"), referenceAtSeconds: finite(c.referenceAtSeconds, 0, 3600, "referenceAtSeconds"), maxMeanError: finite(c.maxMeanError, 0, 30, "maxMeanError"), purpose: choice(c.purpose, ["source", "order", "trim", "caption"], "purpose"), ...(r ? { region: { x: finite(r.x, 0, 16384, "x", true), y: finite(r.y, 0, 16384, "y", true), width: finite(r.width, 1, 16384, "width", true), height: finite(r.height, 1, 16384, "height", true) } } : {}) };
      }
      default: throw new Error("Unsupported media check");
    }
  });
  if (new Set(checks.map(c => c.id)).size !== checks.length) throw new Error("check IDs must be unique");
  return checks as MediaCheck[];
}
export function parseRegressionFields(input: Record<string, unknown>): RegressionFields {
  const lineage = record(input.lineage, "lineage");
  const result: RegressionFields = {
    category: choice(input.category, REGRESSION_CATEGORIES, "category"), caseVersion: nonempty(input.caseVersion, "caseVersion"),
    tags: list(input.tags, "tags").map(tag => nonempty(tag, "tag")),
    evidenceMode: choice(input.evidenceMode, ["fixed_response", "real_media", "real_model"], "evidenceMode"),
    lineage: { sourceFamily: nonempty(lineage.sourceFamily, "sourceFamily"), origin: choice(lineage.origin, ["existing", "synthetic", "retired_holdout"], "origin"), ...(lineage.parentCaseId === undefined ? {} : { parentCaseId: nonempty(lineage.parentCaseId, "parentCaseId") }), ...(lineage.exposure === undefined ? {} : { exposure: nonempty(lineage.exposure, "exposure") }) },
    checks: parseMediaChecks(input.checks),
  };
  if (result.lineage.origin === "retired_holdout" && !result.lineage.exposure) throw new Error("retired Holdout requires exposure history");
  if (input.fixture !== undefined) {
    const f = record(input.fixture, "fixture");
    result.fixture = { generator: choice(f.generator, ["ffmpeg"], "generator"), version: nonempty(f.version, "fixture version"), seed: finite(f.seed, 0, Number.MAX_SAFE_INTEGER, "seed", true), parameters: Object.fromEntries(Object.entries(record(f.parameters, "parameters")).map(([k, v]) => [k, nonempty(v, k)])) };
  }
  if (result.lineage.origin === "synthetic" && !result.fixture) throw new Error("synthetic source requires fixture provenance");
  if (input.faults !== undefined) result.faults = list(input.faults, "faults").map(raw => {
    const f = record(raw, "fault");
    return { point: choice(f.point, ["validate", "render", "inspect", "model"], "fault point"), occurrence: finite(f.occurrence, 1, 100, "occurrence", true), effect: choice(f.effect, ["error", "timeout", "invalid_result"], "fault effect"), code: nonempty(f.code, "fault code") };
  });
  return result;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function caseFingerprints(item: AgentEvaluationCase, versions: { agent: string; evaluator: string }): EvaluationIdentity {
  const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
  return { case: hash({ caseId: item.caseId, version: item.caseVersion, brief: item.brief, expected: item.expected, checks: item.checks, faults: item.faults }), media: hash({ source: item.source.sha256, fixture: item.fixture, references: item.checks?.filter(c => c.kind === "frame_match" || c.kind === "audio_match").map(c => c.referenceSha256) }), ...versions };
}
/** Pure read adapter: absent execution receipts remain absent; disk history is untouched. */
export function adaptLegacyTrace<T extends { schemaVersion: number; toolExecutions?: unknown[] }>(trace: T) {
  return { ...structuredClone(trace), toolExecutions: structuredClone(trace.toolExecutions ?? []), executionEvidence: trace.toolExecutions === undefined ? "unavailable" as const : "recorded" as const };
}

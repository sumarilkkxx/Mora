import { readFile } from "node:fs/promises";
import { parseEvaluationDataset } from "./core/dataset";
import { choice, nonempty, record, REGRESSION_CATEGORIES, type EvidenceMode } from "./core/contracts";
import type { AgentEvaluationCase, AgentEvaluationDataset } from "./core/types";
import { fileSha256 } from "./real-sources";

export interface CaseProtocol {
  caseId: string; kind: "agent" | "constraint_render" | "fault_runner";
  supportedEvidenceModes: EvidenceMode[]; quality: "720p";
  interactionPolicy: "autonomous" | "interactive";
  recipe?: string; scenario?: string; command: string;
}
export interface RegressionProtocols {
  version: string; caseIds: string[]; quickCaseIds: string[];
  manifestFiles: Array<{ path: string; sha256: string }>; cases: CaseProtocol[];
}
function strings(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map(v => nonempty(v, label));
}
export function parseRegressionProtocols(value: unknown, dataset: AgentEvaluationDataset): RegressionProtocols {
  const input = record(value, "protocols");
  const caseIds = strings(input.caseIds, "caseIds"), quickCaseIds = strings(input.quickCaseIds, "quickCaseIds");
  if (caseIds.length !== 64 || new Set(caseIds).size !== 64 || JSON.stringify(caseIds) !== JSON.stringify(dataset.cases.map(c => c.caseId))) throw new Error("Frozen selection must match all 64 manifest cases in order");
  for (const category of REGRESSION_CATEGORIES) if (dataset.cases.filter(c => c.category === category).length !== 8) throw new Error(`Expected exactly eight ${category} cases`);
  if (quickCaseIds.length !== 8 || new Set(quickCaseIds).size !== 8 || quickCaseIds.some(id => !caseIds.includes(id))) throw new Error("Quick selection needs eight unique known representatives");
  if (new Set(quickCaseIds.map(id => dataset.cases.find(c => c.caseId === id)!.category)).size !== 8) throw new Error("Quick representatives must cover all eight categories");
  if (!Array.isArray(input.cases) || input.cases.length !== 64) throw new Error("Each case needs an executable protocol");
  const cases: CaseProtocol[] = input.cases.map(raw => {
    const p = record(raw, "case protocol");
    const result: CaseProtocol = {
      caseId: nonempty(p.caseId, "caseId"), kind: choice(p.kind, ["agent", "constraint_render", "fault_runner"], "protocol kind"),
      supportedEvidenceModes: strings(p.supportedEvidenceModes, "evidence modes").map(m => choice(m, ["fixed_response", "real_media", "real_model"], "evidence mode")),
      quality: choice(p.quality, ["720p"], "quality"), interactionPolicy: choice(p.interactionPolicy, ["autonomous", "interactive"], "interaction policy"),
      command: nonempty(p.command, "protocol command"),
      ...(p.recipe === undefined ? {} : { recipe: nonempty(p.recipe, "recipe") }), ...(p.scenario === undefined ? {} : { scenario: nonempty(p.scenario, "scenario") }),
    };
    const item = dataset.cases.find(c => c.caseId === result.caseId);
    if (!item || !result.supportedEvidenceModes.includes(item.evidenceMode!)) throw new Error("Unknown case or unsupported default evidence mode");
    if (result.kind === "constraint_render" && (!result.recipe || item.fixture?.parameters.recipe !== result.recipe)) throw new Error("Missing or mismatched render recipe");
    if (result.kind === "fault_runner" && (!result.scenario || item.fixture?.parameters.recipe !== result.scenario)) throw new Error("Missing or mismatched fault scenario");
    if (item.expected.behavior === "request_input" && result.interactionPolicy !== "interactive") throw new Error("Necessary-input cases require the request_input tool");
    return result;
  });
  if (new Set(cases.map(c => c.caseId)).size !== 64) throw new Error("Duplicate case protocols");
  if (!Array.isArray(input.manifestFiles) || input.manifestFiles.length !== 3) throw new Error("Expected three frozen component manifests");
  const manifestFiles = input.manifestFiles.map(raw => {
    const m = record(raw, "manifest file"), sha256 = nonempty(m.sha256, "manifest hash");
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid manifest SHA-256");
    return { path: nonempty(m.path, "manifest path"), sha256 };
  });
  if (new Set(manifestFiles.map(m => m.path)).size !== 3) throw new Error("Duplicate component manifests");
  return { version: nonempty(input.version, "protocol version"), caseIds, quickCaseIds, manifestFiles, cases };
}
export async function loadRegressionDataset() {
  const dataset = parseEvaluationDataset(JSON.parse(await readFile("tools/agent-eval/datasets/regression.json", "utf8")));
  if (dataset.schemaVersion !== 2 || dataset.split !== "dev" || dataset.baselineEligible || dataset.independentHoldout) throw new Error("Regression is exposed schema-v2 development data");
  if (await fileSha256(dataset.sourceManifest.path) !== dataset.sourceManifest.sha256) throw new Error("Protocol manifest hash mismatch");
  const protocols = parseRegressionProtocols(JSON.parse(await readFile(dataset.sourceManifest.path, "utf8")), dataset);
  const components: AgentEvaluationCase[] = [];
  for (const manifest of protocols.manifestFiles) {
    if (await fileSha256(manifest.path) !== manifest.sha256) throw new Error(`Component manifest hash mismatch: ${manifest.path}`);
    const data = parseEvaluationDataset(JSON.parse(await readFile(manifest.path, "utf8")));
    if (await fileSha256(data.sourceManifest.path) !== data.sourceManifest.sha256) throw new Error(`Source manifest hash mismatch: ${data.sourceManifest.path}`);
    components.push(...data.cases);
  }
  if (JSON.stringify(components) !== JSON.stringify(dataset.cases)) throw new Error("Combined cases differ from the frozen components");
  const ids = new Set(dataset.cases.map(c => c.caseId));
  for (const item of dataset.cases) {
    if (item.lineage?.origin === "synthetic" && !ids.has(item.lineage.parentCaseId!)) throw new Error(`Missing parent: ${item.caseId}`);
    if (await fileSha256(item.source.path) !== item.source.sha256) throw new Error(`Source hash mismatch: ${item.caseId}`);
    for (const check of item.checks ?? []) if ((check.kind === "frame_match" || check.kind === "audio_match") && await fileSha256(check.referencePath) !== check.referenceSha256) throw new Error(`Oracle hash mismatch: ${item.caseId}/${check.id}`);
  }
  return { dataset, protocols };
}

export function assertProtocolEvidenceMode(protocol: CaseProtocol, mode: EvidenceMode) {
  if (!protocol.supportedEvidenceModes.includes(mode)) throw new Error(`${protocol.caseId} supports only ${protocol.supportedEvidenceModes.join(", ")}; requested ${mode}. No implicit substitution or paid request.`);
}

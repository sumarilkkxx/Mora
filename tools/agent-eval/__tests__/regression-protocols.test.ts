import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEvaluationDataset, assertDatasetIsolation } from "../core/dataset";
import { parseRegressionProtocols, loadRegressionDataset, assertProtocolEvidenceMode } from "../regression-dataset";
import { FaultAdapter } from "../fault-adapter";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const data = () => parseEvaluationDataset(read("tools/agent-eval/datasets/regression.json"));
const protocols = () => read("tools/agent-eval/datasets/regression-protocols.json");
describe("frozen 64-case development regression protocol", () => {
  it("preflights all component, source and oracle identities with balanced quick representatives", async () => {
    const { dataset, protocols } = await loadRegressionDataset();
    expect(dataset.cases).toHaveLength(64);
    expect(protocols.quickCaseIds).toHaveLength(8);
    expect(protocols.cases.filter(c => c.kind === "agent")).toHaveLength(32);
    expect(protocols.cases.filter(c => c.kind === "constraint_render")).toHaveLength(16);
    expect(protocols.cases.filter(c => c.kind === "fault_runner")).toHaveLength(16);
    expect(dataset.cases.filter(c => c.category === "recovery")).toHaveLength(8);
    expect(dataset.cases.filter(c => c.category === "safe_stop")).toHaveLength(8);
  });
  it.each(["duplicate_protocol", "bad_quick", "missing_scenario", "missing_recipe", "wrong_mode", "wrong_order", "wrong_category", "request_blocked", "duplicate_component"])("rejects %s", name => {
    const raw = protocols(), dataset = data();
    if (name === "duplicate_protocol") raw.cases[1] = raw.cases[0];
    if (name === "bad_quick") raw.quickCaseIds[1] = raw.quickCaseIds[0];
    if (name === "missing_scenario") delete raw.cases[48].scenario;
    if (name === "missing_recipe") delete raw.cases[32].recipe;
    if (name === "wrong_mode") raw.cases[48].supportedEvidenceModes = ["real_model"];
    if (name === "wrong_order") raw.caseIds.reverse();
    if (name === "wrong_category") dataset.cases[0].category = "process";
    if (name === "request_blocked") raw.cases[62].interactionPolicy = "autonomous";
    if (name === "duplicate_component") raw.manifestFiles[1] = raw.manifestFiles[0];
    expect(() => parseRegressionProtocols(raw, dataset)).toThrow();
  });
  it("never substitutes fixed responses for paid evidence and preserves sealed-source isolation", () => {
    const parsed = parseRegressionProtocols(protocols(), data());
    expect(() => assertProtocolEvidenceMode(parsed.cases[0], "real_model")).not.toThrow();
    expect(() => assertProtocolEvidenceMode(parsed.cases[48], "real_model")).toThrow(/No implicit substitution/);
    const old = parseEvaluationDataset(read("tools/agent-eval/datasets/holdout.json"));
    expect(old.baselineEligible).toBe(false);
    expect(() => assertDatasetIsolation([data()])).not.toThrow();
    // Legacy independence is a historical label. Its exposed groups must still fail a sealed-data check.
    expect(() => assertDatasetIsolation([data(), old])).toThrow(/shares source groups/);
    expect(() => assertDatasetIsolation([data(), { ...old, independentHoldout: true, baselineEligible: true }])).toThrow(/shares source groups/);
  });
});
describe("tool-side fault adapter", () => {
  it("triggers once at the configured boundary and really calls the operation again on retry", async () => {
    let calls = 0;
    const a = new FaultAdapter([{ point: "render", occurrence: 2, effect: "error", code: "fixture" }]);
    const operation = async () => ++calls;
    expect(await a.invoke("render", operation)).toBe(1);
    await expect(a.invoke("render", operation)).rejects.toThrow("fixture");
    expect(await a.invoke("render", operation)).toBe(2);
    a.assertTriggered(); expect(a.triggered).toHaveLength(1);
  });
  it("rejects missing and untriggered fault implementations", async () => {
    const a = new FaultAdapter([{ point: "inspect", occurrence: 1, effect: "invalid_result", code: "malformed" }]);
    expect(() => a.assertTriggered()).toThrow();
    await expect(a.invoke("inspect", async () => 1)).rejects.toThrow(/Missing invalid-result/);
  });
});

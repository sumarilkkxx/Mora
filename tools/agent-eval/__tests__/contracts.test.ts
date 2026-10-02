import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEvaluationDataset } from "../core/dataset";
import { adaptLegacyTrace, caseFingerprints, REGRESSION_CATEGORIES } from "../core/contracts";

const legacy = JSON.parse(readFileSync("tools/agent-eval/datasets/smoke.json", "utf8"));
const modern = () => ({ ...structuredClone(legacy), schemaVersion: 2, cases: REGRESSION_CATEGORIES.map((category, index) => ({
  ...structuredClone(legacy.cases[0]), caseId: `case-${index}`, category, caseVersion: "1", tags: [category],
  evidenceMode: "real_media", lineage: { sourceFamily: "family", origin: "existing" },
  expected: { ...legacy.cases[0].expected, behavior: "complete", reasonCodes: [] },
  checks: [{ id: "decode", kind: "decode", rationale: "Full output must decode" }],
})) });

describe("versioned regression contracts", () => {
  it("reads eight categories, original audio and distinct expected outcomes", () => {
    const data = modern(); data.cases[0].brief.audio = "original";
    data.cases[6].expected = { ...data.cases[6].expected, behavior: "request_input", terminalStates: ["waiting_input"], reasonCodes: ["missing_requirement"], mustDecode: false, mustHaveVideo: false };
    data.cases[7].expected = { ...data.cases[7].expected, behavior: "stop", terminalStates: ["failed"], reasonCodes: ["invalid_media"], mustDecode: false, mustHaveVideo: false };
    const parsed = parseEvaluationDataset(data);
    expect(parsed.cases.map(c => c.category)).toEqual(REGRESSION_CATEGORIES);
    expect(parsed.cases[0].brief.audio).toBe("original");
    expect(parsed.cases[7].expected.behavior).toBe("stop");
  });
  it.each(["duplicate", "missing_source", "fault", "tolerance", "missing_reason", "unknown_check"])("rejects %s", variant => {
    const data = modern();
    if (variant === "duplicate") data.cases[1].caseId = data.cases[0].caseId;
    if (variant === "missing_source") data.cases[0].source.path = "";
    if (variant === "fault") Object.assign(data.cases[0], { faults: [{ point: "unknown", occurrence: 1, effect: "error", code: "fixture" }] });
    if (variant === "tolerance") data.cases[0].checks = [{ id: "duration", kind: "duration", rationale: "test", seconds: 15, toleranceSeconds: -1 }];
    if (variant === "missing_reason") data.cases[0].expected.behavior = "stop";
    if (variant === "unknown_check") data.cases[0].checks[0].kind = "magic";
    expect(() => parseEvaluationDataset(data)).toThrow();
  });
  it("reads legacy manifests unchanged and never upgrades decisions into executions", () => {
    expect(parseEvaluationDataset(legacy)).toEqual(legacy);
    const trace = { schemaVersion: 1, toolDecisions: [{ tool: "finish" }], metadata: { recovered: true } };
    const before = JSON.stringify(trace);
    expect(adaptLegacyTrace(trace)).toMatchObject({ toolExecutions: [], executionEvidence: "unavailable" });
    expect(JSON.stringify(trace)).toBe(before);
  });
  it("separates case, media, evaluator and agent identities", () => {
    const item = parseEvaluationDataset(modern()).cases[0];
    const a = caseFingerprints(item, { agent: "code-a", evaluator: "eval-a" });
    const b = caseFingerprints(item, { agent: "code-b", evaluator: "eval-a" });
    expect(b).toEqual({ ...a, agent: "code-b" });
    expect(caseFingerprints({ ...item, brief: { ...item.brief, captions: !item.brief.captions } }, { agent: "code-a", evaluator: "eval-a" }).case).not.toBe(a.case);
  });
});

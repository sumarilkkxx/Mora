import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEvaluationDataset } from "../core/dataset";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
describe("real regression development pool", () => {
  it("has 32 unique base sources and eight cases per natural category", () => {
    const dataset = parseEvaluationDataset(read("tools/agent-eval/datasets/regression-base.json"));
    expect(dataset.schemaVersion).toBe(2);
    expect(dataset.split).toBe("dev");
    expect(dataset.independentHoldout || dataset.baselineEligible).toBe(false);
    expect(dataset.cases).toHaveLength(32);
    expect(new Set(dataset.cases.map(c => c.source.id)).size).toBe(32);
    for (const category of ["product", "process", "service", "difficult"]) expect(dataset.cases.filter(c => c.category === category)).toHaveLength(8);
    expect(dataset.cases.filter(c => c.lineage?.origin === "retired_holdout")).toHaveLength(8);
    for (const c of dataset.cases) {
      expect(c.annotation.status).toBe("pending-human-review");
      expect(c.annotation.visibleFacts).toEqual([]);
      expect(c.checks?.some(c => c.kind === "decode")).toBe(true);
      expect(c.lineage?.sourceFamily).toBe(c.source.group);
    }
  });
  it("retains every legacy case through lineage without changing Holdout eligibility", () => {
    const dataset = parseEvaluationDataset(read("tools/agent-eval/datasets/regression-base.json"));
    for (const split of ["smoke", "dev", "holdout"]) {
      const legacy = parseEvaluationDataset(read(`tools/agent-eval/datasets/${split}.json`));
      for (const item of legacy.cases) expect(dataset.cases.find(c => c.lineage?.parentCaseId === item.caseId)?.source).toEqual(item.source);
    }
    expect(read("tools/agent-eval/datasets/holdout.json").baselineEligible).toBe(false);
  });
});

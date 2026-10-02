import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEvaluationDataset } from "../core/dataset";
import { parseMediaChecks } from "../core/contracts";

describe("controlled constraint regression cases", () => {
  it("defines 16 unique cases with reproducible source and output rules", () => {
    const dataset = parseEvaluationDataset(JSON.parse(readFileSync("tools/agent-eval/datasets/regression-constraints.json", "utf8")));
    expect(dataset.cases).toHaveLength(16);
    for (const category of ["format_timing", "audio_captions"]) expect(dataset.cases.filter(c => c.category === category)).toHaveLength(8);
    expect(new Set(dataset.cases.map(c => c.source.id)).size).toBeLessThan(16);
    for (const item of dataset.cases) {
      expect(item.lineage?.origin).toBe("synthetic");
      expect(item.lineage?.parentCaseId).toBeTruthy();
      expect(item.fixture?.parameters).toHaveProperty("recipe");
      expect(item.checks?.length).toBeGreaterThan(1);
      expect(item.evidenceMode).toBe("real_media");
    }
    const kinds = dataset.cases.flatMap(c => c.checks?.map(c => c.kind) ?? []);
    expect(kinds).toContain("audio_match");
    expect(kinds).toContain("frame_match");
  });
  it("rejects invalid audio sample bounds and tolerances", () => {
    const rule = { id: "audio", kind: "audio_match", rationale: "known source waveform", referencePath: "source.wav", referenceSha256: "a".repeat(64), atSeconds: 0, referenceAtSeconds: 0, seconds: 1, maxMeanError: .01 };
    expect(parseMediaChecks([rule])).toEqual([rule]);
    for (const patch of [{ seconds: 0 }, { seconds: 11 }, { maxMeanError: -1 }, { atSeconds: -1 }]) expect(() => parseMediaChecks([{ ...rule, ...patch }])).toThrow();
  });
});

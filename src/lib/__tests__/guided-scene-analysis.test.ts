import { describe, expect, it } from "vitest";
import { sceneRangesFromTimestamps } from "@/lib/guided-scene-analysis";

describe("guided scene analysis", () => {
  it("drops near-duplicate cuts and splits long scenes", () => {
    const ranges = sceneRangesFromTimestamps([0.2, 3, 3.2, 15], 20);
    expect(ranges[0]).toEqual({ start: 0, end: 3 });
    expect(ranges.every((range) => range.end - range.start <= 8)).toBe(true);
    expect(ranges.at(-1)?.end).toBe(20);
  });

  it("caps pathological footage at a bounded scene count", () => {
    const cuts = Array.from({ length: 400 }, (_, index) => index + 1);
    expect(sceneRangesFromTimestamps(cuts, 410).length).toBeLessThanOrEqual(120);
  });
});

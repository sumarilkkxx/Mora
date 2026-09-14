import { describe, expect, it } from "vitest";
import { estimateVideoSpend, resolutionCostMultiplier, resolveVideoSpendCap } from "@/lib/video-spend";

describe("video spend guard", () => {
  it("prices Atlas base rates at the effective resolution tier", () => {
    expect(resolutionCostMultiplier("480p")).toBe(1);
    expect(resolutionCostMultiplier("720p")).toBe(2);
    expect(resolutionCostMultiplier("1080p")).toBe(4.5);
    expect(estimateVideoSpend(0.134, 30, "1080p")).toMatchObject({
      baseUsd: 4.02,
      maxUsd: 18.09,
      tierMultiplier: 4.5,
    });
  });

  it("includes every paid call in a batch total", () => {
    expect(estimateVideoSpend(0.134, 5, "720p", 6)?.maxUsd).toBe(8.04);
  });

  it("keeps an unpublished price unknown", () => {
    expect(estimateVideoSpend(undefined, 5, "720p")).toBeUndefined();
  });

  it("keeps the five-dollar guard active when a caller omits or corrupts the cap", () => {
    expect(resolveVideoSpendCap(undefined)).toBe(5);
    expect(resolveVideoSpendCap("invalid")).toBe(5);
    expect(resolveVideoSpendCap(0)).toBe(0);
    expect(resolveVideoSpendCap(12.5)).toBe(12.5);
  });
});

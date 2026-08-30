import { describe, expect, it } from "vitest";
import { normalizeVideoOptionsForModel } from "@/lib/normalize-video-options";

describe("normalizeVideoOptionsForModel", () => {
  it("maps a cinematic profile to Atlas Seedance 2.5 before paid submission", () => {
    const result = normalizeVideoOptionsForModel(
      "bytedance/seedance-2.5/image-to-video",
      { width: 1080, height: 1920, duration: 8 },
      true,
    );

    expect(result.options).toMatchObject({ width: 720, height: 1280, duration: 8 });
    expect(result.adjustments).toContainEqual(expect.objectContaining({ field: "resolution", effective: "720p" }));
    expect(result.allowLastFrame).toBe(true);
  });

  it("uses the nearest supported duration for a known model", () => {
    const result = normalizeVideoOptionsForModel(
      "google/veo3.1/image-to-video",
      { width: 1080, height: 1920, duration: 5 },
      true,
    );

    expect(result.options.duration).toBe(4);
    expect(result.adjustments).toContainEqual(expect.objectContaining({ field: "duration", requested: 5, effective: 4 }));
  });

  it("leaves unknown model values permissive", () => {
    const result = normalizeVideoOptionsForModel(
      "vendor/custom-video",
      { width: 1920, height: 1080, duration: 11, seed: 42 },
      false,
    );

    expect(result.options).toMatchObject({ width: 1920, height: 1080, duration: 11, seed: 42 });
    expect(result.adjustments).toHaveLength(0);
  });
});

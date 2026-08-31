import { describe, expect, it } from "vitest";
import { fitGeneratedScriptToTargetDuration, type GeneratedScript } from "./script-engine/generator";
import { normalizeTargetVideoDuration } from "./target-video-duration";

function scriptWithDurations(durations: number[]): GeneratedScript {
  return {
    title: "duration test",
    styleType: "custom",
    totalDuration: durations.reduce((sum, duration) => sum + duration, 0),
    shots: durations.map((duration, index) => ({
      shotId: index + 1,
      type: index === 0 ? "hook" : "demo",
      duration,
      description: `shot ${index + 1}`,
      camera: "static",
      visualSource: "ai_generate",
      transition: "ai_start_end",
      voiceover: `line ${index + 1}`,
    })),
  };
}

describe("target video duration", () => {
  it("defaults invalid values to 15 seconds and maps values to the closest creator preset", () => {
    expect(normalizeTargetVideoDuration(undefined)).toBe(15);
    expect(normalizeTargetVideoDuration(18)).toBe(20);
    expect(normalizeTargetVideoDuration(27)).toBe(25);
  });

  it.each([15, 20, 25, 30])("fits storyboard shots exactly to %s seconds", (target) => {
    const fitted = fitGeneratedScriptToTargetDuration(scriptWithDurations([3, 5, 5, 6, 5, 6]), target);
    const total = fitted.shots.reduce((sum, shot) => sum + shot.duration, 0);
    expect(total).toBe(target);
    expect(fitted.totalDuration).toBe(target);
    expect(fitted.shots.every((shot) => shot.duration > 0)).toBe(true);
  });
});

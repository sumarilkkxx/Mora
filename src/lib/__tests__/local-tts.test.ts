import { describe, expect, it } from "vitest";
import { localVoiceExtension, systemVoiceRateFromMultiplier } from "@/lib/local-tts";

describe("local system voice", () => {
  it("uses an audio container supported by each desktop platform", () => {
    expect(localVoiceExtension("win32")).toBe(".wav");
    expect(localVoiceExtension("linux")).toBe(".wav");
    expect(localVoiceExtension("darwin")).toBe(".aiff");
  });

  it("maps narration multipliers to bounded system voice rates", () => {
    expect(systemVoiceRateFromMultiplier(0.75)).toBe(-1);
    expect(systemVoiceRateFromMultiplier(1)).toBe(0);
    expect(systemVoiceRateFromMultiplier(1.5)).toBe(3);
    expect(systemVoiceRateFromMultiplier(99)).toBe(3);
  });
});

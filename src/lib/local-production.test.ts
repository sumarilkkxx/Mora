import { describe, expect, it } from "vitest";
import type { GeneratedScript } from "@/lib/script-engine/generator";
import { bindProductImageToLocalShots } from "./local-production";

const sample: GeneratedScript[] = [
  {
    title: "A",
    styleType: "pain_point",
    totalDuration: 3,
    shots: [
      {
        shotId: 1,
        type: "hook",
        duration: 3,
        description: "AI-only visual direction",
        camera: "slow zoom",
        visualSource: "ai_generate",
        transition: "direct_concat",
        voiceover: "Hello",
      },
    ],
  },
];

describe("local production script preparation", () => {
  it("binds every local shot to the existing product image without dropping AI metadata", () => {
    const result = bindProductImageToLocalShots(sample, "local", true);

    expect(result[0].shots[0].visualSource).toBe("product_image");
    expect(result[0].shots[0].description).toBe("AI-only visual direction");
    expect(result).not.toBe(sample);
  });

  it("does not rewrite AI projects or projects without a product image", () => {
    expect(bindProductImageToLocalShots(sample, "ai", true)).toBe(sample);
    expect(bindProductImageToLocalShots(sample, "local", false)).toBe(sample);
  });
});

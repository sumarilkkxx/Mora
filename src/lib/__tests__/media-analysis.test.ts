import { describe, expect, it } from "vitest";
import { parseMediaAnalysis } from "@/lib/media-analysis";

describe("parseMediaAnalysis", () => {
  it("parses fenced JSON and clamps arrays/text", () => {
    const raw = `\`\`\`json
    {"summary":"  竖屏商品特写  ","subjects":["杯子",7,"桌面"],"visualStyle":{"lighting":"侧逆光","palette":"暖棕","composition":"居中","camera":"近景"},"motion":{"pacing":"快","cameraMoves":["推进","环绕"],"sceneRhythm":"三段式"},"reusablePrompt":"商业产品片","negativePrompt":"变形","suggestedUses":["商品主图","短视频开场"]}
    \`\`\``;
    const result = parseMediaAnalysis(raw, "video");
    expect(result.summary).toBe("竖屏商品特写");
    expect(result.subjects).toEqual(["杯子", "桌面"]);
    expect(result.motion?.cameraMoves).toEqual(["推进", "环绕"]);
    expect(result.suggestedUses).toHaveLength(2);
  });

  it("returns a stable empty shape when optional fields drift", () => {
    const result = parseMediaAnalysis('{"summary":"test"}', "image");
    expect(result).toEqual({
      mediaType: "image",
      summary: "test",
      subjects: [],
      visualStyle: { lighting: "", palette: "", composition: "", camera: "" },
      reusablePrompt: "",
      negativePrompt: "",
      suggestedUses: [],
    });
  });
});

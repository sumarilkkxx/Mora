import { describe, expect, it } from "vitest";
import { buildGuidedSubtitleLines, guidedSubtitleStyle } from "@/lib/guided-subtitles";
import { DEFAULT_GUIDED_EDIT_BRIEF, detectGuidedCaptionLanguage, type GuidedEditPlanDocument } from "@/lib/guided-edit";

function document(text: string, aspectRatio: "9:16" | "16:9" = "9:16"): GuidedEditPlanDocument {
  return {
    version: 1,
    brief: {
      ...DEFAULT_GUIDED_EDIT_BRIEF, inputMode: "full_script", projectName: "test", productName: "product", promotionGoal: "",
      fullScript: text, hook: "", introduction: "", sellingPoints: [""], proof: "", usageScene: "", cta: "",
      targetDuration: 15, aspectRatio, audioMode: "muted", burnSubtitles: true, captionSize: "medium", captionLanguage: "auto",
    },
    scenes: [{ id: "s1", start: 0, end: 8, label: "other", selected: true }],
    beats: [{ id: "b1", role: "feature", text, estimatedDuration: 8, sceneIds: ["s1"] }],
    timeline: [{ id: "c1", sourceId: "source", sceneId: "s1", beatId: "b1", start: 0, end: 8, outputStart: 0, outputEnd: 8 }],
    outputDuration: 8,
  };
}

describe("guided subtitles", () => {
  it("detects Chinese, English, and mixed copy", () => {
    expect(detectGuidedCaptionLanguage("这是中文文案")).toBe("zh");
    expect(detectGuidedCaptionLanguage("This is English copy")).toBe("en");
    expect(detectGuidedCaptionLanguage("Mora 商品介绍")).toBe("mixed");
  });

  it("uses the bundled cross-language font and aspect-aware readable sizes", () => {
    const portrait = guidedSubtitleStyle(document("中文"));
    const landscape = guidedSubtitleStyle(document("English", "16:9"));
    expect(portrait.fontName).toBe("Noto Sans CJK SC");
    expect(portrait.fontSize).toBeGreaterThanOrEqual(58);
    expect(landscape.fontSize).toBeGreaterThanOrEqual(52);
    expect(portrait.marginV).toBeGreaterThan(landscape.marginV);
  });

  it("splits long English captions into readable cards without losing words", () => {
    const text = "This carefully written product introduction should remain readable on a narrow vertical video without overflowing either side of the frame";
    const lines = buildGuidedSubtitleLines(document(text));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.text).join(" ").replace(/\s+/g, " ")).toBe(text);
    expect(lines.every((line) => line.endTime > line.startTime)).toBe(true);
  });

  it("keeps Chinese cards compact and inside the commerce safe zone", () => {
    const text = "这款商品适合日常通勤和周末出行，轻巧方便并且容易清洁。";
    const lines = buildGuidedSubtitleLines(document(text));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.text).join("")).toBe(text);
    expect(guidedSubtitleStyle(document(text)).marginV).toBe(Math.round(1920 * 0.13));
  });

  it("keeps Latin words intact inside mixed-language captions", () => {
    const text = "Mora 支持 lightweight product workflow 和 local rendering，适合门店使用。";
    const lines = buildGuidedSubtitleLines(document(text));
    expect(lines.map((line) => line.text).join(" ")).toContain("lightweight");
    expect(lines.map((line) => line.text).join(" ")).toContain("product");
    expect(lines.every((line) => !/light\s+weight/.test(line.text))).toBe(true);
  });

  it("never detaches closing punctuation or loses text at a caption boundary", () => {
    const text = "武汉的家人们，都来这家理发店啦！环境干净整洁，理发师经验丰富。";
    const lines = buildGuidedSubtitleLines(document(text));
    expect(lines.map((line) => line.text).join("")).toBe(text);
    expect(lines.every((line) => !/^[，。！？；：、]/.test(line.text))).toBe(true);
    expect(lines.every((line) => !/^[，。！？；：、]+$/.test(line.text))).toBe(true);
    expect(lines[0].startTime).toBe(0);
    expect(lines.at(-1)?.endTime).toBe(8);
    for (let index = 1; index < lines.length; index++) {
      expect(lines[index].startTime).toBeCloseTo(lines[index - 1].endTime, 6);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  applyGuidedSpeechRate,
  buildGuidedScriptBeats,
  buildGuidedTimeline,
  createGuidedEditPlan,
  missingGuidedBriefFields,
  recommendedGuidedTemplate,
  sanitizeGuidedEditBrief,
  scaleGuidedBeatDurations,
  splitPromotionScript,
  type GuidedScene,
} from "@/lib/guided-edit";

describe("guided edit planning", () => {
  it("splits approved copy without inventing or rewriting words", () => {
    const source = "每天早上赶时间？\n这款杯子可以放进包里。用完后请及时清洗！";
    const parts = splitPromotionScript(source);
    expect(parts).toEqual(["每天早上赶时间？", "这款杯子可以放进包里。", "用完后请及时清洗！"]);
    expect(parts.join("")).toBe(source.replace("\n", ""));
  });

  it("splits English full stops into independent editing beats", () => {
    const source = "Start with the problem. Show the product. Open the product page.";
    expect(splitPromotionScript(source)).toEqual([
      "Start with the problem.",
      "Show the product.",
      "Open the product page.",
    ]);
  });

  it("uses only merchant-provided guided fields as spoken beats", () => {
    const brief = sanitizeGuidedEditBrief({
      inputMode: "guided",
      templateId: "local_store",
      productName: "便携杯",
      promotionGoal: "提升门店咨询",
      hook: "早上出门总是很赶。",
      introduction: "这是我们门店的便携杯。",
      sellingPoints: ["杯身可以直接放进通勤包。", "用完以后方便清洁。"],
      usageScene: "适合办公室和短途出行。",
      cta: "需要尺寸信息可以到店咨询。",
      location: "武汉市洪山区示例路 1 号。",
    });
    const beats = buildGuidedScriptBeats(brief);
    expect(beats.map((beat) => beat.text)).toEqual([
      brief.hook,
      brief.introduction,
      ...brief.sellingPoints,
      brief.usageScene,
      brief.location,
      brief.cta,
    ]);
    expect(beats.map((beat) => beat.text).join("")).not.toContain(brief.promotionGoal);
  });

  it("recommends a template and validates only its required facts", () => {
    expect(recommendedGuidedTemplate("store_visit")).toBe("local_store");
    expect(recommendedGuidedTemplate("promotion")).toBe("promotion_offer");
    expect(missingGuidedBriefFields({
      inputMode: "guided",
      templateId: "local_store",
      productName: "波波理发店",
      sellingPoints: ["环境干净"],
    })).toEqual(["location"]);
  });

  it("compiles promotion templates in their declared order without inventing facts", () => {
    const brief = sanitizeGuidedEditBrief({
      inputMode: "guided",
      templateId: "promotion_offer",
      productName: "夏季套餐",
      sellingPoints: ["包含洗剪吹服务。"],
      offer: "本周到店可享九折。",
      cta: "提前预约。",
    });
    expect(buildGuidedScriptBeats(brief).map((beat) => beat.text)).toEqual([
      brief.offer,
      brief.productName,
      ...brief.sellingPoints,
      brief.cta,
    ]);
  });

  it("prefers explicitly bound scenes and produces a contiguous output timeline", () => {
    const scenes: GuidedScene[] = [
      { id: "a", start: 0, end: 3, label: "highlight", selected: true },
      { id: "b", start: 3, end: 8, label: "product_detail", selected: true },
    ];
    const beats = buildGuidedScriptBeats({ inputMode: "full_script", fullScript: "第一句。第二句。" });
    beats[0].sceneIds = ["b"];
    const timeline = buildGuidedTimeline({ sourceId: "source", sourceDuration: 8, beats, scenes });
    expect(timeline[0].sceneId).toBe("b");
    for (let index = 1; index < timeline.length; index++) {
      expect(timeline[index].outputStart).toBeCloseTo(timeline[index - 1].outputEnd, 5);
    }
  });

  it("creates a complete reproducible document", () => {
    const plan = createGuidedEditPlan({
      brief: { inputMode: "full_script", fullScript: "开场内容。产品介绍。最后查看详情。", targetDuration: 30 },
      scenes: [{ id: "s1", start: 0, end: 10, label: "other", selected: true }],
      sourceId: "source-1",
      sourceDuration: 10,
    });
    expect(plan.version).toBe(1);
    expect(plan.beats).toHaveLength(3);
    expect(plan.timeline.length).toBeGreaterThan(0);
    expect(plan.outputDuration).toBeGreaterThan(0);
    expect(plan.timeline.every((clip) => clip.sourceId === "source-1")).toBe(true);
  });

  it("aligns script beats to a real uploaded or system voice duration", () => {
    const beats = buildGuidedScriptBeats({ inputMode: "full_script", fullScript: "第一句。第二句更长一些。" });
    const scaled = scaleGuidedBeatDurations(beats, 12);
    expect(scaled.reduce((sum, beat) => sum + beat.estimatedDuration, 0)).toBeCloseTo(12, 2);
    expect(scaled[1].estimatedDuration).toBeGreaterThan(scaled[0].estimatedDuration);
  });

  it("derives a shorter automatic output when narration speed increases", () => {
    const beats = buildGuidedScriptBeats({ inputMode: "full_script", fullScript: "武汉的家人们，都来这家理发店啦！", speechRate: 1 });
    const faster = applyGuidedSpeechRate(beats, 2);
    expect(faster[0].estimatedDuration).toBeLessThan(beats[0].estimatedDuration);
    expect(faster[0].estimatedDuration).toBeCloseTo(beats[0].estimatedDuration / 2, 1);
  });

  it("drops the retired proof section and allows all selling points to be removed", () => {
    const brief = sanitizeGuidedEditBrief({
      inputMode: "guided",
      hook: "先看效果。",
      sellingPoints: [],
      proof: "这是旧版证明字段，不应继续进入口播。",
      cta: "现在预约。",
    });
    expect(brief.sellingPoints).toEqual([]);
    expect(brief.proof).toBe("");
    expect(buildGuidedScriptBeats(brief).map((beat) => beat.text)).toEqual(["先看效果。", "现在预约。"]);
  });

  it("stores the calculated timeline length instead of a fixed target duration", () => {
    const plan = createGuidedEditPlan({
      brief: { inputMode: "full_script", fullScript: "第一句。第二句。", targetDuration: 45, speechRate: 1.25 },
      scenes: [{ id: "s1", start: 0, end: 10, label: "other", selected: true }],
      sourceId: "source-1",
      sourceDuration: 10,
    });
    expect(plan.brief.targetDuration).toBeCloseTo(plan.outputDuration, 5);
    expect(plan.outputDuration).toBeLessThan(45);
  });

  it("sanitizes editing styles so the saved setting is honored safely", () => {
    expect(sanitizeGuidedEditBrief({ editStyle: "slow_zoom" }).editStyle).toBe("slow_zoom");
    expect(sanitizeGuidedEditBrief({ editStyle: "unknown" }).editStyle).toBe("natural");
  });
});

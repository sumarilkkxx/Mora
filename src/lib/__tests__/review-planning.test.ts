import { describe, expect, it } from "vitest";
import { fallbackCandidatePlans } from "../auto-edit/planning";
import { parsePromotionCopy, timeline, validateSpeechCuts, type Analysis, type EditBrief } from "../auto-edit/contract";

const brief: EditBrief = { target: 15, aspect: "9:16", audio: "original", style: "auto", captions: true, locale: "zh", instruction: "" };
const analysis: Analysis = { version: 1, summary: "demo", style: "", scenes: [], speech: [0, 5, 10].map(start => ({ start, end: start + 5, text: `句${start}` })), sampledAt: [], warnings: [] };
const copy = parsePromotionCopy({ hook: "看看。", body: "内容。", cta: "咨询。", voiceover: "看看。内容。咨询。", evidence: ["demo"] });

describe("approved copy and original speech planning", () => {
  it("offers only renderable candidates for continuous speech", () => {
    for (const plan of fallbackCandidatePlans("s", 15, brief, analysis, copy)) {
      expect(() => validateSpeechCuts(plan, analysis.speech)).not.toThrow();
      expect(timeline(plan).at(-1)!.outputEnd).toBeLessThanOrEqual(15);
      expect(plan.clips.length).toBeGreaterThan(0);
    }
  });
  it("preserves every sentence including the CTA beyond twenty sentences", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `第${i}句`);
    for (const plan of fallbackCandidatePlans("s", 30, { ...brief, audio: "voiceover" }, analysis, { ...copy, voiceover: lines.join("。") })) {
      expect(plan.clips.map(c => c.text).join("。").split(/[。\s]+/).filter(Boolean)).toEqual(lines);
      expect(plan.clips.length).toBeLessThanOrEqual(20);
    }
  });
  it("handles silent gaps and short sentences without cutting speech", () => {
    for (const speech of [[], [{ start: 0, end: 0.2, text: "短句" }, { start: 0.2, end: 1, text: "完整句" }], [{ start: 3, end: 9, text: "一句" }, { start: 12, end: 18, text: "另一句" }]]) {
      for (const plan of fallbackCandidatePlans("s", 30, brief, { ...analysis, speech }, copy)) {
        expect(() => validateSpeechCuts(plan, speech)).not.toThrow();
        expect(timeline(plan).at(-1)!.outputEnd).toBeLessThanOrEqual(15);
      }
    }
  });
  it("explains when an uninterrupted sentence cannot fit the target", () => {
    expect(() => fallbackCandidatePlans("s", 30, brief, { ...analysis, speech: [{ start: 0, end: 30, text: "长句" }] }, copy)).toThrow(/增加时长或改用旁白/);
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { outputReviewSamples, parseBrief, parsePlan, sampleTimes, timeline, validateSource, validateSpeechCuts, type EditBrief, type EditPlan } from "../auto-edit/contract";
import { parseAction, parseAnalysis } from "../auto-edit/model";
import { buildRender, captionLines } from "../auto-edit/render";
import { taskHref } from "../task-feed";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";

const brief: EditBrief = { instruction: "展示外观", target: 15, aspect: "9:16", audio: "muted", style: "auto", captions: true, locale: "zh" };
const clip = { sourceId: "source", start: 0, end: 5, speed: 1, fit: "contain" as const, transition: "cut" as const, text: "外观展示", reason: "清晰", evidence: "0s" };
const plan: EditPlan = { version: 1, title: "展示", explanation: "选用原片段", clips: [clip] };
describe("auto edit contract", () => {
  it("permits raw video only on the scoped media upload route and retains origin checks", () => {
    const media = "http://localhost:3000/api/project/p/media";
    expect(proxy(new NextRequest(media, { method: "POST", headers: { "content-type": "video/mp4" } })).status).toBe(200);
    expect(proxy(new NextRequest(media, { method: "POST", headers: { "content-type": "video/mp4", origin: "https://foreign.example" } })).status).toBe(403);
    expect(proxy(new NextRequest("http://localhost:3000/api/project/p/auto-edit", { method: "POST", headers: { "content-type": "video/mp4" } })).status).toBe(415);
  });
  it("enforces independent AI source limits without changing the manual editor", () => {
    expect(() => validateSource(300, 1024 ** 3)).not.toThrow();
    for (const seconds of [0, -1, 300.01, NaN, Infinity]) expect(() => validateSource(seconds, 1)).toThrow();
    expect(() => validateSource(60, 1024 ** 3 + 1)).toThrow();
    expect(() => parseBrief({ ...brief, target: 45 })).toThrow();
  });
  it("rejects foreign sources, invalid times, speeds and arbitrary FFmpeg filters", () => {
    for (const change of [{ sourceId: "other" }, { start: -1 }, { end: 301 }, { end: NaN }, { speed: 2 }, { fit: "movie=/etc/passwd" }, { transition: "arbitrary" }]) {
      expect(() => parsePlan({ ...plan, clips: [{ ...clip, ...change }] }, "source", 300, brief)).toThrow();
    }
    expect(() => parsePlan({ ...plan, clips: [{ ...clip, speed: 1.1 }] }, "source", 300, { ...brief, audio: "original" })).toThrow();
    expect(() => parsePlan({ ...plan, clips: [{ ...clip, end: 16 }] }, "source", 300, brief)).toThrow();
  });
  it("compiles non-overlapping clips on frame boundaries and counts fade overlap", () => {
    const compiled = timeline({ ...plan, clips: [clip, { ...clip, start: 20, end: 20.51, transition: "fade" }] });
    expect(compiled[1].overlap).toBeCloseTo(0.1);
    expect(compiled[1].outputEnd).toBeCloseTo(5.4);
    for (const c of compiled) expect(c.outputEnd * 30).toBeCloseTo(Math.round(c.outputEnd * 30));
  });
  it("refuses speech-splitting cuts and derives original subtitles at the reordered time", () => {
    const speech = [{ start: 10.1, end: 11.5, text: "真实原话" }];
    expect(() => validateSpeechCuts({ ...plan, clips: [{ ...clip, start: 11, end: 12 }] }, speech)).toThrow();
    const reordered = { ...plan, clips: [{ ...clip, start: 10, end: 12 }, clip] };
    expect(() => validateSpeechCuts(reordered, speech)).not.toThrow();
    const captions = captionLines(reordered, { ...brief, audio: "original" }, speech);
    expect(captions[0].text).toBe("真实原话");
    expect(captions[0].startTime).toBeCloseTo(0.1);
    expect(captions[0].endTime).toBeCloseTo(1.5);
  });
  it("requires actual voice duration to fit and cannot invoke a shell through tool calls", () => {
    expect(() => buildRender({ source: "s", output: "o", plan, brief: { ...brief, audio: "voiceover" }, quality: "720p", voices: [{ index: 0, file: "v", duration: 5, text: clip.text }] })).toThrow(/旁白/);
    expect(() => parseAction({ tool: "exec", arguments: { command: "rm" } })).toThrow();
    expect(() => parseAction({ tool: "render_edit", arguments: [] })).toThrow();
    expect(parseAction({ tool: "render_edit", arguments: {} }).tool).toBe("render_edit");
  });
  it("samples both ends and rejects invalid visual timestamps", () => {
    expect(sampleTimes(300)).toHaveLength(24);
    expect(sampleTimes(300).at(-1)).toBe(299.95);
    expect(() => parseAnalysis({ summary: "a", scenes: [{ start: 0, end: 301, text: "a" }] }, 300, [0], [])).toThrow();
    expect(taskHref({ kind: "auto_edit", id: "r", projectId: "p" })).toBe("/project/p/auto-edit?run=r");
  });
  it("samples every planned output clip at its own midpoint for content review", () => {
    const samples = outputReviewSamples({ ...plan, clips: [clip, { ...clip, start: 7.293, end: 8.4 }, { ...clip, start: 9, end: 11, transition: "fade" }] });
    expect(samples).toHaveLength(3);
    expect(samples[1]).toMatchObject({ index: 1, sourceAt: 7.843 });
    expect(samples[1].time).toBeGreaterThan(5);
    expect(samples[2].time).toBeLessThan(9);
  });
});

// @vitest-environment node
import { mkdtemp, readFile, rm } from "fs/promises";
import { join, resolve, sep } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpegBin } from "../ffmpeg-path";
import { execMedia } from "../auto-edit/media";
import { renderAutoEdit, checkOutput } from "../auto-edit/render";
import type { EditBrief, EditPlan } from "../auto-edit/contract";

let directory: string, source: string, fingerprint: string;
const brief: EditBrief = { instruction: "验收", target: 15, aspect: "9:16", audio: "muted", style: "auto", captions: true, locale: "zh" };
const plan: EditPlan = { version: 1, title: "test", explanation: "test", clips: [
  { sourceId: "s", start: 2, end: 3, speed: 1, fit: "contain", transition: "cut", text: "原视频剪辑", reason: "test", evidence: "2s" },
  { sourceId: "s", start: 0, end: 1, speed: 1, fit: "cover", transition: "fade", text: "第二个片段", reason: "test", evidence: "0s" },
] };
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "mora-auto-edit-"));
  source = join(directory, "source.mp4");
  await execMedia(ffmpegBin(), ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
  fingerprint = createHash("sha256").update(await readFile(source)).digest("hex");
}, 30000);
afterAll(async () => {
  expect(createHash("sha256").update(await readFile(source)).digest("hex")).toBe(fingerprint);
  const target = resolve(directory);
  if (target.startsWith(resolve(tmpdir()) + sep) && target.includes("mora-auto-edit-")) await rm(target, { recursive: true, force: true });
});
describe("real FFmpeg AI timeline acceptance", () => {
  it.each(["9:16", "16:9", "1:1"] as const)("renders real reordered source frames, fades and Chinese subtitles at %s", async aspect => {
    const output = join(directory, `muted-${aspect.replace(":", "-")}.mp4`);
    const config = { ...brief, aspect };
    await renderAutoEdit({ source, plan, brief: config, quality: "720p", voices: [], output, directory, speech: [], signal: new AbortController().signal });
    const checks = await checkOutput(output, plan, config, "720p", new AbortController().signal);
    expect(checks.issues).toEqual([]);
    expect(checks.duration).toBeCloseTo(1.8, 1);
  }, 60000);
  it("preserves original audio and exports the same cuts at 1080p", async () => {
    const cuts = { ...plan, clips: plan.clips.map(c => ({ ...c, transition: "cut" as const })) };
    const config = { ...brief, audio: "original" as const, aspect: "16:9" as const };
    const output = join(directory, "original-1080.mp4");
    await renderAutoEdit({ source, plan: cuts, brief: config, quality: "1080p", voices: [], output, directory, speech: [{ start: 2, end: 3, text: "原声字幕" }], signal: new AbortController().signal });
    expect((await checkOutput(output, cuts, config, "1080p", new AbortController().signal)).issues).toEqual([]);
  }, 60000);
  it("keeps a boundary-length original-audio render within 30 seconds", async () => {
    const cuts = { ...plan, clips: Array.from({ length: 8 }, () => ({ ...plan.clips[0], start: 0, end: 3.75, transition: "cut" as const })) };
    const config = { ...brief, target: 30 as const, audio: "original" as const, aspect: "16:9" as const, captions: false };
    const output = join(directory, "boundary30.mp4");
    await renderAutoEdit({ source, plan: cuts, brief: config, quality: "720p", voices: [], output, directory, speech: [], signal: new AbortController().signal });
    const checks = await checkOutput(output, cuts, config, "720p", new AbortController().signal);
    expect(checks.issues).toEqual([]); expect(checks.duration).toBeLessThanOrEqual(30);
  }, 60000);
  it("mixes local music with a bounded speed change and honors cancellation", async () => {
    const cuts = { ...plan, clips: [{ ...plan.clips[0], start: 0, end: 2, speed: 1.1 }] };
    const config = { ...brief, captions: false, bgm: "local" };
    const output = join(directory, "music-speed.mp4");
    await renderAutoEdit({ source, plan: cuts, brief: config, quality: "720p", voices: [], bgm: source, output, directory, speech: [], signal: new AbortController().signal });
    expect((await checkOutput(output, cuts, config, "720p", new AbortController().signal)).issues).toEqual([]);
    const controller = new AbortController(); controller.abort();
    await expect(renderAutoEdit({ source, plan: cuts, brief: config, quality: "720p", voices: [], output: join(directory, "cancelled.mp4"), directory, speech: [], signal: controller.signal })).rejects.toThrow();
  }, 60000);
});

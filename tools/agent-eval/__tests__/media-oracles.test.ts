import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ffmpegBin } from "../../../src/lib/ffmpeg-path";
import { probeMedia, runMediaProcess } from "../../../src/lib/media-runtime";
import { verifyMediaOutput } from "../media-oracles";
import type { MediaCheck } from "../core/contracts";

let directory: string, video: string, mute: string;
const hash = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");
const decode: MediaCheck = { id: "decode", kind: "decode", rationale: "All frames must decode" };
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "mora-eval-oracle-"));
  video = join(directory, "valid.mp4"); mute = join(directory, "mute.mp4");
  await runMediaProcess(ffmpegBin(), ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", video]);
  await runMediaProcess(ffmpegBin(), ["-v", "error", "-i", video, "-c:v", "copy", "-an", mute]);
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe("real media output oracles", () => {
  it("checks a known waveform against actual audio, rejects another tone and changed references", async () => {
    const other = join(directory, "other-tone.mp4");
    await runMediaProcess(ffmpegBin(), ["-v", "error", "-i", mute, "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100", "-t", "2", "-c:v", "copy", "-c:a", "aac", other]);
    const rule: MediaCheck = { id: "wave", kind: "audio_match", rationale: "known fixture PCM window", atSeconds: .5, referencePath: video, referenceSha256: await hash(video), referenceAtSeconds: .5, seconds: 1, maxMeanError: .03 };
    expect((await verifyMediaOutput(video, [rule])).passed).toBe(true);
    expect((await verifyMediaOutput(other, [rule])).passed).toBe(false);
    expect((await verifyMediaOutput(mute, [rule])).passed).toBe(false);
    expect((await verifyMediaOutput(video, [{ ...rule, referenceSha256: "0".repeat(64) }])).checks.at(-1)?.status).toBe("unknown");
  });
  it("fully decodes and validates actual dimensions, duration and audible audio", async () => {
    const result = await verifyMediaOutput(video, [decode,
      { id: "size", kind: "dimensions", width: 160, height: 120, rationale: "fixture size" },
      { id: "duration", kind: "duration", seconds: 2, toleranceSeconds: .15, rationale: "fixture duration" },
      { id: "audio", kind: "audio", mode: "audible", thresholdDb: -60, rationale: "known sine" },
    ]);
    expect(result).toMatchObject({ exists: true, decodes: true, hasVideo: true, passed: true });
    expect(result.checks.every(c => c.status === "passed")).toBe(true);
    expect(result.checks.find(c => c.rule.id === "decode")).toMatchObject({ exitCode: 0 });
    expect(result.toolVersion).toContain("ffmpeg version");
  });
  it("rejects wrong dimensions, duration and audio constraints", async () => {
    const result = await verifyMediaOutput(video, [
      { id: "size", kind: "dimensions", width: 120, height: 160, rationale: "wrong aspect" },
      { id: "duration", kind: "duration", seconds: 5, toleranceSeconds: .1, rationale: "wrong duration" },
      { id: "audio", kind: "audio", mode: "absent", rationale: "must be silent" },
    ]);
    expect(result.passed).toBe(false);
    expect(result.checks.filter(c => c.status === "failed")).toHaveLength(3);
    expect((await verifyMediaOutput(mute, [{ id: "audio", kind: "audio", mode: "silent", rationale: "no sound" }])).passed).toBe(true);
    expect((await verifyMediaOutput(mute, [{ id: "audio", kind: "audio", mode: "audible", rationale: "sound required" }])).passed).toBe(false);
  });
  it("rejects corrupted frames even if ffprobe reads the container metadata", async () => {
    const bytes = await readFile(video); const offset = bytes.indexOf(Buffer.from("mdat"));
    expect(offset).toBeGreaterThan(0); bytes.fill(0, offset + 4);
    const broken = join(directory, "corrupt.mp4"); await writeFile(broken, bytes);
    expect((await probeMedia(broken)).hasVideo).toBe(true);
    const result = await verifyMediaOutput(broken, [decode]);
    expect(result).toMatchObject({ exists: true, decodes: false, passed: false });
    expect(result.checks.find(c => c.rule.kind === "decode")?.exitCode).not.toBe(0);
  });
  it("compares source pixels against a hash-bound reference", async () => {
    const rule: MediaCheck = { id: "source", kind: "frame_match", purpose: "source", rationale: "controlled reference only", atSeconds: .2, referencePath: video, referenceSha256: await hash(video), referenceAtSeconds: .2, maxMeanError: 0 };
    expect((await verifyMediaOutput(mute, [rule])).passed).toBe(true);
    expect((await verifyMediaOutput(mute, [{ ...rule, referenceAtSeconds: 1.5 }])).passed).toBe(false);
    expect((await verifyMediaOutput(mute, [{ ...rule, referenceSha256: "0".repeat(64) }])).checks.at(-1)?.status).toBe("unknown");
  });
  it("detects reordered and incorrectly trimmed controlled clips", async () => {
    const source = join(directory, "red-blue.mp4"), reverse = join(directory, "blue-red.mp4"), trimmed = join(directory, "trim.mp4");
    for (const [file, first, second] of [[source, "red", "blue"], [reverse, "blue", "red"]]) {
      await runMediaProcess(ffmpegBin(), ["-v", "error", "-f", "lavfi", "-i", `color=${first}:s=160x120:r=10:d=1`, "-f", "lavfi", "-i", `color=${second}:s=160x120:r=10:d=1`, "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", file]);
    }
    const rule: MediaCheck = { id: "order", kind: "frame_match", purpose: "order", rationale: "red precedes blue", atSeconds: .2, referencePath: source, referenceSha256: await hash(source), referenceAtSeconds: .2, maxMeanError: 1 };
    const sequence: MediaCheck[] = [rule, { ...rule, id: "second", atSeconds: 1.2, referenceAtSeconds: 1.2 }];
    expect((await verifyMediaOutput(source, sequence)).passed).toBe(true);
    expect((await verifyMediaOutput(reverse, sequence)).passed).toBe(false);
    await runMediaProcess(ffmpegBin(), ["-v", "error", "-ss", "1", "-i", source, "-t", "0.8", "-c:v", "libx264", trimmed]);
    const trim: MediaCheck = { ...rule, purpose: "trim", referenceAtSeconds: 1.2 };
    expect((await verifyMediaOutput(trimmed, [trim])).passed).toBe(true);
    expect((await verifyMediaOutput(source, [trim])).passed).toBe(false);
  });
  it("detects missing and incorrect visible caption text in a controlled region", async () => {
    const correct = join(directory, "caption-correct.mp4"), wrong = join(directory, "caption-wrong.mp4");
    for (const [file, text] of [[correct, "SALE"], [wrong, "FAIL"]]) {
      await runMediaProcess(ffmpegBin(), ["-v", "error", "-i", mute, "-vf", `drawtext=text=${text}:fontcolor=white:fontsize=24:x=20:y=80:box=1:boxcolor=black`, "-c:v", "libx264", file]);
    }
    const rule: MediaCheck = { id: "caption", kind: "frame_match", purpose: "caption", rationale: "known rendered SALE glyphs", atSeconds: .5, referencePath: correct, referenceSha256: await hash(correct), referenceAtSeconds: .5, maxMeanError: 1, region: { x: 20, y: 80, width: 90, height: 30 } };
    expect((await verifyMediaOutput(correct, [rule])).passed).toBe(true);
    expect((await verifyMediaOutput(wrong, [rule])).passed).toBe(false);
    expect((await verifyMediaOutput(mute, [rule])).passed).toBe(false);
  });
  it("handles missing files, abort and timeout without hanging or claiming success", async () => {
    expect((await verifyMediaOutput(join(directory, "absent.mp4"), [decode])).passed).toBe(false);
    const controller = new AbortController(); controller.abort();
    expect((await verifyMediaOutput(video, [decode], { signal: controller.signal })).checks.some(c => c.diagnostic?.includes("cancelled"))).toBe(true);
    expect((await verifyMediaOutput(video, [decode], { timeoutMs: 1 })).passed).toBe(false);
    expect((await verifyMediaOutput(undefined, [], { outputRequired: false })).checks).toEqual([]);
  });
});

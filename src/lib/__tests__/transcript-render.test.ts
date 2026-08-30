import { execFile } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { probeMedia } from "@/lib/media-probe";
import { buildTranscriptRenderInvocation, renderTranscriptEdit } from "@/lib/transcript-render";
import { DEFAULT_TRANSCRIPT_EDIT_PLAN, type TranscriptDocument } from "@/lib/transcript-editor";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
describe("transcript render invocation", () => {
  it("keeps video and audio pairs ordered through concat", () => {
    const invocation = buildTranscriptRenderInvocation({
      inputPath: "/source.mp4",
      outputPath: "/output.mp4",
      keepRanges: [{ start: 0, end: 1 }, { start: 2, end: 4 }],
      hasAudio: true,
      subtitlePath: "/tmp/caption.ass",
      fontDirectory: "/tmp/fonts",
      duration: 3,
    });
    expect(invocation.filterComplex).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vcat][acat]");
    expect(invocation.filterComplex).toContain("[vbase]subtitles=/tmp/caption.ass:fontsdir=/tmp/fonts[vout]");
    expect(invocation.outputArgs).toContain("[acat]");
    expect(invocation.outputArgs.at(-1)).toBe("/output.mp4");
  });

  it("does not map an audio stream for silent sources", () => {
    const invocation = buildTranscriptRenderInvocation({
      inputPath: "/source.mp4",
      outputPath: "/output.mp4",
      keepRanges: [{ start: 0, end: 1 }],
      hasAudio: false,
      duration: 1,
    });
    expect(invocation.filterComplex).not.toContain("atrim");
    expect(invocation.outputArgs).not.toContain("-c:a");
  });
});

describe("transcript renderer integration", () => {
  it("creates a valid non-destructive cut with synchronized audio", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mora-text-edit-"));
    temporaryDirectories.push(directory);
    const inputPath = join(directory, "source.mp4");
    const outputPath = join(directory, "edited.mp4");
    await execFileAsync(ffmpegBin(), [
      "-nostdin", "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", inputPath,
    ]);
    const transcript: TranscriptDocument = {
      version: 1,
      text: "one two",
      language: "en",
      duration: 3,
      model: "test",
      device: "wasm",
      words: [{ id: "w1", text: "one", start: 0.2, end: 0.7 }, { id: "w2", text: "two", start: 2.2, end: 2.7 }],
      segments: [], silenceRanges: [], createdAt: "2026-08-25T00:00:00.000Z",
    };
    await renderTranscriptEdit({
      projectId: "test-render",
      sourcePath: inputPath,
      sourceWidth: 320,
      sourceHeight: 180,
      hasAudio: true,
      transcript,
      plan: { ...DEFAULT_TRANSCRIPT_EDIT_PLAN, burnSubtitles: false },
      keepRanges: [{ start: 0, end: 1 }, { start: 2, end: 3 }],
      outputPath,
    });
    const probe = await probeMedia(outputPath);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(180);
    expect(probe.hasAudio).toBe(true);
    expect(probe.duration).toBeGreaterThan(1.85);
    expect(probe.duration).toBeLessThan(2.15);
  }, 30_000);
});

// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { guidedRenderCacheDir, renderGuidedEdit } from "@/lib/guided-edit-render";
import { DEFAULT_GUIDED_EDIT_BRIEF, type GuidedEditPlanDocument } from "@/lib/guided-edit";
import { probeMedia, runMediaProcess } from "@/lib/media-runtime";

let root = "";
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

function document(secondStart = 1): GuidedEditPlanDocument {
  return {
    version: 1,
    brief: { ...DEFAULT_GUIDED_EDIT_BRIEF, audioMode: "original", burnSubtitles: false, aspectRatio: "16:9", outputQuality: "720p" },
    scenes: [
      { id: "scene-1", start: 0, end: 1, label: "highlight", selected: true },
      { id: "scene-2", start: secondStart, end: secondStart + 1, label: "product_detail", selected: true },
    ],
    beats: [
      { id: "beat-1", role: "hook", text: "第一镜", estimatedDuration: 1, sceneIds: ["scene-1"] },
      { id: "beat-2", role: "feature", text: "第二镜", estimatedDuration: 1, sceneIds: ["scene-2"] },
    ],
    timeline: [
      { id: "clip-1", sourceId: "source", sceneId: "scene-1", beatId: "beat-1", start: 0, end: 1, outputStart: 0, outputEnd: 1 },
      { id: "clip-2", sourceId: "source", sceneId: "scene-2", beatId: "beat-2", start: secondStart, end: secondStart + 1, outputStart: 1, outputEnd: 2 },
    ],
    outputDuration: 2,
  };
}

describe("guided edit partial rerender", () => {
  it("reuses the unchanged FFmpeg segment and produces a decodable video with audio", async () => {
    root = await mkdtemp(join(tmpdir(), "mora-guided-render-"));
    vi.stubEnv("APP_DATA_DIR", root);
    const source = join(root, "source.mp4");
    await runMediaProcess(ffmpegBin(), [
      "-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=12:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-shortest",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", source,
    ], { timeoutMs: 60_000, maxBuffer: 8 * 1024 * 1024 });

    const firstOutput = join(root, "first.mp4");
    await renderGuidedEdit({ projectId: "project", sourcePath: source, sourceWidth: 160, sourceHeight: 90, sourceHasAudio: true, document: document(1), outputPath: firstOutput });
    const firstSegments = (await readdir(guidedRenderCacheDir("project"))).filter((name) => name.endsWith(".mp4"));
    expect(firstSegments).toHaveLength(2);

    const secondOutput = join(root, "second.mp4");
    await renderGuidedEdit({ projectId: "project", sourcePath: source, sourceWidth: 160, sourceHeight: 90, sourceHasAudio: true, document: document(2), outputPath: secondOutput });
    const secondSegments = (await readdir(guidedRenderCacheDir("project"))).filter((name) => name.endsWith(".mp4"));
    expect(secondSegments).toHaveLength(3);
    expect(firstSegments.filter((name) => secondSegments.includes(name))).toHaveLength(2);

    const media = await probeMedia(secondOutput);
    expect(media).toMatchObject({ width: 1280, height: 720, hasVideo: true, hasAudio: true });
    expect(media.duration).toBeGreaterThan(1.8);
    expect(media.duration).toBeLessThan(2.2);
  }, 60_000);
});

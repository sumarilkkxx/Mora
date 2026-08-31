import { describe, it, expect } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { stat, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { ffmpegBin } from "../ffmpeg-path";
import { extractFirstFrame, extractLastFrame, THUMB_SUFFIX, LAST_FRAME_SUFFIX } from "../video-composer/frame-extract";

const execFileAsync = promisify(execFile);

// Real-ffmpeg contract test for the two frame primitives: the poster thumbnail (works feed /
// project cards) and the tail frame (seam chaining). A synthetic 1s clip keeps it fast.
describe("frame extraction（首帧封面 + 尾帧续拍）", () => {
  it("从真实视频抽出首帧缩略图与尾帧，两者都非空文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-frame-"));
    const video = join(dir, "clip.mp4");
    try {
      await execFileAsync(ffmpegBin(), [
        "-nostdin", "-v", "error", "-y",
        "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=1",
        "-pix_fmt", "yuv420p", video,
      ], { timeout: 60_000 });

      const thumb = await extractFirstFrame(video);
      expect(thumb).toBe(`${video}${THUMB_SUFFIX}`);
      expect((await stat(thumb!)).size).toBeGreaterThan(0);

      const tail = await extractLastFrame(video);
      expect(tail).toBe(`${video}${LAST_FRAME_SUFFIX}`);
      expect((await stat(tail!)).size).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("输入不存在时返回 undefined（best-effort，不抛错不阻断）", async () => {
    expect(await extractFirstFrame("/nonexistent/nope.mp4")).toBeUndefined();
  });
});

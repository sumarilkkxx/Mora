/**
 * media-validate — real files through the real ffprobe/ffmpeg: an HTML error page saved as .mp4
 * must be rejected and deleted; genuine media must pass untouched.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, writeFile, access } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import { validateMediaFile, validateOrDelete } from "@/lib/media-validate";
import { ffmpegBin } from "@/lib/ffmpeg-path";

const execFileAsync = promisify(execFile);
let dir: string;

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "media-validate-"));
});

describe("validateMediaFile / validateOrDelete", () => {
  it("拒绝存成 .mp4 的 HTML 错误页并删除文件", async () => {
    const fake = join(dir, "error-page.mp4");
    await writeFile(fake, "<html><body>404 Not Found</body></html>");
    expect(await validateOrDelete(fake, "video")).toBe(false);
    expect(await exists(fake)).toBe(false);
  });

  it("拒绝 0 字节文件", async () => {
    const empty = join(dir, "empty.jpg");
    await writeFile(empty, "");
    expect(await validateMediaFile(empty, "image")).toBe(false);
  });

  it("拒绝不存在的路径", async () => {
    expect(await validateMediaFile(join(dir, "nope.mp4"), "video")).toBe(false);
  });

  it("真视频/真图片/真音频通过且不被删除", async () => {
    const vid = join(dir, "real.mp4");
    const img = join(dir, "real.png");
    const aud = join(dir, "real.mp3");
    // 1s of test pattern + 1s of sine tone via lavfi — no external fixtures needed
    await execFileAsync(ffmpegBin(), ["-y", "-f", "lavfi", "-i", "testsrc=size=64x64:duration=1", "-pix_fmt", "yuv420p", vid], { timeout: 60_000 });
    await execFileAsync(ffmpegBin(), ["-y", "-f", "lavfi", "-i", "testsrc=size=64x64:duration=1", "-frames:v", "1", img], { timeout: 60_000 });
    await execFileAsync(ffmpegBin(), ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", aud], { timeout: 60_000 });
    expect(await validateOrDelete(vid, "video")).toBe(true);
    expect(await validateOrDelete(img, "image")).toBe(true);
    expect(await validateOrDelete(aud, "audio")).toBe(true);
    expect(await exists(vid)).toBe(true);
  }, 90_000);

  it("拒绝存成 .mp3 的文本文件（audio 解码路径）", async () => {
    const fake = join(dir, "not-audio.mp3");
    await writeFile(fake, "definitely not audio");
    expect(await validateMediaFile(fake, "audio")).toBe(false);
  });
});

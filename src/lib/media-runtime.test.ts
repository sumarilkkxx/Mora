import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import {
  MediaRuntimeError,
  createMediaFileResponse,
  probeMedia,
  runMediaProcess,
} from "@/lib/media-runtime";

const roots: string[] = [];

async function root() {
  const path = await mkdtemp(join(tmpdir(), "mora media 运行时-"));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("Media Runtime", () => {
  it("passes Windows, macOS, spaces and non-ASCII paths as literal arguments", async () => {
    const paths = [
      String.raw`C:\Users\Mora 用户\input video.mp4`,
      "/Users/Mora 用户/素材 input.mp4",
      `quote-\"-and-'apostrophe.mp4`,
    ];
    const result = await runMediaProcess(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...paths]);
    expect(JSON.parse(result.stdout)).toEqual(paths);
  });

  it("returns binary stdout without text coercion", async () => {
    const result = await runMediaProcess(process.execPath, ["-e", "process.stdout.write(Buffer.from([0, 255, 1, 254]))"], { encoding: "buffer" });
    expect(result.stdout).toEqual(Buffer.from([0, 255, 1, 254]));
  });

  it("classifies timeouts and cancellation without losing stderr", async () => {
    await expect(runMediaProcess(process.execPath, ["-e", "process.stderr.write('waiting\\n'); setTimeout(() => {}, 1000)"], { timeoutMs: 150 }))
      .rejects.toMatchObject({ code: "timeout", recoverable: true, stderr: expect.stringContaining("waiting") });

    const controller = new AbortController();
    const pending = runMediaProcess(process.execPath, ["-e", "process.stderr.write('cancel me\\n'); setTimeout(() => {}, 1000)"], { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("test cancellation")), 150);
    await expect(pending).rejects.toMatchObject({ code: "cancelled", recoverable: true, stderr: expect.stringContaining("cancel me") });
  });

  it("preserves stderr and classifies failed media processes", async () => {
    await expect(runMediaProcess(process.execPath, ["-e", "process.stderr.write('decoder exploded'); process.exit(7)"]))
      .rejects.toMatchObject({ code: "process_failed", recoverable: true, stderr: "decoder exploded" });
    await expect(runMediaProcess(join(await root(), "missing-media-tool"), []))
      .rejects.toMatchObject({ code: "tool_unavailable", recoverable: false });
  });

  it("classifies corrupt input as non-recoverable invalid media", async () => {
    const file = join(await root(), "损坏 media.mp4");
    await writeFile(file, "not a media file");
    await expect(probeMedia(file)).rejects.toMatchObject({ code: "invalid_media", recoverable: false, stderr: expect.any(String) });
  });

  it("probes a real file whose path contains spaces and non-ASCII characters", async () => {
    const directory = await root();
    const file = join(directory, "成片 with audio.mp4");
    await runMediaProcess(ffmpegBin(), [
      "-v", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=12:duration=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", file,
    ], { timeoutMs: 60_000, maxBuffer: 8 * 1024 * 1024 });

    await expect(probeMedia(file)).resolves.toMatchObject({ width: 64, height: 64, hasAudio: true });
    expect((await probeMedia(file)).duration).toBeGreaterThan(0.9);
  });

  it("serves complete, repeated and invalid ranges without changing bytes", async () => {
    const directory = await root();
    const file = join(directory, "输出 file.bin");
    const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
    await writeFile(file, bytes);

    const full = await createMediaFileResponse(file, { contentType: "application/octet-stream" });
    expect(full.status).toBe(200);
    expect(createHash("sha256").update(Buffer.from(await full.arrayBuffer())).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
    const download = await createMediaFileResponse(file, { contentType: "application/octet-stream", downloadName: "成片 output.bin" });
    expect(download.headers.get("content-disposition")).toContain("filename*=UTF-8''%E6%88%90%E7%89%87%20output.bin");
    await download.body?.cancel();

    const ranges = await Promise.all([
      createMediaFileResponse(file, { contentType: "application/octet-stream", rangeHeader: "bytes=0-4" }),
      createMediaFileResponse(file, { contentType: "application/octet-stream", rangeHeader: "bytes=10-19" }),
      createMediaFileResponse(file, { contentType: "application/octet-stream", rangeHeader: "bytes=30-" }),
    ]);
    expect(await Promise.all(ranges.map(response => response.text()))).toEqual(["01234", "abcdefghij", "uvwxyz"]);
    expect(ranges.every(response => response.status === 206)).toBe(true);

    const invalid = await createMediaFileResponse(file, { contentType: "application/octet-stream", rangeHeader: "bytes=0-1,4-5" });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe(`bytes */${(await readFile(file)).length}`);
  });

  it("exposes typed runtime errors", () => {
    const error = new MediaRuntimeError("invalid_media", "bad input", { recoverable: false, stderr: "invalid data" });
    expect(error).toMatchObject({ name: "MediaRuntimeError", code: "invalid_media", recoverable: false, stderr: "invalid data" });
  });
});

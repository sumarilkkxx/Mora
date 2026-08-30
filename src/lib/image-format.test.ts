import { describe, expect, it } from "vitest";
import { detectImageMime, imageDataUri, normalizeImageDataUri } from "./image-format";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { toRemoteUsableImage } from "./remote-image";

const webp = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

describe("image format detection", () => {
  it("detects WebP from its RIFF signature", () => {
    expect(detectImageMime(webp)).toBe("image/webp");
  });

  it("uses bytes instead of an incorrect declared MIME", () => {
    expect(imageDataUri(webp, "image/png")).toMatch(/^data:image\/webp;base64,/);
  });

  it("repairs an incorrectly labelled provider data URI", () => {
    const wrong = `data:image/png;base64,${webp.toString("base64")}`;
    expect(normalizeImageDataUri(wrong)).toBe(`data:image/webp;base64,${webp.toString("base64")}`);
  });

  it("repairs a historical .png file that actually contains WebP bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "mora-image-mime-"));
    const previousDataDir = process.env.APP_DATA_DIR;
    process.env.APP_DATA_DIR = root;
    try {
      await mkdir(join(root, "uploads", "project"), { recursive: true });
      await writeFile(join(root, "uploads", "project", "reference.png"), webp);
      const result = await toRemoteUsableImage("/api/files/project/reference.png");
      expect(result).toBe(`data:image/webp;base64,${webp.toString("base64")}`);
    } finally {
      if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
      else process.env.APP_DATA_DIR = previousDataDir;
      await rm(root, { recursive: true, force: true });
    }
  });
});

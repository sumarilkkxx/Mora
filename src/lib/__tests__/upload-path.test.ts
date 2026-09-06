// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveExistingUploadFilePath, resolveUploadFilePath } from "@/lib/upload-path";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mora-upload-path-"));
  vi.stubEnv("APP_DATA_DIR", root);
  await mkdir(join(root, "uploads", "project"), { recursive: true });
  await writeFile(join(root, "uploads", "project", "image one.png"), "image");
  await writeFile(join(root, "outside.png"), "private");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("upload file boundary", () => {
  it("resolves existing encoded filenames and rejects missing files/directories", () => {
    expect(resolveExistingUploadFilePath("/api/files/project/image%20one.png")).toBe(realpathSync(join(root, "uploads", "project", "image one.png")));
    expect(resolveExistingUploadFilePath("/api/files/project/missing.png")).toBeNull();
    expect(resolveExistingUploadFilePath("/api/files/project")).toBeNull();
  });

  it.each([
    "/api/files/../outside.png",
    "/api/files/%2e%2e%2foutside.png",
    "/api/files/project/../../outside.png",
    "/api/files/..\\outside.png",
    "/api/files/%2e%2e%5coutside.png",
    "/api/files/C:/outside.png",
    "/api/files/project/image.png:stream",
    "/api/files/project/%00.png",
    "/api/files/%ZZ",
    "https://example.com/api/files/project/image.png",
  ])("rejects untrusted reference %s", (ref) => {
    expect(resolveUploadFilePath(ref)).toBeNull();
    expect(resolveExistingUploadFilePath(ref)).toBeNull();
  });

  it("rejects a junction/symlink whose target escapes uploads", async () => {
    // A Windows junction requires no Developer Mode or administrator privilege.
    await symlink(root, join(root, "uploads", "escape"), process.platform === "win32" ? "junction" : "dir");
    expect(resolveExistingUploadFilePath("/api/files/escape/outside.png")).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCapabilityContract } from "@/lib/provider-capability-contract";
import { persistProviderMedia, providerMediaRequestHeaders } from "@/lib/provider-media-persistence";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("provider media persistence", () => {
  it("adds credentials only to the provider-owned authenticated result endpoint", () => {
    const contract = resolveCapabilityContract({ capability: "video", provider: "openrouter", modelId: "vendor/video" });
    expect(providerMediaRequestHeaders(contract, "https://openrouter.ai/api/v1/videos/job/content", "secret")).toEqual({ Authorization: "Bearer secret" });
    expect(providerMediaRequestHeaders(contract, "https://cdn.example/video.mp4", "secret")).toBeUndefined();
  });

  it("persists a valid result and rejects oversized or invalid media", async () => {
    const root = await mkdtemp(join(tmpdir(), "mora-provider-media-"));
    roots.push(root);
    const destination = join(root, "result.png");
    const contract = resolveCapabilityContract({ capability: "image", provider: "openai", modelId: "gpt-image" });
    await persistProviderMedia({
      source: `data:image/png;base64,${PNG.toString("base64")}`,
      destination,
      kind: "image",
      contract,
      apiKey: "fixture",
    });
    expect((await readFile(destination)).equals(PNG)).toBe(true);

    await expect(persistProviderMedia({
      source: `data:image/png;base64,${PNG.toString("base64")}`,
      destination: join(root, "too-large.png"),
      kind: "image",
      contract: { ...contract, output: { ...contract.output, maxBytes: 8 } },
      apiKey: "fixture",
    })).rejects.toThrow(/安全上限/);

    const invalid = join(root, "invalid.png");
    await expect(persistProviderMedia({
      source: "data:text/html;base64,PGh0bWw+ZXJyb3I8L2h0bWw+",
      destination: invalid,
      kind: "image",
      contract,
      apiKey: "fixture",
    })).rejects.toThrow(/有效图片/);
    await expect(stat(invalid)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

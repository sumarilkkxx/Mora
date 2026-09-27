import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  readResponseBuffer: vi.fn(),
}));

vi.mock("@/lib/ssrf-guard", () => mocks);
vi.mock("@/lib/media-validate", () => ({ validateOrDelete: async () => true }));

import { resolveCapabilityContract } from "@/lib/provider-capability-contract";
import { persistProviderMedia } from "@/lib/provider-media-persistence";

const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("authenticated provider media download", () => {
  it("uses one SSRF and size-checked path for authenticated and public result URLs", async () => {
    mocks.safeFetch.mockResolvedValue(new Response("fixture", { status: 200 }));
    mocks.readResponseBuffer.mockResolvedValue(Buffer.from("fixture"));
    const root = await mkdtemp(join(tmpdir(), "mora-provider-auth-"));
    roots.push(root);
    const contract = resolveCapabilityContract({ capability: "video", provider: "openrouter", modelId: "vendor/video" });

    await persistProviderMedia({ source: "https://openrouter.ai/api/v1/videos/job/content", destination: join(root, "auth.mp4"), kind: "video", contract, apiKey: "secret" });
    await persistProviderMedia({ source: "https://cdn.example/public.mp4", destination: join(root, "public.mp4"), kind: "video", contract, apiKey: "secret" });

    expect(mocks.safeFetch).toHaveBeenNthCalledWith(1, expect.any(String), { headers: { Authorization: "Bearer secret" } });
    expect(mocks.safeFetch).toHaveBeenNthCalledWith(2, expect.any(String), { headers: undefined });
    expect(mocks.readResponseBuffer).toHaveBeenCalledTimes(2);
  });
});

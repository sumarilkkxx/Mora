// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai";

const provider = new OpenAIProvider({ name: "openai", apiKey: "test-only", baseUrl: "https://provider.example/v1" });
const a = "data:image/png;base64,AQ==", b = "data:image/png;base64,Ag==";
afterEach(() => vi.unstubAllGlobals());
describe("OpenAI reference images", () => {
  it("sends ordered plural references to the edit endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: "AQ==" }] }));
    vi.stubGlobal("fetch", fetcher);
    await provider.generateImage({ modelId: "gpt-image-1", mode: "text-to-image", prompt: "test", referenceImageUrls: [a, b] });
    expect(fetcher.mock.calls[0][0]).toBe("https://provider.example/v1/images/edits");
    const form = fetcher.mock.calls[0][1].body as FormData;
    const files = form.getAll("image[]") as File[];
    expect(await Promise.all(files.map(async file => [...new Uint8Array(await file.arrayBuffer())]))).toEqual([[1], [2]]);
  });
  it("rejects private reference URLs before any download or provider call", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("private"));
    vi.stubGlobal("fetch", fetcher);
    await expect(provider.generateImage({ modelId: "gpt-image-1", mode: "text-to-image", prompt: "test", referenceImageUrl: "http://127.0.0.1/private" })).rejects.toThrow(/目标地址被拒绝/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("deduplicates singleton/plural references without reordering them", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: "AQ==" }] }));
    vi.stubGlobal("fetch", fetcher);
    await provider.generateImage({ modelId: "gpt-image-1", mode: "image-to-image", prompt: "test", referenceImageUrl: a, referenceImageUrls: [a, b] });
    expect((fetcher.mock.calls[0][1].body as FormData).getAll("image[]")).toHaveLength(2);
  });
  it("rejects multiple DALL-E 2 references and oversized inline images before sending", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(provider.generateImage({ modelId: "dall-e-2", mode: "image-to-image", prompt: "test", referenceImageUrls: [a, b] })).rejects.toThrow(/仅支持一张/);
    await expect(provider.generateImage({ modelId: "gpt-image-1", mode: "image-to-image", prompt: "test", referenceImageUrl: "data:image/png;base64," + "A".repeat(28 * 1024 * 1024) })).rejects.toThrow(/20MB/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("stops oversized remote images before the provider upload", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("small", { headers: { "content-length": String(21 * 1024 * 1024) } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(provider.generateImage({ modelId: "gpt-image-1", mode: "image-to-image", prompt: "test", referenceImageUrl: "https://93.184.216.34/image" })).rejects.toThrow(/超过上限/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

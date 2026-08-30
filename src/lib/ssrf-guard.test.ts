import { afterEach, describe, expect, it, vi } from "vitest";
import { readResponseBuffer, safeFetch } from "@/lib/ssrf-guard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readResponseBuffer", () => {
  it("returns a response body that fits the byte budget", async () => {
    const response = new Response(new Uint8Array([1, 2, 3, 4]));
    await expect(readResponseBuffer(response, 4)).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("rejects an oversized declared content length before buffering", async () => {
    const response = new Response("small", { headers: { "content-length": "101" } });
    await expect(readResponseBuffer(response, 100, "测试文件")).rejects.toThrow("超过上限");
  });

  it("stops a chunked response as soon as its accumulated size exceeds the budget", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
        controller.enqueue(new Uint8Array(3));
        controller.close();
      },
    });
    await expect(readResponseBuffer(new Response(body), 5, "测试文件")).rejects.toThrow("超过上限");
  });
});

describe("safeFetch", () => {
  it("does not forward authorization when a redirect changes origin", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: "https://93.184.216.35/file" },
      }))
      .mockResolvedValueOnce(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await safeFetch("https://93.184.216.34/start", {
      headers: { Authorization: "Bearer secret", "X-Trace": "keep" },
    });

    const redirectedInit = fetchMock.mock.calls[1][1] as RequestInit;
    const redirectedHeaders = new Headers(redirectedInit.headers);
    expect(redirectedHeaders.get("authorization")).toBeNull();
    expect(redirectedHeaders.get("x-trace")).toBe("keep");
  });
});

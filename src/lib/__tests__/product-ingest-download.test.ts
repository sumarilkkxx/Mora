// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const { fetcher } = vi.hoisted(() => ({ fetcher: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/ssrf-guard", async (original) => ({ ...await original<typeof import("@/lib/ssrf-guard")>(), safeFetch: fetcher }));
import { POST } from "@/app/api/ingest/product/route";
const request = () => new NextRequest("http://localhost/api/ingest/product", { method: "POST", body: JSON.stringify({ url: "https://fixture.invalid/product", createProject: false }) });
afterEach(() => { vi.restoreAllMocks(); fetcher.mockReset(); });
describe("bounded product HTML downloads", () => {
  it("cancels chunked oversized bodies instead of buffering the entire response", async () => {
    const cancel = vi.fn();
    fetcher.mockResolvedValue(new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); }, cancel }), { headers: { "content-type": "text/html" } }));
    expect((await POST(request())).status).toBe(502);
    expect(cancel).toHaveBeenCalled();
  });
  it("keeps the deadline active after headers arrive", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    fetcher.mockImplementation(async (_url, init) => new Response(new ReadableStream({ start(stream) {
      init.signal.addEventListener("abort", () => stream.error(new DOMException("Timed out", "AbortError")), { once: true });
      setTimeout(() => controller.abort(), 10);
    } }), { headers: { "content-type": "text/html" } }));
    expect((await POST(request())).status).toBe(502);
    expect(timeout).toHaveBeenCalledWith(15000);
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { waitForBatchComposition } from "@/lib/batch-compose";
describe("batch composition recovery", () => {
  it("polls the existing ID through pending/composing to done using GET only", async () => {
    const fetcher = vi.fn();
    for (const status of ["pending", "composing", "done"]) fetcher.mockResolvedValueOnce(Response.json({ composition: { status } }));
    await expect(waitForBatchComposition("p", "original", () => false, { fetcher, sleep: async () => {} })).resolves.toBe("done");
    expect(fetcher.mock.calls).toEqual(Array(3).fill(["/api/project/p/compose?compositionId=original"]));
  });
  it.each([null, "unknown"])("does not authorize retry for unknown status %s", async (status) => {
    await expect(waitForBatchComposition("p", "c", () => false, { fetcher: vi.fn().mockResolvedValue(Response.json({ composition: { status } })) })).rejects.toThrow();
  });
  it("propagates transport failures and HTTP errors", async () => {
    await expect(waitForBatchComposition("p", "c", () => false, { fetcher: vi.fn().mockRejectedValue(new Error("offline")) })).rejects.toThrow("offline");
    await expect(waitForBatchComposition("p", "c", () => false, { fetcher: vi.fn().mockResolvedValue(new Response("bad", { status: 500 })) })).rejects.toThrow("500");
  });
  it("permits a retry only for confirmed failure, never for cancellation", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ composition: { status: "failed" } }));
    await expect(waitForBatchComposition("p", "c", () => false, { fetcher })).resolves.toBe("failed");
    fetcher.mockClear();
    await expect(waitForBatchComposition("p", "c", () => true, { fetcher })).resolves.toBe("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

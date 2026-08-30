import { describe, it, expect } from "vitest";
import { classifyError, friendlyError } from "@/lib/friendly-error";

describe("classifyError", () => {
  it("网络/超时", () => {
    expect(classifyError(new Error("Failed to fetch"))).toBe("network");
    expect(classifyError(new Error("The operation was aborted due to timeout"))).toBe("network");
    expect(classifyError("fetch failed")).toBe("network");
  });
  it("鉴权(401/403/key)", () => {
    expect(classifyError(new Error("Request failed: 401 Unauthorized"))).toBe("auth");
    expect(classifyError(new Error("invalid api key"))).toBe("auth");
  });
  it("限流(429)", () => {
    expect(classifyError(new Error("429 Too Many Requests"))).toBe("ratelimit");
  });
  it("服务端(5xx)", () => {
    expect(classifyError(new Error("502 Bad Gateway"))).toBe("server");
  });
  it("内容策略拒绝", () => {
    expect(classifyError(new Error("The response was filtered due to the prompt triggering our content management policy."))).toBe("content-policy");
  });
  it("未知", () => {
    expect(classifyError(new Error("某业务校验失败"))).toBe("unknown");
  });
});

describe("friendlyError", () => {
  it("分类命中 → 可操作中/英文案", () => {
    expect(friendlyError(new Error("Failed to fetch"), "zh")).toMatch(/网络/);
    expect(friendlyError(new Error("Failed to fetch"), "en")).toMatch(/Network/);
    expect(friendlyError(new Error("401"), "zh")).toMatch(/设置/);
    expect(friendlyError(new Error("429"), "en")).toMatch(/Rate-limited/);
    expect(friendlyError(new Error("response was filtered due to content policy"), "zh")).toMatch(/内容策略/);
  });
  it("未知 → 保留原始信息、空则兜底", () => {
    expect(friendlyError(new Error("业务X失败"), "zh")).toBe("业务X失败");
    expect(friendlyError("", "zh")).toMatch(/出错了/);
  });
});

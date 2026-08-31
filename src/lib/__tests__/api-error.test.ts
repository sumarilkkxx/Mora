import { describe, it, expect } from "vitest";
import { pickLocale, errText, apiError } from "@/lib/api-error";

/** build a fake request exposing only headers.get, matching what the helper reads */
function reqWith(acceptLanguage?: string) {
  return { headers: { get: (n: string) => (n.toLowerCase() === "accept-language" ? acceptLanguage ?? null : null) } };
}

describe("pickLocale（按 Accept-Language 选语言，域内默认中文）", () => {
  it("英文浏览器 → en", () => {
    expect(pickLocale(reqWith("en-US,en;q=0.9,zh;q=0.8"))).toBe("en");
    expect(pickLocale(reqWith("en"))).toBe("en");
  });
  it("中文浏览器 / 缺头 / 其它 → zh（默认）", () => {
    expect(pickLocale(reqWith("zh-CN,zh;q=0.9"))).toBe("zh");
    expect(pickLocale(reqWith(undefined))).toBe("zh");
    expect(pickLocale(reqWith(""))).toBe("zh");
    expect(pickLocale(reqWith("ja,zh;q=0.8"))).toBe("zh"); // 非英文首选 → 默认中文
  });
});

describe("errText / apiError", () => {
  it("中文客户端逐字返回中文原文", () => {
    expect(errText(reqWith("zh-CN"), "无效的项目ID", "Invalid project ID")).toBe("无效的项目ID");
  });
  it("英文客户端返回英文", () => {
    expect(errText(reqWith("en-US"), "无效的项目ID", "Invalid project ID")).toBe("Invalid project ID");
  });
  it("apiError 返回带 error 字段的响应、默认 400", async () => {
    const res = apiError(reqWith("en"), "缺少商品名称", "Missing product name");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing product name" });
    const res2 = apiError(reqWith("zh"), "项目不存在", "Project not found", 404);
    expect(res2.status).toBe(404);
    expect(await res2.json()).toEqual({ error: "项目不存在" });
  });
});

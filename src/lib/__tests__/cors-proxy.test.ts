import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/**
 * Local-tool CORS (v0.8.79): /api/* reflects localhost origins only, so browser
 * pages on other local ports (the infinite-canvas Mora node) can call us,
 * while a remote malicious page — whose origin can never be localhost — still
 * hits the browser's same-origin wall. These tests pin that security boundary.
 */

const url = "http://localhost:3457/api/health";

describe("CORS proxy 安全边界", () => {
  it("localhost 任意端口来源：预检 204 + 头精确回显", () => {
    const res = proxy(
      new NextRequest(url, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:3800", "access-control-request-headers": "content-type" },
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3800");
    expect(res.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("127.0.0.1 来源同样放行（普通请求加头）", () => {
    const res = proxy(new NextRequest(url, { method: "GET", headers: { origin: "http://127.0.0.1:5173" } }));
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
  });

  it("非 localhost 来源：零 CORS 头（浏览器墙保持完整）", () => {
    for (const origin of ["https://evil.example.com", "http://localhost.evil.com", "http://sub.localhost:3800"]) {
      const res = proxy(new NextRequest(url, { method: "GET", headers: { origin } }));
      expect(res.headers.get("access-control-allow-origin"), `origin ${origin} 不应被放行`).toBeNull();
    }
  });

  it("同源/无 Origin 请求不受影响", () => {
    const res = proxy(new NextRequest(url, { method: "GET" }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

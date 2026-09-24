import { afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { internalApiHeaders, trustedInternalApiOrigin } from "@/lib/internal-api";
const url = "http://localhost:3457/api/project";
afterEach(() => vi.unstubAllEnvs());
describe("API request boundary", () => {
  it.each(["https://evil.example", "null", "http://localhost:3800", "http://localhost.evil.com"])("rejects simple POST and preflight from %s", (origin) => {
    for (const method of ["POST", "OPTIONS"]) {
      expect(proxy(new NextRequest(url, { method, headers: { origin, "content-type": "text/plain" } })).status).toBe(403);
    }
  });
  it("allows same-origin JSON and rejects simple body formats", () => {
    expect(proxy(new NextRequest(url, { method: "POST", headers: { origin: "http://localhost:3457", "content-type": "application/json" } })).status).toBe(200);
    expect(proxy(new NextRequest(url, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    for (const type of ["text/plain", "application/x-www-form-urlencoded"]) {
      expect(proxy(new NextRequest(url, { method: "POST", headers: { "content-type": type } })).status).toBe(415);
    }
    expect(proxy(new NextRequest(url)).status).toBe(200);
  });
  it("requires a configured token for UI, downloads and CLI", () => {
    vi.stubEnv("MORA_API_TOKEN", "fixture-secret");
    expect(proxy(new NextRequest(url)).status).toBe(401);
    expect(proxy(new NextRequest(url, { headers: { "x-mora-token": "wrong" } })).status).toBe(401);
    expect(proxy(new NextRequest(url, { headers: { "x-mora-token": "fixture-secret" } })).status).toBe(200);
    expect(() => internalApiHeaders("https://evil.example")).toThrow();
    vi.stubEnv("MORA_SERVER_ORIGIN", "http://localhost:3457");
    expect(internalApiHeaders("http://localhost:3457")["x-mora-token"]).toBe("fixture-secret");
    expect(() => internalApiHeaders("http://localhost:9999")).toThrow();
  });
  it("uses the public host when Next normalizes its internal request URL", () => {
    expect(proxy(new NextRequest(url, { method: "POST", headers: { host: "127.0.0.1:3457", origin: "http://127.0.0.1:3457", "content-type": "application/json" } })).status).toBe(200);
  });
  it("never derives a credential-bearing self-request from an untrusted host", () => {
    expect(trustedInternalApiOrigin("http://127.0.0.1:3457/api/project")).toBe("http://127.0.0.1:3457");
    expect(() => trustedInternalApiOrigin("https://attacker.example/api/project")).toThrow(/MORA_SERVER_ORIGIN/);
    vi.stubEnv("MORA_SERVER_ORIGIN", "http://127.0.0.1:4567");
    expect(trustedInternalApiOrigin("https://attacker.example/api/project")).toBe("http://127.0.0.1:4567");
    vi.stubEnv("MORA_SERVER_ORIGIN", "file:///tmp/mora");
    expect(() => trustedInternalApiOrigin("http://127.0.0.1:3457/api/project")).toThrow(/HTTP/);
  });
});

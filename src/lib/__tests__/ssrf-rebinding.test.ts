// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { LookupFunction } from "net";
const fake = vi.hoisted(() => ({ lookup: vi.fn(), connectLookup: undefined as LookupFunction | undefined }));
vi.mock("dns/promises", () => ({ lookup: fake.lookup }));
vi.mock("undici", () => ({ Agent: class { constructor(options: { connect: { lookup: LookupFunction } }) { fake.connectLookup = options.connect.lookup; } } }));
import { safeFetch } from "../ssrf-guard";
afterEach(() => vi.unstubAllGlobals());
it("rejects a changed DNS answer at connection time while keeping the hostname", async () => {
  fake.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    expect(url).toBe("https://untrusted.example/image");
    expect(init.dispatcher).toBeDefined();
    return new Promise((resolve, reject) => fake.connectLookup!("untrusted.example", {}, error => error ? reject(error) : resolve(new Response("unsafe"))));
  }));
  await expect(safeFetch("https://untrusted.example/image")).rejects.toThrow(/目标地址被拒绝/);
  expect(fake.lookup).toHaveBeenCalledTimes(2);
});

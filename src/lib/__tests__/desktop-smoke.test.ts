// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
const { checkServer } = createRequire(import.meta.url)("../../../electron/smoke-check.cjs");

describe("desktop smoke checks", () => {
  it.each(["ok", "http500", "migration", "invalid", "timeout"])("handles %s without false success", async (mode) => {
    const server = createServer((req, res) => {
      expect(req.headers["x-mora-token"]).toBe("fixture");
      if (mode === "timeout") return;
      if (mode === "http500") { res.writeHead(500).end("failed"); return; }
      if (mode === "invalid") { res.end("not json"); return; }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(req.url === "/api/health" ? { db: { status: "ok", initError: null, migrationError: mode === "migration" ? "broken" : null } } : []));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    try {
      const check = checkServer(`http://127.0.0.1:${address.port}`, "fixture", 100);
      if (mode === "ok") await expect(check).resolves.toBeUndefined();
      else await expect(check).rejects.toThrow();
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});

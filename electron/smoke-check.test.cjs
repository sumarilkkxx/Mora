const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { checkServer } = require("./smoke-check.cjs");

test("desktop smoke verifies migrations, a DB route, and the core start page", async () => {
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push(request.url);
    response.statusCode = 200;
    if (request.url === "/api/health") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ db: { status: "ok", initError: null, migrationError: null } }));
    } else if (request.url === "/api/project") {
      response.setHeader("content-type", "application/json");
      response.end("[]");
    } else {
      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><html><head><title>Mora</title></head><body>Mora</body></html>");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  try {
    const address = /** @type {import("node:net").AddressInfo} */ (server.address());
    assert.equal(typeof address, "object");
    await checkServer(`http://127.0.0.1:${address.port}`, "fixture-token", 1000);
    assert.deepEqual(seen, ["/api/health", "/api/project", "/start"]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkForDesktopUpdate, compareVersions } = require("./update-check.cjs");

test("compares four-part desktop versions numerically", () => {
  assert.equal(compareVersions("0.2.10.0", "0.2.9.9"), 1);
  assert.equal(compareVersions("v0.2.1.0", "0.2.1"), 0);
  assert.equal(compareVersions("0.1.9.9", "0.2.0.0"), -1);
});

test("returns only a manual GitHub release link for a newer public release", async () => {
  const result = await checkForDesktopUpdate({
    currentVersion: "0.2.1.0",
    fetchImpl: async () => ({
      ok: true,
      json: async () => [
        { tag_name: "v0.2.1.0", draft: false, html_url: "https://github.com/sumarilkkxx/Mora/releases/tag/v0.2.1.0" },
        { tag_name: "v0.3.0.0", draft: true, html_url: "https://github.com/sumarilkkxx/Mora/releases/tag/v0.3.0.0" },
        { tag_name: "v0.2.2.0", draft: false, html_url: "https://github.com/sumarilkkxx/Mora/releases/tag/v0.2.2.0" },
      ],
    }),
  });
  assert.deepEqual(result, {
    available: true,
    currentVersion: "0.2.1.0",
    latestVersion: "0.2.2.0",
    downloadUrl: "https://github.com/sumarilkkxx/Mora/releases/tag/v0.2.2.0",
  });
  assert.equal("installer" in result, false);
});

test("rejects untrusted release links and tolerates update service failures", async () => {
  await assert.rejects(() => checkForDesktopUpdate({
    currentVersion: "0.2.1.0",
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{ tag_name: "v9.0.0.0", draft: false, html_url: "https://example.test/update" }],
    }),
  }), /untrusted/i);
  const result = await checkForDesktopUpdate({
    currentVersion: "0.2.1.0",
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.deepEqual(result, { available: false, currentVersion: "0.2.1.0", reason: "service-unavailable" });
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveDesktopVersion } = require("./desktop-version.cjs");

test("uses Electron's packaged app version without source-only build metadata", () => {
  const packagedManifest = { name: "mora", version: "0.2.1", main: "electron/main.js" };
  const electronApp = { getVersion: () => packagedManifest.version };

  assert.equal(resolveDesktopVersion(electronApp), "0.2.1");
});

test("rejects an invalid packaged app version", () => {
  assert.throws(
    () => resolveDesktopVersion({ getVersion: () => "development" }),
    /Invalid desktop version/,
  );
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { labelDesktopArtifacts } = require("./label-desktop-artifacts.cjs");

test("labels only top-level desktop installers and is idempotent", () => {
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "mora-artifacts-"));
  try {
    fs.writeFileSync(path.join(releaseDir, "Mora-Setup-v0.2.1.0-win-x64.exe"), "installer");
    fs.writeFileSync(path.join(releaseDir, "Mora-v0.2.1.0-mac-arm64.dmg"), "image");
    fs.writeFileSync(path.join(releaseDir, "latest.yml"), "metadata");
    fs.mkdirSync(path.join(releaseDir, "win-unpacked"));
    fs.writeFileSync(path.join(releaseDir, "win-unpacked", "Mora.exe"), "app");

    const first = labelDesktopArtifacts(releaseDir, "unsigned-dev");
    assert.deepEqual(first.map(file => path.basename(file)).sort(), [
      "Mora-Setup-v0.2.1.0-win-x64-unsigned-dev.exe",
      "Mora-v0.2.1.0-mac-arm64-unsigned-dev.dmg",
    ]);
    assert.deepEqual(labelDesktopArtifacts(releaseDir, "unsigned-dev"), first);
    assert.equal(fs.existsSync(path.join(releaseDir, "win-unpacked", "Mora.exe")), true);
    assert.equal(fs.existsSync(path.join(releaseDir, "latest.yml")), true);
  } finally {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }
});

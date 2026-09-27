const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { verifyDesktopReleaseReports } = require("./verify-desktop-release-reports.cjs");

test("requires all three verified desktop release reports and matching installers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mora-release-reports-"));
  const put = (name, report) => fs.writeFileSync(path.join(root, name), JSON.stringify(report));
  const putArtifact = name => fs.writeFileSync(path.join(root, name), "installer");
  const report = (platform, arch, artifact, overrides = {}) => ({
    platform,
    arch,
    channel: "official",
    releaseEligible: true,
    artifact,
    checkedAt: "2026-09-27T00:00:00.000Z",
    signingExpectation: "unsigned-open-source",
    ...overrides,
  });
  try {
    putArtifact("Mora.exe");
    putArtifact("Mora-arm64.dmg");
    putArtifact("Mora-x64.dmg");
    put("desktop-release-windows-x64.json", report("windows", "x64", "Mora.exe"));
    put("desktop-release-macos-arm64.json", report("macos", "arm64", "Mora-arm64.dmg"));
    assert.throws(() => verifyDesktopReleaseReports(root), /Expected 3/);
    put("desktop-release-macos-x64.json", report("macos", "x64", "Mora-x64.dmg", { channel: "development", releaseEligible: false }));
    assert.throws(() => verifyDesktopReleaseReports(root), /not release eligible/);
    put("desktop-release-macos-x64.json", report("macos", "x64", "Mora-x64.dmg"));
    put("desktop-release-macos-arm64.json", report("macos", "x64", "Mora-arm64.dmg"));
    assert.throws(() => verifyDesktopReleaseReports(root), /targets/);
    put("desktop-release-macos-arm64.json", report("macos", "arm64", "Mora-arm64.dmg"));
    assert.equal(verifyDesktopReleaseReports(root).length, 3);
    const installerDir = path.join(root, "release");
    fs.mkdirSync(installerDir);
    for (const artifact of ["Mora.exe", "Mora-arm64.dmg", "Mora-x64.dmg"]) {
      fs.renameSync(path.join(root, artifact), path.join(installerDir, artifact));
    }
    fs.mkdirSync(path.join(root, "test-results"));
    for (const name of fs.readdirSync(root).filter(name => name.endsWith(".json"))) {
      fs.renameSync(path.join(root, name), path.join(root, "test-results", name));
    }
    assert.equal(verifyDesktopReleaseReports(root).length, 3);
    fs.writeFileSync(path.join(root, "Mora.exe"), "duplicate installer");
    assert.throws(() => verifyDesktopReleaseReports(root), /missing or duplicated/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("accepts release reports nested by artifact upload while installers stay at the root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mora-release-reports-nested-"));
  const reportDir = path.join(root, "test-results");
  fs.mkdirSync(reportDir);
  const report = (platform, arch, artifact) => ({
    platform,
    arch,
    channel: "official",
    releaseEligible: true,
    artifact,
    checkedAt: "2026-09-27T00:00:00.000Z",
    signingExpectation: "unsigned-open-source",
  });
  try {
    fs.writeFileSync(path.join(root, "Mora.exe"), "installer");
    fs.writeFileSync(path.join(root, "Mora-arm64.dmg"), "installer");
    fs.writeFileSync(path.join(root, "Mora-x64.dmg"), "installer");
    fs.writeFileSync(path.join(reportDir, "desktop-release-windows-x64.json"), JSON.stringify(report("windows", "x64", "Mora.exe")));
    fs.writeFileSync(path.join(reportDir, "desktop-release-macos-arm64.json"), JSON.stringify(report("macos", "arm64", "Mora-arm64.dmg")));
    fs.writeFileSync(path.join(reportDir, "desktop-release-macos-x64.json"), JSON.stringify(report("macos", "x64", "Mora-x64.dmg")));

    assert.equal(verifyDesktopReleaseReports(root).length, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

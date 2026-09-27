const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  finalizeDesktopRelease,
  inspectDesktopArtifact,
  planDesktopRelease,
} = require("./desktop-release-contract.cjs");

test("development builds are explicitly unsigned and never release eligible", () => {
  const plan = planDesktopRelease({ platform: "windows", arch: "x64", channel: "development", env: {} });
  assert.deepEqual(plan, {
    schemaVersion: 2,
    platform: "windows",
    arch: "x64",
    channel: "development",
    signingExpectation: "unsigned-development",
    artifactSuffix: "unsigned-dev",
    forceCodeSigning: false,
    credentialKinds: [],
    releaseEligible: false,
  });
});

test("official Windows builds may ship as explicitly unsigned open-source artifacts", () => {
  const plan = planDesktopRelease({ platform: "windows", arch: "x64", channel: "official", env: {} });
  assert.equal(plan.signingExpectation, "unsigned-open-source");
  assert.equal(plan.artifactSuffix, "unsigned");
  assert.equal(plan.forceCodeSigning, false);
  const report = finalizeDesktopRelease(plan, { codeSigned: false, signatureStatus: "NotSigned", artifact: "Mora.exe" });
  assert.equal(report.releaseEligible, true);
});

test("partial Windows signing configuration still fails before packaging", () => {
  assert.throws(
    () => planDesktopRelease({ platform: "windows", arch: "x64", channel: "official", env: { WIN_CSC_LINK: "certificate" } }),
    /WIN_CSC_KEY_PASSWORD/,
  );
});

test("official macOS builds may ship unsigned but reject partial signing configuration", () => {
  const unsigned = planDesktopRelease({ platform: "macos", arch: "arm64", channel: "official", env: {} });
  assert.equal(unsigned.signingExpectation, "unsigned-open-source");
  assert.equal(unsigned.artifactSuffix, "unsigned");
  assert.equal(unsigned.forceCodeSigning, false);
  assert.equal(finalizeDesktopRelease(unsigned, { codeSigned: false, notarized: false }).releaseEligible, true);
  assert.throws(
    () => planDesktopRelease({ platform: "macos", arch: "arm64", channel: "official", env: { CSC_LINK: "certificate", CSC_KEY_PASSWORD: "private" } }),
    /both signing and one complete notarization/i,
  );
});

test("complete optional macOS signing configuration remains supported", () => {
  const plan = planDesktopRelease({
    platform: "macos",
    arch: "arm64",
    channel: "official",
    env: {
      CSC_LINK: "certificate-secret",
      CSC_KEY_PASSWORD: "password-secret",
      APPLE_API_KEY: "api-key-secret",
      APPLE_API_KEY_ID: "key-id",
      APPLE_API_ISSUER: "issuer-id",
    },
  });
  assert.deepEqual(plan.credentialKinds, ["mac-signing", "apple-api-key-notarization"]);
  assert.equal(JSON.stringify(plan).includes("certificate-secret"), false);
  assert.equal(plan.forceCodeSigning, true);
});

test("configured signed artifacts remain ineligible until signature and notarization observations pass", () => {
  const plan = planDesktopRelease({
    platform: "macos",
    arch: "arm64",
    channel: "official",
    env: {
      CSC_LINK: "certificate",
      CSC_KEY_PASSWORD: "password",
      APPLE_ID: "release@example.test",
      APPLE_APP_SPECIFIC_PASSWORD: "app-password",
      APPLE_TEAM_ID: "TEAM123",
    },
  });
  assert.throws(() => finalizeDesktopRelease(plan, { codeSigned: true, notarized: false, signer: "Developer ID Application: Fixture" }), /notarization/i);
  const report = finalizeDesktopRelease(plan, { codeSigned: true, notarized: true, signer: "Developer ID Application: Fixture" });
  assert.equal(report.releaseEligible, true);
  assert.equal(report.signer, "Developer ID Application: Fixture");
});

test("configured Windows signing requires an Authenticode Valid observation", () => {
  const plan = planDesktopRelease({ platform: "windows", arch: "x64", channel: "official", env: { WIN_CSC_LINK: "certificate", WIN_CSC_KEY_PASSWORD: "password" } });
  assert.throws(() => finalizeDesktopRelease(plan, { codeSigned: false, signatureStatus: "NotSigned" }), /Authenticode/);
  const report = finalizeDesktopRelease(plan, { codeSigned: true, signatureStatus: "Valid", signer: "CN=Mora Fixture" });
  assert.equal(report.releaseEligible, true);
  assert.equal(report.notarized, null);
});

test("unsigned development observations produce a machine report without becoming formal", () => {
  const plan = planDesktopRelease({ platform: "macos", arch: "x64", channel: "development", env: {} });
  const report = finalizeDesktopRelease(plan, { codeSigned: false, notarized: false, signatureStatus: "unsigned" });
  assert.equal(report.releaseEligible, false);
  assert.equal(report.signingExpectation, "unsigned-development");
});

test("macOS inspection reports the signer and stapled notarization through system tools", () => {
  const observed = inspectDesktopArtifact({
    platform: "macos",
    artifact: "/tmp/Mora.dmg",
    appPath: "/tmp/Mora.app",
    run(command, args) {
      if (command === "codesign" && args[0] === "--verify") return "";
      if (command === "codesign") return "Authority=Developer ID Application: Mora Fixture\nTeamIdentifier=TEAM123\n";
      if (command === "xcrun") return "The validate action worked!";
      throw new Error(`Unexpected command: ${command}`);
    },
  });
  assert.deepEqual(observed, {
    artifact: "/tmp/Mora.dmg",
    codeSigned: true,
    notarized: true,
    signatureStatus: "valid",
    signer: "Developer ID Application: Mora Fixture",
  });
});

test("Windows inspection uses Authenticode status without leaking certificate material", () => {
  const observed = inspectDesktopArtifact({
    platform: "windows",
    artifact: "C:\\release\\Mora.exe",
    run: () => JSON.stringify({ Status: "Valid", Subject: "CN=Mora Fixture", Thumbprint: "sensitive-thumbprint" }),
  });
  assert.deepEqual(observed, {
    artifact: "C:\\release\\Mora.exe",
    codeSigned: true,
    notarized: null,
    signatureStatus: "Valid",
    signer: "CN=Mora Fixture",
  });
  assert.equal(JSON.stringify(observed).includes("sensitive-thumbprint"), false);
});

const fs = require("node:fs");
const path = require("node:path");

function verifyDesktopReleaseReports(reportDir) {
  const files = fs.readdirSync(reportDir)
    .filter(name => /^desktop-release-.+\.json$/.test(name))
    .sort();
  if (files.length !== 3) throw new Error(`Expected 3 desktop release reports, found ${files.length}`);
  const reports = files.map(name => JSON.parse(fs.readFileSync(path.join(reportDir, name), "utf8")));
  const artifacts = new Set();
  for (const report of reports) {
    if (report.channel !== "official" || report.releaseEligible !== true) {
      throw new Error(`${report.artifact ?? "Unknown desktop artifact"} is not release eligible`);
    }
    if (!report.checkedAt || !report.artifact) {
      throw new Error("Desktop release report is missing artifact verification evidence");
    }
    if (!['unsigned-open-source', 'authenticode-signed', 'signed-and-notarized'].includes(report.signingExpectation)) {
      throw new Error(`${report.artifact} has an unsupported signing expectation`);
    }
    if (artifacts.has(report.artifact) || !fs.existsSync(path.join(reportDir, report.artifact))) {
      throw new Error(`${report.artifact} is missing or duplicated in release assets`);
    }
    artifacts.add(report.artifact);
  }
  const targets = reports.map(report => `${report.platform}/${report.arch}`).sort();
  const expectedTargets = ["macos/arm64", "macos/x64", "windows/x64"];
  if (JSON.stringify(targets) !== JSON.stringify(expectedTargets)) {
    throw new Error(`Release reports do not cover required targets: ${expectedTargets.join(", ")}`);
  }
  return reports;
}

if (require.main === module) {
  try {
    const reports = verifyDesktopReleaseReports(process.argv[2] ?? "release-assets");
    for (const report of reports) console.log(`${report.artifact}: ${report.signingExpectation}`);
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = { verifyDesktopReleaseReports };

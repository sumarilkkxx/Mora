const fs = require("node:fs");
const path = require("node:path");

function findReleaseFiles(rootDir) {
  const files = [];
  const visit = currentDir => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  };
  visit(rootDir);
  return files.sort();
}

function verifyDesktopReleaseReports(reportDir) {
  const releaseFiles = findReleaseFiles(reportDir);
  const files = releaseFiles.filter(file => /^desktop-release-.+\.json$/.test(path.basename(file)));
  if (files.length !== 3) throw new Error(`Expected 3 desktop release reports, found ${files.length}`);
  const reports = files.map(file => JSON.parse(fs.readFileSync(file, "utf8")));
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
    const matches = releaseFiles.filter(file => path.basename(file) === report.artifact);
    if (artifacts.has(report.artifact) || matches.length !== 1) {
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

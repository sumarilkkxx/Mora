const fs = require("node:fs");
const {
  finalizeDesktopRelease,
  inspectDesktopArtifact,
  planDesktopRelease,
  writeReport,
} = require("./desktop-release-contract.cjs");

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  for (const token of tokens) {
    if (!token.startsWith("--") || !token.includes("=")) throw new Error(`Invalid argument: ${token}`);
    const [name, ...parts] = token.slice(2).split("=");
    options[name] = parts.join("=");
  }
  return { command, options };
}

function appendGithubOutput(values, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  fs.appendFileSync(outputPath, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
}

function run(argv = process.argv.slice(2), env = process.env) {
  const { command, options } = parseArguments(argv);
  if (!options.report) throw new Error("--report is required");
  if (command === "preflight") {
    const plan = planDesktopRelease({ platform: options.platform, arch: options.arch, channel: options.channel, env });
    writeReport(options.report, plan);
    appendGithubOutput({
      artifact_suffix: plan.artifactSuffix,
      force_code_signing: String(plan.forceCodeSigning),
      report_path: options.report,
    }, env.GITHUB_OUTPUT);
    return plan;
  }
  if (command === "verify") {
    const plan = JSON.parse(fs.readFileSync(options.report, "utf8"));
    const observed = inspectDesktopArtifact({
      platform: plan.platform,
      artifact: options.artifact,
      appPath: options.app,
    });
    const report = finalizeDesktopRelease(plan, observed);
    writeReport(options.report, report);
    return report;
  }
  throw new Error(`Unsupported command: ${command ?? "(missing)"}`);
}

if (require.main === module) {
  try {
    const report = run();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = { parseArguments, run };

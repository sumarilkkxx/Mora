import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const contractPath = resolve(root, "e2e/matrix-contract.json");
if (!existsSync(contractPath)) throw new Error("E2E matrix contract is missing");
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
if (contract.version !== 1) throw new Error(`Unsupported E2E matrix version: ${contract.version}`);

const requiredGroups = { core: 3, advanced: 5, faults: 9 };
const ids = new Set();
for (const [group, minimum] of Object.entries(requiredGroups)) {
  const cases = contract[group];
  if (!Array.isArray(cases) || cases.length < minimum) throw new Error(`${group} requires at least ${minimum} cases`);
  for (const item of cases) {
    if (!item?.id || !item?.file || !item?.title) throw new Error(`${group} contains an incomplete case`);
    if (ids.has(item.id)) throw new Error(`Duplicate E2E matrix id: ${item.id}`);
    ids.add(item.id);
    const file = resolve(root, item.file);
    if (!existsSync(file)) throw new Error(`Matrix evidence file is missing for ${item.id}: ${item.file}`);
    if (!readFileSync(file, "utf8").includes(item.title)) throw new Error(`Matrix evidence title is missing for ${item.id}: ${item.title}`);
  }
}

for (const fault of ["provider-401", "provider-429", "provider-5xx", "provider-timeout", "process-restart", "missing-file", "disk-space", "cancel-race", "corrupt-media"]) {
  if (!ids.has(fault)) throw new Error(`Required fault is absent: ${fault}`);
}

const workflowPath = resolve(root, ".github/workflows/e2e-matrix.yml");
if (!existsSync(workflowPath)) throw new Error("E2E matrix CI workflow is missing");
const workflow = readFileSync(workflowPath, "utf8");
for (const marker of ["verify-e2e-matrix.mjs", "repeat: [1, 2]", "playwright-report-", "e2e-server.log", "NEXT_TELEMETRY_DISABLED"]) {
  if (!workflow.includes(marker)) throw new Error(`E2E matrix CI workflow is missing marker: ${marker}`);
}
const mediaPrepareIndex = workflow.indexOf("pnpm media:prepare");
const matrixRunIndex = workflow.indexOf("pnpm test:e2e:run");
if (mediaPrepareIndex < 0) throw new Error("E2E matrix CI workflow must prepare media binaries before running Playwright");
if (matrixRunIndex < 0 || mediaPrepareIndex > matrixRunIndex) {
  throw new Error("E2E matrix CI workflow must prepare media binaries before the hermetic matrix run");
}
if (!workflow.includes("FFMPEG_PATH: /usr/bin/ffmpeg")) {
  throw new Error("E2E matrix CI workflow must select Ubuntu's drawtext-capable FFmpeg");
}
if (!workflow.includes("ffmpeg -hide_banner -filters") || !workflow.includes("drawtext")) {
  throw new Error("E2E matrix CI workflow must verify drawtext support before running Playwright");
}
if (/\$\{\{\s*secrets\./.test(workflow)) throw new Error("Hermetic E2E workflow must not consume repository secrets");

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  totals: Object.fromEntries(Object.keys(requiredGroups).map(group => [group, contract[group].length])),
  cases: Object.values(requiredGroups).flatMap((_minimum, index) => contract[Object.keys(requiredGroups)[index]]),
};
const rendered = `${JSON.stringify(output, null, 2)}\n`;
const outputArg = process.argv.find(arg => arg.startsWith("--output="));
if (outputArg) {
  const destination = resolve(root, outputArg.slice("--output=".length));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, rendered);
}
process.stdout.write(rendered);

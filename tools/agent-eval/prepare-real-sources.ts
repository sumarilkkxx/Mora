import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { prepareRealSources, preflightRealSources } from "./real-sources";

async function main() {
  if (process.argv.includes("--prepare")) await prepareRealSources(process.argv.includes("--download"));
  const output = process.argv.find(s => s.startsWith("--output="))?.slice(9) ?? "evals/agent/real-source-preflight.json";
  const report = await preflightRealSources();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ tasks: report.tasks, independentAssets: report.independentAssets, sourceGroups: report.sourceGroups, output, providerCalls: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

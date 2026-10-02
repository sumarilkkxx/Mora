import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { CONSTRAINT_RECIPES, generateConstraintAssets, writeConstraintManifest } from "./constraint-fixtures";
import { fileSha256 } from "./real-sources";
async function main() {
  const selected = process.argv.find(s => s.startsWith("--case="))?.slice(7);
  const recipes = selected ? CONSTRAINT_RECIPES.filter(r => r.id === selected) : CONSTRAINT_RECIPES;
  if (!recipes.length) throw new Error("Unknown constraint case");
  const freezing = process.argv.includes("--write-manifest");
  if (freezing && selected) throw new Error("Cannot freeze a partial manifest");
  const directory = freezing ? undefined : await mkdtemp(join(tmpdir(), "mora-regression-regenerate-"));
  try {
  const generated = await generateConstraintAssets(directory, recipes);
  if (process.argv.includes("--write-manifest")) {
    if (selected) throw new Error("Cannot freeze a partial manifest");
    await writeConstraintManifest(generated);
  } else {
    const frozen = JSON.parse(await readFile("tools/agent-eval/sources/regression-fixtures-v1.json", "utf8"));
    const dataset = JSON.parse(await readFile("tools/agent-eval/datasets/regression-constraints.json", "utf8"));
    if (generated.version !== frozen.toolVersion) throw new Error("Fixture tool version drift; review before re-freezing");
    for (const result of generated.outputs) {
      const expected = frozen.outputs.find((o: { caseId: string }) => o.caseId === result.item.caseId);
      const expectedCase = dataset.cases.find((c: { caseId: string }) => c.caseId === result.item.caseId);
      if (!expected || !expectedCase || expectedCase.source.sha256 !== result.item.source.sha256 || expected.positiveSha256 !== await fileSha256(result.positive) || expected.negativeSha256 !== await fileSha256(result.negative)) throw new Error(`Fixture hash drift: ${result.item.caseId}; review generator/tool/font version, do not silently re-freeze`);
    }
  }
  const output = process.argv.find(s => s.startsWith("--output="))?.slice(9) ?? "evals/agent/constraint-proof.json";
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ evidenceMode: "real_media", providerCalls: 0, generated }, null, 2) + "\n");
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

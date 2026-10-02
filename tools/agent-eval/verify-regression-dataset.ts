import { loadRegressionDataset } from "./regression-dataset";
import { REGRESSION_CATEGORIES } from "./core/contracts";
async function main() {
  const { dataset, protocols } = await loadRegressionDataset();
  const natural = dataset.cases.filter(c => c.lineage?.origin !== "synthetic");
  console.log(JSON.stringify({
    recordedAt: new Date().toISOString(), datasetId: dataset.datasetId, version: dataset.version,
    cases: dataset.cases.length, categories: Object.fromEntries(REGRESSION_CATEGORIES.map(category => [category, dataset.cases.filter(c => c.category === category).length])),
    uniqueInputIds: new Set(dataset.cases.map(c => c.source.id)).size,
    naturalOriginalAssets: new Set(natural.map(c => c.source.id)).size, naturalSourceGroups: new Set(natural.map(c => c.source.group)).size,
    syntheticSourceFamilies: [...new Set(dataset.cases.filter(c => c.lineage?.origin === "synthetic").map(c => c.lineage!.sourceFamily))],
    quickCaseIds: protocols.quickCaseIds,
    protocols: Object.fromEntries(["agent", "constraint_render", "fault_runner"].map(kind => [kind, protocols.cases.filter(p => p.kind === kind).length])),
    exposedRetiredHoldoutCases: natural.filter(c => c.lineage?.origin === "retired_holdout").length,
    independentHoldout: dataset.independentHoldout, baselineEligible: dataset.baselineEligible,
    providerCalls: 0, boundary: "Manifest/source/oracle identities only. Natural source decoding, constraint renderer oracles and fixed runner logic have separate evidence. No paid Agent quality conclusion.",
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

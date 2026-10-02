import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileSha256 } from "./real-sources";
import { verifyMediaOutput } from "./media-oracles";

async function main() {
  const manifest = JSON.parse(await readFile("tools/agent-eval/sources/regression-faults-v1.json", "utf8"));
  const source = manifest.corruptSource as { path: string; sha256: string; parentPath: string; parentSha256: string; operation: string };
  if (source.operation !== "zero bytes after mdat marker") throw new Error("Unknown corrupt-source recipe");
  if (await fileSha256(source.parentPath) !== source.parentSha256) throw new Error("Corrupt-source parent SHA-256 mismatch; regenerate controlled fixture first");
  const bytes = await readFile(source.parentPath), offset = bytes.indexOf(Buffer.from("mdat"));
  if (offset < 4) throw new Error("Parent has no mdat payload");
  bytes.fill(0, offset + 4);
  if (createHash("sha256").update(bytes).digest("hex") !== source.sha256) throw new Error("Corrupt fixture hash drift");
  const partial = `${source.path}.part`;
  try { await writeFile(partial, bytes); await rename(partial, source.path); } finally { await rm(partial, { force: true }); }
  const evidence = await verifyMediaOutput(source.path);
  if (!evidence.exists || evidence.decodes || evidence.passed) throw new Error("Corrupt input was not rejected by the real decoder");
  console.log(JSON.stringify({ source, evidence, expectedRejectionVerified: true, providerCalls: 0 }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

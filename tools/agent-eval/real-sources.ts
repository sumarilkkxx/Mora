import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ffmpegBin } from "../../src/lib/ffmpeg-path";
import { runMediaProcess } from "../../src/lib/media-runtime";
import { verifyMediaOutput } from "./media-oracles";
import { parseEvaluationDataset } from "./core/dataset";

export async function fileSha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
export async function readRealSources() {
  const manifestPath = "tools/agent-eval/sources/regression-real-v1.json";
  const dataset = parseEvaluationDataset(JSON.parse(await readFile("tools/agent-eval/datasets/regression-base.json", "utf8")));
  if (await fileSha256(manifestPath) !== dataset.sourceManifest.sha256) throw new Error("Real source manifest hash mismatch");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { sources: Array<{
    id: string; path: string; sha256: string; rawPath: string; rawSha256: string;
    download: string; width: number; height: number; durationSeconds: number; preprocessing: string;
  }> };
  if (manifest.sources.length !== 32 || new Set(manifest.sources.map(s => s.id)).size !== 32) throw new Error("Expected 32 independent source IDs");
  for (const c of dataset.cases) {
    const s = manifest.sources.find(s => s.id === c.source.id);
    if (!s || s.path !== c.source.path || s.sha256 !== c.source.sha256) throw new Error(`Source identity mismatch: ${c.caseId}`);
  }
  return { dataset, sources: manifest.sources };
}

/** Offline by default. Explicit download opt-in is only needed on another checkout. */
export async function prepareRealSources(download = false) {
  const { sources } = await readRealSources();
  for (const source of sources) {
    try { if (await fileSha256(source.rawPath) !== source.rawSha256) throw new Error(`Raw hash mismatch: ${source.id}`); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!download) throw new Error(`Missing local source ${source.rawPath}; restore the asset or explicitly pass --download`);
      await mkdir(dirname(source.rawPath), { recursive: true });
      const partial = `${source.rawPath}.part`;
      try {
        await runMediaProcess("curl", ["--fail", "--location", "--max-time", "120", "--output", partial, source.download], { timeoutMs: 125_000 });
        if (await fileSha256(partial) !== source.rawSha256) throw new Error(`Downloaded hash mismatch: ${source.id}`);
        await rename(partial, source.rawPath);
      } finally { await rm(partial, { force: true }); }
    }
    if (source.path !== source.rawPath) {
      await mkdir(dirname(source.path), { recursive: true });
      const existing = await fileSha256(source.path).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
      if (existing !== source.sha256) {
        const partial = `${source.path}.${randomUUID()}.preparing.mp4`;
        try {
          await runMediaProcess(ffmpegBin(), ["-v", "error", "-y", "-i", source.rawPath, "-map", "0:v:0", "-c:v", "copy", "-an", partial]);
          if (await fileSha256(partial) !== source.sha256) throw new Error(`Prepared hash drift: ${source.id}; existing asset preserved, review tool version`);
          await rename(partial, source.path);
        } finally { await rm(partial, { force: true }); }
      }
    }
    if (await fileSha256(source.path) !== source.sha256) throw new Error(`Prepared hash differs from frozen asset ${source.id}; tool version drift must be reviewed, never silently re-hashed`);
  }
}
export async function preflightRealSources() {
  const { dataset, sources } = await readRealSources();
  const evidence = [];
  for (const source of sources) {
    if (await fileSha256(source.rawPath) !== source.rawSha256 || await fileSha256(source.path) !== source.sha256) throw new Error(`Hash mismatch: ${source.id}`);
    const checks = [
      { id: "dimensions", kind: "dimensions" as const, width: source.width, height: source.height, rationale: "Frozen source metadata" },
      { id: "duration", kind: "duration" as const, seconds: source.durationSeconds, toleranceSeconds: .05, rationale: "Container timestamps and original manifest rounded duration" },
    ];
    const raw = await verifyMediaOutput(resolve(source.rawPath), checks, { timeoutMs: 120_000 });
    const prepared = source.path === source.rawPath ? raw : await verifyMediaOutput(resolve(source.path), [...checks, { id: "no-audio", kind: "audio", mode: "absent", rationale: "Silent audio was removed by stream copy" }], { timeoutMs: 120_000 });
    let videoStreamHash: string | undefined;
    if (source.path !== source.rawPath) {
      const silent = await verifyMediaOutput(resolve(source.rawPath), [{ id: "silent-source", kind: "audio", mode: "silent", thresholdDb: -90, rationale: "Only effectively silent streams may be removed" }], { timeoutMs: 120_000 });
      if (!silent.passed) throw new Error(`Source is not silent: ${source.id}`);
      const streamHash = async (path: string) => (await runMediaProcess(ffmpegBin(), ["-v", "error", "-i", path, "-map", "0:v:0", "-c:v", "copy", "-f", "hash", "-hash", "sha256", "-"], { timeoutMs: 120_000 })).stdout.trim();
      videoStreamHash = await streamHash(source.rawPath);
      if (await streamHash(source.path) !== videoStreamHash) throw new Error(`Prepared video stream changed: ${source.id}`);
    }
    evidence.push({ sourceId: source.id, rawSha256: source.rawSha256, preparedSha256: source.sha256, raw, prepared, videoStreamHash });
    if (!raw.passed || !prepared.passed) throw new Error(`Media preflight failed: ${source.id}\n${JSON.stringify(evidence.at(-1))}`);
    console.log(`Source ${source.id}: hash + raw/prepared complete decode + metadata PASS`);
  }
  return { recordedAt: new Date().toISOString(), providerCalls: 0, tasks: dataset.cases.length, independentAssets: new Set(sources.map(s => s.rawSha256)).size, sourceGroups: new Set(dataset.cases.map(c => c.source.group)).size, evidence };
}

import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { ffmpegBin } from "../../src/lib/ffmpeg-path";
import { MediaRuntimeError, probeMedia, runMediaProcess, type MediaProbe, type RunMediaProcessOptions } from "../../src/lib/media-runtime";
import { parseMediaChecks, type MediaCheck } from "./core/contracts";

export interface MediaCheckEvidence {
  rule: MediaCheck;
  status: "passed" | "failed" | "unknown";
  observed?: unknown;
  exitCode?: number | null;
  diagnostic?: string;
}
export interface MediaOutputEvidence {
  exists: boolean; decodes: boolean; hasVideo: boolean; hasAudio: boolean;
  width?: number; height?: number; durationSeconds?: number;
  outputSha256?: string;
  passed: boolean; checks: MediaCheckEvidence[]; toolVersion?: string;
}
async function hashFile(path: string, signal?: AbortSignal) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) { signal?.throwIfAborted(); digest.update(chunk); }
  return digest.digest("hex");
}
const versions = new Map<string, Promise<string>>();
async function toolVersion() {
  const bin = ffmpegBin();
  if (!versions.has(bin)) versions.set(bin, runMediaProcess(bin, ["-version"], { timeoutMs: 5000 }).then(result => result.stdout.split("\n")[0]).catch(() => { versions.delete(bin); return "unavailable"; }));
  return versions.get(bin)!;
}
function failure(rule: MediaCheck, error: unknown, reference = false): MediaCheckEvidence {
  const code = error instanceof MediaRuntimeError ? error.code : "unavailable";
  const cause = error instanceof Error ? error.cause as { code?: unknown } | undefined : undefined;
  return { rule, status: !reference && ["invalid_media", "process_failed"].includes(code) ? "failed" : "unknown",
    exitCode: typeof cause?.code === "number" ? cause.code : null,
    diagnostic: `${code}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 2000) };
}
async function pixels(path: string, at: number, region: Extract<MediaCheck, { kind: "frame_match" }>["region"], metadata: MediaProbe, options: RunMediaProcessOptions) {
  if (at >= metadata.duration) throw new MediaRuntimeError("invalid_media", "Requested frame is outside the output", { recoverable: false });
  if (region && (region.x + region.width > metadata.width || region.y + region.height > metadata.height)) throw new Error("Reference region is outside frame bounds");
  const filter = [region ? `crop=${region.width}:${region.height}:${region.x}:${region.y}` : "", "scale=64:64:flags=area", "format=rgb24"].filter(Boolean).join(",");
  const { stdout } = await runMediaProcess(ffmpegBin(), ["-v", "error", "-i", path, "-ss", String(at), "-frames:v", "1", "-vf", filter, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { ...options, encoding: "buffer", maxBuffer: 1024 * 1024 });
  if (stdout.length !== 64 * 64 * 3) throw new MediaRuntimeError("invalid_media", "No complete RGB frame was decoded", { recoverable: false });
  return stdout;
}

async function audioSamples(path: string, at: number, seconds: number, options: RunMediaProcessOptions) {
  const { stdout } = await runMediaProcess(ffmpegBin(), ["-v", "error", "-i", path, "-ss", String(at), "-t", String(seconds), "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"], { ...options, encoding: "buffer", maxBuffer: 1024 * 1024 });
  if (stdout.length < Math.floor(seconds * 8000) * 2) throw new MediaRuntimeError("invalid_media", "Incomplete audio sample", { recoverable: false });
  return stdout;
}

/** Real FFmpeg evidence. Frame references are controlled oracles, not general OCR/semantic judgements. */
export async function verifyMediaOutput(path: string | null | undefined, inputChecks: MediaCheck[] = [], options: RunMediaProcessOptions & { outputRequired?: boolean } = {}): Promise<MediaOutputEvidence> {
  const checks = parseMediaChecks(inputChecks);
  const result: MediaOutputEvidence = { exists: false, decodes: false, hasVideo: false, hasAudio: false, passed: false, checks: [] };
  if (options.outputRequired === false) return { ...result, passed: true };
  const decode: MediaCheck = checks.find(c => c.kind === "decode") ?? { id: "__full_decode", kind: "decode", rationale: "Every required output must decode completely" };
  let metadata: MediaProbe;
  if (!path || !(await stat(path).catch(() => null))?.isFile()) {
    result.checks.push({ rule: decode, status: "failed", diagnostic: "Output file is missing" });
    return result;
  }
  result.exists = true;
  const processOptions: RunMediaProcessOptions = { timeoutMs: options.timeoutMs ?? 30_000, signal: options.signal, maxBuffer: 4 * 1024 * 1024 };
  try {
    metadata = await probeMedia(path, processOptions);
    result.outputSha256 = await hashFile(path, options.signal);
    Object.assign(result, { hasVideo: metadata.hasVideo, hasAudio: metadata.hasAudio, width: metadata.width, height: metadata.height, durationSeconds: metadata.duration });
  } catch (error) {
    result.checks.push(failure(decode, error)); return result;
  }
  result.toolVersion = await toolVersion();
  try {
    await runMediaProcess(ffmpegBin(), ["-v", "error", "-xerror", "-err_detect", "explode", "-i", path, "-map", "0:v?", "-map", "0:a?", "-f", "null", "-"], processOptions);
    result.decodes = metadata.hasVideo && metadata.duration > 0;
    result.checks.push({ rule: decode, status: result.decodes ? "passed" : "failed", exitCode: 0, observed: { video: metadata.hasVideo, duration: metadata.duration } });
  } catch (error) { result.checks.push(failure(decode, error)); }
  for (const rule of checks.filter(c => c.kind !== "decode")) {
    if (!result.decodes) { result.checks.push({ rule, status: "unknown", diagnostic: "Full decoding did not pass" }); continue; }
    try {
      let passed = false; let observed: unknown;
      switch (rule.kind) {
        case "dimensions": passed = metadata.width === rule.width && metadata.height === rule.height; observed = { width: metadata.width, height: metadata.height }; break;
        case "duration": passed = Math.abs(metadata.duration - rule.seconds) <= rule.toleranceSeconds; observed = { seconds: metadata.duration, difference: metadata.duration - rule.seconds }; break;
        case "audio": {
          if (rule.mode === "present" || rule.mode === "absent") { passed = metadata.hasAudio === (rule.mode === "present"); observed = { hasAudio: metadata.hasAudio }; break; }
          if (!metadata.hasAudio) { passed = rule.mode === "silent"; observed = { hasAudio: false }; break; }
          const { stderr } = await runMediaProcess(ffmpegBin(), ["-hide_banner", "-nostats", "-i", path, "-vn", "-af", "volumedetect", "-f", "null", "-"], processOptions);
          const match = stderr.match(/max_volume:\s*(-?inf|[\d.-]+) dB/i);
          if (!match) throw new Error("No measured audio peak");
          const peak = match[1] === "-inf" ? -Infinity : Number(match[1]);
          if (Number.isNaN(peak)) throw new Error("Invalid measured audio peak");
          const threshold = rule.thresholdDb ?? -60;
          passed = rule.mode === "silent" ? peak <= threshold : peak > threshold;
          observed = { peakDb: Number.isFinite(peak) ? peak : "-inf", thresholdDb: threshold }; break;
        }
        case "audio_match": {
          let reference: Buffer;
          try {
            if (await hashFile(rule.referencePath, options.signal) !== rule.referenceSha256) throw new Error("Reference SHA-256 mismatch");
            reference = await audioSamples(rule.referencePath, rule.referenceAtSeconds, rule.seconds, processOptions);
          } catch (error) { result.checks.push(failure(rule, error, true)); continue; }
          const actual = await audioSamples(path, rule.atSeconds, rule.seconds, processOptions);
          const samples = Math.floor(rule.seconds * 8000);
          let difference = 0;
          for (let i = 0; i < samples; i++) difference += Math.abs(actual.readInt16LE(i * 2) - reference.readInt16LE(i * 2)) / 32768;
          const meanError = difference / samples;
          passed = meanError <= rule.maxMeanError;
          observed = { meanError, samples, sampleRate: 8000, referenceSha256: rule.referenceSha256, atSeconds: rule.atSeconds, referenceAtSeconds: rule.referenceAtSeconds };
          break;
        }
        case "frame_match": {
          // A missing or changed reference is an invalid oracle, never an output failure.
          let reference: Buffer;
          try {
            const digest = await hashFile(rule.referencePath, options.signal);
            if (digest !== rule.referenceSha256) throw new Error("Reference SHA-256 mismatch");
            const referenceMetadata = await probeMedia(rule.referencePath, processOptions);
            reference = await pixels(rule.referencePath, rule.referenceAtSeconds, rule.region, referenceMetadata, processOptions);
          } catch (error) { result.checks.push(failure(rule, error, true)); continue; }
          const actual = await pixels(path, rule.atSeconds, rule.region, metadata, processOptions);
          let difference = 0;
          for (let i = 0; i < actual.length; i++) difference += Math.abs(actual[i] - reference[i]);
          const meanError = difference / actual.length;
          passed = meanError <= rule.maxMeanError;
          observed = { meanError, samples: actual.length, referenceSha256: rule.referenceSha256, purpose: rule.purpose, atSeconds: rule.atSeconds, referenceAtSeconds: rule.referenceAtSeconds };
          break;
        }
      }
      result.checks.push({ rule, status: passed ? "passed" : "failed", observed, exitCode: 0 });
    } catch (error) { result.checks.push(failure(rule, error)); }
  }
  result.passed = result.decodes && result.checks.every(check => check.status === "passed");
  return result;
}

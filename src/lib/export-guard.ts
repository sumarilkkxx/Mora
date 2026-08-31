/**
 * Anti-recompression export guard — keeps platform exports under each platform's transcode
 * threshold (CRF + VBV dual constraint) and verifies the result by probing the actual output.
 * Platforms force-transcode uploads whose bitrate exceeds their line, which visibly softens
 * AI-composed footage; encoding under the line means the platform serves our pixels as-is.
 * Pure helpers (args building / fps parsing / report) are unit-testable; probe shells ffprobe.
 */

import { ffprobeBin } from "@/lib/ffmpeg-path";
import type { PlatformSpec } from "@/lib/platform-specs";

/** Audio + container overhead reserved out of the platform's total-bitrate line (kbps). */
const NON_VIDEO_OVERHEAD_KBPS = 200;

export interface EncodeStats {
  /** Total file bitrate in kbps (what platforms measure), 0 if unknown */
  totalKbps: number;
  /** Video stream bitrate in kbps, 0 if the container doesn't expose it */
  videoKbps: number;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
}

export interface BitrateReport {
  measuredKbps: number;
  capKbps: number;
  withinCap: boolean;
  /** Percentage of the cap actually used, e.g. 62 means 62% of the line */
  usagePct: number;
  fps: number;
  size: string;
  message: { zh: string; en: string };
}

/** Parse an ffprobe rational frame rate ("30000/1001", "30/1") into a float; 0 when unknown. */
export function parseFrameRate(raw: string | undefined | null): number {
  if (!raw) return 0;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(raw.trim());
  if (m) {
    const den = Number(m[2]);
    if (den === 0) return 0;
    return Number(m[1]) / den;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * VBV cap arguments for libx264: peak video bitrate stays under (cap - audio/container overhead)
 * so the *total* file bitrate lands under the platform line even at motion peaks.
 */
export function vbvArgs(maxVideoKbps: number): string {
  const videoCap = Math.max(1000, Math.round(maxVideoKbps) - NON_VIDEO_OVERHEAD_KBPS);
  return `-maxrate ${videoCap}k -bufsize ${videoCap * 2}k`;
}

/**
 * Frame-rate downsample argument: only added when the source actually exceeds the platform
 * ceiling (an unconditional -r would be a no-op but muddies the command; explicit probe keeps
 * the behaviour identical across ffmpeg versions — -fps_max was renamed -fpsmax in ffmpeg 8).
 */
export function fpsCapArgs(sourceFps: number, maxFps: number): string {
  if (sourceFps > 0 && maxFps > 0 && sourceFps > maxFps + 0.01) {
    return `-r ${maxFps}`;
  }
  return "";
}

/** Build the bilingual pass/over report comparing measured output bitrate against the platform line. */
export function buildBitrateReport(stats: EncodeStats, spec: PlatformSpec): BitrateReport {
  const measured = stats.totalKbps > 0 ? stats.totalKbps : stats.videoKbps;
  const cap = spec.maxVideoKbps;
  const withinCap = measured > 0 && measured <= cap;
  const usagePct = measured > 0 && cap > 0 ? Math.round((measured / cap) * 100) : 0;
  const size = `${stats.width}x${stats.height}`;
  const fpsText = stats.fps > 0 ? `${Math.round(stats.fps * 100) / 100}fps` : "";
  const message = withinCap
    ? {
        zh: `实测码率 ${measured} kbps ≤ 平台线 ${cap} kbps（占 ${usagePct}%），预计可免平台二次压缩`,
        en: `Measured ${measured} kbps ≤ platform line ${cap} kbps (${usagePct}%); expected to avoid platform recompression`,
      }
    : measured > 0
      ? {
          zh: `实测码率 ${measured} kbps 超出平台线 ${cap} kbps，上传后可能被平台二次压缩变糊`,
          en: `Measured ${measured} kbps exceeds the platform line of ${cap} kbps; the platform may recompress and soften it`,
        }
      : {
          zh: `无法读取输出码率，未能确认是否在平台线 ${cap} kbps 内`,
          en: `Could not read the output bitrate; unable to confirm it is within the ${cap} kbps platform line`,
        };
  if (fpsText) {
    message.zh += `（${size}·${fpsText}）`;
    message.en += ` (${size} · ${fpsText})`;
  }
  return { measuredKbps: measured, capKbps: cap, withinCap, usagePct, fps: stats.fps, size, message };
}

/** ffprobe the encode-relevant stats of a video file (bitrate/fps/dimensions/duration). */
export async function probeEncodeStats(videoPath: string): Promise<EncodeStats> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  const { stdout } = await run(ffprobeBin(), [
    "-v", "error",
    "-show_entries", "stream=codec_type,width,height,bit_rate,r_frame_rate:format=duration,bit_rate,size",
    "-of", "json",
    videoPath,
  ]);
  const parsed = JSON.parse(String(stdout)) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number; bit_rate?: string; r_frame_rate?: string }>;
    format?: { duration?: string; bit_rate?: string; size?: string };
  };
  const v = (parsed.streams ?? []).find((s) => s.codec_type === "video");
  const durationSec = parseFloat(parsed.format?.duration ?? "0") || 0;
  let totalKbps = Math.round(Number(parsed.format?.bit_rate ?? 0) / 1000) || 0;
  if (!totalKbps && durationSec > 0) {
    // fallback: derive from file size when the container doesn't expose format bit_rate
    const sizeBytes = Number(parsed.format?.size ?? 0);
    if (sizeBytes > 0) totalKbps = Math.round((sizeBytes * 8) / durationSec / 1000);
  }
  return {
    totalKbps,
    videoKbps: Math.round(Number(v?.bit_rate ?? 0) / 1000) || 0,
    fps: parseFrameRate(v?.r_frame_rate),
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    durationSec,
  };
}

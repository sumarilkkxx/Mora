/**
 * "Scan to buy" end-card — overlays a shop-link QR (+ optional CTA text) onto the last few seconds of an
 * already-composed video, as a post-process (does NOT touch the main compose pipeline). This is the
 * commerce conversion end-card: viewers scan the QR at the end to jump straight to the storefront.
 *
 * Runs FFmpeg over the finished mp4 with the QR PNG as a second input, mirroring the export-platform
 * re-encode pattern. The filter builder is a pure function (unit-testable); rendering probes the video.
 */
import { dirname } from "path";
import { mkdir } from "fs/promises";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { probeMedia, runMediaProcess } from "@/lib/media-runtime";
import { buildDrawtext, unshellFilter } from "./composer";

export interface EndCardVfOpts {
  /** video pixel width (from ffprobe) */
  width: number;
  /** video duration in seconds (from ffprobe) */
  totalDuration: number;
  /** QR side length as a fraction of the video width (default 0.34) */
  qrRatio?: number;
  /** how many trailing seconds to show the end-card (default 3, clamped to the video length) */
  seconds?: number;
  /** optional CTA text shown above the QR (e.g. "扫码购买") */
  ctaText?: string;
  /** font file for the CTA text */
  fontFile?: string;
}

/**
 * Build the -filter_complex that overlays the QR (input [1:v]) + optional CTA onto the last N seconds
 * of the video ([0:v]). Always ends with a labeled [vout] so the caller can -map it and keep the audio.
 * Pure function.
 *
 * generateEndCard runs ffmpeg shell-free (execFile, with this filter as a raw -filter_complex argv element),
 * so no shell halves buildDrawtext's pre-shell double-backslash escaping. The CTA branch below applies
 * unshellFilter to yield the ffmpeg-direct form, otherwise an ASCII colon/bracket/backslash in ctaText
 * would break the filtergraph parse or render a stray backslash. (The overlay/QR fragment carries no
 * backslashes, so the CTA-free branch needs no halving.)
 */
export function buildEndCardFilter(o: EndCardVfOpts): string {
  const qrW = Math.round(o.width * (o.qrRatio ?? 0.34));
  const show = Math.max(1, Math.min(o.seconds ?? 3, o.totalDuration || 3));
  const start = Math.max(0, (o.totalDuration || show) - show).toFixed(2);
  const enable = `enable='gte(t,${start})'`;
  // QR centered, shown only for the trailing window
  const overlay = `[1:v]scale=${qrW}:${qrW}[qr];[0:v][qr]overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2:${enable}`;
  if (!o.ctaText) return `${overlay}[vout]`;
  const fontSize = Math.round(o.width * 0.05);
  const cta = buildDrawtext({
    fontFile: o.fontFile,
    text: o.ctaText,
    fontSize,
    fontColor: "white",
    borderW: Math.max(2, Math.round(o.width * 0.005)),
    box: { color: "black@0.5", borderW: Math.round(o.width * 0.02) },
    x: "(w-text_w)/2",
    // place the CTA just above the centered QR (QR top ≈ (h-qrW)/2)
    y: `(h-${qrW})/2-${Math.round(fontSize * 2)}`,
    enable,
  });
  return unshellFilter(`${overlay}[ov];[ov]${cta}[vout]`);
}

/** ffprobe the video's width + duration (falls back to 1080 / 0 on failure). */
async function probeVideo(videoPath: string): Promise<{ width: number; duration: number }> {
  try {
    const probe = await probeMedia(videoPath);
    return { width: probe.width > 0 ? probe.width : 1080, duration: probe.duration };
  } catch {
    return { width: 1080, duration: 0 };
  }
}

/** Overlay the QR (+ optional CTA) onto the last few seconds of videoPath → write a new mp4 at outPath. */
export async function generateEndCard(opts: {
  videoPath: string;
  qrPath: string;
  outPath: string;
  ctaText?: string;
  qrRatio?: number;
  seconds?: number;
  fontFile?: string;
}): Promise<void> {
  const { width, duration } = await probeVideo(opts.videoPath);
  const vf = buildEndCardFilter({
    width,
    totalDuration: duration,
    qrRatio: opts.qrRatio,
    seconds: opts.seconds,
    ctaText: opts.ctaText,
    fontFile: opts.fontFile,
  });
  await mkdir(dirname(opts.outPath), { recursive: true });
  await runMediaProcess(ffmpegBin(), [
    "-y",
    "-i", opts.videoPath,
    "-i", opts.qrPath,
    "-filter_complex", vf,
    "-map", "[vout]",
    "-map", "0:a?", // keep the original audio if present
    "-map_metadata", "0",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-c:a", "copy",
    opts.outPath,
  ], { timeoutMs: 15 * 60_000, maxBuffer: 50 * 1024 * 1024 });
}

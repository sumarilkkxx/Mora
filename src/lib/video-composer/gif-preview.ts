/**
 * Animated GIF preview — turn a few seconds of the composed video into a shareable, embeddable
 * looping GIF (palette-optimized for quality). Useful for social previews, chat embeds, and listing
 * hover-previews where an autoplaying mp4 isn't available. FFmpeg-based, no extra dependencies.
 */

import { dirname } from "path";
import { mkdir } from "fs/promises";
import { ffmpegBin } from "@/lib/ffmpeg-path";

/**
 * Build the -vf filter for a palette-optimized GIF in a single pass (split → palettegen → paletteuse).
 * A shared 128-colour palette + dithering keeps the GIF small while avoiding banding. Pure, testable.
 */
export function buildGifVf(width: number, fps: number): string {
  return `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`;
}

/** Generate a looping GIF from a slice of the video and write it to outPath. */
export async function generateGifPreview(opts: {
  videoPath: string;
  outPath: string;
  startSec?: number;
  durationSec?: number;
  width?: number;
  fps?: number;
}): Promise<void> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  const start = Math.max(0, opts.startSec ?? 0);
  const dur = Math.min(10, Math.max(1, opts.durationSec ?? 4)); // clamp 1–10s to keep GIFs small
  const width = Math.min(720, Math.max(120, opts.width ?? 360));
  const fps = Math.min(20, Math.max(5, opts.fps ?? 12));
  await mkdir(dirname(opts.outPath), { recursive: true });
  await run(ffmpegBin(), [
    "-y",
    "-ss",
    String(start),
    "-t",
    String(dur),
    "-i",
    opts.videoPath,
    "-vf",
    buildGifVf(width, fps),
    "-loop",
    "0",
    opts.outPath,
  ]);
}

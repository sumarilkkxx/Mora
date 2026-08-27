/**
 * Shared ffprobe helper — the video-metadata probe used by the replicate flow
 * (reference-video analysis). ffprobe calls were previously duplicated privately
 * across contact-sheet / compose / qc; this is the first exported home for the
 * common "duration + dimensions + audio" probe. Existing private copies are left
 * untouched (their behaviors are pinned by their own tests).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { ffprobeBin } from "@/lib/ffmpeg-path";

const execFileAsync = promisify(execFile);

export interface MediaProbe {
  /** Duration in seconds (0 when unknown) */
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/** Probe duration/dimensions/audio of a local media file via ffprobe (JSON output). */
export async function probeMedia(filePath: string): Promise<MediaProbe> {
  const { stdout } = await execFileAsync(ffprobeBin(), [
    "-v", "error",
    "-show_entries", "format=duration",
    "-show_entries", "stream=codec_type,width,height",
    "-of", "json",
    filePath,
  ], { maxBuffer: 4 * 1024 * 1024 });

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const video = parsed.streams?.find((s) => s.codec_type === "video");
  return {
    duration: Number(parsed.format?.duration ?? 0) || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: !!parsed.streams?.some((s) => s.codec_type === "audio"),
  };
}

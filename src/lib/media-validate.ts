/**
 * Post-download media validation — catch broken files BEFORE they enter the pipeline.
 *
 * The composer builds one all-or-nothing filter_complex: a single corrupt input (a CDN that cut
 * the stream mid-body, an HTML error page saved as .mp4, a 0-byte write) fails the whole render
 * with an inscrutable ffmpeg error and zero hint about which asset is at fault. Every download
 * is therefore opened for real right after landing and deleted on any failure — via the
 * existing ffprobe helper so it stays fast.
 *
 * Callers: stock-fill (per-shot footage), free-bgm (music tracks), assets route (AI outputs).
 */
import { unlink } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { probeMedia } from "@/lib/media-probe";
import { ffmpegBin } from "@/lib/ffmpeg-path";

const execFileAsync = promisify(execFile);

export type MediaKind = "video" | "image" | "audio";

/**
 * True when the file parses as real, non-degenerate media of the given kind.
 * video/image: metadata probe must yield positive dimensions (and duration for video) — this
 * rejects the dominant failures (error pages, truncated headers, empty files) at ffprobe speed.
 * audio: a full null-sink decode of the first audio stream (-xerror turns any decode error into
 * a non-zero exit); audio files are small enough that a real decode stays cheap.
 */
export async function validateMediaFile(filePath: string, kind: MediaKind): Promise<boolean> {
  try {
    if (kind === "audio") {
      await execFileAsync(
        ffmpegBin(),
        ["-nostdin", "-v", "error", "-xerror", "-i", filePath, "-map", "0:a:0", "-f", "null", "-"],
        { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      );
      return true;
    }
    const probe = await probeMedia(filePath);
    if (probe.width <= 0 || probe.height <= 0) return false;
    if (kind === "video" && probe.duration <= 0) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate and delete on failure, so a broken download can never be picked up again by a
 * directory scan or re-used from a cache. Returns whether the file is usable.
 */
export async function validateOrDelete(filePath: string, kind: MediaKind): Promise<boolean> {
  const ok = await validateMediaFile(filePath, kind);
  if (!ok) await unlink(filePath).catch(() => {});
  return ok;
}

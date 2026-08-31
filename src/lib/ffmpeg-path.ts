/**
 * ffmpeg / ffprobe binary path resolution — allows commands to target the bundled binary,
 * supporting Electron packaging.
 *
 * Development: uses the binaries installed with this project, so `pnpm dev` works on a clean
 * machine without relying on a globally installed ffmpeg / ffprobe.
 * Electron package: the main process injects the absolute paths extracted from ffmpeg-static /
 * @ffprobe-installer into FFMPEG_PATH / FFPROBE_PATH, so users don't need to install ffmpeg themselves.
 *
 * Note: return values are interpolated into shell command strings; paths may contain spaces —
 * callers must wrap them in double quotes.
 */

function installedFfmpegPath(): string | undefined {
  try {
    // Kept as a runtime require so Electron/standalone packaging resolves the platform-specific
    // binary from the installed package rather than baking a build-machine path into the bundle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const candidate = require("ffmpeg-static") as unknown;
    return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function installedFfprobePath(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const candidate = require("@ffprobe-installer/ffprobe") as { path?: unknown };
    return typeof candidate.path === "string" && candidate.path.length > 0 ? candidate.path : undefined;
  } catch {
    return undefined;
  }
}

const INSTALLED_FFMPEG_PATH = installedFfmpegPath();
const INSTALLED_FFPROBE_PATH = installedFfprobePath();

/** Path to the ffmpeg executable (callers must quote it if it contains spaces) */
export function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || INSTALLED_FFMPEG_PATH || "ffmpeg";
}

/** Path to the ffprobe executable (callers must quote it if it contains spaces) */
export function ffprobeBin(): string {
  return process.env.FFPROBE_PATH || INSTALLED_FFPROBE_PATH || "ffprobe";
}

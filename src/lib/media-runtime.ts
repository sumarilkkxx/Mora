import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { ffprobeBin } from "@/lib/ffmpeg-path";
import { createFileResponseStream } from "@/lib/file-response-stream";
import { parseRangeHeader } from "@/lib/http-range";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

export type MediaRuntimeErrorCode = "cancelled" | "timeout" | "tool_unavailable" | "invalid_media" | "process_failed" | "io_failed";

export class MediaRuntimeError extends Error {
  readonly code: MediaRuntimeErrorCode;
  readonly recoverable: boolean;
  readonly stderr: string;

  constructor(code: MediaRuntimeErrorCode, message: string, options: { recoverable: boolean; stderr?: string; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "MediaRuntimeError";
    this.code = code;
    this.recoverable = options.recoverable;
    this.stderr = options.stderr ?? "";
  }
}

interface ProcessFailure extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export interface RunMediaProcessOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface MediaProcessResult {
  stdout: string;
  stderr: string;
}

export interface MediaProcessBufferResult {
  stdout: Buffer;
  stderr: Buffer;
}

type RunMediaProcessBufferOptions = RunMediaProcessOptions & { encoding: "buffer" };
type RunMediaProcessTextOptions = RunMediaProcessOptions & { encoding?: "utf8" };

function text(value: string | Buffer | undefined): string {
  return typeof value === "string" ? value : value?.toString("utf8") ?? "";
}

/**
 * Parameterized local-process seam for FFmpeg, ffprobe and related media tools.
 * Callers never quote or concatenate arguments. Timeout, cancellation and stderr
 * classification stay identical across every platform and call site.
 */
export function runMediaProcess(command: string, args: readonly string[], options: RunMediaProcessBufferOptions): Promise<MediaProcessBufferResult>;
export function runMediaProcess(command: string, args: readonly string[], options?: RunMediaProcessTextOptions): Promise<MediaProcessResult>;
export async function runMediaProcess(
  command: string,
  args: readonly string[],
  options: RunMediaProcessBufferOptions | RunMediaProcessTextOptions = {},
): Promise<MediaProcessResult | MediaProcessBufferResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  let cancelled = options.signal?.aborted ?? false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;

  try {
    if (cancelled) throw new MediaRuntimeError("cancelled", "Media process was cancelled", { recoverable: true });
    const result = await new Promise<MediaProcessResult | MediaProcessBufferResult>((resolve, reject) => {
      const child = execFile(command, [...args], {
        encoding: options.encoding === "buffer" ? "buffer" : "utf8",
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        windowsHide: true,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: options.env } : {}),
      }, (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stdout, stderr }));
        else if (options.encoding === "buffer") resolve({ stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });
        else resolve({ stdout: String(stdout), stderr: String(stderr) });
      });
      cancel = () => {
        cancelled = true;
        child.kill();
      };
      options.signal?.addEventListener("abort", cancel, { once: true });
      timer = timeoutMs > 0 ? setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs) : undefined;
    });
    return result;
  } catch (cause) {
    if (cause instanceof MediaRuntimeError) throw cause;
    const failure = cause as ProcessFailure;
    const stderr = text(failure.stderr);
    if (timedOut) {
      throw new MediaRuntimeError("timeout", `Media process timed out after ${timeoutMs}ms`, { recoverable: true, stderr, cause });
    }
    if (cancelled || options.signal?.aborted || failure.name === "AbortError" || failure.code === "ABORT_ERR") {
      throw new MediaRuntimeError("cancelled", "Media process was cancelled", { recoverable: true, stderr, cause });
    }
    if (failure.code === "ENOENT") {
      throw new MediaRuntimeError("tool_unavailable", `Media tool is unavailable: ${command}`, { recoverable: false, stderr, cause });
    }
    throw new MediaRuntimeError("process_failed", failure.message || "Media process failed", { recoverable: true, stderr, cause });
  } finally {
    if (timer) clearTimeout(timer);
    if (cancel) options.signal?.removeEventListener("abort", cancel);
  }
}

export interface MediaProbe {
  duration: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
  totalBitrate: number;
  videoBitrate: number;
  frameRate: string | null;
  sizeBytes: number;
}

/** Probe durable media facts through the shared process lifecycle. */
export async function probeMedia(filePath: string, options: RunMediaProcessOptions = {}): Promise<MediaProbe> {
  try {
    const { stdout } = await runMediaProcess(ffprobeBin(), [
      "-v", "error",
      "-show_entries", "stream=codec_type,width,height,bit_rate,r_frame_rate:format=duration,bit_rate,size",
      "-of", "json",
      filePath,
    ], options);
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string; bit_rate?: string; size?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number; bit_rate?: string; r_frame_rate?: string }>;
    };
    const video = parsed.streams?.find(stream => stream.codec_type === "video");
    return {
      duration: Number(parsed.format?.duration ?? 0) || 0,
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      hasVideo: Boolean(video),
      hasAudio: Boolean(parsed.streams?.some(stream => stream.codec_type === "audio")),
      totalBitrate: Number(parsed.format?.bit_rate ?? 0) || 0,
      videoBitrate: Number(video?.bit_rate ?? 0) || 0,
      frameRate: video?.r_frame_rate ?? null,
      sizeBytes: Number(parsed.format?.size ?? 0) || 0,
    };
  } catch (cause) {
    if (cause instanceof MediaRuntimeError && cause.code === "process_failed" && /invalid data|moov atom|could not find codec|error/i.test(`${cause.message}\n${cause.stderr}`)) {
      throw new MediaRuntimeError("invalid_media", "Media file is invalid or unsupported", { recoverable: false, stderr: cause.stderr, cause });
    }
    throw cause;
  }
}

export interface MediaFileResponseOptions {
  contentType: string;
  rangeHeader?: string | null;
  cacheControl?: string;
  downloadName?: string;
  signal?: AbortSignal;
}

/** Build a complete or single-range response with cancellation-safe file streaming. */
export async function createMediaFileResponse(filePath: string, options: MediaFileResponseOptions): Promise<Response> {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (cause) {
    throw new MediaRuntimeError("io_failed", "Media file is unavailable", { recoverable: false, cause });
  }
  if (!fileStat.isFile()) throw new MediaRuntimeError("io_failed", "Media path is not a file", { recoverable: false });
  const size = fileStat.size;
  const range = parseRangeHeader(options.rangeHeader, size);
  const downloadDisposition = options.downloadName ? (() => {
    const fallback = options.downloadName.replace(/[^\x20-\x7E]|["\\\r\n]/g, "_") || "media";
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(options.downloadName)}`;
  })() : undefined;
  const baseHeaders: Record<string, string> = {
    "Content-Type": options.contentType,
    "Cache-Control": options.cacheControl ?? "public, max-age=3600",
    "Accept-Ranges": "bytes",
    ...(downloadDisposition ? { "Content-Disposition": downloadDisposition } : {}),
  };

  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" } });
  }
  if (range) {
    const stream = await createFileResponseStream(filePath, { start: range.start, end: range.end, signal: options.signal });
    return new Response(stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  }
  return new Response(await createFileResponseStream(filePath, { end: size - 1, signal: options.signal }), { headers: { ...baseHeaders, "Content-Length": String(size) } });
}

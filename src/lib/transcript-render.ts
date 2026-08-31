import { execFile } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { promisify } from "util";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { getOutputDir } from "@/lib/paths";
import {
  karaokeLinesFromWords,
  outputDuration,
  remapKeptWords,
  type TimeRange,
  type TranscriptDocument,
  type TranscriptEditPlan,
} from "@/lib/transcript-editor";
import {
  escapeSubtitlesPath,
  resolveChineseFontFamily,
  resolveChineseFontFile,
  withComposeSlot,
} from "@/lib/video-composer/composer";
import { buildKaraokeAss } from "@/lib/video-composer/karaoke";
import { validateMediaFile } from "@/lib/media-validate";

const execFileAsync = promisify(execFile);
export const TRANSCRIPT_RENDER_TIMEOUT_MS = 15 * 60 * 1000;

export interface TranscriptRenderInvocation {
  inputArgs: string[];
  filterComplex: string;
  outputArgs: string[];
}

export interface BuildTranscriptRenderInput {
  inputPath: string;
  outputPath: string;
  keepRanges: TimeRange[];
  hasAudio: boolean;
  subtitlePath?: string;
  fontDirectory?: string;
  duration: number;
}

export function buildTranscriptRenderInvocation(input: BuildTranscriptRenderInput): TranscriptRenderInvocation {
  if (!input.keepRanges.length) throw new Error("没有可输出的视频片段");
  const filters: string[] = [];
  const videoStreams: string[] = [];
  const audioStreams: string[] = [];

  input.keepRanges.forEach((range, index) => {
    const start = range.start.toFixed(3);
    const end = range.end.toFixed(3);
    filters.push(`[0:v:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`);
    videoStreams.push(`[v${index}]`);
    if (input.hasAudio) {
      filters.push(`[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`);
      audioStreams.push(`[a${index}]`);
    }
  });

  let currentVideo: string;
  let currentAudio: string | undefined;
  if (input.keepRanges.length === 1) {
    currentVideo = "v0";
    currentAudio = input.hasAudio ? "a0" : undefined;
  } else if (input.hasAudio) {
    const pairs = videoStreams.map((video, index) => `${video}${audioStreams[index]}`).join("");
    filters.push(`${pairs}concat=n=${input.keepRanges.length}:v=1:a=1[vcat][acat]`);
    currentVideo = "vcat";
    currentAudio = "acat";
  } else {
    filters.push(`${videoStreams.join("")}concat=n=${input.keepRanges.length}:v=1:a=0[vcat]`);
    currentVideo = "vcat";
  }

  const normalizedVideo = input.subtitlePath ? "vbase" : "vout";
  filters.push(`[${currentVideo}]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p[${normalizedVideo}]`);
  if (input.subtitlePath) {
    const fonts = input.fontDirectory ? `:fontsdir=${escapeSubtitlesPath(input.fontDirectory)}` : "";
    filters.push(`[vbase]subtitles=${escapeSubtitlesPath(input.subtitlePath)}${fonts}[vout]`);
  }

  return {
    inputArgs: ["-nostdin", "-v", "error", "-y", "-i", input.inputPath],
    filterComplex: filters.join(";\n"),
    outputArgs: [
      "-map", "[vout]",
      ...(currentAudio ? ["-map", `[${currentAudio}]`] : []),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
      ...(currentAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
      "-movflags", "+faststart",
      "-t", input.duration.toFixed(3),
      input.outputPath,
    ],
  };
}

export interface RenderTranscriptEditInput {
  projectId: string;
  sourcePath: string;
  sourceWidth: number;
  sourceHeight: number;
  hasAudio: boolean;
  transcript: TranscriptDocument;
  plan: TranscriptEditPlan;
  keepRanges: TimeRange[];
  outputPath: string;
}

export async function renderTranscriptEdit(input: RenderTranscriptEditInput): Promise<string> {
  const duration = outputDuration(input.keepRanges);
  if (duration < 0.5) throw new Error("保留内容不足 0.5 秒，无法输出");
  await Promise.all([
    mkdir(dirname(input.outputPath), { recursive: true }),
    mkdir(join(getOutputDir(), input.projectId), { recursive: true }),
  ]);

  const token = `${Date.now()}-${crypto.randomUUID()}`;
  const filterPath = join(getOutputDir(), input.projectId, `transcript-filter-${token}.txt`);
  let subtitlePath: string | undefined;
  if (input.plan.burnSubtitles) {
    const words = remapKeptWords(input.transcript, input.keepRanges);
    const lines = karaokeLinesFromWords(words);
    if (lines.length) {
      subtitlePath = join(getOutputDir(), input.projectId, `transcript-subtitles-${token}.ass`);
      const width = Math.max(2, input.sourceWidth || 1080);
      const height = Math.max(2, input.sourceHeight || 1920);
      const ass = buildKaraokeAss(lines, {
        fontName: resolveChineseFontFamily(),
        playResX: width,
        playResY: height,
        fontSize: Math.round(Math.max(30, Math.min(72, height * 0.034))),
        marginV: Math.round(height * 0.11),
      });
      await writeFile(subtitlePath, ass, "utf8");
    }
  }

  const fontFile = resolveChineseFontFile();
  const invocation = buildTranscriptRenderInvocation({
    inputPath: input.sourcePath,
    outputPath: input.outputPath,
    keepRanges: input.keepRanges,
    hasAudio: input.hasAudio,
    subtitlePath,
    fontDirectory: fontFile ? dirname(fontFile) : undefined,
    duration,
  });
  await writeFile(filterPath, invocation.filterComplex, "utf8");
  const args = [...invocation.inputArgs, "-filter_complex_script", filterPath, ...invocation.outputArgs];
  try {
    await withComposeSlot(() => execFileAsync(ffmpegBin(), args, { timeout: TRANSCRIPT_RENDER_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 }));
    if (!(await validateMediaFile(input.outputPath, "video"))) throw new Error("剪辑结果校验失败，请重试");
    return input.outputPath;
  } catch (error) {
    await rm(input.outputPath, { force: true }).catch(() => {});
    const details = error as { killed?: boolean; signal?: string; stderr?: string; message?: string };
    if (details.killed || details.signal === "SIGTERM") throw new Error("文字剪辑超时，请缩短素材后重试");
    if (/no space left|ENOSPC/i.test(`${details.stderr || ""} ${details.message || ""}`)) throw new Error("磁盘空间不足，无法输出剪辑版本");
    throw error;
  } finally {
    await Promise.all([
      rm(filterPath, { force: true }).catch(() => {}),
      subtitlePath ? rm(subtitlePath, { force: true }).catch(() => {}) : Promise.resolve(),
    ]);
  }
}

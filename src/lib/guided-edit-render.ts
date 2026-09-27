import { createHash } from "crypto";
import { basename, dirname, join, relative } from "path";
import { mkdir, rename, rm, stat, writeFile } from "fs/promises";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { MediaRuntimeError, runMediaProcess } from "@/lib/media-runtime";
import { getDataDir, getOutputDir, getUploadsDir } from "@/lib/paths";
import { MAX_GUIDED_OUTPUT_SECONDS, type GuidedEditPlanDocument, type GuidedEditStyle } from "@/lib/guided-edit";
import { buildKaraokeAss } from "@/lib/video-composer/karaoke";
import { escapeSubtitlesPath, resolveChineseFontFile, withComposeSlot } from "@/lib/video-composer/composer";
import { validateMediaFile } from "@/lib/media-validate";
import { buildGuidedSubtitleLines, guidedSubtitleStyle } from "@/lib/guided-subtitles";
import { resolveExistingUploadFilePath } from "@/lib/upload-path";

const RENDER_TIMEOUT_MS = 15 * 60 * 1000;

export function guidedRenderCacheDir(projectId: string): string {
  return join(getDataDir(), "work", "guided-edit", projectId, "segments");
}

export interface GuidedRenderInvocation {
  inputArgs: string[];
  filterComplex: string;
  outputArgs: string[];
}

function outputSize(
  aspectRatio: GuidedEditPlanDocument["brief"]["aspectRatio"],
  quality: GuidedEditPlanDocument["brief"]["outputQuality"],
): { width: number; height: number } {
  const shortEdge = quality === "720p" ? 720 : 1080;
  const longEdge = quality === "720p" ? 1280 : 1920;
  if (aspectRatio === "16:9") return { width: longEdge, height: shortEdge };
  if (aspectRatio === "1:1") return { width: shortEdge, height: shortEdge };
  return { width: shortEdge, height: longEdge };
}

function visualFilter(style: GuidedEditStyle, index: number, width: number, height: number, duration: number): string {
  const fit = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
  if (style === "natural") return `${fit},fps=30`;
  if (style === "handheld") {
    const scaledWidth = Math.round(width * 1.06 / 2) * 2;
    const scaledHeight = Math.round(height * 1.06 / 2) * 2;
    return `scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height}:x='(iw-ow)/2+sin(n*0.17)*${Math.max(3, Math.round(width * 0.008))}':y='(ih-oh)/2+cos(n*0.13)*${Math.max(3, Math.round(height * 0.005))}',setsar=1,fps=30`;
  }
  if (style === "product_pan") {
    const frames = Math.max(1, Math.round(duration * 30));
    const travel = `min(iw-iw/zoom,on*(iw-iw/zoom)/${frames})`;
    const x = index % 2 === 0 ? travel : `(iw-iw/zoom)-${travel}`;
    return `${fit},zoompan=z='1.06':x='${x}':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30`;
  }
  const zoom = style === "slow_zoom"
    ? "min(zoom+0.0007,1.08)"
    : style === "impact"
      ? "if(lt(on,8),max(1.02,1.14-on*0.015),1.02)"
      : index % 2 === 0 ? "min(zoom+0.0013,1.12)" : "if(eq(on,0),1.12,max(zoom-0.0013,1.0))";
  return `${fit},zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30`;
}

export function buildGuidedRenderInvocation(input: {
  sourcePath: string;
  outputPath: string;
  document: GuidedEditPlanDocument;
  sourceHasAudio: boolean;
  voiceoverPath?: string;
  bgmPath?: string;
  subtitlePath?: string;
  fontDirectory?: string;
}): GuidedRenderInvocation {
  const clips = input.document.timeline;
  if (!clips.length) throw new Error("剪辑计划中没有可输出的镜头");
  const { width, height } = outputSize(input.document.brief.aspectRatio, input.document.brief.outputQuality);
  const useVoiceover = (input.document.brief.audioMode === "uploaded_voice" || input.document.brief.audioMode === "local_voice") && Boolean(input.voiceoverPath);
  const keepAudio = !useVoiceover && input.document.brief.audioMode === "original" && input.sourceHasAudio;
  const editStyle = input.document.brief.editStyle ?? "natural";
  const filters: string[] = [];
  const videoStreams: string[] = [];
  const audioStreams: string[] = [];
  clips.forEach((clip, index) => {
    const start = clip.start.toFixed(3);
    const sourceDuration = Math.max(0.04, clip.end - clip.start);
    const speed = editStyle === "slow_zoom" ? 0.88 : 1;
    const styledEnd = clip.start + sourceDuration * speed;
    const end = styledEnd.toFixed(3);
    const timing = speed === 1 ? "setpts=PTS-STARTPTS" : `setpts=(PTS-STARTPTS)/${speed.toFixed(2)}`;
    filters.push(
      `[0:v:0]trim=start=${start}:end=${end},${timing},` +
      `${visualFilter(editStyle, index, width, height, sourceDuration / speed)},format=yuv420p[v${index}]`,
    );
    videoStreams.push(`[v${index}]`);
    if (keepAudio) {
      const audioTiming = speed === 1 ? "" : `,atempo=${speed.toFixed(2)}`;
      filters.push(`[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS${audioTiming},aformat=sample_rates=44100:channel_layouts=stereo[a${index}]`);
      audioStreams.push(`[a${index}]`);
    }
  });
  const pairs = videoStreams.map((video, index) => keepAudio ? `${video}${audioStreams[index]}` : video).join("");
  filters.push(`${pairs}concat=n=${clips.length}:v=1:a=${keepAudio ? 1 : 0}[vcat]${keepAudio ? "[acat]" : ""}`);
  let audioOutput: string | undefined;
  if (keepAudio) {
    const originalVolume = input.document.brief.originalVolume ?? 1;
    if (originalVolume === 1) audioOutput = "acat";
    else {
      filters.push(`[acat]volume=${originalVolume.toFixed(3)}[abase]`);
      audioOutput = "abase";
    }
  }
  if (useVoiceover) {
    filters.push(`[1:a:0]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,apad,atrim=duration=${input.document.outputDuration.toFixed(3)},volume=${(input.document.brief.voiceoverVolume ?? 1).toFixed(3)}[avoice]`);
    audioOutput = "avoice";
  }
  if (input.bgmPath) {
    const bgmIndex = useVoiceover ? 2 : 1;
    filters.push(`[${bgmIndex}:a:0]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,atrim=duration=${input.document.outputDuration.toFixed(3)},volume=${(input.document.brief.bgmVolume ?? 0.2).toFixed(3)}[abgm]`);
    if (audioOutput) {
      filters.push(`[${audioOutput}][abgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amix]`);
      audioOutput = "amix";
    } else {
      audioOutput = "abgm";
    }
  }
  if (input.subtitlePath) {
    const fonts = input.fontDirectory ? `:fontsdir=${escapeSubtitlesPath(input.fontDirectory)}` : "";
    filters.push(`[vcat]subtitles=${escapeSubtitlesPath(input.subtitlePath)}${fonts}[vout]`);
  } else {
    filters.push("[vcat]null[vout]");
  }
  return {
    inputArgs: ["-nostdin", "-v", "error", "-y", "-i", input.sourcePath, ...(useVoiceover ? ["-i", input.voiceoverPath!] : []), ...(input.bgmPath ? ["-stream_loop", "-1", "-i", input.bgmPath] : [])],
    filterComplex: filters.join(";\n"),
    outputArgs: [
      "-map", "[vout]",
      ...(audioOutput ? ["-map", `[${audioOutput}]`] : []),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
      ...(audioOutput ? ["-c:a", "aac", "-b:a", "192k"] : []),
      "-movflags", "+faststart",
      "-t", input.document.outputDuration.toFixed(3),
      input.outputPath,
    ],
  };
}

interface GuidedEditRenderInput {
  projectId: string;
  sourcePath: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceHasAudio: boolean;
  document: GuidedEditPlanDocument;
  outputPath: string;
  signal?: AbortSignal;
}

async function renderCachedSegments(input: GuidedEditRenderInput): Promise<string[]> {
  const cacheDirectory = guidedRenderCacheDir(input.projectId);
  await mkdir(cacheDirectory, { recursive: true });
  const source = await stat(input.sourcePath);
  const keepAudio = input.document.brief.audioMode === "original" && input.sourceHasAudio;
  const results: string[] = [];
  for (const clip of input.document.timeline) {
    input.signal?.throwIfAborted();
    const key = createHash("sha256").update(JSON.stringify({
      sourcePath: input.sourcePath,
      sourceSize: source.size,
      sourceModified: source.mtimeMs,
      clip: { sourceId: clip.sourceId, sceneId: clip.sceneId, start: clip.start, end: clip.end },
      aspectRatio: input.document.brief.aspectRatio,
      outputQuality: input.document.brief.outputQuality ?? "1080p",
      editStyle: input.document.brief.editStyle ?? "natural",
      keepAudio,
      cacheVersion: 1,
    })).digest("hex");
    const cachedPath = join(cacheDirectory, `${key}.mp4`);
    if (await validateMediaFile(cachedPath, "video")) {
      results.push(cachedPath);
      continue;
    }
    const temporaryPath = join(cacheDirectory, `${key}.${crypto.randomUUID()}.tmp.mp4`);
    const duration = clip.end - clip.start;
    const segmentDocument: GuidedEditPlanDocument = {
      ...input.document,
      brief: {
        ...input.document.brief,
        audioMode: keepAudio ? "original" : "muted",
        originalVolume: 1,
        burnSubtitles: false,
        bgmFile: undefined,
        bgmName: undefined,
      },
      timeline: [{ ...clip, outputStart: 0, outputEnd: duration }],
      outputDuration: duration,
      fingerprints: undefined,
    };
    const invocation = buildGuidedRenderInvocation({
      sourcePath: input.sourcePath,
      outputPath: temporaryPath,
      document: segmentDocument,
      sourceHasAudio: input.sourceHasAudio,
    });
    try {
      await runMediaProcess(ffmpegBin(), [
        ...invocation.inputArgs, "-filter_complex", invocation.filterComplex, ...invocation.outputArgs,
      ], { timeoutMs: RENDER_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024, signal: input.signal });
      if (!(await validateMediaFile(temporaryPath, "video"))) throw new Error("镜头缓存校验失败");
      await rename(temporaryPath, cachedPath).catch(async (error) => {
        if (!(await validateMediaFile(cachedPath, "video"))) throw error;
        await rm(temporaryPath, { force: true });
      });
      results.push(cachedPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }
  return results;
}

function concatFileLine(filePath: string): string {
  return `file '${filePath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

function buildFinalizeInvocation(input: {
  basePath: string;
  outputPath: string;
  document: GuidedEditPlanDocument;
  baseHasAudio: boolean;
  voiceoverPath?: string;
  bgmPath?: string;
  subtitlePath?: string;
  fontDirectory?: string;
}): GuidedRenderInvocation {
  const filters: string[] = [];
  const useVoiceover = Boolean(input.voiceoverPath);
  const inputArgs = ["-nostdin", "-v", "error", "-y", "-i", input.basePath];
  if (input.voiceoverPath) inputArgs.push("-i", input.voiceoverPath);
  if (input.bgmPath) inputArgs.push("-stream_loop", "-1", "-i", input.bgmPath);

  let videoOutput: string | undefined;
  if (input.subtitlePath) {
    const fonts = input.fontDirectory ? `:fontsdir=${escapeSubtitlesPath(input.fontDirectory)}` : "";
    filters.push(`[0:v:0]subtitles=${escapeSubtitlesPath(input.subtitlePath)}${fonts}[vout]`);
    videoOutput = "vout";
  }

  let audioOutput: string | undefined;
  if (input.baseHasAudio) {
    filters.push(`[0:a:0]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,volume=${(input.document.brief.originalVolume ?? 1).toFixed(3)}[abase]`);
    audioOutput = "abase";
  }
  if (input.voiceoverPath) {
    filters.push(`[1:a:0]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,apad,atrim=duration=${input.document.outputDuration.toFixed(3)},volume=${(input.document.brief.voiceoverVolume ?? 1).toFixed(3)}[avoice]`);
    audioOutput = "avoice";
  }
  if (input.bgmPath) {
    const bgmIndex = useVoiceover ? 2 : 1;
    filters.push(`[${bgmIndex}:a:0]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,atrim=duration=${input.document.outputDuration.toFixed(3)},volume=${(input.document.brief.bgmVolume ?? 0.2).toFixed(3)}[abgm]`);
    if (audioOutput) {
      filters.push(`[${audioOutput}][abgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amix]`);
      audioOutput = "amix";
    } else audioOutput = "abgm";
  }

  return {
    inputArgs,
    filterComplex: filters.join(";\n"),
    outputArgs: [
      "-map", videoOutput ? `[${videoOutput}]` : "0:v:0",
      ...(audioOutput ? ["-map", `[${audioOutput}]`] : []),
      ...(videoOutput ? ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p"] : ["-c:v", "copy"]),
      ...(audioOutput ? ["-c:a", "aac", "-b:a", "192k"] : []),
      "-movflags", "+faststart",
      "-t", input.document.outputDuration.toFixed(3),
      input.outputPath,
    ],
  };
}

export async function renderGuidedEdit(input: GuidedEditRenderInput): Promise<string> {
  if (input.document.outputDuration < 0.5) throw new Error("剪辑计划过短，无法输出");
  if (input.document.outputDuration > MAX_GUIDED_OUTPUT_SECONDS + 0.01) throw new Error(`自动剪辑最长支持 ${MAX_GUIDED_OUTPUT_SECONDS} 秒`);
  await mkdir(join(getOutputDir(), input.projectId), { recursive: true });
  const token = `${Date.now()}-${crypto.randomUUID()}`;
  const filterPath = join(getOutputDir(), input.projectId, `guided-filter-${token}.txt`);
  let subtitlePath: string | undefined;
  if (input.document.brief.burnSubtitles) {
    const lines = buildGuidedSubtitleLines(input.document);
    if (lines.length) {
      subtitlePath = join(getOutputDir(), input.projectId, `guided-subtitles-${token}.ass`);
      const style = guidedSubtitleStyle(input.document);
      await writeFile(subtitlePath, buildKaraokeAss(lines, {
        fontName: style.fontName,
        playResX: style.width,
        playResY: style.height,
        fontSize: style.fontSize,
        marginV: style.marginV,
      }), "utf8");
    }
  }
  const fontFile = resolveChineseFontFile();
  const voiceoverMode = input.document.brief.audioMode === "uploaded_voice" || input.document.brief.audioMode === "local_voice";
  const voiceoverPath = voiceoverMode && input.document.brief.voiceoverFile
    ? join(getUploadsDir(), input.projectId, "voiceovers", basename(input.document.brief.voiceoverFile))
    : undefined;
  if (voiceoverMode && !voiceoverPath) throw new Error("请先准备旁白音频");
  if (voiceoverPath && !(await validateMediaFile(voiceoverPath, "audio"))) throw new Error("旁白音频不存在或无法解码");
  const bgmPath = input.document.brief.bgmFile
    ? resolveExistingUploadFilePath(input.document.brief.bgmFile) ?? undefined
    : undefined;
  if (input.document.brief.bgmFile && !bgmPath) throw new Error("背景音乐不存在或无法解码");
  if (bgmPath && !(await validateMediaFile(bgmPath, "audio"))) throw new Error("背景音乐不存在或无法解码");
  const finalize = (basePath: string) => buildFinalizeInvocation({
    basePath,
    outputPath: input.outputPath,
    document: input.document,
    baseHasAudio: input.document.brief.audioMode === "original" && input.sourceHasAudio,
    voiceoverPath,
    bgmPath,
    // A drive letter colon is parsed as an FFmpeg filter option separator on
    // Windows. The ASS file always lives below this workspace, so a relative
    // path avoids that extra parser layer entirely.
    subtitlePath: subtitlePath ? relative(process.cwd(), subtitlePath) : undefined,
    fontDirectory: fontFile ? relative(process.cwd(), dirname(fontFile)) : undefined,
  });
  const concatPath = join(getOutputDir(), input.projectId, `guided-concat-${token}.txt`);
  const basePath = join(getOutputDir(), input.projectId, `guided-base-${token}.mp4`);
  try {
    await withComposeSlot(async () => {
      const segments = await renderCachedSegments(input);
      await writeFile(concatPath, segments.map(concatFileLine).join("\n"), "utf8");
      await runMediaProcess(ffmpegBin(), [
        "-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatPath,
        "-c", "copy", "-movflags", "+faststart", basePath,
      ], { timeoutMs: RENDER_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024, signal: input.signal });
      const invocation = finalize(basePath);
      if (invocation.filterComplex) await writeFile(filterPath, invocation.filterComplex, "utf8");
      await runMediaProcess(ffmpegBin(), [
        ...invocation.inputArgs,
        ...(invocation.filterComplex ? ["-filter_complex_script", filterPath] : []),
        ...invocation.outputArgs,
      ], { timeoutMs: RENDER_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024, signal: input.signal });
    });
    if (!(await validateMediaFile(input.outputPath, "video"))) throw new Error("剪辑结果校验失败，请重试");
    return input.outputPath;
  } catch (error) {
    await rm(input.outputPath, { force: true }).catch(() => {});
    const details = error as { killed?: boolean; signal?: string; stderr?: string; message?: string };
    if ((error instanceof MediaRuntimeError && error.code === "timeout") || details.killed || details.signal === "SIGTERM") throw new Error("自动剪辑超时，请缩短素材后重试");
    if (/no space left|ENOSPC/i.test(`${details.stderr ?? ""} ${details.message ?? ""}`)) throw new Error("磁盘空间不足，无法输出剪辑版本");
    throw error;
  } finally {
    await Promise.all([
      rm(filterPath, { force: true }).catch(() => {}),
      rm(concatPath, { force: true }).catch(() => {}),
      rm(basePath, { force: true }).catch(() => {}),
      subtitlePath ? rm(subtitlePath, { force: true }).catch(() => {}) : Promise.resolve(),
    ]);
  }
}

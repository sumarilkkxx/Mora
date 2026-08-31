import { execFile } from "child_process";
import { basename, dirname, join, relative } from "path";
import { mkdir, rm, writeFile } from "fs/promises";
import { promisify } from "util";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { getOutputDir, getUploadsDir } from "@/lib/paths";
import { MAX_GUIDED_OUTPUT_SECONDS, type GuidedEditPlanDocument, type GuidedEditStyle } from "@/lib/guided-edit";
import { buildKaraokeAss } from "@/lib/video-composer/karaoke";
import { escapeSubtitlesPath, resolveChineseFontFile, withComposeSlot } from "@/lib/video-composer/composer";
import { validateMediaFile } from "@/lib/media-validate";
import { buildGuidedSubtitleLines, guidedSubtitleStyle } from "@/lib/guided-subtitles";

const execFileAsync = promisify(execFile);
const RENDER_TIMEOUT_MS = 15 * 60 * 1000;

export interface GuidedRenderInvocation {
  inputArgs: string[];
  filterComplex: string;
  outputArgs: string[];
}

function outputSize(aspectRatio: GuidedEditPlanDocument["brief"]["aspectRatio"]): { width: number; height: number } {
  if (aspectRatio === "16:9") return { width: 1920, height: 1080 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
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
  subtitlePath?: string;
  fontDirectory?: string;
}): GuidedRenderInvocation {
  const clips = input.document.timeline;
  if (!clips.length) throw new Error("剪辑计划中没有可输出的镜头");
  const { width, height } = outputSize(input.document.brief.aspectRatio);
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
  if (useVoiceover) {
    filters.push(`[1:a:0]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,apad,atrim=duration=${input.document.outputDuration.toFixed(3)}[avoice]`);
  }
  if (input.subtitlePath) {
    const fonts = input.fontDirectory ? `:fontsdir=${escapeSubtitlesPath(input.fontDirectory)}` : "";
    filters.push(`[vcat]subtitles=${escapeSubtitlesPath(input.subtitlePath)}${fonts}[vout]`);
  } else {
    filters.push("[vcat]null[vout]");
  }
  return {
    inputArgs: ["-nostdin", "-v", "error", "-y", "-i", input.sourcePath, ...(useVoiceover ? ["-i", input.voiceoverPath!] : [])],
    filterComplex: filters.join(";\n"),
    outputArgs: [
      "-map", "[vout]",
      ...(useVoiceover ? ["-map", "[avoice]"] : keepAudio ? ["-map", "[acat]"] : []),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
      ...(useVoiceover || keepAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
      "-movflags", "+faststart",
      "-t", input.document.outputDuration.toFixed(3),
      input.outputPath,
    ],
  };
}

export async function renderGuidedEdit(input: {
  projectId: string;
  sourcePath: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceHasAudio: boolean;
  document: GuidedEditPlanDocument;
  outputPath: string;
}): Promise<string> {
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
  const invocation = buildGuidedRenderInvocation({
    sourcePath: input.sourcePath,
    outputPath: input.outputPath,
    document: input.document,
    sourceHasAudio: input.sourceHasAudio,
    voiceoverPath,
    // A drive letter colon is parsed as an FFmpeg filter option separator on
    // Windows. The ASS file always lives below this workspace, so a relative
    // path avoids that extra parser layer entirely.
    subtitlePath: subtitlePath ? relative(process.cwd(), subtitlePath) : undefined,
    fontDirectory: fontFile ? relative(process.cwd(), dirname(fontFile)) : undefined,
  });
  await writeFile(filterPath, invocation.filterComplex, "utf8");
  try {
    await withComposeSlot(() => execFileAsync(ffmpegBin(), [
      ...invocation.inputArgs, "-filter_complex_script", filterPath, ...invocation.outputArgs,
    ], { timeout: RENDER_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 }));
    if (!(await validateMediaFile(input.outputPath, "video"))) throw new Error("剪辑结果校验失败，请重试");
    return input.outputPath;
  } catch (error) {
    await rm(input.outputPath, { force: true }).catch(() => {});
    const details = error as { killed?: boolean; signal?: string; stderr?: string; message?: string };
    if (details.killed || details.signal === "SIGTERM") throw new Error("自动剪辑超时，请缩短素材后重试");
    if (/no space left|ENOSPC/i.test(`${details.stderr ?? ""} ${details.message ?? ""}`)) throw new Error("磁盘空间不足，无法输出剪辑版本");
    throw error;
  } finally {
    await Promise.all([
      rm(filterPath, { force: true }).catch(() => {}),
      subtitlePath ? rm(subtitlePath, { force: true }).catch(() => {}) : Promise.resolve(),
    ]);
  }
}

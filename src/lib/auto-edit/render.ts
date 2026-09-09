import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { ffmpegBin } from "@/lib/ffmpeg-path";
import { buildKaraokeAss } from "@/lib/video-composer/karaoke";
import { resolveChineseFontFamily, withComposeSlot } from "@/lib/video-composer/composer";
import { probeMedia } from "@/lib/media-probe";
import { execMedia } from "./media";
import { timeline, type EditBrief, type EditPlan, type Speech, type Checkpoint, type CheckResult } from "./contract";

export function outputSize(aspect: EditBrief["aspect"], quality: "720p" | "1080p") {
  const short = quality === "720p" ? 720 : 1080;
  return aspect === "1:1" ? [short, short] : aspect === "9:16" ? [short, short * 16 / 9] : [short * 16 / 9, short];
}
export function captionLines(plan: EditPlan, brief: EditBrief, speech: Speech[]) {
  return timeline(plan).flatMap(c => brief.audio === "original"
    ? speech.filter(s => s.start >= c.start - 0.12 && s.end <= c.end + 0.12).map(s => ({ text: s.text, startTime: Math.max(c.outputStart, c.outputStart + s.start - c.start), endTime: Math.min(c.outputEnd, c.outputStart + s.end - c.start) }))
    : c.text ? [{ text: c.text, startTime: c.outputStart, endTime: c.outputEnd }] : []);
}
export function buildRender(input: {
  source: string; plan: EditPlan; brief: EditBrief; quality: "720p" | "1080p";
  voices: NonNullable<Checkpoint["voices"]>; bgm?: string; subtitle?: string; output: string;
}) {
  const { plan, brief } = input;
  const [w, h] = outputSize(brief.aspect, input.quality);
  const clips = timeline(plan);
  const duration = clips.at(-1)!.outputEnd;
  const args = ["-nostdin", "-v", "error", "-y", "-i", input.source];
  const voices = new Map<number, number>();
  for (const voice of input.voices) { args.push("-i", voice.file); voices.set(voice.index, voices.size + 1); }
  const bgmIndex = input.voices.length + 1;
  if (input.bgm) args.push("-stream_loop", "-1", "-i", input.bgm);
  const filters: string[] = [];
  const audio = brief.audio !== "muted";
  clips.forEach((c, i) => {
    const d = c.outputEnd - c.outputStart;
    const fit = c.fit === "cover"
      ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
    filters.push(`[0:v]trim=start=${c.start}:end=${c.end},setpts=(PTS-STARTPTS)/${c.speed},${fit},fps=30,trim=duration=${d},setsar=1,format=yuv420p,settb=AVTB[v${i}]`);
    if (brief.audio === "original") filters.push(`[0:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo,apad,atrim=duration=${d}[a${i}]`);
    else if (brief.audio === "voiceover") {
      const voice = input.voices.find(v => v.index === i);
      if (voice && voice.duration > d - 0.08) throw new Error(`旁白 ${i + 1} 超过镜头时长，请缩短文案 / Voice exceeds clip duration`);
      if (voice) filters.push(`[${voices.get(i)}:a]aresample=44100,aformat=channel_layouts=stereo,apad,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`);
      else if (c.text) throw new Error("缺少旁白 / Missing voiceover");
      else filters.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${d}[a${i}]`);
    }
  });
  let video = "v0", sound = "a0";
  for (let i = 1; i < clips.length; i++) {
    const c = clips[i];
    if (c.overlap > 0) {
      filters.push(`[${video}][v${i}]xfade=transition=fade:duration=${c.overlap}:offset=${c.outputStart}[vs${i}]`);
      if (audio) filters.push(`[${sound}][a${i}]acrossfade=d=${c.overlap}[as${i}]`);
    } else {
      filters.push(`[${video}][v${i}]concat=n=2:v=1:a=0[vs${i}]`);
      if (audio) filters.push(`[${sound}][a${i}]concat=n=2:v=0:a=1[as${i}]`);
    }
    video = `vs${i}`; sound = `as${i}`;
  }
  if (input.subtitle) {
    // FFmpeg has two escaping layers: filter option value, then filter graph.
    const escaped = input.subtitle.replace(/\\/g, "/").replace(/[:'\\]/g, "\\$&").replace(/[\\'\[\],; ]/g, "\\$&");
    filters.push(`[${video}]subtitles=filename=${escaped}[captioned]`); video = "captioned";
  }
  if (input.bgm) {
    filters.push(`[${bgmIndex}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=0.12,afade=t=out:st=${Math.max(0, duration - 1)}:d=1[music]`);
    if (audio) { filters.push(`[${sound}][music]amix=inputs=2:duration=first:normalize=0[mixed]`); sound = "mixed"; }
    else sound = "music";
  }
  return { inputArgs: args, filter: filters.join(";\n"), outputArgs: ["-map", `[${video}]`, ...(audio || input.bgm ? ["-map", `[${sound}]`, "-c:a", "aac", "-b:a", "192k"] : ["-an"]), "-c:v", "libx264", "-preset", input.quality === "720p" ? "veryfast" : "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", input.output] };
}
export async function renderAutoEdit(input: Parameters<typeof buildRender>[0] & { directory: string; speech: Speech[]; signal: AbortSignal }) {
  await mkdir(input.directory, { recursive: true });
  let subtitle: string | undefined;
  if (input.brief.captions) {
    const lines = captionLines(input.plan, input.brief, input.speech);
    if (lines.length) {
      subtitle = join(input.directory, "subtitles.ass");
      const [w, h] = outputSize(input.brief.aspect, input.quality);
      await writeFile(subtitle, buildKaraokeAss(lines, { fontName: resolveChineseFontFamily(), playResX: w, playResY: h, fontSize: Math.round(w * 0.04), marginV: Math.round(h * 0.13), primaryColour: "&H00FFFFFF", secondaryColour: "&H00FFFFFF", emphasizeNumbers: false }));
    }
  }
  const inv = buildRender({ ...input, subtitle });
  const script = join(input.directory, "render-filter.txt");
  await writeFile(script, inv.filter);
  await withComposeSlot(async () => {
    input.signal.throwIfAborted();
    await execMedia(ffmpegBin(), [...inv.inputArgs, "-filter_complex_threads", "1", "-filter_complex_script", script, ...inv.outputArgs], { timeout: 15 * 60000, signal: input.signal, maxBuffer: 2 * 1024 * 1024 });
  });
}
export async function checkOutput(file: string, plan: EditPlan, brief: EditBrief, quality: "720p" | "1080p", signal: AbortSignal): Promise<CheckResult> {
  const meta = await probeMedia(file);
  const [w, h] = outputSize(brief.aspect, quality);
  const expected = timeline(plan).at(-1)!.outputEnd;
  const issues: string[] = [];
  if (meta.duration <= 0 || meta.duration > 30 || meta.duration > brief.target || Math.abs(meta.duration - expected) > 0.08) issues.push("成片时长与计划不符 / Duration mismatch");
  if (meta.width !== w || meta.height !== h) issues.push("画幅不符 / Dimensions mismatch");
  if (meta.hasAudio !== (brief.audio !== "muted" || Boolean(brief.bgm))) issues.push("声音方式不符 / Audio mismatch");
  const { stderr } = await execMedia(ffmpegBin(), ["-nostdin", "-hide_banner", "-i", file, "-vf", "blackdetect=d=0.5:pix_th=0.05,freezedetect=n=-55dB:d=2", "-f", "null", "-"], { timeout: 120000, signal, maxBuffer: 2 * 1024 * 1024 });
  const review = stderr.split(/\r?\n/).filter(l => /black_start:|freeze_start:/.test(l)).map(l => l.slice(-250)).slice(0, 12);
  return { technical: !issues.length, issues, review, duration: meta.duration };
}

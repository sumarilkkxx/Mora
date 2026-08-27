/**
 * Composed-video quality check (QC) — post-process gate that catches broken output before it ships:
 * missing streams, wrong resolution, duration drift, black frames, long silences, loudness drift,
 * frozen segments. Pure parsers + rule evaluation are unit-testable; `runQc` shells ffprobe/ffmpeg
 * over the finished mp4 (mirrors the end-card/export-platform post-process pattern — it never touches
 * the compose pipeline).
 *
 * Rationale (2026 survey): unattended batch pipelines shipping black/silent/truncated videos is a top
 * complaint against this tool category; only the largest agent-first systems run automated output QA.
 */
import { ffmpegBin, ffprobeBin } from "@/lib/ffmpeg-path";

export type QcLevel = "ok" | "warn" | "fail";

export interface QcSegment {
  start: number;
  end: number;
  duration: number;
}

export interface QcCheck {
  /** stable machine id: video-stream | audio-stream | duration | resolution | black | silence | loudness | freeze */
  id: string;
  level: QcLevel;
  /** bilingual, UI picks by locale */
  message: { zh: string; en: string };
  data?: Record<string, unknown>;
}

export interface QcProbe {
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  /** seconds */
  duration: number;
}

export interface QcSignals {
  black: QcSegment[];
  silence: QcSegment[];
  freeze: QcSegment[];
  /** integrated loudness in LUFS (null when not measurable, e.g. no audio) */
  loudness: number | null;
  /** true peak in dBFS */
  truePeak: number | null;
}

export interface QcExpectations {
  /** expected duration in seconds (e.g. from the composition record) */
  durationSec?: number;
  /** expected pixel dimensions (e.g. from resolution + aspect ratio) */
  width?: number;
  height?: number;
}

export interface QcReport {
  /** worst level across checks */
  status: QcLevel;
  checks: QcCheck[];
  probe: QcProbe;
  signals: QcSignals;
}

// Detection thresholds — tuned against real composer output (slow zoompan must NOT read as frozen,
// inter-sentence voiceover gaps must NOT read as silence).
export const QC_PARAMS = {
  blackMinSec: 0.4,
  blackPixTh: 0.1,
  silenceNoiseDb: -50,
  silenceMinSec: 2.5,
  freezeNoiseDb: -60,
  freezeMinSec: 4,
  /** social-media loudness target the composer normalises to (loudnorm I=-14) */
  loudnessTarget: -14,
  loudnessWarnDelta: 4,
  loudnessFailBelow: -30,
  truePeakWarnAbove: -0.5,
} as const;

/** Expected pixel dimensions for a composition's resolution + aspect ratio (must match the composer). */
export function expectedDimensions(resolution?: string | null, aspectRatio?: string | null): { width: number; height: number } | null {
  const map: Record<string, Record<string, { width: number; height: number }>> = {
    "9:16": { "720p": { width: 720, height: 1280 }, "1080p": { width: 1080, height: 1920 } },
    "16:9": { "720p": { width: 1280, height: 720 }, "1080p": { width: 1920, height: 1080 } },
    "1:1": { "720p": { width: 720, height: 720 }, "1080p": { width: 1080, height: 1080 } },
  };
  if (!resolution || !aspectRatio) return null;
  return map[aspectRatio]?.[resolution] ?? null;
}

/** Parse `blackdetect` stderr lines: `black_start:0 black_end:1.2 black_duration:1.2`. */
export function parseBlackdetect(stderr: string): QcSegment[] {
  const out: QcSegment[] = [];
  const re = /black_start:\s*(-?[\d.]+)\s+black_end:\s*(-?[\d.]+)\s+black_duration:\s*(-?[\d.]+)/g;
  for (const m of stderr.matchAll(re)) {
    out.push({ start: parseFloat(m[1]), end: parseFloat(m[2]), duration: parseFloat(m[3]) });
  }
  return out;
}

/** Parse `silencedetect` stderr pairs: `silence_start: 3.2` … `silence_end: 6.8 | silence_duration: 3.6`. */
export function parseSilencedetect(stderr: string): QcSegment[] {
  const out: QcSegment[] = [];
  let pendingStart: number | null = null;
  const re = /silence_(start|end):\s*(-?[\d.]+)(?:\s*\|\s*silence_duration:\s*(-?[\d.]+))?/g;
  for (const m of stderr.matchAll(re)) {
    if (m[1] === "start") {
      pendingStart = parseFloat(m[2]);
    } else {
      const end = parseFloat(m[2]);
      const start = pendingStart ?? Math.max(0, end - (m[3] ? parseFloat(m[3]) : 0));
      out.push({ start, end, duration: m[3] ? parseFloat(m[3]) : end - start });
      pendingStart = null;
    }
  }
  // trailing open silence (runs to EOF without a silence_end line)
  if (pendingStart !== null) out.push({ start: pendingStart, end: NaN, duration: NaN });
  return out;
}

/** Parse `freezedetect` stderr pairs (`lavfi.freezedetect.freeze_start/…_end/…_duration`). */
export function parseFreezedetect(stderr: string): QcSegment[] {
  const out: QcSegment[] = [];
  let pendingStart: number | null = null;
  const re = /freeze_(start|end|duration):\s*(-?[\d.]+)/g;
  let pendingDuration: number | null = null;
  for (const m of stderr.matchAll(re)) {
    const v = parseFloat(m[2]);
    if (m[1] === "start") {
      pendingStart = v;
    } else if (m[1] === "duration") {
      pendingDuration = v;
    } else {
      const start = pendingStart ?? Math.max(0, v - (pendingDuration ?? 0));
      out.push({ start, end: v, duration: pendingDuration ?? v - start });
      pendingStart = null;
      pendingDuration = null;
    }
  }
  return out;
}

/** Parse the `ebur128` end-of-run summary: integrated loudness (LUFS) + true peak (dBFS). Last match wins. */
export function parseEbur128Summary(stderr: string): { loudness: number | null; truePeak: number | null } {
  let loudness: number | null = null;
  let truePeak: number | null = null;
  for (const m of stderr.matchAll(/\bI:\s*(-?[\d.]+)\s*LUFS/g)) loudness = parseFloat(m[1]);
  for (const m of stderr.matchAll(/\bPeak:\s*(-?[\d.]+)\s*dBFS/g)) truePeak = parseFloat(m[1]);
  return { loudness, truePeak };
}

/** Apply QC rules to probe + signals → structured bilingual report. Pure function. */
export function evaluateQc(probe: QcProbe, signals: QcSignals, expect: QcExpectations = {}): QcReport {
  const checks: QcCheck[] = [];
  const ok = (id: string, zh: string, en: string, data?: Record<string, unknown>) =>
    checks.push({ id, level: "ok", message: { zh, en }, data });
  const warn = (id: string, zh: string, en: string, data?: Record<string, unknown>) =>
    checks.push({ id, level: "warn", message: { zh, en }, data });
  const fail = (id: string, zh: string, en: string, data?: Record<string, unknown>) =>
    checks.push({ id, level: "fail", message: { zh, en }, data });

  // stream integrity
  if (!probe.hasVideo) fail("video-stream", "成片缺少视频流", "The output has no video stream");
  else ok("video-stream", `视频流正常（${probe.width}×${probe.height}）`, `Video stream OK (${probe.width}×${probe.height})`);
  if (!probe.hasAudio) fail("audio-stream", "成片缺少音频流（配音/BGM 丢失）", "The output has no audio stream (voiceover/BGM missing)");
  else ok("audio-stream", "音频流正常", "Audio stream OK");

  // duration
  if (probe.duration < 1) {
    fail("duration", `成片时长异常（${probe.duration.toFixed(2)} 秒）`, `Output duration is abnormal (${probe.duration.toFixed(2)}s)`, { duration: probe.duration });
  } else if (expect.durationSec && expect.durationSec > 0) {
    const drift = Math.abs(probe.duration - expect.durationSec);
    const tolerance = Math.max(2, expect.durationSec * 0.15);
    if (drift > tolerance) {
      warn(
        "duration",
        `时长偏差较大：实际 ${probe.duration.toFixed(1)} 秒，预期 ${expect.durationSec.toFixed(1)} 秒`,
        `Duration drift: got ${probe.duration.toFixed(1)}s, expected ${expect.durationSec.toFixed(1)}s`,
        { duration: probe.duration, expected: expect.durationSec }
      );
    } else {
      ok("duration", `时长正常（${probe.duration.toFixed(1)} 秒）`, `Duration OK (${probe.duration.toFixed(1)}s)`);
    }
  } else {
    ok("duration", `时长 ${probe.duration.toFixed(1)} 秒`, `Duration ${probe.duration.toFixed(1)}s`);
  }

  // resolution
  if (probe.hasVideo && expect.width && expect.height) {
    if (probe.width !== expect.width || probe.height !== expect.height) {
      warn(
        "resolution",
        `分辨率不符：实际 ${probe.width}×${probe.height}，预期 ${expect.width}×${expect.height}`,
        `Resolution mismatch: got ${probe.width}×${probe.height}, expected ${expect.width}×${expect.height}`,
        { width: probe.width, height: probe.height, expectedWidth: expect.width, expectedHeight: expect.height }
      );
    } else {
      ok("resolution", "分辨率符合预期", "Resolution matches");
    }
  }

  // black frames — any long segment or a large total share means broken visuals
  if (probe.hasVideo) {
    const blackTotal = signals.black.reduce((s, b) => s + (Number.isFinite(b.duration) ? b.duration : 0), 0);
    const longest = signals.black.reduce((s, b) => Math.max(s, b.duration || 0), 0);
    const share = probe.duration > 0 ? blackTotal / probe.duration : 0;
    if (longest >= 2 || share > 0.1) {
      fail(
        "black",
        `检测到明显黑屏：${signals.black.length} 段，共 ${blackTotal.toFixed(1)} 秒`,
        `Black frames detected: ${signals.black.length} segment(s), ${blackTotal.toFixed(1)}s total`,
        { segments: signals.black, totalSec: blackTotal }
      );
    } else if (signals.black.length > 0) {
      warn(
        "black",
        `检测到短暂黑屏 ${signals.black.length} 段（共 ${blackTotal.toFixed(1)} 秒）`,
        `Brief black frames: ${signals.black.length} segment(s), ${blackTotal.toFixed(1)}s total`,
        { segments: signals.black, totalSec: blackTotal }
      );
    } else {
      ok("black", "无黑屏", "No black frames");
    }
  }

  // silence — long dead air mid-video reads as a broken TTS/mix
  if (probe.hasAudio) {
    const closed = signals.silence.map((s) => ({
      ...s,
      // treat an open trailing silence as running to EOF
      end: Number.isFinite(s.end) ? s.end : probe.duration,
      duration: Number.isFinite(s.duration) ? s.duration : Math.max(0, probe.duration - s.start),
    }));
    const silenceTotal = closed.reduce((s, x) => s + x.duration, 0);
    const longest = closed.reduce((s, x) => Math.max(s, x.duration), 0);
    const share = probe.duration > 0 ? silenceTotal / probe.duration : 0;
    if (longest >= 5 || share > 0.4) {
      fail(
        "silence",
        `检测到长静音：最长 ${longest.toFixed(1)} 秒（共 ${silenceTotal.toFixed(1)} 秒）`,
        `Long silence detected: longest ${longest.toFixed(1)}s (${silenceTotal.toFixed(1)}s total)`,
        { segments: closed, totalSec: silenceTotal }
      );
    } else if (closed.length > 0) {
      warn(
        "silence",
        `检测到静音 ${closed.length} 段（共 ${silenceTotal.toFixed(1)} 秒）`,
        `Silence detected: ${closed.length} segment(s), ${silenceTotal.toFixed(1)}s total`,
        { segments: closed, totalSec: silenceTotal }
      );
    } else {
      ok("silence", "无异常静音", "No abnormal silence");
    }

    // loudness — the composer normalises to -14 LUFS; a big drift means the mix went wrong
    if (signals.loudness !== null) {
      if (signals.loudness < QC_PARAMS.loudnessFailBelow) {
        fail(
          "loudness",
          `音量过低（${signals.loudness.toFixed(1)} LUFS），接近无声`,
          `Audio far too quiet (${signals.loudness.toFixed(1)} LUFS), effectively silent`,
          { loudness: signals.loudness }
        );
      } else if (Math.abs(signals.loudness - QC_PARAMS.loudnessTarget) > QC_PARAMS.loudnessWarnDelta) {
        warn(
          "loudness",
          `响度偏离标准：${signals.loudness.toFixed(1)} LUFS（目标 ${QC_PARAMS.loudnessTarget} LUFS）`,
          `Loudness drift: ${signals.loudness.toFixed(1)} LUFS (target ${QC_PARAMS.loudnessTarget} LUFS)`,
          { loudness: signals.loudness, target: QC_PARAMS.loudnessTarget }
        );
      } else {
        ok("loudness", `响度正常（${signals.loudness.toFixed(1)} LUFS）`, `Loudness OK (${signals.loudness.toFixed(1)} LUFS)`);
      }
      if (signals.truePeak !== null && signals.truePeak > QC_PARAMS.truePeakWarnAbove) {
        warn(
          "true-peak",
          `峰值电平过高（${signals.truePeak.toFixed(1)} dBFS），可能削波`,
          `True peak too hot (${signals.truePeak.toFixed(1)} dBFS), clipping risk`,
          { truePeak: signals.truePeak }
        );
      }
    }
  }

  // freeze — warn-only: a legitimately static shot can trip this, so it never fails the video
  if (probe.hasVideo) {
    const frozen = signals.freeze.filter((f) => f.duration >= QC_PARAMS.freezeMinSec);
    if (frozen.length > 0) {
      const longest = frozen.reduce((s, f) => Math.max(s, f.duration), 0);
      warn(
        "freeze",
        `检测到画面长时间不动 ${frozen.length} 段（最长 ${longest.toFixed(1)} 秒）`,
        `Frozen picture: ${frozen.length} segment(s), longest ${longest.toFixed(1)}s`,
        { segments: frozen }
      );
    } else {
      ok("freeze", "画面无冻结", "No frozen picture");
    }
  }

  const status: QcLevel = checks.some((c) => c.level === "fail") ? "fail" : checks.some((c) => c.level === "warn") ? "warn" : "ok";
  return { status, checks, probe, signals };
}

/** ffprobe streams + duration. */
async function probeVideo(videoPath: string): Promise<QcProbe> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  const { stdout } = await run(ffprobeBin(), [
    "-v", "error",
    "-show_entries", "stream=codec_type,width,height:format=duration",
    "-of", "json",
    videoPath,
  ]);
  const parsed = JSON.parse(String(stdout)) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const streams = parsed.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const duration = parseFloat(parsed.format?.duration ?? "0");
  return {
    hasVideo: !!v,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    duration: Number.isFinite(duration) ? duration : 0,
  };
}

/** One decode pass collecting black/freeze/silence/loudness signals from ffmpeg stderr. */
async function collectSignals(videoPath: string, probe: QcProbe): Promise<QcSignals> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const run = promisify(execFile);
  const args = ["-hide_banner", "-nostats", "-i", videoPath];
  if (probe.hasVideo) {
    args.push("-vf", `blackdetect=d=${QC_PARAMS.blackMinSec}:pix_th=${QC_PARAMS.blackPixTh},freezedetect=n=${QC_PARAMS.freezeNoiseDb}dB:d=${QC_PARAMS.freezeMinSec}`);
  }
  if (probe.hasAudio) {
    args.push("-af", `silencedetect=n=${QC_PARAMS.silenceNoiseDb}dB:d=${QC_PARAMS.silenceMinSec},ebur128`);
  }
  args.push("-f", "null", "-");
  // detectors write to stderr; the null muxer discards the media itself
  const { stderr } = await run(ffmpegBin(), args, { maxBuffer: 32 * 1024 * 1024 });
  const text = String(stderr);
  const { loudness, truePeak } = parseEbur128Summary(text);
  return {
    black: parseBlackdetect(text),
    silence: parseSilencedetect(text),
    freeze: parseFreezedetect(text),
    loudness,
    truePeak,
  };
}

/** Full QC over a finished video file: probe → signal pass → rule evaluation. */
export async function runQc(videoPath: string, expect: QcExpectations = {}): Promise<QcReport> {
  const probe = await probeVideo(videoPath);
  // a file with no decodable streams is broken; skip the signal pass and let the rules fail it
  const signals: QcSignals =
    probe.hasVideo || probe.hasAudio
      ? await collectSignals(videoPath, probe)
      : { black: [], silence: [], freeze: [], loudness: null, truePeak: null };
  return evaluateQc(probe, signals, expect);
}

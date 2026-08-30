import { describe, it, expect } from "vitest";
import {
  parseBlackdetect,
  parseSilencedetect,
  parseFreezedetect,
  parseEbur128Summary,
  evaluateQc,
  expectedDimensions,
  type QcProbe,
  type QcSignals,
} from "@/lib/video-composer/qc";

const goodProbe: QcProbe = { hasVideo: true, hasAudio: true, width: 1080, height: 1920, duration: 25 };
const cleanSignals: QcSignals = { black: [], silence: [], freeze: [], loudness: -14.2, truePeak: -1.6 };

describe("qc parsers", () => {
  it("parses blackdetect segments from ffmpeg stderr", () => {
    const stderr = [
      "[blackdetect @ 0x7f8] black_start:0 black_end:1.2 black_duration:1.2",
      "frame= 750 fps=250",
      "[blackdetect @ 0x7f8] black_start:10.5 black_end:13 black_duration:2.5",
    ].join("\n");
    expect(parseBlackdetect(stderr)).toEqual([
      { start: 0, end: 1.2, duration: 1.2 },
      { start: 10.5, end: 13, duration: 2.5 },
    ]);
  });

  it("parses silencedetect start/end pairs and trailing open silence", () => {
    const paired = "[silencedetect @ 0x1] silence_start: 3.2\n[silencedetect @ 0x1] silence_end: 6.8 | silence_duration: 3.6";
    expect(parseSilencedetect(paired)).toEqual([{ start: 3.2, end: 6.8, duration: 3.6 }]);
    // silence running to EOF has no silence_end line — reported as an open segment
    const open = parseSilencedetect("[silencedetect @ 0x1] silence_start: 20.1");
    expect(open).toHaveLength(1);
    expect(open[0].start).toBe(20.1);
    expect(Number.isNaN(open[0].end)).toBe(true);
  });

  it("parses freezedetect lavfi metadata lines", () => {
    const stderr = [
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 1.0",
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_duration: 5.5",
      "[freezedetect @ 0x2] lavfi.freezedetect.freeze_end: 6.5",
    ].join("\n");
    expect(parseFreezedetect(stderr)).toEqual([{ start: 1.0, end: 6.5, duration: 5.5 }]);
  });

  it("parses the ebur128 summary (last match wins over per-frame lines)", () => {
    const stderr = [
      "[Parsed_ebur128_1 @ 0x3] t: 1.0  TARGET:-23 LUFS  M: -15.1 S: -14.9  I: -15.0 LUFS   LRA: 1.2 LU",
      "[Parsed_ebur128_1 @ 0x3] Summary:",
      "  Integrated loudness:",
      "    I:         -14.1 LUFS",
      "    Threshold: -24.6 LUFS",
      "  True peak:",
      "    Peak:       -1.4 dBFS",
    ].join("\n");
    expect(parseEbur128Summary(stderr)).toEqual({ loudness: -14.1, truePeak: -1.4 });
    expect(parseEbur128Summary("no audio here")).toEqual({ loudness: null, truePeak: null });
  });
});

describe("expectedDimensions", () => {
  it("maps resolution + aspect ratio to pixel dimensions", () => {
    expect(expectedDimensions("1080p", "9:16")).toEqual({ width: 1080, height: 1920 });
    expect(expectedDimensions("720p", "16:9")).toEqual({ width: 1280, height: 720 });
    expect(expectedDimensions("1080p", "1:1")).toEqual({ width: 1080, height: 1080 });
    expect(expectedDimensions(null, "9:16")).toBeNull();
    expect(expectedDimensions("1080p", "4:3")).toBeNull();
  });
});

describe("evaluateQc rules", () => {
  it("passes a clean video", () => {
    const report = evaluateQc(goodProbe, cleanSignals, { durationSec: 25, width: 1080, height: 1920 });
    expect(report.status).toBe("ok");
    expect(report.checks.every((c) => c.level === "ok")).toBe(true);
  });

  it("fails on missing streams", () => {
    const report = evaluateQc({ ...goodProbe, hasAudio: false }, cleanSignals);
    expect(report.status).toBe("fail");
    expect(report.checks.find((c) => c.id === "audio-stream")?.level).toBe("fail");
    expect(evaluateQc({ ...goodProbe, hasVideo: false }, cleanSignals).status).toBe("fail");
  });

  it("fails on long black segments, warns on brief ones", () => {
    const long = evaluateQc(goodProbe, { ...cleanSignals, black: [{ start: 0, end: 3, duration: 3 }] });
    expect(long.checks.find((c) => c.id === "black")?.level).toBe("fail");
    const brief = evaluateQc(goodProbe, { ...cleanSignals, black: [{ start: 0, end: 0.5, duration: 0.5 }] });
    expect(brief.checks.find((c) => c.id === "black")?.level).toBe("warn");
    expect(brief.status).toBe("warn");
  });

  it("fails on ≥5s silence and treats open trailing silence as running to EOF", () => {
    const long = evaluateQc(goodProbe, { ...cleanSignals, silence: [{ start: 5, end: 11, duration: 6 }] });
    expect(long.checks.find((c) => c.id === "silence")?.level).toBe("fail");
    // open segment from 18s in a 25s video → 7s of trailing dead air → fail
    const open = evaluateQc(goodProbe, { ...cleanSignals, silence: [{ start: 18, end: NaN, duration: NaN }] });
    expect(open.checks.find((c) => c.id === "silence")?.level).toBe("fail");
    const brief = evaluateQc(goodProbe, { ...cleanSignals, silence: [{ start: 5, end: 8, duration: 3 }] });
    expect(brief.checks.find((c) => c.id === "silence")?.level).toBe("warn");
  });

  it("flags loudness drift and near-silent mixes", () => {
    const drift = evaluateQc(goodProbe, { ...cleanSignals, loudness: -22 });
    expect(drift.checks.find((c) => c.id === "loudness")?.level).toBe("warn");
    const dead = evaluateQc(goodProbe, { ...cleanSignals, loudness: -55 });
    expect(dead.checks.find((c) => c.id === "loudness")?.level).toBe("fail");
    const hot = evaluateQc(goodProbe, { ...cleanSignals, truePeak: 0.2 });
    expect(hot.checks.find((c) => c.id === "true-peak")?.level).toBe("warn");
  });

  it("warns on duration drift beyond tolerance and fails sub-second output", () => {
    const drift = evaluateQc(goodProbe, cleanSignals, { durationSec: 40 });
    expect(drift.checks.find((c) => c.id === "duration")?.level).toBe("warn");
    const within = evaluateQc(goodProbe, cleanSignals, { durationSec: 26 });
    expect(within.checks.find((c) => c.id === "duration")?.level).toBe("ok");
    const broken = evaluateQc({ ...goodProbe, duration: 0.2 }, cleanSignals);
    expect(broken.checks.find((c) => c.id === "duration")?.level).toBe("fail");
  });

  it("warns on resolution mismatch and freeze (never fails on freeze)", () => {
    const res = evaluateQc(goodProbe, cleanSignals, { width: 720, height: 1280 });
    expect(res.checks.find((c) => c.id === "resolution")?.level).toBe("warn");
    const freeze = evaluateQc(goodProbe, { ...cleanSignals, freeze: [{ start: 2, end: 9, duration: 7 }] });
    expect(freeze.checks.find((c) => c.id === "freeze")?.level).toBe("warn");
    expect(freeze.status).toBe("warn");
    // short freezes below threshold are ignored
    const short = evaluateQc(goodProbe, { ...cleanSignals, freeze: [{ start: 2, end: 4, duration: 2 }] });
    expect(short.checks.find((c) => c.id === "freeze")?.level).toBe("ok");
  });

  it("bilingual messages present on every check", () => {
    const report = evaluateQc(goodProbe, cleanSignals);
    for (const c of report.checks) {
      expect(c.message.zh.length).toBeGreaterThan(0);
      expect(c.message.en.length).toBeGreaterThan(0);
    }
  });
});

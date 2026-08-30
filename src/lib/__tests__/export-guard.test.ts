import { describe, it, expect } from "vitest";
import { parseFrameRate, vbvArgs, fpsCapArgs, buildBitrateReport, type EncodeStats } from "../export-guard";
import { PLATFORM_SPECS, type PlatformSpec } from "../platform-specs";

const stats = (over: Partial<EncodeStats>): EncodeStats => ({
  totalKbps: 0,
  videoKbps: 0,
  fps: 30,
  width: 1080,
  height: 1920,
  durationSec: 25,
  ...over,
});

const spec = (over: Partial<PlatformSpec>): PlatformSpec => ({
  name: "抖音",
  w: 1080,
  h: 1920,
  ratio: "9:16",
  maxVideoKbps: 6000,
  maxFps: 60,
  ...over,
});

describe("parseFrameRate", () => {
  it("parses rational frame rates from ffprobe", () => {
    expect(parseFrameRate("30/1")).toBe(30);
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("60/1")).toBe(60);
  });

  it("accepts plain numbers and rejects garbage", () => {
    expect(parseFrameRate("25")).toBe(25);
    expect(parseFrameRate("abc")).toBe(0);
    expect(parseFrameRate("30/0")).toBe(0);
    expect(parseFrameRate(undefined)).toBe(0);
    expect(parseFrameRate("")).toBe(0);
  });
});

describe("vbvArgs", () => {
  it("reserves audio/container overhead out of the platform line", () => {
    // 6000 line - 200 overhead = 5800k peak video, bufsize 2x
    expect(vbvArgs(6000)).toBe("-maxrate 5800k -bufsize 11600k");
    expect(vbvArgs(8000)).toBe("-maxrate 7800k -bufsize 15600k");
  });

  it("never drops below a sane floor for tiny caps", () => {
    expect(vbvArgs(900)).toBe("-maxrate 1000k -bufsize 2000k");
  });
});

describe("fpsCapArgs", () => {
  it("downsamples only when the source exceeds the ceiling", () => {
    expect(fpsCapArgs(120, 60)).toBe("-r 60");
    expect(fpsCapArgs(60.01, 60)).toBe("");
    expect(fpsCapArgs(61, 60)).toBe("-r 60");
    expect(fpsCapArgs(30, 60)).toBe("");
    expect(fpsCapArgs(60, 60)).toBe("");
  });

  it("does nothing when the source fps is unknown", () => {
    expect(fpsCapArgs(0, 60)).toBe("");
    expect(fpsCapArgs(-1, 60)).toBe("");
  });
});

describe("buildBitrateReport", () => {
  it("passes when measured total bitrate is under the platform line", () => {
    const r = buildBitrateReport(stats({ totalKbps: 3720 }), spec({}));
    expect(r.withinCap).toBe(true);
    expect(r.measuredKbps).toBe(3720);
    expect(r.capKbps).toBe(6000);
    expect(r.usagePct).toBe(62);
    expect(r.message.zh).toContain("3720");
    expect(r.message.zh).toContain("免平台二次压缩");
    expect(r.message.en).toContain("avoid platform recompression");
  });

  it("warns when measured bitrate exceeds the line", () => {
    const r = buildBitrateReport(stats({ totalKbps: 9500 }), spec({}));
    expect(r.withinCap).toBe(false);
    expect(r.message.zh).toContain("超出平台线");
    expect(r.message.en).toContain("exceeds");
  });

  it("falls back to the video stream bitrate when total is unknown", () => {
    const r = buildBitrateReport(stats({ totalKbps: 0, videoKbps: 4200 }), spec({}));
    expect(r.measuredKbps).toBe(4200);
    expect(r.withinCap).toBe(true);
  });

  it("reports honestly when no bitrate could be read", () => {
    const r = buildBitrateReport(stats({ totalKbps: 0, videoKbps: 0 }), spec({}));
    expect(r.withinCap).toBe(false);
    expect(r.message.zh).toContain("无法读取");
    expect(r.message.en).toContain("Could not read");
  });

  it("includes resolution and fps in the message", () => {
    const r = buildBitrateReport(stats({ totalKbps: 3000, fps: 29.97 }), spec({}));
    expect(r.message.zh).toContain("1080x1920");
    expect(r.message.zh).toContain("29.97fps");
  });
});

describe("PLATFORM_SPECS anti-recompression fields", () => {
  it("every platform declares a usable bitrate line and fps ceiling", () => {
    for (const [key, s] of Object.entries(PLATFORM_SPECS)) {
      expect(s.maxVideoKbps, `${key}.maxVideoKbps`).toBeGreaterThanOrEqual(4000);
      expect(s.maxVideoKbps, `${key}.maxVideoKbps`).toBeLessThanOrEqual(12000);
      expect(s.maxFps, `${key}.maxFps`).toBeGreaterThanOrEqual(30);
    }
  });

  it("douyin uses the community-measured 6000 kbps line", () => {
    expect(PLATFORM_SPECS.douyin.maxVideoKbps).toBe(6000);
  });
});

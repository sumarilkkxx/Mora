import { describe, it, expect } from "vitest";
import { PLATFORM_SPECS, getPlatformSpec, getOffSiteQrPolicy } from "@/lib/platform-specs";

describe("platform-specs（多平台导出规格）", () => {
  it("含国内外带货平台（域内含视频号；海外含 TikTok / Reels / Shorts）", () => {
    expect(Object.keys(PLATFORM_SPECS).sort()).toEqual(["douyin", "kuaishou", "reels", "shipinhao", "shorts", "tiktok", "xiaohongshu"]);
  });

  it("视频号 = 1080x1920 竖屏 9:16（微信生态域内平台）", () => {
    expect(getPlatformSpec("shipinhao")).toMatchObject({ name: "视频号", w: 1080, h: 1920, ratio: "9:16" });
  });

  it("TikTok Shop = 1080x1920 竖屏 9:16", () => {
    expect(getPlatformSpec("tiktok")).toMatchObject({ name: "TikTok Shop", w: 1080, h: 1920, ratio: "9:16" });
  });

  it("Reels / Shorts 与 TikTok 同为 9:16 1080×1920（跨发同一条竖屏片，按平台命名导出）", () => {
    expect(getPlatformSpec("reels")).toMatchObject({ name: "Instagram Reels", w: 1080, h: 1920, ratio: "9:16" });
    expect(getPlatformSpec("shorts")).toMatchObject({ name: "YouTube Shorts", w: 1080, h: 1920, ratio: "9:16" });
  });

  it("抖音/快手 9:16，小红书 3:4", () => {
    expect(getPlatformSpec("douyin")?.ratio).toBe("9:16");
    expect(getPlatformSpec("kuaishou")?.ratio).toBe("9:16");
    expect(getPlatformSpec("xiaohongshu")).toMatchObject({ w: 1080, h: 1440, ratio: "3:4" });
  });

  it("所有规格宽高为正、ratio 非空", () => {
    for (const spec of Object.values(PLATFORM_SPECS)) {
      expect(spec.w).toBeGreaterThan(0);
      expect(spec.h).toBeGreaterThan(0);
      expect(spec.ratio.length).toBeGreaterThan(0);
    }
  });

  it("未知平台返回 undefined", () => {
    expect(getPlatformSpec("weibo")).toBeUndefined();
  });
});

describe("getOffSiteQrPolicy（成片内二维码站外导流风险策略）", () => {
  it("抖音 = block（2026-07 站外导流处罚：首违关橱窗 7 天）", () => {
    const p = getOffSiteQrPolicy("douyin");
    expect(p.level).toBe("block");
    expect(p.reason.zh).toContain("橱窗");
    expect(p.reason.en.length).toBeGreaterThan(0);
  });

  it("快手/小红书/视频号 = warn（域内平台普遍处罚站外导流）", () => {
    for (const plat of ["kuaishou", "xiaohongshu", "shipinhao"]) {
      expect(getOffSiteQrPolicy(plat).level).toBe("warn");
    }
  });

  it("海外平台（tiktok/reels/shorts）= ok", () => {
    for (const plat of ["tiktok", "reels", "shorts"]) {
      expect(getOffSiteQrPolicy(plat).level).toBe("ok");
    }
  });

  it("未指定平台 → warn 并提示传 platform；未知平台按域内 warn 兜底", () => {
    expect(getOffSiteQrPolicy(undefined).level).toBe("warn");
    expect(getOffSiteQrPolicy(undefined).reason.zh).toContain("platform");
    expect(getOffSiteQrPolicy("bilibili").level).toBe("warn");
  });
});

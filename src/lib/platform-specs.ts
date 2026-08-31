/**
 * Final video specs for each e-commerce platform — single source of truth for multi-platform export (re-encode to target aspect ratio).
 * Douyin / Kuaishou / TikTok Shop / Instagram Reels / YouTube Shorts use 9:16 portrait; Xiaohongshu prefers 3:4. Pure data + accessor, unit-testable.
 * Overseas short-video destinations (reels/shorts) share TikTok's 9:16 1080×1920 spec — same pixels, but exposed as named
 * export targets so a creator cross-posting one clip to TikTok + Reels + Shorts (the 2026 standard) gets correctly-labeled files.
 */

export interface PlatformSpec {
  name: string;
  w: number;
  h: number;
  ratio: string;
  /**
   * Platform recompression threshold in kbps (total file bitrate). Uploads above this line get
   * force-transcoded by the platform ("second compression"), which visibly softens AI-composed
   * footage. Values are community-measured / official-recommendation figures (recorded 2026-07),
   * NOT official hard limits — keep them maintainable here as encoding targets with headroom.
   */
  maxVideoKbps: number;
  /** Frame-rate ceiling; exports above this are downsampled (higher fps wastes the bitrate budget). */
  maxFps: number;
}

export const PLATFORM_SPECS: Record<string, PlatformSpec> = {
  // douyin: community tests report forced transcode above ~6000 kbps at 1080P (知乎实测, 2026-07)
  douyin: { name: "抖音", w: 1080, h: 1920, ratio: "9:16", maxVideoKbps: 6000, maxFps: 60 },
  // kuaishou / xiaohongshu / shipinhao: community consensus ≤8 Mbps at 1080P (2026-07)
  kuaishou: { name: "快手", w: 1080, h: 1920, ratio: "9:16", maxVideoKbps: 8000, maxFps: 60 },
  xiaohongshu: { name: "小红书", w: 1080, h: 1440, ratio: "3:4", maxVideoKbps: 8000, maxFps: 60 },
  shipinhao: { name: "视频号", w: 1080, h: 1920, ratio: "9:16", maxVideoKbps: 8000, maxFps: 60 },
  // tiktok: community tests show noticeable recompression above ~8-10 Mbps; conservative 8000
  tiktok: { name: "TikTok Shop", w: 1080, h: 1920, ratio: "9:16", maxVideoKbps: 8000, maxFps: 60 },
  // reels: Instagram officially recommends ~5 Mbps for 1080p/30
  reels: { name: "Instagram Reels", w: 1080, h: 1920, ratio: "9:16", maxVideoKbps: 5000, maxFps: 60 },
  // shorts: YouTube officially recommends 8 Mbps for 1080p SDR 30fps
  shorts: { name: "YouTube Shorts", w: 1080, h: 1920, ratio: "9:16", maxVideoKbps: 8000, maxFps: 60 },
};

/** Get the spec for a given platform; returns undefined for unknown platforms. */
export function getPlatformSpec(platform: string): PlatformSpec | undefined {
  return PLATFORM_SPECS[platform];
}

/**
 * Off-site-diversion (QR code) risk policy per platform. Burning a scannable shop QR into the video
 * counts as "站外导流" on Chinese platforms. Douyin's 2026-07 e-commerce enforcement (media-reported):
 * ANY QR/contact info in the video → first offense closes the shop window for 7 days, second offense
 * permanently revokes commerce rights and freezes commissions — so we refuse by default there.
 * Other domestic platforms punish off-site diversion too, but with softer/less-publicized penalties → warn.
 * Overseas destinations (TikTok Shop/Reels/Shorts) have no comparable scan-to-buy enforcement → ok.
 */
export type OffSiteQrLevel = "block" | "warn" | "ok";

export interface OffSiteQrPolicy {
  level: OffSiteQrLevel;
  reason: { zh: string; en: string };
}

const QR_BLOCK_DOUYIN: OffSiteQrPolicy = {
  level: "block",
  reason: {
    zh: "抖音 2026-07 起严打站外导流：成片内出现二维码/联系方式，首违关闭橱窗 7 天，二违永久收回带货权限并冻结佣金。默认拒绝烧录，确认自担风险可用 force 强制",
    en: "Douyin's 2026-07 enforcement treats any in-video QR/contact info as off-site diversion: 1st offense closes the shop window for 7 days, 2nd permanently revokes commerce rights and freezes commissions. Refused by default; pass force to proceed at your own risk",
  },
};

const QR_WARN_DOMESTIC: OffSiteQrPolicy = {
  level: "warn",
  reason: {
    zh: "国内平台普遍处罚站外导流，成片内二维码有限流/处罚风险，建议仅在私域分发（微信群/朋友圈）使用带码版本",
    en: "Chinese platforms generally punish off-site diversion; an in-video QR risks throttling/penalties. Use the QR version only for private-channel distribution (WeChat groups/Moments)",
  },
};

const QR_OK: OffSiteQrPolicy = {
  level: "ok",
  reason: { zh: "该平台无站外导流处罚风险记录", en: "No known off-site-diversion enforcement on this platform" },
};

const OFFSITE_QR_POLICIES: Record<string, OffSiteQrPolicy> = {
  douyin: QR_BLOCK_DOUYIN,
  kuaishou: QR_WARN_DOMESTIC,
  xiaohongshu: QR_WARN_DOMESTIC,
  shipinhao: QR_WARN_DOMESTIC,
  tiktok: QR_OK,
  reels: QR_OK,
  shorts: QR_OK,
};

/**
 * QR burn-in policy for a target platform. Unknown/absent platform → warn (the video may end up on a
 * domestic platform where the QR is risky, so surface the caveat instead of staying silent).
 */
export function getOffSiteQrPolicy(platform?: string | null): OffSiteQrPolicy {
  if (!platform) {
    return {
      level: "warn",
      reason: {
        zh: "未指定目标平台：若发抖音等国内平台，成片内二维码属站外导流（抖音首违关橱窗 7 天）。发国内平台请传 platform 以便按平台把关",
        en: "No target platform given: on Chinese platforms an in-video QR counts as off-site diversion (Douyin: 1st offense closes the shop window for 7 days). Pass platform so the risk can be gated per platform",
      },
    };
  }
  return OFFSITE_QR_POLICIES[platform] ?? QR_WARN_DOMESTIC;
}

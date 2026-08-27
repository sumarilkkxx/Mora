/**
 * Compliance / conversion overlays — optional burned-in layers reusing the composer's existing
 * textOverlay rendering pipeline. Pure functions, unit-testable.
 *  - Purchase CTA end-card: "tap the cart below"-style prompt over the last ~2.5s (conversion lever).
 *  - AIGC explicit badge: a small "内容由 AI 生成" corner label over the opening seconds. Douyin's
 *    2026-07 labeling rules require a prominent AI-content mark at the head or tail lasting >= 2s
 *    (AI-synthesized AUDIO alone also triggers the requirement); unlabeled AI content risks
 *    throttling after a 72h grace period. This is the visible ("explicit") half — the invisible
 *    ("implicit") GB 45438 file-metadata half lives in compliance-metadata.ts.
 */

export type OverlayStyle = "title" | "highlight" | "price" | "badge";
export interface ComplianceOverlay {
  text: string;
  style: OverlayStyle;
  startTime: number;
  endTime: number;
}
export interface ComplianceOverlayOpts {
  /** 片尾购买 CTA 文案（最后约 2.5s）；空/未传则不加 */
  ctaText?: string;
  /** 片头「内容由 AI 生成」显式角标（≥2s 平台合规要求）；默认关，调用方决定默认值 */
  aigcBadge?: boolean;
  /** 角标文案覆盖（默认「内容由 AI 生成」，即平台通用措辞） */
  aigcBadgeText?: string;
}

const CTA_TAIL_SECONDS = 2.5;
// Badge display window: Douyin requires >= 2s; 4s leaves margin against player trimming/rounding
const AIGC_BADGE_SECONDS = 4;
export const AIGC_BADGE_DEFAULT_TEXT = "内容由 AI 生成";

/** 由选项生成合规/转化叠加层；totalDuration 为成片真实总时长（秒） */
export function buildComplianceOverlays(opts: ComplianceOverlayOpts, totalDuration: number): ComplianceOverlay[] {
  const out: ComplianceOverlay[] = [];
  const total = Math.max(totalDuration, 0.1);

  if (opts.aigcBadge) {
    const text = (opts.aigcBadgeText || "").trim() || AIGC_BADGE_DEFAULT_TEXT;
    // Never below the 2s policy floor even on ultra-short clips (a <2s video shows it full-length)
    const dur = Math.min(Math.max(AIGC_BADGE_SECONDS, 2), total);
    out.push({ text, style: "badge", startTime: 0, endTime: Number(dur.toFixed(3)) });
  }

  const cta = (opts.ctaText || "").trim();
  if (cta) {
    const dur = Math.min(CTA_TAIL_SECONDS, total);
    out.push({ text: cta, style: "highlight", startTime: Number(Math.max(0, total - dur).toFixed(3)), endTime: total });
  }

  return out;
}

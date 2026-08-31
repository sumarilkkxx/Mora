/**
 * AI + real-footage mix metering — the measurable core of the "hybrid mode" strategy.
 *
 * Why: Douyin's 2026-07 recommendation weighting favors AI+real hybrid content (real-footage
 * share ≥50% earns a traffic tilt), while pure-AI videos remain publishable when labeled. The
 * filling mechanics already exist (product photos, user uploads, free real-shot stock, local
 * pool) — what was missing is the metric: how real is this video, per shot and overall?
 *
 * Classification leans on data the pipeline already persists:
 *   assets.type  ai_generated → AI;  product_image / user_upload / stock_footage → real
 *   (stock sources are real-shot footage by real people; product photos are the user's own)
 * Product-image shots resolved without a persisted asset row count as real too.
 *
 * Duration-weighted (a 2s AI transition matters less than a 6s AI talking head). Pure functions;
 * the gate route and the assets page share them. Informative only — never used to block or warn.
 */

/** Per-shot reality: "real" (shot footage/photo), "ai" (generated), or null (nothing filled yet). */
export type ShotReality = "real" | "ai" | null;

/** Classify one shot from its persisted asset type + script visual source. */
export function shotReality(opts: {
  visualSource?: string | null;
  assetType?: string | null;
  /** whether the shot has a usable (done) asset */
  done: boolean;
}): ShotReality {
  if (opts.done && opts.assetType) {
    return opts.assetType === "ai_generated" ? "ai" : "real";
  }
  // Product-image shots resolve straight from the user's own product photo (no asset row persisted)
  if (opts.visualSource === "product_image") return "real";
  return null;
}

export interface RealMixReport {
  totalSec: number;
  realSec: number;
  aiSec: number;
  /** Seconds of shots with nothing filled yet (excluded from the ratio) */
  unfilledSec: number;
  /** realSec / (realSec + aiSec); null when nothing is filled */
  realRatio: number | null;
  /** ≥50% real (duration-weighted) — the Douyin hybrid-content traffic-tilt threshold */
  tiltEligible: boolean;
  message: { zh: string; en: string };
}

/** Compute the duration-weighted real/AI mix over classified entries. */
export function computeRealMix(entries: Array<{ duration: number; reality: ShotReality }>): RealMixReport {
  let realSec = 0;
  let aiSec = 0;
  let unfilledSec = 0;
  for (const e of entries) {
    const d = Math.max(0, e.duration || 0);
    if (e.reality === "real") realSec += d;
    else if (e.reality === "ai") aiSec += d;
    else unfilledSec += d;
  }
  const filled = realSec + aiSec;
  const realRatio = filled > 0 ? realSec / filled : null;
  const tiltEligible = realRatio != null && realRatio >= 0.5;

  let message: { zh: string; en: string };
  if (realRatio == null) {
    message = {
      zh: "尚未配画面——配好素材后这里显示实拍/AI 占比（抖音对 AI+真人混合内容有流量倾斜）",
      en: "No visuals yet — once shots are filled this shows the real/AI split (Douyin tilts traffic toward AI+real hybrid content)",
    };
  } else {
    const realPct = Math.round(realRatio * 100);
    const aiPct = 100 - realPct;
    const unfilledZh = unfilledSec > 0 ? `（另有 ${Math.round(unfilledSec)} 秒分镜未配画面，未计入）` : "";
    const unfilledEn = unfilledSec > 0 ? ` (${Math.round(unfilledSec)}s of shots still unfilled, excluded)` : "";
    if (tiltEligible) {
      message = {
        zh: `实拍/自有素材占比约 ${realPct}%（时长加权）——AI+真人混合达标，抖音对混合内容有流量倾斜优势${unfilledZh}`,
        en: `Real/own footage ≈${realPct}% (duration-weighted) — hybrid threshold met; Douyin tilts traffic toward mixed content${unfilledEn}`,
      };
    } else {
      message = {
        zh: `实拍占比约 ${realPct}%、AI 占比约 ${aiPct}%——把部分分镜换成实拍/上传/免费实拍素材至 ≥50% 可吃抖音混合内容流量倾斜（非强制，纯 AI 打标也可发）${unfilledZh}`,
        en: `Real ≈${realPct}%, AI ≈${aiPct}% — swapping some shots to real/uploaded/free real-shot footage to reach ≥50% earns Douyin's hybrid traffic tilt (optional; labeled pure-AI is still publishable)${unfilledEn}`,
      };
    }
  }

  return { totalSec: realSec + aiSec + unfilledSec, realSec, aiSec, unfilledSec, realRatio, tiltEligible, message };
}

/** Convenience for assets-page view rows (AssetItem-shaped objects). */
export function realMixFromRows(
  rows: Array<{ duration: number; visualSource?: string | null; assetType?: string | null; status: string }>
): RealMixReport {
  return computeRealMix(
    rows.map((r) => ({
      duration: r.duration,
      reality: shotReality({ visualSource: r.visualSource, assetType: r.assetType, done: r.status === "done" }),
    }))
  );
}

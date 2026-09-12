export interface VideoSpendEstimate {
  unitUsd: number;
  seconds: number;
  calls: number;
  resolution: string;
  tierMultiplier: number;
  baseUsd: number;
  maxUsd: number;
}

export const DEFAULT_VIDEO_SPEND_CAP_USD = 5;

/** Invalid or omitted API values must not accidentally disable the default guard. */
export function resolveVideoSpendCap(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_VIDEO_SPEND_CAP_USD;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_VIDEO_SPEND_CAP_USD;
}

/**
 * Atlas publishes one base per-second price while billing resolution tiers as
 * separate products. These conservative multipliers were measured against the
 * provider invoice and intentionally round upward for the pre-spend guard.
 */
export function resolutionCostMultiplier(resolution: string): number {
  const rank = Number.parseInt(resolution, 10);
  if (rank >= 1080) return 4.5;
  if (rank >= 720) return 2;
  return 1;
}

/** Unknown prices stay unknown; they must never be presented as free. */
export function estimateVideoSpend(
  unitUsd: number | undefined,
  seconds: number,
  resolution: string,
  calls = 1,
): VideoSpendEstimate | undefined {
  if (unitUsd === undefined || !Number.isFinite(unitUsd) || unitUsd < 0) return undefined;
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(calls) || calls <= 0) return undefined;
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  const safeCalls = Math.max(1, Math.floor(calls));
  const baseUsd = round(unitUsd * seconds * safeCalls);
  const tierMultiplier = resolutionCostMultiplier(resolution);
  return {
    unitUsd,
    seconds,
    calls: safeCalls,
    resolution,
    tierMultiplier,
    baseUsd,
    maxUsd: round(baseUsd * tierMultiplier),
  };
}

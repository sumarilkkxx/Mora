export const TARGET_VIDEO_DURATIONS = [15, 20, 25, 30] as const;

export type TargetVideoDuration = (typeof TARGET_VIDEO_DURATIONS)[number];

export const DEFAULT_TARGET_VIDEO_DURATION: TargetVideoDuration = 15;

/**
 * Creation-time total duration is deliberately separate from per-shot model duration.
 * Only the creator-facing presets are accepted so scripts, billing previews and model
 * routing all work from the same stable project contract.
 */
export function normalizeTargetVideoDuration(
  value: unknown,
  fallback: TargetVideoDuration = DEFAULT_TARGET_VIDEO_DURATION,
): TargetVideoDuration {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return TARGET_VIDEO_DURATIONS.reduce((best, duration) => {
    const delta = Math.abs(duration - parsed);
    const bestDelta = Math.abs(best - parsed);
    return delta < bestDelta || (delta === bestDelta && duration < best) ? duration : best;
  }, fallback);
}

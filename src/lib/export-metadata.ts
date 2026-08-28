/** Prefer measured output metadata; fall back to the authored script before a video exists. */
export function exportDurationSeconds(
  compositionDurationMs?: number | null,
  scriptDurationSeconds?: number | null
): number {
  if (typeof compositionDurationMs === "number" && Number.isFinite(compositionDurationMs) && compositionDurationMs > 0) {
    return Math.max(1, Math.round(compositionDurationMs / 1000));
  }
  if (typeof scriptDurationSeconds === "number" && Number.isFinite(scriptDurationSeconds) && scriptDurationSeconds > 0) {
    return Math.round(scriptDurationSeconds);
  }
  return 0;
}

/**
 * Subtitle / overlay timeline builder — pure functions extracted from the compose route
 * so segment timing rules are unit-testable (GitHub issue #14: caption overlap at fades,
 * speech clipped by cross-fades, captions drifting from the narration).
 *
 * Timeline rules encoded here:
 * - ffmpeg_fade transitions overlap the previous segment by FADE_DURATION, shifting the
 *   whole timeline forward; cues from the previous segment are clamped so two caption
 *   cards are never on screen at once (previously they over-printed for 0.5s per fade);
 * - captions are distributed over the actual speech window (voiceSec) rather than the
 *   padded clip duration, then the last card holds through the breathing gap;
 * - clips whose successor enters via ffmpeg_fade get FADE_DURATION of extra tail time so
 *   the audio acrossfade only ever consumes silence — never the last words of speech.
 */

import { chunkCaption, FADE_DURATION } from "./composer";

export interface SubtitleCue {
  text: string;
  startTime: number;
  endTime: number;
}

export interface OverlayCue extends SubtitleCue {
  style: "title" | "highlight" | "price";
}

export interface TimelineSegment {
  /** clip duration in seconds (already includes the voice tail gap) */
  duration: number;
  /** transition INTO this segment ("ffmpeg_fade" overlaps the previous segment) */
  transition: string;
  /** narration text for this segment (omit → no captions) */
  voiceover?: string;
  /** actual (or estimated) narration length in seconds; used to sync captions to speech */
  voiceSec?: number;
  /** per-word timestamps relative to this segment's audio start (from the TTS engine's
   * WordBoundary events); enables exact karaoke timing and word-snapped caption boundaries */
  words?: { text: string; startSec: number; endSec: number }[];
  /** non-subtitle text overlay for this segment */
  overlay?: { text: string; style: "title" | "highlight" | "price" };
}

/** Karaoke line cue: display window plus speech-window end and optional real word timings. */
export interface KaraokeTimelineLine extends SubtitleCue {
  speechEndTime?: number;
  words?: { text: string; startSec: number; endSec: number }[];
}

/**
 * Snap caption-card boundaries to the nearest word end within ±0.4s: proportional card splits
 * routinely cut mid-word (the card flips while the voice is still inside a word); with real word
 * timings the flip lands exactly on a word edge. Card start/end order is preserved; the segment's
 * outer boundaries are never moved. Exported for tests.
 */
export function snapCuesToWords(cues: SubtitleCue[], wordEnds: number[]): void {
  if (cues.length < 2 || wordEnds.length === 0) return;
  for (let i = 0; i < cues.length - 1; i++) {
    const boundary = cues[i].endTime;
    let best: number | null = null;
    for (const t of wordEnds) {
      if (Math.abs(t - boundary) > 0.4) continue;
      if (best === null || Math.abs(t - boundary) < Math.abs(best - boundary)) best = t;
    }
    if (best === null) continue;
    // keep cards strictly ordered: the snapped boundary must stay inside both neighbours
    if (best <= cues[i].startTime + 0.05 || best >= cues[i + 1].endTime - 0.05) continue;
    cues[i].endTime = Number(best.toFixed(3));
    cues[i + 1].startTime = Number(best.toFixed(3));
  }
}

/** Clamp cues that spill past `boundary` (the shifted start of the next segment) and drop the zero-length leftovers */
function clampCueTail(cues: SubtitleCue[], boundary: number): void {
  for (let i = cues.length - 1; i >= 0 && cues[i].endTime > boundary; i--) {
    cues[i].endTime = Math.max(cues[i].startTime, Number(boundary.toFixed(3)));
  }
  // remove cues that collapsed to (near) zero length inside the overlap window
  for (let i = cues.length - 1; i >= 0; i--) {
    if (cues[i].endTime - cues[i].startTime < 0.05) cues.splice(i, 1);
  }
}

/**
 * Build the subtitle / karaoke / overlay timeline from rendered segments.
 * Returns the total video duration (after fade overlaps) alongside the cue lists.
 */
export function buildSubtitleTimeline(segments: TimelineSegment[]): {
  cues: SubtitleCue[];
  karaokeLines: KaraokeTimelineLine[];
  overlays: OverlayCue[];
  total: number;
} {
  const cues: SubtitleCue[] = [];
  const karaokeLines: KaraokeTimelineLine[] = [];
  const overlays: OverlayCue[] = [];
  let acc = 0;
  segments.forEach((seg, idx) => {
    // match the composer's xfade timeline exactly: an ffmpeg_fade segment overlaps the
    // previous one by FADE_DURATION, shifting everything after it forward
    if (idx > 0 && seg.transition === "ffmpeg_fade") {
      acc -= FADE_DURATION;
      // previously appended cards would over-print with this segment's first card for
      // the whole cross-fade — trim them to the shifted boundary
      clampCueTail(cues, acc);
      clampCueTail(karaokeLines, acc);
    }
    const start = acc;
    acc += seg.duration;
    const end = acc;
    if (seg.voiceover) {
      // distribute cards over the real speech window, not the padded clip window —
      // otherwise the tail silence stretches every card and captions lag the voice.
      // +0.15 covers mp3 decoder padding / probe rounding.
      const speechEnd =
        seg.voiceSec && seg.voiceSec > 0 ? Math.min(start + seg.voiceSec + 0.15, end) : end;
      const cards = chunkCaption(seg.voiceover, start, speechEnd);
      // absolute word timings on the video timeline (engine times are relative to the clip's audio)
      const absWords = (seg.words ?? [])
        .filter((w) => w.text && w.endSec > w.startSec)
        .map((w) => ({ text: w.text, startSec: start + w.startSec, endSec: Math.min(start + w.endSec, end) }))
        .filter((w) => w.startSec < end);
      // card flips land on real word edges instead of mid-word (proportional splits can't know)
      if (absWords.length > 0) snapCuesToWords(cards, absWords.map((w) => w.endSec));
      // hold the last card through the breathing gap instead of leaving a blank screen
      if (cards.length > 0) cards[cards.length - 1].endTime = Number(end.toFixed(3));
      cues.push(...cards);
      karaokeLines.push({
        text: seg.voiceover,
        startTime: start,
        endTime: end,
        // \k timing must span the speech only — the padded tail used to make highlights crawl on
        // after the voice finished; display still holds to `end` so the screen never goes blank
        speechEndTime: speechEnd,
        ...(absWords.length > 0 ? { words: absWords } : {}),
      });
    }
    if (seg.overlay && seg.overlay.text) {
      overlays.push({
        text: seg.overlay.text,
        style: seg.overlay.style,
        startTime: start,
        endTime: end,
      });
    }
  });
  return { cues, karaokeLines, overlays, total: acc };
}

/**
 * Splice times of the composed video: the start of every segment after the first, matching
 * the composer's xfade timeline exactly (an ffmpeg_fade segment overlaps its predecessor by
 * FADE_DURATION, shifting everything after it forward). Written next to the output as a
 * timeline sidecar so the contact sheet can mark splice points authoritatively — per-frame
 * scene detection cannot see gradual cross-fades at all (each fade frame only changes a few
 * percent), so for our own renders the composer's knowledge is the only reliable source.
 */
export function segmentBoundaries(segments: { duration: number; transition: string }[]): number[] {
  const bounds: number[] = [];
  let acc = 0;
  segments.forEach((seg, idx) => {
    if (idx > 0 && seg.transition === "ffmpeg_fade") acc -= FADE_DURATION;
    if (idx > 0) bounds.push(Number(acc.toFixed(3)));
    acc += seg.duration;
  });
  return bounds;
}

/**
 * Return per-clip durations padded for audio cross-fades: a voiced clip whose successor
 * enters via ffmpeg_fade gains FADE_DURATION of tail so acrossfade only ever consumes
 * silence. Without this, the last ~0.5s of narration was faded out mid-word while the
 * next segment's voice was already coming in (issue #14 "上一段还没说完下一段就开始").
 */
export function padDurationsForFade(
  items: { duration: number; transition: string; hasVoice: boolean }[]
): number[] {
  return items.map((item, i) => {
    const next = items[i + 1];
    return next && next.transition === "ffmpeg_fade" && item.hasVoice
      ? item.duration + FADE_DURATION
      : item.duration;
  });
}

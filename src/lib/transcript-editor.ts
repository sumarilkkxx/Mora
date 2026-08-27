import type { KaraokeLine, KaraokeWord } from "@/lib/video-composer/karaoke";

export interface TimeRange {
  start: number;
  end: number;
}

export interface TranscriptWord extends TimeRange {
  id: string;
  text: string;
  confidence?: number;
}

export interface TranscriptSegment extends TimeRange {
  id: string;
  text: string;
}

export interface TranscriptDocument {
  version: 1;
  text: string;
  language: string;
  duration: number;
  model: string;
  device: "webgpu" | "wasm";
  words: TranscriptWord[];
  segments: TranscriptSegment[];
  silenceRanges: TimeRange[];
  createdAt: string;
}

export interface TranscriptEditPlan {
  version: 1;
  removedWordIds: string[];
  removeSilence: boolean;
  silencePaddingMs: number;
  wordPaddingMs: number;
  burnSubtitles: boolean;
}

export const DEFAULT_TRANSCRIPT_EDIT_PLAN: TranscriptEditPlan = {
  version: 1,
  removedWordIds: [],
  removeSilence: false,
  silencePaddingMs: 120,
  wordPaddingMs: 25,
  burnSubtitles: true,
};

function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeTimeRanges(ranges: TimeRange[], duration = Number.POSITIVE_INFINITY): TimeRange[] {
  const cleaned = ranges
    .map((range) => ({
      start: clamp(finite(range.start), 0, duration),
      end: clamp(finite(range.end), 0, duration),
    }))
    .filter((range) => range.end - range.start >= 0.015)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TimeRange[] = [];
  for (const range of cleaned) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 0.015) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function sanitizeTranscriptDocument(value: unknown, sourceDuration = 0): TranscriptDocument | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<TranscriptDocument>;
  const claimedDuration = Math.max(0, finite(raw.duration, sourceDuration));
  const duration = sourceDuration > 0 ? sourceDuration : claimedDuration;
  const words = Array.isArray(raw.words)
    ? raw.words
        .map((word, index) => {
          const item = word as Partial<TranscriptWord>;
          const text = typeof item.text === "string" ? item.text.replace(/\s+/g, " ").trim() : "";
          const start = clamp(finite(item.start), 0, duration || Number.POSITIVE_INFINITY);
          const end = clamp(finite(item.end), start, duration || Number.POSITIVE_INFINITY);
          return text && end > start
            ? { id: typeof item.id === "string" && item.id ? item.id : `w${index + 1}`, text, start, end, ...(Number.isFinite(item.confidence) ? { confidence: item.confidence } : {}) }
            : null;
        })
        .filter((word): word is TranscriptWord => word !== null)
    : [];
  if (!words.length) return null;
  const segments = Array.isArray(raw.segments)
    ? raw.segments
        .map((segment, index) => {
          const item = segment as Partial<TranscriptSegment>;
          const text = typeof item.text === "string" ? item.text.replace(/\s+/g, " ").trim() : "";
          const start = clamp(finite(item.start), 0, duration || Number.POSITIVE_INFINITY);
          const end = clamp(finite(item.end), start, duration || Number.POSITIVE_INFINITY);
          return text && end > start ? { id: typeof item.id === "string" && item.id ? item.id : `s${index + 1}`, text, start, end } : null;
        })
        .filter((segment): segment is TranscriptSegment => segment !== null)
    : [];
  return {
    version: 1,
    text: typeof raw.text === "string" && raw.text.trim() ? raw.text.trim() : words.map((word) => word.text).join(" "),
    language: typeof raw.language === "string" && raw.language ? raw.language.slice(0, 24) : "auto",
    duration: duration || words.at(-1)?.end || 0,
    model: typeof raw.model === "string" ? raw.model.slice(0, 160) : "",
    device: raw.device === "webgpu" ? "webgpu" : "wasm",
    words,
    segments,
    silenceRanges: normalizeTimeRanges(Array.isArray(raw.silenceRanges) ? raw.silenceRanges : [], duration || Number.POSITIVE_INFINITY),
    createdAt: typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : new Date().toISOString(),
  };
}

const transcriptSentenceEnd = /[。！？!?；;…]$/;

export function segmentsFromWords(words: TranscriptWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let group: TranscriptWord[] = [];
  const flush = () => {
    if (!group.length) return;
    const cjk = group.some((word) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(word.text));
    const text = cjk
      ? group.map((word) => word.text).join("")
      : group.map((word) => word.text).join(" ").replace(/\s+([,.!?;:])/g, "$1");
    segments.push({ id: `s${segments.length + 1}`, text, start: group[0].start, end: group.at(-1)!.end });
    group = [];
  };
  for (const word of words) {
    const gap = group.length ? word.start - group.at(-1)!.end : 0;
    if (group.length && (gap > 0.8 || word.end - group[0].start > 5.5 || group.length >= 24)) flush();
    group.push(word);
    if (transcriptSentenceEnd.test(word.text)) flush();
  }
  flush();
  return segments;
}

export function sanitizeTranscriptEditPlan(value: unknown, wordIds: Set<string>): TranscriptEditPlan {
  const raw = value && typeof value === "object" ? value as Partial<TranscriptEditPlan> : {};
  const removed = Array.isArray(raw.removedWordIds)
    ? [...new Set(raw.removedWordIds.filter((id): id is string => typeof id === "string" && wordIds.has(id)))]
    : [];
  return {
    version: 1,
    removedWordIds: removed,
    removeSilence: raw.removeSilence === true,
    silencePaddingMs: clamp(Math.round(finite(raw.silencePaddingMs, DEFAULT_TRANSCRIPT_EDIT_PLAN.silencePaddingMs)), 0, 1000),
    wordPaddingMs: clamp(Math.round(finite(raw.wordPaddingMs, DEFAULT_TRANSCRIPT_EDIT_PLAN.wordPaddingMs)), 0, 250),
    burnSubtitles: raw.burnSubtitles !== false,
  };
}

export function removedRangesForPlan(document: TranscriptDocument, plan: TranscriptEditPlan): TimeRange[] {
  const removedIds = new Set(plan.removedWordIds);
  const wordPadding = plan.wordPaddingMs / 1000;
  const ranges = document.words
    .filter((word) => removedIds.has(word.id))
    .map((word) => ({ start: Math.max(0, word.start - wordPadding), end: Math.min(document.duration, word.end + wordPadding) }));
  if (plan.removeSilence) {
    const silencePadding = plan.silencePaddingMs / 1000;
    for (const silence of document.silenceRanges) {
      const start = silence.start + silencePadding;
      const end = silence.end - silencePadding;
      if (end > start) ranges.push({ start, end });
    }
  }
  return normalizeTimeRanges(ranges, document.duration);
}

export function subtractTimeRanges(duration: number, removed: TimeRange[]): TimeRange[] {
  const total = Math.max(0, finite(duration));
  if (!total) return [];
  const normalized = normalizeTimeRanges(removed, total);
  const kept: TimeRange[] = [];
  let cursor = 0;
  for (const range of normalized) {
    if (range.start - cursor >= 0.04) kept.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (total - cursor >= 0.04) kept.push({ start: cursor, end: total });
  return kept;
}

export function keepRangesForPlan(document: TranscriptDocument, plan: TranscriptEditPlan): TimeRange[] {
  return subtractTimeRanges(document.duration, removedRangesForPlan(document, plan));
}

export function outputDuration(kept: TimeRange[]): number {
  return kept.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0);
}

function mapSourceTime(time: number, kept: TimeRange[]): number | null {
  let outputCursor = 0;
  for (const range of kept) {
    if (time >= range.start - 0.001 && time <= range.end + 0.001) {
      return outputCursor + clamp(time - range.start, 0, range.end - range.start);
    }
    outputCursor += range.end - range.start;
  }
  return null;
}

export function remapKeptWords(document: TranscriptDocument, kept: TimeRange[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const word of document.words) {
    const start = mapSourceTime(word.start, kept);
    const end = mapSourceTime(word.end, kept);
    if (start === null || end === null || end <= start) continue;
    out.push({ ...word, start, end });
  }
  return out;
}

const sentenceEnd = transcriptSentenceEnd;
const isCjkText = (text: string) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);

export function karaokeLinesFromWords(words: TranscriptWord[]): KaraokeLine[] {
  const lines: KaraokeLine[] = [];
  let group: TranscriptWord[] = [];
  const flush = () => {
    if (!group.length) return;
    const text = isCjkText(group.map((word) => word.text).join(""))
      ? group.map((word) => word.text).join("")
      : group.map((word) => word.text).join(" ").replace(/\s+([,.!?;:])/g, "$1");
    const karaokeWords: KaraokeWord[] = group.map((word) => ({ text: word.text, startSec: word.start, endSec: word.end }));
    lines.push({ text, startTime: group[0].start, endTime: Math.max(group.at(-1)!.end + 0.12, group[0].start + 0.3), speechEndTime: group.at(-1)!.end, words: karaokeWords });
    group = [];
  };
  for (const word of words) {
    const nextText = group.map((item) => item.text).concat(word.text).join("");
    const maxUnits = isCjkText(nextText) ? 16 : 8;
    const tooLong = group.length >= maxUnits || (group.length > 0 && word.end - group[0].start > 3.2);
    const discontinuity = group.length > 0 && word.start - group.at(-1)!.end > 0.8;
    if (tooLong || discontinuity) flush();
    group.push(word);
    if (sentenceEnd.test(word.text)) flush();
  }
  flush();
  for (let i = 0; i < lines.length - 1; i++) lines[i].endTime = Math.min(lines[i].endTime, lines[i + 1].startTime);
  return lines;
}

export function detectSilenceRanges(
  samples: Float32Array,
  sampleRate: number,
  thresholdDb = -38,
  minimumMs = 550,
): TimeRange[] {
  if (!samples.length || sampleRate <= 0) return [];
  const windowSize = Math.max(1, Math.round(sampleRate * 0.02));
  const threshold = 10 ** (thresholdDb / 20);
  const minimumWindows = Math.max(1, Math.ceil((minimumMs / 1000) * sampleRate / windowSize));
  const silent: boolean[] = [];
  for (let offset = 0; offset < samples.length; offset += windowSize) {
    const end = Math.min(samples.length, offset + windowSize);
    let energy = 0;
    for (let i = offset; i < end; i++) energy += samples[i] * samples[i];
    silent.push(Math.sqrt(energy / Math.max(1, end - offset)) < threshold);
  }
  const ranges: TimeRange[] = [];
  let startWindow: number | null = null;
  for (let i = 0; i <= silent.length; i++) {
    if (silent[i] && startWindow === null) startWindow = i;
    if ((!silent[i] || i === silent.length) && startWindow !== null) {
      if (i - startWindow >= minimumWindows) {
        ranges.push({ start: startWindow * windowSize / sampleRate, end: Math.min(samples.length, i * windowSize) / sampleRate });
      }
      startWindow = null;
    }
  }
  return normalizeTimeRanges(ranges, samples.length / sampleRate);
}

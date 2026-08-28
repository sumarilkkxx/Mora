import type { TimeRange } from "@/lib/transcript-editor";

export const GUIDED_EDIT_ROLES = ["hook", "introduction", "feature", "usage", "cta"] as const;
export type GuidedEditRole = (typeof GUIDED_EDIT_ROLES)[number];

export const MAX_GUIDED_OUTPUT_SECONDS = 45;
export const MIN_GUIDED_SPEECH_RATE = 0.75;
export const MAX_GUIDED_SPEECH_RATE = 2;
export const GUIDED_EDIT_STYLES = [
  "natural",
  "slow_zoom",
  "dynamic_focus",
  "product_pan",
  "handheld",
  "impact",
] as const;
export type GuidedEditStyle = (typeof GUIDED_EDIT_STYLES)[number];

export const SCENE_LABELS = [
  "highlight",
  "product_full",
  "product_detail",
  "product_in_use",
  "demonstration",
  "result",
  "brand",
  "store",
  "other",
  "unused",
] as const;
export type SceneLabel = (typeof SCENE_LABELS)[number];

export interface GuidedEditBrief {
  version: 1;
  inputMode: "full_script" | "guided";
  projectName: string;
  productName: string;
  promotionGoal: string;
  fullScript: string;
  hook: string;
  introduction: string;
  sellingPoints: string[];
  proof: string;
  usageScene: string;
  cta: string;
  targetDuration: number;
  /** Narration / caption pacing multiplier. Older saved plans omit it and default to 1×. */
  speechRate?: number;
  /** Visual pacing applied by the local FFmpeg renderer. Older plans default to natural cuts. */
  editStyle?: GuidedEditStyle;
  aspectRatio: "9:16" | "16:9" | "1:1";
  audioMode: "original" | "muted" | "uploaded_voice" | "local_voice";
  voiceoverFile?: string;
  voiceoverName?: string;
  voiceoverVoice?: string;
  burnSubtitles: boolean;
  captionSize: "small" | "medium" | "large";
  captionLanguage: "auto" | "zh" | "en";
}

export interface GuidedScene extends TimeRange {
  id: string;
  thumbnailUrl?: string;
  label: SceneLabel;
  selected: boolean;
}

export interface GuidedScriptBeat {
  id: string;
  role: GuidedEditRole;
  text: string;
  estimatedDuration: number;
  sceneIds: string[];
}

export interface GuidedTimelineClip extends TimeRange {
  id: string;
  sourceId: string;
  sceneId: string;
  beatId: string;
  outputStart: number;
  outputEnd: number;
}

export interface GuidedEditPlanDocument {
  version: 1;
  brief: GuidedEditBrief;
  scenes: GuidedScene[];
  beats: GuidedScriptBeat[];
  timeline: GuidedTimelineClip[];
  outputDuration: number;
}

export const DEFAULT_GUIDED_EDIT_BRIEF: GuidedEditBrief = {
  version: 1,
  inputMode: "guided",
  projectName: "",
  productName: "",
  promotionGoal: "",
  fullScript: "",
  hook: "",
  introduction: "",
  sellingPoints: [""],
  proof: "",
  usageScene: "",
  cta: "",
  targetDuration: 30,
  speechRate: 1,
  editStyle: "natural",
  aspectRatio: "9:16",
  audioMode: "local_voice",
  voiceoverVoice: "zh-CN-XiaoxiaoNeural",
  burnSubtitles: true,
  captionSize: "medium",
  captionLanguage: "auto",
};

export type GuidedCaptionLanguage = "zh" | "en" | "mixed";

export function detectGuidedCaptionLanguage(text: string): GuidedCaptionLanguage {
  const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cjk && latin) return "mixed";
  return cjk ? "zh" : "en";
}

const cleanText = (value: unknown, max = 2000): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

function finite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function sanitizeGuidedSpeechRate(value: unknown): number {
  return Math.min(MAX_GUIDED_SPEECH_RATE, Math.max(MIN_GUIDED_SPEECH_RATE, finite(value, 1)));
}

export function sanitizeGuidedEditBrief(value: unknown): GuidedEditBrief {
  const raw = value && typeof value === "object" ? value as Partial<GuidedEditBrief> : {};
  const sellingPoints = Array.isArray(raw.sellingPoints)
    ? raw.sellingPoints.map((item) => cleanText(item, 500)).filter(Boolean).slice(0, 6)
    : [];
  return {
    version: 1,
    inputMode: raw.inputMode === "full_script" ? "full_script" : "guided",
    projectName: cleanText(raw.projectName, 160),
    productName: cleanText(raw.productName, 160),
    promotionGoal: cleanText(raw.promotionGoal, 500),
    fullScript: typeof raw.fullScript === "string" ? raw.fullScript.trim().slice(0, 12_000) : "",
    hook: cleanText(raw.hook, 500),
    introduction: cleanText(raw.introduction, 500),
    sellingPoints,
    // Kept in the saved-document shape for backwards compatibility only. The
    // streamlined editor no longer exposes or narrates this legacy section.
    proof: "",
    usageScene: cleanText(raw.usageScene, 500),
    cta: cleanText(raw.cta, 500),
    targetDuration: Math.min(MAX_GUIDED_OUTPUT_SECONDS, Math.max(1, finite(raw.targetDuration, 30))),
    speechRate: sanitizeGuidedSpeechRate(raw.speechRate),
    editStyle: GUIDED_EDIT_STYLES.includes(raw.editStyle as GuidedEditStyle) ? raw.editStyle as GuidedEditStyle : "natural",
    aspectRatio: raw.aspectRatio === "16:9" || raw.aspectRatio === "1:1" ? raw.aspectRatio : "9:16",
    audioMode: raw.audioMode === "original" || raw.audioMode === "uploaded_voice" || raw.audioMode === "local_voice" ? raw.audioMode : "muted",
    voiceoverFile: typeof raw.voiceoverFile === "string" ? raw.voiceoverFile.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 240) : undefined,
    voiceoverName: cleanText(raw.voiceoverName, 240) || undefined,
    voiceoverVoice: typeof raw.voiceoverVoice === "string" && /^[A-Za-z0-9-]{1,80}$/.test(raw.voiceoverVoice)
      ? raw.voiceoverVoice
      : "zh-CN-XiaoxiaoNeural",
    burnSubtitles: raw.burnSubtitles !== false,
    captionSize: raw.captionSize === "small" || raw.captionSize === "large" ? raw.captionSize : "medium",
    captionLanguage: raw.captionLanguage === "zh" || raw.captionLanguage === "en" ? raw.captionLanguage : "auto",
  };
}

export function estimateSpeechDuration(text: string, speechRate: unknown = 1): number {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return 0;
  const cjk = (clean.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
  const latinWords = clean.replace(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  const punctuationPauses = (clean.match(/[，,。.!！?？；;：:]/g) ?? []).length * 0.12;
  const baseDuration = cjk / 4.2 + latinWords / 2.6 + punctuationPauses;
  return Math.max(0.8, Number((baseDuration / sanitizeGuidedSpeechRate(speechRate)).toFixed(2)));
}

export function splitPromotionScript(text: string): string[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [];
  const sentences = normalized
    .split(/\n+/)
    .flatMap((line) => line.match(/[^。！？.!?；;]+[。！？.!?；;]?/g) ?? [])
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return sentences.slice(0, 80);
}

function inferredRole(index: number, total: number): GuidedEditRole {
  if (index === 0) return "hook";
  if (index === total - 1 && total > 2) return "cta";
  if (index === 1) return "introduction";
  return "feature";
}

export function buildGuidedScriptBeats(briefValue: unknown): GuidedScriptBeat[] {
  const brief = sanitizeGuidedEditBrief(briefValue);
  const entries: Array<{ role: GuidedEditRole; text: string }> = [];
  if (brief.inputMode === "full_script") {
    const sentences = splitPromotionScript(brief.fullScript);
    sentences.forEach((text, index) => entries.push({ role: inferredRole(index, sentences.length), text }));
  } else {
    if (brief.hook) entries.push({ role: "hook", text: brief.hook });
    if (brief.introduction) entries.push({ role: "introduction", text: brief.introduction });
    for (const point of brief.sellingPoints.filter(Boolean)) entries.push({ role: "feature", text: point });
    if (brief.usageScene) entries.push({ role: "usage", text: brief.usageScene });
    if (brief.cta) entries.push({ role: "cta", text: brief.cta });
  }
  return entries.map((entry, index) => ({
    id: `beat-${index + 1}`,
    role: entry.role,
    text: entry.text,
    estimatedDuration: estimateSpeechDuration(entry.text, brief.speechRate),
    sceneIds: [],
  }));
}

export function sanitizeGuidedScriptBeats(value: unknown): GuidedScriptBeat[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<GuidedScriptBeat>;
    const text = cleanText(raw.text, 1200);
    if (!text) return [];
    const persistedRole = typeof (item as { role?: unknown }).role === "string" ? (item as { role: string }).role : "";
    const role: GuidedEditRole = persistedRole === "proof"
      ? "feature"
      : GUIDED_EDIT_ROLES.includes(persistedRole as GuidedEditRole) ? persistedRole as GuidedEditRole : inferredRole(index, value.length);
    const sceneIds = Array.isArray(raw.sceneIds)
      ? [...new Set(raw.sceneIds.filter((id): id is string => typeof id === "string" && id.length > 0).map((id) => id.slice(0, 120)))].slice(0, 20)
      : [];
    return [{
      id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 120) : `beat-${index + 1}`,
      role,
      text,
      estimatedDuration: Math.min(60, Math.max(0.8, finite(raw.estimatedDuration, estimateSpeechDuration(text)))),
      sceneIds,
    }];
  }).slice(0, 80);
}

export function scaleGuidedBeatDurations(beats: GuidedScriptBeat[], durationValue: unknown): GuidedScriptBeat[] {
  const duration = Number(durationValue);
  const currentDuration = beats.reduce((sum, beat) => sum + beat.estimatedDuration, 0);
  if (!Number.isFinite(duration) || duration <= 0 || currentDuration <= 0) return beats;
  return beats.map((beat) => ({
    ...beat,
    estimatedDuration: Number((beat.estimatedDuration / currentDuration * duration).toFixed(3)),
  }));
}

export function applyGuidedSpeechRate(beats: GuidedScriptBeat[], speechRate: unknown): GuidedScriptBeat[] {
  return beats.map((beat) => ({
    ...beat,
    estimatedDuration: estimateSpeechDuration(beat.text, speechRate),
  }));
}

export function sanitizeGuidedScenes(value: unknown, sourceDuration: number): GuidedScene[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<GuidedScene>;
    const start = Math.min(sourceDuration, Math.max(0, finite(raw.start, 0)));
    const end = Math.min(sourceDuration, Math.max(start, finite(raw.end, start)));
    if (end - start < 0.2) return [];
    const label = SCENE_LABELS.includes(raw.label as SceneLabel) ? raw.label as SceneLabel : "other";
    return [{
      id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 120) : `scene-${index + 1}`,
      start,
      end,
      thumbnailUrl: typeof raw.thumbnailUrl === "string" ? raw.thumbnailUrl.slice(0, 500) : undefined,
      label,
      selected: raw.selected !== false && label !== "unused",
    }];
  }).slice(0, 240);
}

export function buildGuidedTimeline(input: {
  sourceId: string;
  sourceDuration: number;
  beats: GuidedScriptBeat[];
  scenes: GuidedScene[];
}): GuidedTimelineClip[] {
  const available = input.scenes.filter((scene) => scene.selected && scene.label !== "unused");
  const fallback: GuidedScene[] = available.length ? available : [{
    id: "scene-full",
    start: 0,
    end: Math.max(0.5, input.sourceDuration),
    label: "other",
    selected: true,
  }];
  const sceneById = new Map(fallback.map((scene) => [scene.id, scene]));
  const timeline: GuidedTimelineClip[] = [];
  let globalSceneCursor = 0;
  let outputCursor = 0;

  for (const beat of input.beats) {
    let remaining = Math.max(0.8, beat.estimatedDuration);
    const bound = beat.sceneIds.map((id) => sceneById.get(id)).filter((scene): scene is GuidedScene => Boolean(scene));
    const candidates = bound.length ? bound : fallback;
    let localCursor = 0;
    let guard = 0;
    // A long narration beat may need to reuse several short source scenes. The
    // old 20-clip guard silently shortened valid copy; 240 covers the 45-second
    // ceiling even with the minimum 0.2-second clip while remaining bounded.
    while (remaining > 0.04 && guard < 240) {
      const scene = candidates[bound.length ? localCursor % candidates.length : globalSceneCursor % candidates.length];
      if (!bound.length) globalSceneCursor += 1;
      localCursor += 1;
      guard += 1;
      const sceneDuration = Math.max(0.2, scene.end - scene.start);
      const duration = Math.min(remaining, sceneDuration);
      timeline.push({
        id: `clip-${timeline.length + 1}`,
        sourceId: input.sourceId,
        sceneId: scene.id,
        beatId: beat.id,
        start: scene.start,
        end: scene.start + duration,
        outputStart: outputCursor,
        outputEnd: outputCursor + duration,
      });
      remaining -= duration;
      outputCursor += duration;
    }
  }
  return timeline;
}

export function outputDurationForGuidedTimeline(timeline: GuidedTimelineClip[]): number {
  return timeline.reduce((max, clip) => Math.max(max, clip.outputEnd), 0);
}

export function createGuidedEditPlan(input: {
  brief: unknown;
  scenes: unknown;
  sourceId: string;
  sourceDuration: number;
  existingBeats?: GuidedScriptBeat[];
}): GuidedEditPlanDocument {
  const brief = sanitizeGuidedEditBrief(input.brief);
  const scenes = sanitizeGuidedScenes(input.scenes, input.sourceDuration);
  const sanitizedExisting = sanitizeGuidedScriptBeats(input.existingBeats);
  const beats = sanitizedExisting.length ? sanitizedExisting : buildGuidedScriptBeats(brief);
  const timeline = buildGuidedTimeline({ sourceId: input.sourceId, sourceDuration: input.sourceDuration, beats, scenes });
  const outputDuration = outputDurationForGuidedTimeline(timeline);
  return {
    version: 1,
    brief: { ...brief, targetDuration: Math.min(MAX_GUIDED_OUTPUT_SECONDS, outputDuration) },
    scenes,
    beats,
    timeline,
    outputDuration,
  };
}

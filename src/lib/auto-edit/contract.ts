/** Shared, dependency-free contract. Source time is authoritative; output time is computed. */
export const MAX_SOURCE_SECONDS = 300;
export const MAX_OUTPUT_SECONDS = 30;
export const FPS = 30;
export type AudioMode = "original" | "voiceover" | "muted";
export type EditStatus = "queued" | "running" | "cancel_requested" | "cancelled" | "interrupted" | "failed" | "done" | "needs_review" | "waiting_input";
export interface EditBrief {
  instruction: string;
  target: 15 | 20 | 30;
  aspect: "9:16" | "16:9" | "1:1";
  audio: AudioMode;
  style: "auto" | "concise" | "highlights" | "story";
  captions: boolean;
  locale: "zh" | "en";
  bgm?: string;
}
export interface Speech { start: number; end: number; text: string }
export interface Scene extends Speech { evidence: number[]; uncertainty: string }
export interface Analysis { version: 1; summary: string; style: string; scenes: Scene[]; speech: Speech[]; sampledAt: number[]; warnings: string[] }
export interface EditClip {
  sourceId: string;
  start: number;
  end: number;
  speed: number;
  fit: "contain" | "cover";
  transition: "cut" | "fade";
  text: string;
  reason: string;
  evidence: string;
}
export interface EditPlan { version: 1; title: string; explanation: string; clips: EditClip[] }
export interface TimelineClip extends EditClip { outputStart: number; outputEnd: number; overlap: number }
export interface CheckResult { technical: boolean; issues: string[]; review: string[]; duration: number }
export interface Checkpoint {
  sourceHash?: string;
  operation?: "auto" | "manual" | "candidates" | "export";
  inheritedReview?: string[];
  analysis?: Analysis;
  plan?: EditPlan;
  candidates?: EditPlan[];
  voices?: Array<{ index: number; file: string; duration: number; text: string }>;
  checks?: CheckResult;
  output?: string;
  history: Array<{ at: string; action: string; detail: string }>;
  repairs: number;
}
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Expected object / 参数必须为对象");
  return raw as Record<string, unknown>;
}
export function text(raw: unknown, max = 2000): string { return typeof raw === "string" ? raw.trim().slice(0, max) : ""; }
export function validateSource(duration: number, bytes: number) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SOURCE_SECONDS) throw new Error("AI 自动剪辑仅支持 5 分钟以内视频 / Source must be within 5 minutes");
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > 1024 ** 3) throw new Error("视频大小不能超过 1GB / Maximum file size is 1GB");
}
export function parseBrief(value: unknown): EditBrief {
  const raw = object(value);
  if (!text(raw.instruction)) throw new Error("请填写剪辑要求 / Add editing instructions");
  if (![15, 20, 30].includes(raw.target as number)) throw new Error("目标时长必须为 15、20 或 30 秒 / Invalid target duration");
  if (!["9:16", "16:9", "1:1"].includes(String(raw.aspect))) throw new Error("Invalid aspect ratio");
  if (!["original", "voiceover", "muted"].includes(String(raw.audio))) throw new Error("Invalid audio mode");
  if (!["auto", "concise", "highlights", "story"].includes(String(raw.style))) throw new Error("Invalid style");
  return { instruction: text(raw.instruction, 4000), target: raw.target as EditBrief["target"], aspect: raw.aspect as EditBrief["aspect"], audio: raw.audio as AudioMode, style: raw.style as EditBrief["style"], captions: raw.captions !== false, locale: raw.locale === "en" ? "en" : "zh", ...(text(raw.bgm) ? { bgm: text(raw.bgm, 500) } : {}) };
}
export function parsePlan(value: unknown, sourceId: string, duration: number, brief: EditBrief): EditPlan {
  const raw = object(value);
  if (raw.version !== 1) throw new Error("不支持的计划版本 / Unsupported plan version");
  if (!Array.isArray(raw.clips) || raw.clips.length < 1 || raw.clips.length > 20) throw new Error("计划必须包含 1–20 个片段 / Plan needs 1–20 clips");
  const clips = raw.clips.map((item): EditClip => {
    const c = object(item);
    if (c.sourceId !== sourceId) throw new Error("素材不属于当前任务 / Foreign source ID");
    if (typeof c.start !== "number" || typeof c.end !== "number" || !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end > duration || c.end - c.start < 0.4) throw new Error("片段时间越界或过短 / Invalid source interval");
    const speed = c.speed ?? 1;
    if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0.85 || speed > 1.15 || (brief.audio === "original" && speed !== 1)) throw new Error("变速超出范围；原声须保持正常语速 / Invalid speed");
    if (c.fit !== "contain" && c.fit !== "cover") throw new Error("Invalid fit");
    if (c.transition !== "cut" && c.transition !== "fade") throw new Error("Invalid transition");
    return { sourceId, start: c.start, end: c.end, speed, fit: c.fit, transition: c.transition, text: text(c.text, 300), reason: text(c.reason, 500), evidence: text(c.evidence, 600) };
  });
  const plan: EditPlan = { version: 1, title: text(raw.title, 100), explanation: text(raw.explanation), clips };
  const total = timeline(plan).at(-1)!.outputEnd;
  if (total > brief.target + 0.000001 || total > MAX_OUTPUT_SECONDS) throw new Error(`计划 ${total.toFixed(2)} 秒超过目标 ${brief.target} 秒 / Plan exceeds target`);
  return plan;
}
export function timeline(plan: EditPlan): TimelineClip[] {
  let cursor = 0;
  return plan.clips.map((clip, i) => {
    const duration = Math.floor((clip.end - clip.start) / clip.speed * FPS + 1e-7) / FPS;
    // Voice/original plans are normalized to cuts before compilation to preserve speech boundaries.
    const overlap = i > 0 && clip.transition === "fade" ? Math.floor(Math.min(0.2, duration / 4, (plan.clips[i - 1].end - plan.clips[i - 1].start) / plan.clips[i - 1].speed / 4) * FPS) / FPS : 0;
    const outputStart = cursor - overlap;
    cursor = Math.round((outputStart + duration) * FPS) / FPS;
    return { ...clip, overlap, outputStart, outputEnd: cursor };
  });
}
export function validateSpeechCuts(plan: EditPlan, speech: Speech[]) {
  for (const c of plan.clips) {
    const cut = speech.some(s => (c.start > s.start + 0.12 && c.start < s.end - 0.12) || (c.end > s.start + 0.12 && c.end < s.end - 0.12));
    if (cut) throw new Error("原声片段截断语句，请沿转写边界剪切 / Cut splits a speech segment");
  }
}
export function sampleTimes(duration: number, count = 24): number[] {
  return Array.from({ length: Math.max(2, count) }, (_, i) => Number((Math.max(0, duration - 0.05) * i / (Math.max(2, count) - 1)).toFixed(3)));
}
export function candidateSignature(plan: EditPlan): string {
  return JSON.stringify(plan.clips.map(c => [c.start, c.end, c.speed, c.text]));
}
export function outputReviewSamples(plan: EditPlan) {
  return timeline(plan).map((clip, index) => {
    const time = (clip.outputStart + clip.outputEnd) / 2;
    return { index, time: Number(time.toFixed(3)), sourceAt: Number((clip.start + (time - clip.outputStart) * clip.speed).toFixed(3)), text: clip.text, evidence: clip.evidence };
  });
}

import type { Checkpoint, EditBrief, EditPlan, EditStatus, PromotionCopy } from "./contract";

export interface EditSource { id: string; originalName: string; duration: number; url: string }
export interface EditRun {
  id: string; sourceId: string; parentId?: string; status: EditStatus; stage: string;
  brief: EditBrief; checkpoint: Checkpoint; url: string | null; error: string | null;
  quality: string; createdAt?: number; updatedAt?: number;
}
export interface WorkspaceDraft {
  version: 1; sourceId: string; brief: EditBrief; copy: PromotionCopy; bgmName: string;
}
export const EMPTY_COPY: PromotionCopy = { version: 1, title: "", angle: "", hook: "", body: "", cta: "", voiceover: "", evidence: [] };
export const isActive = (run?: EditRun) => Boolean(run && ["queued", "running", "cancel_requested"].includes(run.status));
export const canRetry = (run?: EditRun) => Boolean(run && ["failed", "interrupted", "cancelled"].includes(run.status));
export const requiresReview = (run: EditRun) => run.status === "needs_review" || Boolean(run.checkpoint.checks?.review.length || run.checkpoint.checks?.issues.length);

export function runStep(run?: EditRun): number {
  if (!run) return 0;
  if (run.status === "waiting_input") return run.checkpoint.plan || run.checkpoint.candidates?.length ? 2 : run.checkpoint.promotionCopy ? 1 : 0;
  if (run.url || ["manual", "export", "auto"].includes(run.checkpoint.operation ?? "")) return 3;
  if (run.checkpoint.operation === "candidates" || run.checkpoint.candidates?.length) return 2;
  if (run.checkpoint.operation === "analysis" || run.checkpoint.promotionCopy) return 1;
  return 0;
}

export function plansFor(run: EditRun | undefined, runs: EditRun[]): EditPlan[] {
  const visited = new Set<string>();
  let row = run;
  while (row && !visited.has(row.id)) {
    visited.add(row.id);
    if (row.checkpoint.candidates?.length) return row.checkpoint.candidates;
    row = runs.find(item => item.id === row?.parentId);
  }
  return run?.checkpoint.plan ? [run.checkpoint.plan] : [];
}

/** An export can show its saved parent result while it is running or failed. */
export function playableRun(run: EditRun | undefined, runs: EditRun[]): EditRun | undefined {
  const visited = new Set<string>();
  let row = run;
  while (row && !visited.has(row.id)) {
    visited.add(row.id);
    if (row.url) return row;
    if (row.checkpoint.operation !== "export") return undefined;
    row = runs.find(item => item.id === row?.parentId);
  }
}

/** Match the exact parent and saved timeline, never an unrelated project export. */
export function exportFor(result: EditRun | undefined, runs: EditRun[]): EditRun | undefined {
  if (!result || result.quality === "1080p") return undefined;
  const matches = runs.filter(row => row.parentId === result.id && row.sourceId === result.sourceId
    && row.checkpoint.operation === "export" && row.quality === "1080p"
    && JSON.stringify(row.brief) === JSON.stringify(result.brief)
    && JSON.stringify(row.checkpoint.plan) === JSON.stringify(result.checkpoint.plan));
  return matches.find(row => row.url) ?? matches.find(isActive) ?? matches[0];
}

export function completedSteps(run: EditRun | undefined, plans: EditPlan[]): boolean[] {
  return [Boolean(run?.checkpoint.analysis || run?.checkpoint.promotionCopy),
    Boolean(plans.length || run?.checkpoint.plan), Boolean(run?.checkpoint.plan), Boolean(run?.url)];
}

export function initialDraft(run: EditRun | undefined, sourceId: string, en: boolean): WorkspaceDraft {
  return { version: 1, sourceId: run?.sourceId ?? sourceId, bgmName: "", copy: run?.checkpoint.promotionCopy ?? EMPTY_COPY,
    brief: run?.brief ?? { instruction: "", target: 15, aspect: "9:16", audio: "voiceover", style: "auto", captions: true, locale: en ? "en" : "zh" } };
}

export function briefChanged(draft: WorkspaceDraft, base: WorkspaceDraft) {
  return draft.sourceId !== base.sourceId || JSON.stringify(draft.brief) !== JSON.stringify(base.brief);
}
export function draftChanged(draft: WorkspaceDraft, base: WorkspaceDraft) {
  return briefChanged(draft, base) || draft.copy.voiceover !== base.copy.voiceover;
}

export function readDraft(raw: string | null): WorkspaceDraft | undefined {
  if (!raw) return;
  try {
    const value = JSON.parse(raw) as WorkspaceDraft;
    if (value.version !== 1 || typeof value.sourceId !== "string" || typeof value.bgmName !== "string") return;
    const b = value.brief;
    if (!b || ![15, 20, 25, 30].includes(b.target) || !["9:16", "16:9", "1:1"].includes(b.aspect)
      || !["original", "voiceover", "muted"].includes(b.audio) || !["auto", "concise", "highlights", "story"].includes(b.style)
      || typeof b.instruction !== "string" || typeof b.captions !== "boolean" || !["zh", "en"].includes(b.locale)
      || (b.bgm !== undefined && typeof b.bgm !== "string")) return;
    if (!value.copy || !["title", "angle", "hook", "body", "cta", "voiceover"].every(k => typeof value.copy[k as keyof PromotionCopy] === "string")
      || !Array.isArray(value.copy.evidence) || !value.copy.evidence.every(item => typeof item === "string")) return;
    return value;
  } catch { return; }
}

export function runLabel(run: EditRun, en: boolean): string {
  const states: Partial<Record<EditStatus, [string, string]>> = {
    queued: ["等待开始", "Queued"], cancel_requested: ["正在停止…", "Stopping…"], cancelled: ["已停止", "Stopped"],
    interrupted: ["任务中断", "Interrupted"], failed: ["执行失败", "Failed"], needs_review: ["待人工复核", "Needs review"],
    done: ["已完成", "Completed"], waiting_input: ["等待确认", "Ready for review"],
  };
  const stages: Record<string, [string, string]> = {
    preparing: ["正在读取素材", "Reading source"], analyzing: ["正在理解画面", "Understanding video"],
    transcribing: ["正在识别声音", "Transcribing audio"], copywriting: ["正在撰写文案", "Writing copy"],
    planning: ["正在编排方案", "Planning edits"], voicing: ["正在准备旁白", "Preparing voiceover"],
    rendering: ["正在合成视频", "Rendering video"], checking: ["正在检查成片", "Checking output"],
  };
  return (states[run.status] ?? stages[run.stage] ?? ["正在处理", "Processing"])[en ? 1 : 0];
}

export function operationLabel(run: EditRun, en: boolean) {
  const labels: Record<string, [string, string]> = { analysis: ["素材分析", "Analysis"], candidates: ["文案与方案", "Copy & plans"],
    manual: ["成片", "Video"], export: ["高清导出", "HD export"], auto: ["自动剪辑", "Automatic edit"] };
  return (labels[run.checkpoint.operation ?? "auto"] ?? labels.auto)[en ? 1 : 0];
}

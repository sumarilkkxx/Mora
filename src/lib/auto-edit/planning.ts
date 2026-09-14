import { parsePlan, validateSpeechCuts, type Analysis, type EditBrief, type EditPlan, type PromotionCopy } from "./contract";

const STYLE_RECIPES = [
  { key: "story", zh: "过程叙事", en: "Process story", count: 5, anchors: [0.08, 0.28, 0.48, 0.68, 0.9] },
  { key: "highlights", zh: "亮点快剪", en: "Highlight cut", count: 9, anchors: [0.9, 0.12, 0.58, 0.34, 0.76, 0.46, 0.96, 0.22, 0.66] },
  { key: "reveal", zh: "成品先行", en: "Reveal first", count: 5, anchors: [0.62, 0.08, 0.2, 0.45, 0.9] },
] as const;

export function recommendedPlanIndex(strategy: PromotionCopy["strategy"], style: EditBrief["style"]): number {
  return strategy === "scenario" || style === "story" ? 0 : strategy === "explore" || strategy === "process" || style === "highlights" ? 1 : 2;
}

function splitCopy(copy: PromotionCopy) {
  const voiceover = copy.voiceover.split(/[。！？.!?；;\n]+/).map(value => value.trim()).filter(Boolean);
  if (voiceover.length) return voiceover;
  const body = copy.body.split(/[。！？.!?；;]+/).map(value => value.trim()).filter(Boolean);
  return [copy.hook, ...body, copy.cta].filter(Boolean);
}

/** Keep all approved text within the clip count and per-clip text limits. */
function groupCopy(lines: string[]): string[] {
  const chunks = lines.flatMap(line => line.match(/[\s\S]{1,240}/g) ?? []);
  while (chunks.length > 20) {
    let shortest = -1;
    for (let i = 0; i < chunks.length - 1; i++) {
      const length = chunks[i].length + chunks[i + 1].length + 1;
      if (length <= 300 && (shortest < 0 || length < chunks[shortest].length + chunks[shortest + 1].length + 1)) shortest = i;
    }
    if (shortest < 0) throw new Error("文案过长，请缩短文案 / Copy is too long");
    chunks.splice(shortest, 2, `${chunks[shortest]}。${chunks[shortest + 1]}`);
  }
  return chunks;
}

function originalClips(sourceId: string, duration: number, brief: EditBrief, analysis: Analysis, offset: number): EditPlan["clips"] {
  const boundaries = [...new Set([0, duration, ...Array.from({ length: Math.ceil(duration / brief.target) }, (_, i) => (i + 1) * brief.target), ...analysis.speech.flatMap(s => [s.start, s.end])])]
    .filter(time => time >= 0 && time <= duration && !analysis.speech.some(s => time > s.start && time < s.end)).sort((a, b) => a - b);
  const windows: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    let j = i + 1;
    while (j < boundaries.length && boundaries[j] - boundaries[i] < 0.4) j++;
    if (j < boundaries.length) windows.push({ start: boundaries[i], end: boundaries[j] });
  }
  const clips: EditPlan["clips"] = [];
  let remaining = brief.target as number;
  for (let i = 0; i < windows.length && clips.length < 20; i++) {
    const window = windows[(i + offset) % windows.length];
    if (window.end - window.start > remaining + 1e-7) continue;
    const speech = analysis.speech.filter(s => s.start >= window.start && s.end <= window.end).map(s => s.text).join(" ");
    clips.push({ sourceId, ...window, speed: 1, fit: "cover", transition: "cut", text: speech, reason: "保留完整原声语句", evidence: analysis.summary });
    remaining -= window.end - window.start;
  }
  if (!clips.length) throw new Error("原声语句超过目标时长，请增加时长或改用旁白 / No complete speech fits; increase duration or use voiceover");
  return clips;
}

function clipWindow(duration: number, wanted: number, anchor: number) {
  const length = Math.min(duration, Math.max(0.4, wanted));
  const start = Math.max(0, Math.min(duration - length, anchor - length / 2));
  return { start, end: start + length };
}

/** Deterministic safety net: preserves approved commercial copy while guaranteeing valid, diverse timelines. */
export function fallbackCandidatePlans(sourceId: string, sourceDuration: number, brief: EditBrief, analysis: Analysis, copy: PromotionCopy): EditPlan[] {
  const lines = groupCopy(splitCopy(copy));
  const scenes = analysis.scenes.length ? analysis.scenes : [{ start: 0, end: sourceDuration, text: analysis.summary, uncertainty: "", evidence: [] }];
  const recommendedIndex = recommendedPlanIndex(copy.strategy, brief.style);
  return STYLE_RECIPES.map((recipe, recipeIndex) => {
    if (brief.audio === "original") {
      const plan = parsePlan({ version: 1, title: brief.locale === "zh" ? recipe.zh : recipe.en, explanation: "保留完整原声语句 / Preserve complete speech", clips: originalClips(sourceId, sourceDuration, brief, analysis, recipeIndex) }, sourceId, sourceDuration, brief);
      validateSpeechCuts(plan, analysis.speech);
      return { ...plan, recommended: recipeIndex === recommendedIndex };
    }
    const minimumCount = Math.ceil(brief.target / Math.max(0.4, sourceDuration));
    const count = Math.min(20, Math.max(recipe.count, minimumCount, lines.length));
    const totalFrames = brief.target * 30;
    const weights = Array.from({ length: count }, (_, index) => lines[index]?.length ?? 0);
    const emptyCount = Math.max(0, count - lines.length);
    const voicedBase = Math.max(15, Math.min(45, Math.floor(((totalFrames - emptyCount * 15) / Math.max(1, lines.length)) * 0.8)));
    const baseFrames = Array.from({ length: count }, (_, index) => lines[index] ? voicedBase : 15);
    const distributable = totalFrames - baseFrames.reduce((sum, frames) => sum + frames, 0);
    const totalWeight = Math.max(1, weights.reduce((sum, weight) => sum + weight, 0));
    const frameBudget = weights.map((weight, index) => baseFrames[index] + Math.floor(distributable * weight / totalWeight));
    let remainder = totalFrames - frameBudget.reduce((sum, frames) => sum + frames, 0);
    for (let index = 0; remainder > 0; index = (index + 1) % count, remainder--) frameBudget[index]++;
    let usedFrames = 0;
    const clips = Array.from({ length: count }, (_, index) => {
      const frames = index === count - 1 ? totalFrames - usedFrames : frameBudget[index];
      usedFrames += frames;
      const outputDuration = frames / 30;
      const anchor = recipe.anchors[index % recipe.anchors.length] * sourceDuration;
      const scene = scenes.reduce((nearest, candidate) => Math.abs((candidate.start + candidate.end) / 2 - anchor) < Math.abs((nearest.start + nearest.end) / 2 - anchor) ? candidate : nearest, scenes[0]);
      const interval = clipWindow(sourceDuration, outputDuration, anchor);
      const copyIndex = index < lines.length ? index : -1;
      return {
        sourceId,
        ...interval,
        speed: 1,
        fit: "cover" as const,
        transition: "cut" as const,
        text: copyIndex >= 0 ? lines[copyIndex] : "",
        reason: recipeIndex === 0 ? "按过程顺序建立理解" : recipeIndex === 1 ? "用更短镜头强化可见亮点" : "先展示成品，再补充过程依据",
        evidence: scene.text,
      };
    });
    return { ...parsePlan({ version: 1, title: brief.locale === "zh" ? recipe.zh : recipe.en, explanation: brief.locale === "zh" ? `${recipe.zh}：围绕已确认文案重组可验证镜头。` : `${recipe.en}: rearranges verified shots around the approved copy.`, clips }, sourceId, sourceDuration, brief), recommended: recipeIndex === recommendedIndex };
  });
}

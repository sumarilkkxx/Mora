import { parsePlan, type Analysis, type EditBrief, type EditPlan, type PromotionCopy } from "./contract";

const STYLE_RECIPES = [
  { key: "story", zh: "过程叙事", en: "Process story", count: 5, anchors: [0.08, 0.28, 0.48, 0.68, 0.9] },
  { key: "highlights", zh: "亮点快剪", en: "Highlight cut", count: 9, anchors: [0.9, 0.12, 0.58, 0.34, 0.76, 0.46, 0.96, 0.22, 0.66] },
  { key: "reveal", zh: "成品先行", en: "Reveal first", count: 5, anchors: [0.62, 0.08, 0.2, 0.45, 0.9] },
] as const;

export function recommendedPlanIndex(strategy: PromotionCopy["strategy"], style: EditBrief["style"]): number {
  return strategy === "scenario" || style === "story" ? 0 : strategy === "explore" || strategy === "process" || style === "highlights" ? 1 : 2;
}

function splitCopy(copy: PromotionCopy) {
  const voiceover = copy.voiceover.split(/[。！？.!?；;]+/).map(value => value.trim()).filter(Boolean);
  if (voiceover.length) return voiceover;
  const body = copy.body.split(/[。！？.!?；;]+/).map(value => value.trim()).filter(Boolean);
  return [copy.hook, ...body, copy.cta].filter(Boolean);
}

function clipWindow(duration: number, wanted: number, anchor: number) {
  const length = Math.min(duration, Math.max(0.4, wanted));
  const start = Math.max(0, Math.min(duration - length, anchor - length / 2));
  return { start, end: start + length };
}

/** Deterministic safety net: preserves approved commercial copy while guaranteeing valid, diverse timelines. */
export function fallbackCandidatePlans(sourceId: string, sourceDuration: number, brief: EditBrief, analysis: Analysis, copy: PromotionCopy): EditPlan[] {
  const lines = splitCopy(copy);
  const scenes = analysis.scenes.length ? analysis.scenes : [{ start: 0, end: sourceDuration, text: analysis.summary, uncertainty: "", evidence: [] }];
  const recommendedIndex = recommendedPlanIndex(copy.strategy, brief.style);
  return STYLE_RECIPES.map((recipe, recipeIndex) => {
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

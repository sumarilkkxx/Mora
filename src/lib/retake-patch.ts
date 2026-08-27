/**
 * Retake patch — single-variable diagnosis-driven resubmission for failed takes.
 *
 * Why: when a generated clip is bad, regenerating with a hand-tweaked prompt
 * usually changes THREE things at once, so nobody learns what fixed it (or the
 * fix regresses something else). The discipline encoded here: diagnose ONE
 * symptom, apply ONE targeted prompt patch, resubmit, compare. The UI states
 * exactly what changed, and only the user pulls the (billed) trigger — this is
 * an explicit new task, never an automatic retry.
 *
 * Patch clauses reuse the project's proven wording (REAL_FACE lineage: state
 * descriptions, no flaw-stacking, no directive negatives beyond what the
 * fidelity constraints already use).
 *
 * Pure functions, no I/O.
 */

export type RetakeSymptom =
  | "face_broken"
  | "skin_waxy"
  | "background_dead"
  | "light_wrong"
  | "blurry"
  | "product_warped";

/** Symptom catalog for the diagnosis picker (bilingual data, rendered by locale). */
export const RETAKE_SYMPTOMS: { id: RetakeSymptom; label: { zh: string; en: string } }[] = [
  { id: "face_broken", label: { zh: "脸崩/五官变形", en: "Broken face" } },
  { id: "skin_waxy", label: { zh: "皮肤蜡感/假脸", en: "Waxy skin" } },
  { id: "background_dead", label: { zh: "背景死板全静止", en: "Dead background" } },
  { id: "light_wrong", label: { zh: "光线不对/影棚感", en: "Wrong lighting" } },
  { id: "blurry", label: { zh: "画面模糊/拖影", en: "Blurry footage" } },
  { id: "product_warped", label: { zh: "商品变形/文字糊", en: "Warped product" } },
];

/**
 * One targeted clause per symptom. Each patch touches exactly ONE dimension of
 * the prompt; blurry additionally slows the camera (motion speed IS the blur
 * variable). Wording follows the field-tested lexicon in motion-prompt/presenters.
 */
const PATCHES: Record<RetakeSymptom, { clause: { zh: string; en: string }; change: { zh: string; en: string } }> = {
  face_broken: {
    clause: {
      zh: "人物五官端正对称、脸部结构稳定不变形，人物细节从简、以中近景呈现",
      en: "the person's features stay well-proportioned and symmetrical, facial structure stable without morphing; keep person details simple, framed at medium-close range",
    },
    change: { zh: "只加了「五官对称/脸部稳定」约束并简化人物细节", en: "added only the face-stability constraint and simplified person details" },
  },
  skin_waxy: {
    clause: {
      zh: "皮肤保留毛孔与自然纹理，哑光不反光，无磨皮无塑料感",
      en: "skin keeps pores and natural texture, matte not shiny, no beauty smoothing, no plastic sheen",
    },
    change: { zh: "只加了「真实肤质保留毛孔」约束", en: "added only the real-skin-texture constraint" },
  },
  background_dead: {
    clause: {
      zh: "背景里有一个元素保持自己的状态在动（窗帘轻晃/杯口冒热气/虚化人影走过）",
      en: "one background element keeps its own motion going (curtains swaying / steam rising / a blurred figure passing)",
    },
    change: { zh: "只加了「背景活起来」一条动态元素", en: "added only one living-background element" },
  },
  light_wrong: {
    clause: {
      zh: "光线：单一自然光源，窗光从侧面来带柔和衰减，画面唯一高光落在主体上，无影棚布光感",
      en: "lighting: one natural source, window light from the side with soft falloff, the frame's single highlight lands on the subject, no studio-lit look",
    },
    change: { zh: "只改了光线（指名光源方向+唯一高光）", en: "changed only the lighting (named source direction + single highlight)" },
  },
  blurry: {
    clause: {
      zh: "运镜放缓：镜头移动缓慢平稳。主体锐度清晰，无拖影无重影",
      en: "slow the camera: movement stays slow and steady. subject razor sharp, no smearing, no ghosting",
    },
    change: { zh: "只把运镜放缓并加锐度约束", en: "only slowed the camera and pinned sharpness" },
  },
  product_warped: {
    clause: {
      zh: "商品外观、包装、logo 与文字保持完全不变，轮廓清晰不扭曲，商品本体不发生形变",
      en: "the product's appearance, packaging, logo and printed text stay exactly unchanged, contours sharp and undistorted, the product itself never deforms",
    },
    change: { zh: "只加强了商品保真约束", en: "only strengthened the product-fidelity constraint" },
  },
};

/** True when the text contains CJK characters (patch-language pick mirrors motion-prompt.ts). */
function hasCjk(s: string): boolean {
  return /[一-鿿぀-ヿ가-힯]/.test(s);
}

export interface RetakePatchResult {
  prompt: string;
  /** Human-readable "this retake changed only X" note */
  change: { zh: string; en: string };
  /** false when the clause was already present (patch is idempotent) */
  applied: boolean;
}

/**
 * Apply one symptom's patch onto the previously submitted prompt. Idempotent:
 * a prompt already carrying the clause comes back unchanged with applied=false
 * (resubmitting the identical prompt won't fix anything — the caller should say so).
 */
export function applyRetakePatch(originalPrompt: string, symptom: RetakeSymptom): RetakePatchResult {
  const lang: "zh" | "en" = originalPrompt && !hasCjk(originalPrompt) ? "en" : "zh";
  const patch = PATCHES[symptom];
  const clause = patch.clause[lang];
  if (originalPrompt.includes(clause)) {
    return { prompt: originalPrompt, change: patch.change, applied: false };
  }
  const sep = lang === "zh" ? "。" : ". ";
  const base = originalPrompt.trim().replace(/[。.]\s*$/, "");
  return { prompt: `${base}${sep}${clause}${lang === "zh" ? "。" : "."}`, change: patch.change, applied: true };
}

/**
 * Named camera-move preset library — the "Click-to-Video" mechanism borrowed from
 * Higgsfield (60+ named camera presets as one-click cards) and LibTV (~100 one-click
 * camera/effect templates), adapted to commerce short-video shots.
 *
 * Why this exists: `Shot.camera` is LLM free text and used to be read-only end-to-end.
 * Free text is exactly what these platforms replaced — curated named moves kill the
 * prompt-guessing problem and give every shot a known-good, conflict-free instruction.
 * The library serves three consumers:
 *  1. Script LLM: `cameraPresetGuide()` injects a per-shot-type vocabulary into the
 *     output-format prompt (the old spec was one vague line — the top quality bottleneck).
 *  2. Assets page UI: a per-shot preset picker writes a preset sentence into `Shot.camera`.
 *  3. Motion prompt: the chosen sentence flows through `buildMotionPrompt` unchanged.
 *
 * Every preset sentence MUST pass `hasCameraConflict` (unit-enforced): a hold+move combo
 * needs an explicit sequencing marker, otherwise Seedance produces jerky indecisive motion.
 *
 * Pure data + pure functions, no I/O. Preset names/prompts are bilingual data, not i18n
 * keys (same convention as BUILTIN_STYLE_PACKS / PRESENTER_PRESETS).
 */
import type { Shot } from "@/lib/db/schema";
import { hasCameraConflict } from "@/lib/motion-prompt";

export type CameraPresetCategory =
  | "push_pull"
  | "orbit"
  | "pan_track"
  | "crane"
  | "handheld"
  | "special";

/** UI group labels for the picker (bilingual data, rendered by locale). */
export const CAMERA_PRESET_CATEGORIES: Record<CameraPresetCategory, { zh: string; en: string }> = {
  push_pull: { zh: "推拉", en: "Push / Pull" },
  orbit: { zh: "环绕", en: "Orbit" },
  pan_track: { zh: "平移跟随", en: "Pan / Track" },
  crane: { zh: "升降俯仰", en: "Crane" },
  handheld: { zh: "手持实感", en: "Handheld" },
  special: { zh: "特殊技法", en: "Special" },
};

export interface CameraPreset {
  id: string;
  /** Display name (picker card label) */
  name: { zh: string; en: string };
  category: CameraPresetCategory;
  /** The exact camera sentence written into `Shot.camera` / the motion prompt */
  prompt: { zh: string; en: string };
  /** Shot types where this move works best — drives LLM guidance + the picker's "recommended" group */
  goodFor: Array<Shot["type"]>;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  // ---- push / pull ----
  {
    id: "crash_push",
    name: { zh: "急速推近", en: "Crash Push-In" },
    category: "push_pull",
    prompt: {
      zh: "镜头急速推近主体，冲击力强，开场抓眼",
      en: "camera crashes in fast on the subject, high impact, attention-grabbing opening",
    },
    goodFor: ["hook"],
  },
  {
    id: "slow_push",
    name: { zh: "缓慢推近", en: "Slow Push-In" },
    category: "push_pull",
    prompt: {
      zh: "镜头缓慢平稳推近主体，逐渐聚焦细节",
      en: "camera pushes in slowly and steadily, gradually focusing on details",
    },
    goodFor: ["pain_point", "demo", "cta"],
  },
  {
    id: "pull_reveal",
    name: { zh: "拉远揭示", en: "Pull-Back Reveal" },
    category: "push_pull",
    prompt: {
      zh: "镜头缓慢拉远，逐渐揭示完整场景与主体全貌",
      en: "camera pulls back slowly, gradually revealing the full scene and subject",
    },
    goodFor: ["social_proof", "cta"],
  },
  {
    id: "dolly_zoom",
    name: { zh: "希区柯克变焦", en: "Dolly Zoom" },
    category: "push_pull",
    prompt: {
      zh: "镜头推近的同时背景被拉远压缩，主体大小保持稳定，空间张力强烈",
      en: "dolly zoom: camera moves in while the background compresses away, subject size stays constant, strong spatial tension",
    },
    goodFor: ["hook"],
  },
  // ---- orbit ----
  {
    id: "orbit_slow",
    name: { zh: "环绕展示", en: "Slow Orbit" },
    category: "orbit",
    prompt: {
      zh: "镜头围绕主体缓慢环绕半圈，高光沿表面流动，立体感强",
      en: "camera orbits the subject in a slow half circle, highlights sweeping across its surface, strong dimensionality",
    },
    goodFor: ["product_reveal"],
  },
  {
    id: "lazy_susan",
    name: { zh: "转台展示", en: "Turntable" },
    category: "orbit",
    prompt: {
      zh: "镜头固定，商品如置于旋转展台上缓缓自转，光影随转动流过表面",
      en: "camera stays locked while the product slowly rotates as if on a turntable, light gliding across its surface",
    },
    goodFor: ["product_reveal"],
  },
  {
    id: "arc_quarter",
    name: { zh: "弧形环移", en: "Arc Move" },
    category: "orbit",
    prompt: {
      zh: "镜头沿弧线绕主体环拍四分之一圈，背景视差自然流动",
      en: "camera arcs a quarter circle around the subject with natural background parallax",
    },
    goodFor: ["product_reveal", "social_proof"],
  },
  // ---- pan / track ----
  {
    id: "lateral_track",
    name: { zh: "横移扫过", en: "Lateral Track" },
    category: "pan_track",
    prompt: {
      zh: "镜头缓慢横移扫过画面，展示场景层次",
      en: "camera tracks laterally across the scene, revealing its layers",
    },
    goodFor: ["social_proof"],
  },
  {
    id: "follow_track",
    name: { zh: "跟随镜头", en: "Follow Track" },
    category: "pan_track",
    prompt: {
      zh: "镜头平稳跟随主体动作移动，保持主体居中",
      en: "camera smoothly follows the subject's movement, keeping it centered",
    },
    goodFor: ["demo", "pain_point"],
  },
  {
    id: "whip_pan",
    name: { zh: "甩镜切换", en: "Whip Pan" },
    category: "pan_track",
    prompt: {
      zh: "镜头快速甩动转向主体，动感强烈，节奏利落",
      en: "camera whips around onto the subject, high-energy, snappy pacing",
    },
    goodFor: ["hook"],
  },
  // ---- crane ----
  {
    id: "crane_up",
    name: { zh: "升镜展开", en: "Crane Up" },
    category: "crane",
    prompt: {
      zh: "镜头从低处缓缓升起并微微俯视主体，场景逐渐展开",
      en: "camera cranes up from low, tilting slightly down on the subject as the scene opens up",
    },
    goodFor: ["social_proof"],
  },
  {
    id: "crane_down_close",
    name: { zh: "降镜聚焦", en: "Crane Down" },
    category: "crane",
    prompt: {
      zh: "镜头从高处缓缓下降贴近主体，收束到特写",
      en: "camera cranes down from above, closing in on the subject into a tight shot",
    },
    goodFor: ["product_reveal"],
  },
  {
    id: "overhead_top",
    name: { zh: "俯拍下降", en: "Top-Down" },
    category: "crane",
    prompt: {
      zh: "镜头垂直俯拍主体，缓慢下降贴近，桌面构图干净",
      en: "top-down overhead shot descending slowly toward the subject, clean tabletop composition",
    },
    goodFor: ["demo"],
  },
  // ---- handheld ----
  {
    id: "handheld_real",
    name: { zh: "手持实拍感", en: "Handheld" },
    category: "handheld",
    prompt: {
      zh: "轻微手持晃动感，呼吸般的自然移动，真实 vlog 质感",
      en: "subtle handheld sway, breathing-like natural movement, authentic vlog feel",
    },
    goodFor: ["pain_point", "social_proof"],
  },
  {
    id: "pov_walk",
    name: { zh: "第一视角", en: "POV Walk" },
    category: "handheld",
    prompt: {
      zh: "第一人称视角向前走近主体，画面自然微晃，沉浸感强",
      en: "first-person POV walking toward the subject, natural slight sway, immersive",
    },
    goodFor: ["hook", "demo"],
  },
  // ---- special ----
  {
    id: "macro_glide",
    name: { zh: "微距滑移", en: "Macro Glide" },
    category: "special",
    prompt: {
      zh: "微距特写沿商品表面缓慢滑移，材质细节纤毫毕现",
      en: "macro close-up gliding slowly along the product surface, material details razor sharp",
    },
    goodFor: ["product_reveal"],
  },
  {
    id: "hero_rise",
    name: { zh: "英雄仰拍", en: "Hero Shot" },
    category: "special",
    prompt: {
      zh: "低角度仰拍主体，镜头缓慢推近，气势感十足",
      en: "low-angle hero shot, camera pushing in slowly, commanding presence",
    },
    goodFor: ["product_reveal", "cta"],
  },
  {
    id: "push_then_hold",
    name: { zh: "推近定住", en: "Push Then Hold" },
    category: "special",
    prompt: {
      zh: "镜头先缓慢推近主体，随后固定住画面稳定收尾",
      en: "camera pushes in slowly at first, then settles into a stable held frame to close",
    },
    goodFor: ["cta"],
  },
  {
    id: "locked_on",
    name: { zh: "锁定跟拍", en: "Locked-On" },
    category: "special",
    prompt: {
      zh: "LOCKED-ON SHOT：镜头如刚性固定在主体上，主体在画面中位置锁定不动，背景随移动流动",
      en: "LOCKED-ON SHOT: camera rigidly mounted to the subject, subject pinned in frame while the background streams past",
    },
    goodFor: ["demo", "product_reveal"],
  },
  {
    id: "fpv_dive",
    name: { zh: "FPV 俯冲", en: "FPV Dive" },
    category: "special",
    prompt: {
      zh: "FPV 无人机视角向主体快速俯冲贴近，路径流畅带速度感",
      en: "FPV drone dive swooping fast toward the subject, fluid path with real speed",
    },
    goodFor: ["hook"],
  },
  {
    id: "body_orbit",
    name: { zh: "贴身环走", en: "Close Orbit Walk" },
    category: "handheld",
    prompt: {
      zh: "手持镜头贴近人物缓慢环走半圈，带自然呼吸晃动，背景视差流动",
      en: "handheld camera walks a slow half-circle close around the person, natural breathing sway, background parallax flowing",
    },
    goodFor: ["social_proof", "pain_point"],
  },
  {
    id: "focus_shift",
    name: { zh: "焦点转移", en: "Rack Focus" },
    category: "special",
    prompt: {
      zh: "镜头位置保持不动，焦点从前景缓缓转移到主体，景深变化引导视线",
      en: "camera holds position while focus racks from foreground to the subject, depth guiding the eye",
    },
    goodFor: ["demo", "pain_point"],
  },
];

/** Lookup by preset id (undefined for unknown ids). */
export function getCameraPreset(id: string): CameraPreset | undefined {
  return CAMERA_PRESETS.find((p) => p.id === id);
}

/** True when the text contains CJK characters (language pick mirrors motion-prompt.ts). */
function hasCjk(s: string): boolean {
  return /[一-鿿぀-ヿ가-힯]/.test(s);
}

/**
 * The preset sentence in the script's language: CJK anywhere in the sample text → Chinese
 * (domestic-first default, empty sample included), otherwise English.
 */
export function cameraPresetPrompt(preset: CameraPreset, sampleText: string): string {
  return !sampleText || hasCjk(sampleText) ? preset.prompt.zh : preset.prompt.en;
}

/**
 * Presets recommended for a shot type (goodFor match), preserving library order.
 * Every shot type is covered (unit-enforced); unknown types return an empty list.
 */
export function recommendedPresets(shotType: string): CameraPreset[] {
  return CAMERA_PRESETS.filter((p) => (p.goodFor as string[]).includes(shotType));
}

/**
 * The preset whose sentence exactly equals the given camera text (zh or en), if any.
 * Lets the UI detect "a preset is currently applied" — the gate for offering a Mix overlay.
 */
export function findPresetByPrompt(cameraText: string | undefined): CameraPreset | undefined {
  const text = cameraText?.trim();
  if (!text) return undefined;
  return CAMERA_PRESETS.find((p) => p.prompt.zh === text || p.prompt.en === text);
}

/**
 * Higgsfield-Mix-style two-move overlay: join two preset sentences into one combined
 * instruction ("A，同时B" / "A, while B"). Returns null when the combination would trip
 * the camera-conflict lint (e.g. a locked-off move over a moving one) — the UI only
 * offers combinations this function accepts. Two moves max by design: once mixed, the
 * text no longer equals any single preset, so the overlay entry point disappears.
 */
export function mixCameraPrompt(a: CameraPreset, b: CameraPreset, sampleText: string): string | null {
  if (a.id === b.id) return null;
  const zh = !sampleText || hasCjk(sampleText);
  const combined = zh ? `${a.prompt.zh}，同时${b.prompt.zh}` : `${a.prompt.en}, while ${b.prompt.en}`;
  return hasCameraConflict(combined) ? null : combined;
}

/** Presets that can overlay onto the given base preset (conflict-lint-safe combinations only). */
export function mixablePresets(base: CameraPreset, sampleText: string): CameraPreset[] {
  return CAMERA_PRESETS.filter((p) => mixCameraPrompt(base, p, sampleText) !== null);
}

/**
 * Shot-type intent labels for the LLM vocabulary block (script-facing, Chinese prompt).
 * framing = shot size + equivalent focal length (the scale at which this beat's key
 * information MUST be readable); mood = the emotional register the move should carry.
 */
const GUIDE_INTENT_LABELS: Array<{ type: Shot["type"]; label: string; framing: string; mood: string }> = [
  { type: "hook", label: "开场钩子", framing: "极致特写~特写（等效85-135mm）", mood: "急切抓人" },
  { type: "pain_point", label: "痛点共鸣", framing: "近景~中景（等效35-50mm）", mood: "代入困扰" },
  { type: "product_reveal", label: "商品展示", framing: "特写~近景（等效85mm）", mood: "惊喜聚焦" },
  { type: "demo", label: "使用演示", framing: "中景切特写（等效50mm）", mood: "专注可信" },
  { type: "social_proof", label: "氛围背书", framing: "全景~中景（等效35mm）", mood: "松弛日常" },
  { type: "cta", label: "收尾转化", framing: "特写定住（等效85mm）", mood: "笃定收束" },
];

/** Max preset examples per shot type in the LLM guide (keeps the prompt block compact). */
const GUIDE_MAX_PER_TYPE = 3;

/**
 * Camera vocabulary block for the script LLM's output-format prompt. Replaces the old
 * one-line vague spec ("中文镜头运动描述") — the single biggest upstream lever on motion
 * quality: the LLM picks from known-good, conflict-free commerce moves instead of
 * improvising, while staying free to fine-tune wording per scene.
 */
export function cameraPresetGuide(): string {
  const lines = GUIDE_INTENT_LABELS.map(({ type, label, framing, mood }) => {
    const examples = recommendedPresets(type)
      .slice(0, GUIDE_MAX_PER_TYPE)
      .map((p) => p.prompt.zh)
      .join(" ｜ ");
    return `  · ${label}（${framing}，情绪${mood}）：${examples}`;
  });
  return [
    "中文镜头运动描述。优先从下列电商运镜词表中挑选最贴合分镜情绪的一条（可按画面微调用词），每镜保持单一明确的运动方向；不要把「固定镜头」与「环绕/推拉」写进同一句，除非用「先…随后…」表达先后顺序：",
    ...lines,
  ].join("\n");
}

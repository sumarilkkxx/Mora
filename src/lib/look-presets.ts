/**
 * Visual "look" presets — the structured lighting/palette panel borrowed from
 * Higgsfield Cinema Studio 3.5 (Style Settings: enumerated Color Palettes + Lighting
 * options instead of free text) and Liblib's relight/composite workflow family
 * (电商打光/重打光/融图 being a top workflow category).
 *
 * Why this exists: the project had NO global visual-style setting — keyframe image
 * prompts relied entirely on whatever style words the script LLM improvised, so shots
 * within one video could drift between looks. A single global look keeps keyframes
 * consistent AND anchors lighting through the i2v pass (i2v models drift lighting when
 * unspecified).
 *
 * Two prompt surfaces per preset:
 *  - `image`: appended to the keyframe generation prompt (rich: light + palette + backdrop).
 *  - `motion`: short lighting anchor for the i2v motion prompt (concise: motion prompts
 *    must stay camera-led; a long style block would dilute the movement instruction).
 *
 * Pure data + pure functions, no I/O. Names/prompts are bilingual data, not i18n keys
 * (same convention as camera-presets.ts / BUILTIN_STYLE_PACKS).
 */

export interface LookPreset {
  id: string;
  /** Display name (picker label) */
  name: { zh: string; en: string };
  /** Appended to the keyframe image-generation prompt */
  image: { zh: string; en: string };
  /** Short lighting anchor appended to the i2v motion prompt */
  motion: { zh: string; en: string };
  /**
   * Preset family: "styled" (default) = art-directed looks; "real" = raw phone-shot looks
   * (the 2026 anti-"AI slop" survey: a camera-identity phrase at the very FRONT of a video
   * prompt biases the model toward handheld-phone distribution far more than mid-prompt
   * quality words — see `opener`).
   */
  group?: "styled" | "real";
  /**
   * Camera-identity opener PREPENDED to the i2v motion prompt (front tokens carry the most
   * weight). Only "real" looks define it; styled looks keep the appended anchor alone.
   */
  opener?: { zh: string; en: string };
}

/** Sentinel meaning "no global look" (the LLM's own per-shot style words stand alone). */
export const LOOK_NONE = "none";

export const LOOK_PRESETS: LookPreset[] = [
  {
    id: "daylight_clean",
    name: { zh: "清透日光", en: "Clean Daylight" },
    image: {
      zh: "明亮自然的窗边日光（约5600K日光白平衡），空气感清透，浅色干净背景，f/4 适中景深",
      en: "bright natural window daylight (~5600K daylight white balance), airy and clean, light minimal backdrop, f/4 moderate depth of field",
    },
    motion: {
      zh: "全程保持明亮清透的自然日光",
      en: "keep bright clean natural daylight throughout",
    },
  },
  {
    id: "warm_life",
    name: { zh: "暖调生活感", en: "Warm Lifestyle" },
    image: {
      zh: "温暖的午后阳光色调（约3000K暖光），橙黄暖光洒落，居家生活氛围，柔和阴影，浅景深 f/2.0",
      en: "warm afternoon sunlight tones (~3000K warm light), golden light spill, cozy home atmosphere, soft shadows, shallow f/2.0 depth of field",
    },
    motion: {
      zh: "全程保持温暖的橙黄午后光调",
      en: "keep the warm golden afternoon light throughout",
    },
  },
  {
    id: "studio_product",
    name: { zh: "影棚质感", en: "Studio Product" },
    image: {
      zh: "专业影棚布光（约5000K主光），主体轮廓光清晰，深色渐变背景，f/8 全清晰景深，商品质感锐利高级",
      en: "professional studio lighting (~5000K key light), crisp rim light on the subject, dark gradient backdrop, f/8 deep focus, sharp premium product texture",
    },
    motion: {
      zh: "全程保持影棚级布光与深色背景",
      en: "keep the studio lighting and dark backdrop throughout",
    },
  },
  {
    id: "night_neon",
    name: { zh: "夜景氛围", en: "Night Neon" },
    image: {
      zh: "夜晚城市霓虹氛围（约3200K暖光与霓虹冷光混合），冷暖光对比，大光圈 f/1.8 浅景深光斑背景，情绪感强",
      en: "night city neon mood (~3200K tungsten mixed with neon), warm-cool light contrast, wide-open f/1.8 shallow bokeh backdrop, strong atmosphere",
    },
    motion: {
      zh: "全程保持夜景霓虹光斑氛围",
      en: "keep the neon night bokeh mood throughout",
    },
  },
  {
    id: "premium_gray",
    name: { zh: "高级灰调", en: "Premium Gray" },
    image: {
      zh: "低饱和高级灰色调（约4500K柔光），柔和漫射光，极简构图，f/5.6 稳定景深，高端克制的质感",
      en: "desaturated premium gray palette (~4500K soft light), diffused lighting, minimalist composition, f/5.6 steady depth, restrained high-end feel",
    },
    motion: {
      zh: "全程保持低饱和灰调与柔和漫射光",
      en: "keep the desaturated gray palette and soft diffused light throughout",
    },
  },
  {
    id: "forest_soft",
    name: { zh: "森系自然", en: "Soft Botanical" },
    image: {
      zh: "自然绿植环境，清晨柔光带薄雾感（约5000K），f/2.8 浅景深，清新治愈的色调",
      en: "natural greenery setting, soft misty morning light (~5000K), f/2.8 shallow depth, fresh soothing palette",
    },
    motion: {
      zh: "全程保持清晨柔光与清新绿调",
      en: "keep the soft morning light and fresh green palette throughout",
    },
  },
  {
    id: "food_appetizing",
    name: { zh: "食欲暖光", en: "Appetizing Warm" },
    image: {
      zh: "暖色食欲光（约3500K），食物色泽饱满诱人，f/2.8 浅景深背景虚化，细节油亮",
      en: "warm appetizing light (~3500K), rich saturated food colors, f/2.8 shallow depth of field, glossy details",
    },
    motion: {
      zh: "全程保持暖色食欲光与饱满色泽",
      en: "keep the warm appetizing light and rich colors throughout",
    },
  },
  {
    id: "tech_cool",
    name: { zh: "科技冷调", en: "Tech Cool" },
    image: {
      zh: "冷色调科技感光效（约7000K冷调），蓝紫色轮廓光，深色简洁背景，f/5.6 稳定景深，未来感",
      en: "cool-toned tech lighting (~7000K cool tone), blue-violet rim light, dark clean backdrop, f/5.6 steady depth, futuristic feel",
    },
    motion: {
      zh: "全程保持冷调科技光效",
      en: "keep the cool tech lighting throughout",
    },
  },
  // ---- "real" family (2026-08): raw phone-shot looks for the UGC don't-look-AI path.
  // All wording stays positive ("what the image IS") — visual negatives are placebos on
  // Seedance, and flaw-stacking is banned by the two-round real-face A/B lesson.
  {
    id: "phone_raw",
    name: { zh: "手机直出", en: "Phone Raw" },
    group: "real",
    opener: {
      zh: "UGC 创作者手机手持实拍",
      en: "UGC creator, handheld phone footage",
    },
    image: {
      zh: "真实手机直出画质，色彩自然未调色，混合色温带轻微白平衡漂移，轻度压缩感，生活化取景略偏离居中构图",
      en: "raw ungraded phone-camera look, natural colors with mixed color temperature and a slight white-balance drift, mild compression feel, casual slightly off-center framing",
    },
    motion: {
      zh: "全程保持未调色的自然色彩与混合色温",
      en: "keep the ungraded natural colors and mixed color temperature throughout",
    },
  },
  {
    id: "selfie_front",
    name: { zh: "前置自拍", en: "Front-cam Selfie" },
    group: "real",
    opener: {
      zh: "手机前置摄像头手持自拍，握持手机的手臂入画",
      en: "Handheld arm's-length selfie on the phone front camera, the holding arm visible in frame",
    },
    image: {
      zh: "前置手机镜头自拍视角，26mm 等效广角带近距边缘畸变，握持手机的手臂入画，机位略低于视线，日常生活背景",
      en: "front phone-camera selfie view, 26mm-equivalent wide angle with close-range edge distortion, the holding arm visible in frame, camera slightly below eye level, everyday background",
    },
    motion: {
      zh: "全程保持前置镜头的广角透视与自然室内光",
      en: "keep the front-camera wide-angle perspective and natural indoor light throughout",
    },
  },
  {
    id: "propped_static",
    name: { zh: "搁置机位", en: "Propped Static" },
    group: "real",
    opener: {
      zh: "手机搁在台面上固定拍摄，画面带极轻微的台面震动",
      en: "Vertical phone video propped on a counter, static with small surface vibrations",
    },
    image: {
      zh: "手机搁在台面上拍摄的固定视角，高度贴近台面略微仰视，生活痕迹背景，自然室内光",
      en: "fixed viewpoint of a phone propped on a counter, slightly low and tilted up, lived-in background, natural indoor light",
    },
    motion: {
      zh: "全程保持固定的搁置视角与自然室内光",
      en: "keep the fixed propped viewpoint and natural indoor light throughout",
    },
  },
  {
    id: "dashcam_ride",
    name: { zh: "行车记录仪", en: "Dashcam" },
    group: "real",
    opener: {
      zh: "行车记录仪广角固定机位实拍画面",
      en: "Dashcam footage from a fixed wide-angle mount",
    },
    image: {
      zh: "行车记录仪画质：超广角带边缘畸变，曝光随环境光自动跳变，色彩偏淡对比偏硬，画面边缘轻微拖影",
      en: "dashcam quality: ultra-wide with edge distortion, exposure auto-jumping with ambient light, washed colors with hard contrast, slight smearing at the frame edges",
    },
    motion: {
      zh: "全程保持行车记录仪的广角畸变与自动曝光跳变质感",
      en: "keep the dashcam wide-angle distortion and auto-exposure jumps throughout",
    },
  },
  {
    id: "old_dv",
    name: { zh: "老 DV 录像", en: "Old DV Tape" },
    group: "real",
    opener: {
      zh: "老式家用 DV 拍摄的录像画面",
      en: "Home video footage shot on an old consumer DV camcorder",
    },
    image: {
      zh: "老 DV 录像质感：暖黄偏色，轻微扫描线与颗粒噪点，对焦偶尔犹豫呼吸，高光轻微溢出，画面边角有角标质感但不出现可读文字",
      en: "old DV tape look: warm yellow color cast, faint scanlines and grain, focus occasionally hunting, highlights slightly blooming, corner overlay texture without any readable text",
    },
    motion: {
      zh: "全程保持老 DV 的暖黄偏色、颗粒噪点与对焦呼吸感",
      en: "keep the DV warm cast, grain and focus breathing throughout",
    },
  },
  {
    id: "cctv_store",
    name: { zh: "店内监控", en: "Store CCTV" },
    group: "real",
    opener: {
      zh: "店内监控摄像头高角度固定俯拍画面",
      en: "Store CCTV footage from a fixed high-angle ceiling camera",
    },
    image: {
      zh: "监控画质：高角度俯拍，青冷色调，低码率压缩噪点，画面四角轻微暗角，人物不摆拍、按自然状态活动",
      en: "CCTV quality: high-angle top-down view, cold teal cast, low-bitrate compression noise, mild corner vignetting, people mid-activity, moving naturally through the frame",
    },
    motion: {
      zh: "全程保持监控俯拍固定视角与青冷低码率质感",
      en: "keep the fixed CCTV high angle and cold low-bitrate texture throughout",
    },
  },
];

/** Lookup by preset id; "none"/unknown → undefined (no look applied). */
export function getLookPreset(id: string | undefined): LookPreset | undefined {
  if (!id || id === LOOK_NONE) return undefined;
  return LOOK_PRESETS.find((p) => p.id === id);
}

/** True when the text contains CJK characters (language pick mirrors motion-prompt.ts). */
function hasCjk(s: string): boolean {
  return /[一-鿿぀-ヿ가-힯]/.test(s);
}

/**
 * The image-prompt suffix for a look in the language of the surrounding prompt
 * (CJK → Chinese; empty sample defaults to Chinese, domestic-first). Undefined when
 * no look is selected.
 */
export function lookImageSuffix(id: string | undefined, sampleText: string): string | undefined {
  const preset = getLookPreset(id);
  if (!preset) return undefined;
  return !sampleText || hasCjk(sampleText) ? preset.image.zh : preset.image.en;
}

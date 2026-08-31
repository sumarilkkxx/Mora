/**
 * Motion-prompt engine for image-to-video (i2v) generation — the quality lever of the i2v main path.
 *
 * Why this exists: the script engine already writes a per-shot `camera` movement description
 * (推拉摇移 language), but the i2v call used to send the shot's STATIC image prompt instead —
 * scene wording with zero motion language, which yields bland or unpredictable movement.
 * i2v models (Seedance 2.0 family) take composition/subject from the first frame; the text
 * prompt's job is to direct MOTION: camera path + subject micro-action + stability constraints.
 *
 * Rules encoded here (commerce-specific):
 *  - Camera: prefer the script's own `camera` field; fall back to a per-shot-type default move.
 *  - Subject micro-action per shot type: bring the frame alive WITHOUT re-imagining the scene.
 *  - Product shots get hard fidelity constraints (i2v models notoriously warp printed text/logos).
 *  - Always close with stability/artifact constraints — cheap wins against flicker & morphing.
 *  - Bilingual: follows the script language (CJK → Chinese prompt, otherwise English), because
 *    overseas projects generate English scripts and mixing languages degrades model adherence.
 *
 * Pure functions, unit-testable, no I/O.
 */
import type { Shot } from "@/lib/db/schema";
import { REAL_FACE_CONSTRAINT } from "@/lib/presenters";
import { emotionActingLine, shotEmotion } from "@/lib/emotion-acting";
import type { ProductCategory } from "@/lib/script-engine/templates";

/** Camera-movement amplitude tier (Kling-style enumerated intensity instead of free text). */
export type MotionIntensity = "subtle" | "normal" | "strong";

export interface MotionPromptInput {
  /** Shot type drives the default camera move + subject micro-action */
  shotType?: Shot["type"] | string;
  /** The script engine's camera movement description (e.g. "特写 + 缓慢推近"); preferred over defaults */
  camera?: string;
  /** Short scene description used as a semantic anchor (truncated; the first frame already fixes the scene) */
  description?: string;
  /** Apply product-fidelity constraints (product visible in frame — logo/text must not warp) */
  productShot?: boolean;
  /**
   * Keyframe-chained generation (the Dreamina-style first/last-frame pattern): the clip's last
   * frame is pinned to the NEXT shot's keyframe, so the shot ends by flowing into the next scene —
   * the transition is generated inside the clip and the composer's hard concat becomes seamless.
   */
  chainToNext?: boolean;
  /** Camera amplitude tier; "normal" (default) keeps the baseline wording unchanged */
  intensity?: MotionIntensity;
  /**
   * A cast character is on camera in this shot: append the anti-"AI face" realism
   * constraint so the model renders an ordinary person, not a polished influencer face.
   */
  personShot?: boolean;
  /**
   * The on-camera character is SPEAKING this shot (has a voiceover line): replace the
   * generic micro-action with talking direction (mouth movement, blinks, one micro-pause)
   * plus two behavior beats. Beats rotate per shot via `beatSeed` — repeating the same
   * gestures across a batch is the biggest AI tell.
   */
  talking?: boolean;
  /** Deterministic seed (e.g. shot index) picking which two behavior beats this shot gets */
  beatSeed?: number;
  /**
   * Global visual-look lighting anchor (see look-presets.ts): a SHORT bilingual line that
   * pins the lighting/palette through the i2v pass — i2v models drift lighting when
   * unspecified, which breaks look consistency across chained shots.
   */
  look?: { zh: string; en: string };
  /**
   * Camera-identity opener from a "real"-family look preset — PREPENDED as the prompt's
   * first phrase (front tokens weigh most: "UGC creator, handheld phone footage" up front
   * biases the whole generation toward the phone-shot distribution).
   */
  opener?: { zh: string; en: string };
  /**
   * Project product category (free string from the DB; unknown values are ignored).
   * Unlocks the category physical-realism layers:
   *  - category fidelity constraint (productShot): what "intact" means for THIS material
   *  - physical-interaction phrase (demo/product_reveal): action + material reaction
   *  - both rotate deterministically via beatSeed against batch-level sameness
   */
  category?: string;
  /**
   * Physical-realism layer tier (user-selectable, single choice):
   *  - "auto" (default): all layers — category constraint + interaction phrase +
   *    living background + hair/fabric inertia + emotion process
   *  - "constraints": category fidelity constraint only (no added motion phrases)
   *  - "off": none of the realism layers (legacy prompt shape)
   * Defaults to "auto" so every hands-off chain gets the quality layers without wiring.
   */
  realism?: MotionRealismTier;
}

/** Realism-layer tier for buildMotionPrompt (a user-facing single-select). */
export type MotionRealismTier = "auto" | "constraints" | "off";

/** True when the text contains CJK characters (used to pick the prompt language). */
function hasCjk(s: string): boolean {
  return /[一-鿿぀-ヿ가-힯]/.test(s);
}

/** Per-shot-type default camera move — used only when the script didn't provide one. */
const CAMERA_DEFAULTS: Record<string, { zh: string; en: string }> = {
  hook: { zh: "镜头快速推近主体，开场抓眼", en: "camera pushes in fast on the subject, punchy opening" },
  pain_point: { zh: "镜头缓慢推近，带轻微手持感", en: "slow push-in with a subtle handheld feel" },
  product_reveal: { zh: "镜头围绕商品缓慢环绕移动，高光沿商品表面流动", en: "camera orbits the product slowly, highlights sweeping across its surface" },
  demo: { zh: "镜头平稳跟随演示动作，适时贴近特写细节", en: "camera smoothly follows the demonstration, moving in for close-up details" },
  social_proof: { zh: "镜头缓慢横移扫过画面", en: "slow lateral tracking shot across the scene" },
  cta: { zh: "镜头缓慢推近，聚焦主体", en: "slow push-in, focusing on the subject" },
};

const CAMERA_FALLBACK = { zh: "镜头缓慢推近主体", en: "slow push-in on the subject" };

/** Per-shot-type subject micro-action — animates the still frame without re-imagining the scene. */
const ACTION_DEFAULTS: Record<string, { zh: string; en: string }> = {
  hook: { zh: "画面主体动态醒目、能量感强", en: "the subject moves eye-catchingly with high energy" },
  pain_point: { zh: "人物与环境自然轻微动作，情绪真实", en: "people and surroundings move subtly and naturally, authentic mood" },
  product_reveal: { zh: "商品保持静置不动，仅光影流动与镜头移动，突出材质质感", en: "the product itself stays still; only light and camera move, emphasizing material texture" },
  demo: { zh: "手部演示动作自然连贯", en: "hands demonstrate naturally and continuously" },
  social_proof: { zh: "画面元素自然微动，生活气息真实", en: "scene elements drift subtly, believable everyday atmosphere" },
  cta: { zh: "主体稳定醒目，画面收束聚焦", en: "the subject stays prominent and stable as the frame settles" },
};

const ACTION_FALLBACK = { zh: "画面自然生动，主体动作连贯", en: "the scene comes alive naturally with coherent subject motion" };

/**
 * Talking-shot subject direction — replaces the per-type micro-action when the character
 * speaks. Written as visible speech behavior (mouth movement, blinks, one beat of hesitation),
 * NOT lip-sync to specific words: the voice track is TTS overlaid by the composer, so the clip
 * only needs to read as "a person mid-conversation".
 */
const TALKING_ACTION = {
  zh: "人物对着镜头自然说话：口型自然开合，自然眨眼与头部微动，说到一半有一次极短的停顿、一次视线短暂离开镜头再回来",
  en: "the person talks naturally to camera: natural mouth movement, blinks and small head motions, one brief mid-sentence pause, eyes drift away once and return",
};

/**
 * Behavior-beat pool for talking shots. Each shot gets two, rotated by beatSeed —
 * identical gestures repeated across a batch read as AI immediately.
 */
const BEHAVIOR_BEATS: { zh: string; en: string }[] = [
  { zh: "说话间瞥了一眼旁边", en: "glances off to the side mid-sentence" },
  { zh: "身体往后靠了一下又坐直", en: "leans back briefly, then settles forward again" },
  { zh: "轻轻耸了下肩", en: "gives a small shrug" },
  { zh: "换了一只手拿东西", en: "switches the object to the other hand" },
  { zh: "被画外的动静吸引看了一眼", en: "gets briefly distracted by something off-screen" },
  { zh: "说完自己先半笑了一下", en: "breaks into a half-smile at their own words" },
];

/** Pick two distinct behavior beats deterministically from the seed (adjacent picks avoid repeats). */
export function pickBehaviorBeats(seed: number, lang: "zh" | "en"): string[] {
  const n = BEHAVIOR_BEATS.length;
  const i = ((Math.floor(seed) % n) + n) % n;
  const j = (i + 1 + (((Math.floor(seed / n) % (n - 1)) + (n - 1)) % (n - 1))) % n;
  return [BEHAVIOR_BEATS[i][lang], BEHAVIOR_BEATS[j][lang]];
}

/** Product-fidelity constraint (printed text & logos are the first thing i2v models destroy). */
const PRODUCT_CONSTRAINT = {
  zh: "商品的外观、包装、颜色、logo 与文字必须保持完全不变，文字清晰不扭曲变形",
  en: "the product's appearance, packaging, colors, logo and printed text must remain exactly unchanged, text stays sharp and undistorted",
};

/**
 * Category-specific fidelity constraints — what "intact" physically means for THIS
 * material class. The generic PRODUCT_CONSTRAINT protects print/logo; these protect the
 * failure mode each category actually exhibits (cream clumping, food crumbling, fabric
 * stiffening, glare on metal). Positive-phrased state descriptions, not negative lists.
 */
const CATEGORY_CONSTRAINTS: Record<ProductCategory, { zh: string; en: string }> = {
  beauty: {
    zh: "膏体与液体质地均匀顺滑，涂抹推开自然服帖不结块",
    en: "cream and liquid textures stay smooth and even, spreading naturally without clumping",
  },
  food: {
    zh: "食物色泽鲜亮自然、纹理清晰，形态完整不塌不散",
    en: "food keeps vivid natural color and clear texture, holding its shape without collapsing or crumbling",
  },
  home: {
    zh: "部件开合顺畅到位，接缝与结构稳定不错位",
    en: "parts open and close smoothly and precisely, seams and structure stay aligned and stable",
  },
  fashion: {
    zh: "面料垂坠自然、褶皱柔软真实，版型放松不僵硬",
    en: "fabric drapes naturally with soft believable creases, the fit stays relaxed, never stiff",
  },
  tech: {
    zh: "金属与屏幕反光干净克制，接缝对齐，屏幕内容清晰稳定",
    en: "metal and screen reflections stay clean and restrained, seams aligned, on-screen content sharp and stable",
  },
};

/**
 * Physical-interaction phrase pool: "action + material reaction" pairs per category.
 * A demo shot that shows the material RESPONDING (spring-back, crumbs, ripple, glide)
 * reads as real footage; an action with no material feedback reads as CG. Rotated by
 * beatSeed — identical interactions across a batch are an instant AI tell.
 */
const PHYSICAL_ACTION_LEXICON: Record<ProductCategory, { zh: string; en: string }[]> = {
  beauty: [
    { zh: "指腹蘸取膏体缓缓推开，质地在皮肤上自然延展服帖", en: "a fingertip spreads the cream slowly, the texture gliding open and settling onto the skin" },
    { zh: "按压泵头挤出一滴，液体落在手背缓缓铺开", en: "one pump releases a drop that lands and spreads slowly on the back of the hand" },
    { zh: "拧开瓶盖，膏体表面平整光洁泛着柔光", en: "the cap twists off to reveal a smooth untouched surface with a soft sheen" },
  ],
  food: [
    { zh: "掰开的瞬间外层酥脆掉渣，断面组织分明", en: "it snaps open with crisp flakes falling, the cross-section clearly layered" },
    { zh: "热气从表面缓缓升起，酱汁沿边缘慢慢流下", en: "steam rises gently from the surface while sauce runs slowly down the edge" },
    { zh: "夹起时微微颤动，质地饱满有弹性", en: "it quivers slightly when lifted, plump and springy" },
  ],
  home: [
    { zh: "开合部件顺滑归位，动作干净利落", en: "the moving part glides shut cleanly and precisely" },
    { zh: "手掌按压表面，材质轻微回弹恢复原状", en: "a palm presses the surface, which flexes slightly and springs back" },
    { zh: "水流冲过表面，水珠顺着材质纹理滑落", en: "water runs over the surface, beading and sliding along the texture" },
  ],
  fashion: [
    { zh: "转身时衣摆自然摆动后垂落回位", en: "the hem swings out on the turn, then settles back naturally" },
    { zh: "手指捏起面料轻轻一放，褶皱缓缓回弹展开", en: "fingers pinch and release the fabric, the crease easing back open slowly" },
    { zh: "行走时面料随步伐轻微起伏", en: "the fabric ripples subtly with each step" },
  ],
  tech: [
    { zh: "手指滑过屏幕，界面跟手流畅响应", en: "a finger swipes across the screen, the interface responding fluidly" },
    { zh: "耳机放入充电仓，磁吸轻轻归位", en: "the earbud drops into the case, snapping gently into place magnetically" },
    { zh: "转动机身，金属边框上一道高光缓缓扫过", en: "the device rotates as a single highlight sweeps along the metal edge" },
  ],
};

/** Shot types that demonstrate the product physically (get a physical-interaction phrase). */
const PHYSICAL_ACTION_TYPES = new Set(["demo", "product_reveal"]);

/**
 * Living-background pool: ONE named background element with its own ongoing state.
 * AI clips die behind the subject — a frozen backdrop reads as a rendered set. One
 * element is enough; more turns the background busy and steals focus.
 */
const LIVING_BG: { zh: string; en: string }[] = [
  { zh: "背景里窗帘随气流轻轻晃动", en: "curtains in the background sway gently in the airflow" },
  { zh: "背景虚化处有人自然走过，不抢主体", en: "someone drifts through the blurred background without pulling focus" },
  { zh: "背景一盏灯的光斑有细微的明暗呼吸", en: "a lamp's glow in the background breathes subtly brighter and dimmer" },
  { zh: "桌上一杯热饮冒着若有若无的热气", en: "a hot drink nearby gives off a faint wisp of steam" },
  { zh: "窗外光线随云层缓慢变化", en: "the light from the window shifts slowly as clouds pass" },
  { zh: "背景绿植的叶片偶尔轻颤", en: "leaves of a background plant tremble now and then" },
];

/** Hair/fabric inertia — secondary motion lag is the cheapest "real physics" signal on a person. */
const FABRIC_HAIR_LAG = {
  zh: "人物移动或转头时，头发与衣料带一点滞后的摆动再自然落回",
  en: "when the person moves or turns, hair and fabric lag slightly then settle back naturally",
};

/** Deterministic pool pick shared by the category/background layers (same contract as pickBehaviorBeats). */
function pickFrom<T>(pool: T[], seed: number): T {
  const n = pool.length;
  return pool[((Math.floor(seed) % n) + n) % n];
}

/** Normalize the free-form DB category string to a known category (undefined otherwise). */
function normalizeCategory(category: string | undefined): ProductCategory | undefined {
  return category && category in CATEGORY_CONSTRAINTS ? (category as ProductCategory) : undefined;
}

/** Universal stability/artifact tail — cheap, consistent win against flicker and morphing. */
const QUALITY_TAIL = {
  zh: "画面稳定流畅，光影自然过渡，无闪烁、无变形、不出现新物体",
  en: "stable smooth footage, natural lighting transitions, no flicker, no morphing, no new objects appearing",
};

/** Chained-clip guidance: direct the in-clip transition toward the pinned last frame. */
const CHAIN_GUIDANCE = {
  zh: "镜头在结尾自然运镜过渡到指定的尾帧画面，过渡连贯流畅、一气呵成，不跳切",
  en: "the camera moves naturally into the specified last frame at the end, one continuous fluent transition, no jump cut",
};

/**
 * Continuous-single-take declaration (Seedance official guidance: without it the model may cut
 * mid-clip, which breaks per-shot semantics — each of our clips must be exactly one take).
 * Mutually exclusive with CHAIN_GUIDANCE: a chained clip ends by transitioning INTO the next
 * scene, so "no scene changes" would contradict the chain instruction.
 */
const SINGLE_SHOT = {
  zh: "整段为连续单镜头拍摄，中途不切镜、不转场",
  en: "one continuous single take throughout, no cuts, no scene changes",
};

/**
 * Sound direction for audio-capable models (Seedance 2.0 generates audio; unspecified audio tends
 * toward random speech). Speech always comes from our TTS voice-over — clip audio must stay
 * ambient-only, since the composer surfaces native audio on shots WITHOUT a voice-over track.
 */
const SOUND_DIRECTION = {
  zh: "音效：自然环境音与动作音效贴合画面，无人声说话，环境底噪保持同一空间的延续感",
  en: "sound: natural ambient and action sound effects matching the scene, no speech, the ambient noise floor stays continuous as one space",
};

/** Camera amplitude wording per intensity tier ("normal" keeps the baseline prompt unchanged). */
const INTENSITY_LINES: Record<Exclude<MotionIntensity, "normal">, { zh: string; en: string }> = {
  subtle: { zh: "运镜幅度轻微克制，移动缓慢平稳", en: "camera movement stays subtle and restrained, slow and steady" },
  strong: { zh: "运镜幅度大胆明显，节奏利落有冲击力", en: "bold pronounced camera movement, brisk impactful pacing" },
};

/** Camera-hold keywords (a locked-off camera instruction). */
const STATIC_CAMERA_RE = /固定|静止|锁定|不动|fixed|static|locked/i;
/** Continuous camera-movement keywords. */
const MOVING_CAMERA_RE =
  /环绕|环拍|推近|推进|拉远|拉近|横移|平移|摇镜|摇臂|甩镜|跟随|跟拍|升降|俯冲|orbit|push[- ]?in|pull[- ]?back|dolly|pan|tilt|track|crane|zoom|whip/i;
/** Sequencing markers that legitimise combining hold + move (e.g. "推近后固定" = push in, then hold). */
const SEQUENCE_RE = /先|后|然后|随后|接着|再|最后|结尾|开场|开头|then|after|before|finally|ending|start/i;

/**
 * Conflict lint for scripted camera text (Seedance docs: contradictory instructions like
 * "固定镜头" + "环绕" in one prompt produce jerky, indecisive motion). A hold + move combo is a
 * conflict ONLY without a sequencing marker — "push in then hold" is valid direction.
 */
export function hasCameraConflict(camera: string): boolean {
  return STATIC_CAMERA_RE.test(camera) && MOVING_CAMERA_RE.test(camera) && !SEQUENCE_RE.test(camera);
}

/** Max chars of the scene description kept as a semantic anchor (the first frame already fixes composition). */
const DESC_ANCHOR_MAX = 60;

/**
 * Build the i2v motion prompt for a shot. The camera line leads (motion is the message),
 * followed by subject action, an optional short scene anchor, fidelity constraints for product
 * shots, and the stability tail. Language follows the script (camera/description text).
 */
export function buildMotionPrompt(input: MotionPromptInput): string {
  const probe = `${input.camera ?? ""}${input.description ?? ""}`;
  // Empty inputs default to Chinese (domestic-first product)
  const lang: "zh" | "en" = probe && !hasCjk(probe) ? "en" : "zh";
  const type = String(input.shotType ?? "");

  // Conflict lint: a self-contradictory scripted camera (hold + move, no sequencing) would yield
  // jerky indecisive motion — fall back to the shot type's single known-good instruction instead
  const scripted = input.camera?.trim();
  const camera =
    scripted && !hasCameraConflict(scripted) ? scripted : (CAMERA_DEFAULTS[type] ?? CAMERA_FALLBACK)[lang];
  const seed = input.beatSeed ?? 0;
  const realism: MotionRealismTier = input.realism ?? "auto";
  const category = realism === "off" ? undefined : normalizeCategory(input.category);
  // motion-phrase layers (interaction/background/inertia/emotion) only at the full tier
  const fullRealism = realism === "auto";
  // a speaking character overrides the per-type micro-action: the shot must read as
  // "mid-conversation", with two rotating behavior beats against batch-level repetition
  let action = input.talking
    ? `${TALKING_ACTION[lang]}${lang === "zh" ? "；" : "; "}${pickBehaviorBeats(seed, lang).join(lang === "zh" ? "、" : ", ")}`
    : (ACTION_DEFAULTS[type] ?? ACTION_FALLBACK)[lang];
  // demonstration shots with a known category get one "action + material reaction" phrase:
  // material feedback (spring-back, crumbs, ripple) is what separates footage from CG
  if (fullRealism && category && PHYSICAL_ACTION_TYPES.has(type)) {
    action += `${lang === "zh" ? "；" : "; "}${pickFrom(PHYSICAL_ACTION_LEXICON[category], seed)[lang]}`;
  }
  // non-talking person shots get one emotion process phrase (trigger → body-first →
  // restrained face); talking shots already carry their own behavior direction
  const emotion = fullRealism && !input.talking && input.personShot ? shotEmotion(type) : undefined;
  const anchor = (input.description ?? "").trim().slice(0, DESC_ANCHOR_MAX);
  const intensity = input.intensity && input.intensity !== "normal" ? INTENSITY_LINES[input.intensity][lang] : undefined;
  // one living-background element for shots where a frozen backdrop would betray the render
  const livingBg = fullRealism && (input.personShot || type === "demo") ? pickFrom(LIVING_BG, seed)[lang] : undefined;
  const fabricLag = fullRealism && input.personShot;

  const parts: string[] = [];
  if (lang === "zh") {
    if (input.opener) parts.push(input.opener.zh);
    parts.push(`运镜：${camera}`);
    if (intensity) parts.push(intensity);
    parts.push(`画面动态：${action}`);
    if (emotion) parts.push(emotionActingLine(emotion, seed, "zh"));
    if (livingBg) parts.push(livingBg);
    if (fabricLag) parts.push(FABRIC_HAIR_LAG.zh);
    if (anchor) parts.push(`场景：${anchor}`);
    if (input.look) parts.push(`光线：${input.look.zh}`);
    // chained clip: CHAIN_GUIDANCE already demands one continuous move; SINGLE_SHOT's
    // "no scene changes" would contradict the transition into the next keyframe
    parts.push(input.chainToNext ? CHAIN_GUIDANCE.zh : SINGLE_SHOT.zh);
    if (input.personShot) parts.push(REAL_FACE_CONSTRAINT.zh);
    if (input.productShot) parts.push(PRODUCT_CONSTRAINT.zh);
    if (input.productShot && category) parts.push(CATEGORY_CONSTRAINTS[category].zh);
    parts.push(SOUND_DIRECTION.zh);
    parts.push(QUALITY_TAIL.zh);
    return parts.join("。") + "。";
  }
  if (input.opener) parts.push(input.opener.en);
  parts.push(`Camera: ${camera}`);
  if (intensity) parts.push(intensity);
  parts.push(`Motion: ${action}`);
  if (emotion) parts.push(emotionActingLine(emotion, seed, "en"));
  if (livingBg) parts.push(livingBg);
  if (fabricLag) parts.push(FABRIC_HAIR_LAG.en);
  if (anchor) parts.push(`Scene: ${anchor}`);
  if (input.look) parts.push(`Lighting: ${input.look.en}`);
  parts.push(input.chainToNext ? CHAIN_GUIDANCE.en : SINGLE_SHOT.en);
  if (input.personShot) parts.push(REAL_FACE_CONSTRAINT.en);
  if (input.productShot) parts.push(PRODUCT_CONSTRAINT.en);
  if (input.productShot && category) parts.push(CATEGORY_CONSTRAINTS[category].en);
  parts.push(SOUND_DIRECTION.en);
  parts.push(QUALITY_TAIL.en);
  return parts.join(". ") + ".";
}

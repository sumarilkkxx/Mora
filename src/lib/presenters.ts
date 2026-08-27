/**
 * Built-in presenter presets + the anti-"AI face" realism constraint.
 *
 * Why this exists: video models default to an over-polished "influencer face"
 * (flawless skin, symmetric features, studio light) that instantly reads as AI
 * and cheapens the whole video. Real UGC commerce videos are fronted by ordinary
 * people shot on phones. Verified on real Seedance 2.0 A/B calls, and calibrated
 * twice: listing blemishes (freckles/acne/eye bags) over-corrects into unappealing
 * faces — the sweet spot is "pleasant ordinary": approachable well-proportioned
 * features + real un-retouched skin + phone-grade footage, explicitly banning both
 * the influencer face AND deliberate uglification.
 *
 * Two exports do the work:
 *  - REAL_FACE_CONSTRAINT: appended to any generation prompt that puts a person
 *    on camera (script character shots, i2v motion prompts).
 *  - PRESENTER_PRESETS: ready-made ordinary-person casts the LLM can pick from
 *    (or riff on) when a script style needs an on-camera presenter, so every
 *    generated cast starts from believable, non-influencer looks.
 *
 * Pure data + pure functions, no I/O.
 */

/** Realism constraint against the default "AI influencer face" (zh/en). */
export const REAL_FACE_CONSTRAINT = {
  zh: "人物是清爽耐看的普通人长相：五官端正有亲和力，看着舒服讨喜，日常淡妆，发丝自然，皮肤有自然真实质感不磨皮——不是精修网红脸，也绝不刻意丑化；画质像手机随手拍带轻微噪点，自然光，不打影棚光、无广告片精致感",
  en: "the person is a pleasant, ordinary-looking real human: well-proportioned approachable features that are easy on the eyes, everyday light makeup, natural hair, real un-retouched skin texture — not a polished influencer AI face, and never deliberately unattractive either; footage looks like a casual phone shot with slight noise and natural light, never studio-lit, no ad-grade polish",
} as const;

/** True when the text contains CJK characters (language pick for the constraint line). */
function hasCjk(s: string): boolean {
  return /[一-鿿぀-ヿ가-힯]/.test(s);
}

/** Returns the realism constraint in the language matching the surrounding prompt text. */
export function realFaceLine(surroundingText: string): string {
  return surroundingText && !hasCjk(surroundingText) ? REAL_FACE_CONSTRAINT.en : REAL_FACE_CONSTRAINT.zh;
}

export interface PresenterPreset {
  id: string;
  /** Display name (persona nickname, not a real person) */
  name: string;
  gender: "female" | "male";
  /** One-line persona for scripts */
  persona: string;
  /** Appearance anchor written with deliberate ordinary-person features */
  appearance: string;
  /** Product categories this presenter type sells well */
  goodFor: string;
}

/**
 * Six ordinary-person presenter archetypes, deliberately diverse in age, build
 * and styling so multi-video batches don't converge on one face. Every
 * appearance string bakes in anti-AI-face features.
 */
export const PRESENTER_PRESETS: PresenterPreset[] = [
  {
    id: "neighbor_sister",
    name: "邻家姐姐",
    gender: "female",
    persona: "实在爱吐槽，先挑刺后真香",
    appearance: "32 岁左右居家女性，清爽耐看有亲和力，松散低马尾带自然碎发，日常淡妆，皮肤自然真实，穿浅色宽松居家服，左手腕上套着一根用旧的发圈",
    goodFor: "家居日用 / 食品",
  },
  {
    id: "office_lady",
    name: "通勤上班族",
    gender: "female",
    persona: "理性种草，讲成分讲证据",
    appearance: "35 岁左右上班族女性，耐看有气质，齐肩发自然垂落，日常淡妆，皮肤自然真实不磨皮，穿简洁衬衫，右侧袖口随手挽起一截",
    goodFor: "美妆护肤 / 数码 3C",
  },
  {
    id: "student_girl",
    name: "大学生妹妹",
    gender: "female",
    persona: "活泼真实，反应大",
    appearance: "22 岁左右邻家女生，清爽可爱戴细框眼镜，高马尾有自然碎发，淡妆，笑容有感染力，穿普通棉 T 恤，胸前挂着挂绳耳机",
    goodFor: "零食 / 平价好物",
  },
  {
    id: "practical_mom",
    name: "实在宝妈",
    gender: "female",
    persona: "精打细算，只认性价比",
    appearance: "38 岁左右亲切妈妈，及肩自然卷发，温和耐看，素净淡妆，皮肤自然真实，系着围裙或穿家常外套，围裙口袋里露出半截小毛巾",
    goodFor: "母婴 / 食品 / 家居日用",
  },
  {
    id: "tech_bro",
    name: "理工直男",
    gender: "male",
    persona: "参数党，嘴硬心软真香现场",
    appearance: "30 岁左右干净利落的普通男性，短发，长相端正亲切，皮肤自然真实，穿格子衬衫或纯色 T 恤，领口别着一支笔",
    goodFor: "数码 3C / 工具",
  },
  {
    id: "honest_uncle",
    name: "实在大叔",
    gender: "male",
    persona: "话糙理不糙，自用推荐",
    appearance: "45 岁左右和善大叔，短发略带花白，面相憨厚可靠，皮肤自然真实，穿普通 polo 衫，胸前口袋插着老花镜",
    goodFor: "食品 / 农产 / 工具",
  },
];

/**
 * Spoken-voice realism rules for on-camera dialogue. The core UGC insight
 * (Seedance-era): once viewers can't tell footage is AI, retention lives or dies
 * on whether the LINES sound spoken or written — a rendered model will make a
 * polished-ad script look exactly as pretty as a human one, so the tell moves
 * to the words. Injected wherever real people speak on camera.
 */
export const SPOKEN_VOICE_RULES = `台词口语真实感（铁律——画面已经像真人了，露馅的只剩台词）：
1. 台词必须像「说出来的」而不是「写出来的」：允许口头语（"就是"/"说真的"/"怎么说呢"），允许一句话说到一半收住——每条片最多一两处，别堆砌
2. 开场钩子像从对话中间开始，观众是"中途刷到"的——禁止"大家好/今天给大家介绍/最近很多人问我"式起头
3. 禁书面连接词（"因此/综上所述/首先其次"）；结尾不落道理、不写金句
4. 行动号召像顺口一提（"反正链接我放这了，你们自己看"），绝不是口号式 slogan
5. 写完逐句自查：读出来像文案的句子，全部改写成"说的"`;

/**
 * First-frame realism rules for person-on-camera image prompts. Stacked
 * specificity beats adjectives: a NAMED light source, a lived-in background
 * with one imperfection, and a mid-sentence pose kill the model's default
 * polish. Deliberately does NOT add facial-blemish keywords (pores/eye bags) —
 * real A/B calibration showed those over-correct into unappealing faces; skin
 * wording stays owned by REAL_FACE_CONSTRAINT.
 */
export const UGC_FIRST_FRAME_RULES = `人物画面首帧真实感（写 description/prompt 时逐条叠加，压住模型默认的精修广告感）：
1. 视角写具体：手机前摄自拍视角 / 手持怼脸机位，浅景深
2. 光要写满四要素：来源指名（窗 / 台灯 / 屏幕）+ 方向（从哪边来）+ 质感（有没有被窗帘或纱帘滤过）+ 画面里唯一的高光落在哪——绝不写"光线很好"这类空话
3. 背景要有生活痕迹 + 一处不完美（桌上没收的水杯、搭在椅背的外套）
4. 神态是"说话说到一半"：自然张口、眼神不必盯死镜头
5. 同一批出多条视频必须换人物、换房间、换光线方向——重复感是 AI 的最大破绽
6. 背景里点名一个会动的元素（晃动的窗帘 / 冒热气的杯子 / 走过的路人虚影）——全静止的背景一眼假`;

/**
 * Context-drives-appearance rule: a persona's look must carry 1–2 traces of what they
 * are DOING right now (flour on an apron mid-cooking, a phone tucked under the chin) —
 * and those traces must stay identical across every shot of the piece. Appearance
 * written as pure styling reads as a catalog model dropped into a scene.
 */
export const CONTEXT_APPEARANCE_RULE = `人物外观必须带处境痕迹：外观描述里至少写 1-2 处与"此刻正在做的事"对应的痕迹，且全片保持一致不消失。示例：
- 正在下厨 → 围裙上沾了点面粉、一缕头发从发夹里散出来
- 刚下班开箱 → 工牌还挂在脖子上、衬衫袖口随手挽起
- 边带娃边测评 → 肩头搭着一块口水巾、手腕上套着发圈`;

/**
 * Emotion-restraint rules for acted styles (drama / reversal / interview). End-state
 * emotion words ("激动"/"崩溃"/"惊呆") freeze video models into theatrical masks — the
 * single most common acting tell. Real emotion is written as a three-beat PROCESS and
 * stays visibly restrained; the strongest beat is the one being held back.
 */
export const EMOTION_RESTRAINT_RULES = `情绪写法铁律（演出来的情绪一眼假，忍着的情绪才真）：
1. 禁写情绪终态词（"激动""崩溃""惊呆""感动哭了"），一律写成三拍过程：什么触发 → 身体先有反应（呼吸/肩膀/前倾）→ 面部才开始反应且明显在克制
2. 每个情绪转折点只给一拍反应，不叠加（皱眉+叹气+摇头三连=舞台剧）
3. 最强的情绪是"差点没绷住"：写"嘴角压了两次才压住"，不写"放声大笑"`;

/**
 * Prompt block offering the built-in presenters to the script LLM. Styles that
 * cast on-camera characters append this so generated casts start from ordinary,
 * believable looks instead of the model's default influencer face. The spoken-
 * voice and first-frame realism rules ride along: every style that puts a person
 * on camera needs all three.
 */
export function presenterPromptBlock(): string {
  const lines = PRESENTER_PRESETS.map(
    (p) => `- ${p.name}（${p.gender === "female" ? "女" : "男"}，${p.persona}）：${p.appearance}（适合${p.goodFor}）`
  );
  return `内置素人主播库（角色外观可直接选用其一或在其基础上微调，也可自创——但必须保持同样的"普通素人"真实感）：\n${lines.join("\n")}\n\n${CONTEXT_APPEARANCE_RULE}\n\n${SPOKEN_VOICE_RULES}\n\n${UGC_FIRST_FRAME_RULES}`;
}

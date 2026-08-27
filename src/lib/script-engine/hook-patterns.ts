/**
 * Golden-3-second hook pattern library (e-commerce context).
 *
 * Treat a "hook" as a 3-second retention structure, not just a catchy line:
 *   0–1s stop the thumb → 1–3s prove relevance → 3–7s bridge to product;
 *   patterns are ranked by category preference and annotated with caution notes.
 *
 * Pure data + selection/render functions, unit-testable; injected into the LLM via script-engine prompts.
 */
import { categoryNameMap, type ProductCategory } from "./templates";

export interface HookPattern {
  id: string;
  name: string;
  /** 0–1s: how to stop the thumb */
  stop: string;
  /** 1–3s: how to prove relevance to the viewer */
  prove: string;
  /** 3–7s: how to naturally bridge to the product */
  bridge: string;
  /** arousal level: high is more attention-grabbing but riskier */
  arousal: "high" | "mid";
  /** strong-fit categories (matched entries take priority); omit = universal */
  categories?: ProductCategory[];
  /** situations to avoid (prevents awkward forced fits) */
  avoidWhen?: string;
  /** original example copy */
  example: string;
}

export const HOOK_PATTERNS: HookPattern[] = [
  {
    id: "visual_shock",
    name: "视觉冲击",
    stop: "第一帧直接上极致画面（爆浆/拉丝/脏净对比/微距质地），不给任何缓冲、不放 logo 空镜",
    prove: "1–3 秒点破这个画面和观众的关系（你家现在是不是也这样？）",
    bridge: "镜头自然从画面落到产品本身",
    arousal: "high",
    categories: ["beauty", "food", "home"],
    avoidWhen: "产品没有可视张力（纯数字/服务类）",
    example: "镜头怼上一擦就破的纸巾——你家现在用的是不是这种？",
  },
  {
    id: "suspense_question",
    name: "悬念提问",
    stop: "开口抛一个反常识/数字/身份的问题，让人忍不住想知道答案",
    prove: "1–3 秒让观众代入「我也想知道」",
    bridge: "产品就是这个问题的答案",
    arousal: "mid",
    avoidWhen: "问题太弱或答案太显然",
    example: "为什么我妈用了三十年的老办法，现在全扔了？",
  },
  {
    id: "contrast",
    name: "反差对比",
    stop: "制造价格/效果/身份的强反差画面或一句话",
    prove: "反差戳到观众的认知（原来差这么多）",
    bridge: "产品就是反差的来源",
    arousal: "high",
    categories: ["beauty", "fashion", "tech"],
    avoidWhen: "没有真实可证的反差（绝不虚标）",
    example: "左边专柜价，右边是它，价差你绝对想不到。",
  },
  {
    id: "pain_strike",
    name: "痛点直击",
    stop: "一句话戳中观众具体的痛/焦虑/后悔",
    prove: "1–3 秒放大这个痛点的日常场景",
    bridge: "产品来解决这个痛点",
    arousal: "mid",
    categories: ["beauty", "home", "food"],
    avoidWhen: "痛点太泛、谁都不疼",
    example: "还在为这事儿头疼？解法我都给你找好了。",
  },
  {
    id: "before_after",
    name: "前后对比",
    stop: "直接上「使用前」最糟的状态",
    prove: "1–3 秒切到「使用后」的反转",
    bridge: "中间多的那一步就是产品",
    arousal: "high",
    categories: ["beauty", "home"],
    avoidWhen: "前后变化不明显或无法演示",
    example: "用之前长这样，用之后长这样，中间只多了这一步。",
  },
  {
    id: "sound_hook",
    name: "声音钩子",
    stop: "第一秒一个抓耳的声音（咔嚓/撕拉/爆开/水声）配画面",
    prove: "声音引出使用场景",
    bridge: "声音来自产品被使用的瞬间",
    arousal: "mid",
    categories: ["food", "home", "tech"],
    avoidWhen: "产品没有标志性声音",
    example: "（咔嚓一声）就这一下，省了我一半事。",
  },
  {
    id: "challenge_doubt",
    name: "挑战质疑",
    stop: "「都说它好，我不信，今天实测」的质疑姿态",
    prove: "1–3 秒当场摆出测试动作",
    bridge: "测试结果指向产品",
    arousal: "mid",
    avoidWhen: "并没有真测试（别假装）",
    example: "网上都吹这个，我偏不信，买回来实测给你看。",
  },
  {
    id: "identity",
    name: "身份共鸣",
    stop: "点名一个身份群体（打工人/宝妈/学生党）",
    prove: "1–3 秒说出这个群体的共同处境",
    bridge: "产品是为他们准备的",
    arousal: "mid",
    categories: ["fashion", "beauty"],
    avoidWhen: "身份和品类不搭",
    example: "打工人到家累瘫，这个就是给我们准备的。",
  },
  {
    id: "number_benefit",
    name: "数字利益前置",
    stop: "开口就甩一个具体数字（3 秒/省一半/一个动作）",
    prove: "数字让人觉得「值得看完」",
    bridge: "数字靠产品实现",
    arousal: "mid",
    categories: ["tech", "home"],
    avoidWhen: "数字虚标（违广告法绝对化）",
    example: "一个动作省一半时间，看完你就会了。",
  },
  {
    id: "unexpected",
    name: "反常识意外",
    stop: "「你以为 A，其实 B」的认知颠覆",
    prove: "1–3 秒揭示反常识的真相",
    bridge: "产品是这个真相的载体",
    arousal: "mid",
    avoidWhen: "反常识太牵强",
    example: "你以为越贵越好？这件事上恰恰反过来。",
  },
  // ---- 2026-08 增补：信任型/社证型钩子（海外投放数据背书：Confession/诚实开场是
  // 月投百万美金账户用量与表现双高的战术；「全程夸」恰是观众识别广告的第一信号）----
  {
    id: "confession",
    name: "自曝反转",
    stop: "先自曝一个「差点翻车」的真实经历（差点退货/用错了/买亏过）",
    prove: "1–3 秒讲清转折点（直到我发现……）",
    bridge: "产品在反转里立功",
    arousal: "mid",
    avoidWhen: "编造不存在的翻车经历（假故事一戳就穿）",
    example: "我差点把它退了——直到我发现之前一直用错了。",
  },
  {
    id: "honest_flaw",
    name: "认缺点开场",
    stop: "开口先承认产品的一个真实缺点",
    prove: "1–3 秒说明为什么缺点没挡住自己",
    bridge: "转到瑕不掩瑜的核心优点",
    arousal: "mid",
    avoidWhen: "缺点是硬伤（安全/功效问题不能当话术）",
    example: "先说缺点：它是真的丑。但我还是回购了三次。",
  },
  {
    id: "elimination_haul",
    name: "淘汰式测评",
    stop: "「买了 N 个退了 N-1 个」的筛选结果前置",
    prove: "1–3 秒快闪被淘汰的同类（不点名品牌）",
    bridge: "留下来的那个就是主角",
    arousal: "high",
    categories: ["beauty", "home", "food"],
    avoidWhen: "并没有真横向用过多款（假测评踩合规红线）",
    example: "同类我买过五个，退了仨闲置一个，留下的只有它。",
  },
  {
    id: "cost_math",
    name: "成本拆账",
    stop: "开口把价格拆成一个日常小数字（每天/每次多少钱）",
    prove: "1–3 秒对比一个人人熟悉的花销（一杯奶茶/一顿早饭）",
    bridge: "算完账引出产品本体",
    arousal: "mid",
    categories: ["home", "food", "tech"],
    avoidWhen: "数字虚标或价格不实（违广告法）",
    example: "算了下一天不到五毛钱，还没我楼下包子贵。",
  },
  {
    id: "comment_reply",
    name: "评论回应",
    stop: "开场念一条评论区的怀疑/提问（「真的假的？」），整条视频就是回答",
    prove: "1–3 秒表明「今天统一回复」的姿态",
    bridge: "用演示/实测回应质疑，产品自然登场",
    arousal: "mid",
    avoidWhen: "把怀疑式换成夸赞式伪证言（平台判定诱导，只能用质疑/提问）",
    example: "评论区总有人问这玩意儿是不是智商税——今天统一回复。",
  },
  {
    id: "hype_confirm",
    name: "跟风真香",
    stop: "「刷到 N 次终于没忍住买了」的跟风者视角",
    prove: "1–3 秒给出「现在我懂了」的态度反转",
    bridge: "讲清到底香在哪",
    arousal: "mid",
    avoidWhen: "产品并没有社交热度（无风可跟显得假）",
    example: "这东西刷到第三次我还是下单了，现在我悟了。",
  },
];

/** Look up a hook pattern's display name by its id (used to render performance-feedback hints); returns the id unchanged if unknown */
export function hookPatternName(id: string): string {
  return HOOK_PATTERNS.find((p) => p.id === id)?.name ?? id;
}

/** Category-preference hook selection: matched-category patterns first, then universal ones; deduplicated, top n returned */
export function selectHookPatterns(category: ProductCategory, n = 5): HookPattern[] {
  const matched = HOOK_PATTERNS.filter((p) => p.categories?.includes(category));
  const universal = HOOK_PATTERNS.filter((p) => !p.categories);
  const seen = new Set<string>();
  const out: HookPattern[] = [];
  for (const p of [...matched, ...universal]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Renders into a "three-beat structure + category-preference" prompt snippet for LLM injection.
 * With pinnedHookId (anti-homogenization batch rotation): only that pattern's card is shown and the
 * opening MUST use it — so each batch item gets a genuinely different hook mechanism instead of the
 * LLM free-picking the same favourite every time.
 */
export function buildHookGuidance(category: ProductCategory, n = 5, pinnedHookId?: string): string {
  const pinned = pinnedHookId ? HOOK_PATTERNS.find((p) => p.id === pinnedHookId) : undefined;
  const patterns = pinned ? [pinned] : selectHookPatterns(category, n);
  const cards = patterns
    .map(
      (p, i) =>
        `${i + 1}.【${p.name}】${p.arousal === "high" ? "(高唤醒)" : ""}\n` +
        `   · 0–1s 截停：${p.stop}\n` +
        `   · 1–3s 证相关：${p.prove}\n` +
        `   · 3–7s 接产品：${p.bridge}\n` +
        `   · 示例：${p.example}` +
        (p.avoidWhen ? `\n   · 慎用：${p.avoidWhen}` : "")
    )
    .join("\n\n");
  return `【黄金3秒钩子 — 按「三拍结构」设计开场】
钩子不是一句俏皮话，是一个 3 秒留人结构：
  0–1s 截停拇指（强画面/强声音/强问题，绝不放 logo 或空镜开场）
  1–3s 证明相关（让刷到的人立刻觉得「这跟我有关」）
  3–7s 自然接到产品 / 效果

${
  pinned
    ? `本次开场【必须】使用以下钩子机制（反同质化轮换指定，不要换成其它机制）：`
    : `为「${categoryNameMap[category] || category}」品类优选以下钩子机制（任选其一；若生成多个脚本，请各用不同机制以便 A/B 对比）：`
}

${cards}`;
}

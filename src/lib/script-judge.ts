/**
 * Judge panel — a five-judge adversarial pass over script lines and shot visuals,
 * run BEFORE any money is spent on generation.
 *
 * The UGC methodology this encodes: video models render a bad script exactly as
 * pretty as a good one, so the script must be torn apart first — by narrow,
 * bad-tempered specialists, not one generalist reviewer. Five judges, each
 * owning exactly one axis (retention pacing / spoken-not-written voice /
 * freshness / structure / visible-action visuals), one LLM call for all five,
 * plus rewrites that keep meaning, selling points and — critically — line
 * LENGTH (voiceover duration is pinned to shot duration by TTS).
 *
 * v2 additions:
 *  - visual judge: "who does what in THIS second" — purpose-sentences
 *    ("shows product quality") are not frames; they get rewritten into visible
 *    actions via descriptionRewrites.
 *  - three-tier adoption grades: hands-off chains auto-apply invariant/default
 *    rewrites only; taste-tier stays display-only (protects creative choices
 *    while still catching hard defects). Invalid tiers clamp to "taste" —
 *    when in doubt, show, never auto-change.
 *  - evidence rule: every issue must quote the offending fragment; rewrites
 *    must preserve the original line's numeric fact tokens (price/spec/count),
 *    enforced server-side — a rewrite that loses a number is dropped.
 *
 * Pure functions: prompt building + response parsing/clamping. The route does I/O.
 */
import { SPOKEN_VOICE_RULES } from "@/lib/presenters";
import { extractJSON } from "@/lib/script-engine/generator";

export const JUDGE_IDS = ["pace", "voice", "idea", "structure", "visual"] as const;
export type JudgeId = (typeof JUDGE_IDS)[number];

/** Judge display metadata (zh/en) for the report UI. */
export const JUDGE_META: Record<JudgeId, { zh: string; en: string }> = {
  pace: { zh: "节奏官", en: "Pacing judge" },
  voice: { zh: "口语官", en: "Voice judge" },
  idea: { zh: "创意官", en: "Freshness judge" },
  structure: { zh: "结构官", en: "Structure judge" },
  visual: { zh: "画面官", en: "Visual judge" },
};

/** Adoption tiers: what automation may act on vs. what stays a suggestion. */
export const JUDGE_TIERS = ["invariant", "default", "taste"] as const;
export type JudgeTier = (typeof JUDGE_TIERS)[number];

export interface JudgeIssue {
  shotId?: number;
  issue: string;
  /** Adoption grade (display); invalid model output clamps to "taste" */
  tier: JudgeTier;
}
export interface JudgeVerdict {
  judge: JudgeId;
  issues: JudgeIssue[];
}
export interface JudgeRewrite {
  shotId: number;
  voiceover: string;
  /** Adoption grade: hands-off chains only auto-apply invariant/default */
  tier: JudgeTier;
}
/** Visual judge's shot-description rewrite (function sentence → visible action). */
export interface JudgeDescriptionRewrite {
  shotId: number;
  description: string;
  tier: JudgeTier;
}
export interface JudgeReport {
  verdicts: JudgeVerdict[];
  rewrites: JudgeRewrite[];
  descriptionRewrites: JudgeDescriptionRewrite[];
  summary?: string;
}

/** Minimal shot view the judges need (id + spoken line + what the frame shows). */
export interface JudgeShotInput {
  shotId: number;
  voiceover: string;
  /** Shot visual description — feeds the visual judge; optional for line-only callers */
  description?: string;
}

/** True when the text contains CJK characters (rewrite-language pick). */
function hasCjk(s: string): boolean {
  return /[一-鿿぀-ヿ가-힯]/.test(s);
}

/** Style-specific extra criteria appended per script style (keyed by styleType). */
const STYLE_CRITERIA: Record<string, string> = {
  reversal: [
    `反转专项判准（结构官加审）：`,
    `- 反转必须能填进一句话公式：「因为<铺垫过的事实>，原以为<原认知>不成立，被打脸的细节是<具体可感知点>」——填不进=反转不成立，invariant 级点名`,
    `- 揭示必须来自前面铺垫过的事实，凭空冒出的新信息不算反转`,
  ].join("\n"),
  drama: [
    `对话剧专项判准（口语官与结构官加审）：`,
    `- 每句台词必须能标出一个行动动词（怼/试探/炫耀/服软）——标不出行动的台词是解说词，不是对话`,
    `- 交换说话者测试：把这句台词换给对方说也毫无违和=这句没有立场，点名重写`,
    `- 每个角色要有自己的一条隐含议程（想赢什么），台词服务不了任何人议程的，点名`,
  ].join("\n"),
  interview: [
    `采访专项判准（口语官与结构官加审）：`,
    `- 受访者每句话必须能标出行动动词（质疑/惊讶/求证/转粉），纯配合式捧哏台词点名`,
    `- 交换说话者测试：主持人和受访者的台词互换后不违和=两人没有各自立场，点名重写`,
  ].join("\n"),
};

/**
 * Build the single-call judge-panel prompt. All five judges rule in one
 * response; rewrites must keep meaning/claims and stay within ±20% of the
 * original length so TTS timing still fits the shot slots.
 */
export function buildJudgePrompt(
  shots: JudgeShotInput[],
  opts: { styleLabel?: string; styleType?: string } = {}
): string {
  const lines = shots.map((s) => {
    const desc = (s.description ?? "").trim();
    return desc
      ? `- shotId ${s.shotId}：台词「${s.voiceover}」｜画面「${desc}」`
      : `- shotId ${s.shotId}：「${s.voiceover}」`;
  });
  const english = shots.length > 0 && shots.every((s) => !hasCjk(`${s.voiceover}${s.description ?? ""}`));
  const styleExtra = opts.styleType ? STYLE_CRITERIA[opts.styleType] : undefined;
  return [
    `你是一支短视频「判官团」，由五位只管一件事、脾气很差的审稿人组成。任务：把下面这条${opts.styleLabel ? `（${opts.styleLabel}风格）` : ""}视频的逐镜台词与画面撕碎，再给出重写。`,
    ``,
    `五位判官（每位只从自己的角度挑刺，宁狠勿宽）：`,
    `1. 节奏官（pace）：只管留人。第一句钩不住人=死刑；每句必须让人想听下一句；信息密度低、又长又绕的句子全部点名。`,
    `2. 口语官（voice）：只管「说的不是写的」。判准如下（铁律）：`,
    SPOKEN_VOICE_RULES,
    `3. 创意官（idea）：只管新鲜感。套路化开头、用烂的梗、任何同类视频都会说的通用表达，全部点名。`,
    `4. 结构官（structure）：只管递进与收束。铺垫→递进→收束是否成立；结尾落金句/讲道理=违规；行动号召口号化=违规；全片超过 20 秒却没有一句中段续命钩（约 40%–60% 进度处重新开悬念的句子）=点名。另加两条全局检查：`,
    `   - 信息密度均匀=没有一镜是事件：逐镜信息量完全平均说明全片没有高潮，点名密度最低的镜让它让位`,
    `   - 「不成立的钩子替代品」负例清单：无来源的新悬念（前文没铺垫突然抛问题）、藏结果式吊胃口（黑屏/"结果你们猜"却不兑现）、把同一句威胁复读得更大声——这三种都不算钩子，点名`,
    `5. 画面官（visual）：只管「这一秒画面里谁做了什么」。判准：`,
    `   - description 必须是可见事实：谁（角色名/手部）+ 做什么动作 + 对什么对象；镜头拍不出来的写法都点名`,
    `   - 功能句不是画面：「展示产品效果」「建立信任感」「体现品质」这类目的描述=没写画面，invariant 级点名并给出可见动作重写（写进 descriptionRewrites）`,
    `   - 重写保持原镜意图与场景，只把"目的"翻译成"动作"，长度与原句相当`,
    styleExtra ?? "",
    ``,
    `证据规则（对所有判官生效）：每条 issue 必须包含两个要素——①用「」引出原句/原描述里出问题的片段；②一句话说清什么没有成立。没有引文的挑刺视为无效。`,
    ``,
    `采纳分级（每条 issue 与每条重写都必须标 tier）：`,
    `- invariant：硬伤，不改必翻车（事实/合规风险、第一句钩不住、功能句无画面、台词密到口型对不上）`,
    `- default：默认应改（口语铁律违规、套路化表达、结构断裂）`,
    `- taste：品味之争（换个说法也成立）——只提出，不强求；自动化流程不会采纳 taste 级重写`,
    ``,
    `逐镜内容：`,
    ...lines,
    ``,
    `只输出 JSON，格式：`,
    `{"verdicts":[{"judge":"pace","issues":[{"shotId":1,"issue":"「原句片段」——什么没有成立","tier":"default"}]},{"judge":"voice","issues":[]},{"judge":"idea","issues":[]},{"judge":"structure","issues":[]},{"judge":"visual","issues":[]}],"rewrites":[{"shotId":1,"voiceover":"重写后的台词","tier":"default"}],"descriptionRewrites":[{"shotId":2,"description":"重写后的画面描述（可见动作）","tier":"invariant"}],"summary":"一句话总评"}`,
    ``,
    `重写规则：`,
    `- 保留原意、卖点与所有事实性说法，只改「怎么说」；不新增任何功效/价格承诺（广告合规红线）`,
    `- 重写句必须原样保留原句里出现的所有数字、价格与规格（服务端会逐个校验数字 token，丢一个整条弃用）`,
    `- 重写后的台词必须像「说出来的」，且长度与原句相当（字数差控制在 ±20%，配音时长钉死在分镜槽里）`,
    `- 没毛病的镜头不要出现在 rewrites/descriptionRewrites 里；判官没意见就各自给空 issues`,
    english ? `- All issues and rewrites in English (the script is English).` : ``,
  ]
    .filter((l) => l !== undefined && l !== "")
    .join("\n");
}

/** Clamp a tier value; anything unrecognized becomes "taste" (show, never auto-change). */
function clampTier(raw: unknown): JudgeTier {
  return typeof raw === "string" && (JUDGE_TIERS as readonly string[]).includes(raw) ? (raw as JudgeTier) : "taste";
}

/**
 * Numeric fact tokens of a line (prices, specs, counts). Matching is
 * boundary-guarded so "3" never matches inside "13" — a rewrite that changed a
 * number must be dropped, not accepted by substring luck.
 */
export function factTokens(text: string): string[] {
  return Array.from(new Set(text.match(/\d+(?:\.\d+)?/g) ?? []));
}

/** True when every numeric fact token of the original survives verbatim in the rewrite. */
export function preservesFactTokens(original: string, rewrite: string): boolean {
  for (const tok of factTokens(original)) {
    const re = new RegExp(`(?<![\\d.])${tok.replace(".", "\\.")}(?![\\d.])`);
    if (!re.test(rewrite)) return false;
  }
  return true;
}

/** Clamp one issue list: keep only entries with usable text; shotId must exist when given. */
function clampIssues(raw: unknown, validShots: Set<number>): JudgeIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: JudgeIssue[] = [];
  for (const it of raw) {
    const issue = typeof (it as { issue?: unknown })?.issue === "string" ? (it as { issue: string }).issue.trim() : "";
    if (!issue) continue;
    const sid = (it as { shotId?: unknown }).shotId;
    const shotId = typeof sid === "number" && validShots.has(sid) ? sid : undefined;
    const tier = clampTier((it as { tier?: unknown }).tier);
    out.push(shotId === undefined ? { issue, tier } : { shotId, issue, tier });
  }
  return out;
}

/** Shared clamp for text rewrites: real shot, non-empty, sane length ratio, facts preserved. */
function clampTextRewrites<T>(
  raw: unknown,
  originals: Map<number, string>,
  field: "voiceover" | "description",
  make: (shotId: number, text: string, tier: JudgeTier) => T
): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  const seen = new Set<number>();
  for (const r of raw) {
    const shotId = (r as { shotId?: unknown })?.shotId;
    const text =
      typeof (r as Record<string, unknown>)?.[field] === "string"
        ? ((r as Record<string, string>)[field] as string).trim()
        : "";
    if (typeof shotId !== "number" || !originals.has(shotId) || !text || seen.has(shotId)) continue;
    const original = originals.get(shotId) ?? "";
    const origLen = original.trim().length;
    if (origLen > 0) {
      // 0.4x–2.5x: beyond that the TTS timing breaks (voiceover) or the shot got re-imagined
      const ratio = text.length / origLen;
      if (ratio < 0.4 || ratio > 2.5) continue;
    }
    // evidence discipline: a rewrite that loses a number lost a fact — drop it
    if (!preservesFactTokens(original, text)) continue;
    seen.add(shotId);
    out.push(make(shotId, text, clampTier((r as { tier?: unknown }).tier)));
  }
  return out;
}

/**
 * Parse + clamp the LLM's judge response. Unknown judges are dropped, missing
 * judges get empty issue lists (the UI renders all five); voiceover and
 * description rewrites are kept only for real shots with non-empty text within
 * a sane length ratio of the original AND with every numeric fact token intact.
 */
export function parseJudgeResponse(content: string, shots: JudgeShotInput[]): JudgeReport {
  const validShots = new Set(shots.map((s) => s.shotId));
  const voiceoverByShot = new Map(shots.map((s) => [s.shotId, s.voiceover]));
  // description rewrites only apply to shots that HAVE a description
  const descriptionByShot = new Map(
    shots.filter((s) => (s.description ?? "").trim()).map((s) => [s.shotId, (s.description ?? "").trim()])
  );
  let raw: unknown;
  try {
    raw = JSON.parse(extractJSON(content));
  } catch {
    throw new Error("判官团返回的不是合法 JSON");
  }

  const rawVerdicts = Array.isArray((raw as { verdicts?: unknown })?.verdicts)
    ? ((raw as { verdicts: unknown[] }).verdicts as unknown[])
    : [];
  const byJudge = new Map<JudgeId, JudgeIssue[]>();
  for (const v of rawVerdicts) {
    const judge = (v as { judge?: unknown })?.judge;
    if (typeof judge !== "string" || !(JUDGE_IDS as readonly string[]).includes(judge)) continue;
    byJudge.set(judge as JudgeId, clampIssues((v as { issues?: unknown }).issues, validShots));
  }
  const verdicts: JudgeVerdict[] = JUDGE_IDS.map((id) => ({ judge: id, issues: byJudge.get(id) ?? [] }));

  const rewrites = clampTextRewrites(
    (raw as { rewrites?: unknown })?.rewrites,
    voiceoverByShot,
    "voiceover",
    (shotId, voiceover, tier): JudgeRewrite => ({ shotId, voiceover, tier })
  );
  const descriptionRewrites = clampTextRewrites(
    (raw as { descriptionRewrites?: unknown })?.descriptionRewrites,
    descriptionByShot,
    "description",
    (shotId, description, tier): JudgeDescriptionRewrite => ({ shotId, description, tier })
  );

  const summary = typeof (raw as { summary?: unknown })?.summary === "string" ? (raw as { summary: string }).summary.trim() : undefined;
  return { verdicts, rewrites, descriptionRewrites, summary: summary || undefined };
}

/**
 * The rewrites automation may apply without a human in the loop: invariant and
 * default tiers only. Taste-tier rewrites are opinions — every hands-off chain
 * (web free / AI / batch / CLI) displays them but never auto-applies.
 */
export function autoApplicableRewrites(report: JudgeReport): JudgeRewrite[] {
  return report.rewrites.filter((r) => r.tier !== "taste");
}

/** Same gate for the visual judge's description rewrites. */
export function autoApplicableDescriptionRewrites(report: JudgeReport): JudgeDescriptionRewrite[] {
  return report.descriptionRewrites.filter((r) => r.tier !== "taste");
}

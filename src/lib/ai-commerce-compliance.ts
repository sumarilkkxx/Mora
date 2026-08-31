/**
 * AI-commerce policy guardrail — warn-only checks against the 2026-07 Douyin e-commerce rules for
 * AI-generated content. Nothing is blocked or removed: every style stays available, warnings
 * surface in the release gate so the user decides (per the "keep everything, warn only" directive).
 *
 * The three rules encoded here (all platform-verified 2026-07):
 * 1. Douyin explicitly forbids AI-GENERATED product comparison/review content — the comparison and
 *    unboxing script styles are exactly that form, so publishing them to Douyin risks takedowns.
 * 2. Digital humans are barred from five categories: medical, finance, beauty-efficacy,
 *    health-supplement-efficacy, education/training-outcome claims.
 * 3. An AI character claiming personal product experience ("亲测有效") edges into the
 *    "fabricated usage results" red line — reword as recommendation-style copy.
 *
 * Pure functions, unit-testable; the gate route feeds it data.
 */

export type AiCommerceWarningId = "ai_review_style" | "digital_human_category" | "personal_testimony";

export interface AiCommerceWarning {
  id: AiCommerceWarningId;
  message: { zh: string; en: string };
}

export interface AiCommerceInput {
  /** Script style key (styleType), e.g. "comparison" / "unboxing" / "drama" */
  styleType?: string | null;
  /** Whether an AI-generated person appears on camera (shot characterId / script cast / project presenter) */
  hasAiPerson: boolean;
  /** Product name + category text, for the banned-category scan */
  productText?: string;
  /** Voiceover/dialogue copy, for the personal-testimony scan */
  dialogueText?: string;
}

/** Script styles that read as product comparison/review content (Douyin bans these when AI-generated). */
export const AI_REVIEW_STYLES = new Set(["comparison", "unboxing"]);

/**
 * Digital-human banned categories on Douyin, matched conservatively against product name/category
 * text — terms chosen to minimize false positives (this is a warning tool, not a hard block).
 */
export const DIGITAL_HUMAN_BANNED_CATEGORIES: Array<{
  label: { zh: string; en: string };
  terms: string[];
}> = [
  {
    label: { zh: "医疗", en: "medical" },
    terms: ["医疗", "医用", "药品", "药物", "医院", "诊所", "治疗仪", "理疗"],
  },
  {
    label: { zh: "金融理财", en: "finance" },
    terms: ["理财", "基金", "股票", "保险", "贷款", "信用卡", "投资课"],
  },
  {
    label: { zh: "美容功效", en: "beauty efficacy" },
    terms: ["美白", "祛斑", "祛痘", "抗皱", "淡纹", "丰胸", "减肥", "瘦身", "生发", "防脱"],
  },
  {
    label: { zh: "保健功效", en: "health-supplement efficacy" },
    terms: ["保健品", "增强免疫", "降血压", "降血糖", "降血脂", "补肾", "调理体质"],
  },
  {
    label: { zh: "教培效果", en: "education/training outcomes" },
    terms: ["提分", "包过", "保过", "速成班", "升学率"],
  },
];

/** Phrases where an AI character claims first-person product experience (fabricated-usage-results risk). */
export const PERSONAL_TESTIMONY_TERMS = [
  "亲测",
  "实测有效",
  "我用了一周",
  "我用了一个月",
  "用了三天",
  "本人使用",
  "自用推荐",
  "亲身体验",
];

/** Runs the three warn-only checks. Returns an empty array when nothing matches. */
export function checkAiCommerceCompliance(input: AiCommerceInput): AiCommerceWarning[] {
  const warnings: AiCommerceWarning[] = [];
  const style = (input.styleType || "").trim();
  const productText = input.productText || "";
  const dialogueText = input.dialogueText || "";

  // 1. AI-generated review/comparison content — applies to every AI-generated script regardless of
  // whether a person is on camera (the platform rule targets the content form, not the presenter)
  if (AI_REVIEW_STYLES.has(style)) {
    const styleName = style === "comparison" ? { zh: "对比测评", en: "comparison review" } : { zh: "开箱测评", en: "unboxing review" };
    warnings.push({
      id: "ai_review_style",
      message: {
        zh: `「${styleName.zh}」风格在抖音有处置风险：平台规则不允许 AI 生成商品对比测评类内容。功能保留可用——建议抖音改投口播种草/情景短剧风格，或将此风格用于其他平台`,
        en: `The "${styleName.en}" style is takedown-risky on Douyin: platform rules forbid AI-generated product comparison/review content. The style stays available — for Douyin, prefer talking-head or drama styles, or publish this style elsewhere`,
      },
    });
  }

  // 2. Digital-human banned categories — only meaningful when an AI person fronts the video
  if (input.hasAiPerson && productText) {
    for (const cat of DIGITAL_HUMAN_BANNED_CATEGORIES) {
      const hit = cat.terms.find((t) => productText.includes(t));
      if (hit) {
        warnings.push({
          id: "digital_human_category",
          message: {
            zh: `商品疑似「${cat.label.zh}」类目（命中词「${hit}」）：抖音禁止数字人推介医疗/金融/美容功效/保健功效/教培效果五类内容。建议改用无人物出镜的商品实拍形态，或人工确认类目后再发布`,
            en: `Product looks like the "${cat.label.en}" category (matched "${hit}"): Douyin bars digital humans from medical/finance/beauty-efficacy/health-efficacy/education-outcome content. Use a no-presenter product format, or confirm the category manually before publishing`,
          },
        });
        break; // one category warning is enough — avoid stacking near-duplicate lines
      }
    }
  }

  // 3. AI character claiming personal usage experience — fabricated-usage-results red line
  if (input.hasAiPerson && dialogueText) {
    const hit = PERSONAL_TESTIMONY_TERMS.find((t) => dialogueText.includes(t));
    if (hit) {
      warnings.push({
        id: "personal_testimony",
        message: {
          zh: `AI 人物台词出现「${hit}」式亲测宣称：AI 角色虚构使用体验贴近平台「伪造商品使用效果」红线。建议改为种草推荐表述（如「很多人反馈」「值得试试」）`,
          en: `AI-character dialogue contains a first-person testimony ("${hit}"): a fabricated usage claim by an AI character edges into the "fabricated usage results" red line. Reword as recommendation-style copy ("many users report", "worth trying")`,
        },
      });
    }
  }

  return warnings;
}

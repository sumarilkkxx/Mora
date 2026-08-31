import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createLLMClient, llmErrorPair, withLLMErrors } from "@/lib/llm-error";
import { reasoningParams } from "@/lib/script-engine/generator";
import { sanitizeCustomAdTemplate, AD_TEMPLATE_GROUPS } from "@/lib/ad-templates";
import { CAMERA_PRESETS } from "@/lib/camera-presets";
import { LOOK_PRESETS } from "@/lib/look-presets";

/**
 * AI custom ad-template generation: turn a concrete product (name / category /
 * selling points) into a full-pipeline AdTemplate recipe. The LLM only PICKS from
 * the real preset vocabularies (styles, camera presets, looks, compose options) —
 * every id in its output is validated and clamped by sanitizeCustomAdTemplate, so
 * an invalid pick degrades to a safe default instead of breaking the pipeline.
 *
 * No retry loop of our own: transport-level retries (429/5xx, plus free-pool 402)
 * are the SDK's job via createLLMClient; anything that still fails surfaces to the
 * user with an actionable message. Blind app-level retry loops stay banned
 * project-wide (paid-task discipline) — those would re-submit billable work.
 */

const STYLE_GLOSS: Record<string, string> = {
  "pain-point": "痛点解决式",
  scenario: "场景种草式",
  comparison: "对比测评式",
  story: "故事叙事式",
  drama: "双人情景短剧",
  reversal: "反转剧情",
  interview: "街访/采访体",
  unboxing: "开箱体验",
  product_pov: "商品第一人称/画面主导",
  talking_head: "达人口播",
};

const VIDEO_MODE_GLOSS: Record<string, string> = {
  product_closeup: "商品特写为主",
  graphic_montage: "图文快闪拼贴",
  scene_demo: "真实场景演示",
  live_presenter: "真人出镜讲解",
};

function buildPrompt(productName: string, category: string, sellingPoints: string): string {
  const styles = Object.entries(STYLE_GLOSS).map(([k, v]) => `${k}(${v})`).join("、");
  const modes = Object.entries(VIDEO_MODE_GLOSS).map(([k, v]) => `${k}(${v})`).join("、");
  const looks = LOOK_PRESETS.map((l) => `${l.id}(${l.name.zh})`).join("、");
  const cameras = CAMERA_PRESETS.map((c) => `${c.id}(${c.name.zh})`).join("、");
  const groups = AD_TEMPLATE_GROUPS.map((g) => `${g.id}(${g.name.zh})`).join("、");
  return [
    `为下面这个商品定制一款带货短视频「成片模板」配方，所有枚举字段只能从给定词表中选：`,
    `商品名称：${productName}`,
    category ? `商品类目：${category}` : "",
    sellingPoints ? `核心卖点：${sellingPoints}` : "",
    ``,
    `词表：`,
    `- styleType（脚本风格）：${styles}`,
    `- videoMode（画面形态）：${modes}`,
    `- look（画面光线色调）：${looks}`,
    `- 运镜预设 id：${cameras}`,
    `- group（模板分组）：${groups}`,
    `- captionPreset：standard、bold、minimal、karaoke；bgm：none、upbeat、chill、energetic、emotional；quality：fast、standard、hd`,
    `- cameraPlan 的键（镜头类型）：hook、pain_point、product_reveal、demo、social_proof、cta（选 3-5 个，值为运镜预设 id）`,
    ``,
    `要求：配方要针对这个商品的品类特性与卖点定制（如食品重食欲光与微距、数码重冷调与结构展示），scriptHint 用一句中文写清创意方向与叙事结构，内容真实合规（不得使用绝对化用语与虚假承诺）。`,
    `只输出一个 JSON 对象，不要任何其他文字，格式：`,
    `{"name":{"zh":"模板名(≤8字)","en":"English name"},"tagline":{"zh":"一句话卖点","en":"one-line pitch"},"emoji":"一个emoji","group":"...","goodFor":["${category || "beauty"}"],"styleType":"...","videoMode":"...","look":"...","cameraPlan":{"hook":"...","product_reveal":"...","demo":"...","cta":"..."},"compose":{"captionPreset":"...","bgm":"...","bgmDuck":true,"quality":"standard","productCard":true},"scriptHint":{"zh":"创意方向一句话"}}`,
  ].filter(Boolean).join("\n");
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const productName = typeof body.productName === "string" ? body.productName.trim() : "";
  const category = typeof body.category === "string" ? body.category : "";
  const sellingPoints = typeof body.sellingPoints === "string" ? body.sellingPoints.slice(0, 500) : "";
  const llmConfig = body.llmConfig;

  if (!productName) {
    return apiError(req, "请先填写商品名称", "Please enter the product name first");
  }
  if (!llmConfig?.baseUrl || !llmConfig?.model) {
    return apiError(req, "请先在设置中配置 LLM 参数", "Please configure the LLM in settings first");
  }

  try {
    // shared factory: keyless endpoints accept a placeholder key; SDK retries + free-pool 402 retry
    const client = createLLMClient(llmConfig);
    const response = await withLLMErrors(
      () =>
        client.chat.completions.create({
          model: llmConfig.model,
          messages: [
            { role: "system", content: "你是资深电商短视频导演，只输出 JSON。" },
            { role: "user", content: buildPrompt(productName, category, sellingPoints) },
          ],
          temperature: 0.8,
          ...reasoningParams(llmConfig.baseUrl),
        }),
      llmConfig,
    );
    const text = response.choices[0]?.message?.content ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
      return apiError(req, "AI 未返回有效的模板配方，请重试", "The AI did not return a valid template recipe, please try again", 502);
    }
    const template = sanitizeCustomAdTemplate(JSON.parse(text.slice(start, end + 1)));
    if (!template) {
      return apiError(req, "AI 返回的配方无法解析，请重试", "Could not parse the AI's recipe, please try again", 502);
    }
    return NextResponse.json({ template });
  } catch (error) {
    console.error("AI 定制模板生成失败:", error);
    const { zh, en } = llmErrorPair(error);
    return apiError(req, `AI 定制模板生成失败: ${zh}`, `AI template generation failed: ${en}`, 500);
  }
}

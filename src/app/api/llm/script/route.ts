import { NextRequest, NextResponse } from "next/server";
import { generateScript, analyzeProduct, type LLMConfig } from "@/lib/script-engine/generator";
import { bindProductImageToLocalShots } from "@/lib/local-production";
import { normalizeTargetVideoDuration } from "@/lib/target-video-duration";
import { styleNameMap, type ScriptStyleType } from "@/lib/script-engine/prompts";
import { hookPatternName, HOOK_PATTERNS } from "@/lib/script-engine/hook-patterns";
import type { ProductCategory } from "@/lib/script-engine/templates";
import { getDb } from "@/lib/db";
import { scripts as scriptsTable, projects, publishMetrics } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { apiError, errText } from "@/lib/api-error";
import { llmErrorPair } from "@/lib/llm-error";
import { topConvertingStyle, topConvertingHook, buildPerformanceHint, type MetricInput } from "@/lib/performance-insights";
import { toRemoteUsableImage } from "@/lib/remote-image";
import {
  isOpenRouterPolicyRejection,
  openRouterPolicyFallbackConfig,
} from "@/lib/openrouter-llm-fallback";

/** Allowed enum values for the styleType column in the scripts table */
const VALID_SCRIPT_STYLE = new Set([
  "pain_point", "scene", "comparison", "story",
  "drama", "reversal", "interview", "unboxing", "product_pov", "talking_head",
  "custom",
]);

/** Normalize a frontend category value to a ProductCategory supported by the engine */
function normalizeCategory(raw: unknown): ProductCategory {
  const map: Record<string, ProductCategory> = {
    beauty: "beauty",
    food: "food",
    home: "home",
    fashion: "fashion",
    tech: "tech",
    digital: "tech", // frontend uses "digital" for the "Electronics/3C" category
    "3c": "tech",
    other: "beauty", // fallback for uncategorized items
  };
  return map[String(raw ?? "").toLowerCase()] ?? "beauty";
}

/** Normalize a frontend script style value to a ScriptStyleType supported by the engine */
function normalizeStyle(raw: unknown): ScriptStyleType {
  const map: Record<string, ScriptStyleType> = {
    pain_point: "pain_point",
    "pain-point": "pain_point",
    scene: "scene",
    scenario: "scene", // frontend uses "scenario" for the "scene recommendation" style
    comparison: "comparison",
    story: "story",
    // The four commerce-video forms (剧情形/物品形/口播形 additions)
    drama: "drama", // dialogue-driven mini-drama (multi-character conflict)
    reversal: "reversal", // expectation-subverting skit
    interview: "interview", // street-interview (host + interviewee)
    unboxing: "unboxing", // first-person immersive unboxing review
    product_pov: "product_pov", // personified product speaking first-person
    talking_head: "talking_head", // persona-driven direct-to-camera pitch
    custom: "custom",
    auto: "pain_point", // smart-recommend mode defaults to pain-point style
  };
  return map[String(raw ?? "").toLowerCase()] ?? "pain_point";
}

/**
 * Data-flywheel read side: turn the creator's real published-video metrics into a generation hint.
 * Prefers same-category conversion signal, falls back to the global aggregate when a category lacks
 * enough samples, and degrades to an empty hint on cold start or any DB error (never blocks generation).
 * Returns the hint text plus the top-converting style key (used to bias "auto"/smart-recommend mode).
 */
async function loadInsights(category: string): Promise<{ hint: string; topStyle: string | null }> {
  try {
    const db = getDb();
    const rows = await db.select().from(publishMetrics);
    if (rows.length === 0) return { hint: "", topStyle: null };
    const toRec = (r: (typeof rows)[number]): MetricInput => ({
      style: r.style,
      hookId: r.hookId ?? undefined,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      orders: r.orders,
    });
    const scoped = rows.filter((r) => r.category === category).map(toRec);
    const all = rows.map(toRec);
    // same-category signal first (topConvertingStyle/Hook require >=2 samples and return null otherwise),
    // then global fallback so a creator with cross-category history still gets a useful prior
    const topStyle = topConvertingStyle(scoped) ?? topConvertingStyle(all);
    const topHook = topConvertingHook(scoped) ?? topConvertingHook(all);
    const hint = buildPerformanceHint(topStyle, topHook, {
      styleLabel: (s) => styleNameMap[s as ScriptStyleType] ?? s,
      hookLabel: hookPatternName,
    });
    return { hint, topStyle: topStyle?.style ?? null };
  } catch (e) {
    // Feedback is best-effort — never let a metrics read failure break script generation
    console.warn("读取历史转化数据失败（已跳过反馈）:", e);
    return { hint: "", topStyle: null };
  }
}

// Generate commerce script
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    productImages,
    productName,
    productDescription,
    llmConfig,
  } = body;

  // Support both frontend field naming conventions: category/productCategory, targetDuration/duration
  const category = normalizeCategory(body.category ?? body.productCategory);
  // detect smart-recommend ("auto"/unset) BEFORE normalizing, so the flywheel can pick a data-driven
  // default instead of the hardcoded pain_point fallback; an explicit style is always respected
  const rawStyle = String(body.styleType ?? "").toLowerCase();
  const isAutoStyle = rawStyle === "" || rawStyle === "auto";
  let styleType = normalizeStyle(body.styleType);
  const duration = normalizeTargetVideoDuration(body.targetDuration ?? body.duration);
  // data flywheel: performance feedback is on by default; pass insightMode:false to opt out
  const useInsights = body.insightMode !== false;

  if (!productName) {
    return apiError(req, "请填写商品名称", "Please enter the product name");
  }

  if (!llmConfig?.baseUrl || !llmConfig?.apiKey || !llmConfig?.model) {
    return apiError(req, "请配置 LLM 参数（baseUrl、apiKey、model）", "Please configure the LLM parameters (baseUrl, apiKey, model)");
  }

  try {
    const primaryLLMConfig = llmConfig as LLMConfig;
    let activeLLMConfig = primaryLLMConfig;
    const fallbacks: Array<{ capability: "text" | "vision"; from: string; to: string }> = [];
    // Product image analysis: convert local paths to base64 before passing to the vision model
    let analysis = body.productAnalysis;
    if (!analysis && productImages?.length > 0 && llmConfig) {
      try {
        const imageUrls = await Promise.all(
          (productImages as string[]).map(async (imagePath) => (await toRemoteUsableImage(imagePath)) ?? imagePath)
        );
        analysis = await analyzeProduct(imageUrls, activeLLMConfig);
      } catch (e) {
        const fallback = isOpenRouterPolicyRejection(e, primaryLLMConfig.baseUrl)
          ? openRouterPolicyFallbackConfig(primaryLLMConfig, "vision")
          : null;
        if (fallback) {
          const from = primaryLLMConfig.visionModel || primaryLLMConfig.model;
          try {
            const imageUrls = await Promise.all(
              (productImages as string[]).map(async (imagePath) => (await toRemoteUsableImage(imagePath)) ?? imagePath)
            );
            analysis = await analyzeProduct(imageUrls, fallback);
            fallbacks.push({ capability: "vision", from, to: fallback.visionModel || fallback.model });
          } catch (fallbackError) {
            // Image analysis is best-effort; script generation can still use the
            // product name and selling points with the recovered model.
            console.warn("商品图片分析备用模型失败（已跳过）:", fallbackError);
          }
        } else {
          // Image analysis failure should not block script generation
          console.warn("商品图片分析失败（已跳过）:", e);
        }
      }
    }

    // Data flywheel (read side): pull the creator's real conversion feedback for this category.
    // Used two ways: (1) bias smart-recommend ("auto") mode toward the top-converting style,
    // (2) inject an advisory hint into the prompt so generated variants lean toward what sells.
    const insights = useInsights ? await loadInsights(category) : { hint: "", topStyle: null };
    if (useInsights && isAutoStyle && insights.topStyle) {
      styleType = normalizeStyle(insights.topStyle);
    }

    // Generate script (category/styleType/duration already normalized above)
    const scriptInput = {
      productName,
      category,
      productDescription,
      productAnalysis: analysis,
      styleType,
      targetDuration: duration,
      videoMode: body.videoMode,
      priceRange: body.priceRange,
      platforms: body.platforms,
      usageAdvantage: body.usageAdvantage,
      targetAudience: body.targetAudience,
      referenceStructure: body.referenceStructure,
      // ad-template creative direction (look + per-shot-type camera plan) and any other
      // caller-supplied requirements — buildUserPrompt already injects this field
      customRequirements: typeof body.customRequirements === "string" ? body.customRequirements.slice(0, 2000) : undefined,
      performanceHint: insights.hint,
      // anti-homogenization: batch rotation pins a different opening hook mechanism per video (validated against the pattern library)
      preferredHookId:
        typeof body.preferredHookId === "string" && HOOK_PATTERNS.some((p) => p.id === body.preferredHookId)
          ? body.preferredHookId
          : undefined,
      llmConfig: activeLLMConfig,
    };
    let scripts;
    try {
      scripts = await generateScript(scriptInput);
    } catch (error) {
      const fallback = isOpenRouterPolicyRejection(error, primaryLLMConfig.baseUrl)
        ? openRouterPolicyFallbackConfig(primaryLLMConfig, "text")
        : null;
      if (!fallback) throw error;
      activeLLMConfig = fallback;
      scripts = await generateScript({ ...scriptInput, llmConfig: activeLLMConfig });
      fallbacks.push({ capability: "text", from: primaryLLMConfig.model, to: activeLLMConfig.model });
    }

    // Persist: write generated scripts to the scripts table so the script/assets pages can read them by projectId
    let savedScripts = scripts;
    const projectId = body.projectId;
    if (projectId) {
      const db = getDb();
      // Refuse to overwrite a one-liner topic project with a commerce script (contentType mismatch — would delete its topic scripts)
      const proj = await db
        .select({ contentType: projects.contentType, productionMode: projects.productionMode })
        .from(projects)
        .where(eq(projects.id, projectId));
      if (proj.length > 0 && proj[0].contentType === "topic") {
        return NextResponse.json(
          { error: errText(req, "该项目是一句话主题项目，请勿用带货脚本覆盖", "This project is a one-sentence topic project — do not overwrite it with a commerce script"), projectId },
          { status: 409 }
        );
      }
      scripts = bindProductImageToLocalShots(
        scripts,
        proj[0]?.productionMode,
        Array.isArray(productImages) && productImages.length > 0
      );
      savedScripts = scripts;
      try {
        // Delete existing scripts for this project first (overwrite on regenerate)
        await db.delete(scriptsTable).where(eq(scriptsTable.projectId, projectId));
        const rows = await db
          .insert(scriptsTable)
          .values(
            scripts.map((s, i) => ({
              projectId,
              version: 1,
              styleType: (VALID_SCRIPT_STYLE.has(s.styleType) ? s.styleType : "custom") as
                | "pain_point" | "scene" | "comparison" | "story"
                | "drama" | "reversal" | "interview" | "unboxing" | "product_pov" | "talking_head"
                | "custom",
              title: s.title,
              totalDuration: s.totalDuration,
              shots: s.shots,
              // dialogue-script cast (drama style) — read back at compose time for multi-voice TTS
              ...(s.characters?.length && { characters: s.characters }),
              selected: i === 0, // select the first script set by default
            }))
          )
          .returning();
        savedScripts = rows.map((r) => ({
          id: r.id,
          title: r.title ?? "",
          styleType: r.styleType,
          totalDuration: r.totalDuration ?? 0,
          shots: r.shots ?? [],
          selected: r.selected ?? false,
        })) as typeof scripts;
        // Sync project status and analysis result
        await db
          .update(projects)
          .set({ status: "scripting", targetDuration: duration, ...(analysis && { productAnalysis: analysis }), updatedAt: new Date() })
          .where(eq(projects.id, projectId));
      } catch (e) {
        // DB write failure must surface as an error — returning 200 would let the frontend navigate away thinking it succeeded, then read empty scripts from the DB (which may already have had their old scripts deleted)
        console.error("脚本落库失败:", e);
        return NextResponse.json({ error: errText(req, "脚本落库失败，请重试", "Failed to save scripts to the database, please try again"), projectId }, { status: 500 });
      }
    }

    return NextResponse.json({
      scripts: savedScripts,
      analysis,
      ...(fallbacks.length > 0 && {
        llmFallbacks: fallbacks,
        llmFallback: {
          reason: "openrouter_provider_policy",
          from: fallbacks[fallbacks.length - 1].from,
          to: fallbacks[fallbacks.length - 1].to,
        },
      }),
    });
  } catch (error) {
    console.error("脚本生成失败:", error);
    // LLM failures carry an actionable bilingual message (bad key / dead free endpoint / rate limit)
    const { zh, en } = llmErrorPair(error);
    return apiError(
      req,
      `脚本生成失败: ${zh}`,
      `Script generation failed: ${en}`,
      500
    );
  }
}

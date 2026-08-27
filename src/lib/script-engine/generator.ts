/**
 * Script generator
 * Calls an LLM in OpenAI-compatible format to generate e-commerce short-video scripts.
 * Supports custom LLM endpoints, streaming output, and product image analysis.
 */

import OpenAI from "openai";
import {
  SYSTEM_PROMPT,
  PRODUCT_ANALYSIS_PROMPT,
  TOPIC_SYSTEM_PROMPT,
  buildUserPrompt,
  buildBatchPrompt,
  buildTopicBatchPrompt,
  type ScriptGenerationInput,
  type TopicScriptInput,
} from "./prompts";
import type { Shot, ScriptCharacter } from "@/lib/db/schema";
import { createLLMClient, withLLMErrors, LLMRequestError, jsonModeParams } from "@/lib/llm-error";
import { stripThinkBlocks } from "@/lib/llm-clean";

// ==================== Type definitions ====================

/** LLM configuration */
export interface LLMConfig {
  /** API base URL (any OpenAI-compatible endpoint) */
  baseUrl: string;
  /** API key */
  apiKey: string;
  /** Text model name */
  model: string;
  /** Vision model name (used for product image analysis; falls back to model if not specified) */
  visionModel?: string;
}

/** Script generation input parameters */
export interface ScriptInput extends ScriptGenerationInput {
  /** LLM configuration */
  llmConfig: LLMConfig;
}

/** Generated script result */
export interface GeneratedScript {
  /** Script title */
  title: string;
  /** Script style */
  styleType: string;
  /** Total duration (seconds) */
  totalDuration: number;
  /** Shot list */
  shots: Shot[];
  /** Dialogue-script cast (drama style) — drives multi-voice TTS + visual-anchor prompts */
  characters?: ScriptCharacter[];
}

/** Streaming output callbacks */
export interface StreamCallbacks {
  /** Fired when a text token is received */
  onToken?: (token: string) => void;
  /** Fired when generation is complete */
  onComplete?: (scripts: GeneratedScript[]) => void;
  /** Fired when an error occurs */
  onError?: (error: Error) => void;
}

/** Product analysis result */
export interface ProductAnalysisResult {
  /** Product name */
  productName: string;
  /** Category */
  category: string;
  /** Brand */
  brand: string;
  /** Visual characteristics */
  visualFeatures: {
    mainColor: string;
    designStyle: string;
    productForm: string;
    texture: string;
  };
  /** List of selling points */
  sellingPoints: string[];
  /** Target audience */
  targetAudience: string;
  /** Usage scenarios */
  usageScenarios: string[];
  /** Pain points */
  painPoints: string[];
  /** Video suggestions */
  videoSuggestions: {
    recommendedAngles: string[];
    keyVisuals: string[];
    suggestedStyle: string;
  };
}

// ==================== Utility functions ====================

/** Create an OpenAI client (shared factory: SDK retries + free-pool 402 retry, see lib/llm-error) */
function createClient(config: LLMConfig): OpenAI {
  return createLLMClient(config);
}

/**
 * Extra request params that tame reasoning/thinking models per endpoint.
 *
 * - Pollinations: its only keyless (anonymous-tier) model is a reasoning model (GPT-OSS 20B) with a
 *   small output-token cap: on our large generation prompts it exhausts the entire budget on its
 *   reasoning trace and returns EMPTY content (finish_reason "length"). reasoning_effort:"low"
 *   makes it think minimally and actually emit the JSON.
 * - DashScope / SiliconFlow (Qwen3-family hybrids): `enable_thinking: false` turns the trace off at
 *   the source, so no <think> text can reach the JSON parser at all.
 * - Zhipu bigmodel.cn (GLM hybrids): same idea via their `thinking: {type:"disabled"}` shape.
 *
 * Scoped by baseUrl on purpose — real OpenAI 400s on params it doesn't know
 * (unsupported_parameter), so none of these may be sent globally. If a listed endpoint still
 * rejects the field for a specific model, optionalParamRetryFetch (llm-error.ts) replays without
 * it. Response-side stripThinkBlocks remains the catch-all for endpoints not listed here.
 */
export function reasoningParams(
  baseUrl: string,
): { reasoning_effort?: "low"; enable_thinking?: boolean; thinking?: { type: "disabled" } } {
  const url = baseUrl || "";
  if (/pollinations\.ai/i.test(url)) return { reasoning_effort: "low" };
  if (/dashscope|siliconflow/i.test(url)) return { enable_thinking: false };
  if (/bigmodel\.cn/i.test(url)) return { thinking: { type: "disabled" } };
  return {};
}

/**
 * How many script variants to request in one batch call.
 * Pollinations' anonymous tier caps output tokens low: 3 full commerce scripts (~7500 chars) overflow
 * that cap and truncate to invalid JSON, so keyless generation would fail entirely. Request a single
 * complete script instead — one valid script beats three truncated ones, and the user can regenerate
 * for more variants. Other endpoints keep the requested batch size. Scoped to Pollinations by baseUrl.
 */
export function batchCountFor(baseUrl: string, requested = 3): number {
  return /pollinations\.ai/i.test(baseUrl || "") ? 1 : requested;
}

/**
 * Extract JSON from LLM output text.
 * Handles raw JSON, JSON wrapped in a markdown code block, and reasoning-model output where the
 * JSON follows a <think>…</think> trace (the trace itself often contains braces/fences, so it
 * must be removed before any pattern matching).
 */
export function extractJSON(text: string): string {
  text = stripThinkBlocks(text);
  // Try stripping markdown code block markers
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try finding the first { or [ to locate the JSON
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  return text.trim();
}

/**
 * Append an actionable hint to "JSON parse failed" errors when the output looks truncated.
 * Detect truncation by unbalanced brackets (more opens than closes) rather than "doesn't end with }/]":
 * the greedy extractJSON can leave a trailing } from an interior object (e.g. a completed earlier shot),
 * which fooled the old ends-with check into missing the truncation. Covers both the max_tokens case and
 * free endpoints with a low output cap (e.g. Pollinations) where a long script is cut off.
 */
function truncationHint(jsonStr: string): string {
  if (!/^[{[]/.test(jsonStr)) return "";
  const opens = (jsonStr.match(/[{[]/g) ?? []).length;
  const closes = (jsonStr.match(/[}\]]/g) ?? []).length;
  return opens > closes
    ? "（输出疑似被截断：请缩短目标时长/减少分镜，或增大 max_tokens、换用输出更充裕的模型后重试）"
    : "";
}

/**
 * Validate and correct a single Shot object.
 * Ensures all required fields have valid values.
 */
/**
 * Strip markup the TTS would otherwise read aloud: markdown emphasis/backticks (keeps the inner
 * text), leading list markers and headers, and leading stage-direction tags like 【开场】/[hook].
 * Only structural markup is removed — real copy (parentheses, quotes, prices) passes untouched.
 * A voiceover of "*超值*" reaching TTS as "星号超值星号" is an audible defect. Exported for tests.
 */
export function sanitizeVoiceover(text: string): string {
  const cleaned = (text || "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1") // **bold** / *em* → inner text
    .replace(/`+([^`]*)`+/g, "$1") // `code` → inner text
    .replace(/^\s{0,3}#{1,4}\s+/gm, "") // markdown headers
    .replace(/^\s*(?:[-•]|\d+[.、])\s+/gm, "") // list markers
    .replace(/^\s*(?:【[^】]{1,8}】|\[[^\]]{1,12}\])\s*/, "") // leading stage tag 【开场】/[hook]
    .replace(/\s+/g, " ")
    .trim();
  // never sanitize a line into nothing — an empty voiceover downstream means a silent shot
  return cleaned || (text || "").trim();
}

function validateShot(shot: Partial<Shot>, index: number): Shot {
  const validTypes: Shot["type"][] = ["hook", "pain_point", "product_reveal", "demo", "social_proof", "cta"];
  const validTransitions: Shot["transition"][] = ["ai_start_end", "ai_reference", "direct_concat", "ffmpeg_fade"];
  const validSources: Shot["visualSource"][] = ["ai_generate", "product_image", "user_upload"];

  const validMotions: NonNullable<Shot["motion"]>[] = ["zoom_in_slow", "pan_left", "pan_right", "ken_burns", "static"];

  // Parse LLM-generated English stock-search terms (field name searchTerms or stockKeywords), keep first 3 non-empty strings
  const rawTerms = (shot as Record<string, unknown>).searchTerms ?? shot.stockKeywords;
  const stockKeywords = Array.isArray(rawTerms)
    ? rawTerms.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim()).slice(0, 3)
    : undefined;

  return {
    shotId: shot.shotId || index + 1,
    type: validTypes.includes(shot.type as Shot["type"]) ? (shot.type as Shot["type"]) : "demo",
    duration: typeof shot.duration === "number" && shot.duration > 0 ? shot.duration : 3,
    description: shot.description || "",
    camera: shot.camera || "固定镜头",
    visualSource: validSources.includes(shot.visualSource as Shot["visualSource"]) ? (shot.visualSource as Shot["visualSource"]) : "ai_generate",
    // Default transition matches the schema (videoClips.transitionType) and UI default (ai_start_end)
    transition: validTransitions.includes(shot.transition as Shot["transition"]) ? (shot.transition as Shot["transition"]) : "ai_start_end",
    voiceover: sanitizeVoiceover(shot.voiceover || ""),
    prompt: shot.prompt || undefined,
    // Pass through LLM-generated extended fields (video mode) so they are not silently dropped
    ...(stockKeywords?.length && { stockKeywords }),
    ...(shot.characterId && { characterId: shot.characterId }),
    ...(validMotions.includes(shot.motion as NonNullable<Shot["motion"]>) && { motion: shot.motion }),
    ...(shot.textOverlay?.text && {
      textOverlay: {
        text: shot.textOverlay.text,
        style: shot.textOverlay.style ?? "subtitle",
      },
    }),
  };
}

/**
 * Validate the dialogue-script cast (drama style). Drops malformed entries instead of failing the
 * whole script; caps at 4 (the style asks for 2 — a runaway cast would break voice assignment).
 */
export function validateCharacters(raw: unknown): ScriptCharacter[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ScriptCharacter[] = [];
  for (const c of raw as Partial<ScriptCharacter>[]) {
    if (!c || typeof c !== "object") continue;
    const id = typeof c.id === "string" ? c.id.trim() : "";
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (!id || !name) continue;
    out.push({
      id,
      name,
      gender: c.gender === "male" ? "male" : "female",
      ...(typeof c.persona === "string" && c.persona.trim() && { persona: c.persona.trim() }),
      ...(typeof c.appearance === "string" && c.appearance.trim() && { appearance: c.appearance.trim() }),
    });
    if (out.length >= 4) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Validate and correct a complete script object.
 */
function validateScript(raw: Record<string, unknown>, fallbackStyleType: string): GeneratedScript {
  const shots = Array.isArray(raw.shots)
    ? (raw.shots as Partial<Shot>[]).map((s, i) => validateShot(s, i))
    : [];

  const totalDuration = typeof raw.totalDuration === "number"
    ? raw.totalDuration
    : shots.reduce((sum, s) => sum + s.duration, 0);

  const characters = validateCharacters(raw.characters);

  return {
    title: (raw.title as string) || "未命名脚本",
    styleType: (raw.styleType as string) || fallbackStyleType,
    totalDuration,
    shots,
    ...(characters && { characters }),
  };
}

// ==================== Core functionality ====================

/**
 * Non-streaming chat call with ONE parse-driven retry ("repair first, then re-ask" — the last
 * rung of the JSON-robustness ladder): when the reply survives transport but fails to parse — bad JSON,
 * missing shots — the model gets its own output back plus the parse error and one chance to fix
 * it. Network/HTTP retries stay inside the SDK client; LLMRequestError parse failures are
 * capability verdicts ("this model can't write scripts"), not format slips, so they never retry.
 * Exported for reuse by other JSON-shaped call sites (judge panel).
 */
export async function completeWithJsonRetry<T>(
  client: OpenAI,
  params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, "stream">,
  cfg: { baseUrl?: string; apiKey?: string; model?: string },
  parse: (content: string) => T,
): Promise<T> {
  let messages = params.messages;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await withLLMErrors(
      () => client.chat.completions.create({ ...params, messages }),
      cfg,
    );
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("LLM 未返回有效内容");
    try {
      return parse(content);
    } catch (err) {
      if (err instanceof LLMRequestError) throw err;
      lastErr = err;
      if (attempt === 0) {
        const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        messages = [
          ...messages,
          { role: "assistant", content },
          {
            role: "user",
            content: `你上一次的输出无法解析（错误：${detail}）。请严格按之前的要求重新输出完整、合法的 JSON，只输出 JSON 本身，禁止任何解释文字或 markdown 代码块。`,
          },
        ];
      }
    }
  }
  throw lastErr;
}

/**
 * Generate e-commerce scripts (single call, returns complete result).
 * @param input - Script generation input parameters
 * @returns Array of generated scripts
 */
export async function generateScript(input: ScriptInput): Promise<GeneratedScript[]> {
  const client = createClient(input.llmConfig);
  const userPrompt = buildBatchPrompt(input, batchCountFor(input.llmConfig.baseUrl));

  // Transient free-endpoint failures retry inside the client; unparseable replies retry once with
  // the parse error echoed back. json_object mode is safe here: the batch prompt's top level is
  // an object ({"scripts": [...]}).
  return completeWithJsonRetry(
    client,
    {
      model: input.llmConfig.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 16000,
      ...reasoningParams(input.llmConfig.baseUrl),
      ...jsonModeParams(input.llmConfig.baseUrl),
    },
    input.llmConfig,
    (content) => parseScriptResponse(content, input.styleType),
  );
}

/** Topic-based script generation input (one-sentence topic + LLM config) */
export interface TopicScriptGenInput extends TopicScriptInput {
  llmConfig: LLMConfig;
  /** Number of variants to generate, defaults to 3 */
  count?: number;
}

/**
 * Generate "one-sentence topic" scripts (product-free; each shot includes English search terms for automatic media matching).
 * @param input - Topic + LLM config
 * @returns Array of generated scripts (includes stockKeywords, ready to feed directly into stock-fill for media matching)
 */
export async function generateTopicScript(input: TopicScriptGenInput): Promise<GeneratedScript[]> {
  const client = createClient(input.llmConfig);
  const userPrompt = buildTopicBatchPrompt(input, batchCountFor(input.llmConfig.baseUrl, input.count ?? 3));

  // Topic-based videos have no e-commerce style concept; fall back uniformly to "custom"
  return completeWithJsonRetry(
    client,
    {
      model: input.llmConfig.model,
      messages: [
        { role: "system", content: TOPIC_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.85,
      max_tokens: 16000,
      ...reasoningParams(input.llmConfig.baseUrl),
      ...jsonModeParams(input.llmConfig.baseUrl),
    },
    input.llmConfig,
    (content) => parseScriptResponse(content, "custom"),
  );
}

/**
 * Generate a single script (faster response).
 * @param input - Script generation input parameters
 * @returns A single generated script
 */
export async function generateSingleScript(input: ScriptInput): Promise<GeneratedScript> {
  const client = createClient(input.llmConfig);
  const userPrompt = buildUserPrompt(input);

  return completeWithJsonRetry(
    client,
    {
      model: input.llmConfig.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      ...reasoningParams(input.llmConfig.baseUrl),
      ...jsonModeParams(input.llmConfig.baseUrl),
    },
    input.llmConfig,
    (content) => {
      const jsonStr = extractJSON(content);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        throw new Error(`LLM 返回的内容不是合法 JSON${truncationHint(jsonStr)}: ${jsonStr.substring(0, 200)}`);
      }
      return validateScript(parsed, input.styleType);
    },
  );
}

/**
 * Generate a script with streaming output.
 * Supports real-time progress updates; suitable for frontend streaming display.
 * @param input - Script generation input parameters
 * @param callbacks - Streaming callback functions
 * @returns AbortController for cancelling generation
 */
export function generateScriptStream(
  input: ScriptInput,
  callbacks: StreamCallbacks,
): AbortController {
  const abortController = new AbortController();

  const run = async () => {
    const client = createClient(input.llmConfig);
    const userPrompt = buildUserPrompt(input);

    let fullContent = "";

    try {
      const stream = await withLLMErrors(
        () =>
          client.chat.completions.create({
            model: input.llmConfig.model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.8,
            stream: true,
            ...reasoningParams(input.llmConfig.baseUrl),
          }, {
            signal: abortController.signal,
          }),
        input.llmConfig,
      );

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          callbacks.onToken?.(delta);
        }
      }

      // Parse the complete result after streaming finishes
      const scripts = parseScriptResponse(fullContent, input.styleType);
      callbacks.onComplete?.(scripts);
    } catch (error) {
      // User-initiated cancellation is not an error
      if (abortController.signal.aborted) return;
      callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  run();
  return abortController;
}

/**
 * Create a ReadableStream for streaming script generation.
 * Used for streaming responses in Next.js API routes.
 * @param input - Script generation input parameters
 * @returns ReadableStream
 */
export function createScriptStream(input: ScriptInput): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const client = createClient(input.llmConfig);
      const userPrompt = buildUserPrompt(input);

      try {
        const stream = await withLLMErrors(
          () =>
            client.chat.completions.create({
              model: input.llmConfig.model,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
              ],
              temperature: 0.8,
              stream: true,
              ...reasoningParams(input.llmConfig.baseUrl),
            }),
          input.llmConfig,
        );

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            controller.enqueue(encoder.encode(delta));
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

// ==================== Product image analysis ====================

/**
 * Analyse product images.
 * Calls the vision model to extract product information, selling points, target audience, etc.
 * @param imageUrls - List of product image URLs (http/https or base64 data URIs)
 * @param config - LLM configuration
 * @returns Product analysis result as a JSON string
 */
export async function analyzeProduct(
  imageUrls: string[],
  config: LLMConfig,
): Promise<string> {
  const client = createClient(config);
  const model = config.visionModel || config.model;

  // Build message content with images
  const imageContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = imageUrls.map(
    (url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "high" as const },
    }),
  );

  const response = await withLLMErrors(
    () =>
      client.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PRODUCT_ANALYSIS_PROMPT },
              ...imageContent,
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    { ...config, model },
  );

  return response.choices[0]?.message?.content || "";
}

/**
 * Analyse product images and return structured data.
 * @param imageUrls - List of product image URLs
 * @param config - LLM configuration
 * @returns Structured product analysis result
 */
/** Max characters per selling point (a point longer than this is a paragraph, not a hook). */
const SELLING_POINT_MAX_CHARS = 15;
/** Max selling points kept (a script can only land ~3 points in 15-30s; more dilutes all of them). */
const SELLING_POINT_MAX_COUNT = 3;

/**
 * Enforce the selling-point hard constraints server-side (the prompt asks for ≤15 chars /
 * one dimension each, but models drift): keep the first 3 non-empty points, truncated.
 * Enforcement here means every consumer (script prompt, judge, film prompt) sees tight
 * points regardless of model discipline.
 */
export function clampSellingPoints(points: unknown): string[] {
  if (!Array.isArray(points)) return [];
  return points
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim().slice(0, SELLING_POINT_MAX_CHARS))
    .slice(0, SELLING_POINT_MAX_COUNT);
}

export async function analyzeProductStructured(
  imageUrls: string[],
  config: LLMConfig,
): Promise<ProductAnalysisResult> {
  const rawResult = await analyzeProduct(imageUrls, config);
  const jsonStr = extractJSON(rawResult);
  try {
    const parsed = JSON.parse(jsonStr) as ProductAnalysisResult;
    parsed.sellingPoints = clampSellingPoints(parsed.sellingPoints);
    return parsed;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`商品分析结果不是合法 JSON${truncationHint(jsonStr)}: ${jsonStr.substring(0, 200)}`);
    }
    throw e;
  }
}

// ==================== Parsing utilities ====================

/**
 * True when a voiceover line is actual copy rather than our own JSON template echoed back.
 *
 * Weak models (verified with qwen2.5:0.5b on Ollama) answer with the schema's field descriptions
 * copied verbatim — "配音文案：口语化的播音文案，控制字数与duration匹配（约3字/秒）" as the voiceover.
 * The markers below are strings this project writes into the prompt, so matching them is exact, not a
 * quality heuristic: no real script line contains them.
 */
export function isRealVoiceover(voiceover: string): boolean {
  const text = voiceover.trim();
  if (text.length === 0) return false;
  return !/口语化的播音文案|控制字数与duration|画面描述：要足够具体|从下方运镜词表|英文AI生图|english keyword/i.test(text);
}

/**
 * Parse LLM script response content.
 * Handles multiple return formats (single object, array, nested object, etc.)
 */
export function parseScriptResponse(content: string, fallbackStyleType: string): GeneratedScript[] {
  const jsonStr = extractJSON(content);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`LLM 返回的内容不是合法 JSON${truncationHint(jsonStr)}: ${jsonStr.substring(0, 200)}`);
  }

  // Handle different return formats
  let rawScripts: Record<string, unknown>[];

  if (Array.isArray(parsed)) {
    // direct array
    rawScripts = parsed;
  } else if (parsed.scripts && Array.isArray(parsed.scripts)) {
    // { scripts: [...] } format
    rawScripts = parsed.scripts;
  } else if (parsed.shots && Array.isArray(parsed.shots)) {
    // single script object
    rawScripts = [parsed];
  } else {
    throw new Error("无法解析 LLM 返回的脚本格式");
  }

  // Discard scripts with no shots (LLM occasionally returns entries with only a title and no shots);
  // if all are empty, throw — otherwise a "zero-shot script" would be saved as a success and downstream
  // compositing / rendering would have nothing to work with, yet would not report an error.
  // Filter out null/non-object elements first: LLM occasionally emits [null, {...}], and validateScript
  // reads raw.shots on its first line, which throws on null and corrupts the entire parse.
  const scripts = rawScripts
    .filter((raw): raw is Record<string, unknown> => typeof raw === "object" && raw !== null)
    .map((raw) => validateScript(raw, fallbackStyleType))
    .filter((s) => s.shots.length > 0);
  if (scripts.length === 0) {
    throw new Error("LLM 未生成有效分镜（脚本为空），请重试或调整输入");
  }

  // Same reasoning one step further: a script whose shots carry no voiceover at all renders as a
  // silent video with no captions, yet every stage downstream would report success. Weak local models
  // fail exactly this way — correct JSON shape, empty content (verified with qwen2.5:0.5b on Ollama,
  // issue #19 follow-up). Fail loudly and name the fix instead of handing back an unusable script.
  const withVoiceover = scripts.filter((s) => s.shots.some((shot) => isRealVoiceover(shot.voiceover)));
  if (withVoiceover.length === 0) {
    throw new LLMRequestError(
      "这个模型没写出真正的口播文案（分镜里的 voiceover 要么是空的，要么把格式说明原样抄了回来，成片会没有声音也没有字幕）：多为模型能力不足，请换一个更强的模型——本地 Ollama 建议用 7B 及以上的 instruct 模型（实测 qwen2.5:7b-instruct 可用），0.5B/1.5B 这类小模型写不出结构化脚本",
      "The model produced no real voiceover lines (they are empty, or it echoed the format description back): the video would be silent and caption-less. This usually means the model is too weak — switch to a stronger one. For local Ollama use a 7B-or-larger instruct model (qwen2.5:7b-instruct is verified working); 0.5B/1.5B models cannot produce a structured script",
    );
  }
  return withVoiceover;
}

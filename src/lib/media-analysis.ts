import type OpenAI from "openai";
import type { LLMConfig } from "@/lib/script-engine/generator";
import { extractJSON } from "@/lib/script-engine/generator";
import { createLLMClient, jsonModeParams, withLLMErrors } from "@/lib/llm-error";

export interface MediaAnalysisResult {
  mediaType: "image" | "video";
  summary: string;
  subjects: string[];
  visualStyle: {
    lighting: string;
    palette: string;
    composition: string;
    camera: string;
  };
  motion?: {
    pacing: string;
    cameraMoves: string[];
    sceneRhythm: string;
  };
  reusablePrompt: string;
  negativePrompt: string;
  suggestedUses: string[];
}

const MAX_TEXT = 600;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : fallback;
}

function textList(value: unknown, max = 8): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 120))
      .slice(0, max)
    : [];
}

/** Clamp drifting vision-model JSON into a stable, safe response contract. */
export function parseMediaAnalysis(raw: string, mediaType: "image" | "video"): MediaAnalysisResult {
  const parsed = JSON.parse(extractJSON(raw)) as Record<string, unknown>;
  const style = typeof parsed.visualStyle === "object" && parsed.visualStyle
    ? parsed.visualStyle as Record<string, unknown>
    : {};
  const motionRaw = typeof parsed.motion === "object" && parsed.motion
    ? parsed.motion as Record<string, unknown>
    : {};
  const result: MediaAnalysisResult = {
    mediaType,
    summary: text(parsed.summary),
    subjects: textList(parsed.subjects),
    visualStyle: {
      lighting: text(style.lighting),
      palette: text(style.palette),
      composition: text(style.composition),
      camera: text(style.camera),
    },
    reusablePrompt: text(parsed.reusablePrompt),
    negativePrompt: text(parsed.negativePrompt),
    suggestedUses: textList(parsed.suggestedUses, 5),
  };
  if (mediaType === "video") {
    result.motion = {
      pacing: text(motionRaw.pacing),
      cameraMoves: textList(motionRaw.cameraMoves, 8),
      sceneRhythm: text(motionRaw.sceneRhythm),
    };
  }
  return result;
}

function analysisPrompt(mediaType: "image" | "video", locale: "zh" | "en", sampleContext?: string): string {
  const language = locale === "en" ? "English" : "简体中文";
  return `You are a senior commercial video art director. Analyze the supplied ${mediaType} visual${mediaType === "video" ? " contact sheet" : ""} and return ONLY one JSON object. Write all values in ${language}.
${sampleContext ? `Sampling context: ${sampleContext}` : ""}
Do not identify real people. Describe observable visual facts, production techniques, and reusable creative direction.
JSON schema:
{
  "summary": "concise content and creative-intent description",
  "subjects": ["main subject or object"],
  "visualStyle": {
    "lighting": "light direction, quality and contrast",
    "palette": "dominant colors and color relationship",
    "composition": "framing, depth and visual hierarchy",
    "camera": "shot size, lens feel and viewpoint"
  },
  "motion": {
    "pacing": "video pace; empty string for an image",
    "cameraMoves": ["observable or strongly implied movement"],
    "sceneRhythm": "cut rhythm and progression; empty string for an image"
  },
  "reusablePrompt": "a production-ready generation prompt that recreates the visual language without copying names, logos, text or identity",
  "negativePrompt": "failures and artifacts to avoid",
  "suggestedUses": ["specific downstream creation use"]
}`;
}

/** Analyze one image or a scene-aware contact sheet through the configured OpenAI-compatible vision model. */
export async function analyzeVisualMedia(input: {
  imageDataUrl: string;
  mediaType: "image" | "video";
  locale: "zh" | "en";
  config: LLMConfig;
  sampleContext?: string;
}): Promise<MediaAnalysisResult> {
  const model = input.config.visionModel || input.config.model;
  const client = createLLMClient({ ...input.config, model });
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: analysisPrompt(input.mediaType, input.locale, input.sampleContext) },
    { type: "image_url", image_url: { url: input.imageDataUrl, detail: "high" } },
  ];
  const response = await withLLMErrors(
    () => client.chat.completions.create({
      model,
      messages: [{ role: "user", content }],
      temperature: 0.2,
      max_tokens: 2500,
      ...jsonModeParams(input.config.baseUrl),
    }),
    { ...input.config, model },
  );
  return parseMediaAnalysis(response.choices[0]?.message?.content || "", input.mediaType);
}

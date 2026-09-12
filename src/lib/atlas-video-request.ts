import type { AtlasInputSchema, AtlasSchemaProperty } from "@/lib/atlas-video-catalog";
import type { AtlasVideoMode } from "@/lib/atlas-video-models";
import type { VideoOptions } from "@/lib/providers/types";

function propertyName(schema: AtlasInputSchema, candidates: string[]): string | undefined {
  return candidates.find((candidate) => candidate in schema.properties);
}

function enumValue(property: AtlasSchemaProperty, requested: string | number | undefined): unknown {
  const values = property.enum ?? [];
  if (requested != null) {
    const exact = values.find((value) => String(value).toLowerCase() === String(requested).toLowerCase());
    if (exact !== undefined) return exact;
    if (!values.length) return requested;
  }
  return property.default ?? property.examples?.[0] ?? values[0];
}

function nearestNumber(property: AtlasSchemaProperty, requested: number | undefined): unknown {
  const values = (property.enum ?? []).filter((value): value is number => typeof value === "number");
  if (requested != null && values.length) {
    return values.reduce((best, value) => Math.abs(value - requested) < Math.abs(best - requested) ? value : best, values[0]);
  }
  return requested ?? property.default ?? property.examples?.[0] ?? values[0];
}

function ratioFor(options: VideoOptions): string {
  if (!options.width || !options.height) return "adaptive";
  if (options.width === options.height) return "1:1";
  return options.width > options.height ? "16:9" : "9:16";
}

function sizeFor(options: VideoOptions): string | undefined {
  if (!options.width || !options.height) return undefined;
  return `${options.width}*${options.height}`;
}

function requestedResolution(options: VideoOptions): string | undefined {
  const longEdge = Math.max(options.width ?? 0, options.height ?? 0);
  if (!longEdge) return undefined;
  return longEdge >= 1800 ? "1080p" : "720p";
}

function resolutionRank(value: unknown): number {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "2k") return 1440;
  if (normalized === "4k") return 2160;
  const numeric = Number.parseInt(normalized, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function resolutionValue(property: AtlasSchemaProperty, requested: string | undefined): unknown {
  const exact = enumValue(property, requested);
  if (requested == null || !property.enum?.length || String(exact).toLowerCase() === requested.toLowerCase()) return exact;
  if (property.enum.every((value) => resolutionRank(value) === 0)) {
    return enumValue(property, undefined);
  }
  // Upscaled/enhanced tiers are separately billed products. A stable 1080p quality
  // preference must never opt into 1080p-sr/esr merely because native 1080p is absent.
  // An advanced caller can still request one explicitly through options.extra.resolution,
  // which is applied after this provider-safe default mapping.
  const nativeValues = property.enum.filter((value) => !/(?:^|[-\s])e?sr(?:\b|\s*&)|\bfps\b/i.test(String(value)));
  if (!nativeValues.length) return enumValue(property, undefined);
  const target = resolutionRank(requested);
  const ranked = [...nativeValues].sort((a, b) => resolutionRank(a) - resolutionRank(b));
  return ranked.find((value) => resolutionRank(value) >= target) ?? ranked[ranked.length - 1];
}

function setIfSupported(
  body: Record<string, unknown>,
  schema: AtlasInputSchema,
  candidates: string[],
  value: unknown,
): string | undefined {
  if (value == null) return undefined;
  const key = propertyName(schema, candidates);
  if (key) body[key] = value;
  return key;
}

/** Translate Mora's stable video contract into the exact fields published by an Atlas model schema. */
export function buildAtlasSchemaRequest(
  modelId: string,
  mode: AtlasVideoMode,
  options: VideoOptions,
  schema: AtlasInputSchema,
): Record<string, unknown> {
  const body: Record<string, unknown> = { model: modelId };
  setIfSupported(body, schema, ["prompt", "user_prompt", "text"], options.prompt);
  setIfSupported(body, schema, ["negative_prompt"], options.negativePrompt);
  setIfSupported(body, schema, ["seed"], options.seed);
  setIfSupported(body, schema, ["fps", "frame_rate"], options.fps);
  setIfSupported(body, schema, ["guidance_scale", "cfg_scale"], options.guidanceScale);
  setIfSupported(body, schema, ["motion_strength"], options.motionStrength);

  const durationKey = propertyName(schema, ["duration", "seconds"]);
  if (durationKey) body[durationKey] = nearestNumber(schema.properties[durationKey], options.duration);

  const resolutionKey = propertyName(schema, ["resolution", "target_resolution"]);
  if (resolutionKey) body[resolutionKey] = resolutionValue(schema.properties[resolutionKey], requestedResolution(options));

  const ratio = ratioFor(options);
  const ratioKey = propertyName(schema, ["ratio", "aspect_ratio"]);
  if (ratioKey) body[ratioKey] = enumValue(schema.properties[ratioKey], ratio);

  const sizeKey = propertyName(schema, ["size"]);
  if (sizeKey) body[sizeKey] = enumValue(schema.properties[sizeKey], sizeFor(options));

  const audioKey = propertyName(schema, ["generate_audio", "audio_enabled"]);
  if (audioKey && schema.properties[audioKey].type === "boolean" && options.audioEnabled != null) {
    body[audioKey] = options.audioEnabled;
  }

  const references = [
    ...(options.referenceImageUrls ?? []),
    ...(options.referenceVideoUrls ?? []),
    ...(options.referenceVideoUrl ? [options.referenceVideoUrl] : []),
    ...(options.referenceAudioUrls ?? []),
  ];

  if (mode === "image-to-video") {
    setIfSupported(body, schema, ["image", "image_url", "first_frame", "first_frame_url", "start_image", "start_image_url", "product_image"], options.firstFrameUrl);
    setIfSupported(body, schema, ["end_image", "last_image", "last_frame", "last_frame_url", "end_frame", "end_frame_url"], options.lastFrameUrl);
  } else if (mode === "reference-to-video") {
    const imageReferences = [...(options.referenceImageUrls ?? [])];
    if (options.firstFrameUrl) imageReferences.unshift(options.firstFrameUrl);
    const videoReferences = [
      ...(options.referenceVideoUrls ?? []),
      ...(options.referenceVideoUrl ? [options.referenceVideoUrl] : []),
    ];
    const uniqueImages = [...new Set(imageReferences)];
    const uniqueVideos = [...new Set(videoReferences)];
    const uniqueAudios = [...new Set(options.referenceAudioUrls ?? [])];
    if (uniqueImages.length) setIfSupported(body, schema, ["reference_images", "images"], uniqueImages);
    if (uniqueVideos.length) setIfSupported(body, schema, ["reference_videos", "videos"], uniqueVideos);
    if (uniqueAudios.length) setIfSupported(body, schema, ["reference_audios", "audios"], uniqueAudios);
    setIfSupported(body, schema, ["reference_image", "image", "image_url"], imageReferences[0]);
    setIfSupported(body, schema, ["video", "video_url", "input_video"], videoReferences[0]);
    setIfSupported(body, schema, ["audio", "audio_url", "input_audio"], uniqueAudios[0]);
    const allReferences = [...new Set([options.firstFrameUrl, ...references].filter((value): value is string => Boolean(value)))];
    if (allReferences.length) setIfSupported(body, schema, ["refers", "references"], allReferences.map((url) => ({ url })));
  }

  const extra = options.extra ?? {};
  for (const [key, value] of Object.entries(extra)) {
    if (key in schema.properties && value !== undefined) body[key] = value;
  }

  for (const key of schema.required) {
    if (body[key] !== undefined) continue;
    const fallback = enumValue(schema.properties[key] ?? {}, undefined);
    if (fallback !== undefined) body[key] = fallback;
  }
  const missing = schema.required.filter((key) => body[key] === undefined || body[key] === "" || (Array.isArray(body[key]) && body[key].length === 0));
  if (missing.length) {
    throw new Error(`任务输入无法满足模型 ${modelId} 的必填参数：${missing.join(", ")}`);
  }
  return body;
}

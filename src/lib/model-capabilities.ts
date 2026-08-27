import type { GenAspectRatio, GenResolution } from "@/lib/gen-params";
import { modelSupportsLastFrame } from "@/lib/video-composer/transitions";

export type CapabilityConfidence = "known" | "inferred" | "unknown";

export interface VideoModelCapabilities {
  confidence: CapabilityConfidence;
  textToVideo: boolean | null;
  imageToVideo: boolean | null;
  referenceVideo: boolean | null;
  lastFrame: boolean | null;
  nativeAudio: boolean | null;
  durationValues?: number[];
  resolutionValues?: string[];
  aspectRatioValues?: string[];
  maxReferenceImages?: number;
}

export interface PreflightAdjustment {
  field: "duration" | "resolution" | "aspectRatio" | "chainMode";
  requested: string | number;
  effective: string | number;
  code: "nearest-duration" | "mapped-resolution" | "adaptive-ratio" | "unsupported-last-frame";
}

export interface VideoGenerationPreflight {
  capabilities: VideoModelCapabilities;
  adjustments: PreflightAdjustment[];
  warnings: Array<"capabilities-unknown" | "native-audio-unavailable" | "reference-images-trimmed">;
}

function inferredModes(modelId: string): Pick<VideoModelCapabilities, "textToVideo" | "imageToVideo" | "referenceVideo"> {
  const id = modelId.toLowerCase();
  const explicit = /(?:text-to-video|\/t2v(?:-|$))/.test(id)
    ? "text"
    : /(?:image-to-video|\/i2v(?:-|$)|start-end-to-video)/.test(id)
      ? "image"
      : /reference-to-video/.test(id)
        ? "reference"
        : null;
  if (!explicit) return { textToVideo: null, imageToVideo: null, referenceVideo: null };
  return {
    textToVideo: explicit === "text",
    imageToVideo: explicit === "image",
    referenceVideo: explicit === "reference",
  };
}

/** Normalize provider-specific video metadata into one UI-facing capability contract. */
export function getVideoModelCapabilities(modelId: string, supportsAudio?: boolean): VideoModelCapabilities {
  const modes = inferredModes(modelId);
  const hasInference = Object.values(modes).some((value) => value !== null);
  return {
    confidence: hasInference || supportsAudio !== undefined ? "inferred" : "unknown",
    ...modes,
    // An allowlist hit proves support; a miss on an unknown/custom model proves nothing.
    lastFrame: modelId && modelSupportsLastFrame(modelId) ? true : null,
    nativeAudio: supportsAudio ?? null,
  };
}

/**
 * Preview the exact compatibility mapping already performed by the provider adapter.
 * Unknown custom models stay permissive: they receive one informational warning and no blocking rewrite.
 */
export function preflightVideoGeneration(input: {
  modelId: string;
  supportsAudio?: boolean;
  duration?: number;
  resolution: GenResolution;
  aspectRatio: GenAspectRatio;
  chainMode: "pin" | "tail" | "off";
  audioEnabled?: boolean;
  referenceImageCount?: number;
}): VideoGenerationPreflight {
  const capabilities = getVideoModelCapabilities(input.modelId, input.supportsAudio);
  const adjustments: PreflightAdjustment[] = [];
  const warnings: VideoGenerationPreflight["warnings"] = [];
  if (capabilities.confidence === "unknown") warnings.push("capabilities-unknown");
  if (input.audioEnabled && capabilities.nativeAudio === false) warnings.push("native-audio-unavailable");
  return { capabilities, adjustments, warnings };
}

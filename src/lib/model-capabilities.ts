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

const KNOWN_VIDEO_CAPABILITIES: Record<string, Omit<VideoModelCapabilities, "confidence">> = {
  "google/veo3.1/image-to-video": {
    textToVideo: false, imageToVideo: true, referenceVideo: false,
    lastFrame: true, nativeAudio: true, durationValues: [4, 6, 8],
    resolutionValues: ["720p", "1080p"], aspectRatioValues: ["16:9", "9:16"],
  },
  "minimax/hailuo-2.3/i2v-standard": {
    textToVideo: false, imageToVideo: true, referenceVideo: false,
    lastFrame: false, nativeAudio: false, durationValues: [6, 10],
  },
  "minimax/h3/image-to-video": {
    textToVideo: false, imageToVideo: true, referenceVideo: false,
    lastFrame: true, nativeAudio: false, durationValues: [5],
    resolutionValues: ["2K"], aspectRatioValues: ["adaptive"],
  },
};

/** Normalize provider-specific video metadata into one UI-facing capability contract. */
export function getVideoModelCapabilities(modelId: string, supportsAudio?: boolean): VideoModelCapabilities {
  const atlasSeedance = /^bytedance\/seedance-(2\.5|2\.0(?:-fast|-mini)?)\/(text-to-video|image-to-video|reference-to-video)$/i.exec(modelId);
  if (atlasSeedance) {
    const version = atlasSeedance[1].toLowerCase();
    const mode = atlasSeedance[2].toLowerCase();
    const full20 = version === "2.0";
    return {
      confidence: "known",
      textToVideo: mode === "text-to-video",
      imageToVideo: mode === "image-to-video",
      referenceVideo: mode === "reference-to-video",
      lastFrame: mode === "image-to-video",
      nativeAudio: supportsAudio ?? true,
      durationValues: Array.from({ length: version === "2.5" ? 27 : 12 }, (_, index) => index + 4),
      resolutionValues: full20 ? ["720p", "1080p"] : ["720p"],
      aspectRatioValues: ["9:16", "16:9", "1:1"],
      maxReferenceImages: mode === "reference-to-video" ? (version === "2.5" ? 30 : 9) : undefined,
    };
  }
  const known = KNOWN_VIDEO_CAPABILITIES[modelId.toLowerCase()];
  if (known) {
    return { confidence: "known", ...known, nativeAudio: supportsAudio ?? known.nativeAudio };
  }
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
  if (input.duration != null && capabilities.durationValues?.length && !capabilities.durationValues.includes(input.duration)) {
    const effective = capabilities.durationValues.reduce((best, value) => {
      const delta = Math.abs(value - input.duration!);
      const bestDelta = Math.abs(best - input.duration!);
      return delta < bestDelta || (delta === bestDelta && value < best) ? value : best;
    }, capabilities.durationValues[0]);
    adjustments.push({ field: "duration", requested: input.duration, effective, code: "nearest-duration" });
  }
  if (capabilities.resolutionValues?.length && !capabilities.resolutionValues.includes(input.resolution)) {
    adjustments.push({ field: "resolution", requested: input.resolution, effective: capabilities.resolutionValues[0], code: "mapped-resolution" });
  }
  if (capabilities.aspectRatioValues?.length && !capabilities.aspectRatioValues.includes(input.aspectRatio)) {
    adjustments.push({ field: "aspectRatio", requested: input.aspectRatio, effective: capabilities.aspectRatioValues[0], code: "adaptive-ratio" });
  }
  if (input.chainMode !== "off" && capabilities.lastFrame === false) {
    adjustments.push({ field: "chainMode", requested: input.chainMode, effective: "off", code: "unsupported-last-frame" });
  }
  return { capabilities, adjustments, warnings };
}

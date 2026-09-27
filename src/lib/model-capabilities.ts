import type { GenAspectRatio, GenResolution } from "@/lib/gen-params";
import { resolveCapabilityContract, type ProviderCapabilityContract } from "@/lib/provider-capability-contract";

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

function resolutionRank(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized === "2k") return 1440;
  if (normalized === "4k") return 2160;
  const numeric = Number.parseInt(normalized, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** Map Mora's stable quality preference to the closest real provider/model resolution. */
export function resolveModelResolution(
  preferred: GenResolution,
  supported: readonly string[] | undefined,
): { preferred: GenResolution; effective: string; adjusted: boolean } {
  if (!supported?.length) return { preferred, effective: preferred, adjusted: false };
  const exact = supported.find((value) => value.toLowerCase() === preferred.toLowerCase());
  if (exact) return { preferred, effective: exact, adjusted: false };
  const target = resolutionRank(preferred);
  const ranked = [...supported].sort((a, b) => resolutionRank(a) - resolutionRank(b));
  // A quality preference is a floor: avoid silently charging for a lower tier
  // when the model offers a higher tier that can satisfy it.
  const effective = ranked.find((value) => resolutionRank(value) >= target) ?? ranked[ranked.length - 1];
  return { preferred, effective, adjusted: true };
}

/** Normalize provider-specific video metadata into one UI-facing capability contract. */
export function videoCapabilitiesFromContract(contract: ProviderCapabilityContract): VideoModelCapabilities {
  const modes = contract.parameters.modes;
  const supports = (mode: string): boolean | null => modes ? modes.includes(mode) : null;
  return {
    confidence: contract.confidence === "declared" ? "inferred" : contract.confidence,
    textToVideo: supports("text-to-video"),
    imageToVideo: supports("image-to-video"),
    referenceVideo: supports("video-to-video"),
    lastFrame: contract.references.lastFrame ?? null,
    nativeAudio: contract.audio.output === "native" ? true : contract.audio.output === "none" ? false : null,
    durationValues: contract.parameters.durations,
    resolutionValues: contract.parameters.resolutions,
    aspectRatioValues: contract.parameters.aspectRatios,
    maxReferenceImages: contract.references.maxImages,
  };
}

/** Normalize provider-specific video metadata into one UI-facing capability contract. */
export function getVideoModelCapabilities(modelId: string, supportsAudio?: boolean, provider = ""): VideoModelCapabilities {
  return videoCapabilitiesFromContract(resolveCapabilityContract({ capability: "video", provider, modelId, supportsAudio }));
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
    const resolution = resolveModelResolution(input.resolution, capabilities.resolutionValues);
    adjustments.push({ field: "resolution", requested: input.resolution, effective: resolution.effective, code: "mapped-resolution" });
  }
  if (capabilities.aspectRatioValues?.length && !capabilities.aspectRatioValues.includes(input.aspectRatio)) {
    adjustments.push({ field: "aspectRatio", requested: input.aspectRatio, effective: capabilities.aspectRatioValues[0], code: "adaptive-ratio" });
  }
  if (input.chainMode !== "off" && capabilities.lastFrame === false) {
    adjustments.push({ field: "chainMode", requested: input.chainMode, effective: "off", code: "unsupported-last-frame" });
  }
  return { capabilities, adjustments, warnings };
}

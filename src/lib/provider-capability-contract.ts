import { ATLAS_VIDEO_FAMILIES, atlasVideoFamilyId } from "@/lib/atlas-video-models";
import type { AIProvider, MediaType, Model } from "@/lib/providers/types";

export const PROVIDER_CAPABILITY_CONTRACT_VERSION = 1 as const;

export type ProviderCapability = "text" | "vision" | "image" | "video" | "tts";
export type ProviderMediaType = "text" | "image" | "video" | "audio";

export interface ProviderCapabilityContract {
  version: typeof PROVIDER_CAPABILITY_CONTRACT_VERSION;
  capability: ProviderCapability;
  provider: string;
  modelId: string;
  input: {
    mediaTypes: ProviderMediaType[];
  };
  output: {
    mediaType: ProviderMediaType;
    authentication: "none" | "provider-bearer" | "unknown";
    maxBytes?: number;
  };
  confidence: "known" | "declared" | "unknown";
  parameters: {
    modes?: string[];
    durations?: number[];
    resolutions?: string[];
    aspectRatios?: string[];
    speedRange?: { min: number; max: number };
    features?: string[];
  };
  references: {
    lastFrame?: boolean | null;
    maxImages?: number;
    maxVideos?: number;
    maxAudios?: number;
  };
  audio: {
    input: boolean | null;
    output: "native" | "none" | "unknown";
  };
  task: {
    submission: "synchronous" | "single-phase" | "two-phase";
    recovery: "none" | "best-effort" | "durable";
  };
  billing: {
    unit: "request" | "second" | "character" | "unknown";
    estimate?: number;
  };
}

const CAPABILITY_IO: Record<ProviderCapability, Pick<ProviderCapabilityContract, "input" | "output">> = {
  text: { input: { mediaTypes: ["text"] }, output: { mediaType: "text", authentication: "none" } },
  vision: { input: { mediaTypes: ["text", "image"] }, output: { mediaType: "text", authentication: "none" } },
  image: { input: { mediaTypes: ["text", "image"] }, output: { mediaType: "image", authentication: "unknown", maxBytes: 20 * 1024 * 1024 } },
  video: { input: { mediaTypes: ["text", "image", "video", "audio"] }, output: { mediaType: "video", authentication: "unknown", maxBytes: 200 * 1024 * 1024 } },
  tts: { input: { mediaTypes: ["text"] }, output: { mediaType: "audio", authentication: "none", maxBytes: 20 * 1024 * 1024 } },
};

const DURABLE_VIDEO_PROVIDERS = new Set(["openrouter", "atlas-cloud", "volcengine"]);

type KnownVideoDetails = {
  modes: string[];
  durations?: number[];
  resolutions?: string[];
  aspectRatios?: string[];
  lastFrame: boolean;
};

const KNOWN_VIDEO_MODELS: Record<string, KnownVideoDetails> = {
  "google/veo3.1/image-to-video": {
    modes: ["image-to-video"], durations: [4, 6, 8], resolutions: ["720p", "1080p"], aspectRatios: ["16:9", "9:16"], lastFrame: true,
  },
  "minimax/hailuo-2.3/i2v-standard": {
    modes: ["image-to-video"], durations: [6, 10], lastFrame: false,
  },
};

function atlasModes(modelId: string): string[] | undefined {
  const mode = /\/(text-to-video|image-to-video|reference-to-video)$/i.exec(modelId)?.[1]?.toLowerCase();
  if (mode === "reference-to-video") return ["video-to-video"];
  if (mode) return [mode];
  return atlasVideoFamilyId(modelId) ? ["text-to-video", "image-to-video", "video-to-video"] : undefined;
}

function inferredVideoModes(modelId: string): string[] | undefined {
  const id = modelId.toLowerCase();
  if (/(?:text-to-video|\/t2v(?:-|$))/.test(id)) return ["text-to-video"];
  if (/(?:image-to-video|\/i2v(?:-|$)|start-end-to-video)/.test(id)) return ["image-to-video"];
  if (/reference-to-video/.test(id)) return ["video-to-video"];
  return undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function numberArray(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item)) ? value : undefined;
}

function videoDetails(input: ResolveCapabilityContractInput) {
  const extra = input.extra ?? {};
  const atlasFamily = ATLAS_VIDEO_FAMILIES.find((candidate) => candidate.id === atlasVideoFamilyId(input.modelId));
  const known = KNOWN_VIDEO_MODELS[input.modelId.toLowerCase()];
  const durations = numberArray(extra.durationValues)
    ?? numberArray(extra.supportedDurations)
    ?? atlasFamily?.durations
    ?? known?.durations;
  const resolutions = stringArray(extra.supportedResolutions) ?? atlasFamily?.resolutions ?? known?.resolutions;
  const aspectRatios = stringArray(extra.supportedAspectRatios) ?? atlasFamily?.ratios ?? known?.aspectRatios;
  const isKnown = Boolean(atlasFamily || known || durations?.length || resolutions?.length || aspectRatios?.length);
  const familyModes = atlasModes(input.modelId);
  const modes = input.modes && atlasFamily
    ? [...new Set([...input.modes, ...(familyModes ?? [])])]
    : input.modes ?? familyModes ?? known?.modes ?? inferredVideoModes(input.modelId);
  const exactAtlasMode = /\/(text-to-video|image-to-video|reference-to-video)$/i.exec(input.modelId)?.[1]?.toLowerCase();
  return {
    confidence: isKnown ? "known" as const : input.modes?.length || input.supportsAudio !== undefined ? "declared" as const : "unknown" as const,
    parameters: {
      modes,
      durations,
      resolutions,
      aspectRatios,
    },
    references: {
      lastFrame: known?.lastFrame ?? (atlasFamily ? (!exactAtlasMode || exactAtlasMode === "image-to-video") : null),
      maxImages: input.provider === "openrouter" && atlasFamily?.id === "bytedance/seedance-2.5" ? 50 : atlasFamily?.maxReferenceImages,
      maxVideos: atlasFamily?.maxReferenceVideos,
      maxAudios: atlasFamily?.maxReferenceAudios,
    },
  };
}

export interface ResolveCapabilityContractInput {
  capability: ProviderCapability;
  provider: string;
  modelId: string;
  modes?: string[];
  supportsAudio?: boolean;
  extra?: Record<string, unknown>;
}

export function resolveCapabilityContract(input: ResolveCapabilityContractInput): ProviderCapabilityContract {
  const detail: Pick<ProviderCapabilityContract, "confidence" | "parameters" | "references"> = input.capability === "video"
    ? videoDetails(input)
    : {
        confidence: input.modes?.length ? "declared" as const : "known" as const,
        parameters: {
          modes: input.modes,
          ...(input.capability === "tts" && {
            speedRange: { min: 0.5, max: 2 },
            features: input.provider === "minimax" ? ["emotion"] : /gpt-4o-mini-tts/i.test(input.modelId) ? ["instructions"] : [],
          }),
          ...(input.capability === "vision" && { features: ["image-input"] }),
          ...(input.capability === "text" && { features: ["text-input"] }),
          ...(input.capability === "image" && { features: ["reference-images"] }),
        },
        references: {},
      };
  const durableVideo = input.capability === "video" && DURABLE_VIDEO_PROVIDERS.has(input.provider);
  const estimatedPrice = typeof input.extra?.estimatedPricePerUnit === "number"
    ? input.extra.estimatedPricePerUnit
    : undefined;
  const priceUnit = input.extra?.priceUnit === "second" || input.extra?.priceUnit === "character"
    ? input.extra.priceUnit
    : estimatedPrice != null ? "request" : "unknown";
  return {
    version: PROVIDER_CAPABILITY_CONTRACT_VERSION,
    capability: input.capability,
    provider: input.provider,
    modelId: input.modelId,
    ...CAPABILITY_IO[input.capability],
    ...(input.provider === "openrouter" && (input.capability === "image" || input.capability === "video")
      ? { output: { ...CAPABILITY_IO[input.capability].output, authentication: "provider-bearer" as const } }
      : {}),
    ...detail,
    audio: {
      input: input.capability === "video" ? detail.references.maxAudios != null : false,
      output: input.supportsAudio === true ? "native" : input.supportsAudio === false ? "none" : "unknown",
    },
    task: input.capability === "video"
      ? { submission: durableVideo ? "two-phase" : "single-phase", recovery: durableVideo ? "durable" : "best-effort" }
      : { submission: "synchronous", recovery: "none" },
    billing: { unit: priceUnit, ...(estimatedPrice != null && { estimate: estimatedPrice }) },
  };
}

export interface CapabilityPreflightIssue {
  code:
    | "unsupported-mode"
    | "unsupported-duration"
    | "unsupported-resolution"
    | "unsupported-aspect-ratio"
    | "too-many-reference-images"
    | "too-many-reference-videos"
    | "too-many-reference-audios"
    | "unsupported-last-frame"
    | "unsupported-speed"
    | "native-audio-unavailable";
  field: "mode" | "duration" | "resolution" | "aspectRatio" | "referenceImages" | "referenceVideos" | "referenceAudios" | "lastFrame" | "speed" | "audio";
  requested: string | number | boolean;
  supported?: Array<string | number>;
}

export interface CapabilityRequest {
  mode?: string;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  referenceImageCount?: number;
  referenceVideoCount?: number;
  referenceAudioCount?: number;
  lastFrame?: boolean;
  speed?: number;
  audioEnabled?: boolean;
}

export function preflightCapabilityRequest(
  contract: ProviderCapabilityContract,
  request: CapabilityRequest,
): { ok: boolean; issues: CapabilityPreflightIssue[] } {
  const issues: CapabilityPreflightIssue[] = [];
  const addUnsupported = (
    field: CapabilityPreflightIssue["field"],
    code: CapabilityPreflightIssue["code"],
    requested: string | number | boolean | undefined,
    supported: Array<string | number> | undefined,
  ) => {
    if (requested == null || !supported?.length) return;
    const normalized = supported.map((value) => String(value).toLowerCase());
    if (!normalized.includes(String(requested).toLowerCase())) issues.push({ code, field, requested, supported });
  };
  addUnsupported("mode", "unsupported-mode", request.mode, contract.parameters.modes);
  addUnsupported("duration", "unsupported-duration", request.duration, contract.parameters.durations);
  addUnsupported("resolution", "unsupported-resolution", request.resolution, contract.parameters.resolutions);
  addUnsupported("aspectRatio", "unsupported-aspect-ratio", request.aspectRatio, contract.parameters.aspectRatios);
  const quotas = [
    ["referenceImages", "too-many-reference-images", request.referenceImageCount, contract.references.maxImages],
    ["referenceVideos", "too-many-reference-videos", request.referenceVideoCount, contract.references.maxVideos],
    ["referenceAudios", "too-many-reference-audios", request.referenceAudioCount, contract.references.maxAudios],
  ] as const;
  for (const [field, code, requested, maximum] of quotas) {
    if (requested != null && maximum != null && requested > maximum) {
      issues.push({ code, field, requested, supported: [maximum] });
    }
  }
  if (request.lastFrame && contract.references.lastFrame === false) {
    issues.push({ code: "unsupported-last-frame", field: "lastFrame", requested: true });
  }
  const speedRange = contract.parameters.speedRange;
  if (request.speed != null && speedRange && (request.speed < speedRange.min || request.speed > speedRange.max)) {
    issues.push({ code: "unsupported-speed", field: "speed", requested: request.speed, supported: [speedRange.min, speedRange.max] });
  }
  if (request.audioEnabled && contract.audio.output === "none") {
    issues.push({ code: "native-audio-unavailable", field: "audio", requested: true });
  }
  return { ok: issues.length === 0, issues };
}

export function withModelCapability<T extends Model>(model: T): T & { capability: ProviderCapabilityContract } {
  return {
    ...model,
    capability: resolveCapabilityContract({
      capability: model.mediaType,
      provider: model.provider,
      modelId: model.id,
      modes: model.modes,
      supportsAudio: model.supportsAudio,
      extra: model.extra,
    }),
  };
}

export async function discoverModelCapability(
  provider: Pick<AIProvider, "listModels">,
  input: { provider: string; modelId: string; mediaType: MediaType },
): Promise<ProviderCapabilityContract> {
  try {
    const models = await provider.listModels(input.mediaType);
    const discovered = models.find((model) => model.id === input.modelId);
    if (discovered) return withModelCapability(discovered).capability;
  } catch {
    // Offline/custom-provider use remains available. Known built-in model rules below
    // still preflight, while an unknown custom model stays permissive without claiming support.
  }
  return resolveCapabilityContract({
    capability: input.mediaType,
    provider: input.provider,
    modelId: input.modelId,
  });
}

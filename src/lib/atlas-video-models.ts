import type { VideoOptions } from "@/lib/providers/types";

export type AtlasVideoMode = "text-to-video" | "image-to-video" | "reference-to-video";

export interface AtlasVideoFamilySpec {
  id: string;
  name: string;
  durations: number[];
  resolutions: string[];
  ratios: string[];
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxReferenceAudios: number;
  pricePerSecond?: number;
  requestProfile?: "seedance" | "h3";
}

export interface AtlasVideoModelSpec extends AtlasVideoFamilySpec {
  mode: AtlasVideoMode;
  supportsLastFrame: boolean;
}

const DURATIONS_2_0 = Array.from({ length: 12 }, (_, index) => index + 4);
const DURATIONS_2_5 = Array.from({ length: 27 }, (_, index) => index + 4);
const DURATIONS_H3 = Array.from({ length: 12 }, (_, index) => index + 4);
const RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"];

export const ATLAS_VIDEO_FAMILIES: readonly AtlasVideoFamilySpec[] = [
  { id: "bytedance/seedance-2.0-mini", name: "Seedance 2.0 Mini", durations: DURATIONS_2_0, resolutions: ["480p", "720p"], ratios: RATIOS, maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, pricePerSecond: 0.039, requestProfile: "seedance" },
  { id: "bytedance/seedance-2.0-fast", name: "Seedance 2.0 Fast", durations: DURATIONS_2_0, resolutions: ["480p", "720p"], ratios: RATIOS, maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, pricePerSecond: 0.09, requestProfile: "seedance" },
  { id: "bytedance/seedance-2.0", name: "Seedance 2.0", durations: DURATIONS_2_0, resolutions: ["480p", "720p", "1080p"], ratios: RATIOS, maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, pricePerSecond: 0.112, requestProfile: "seedance" },
  { id: "bytedance/seedance-2.5", name: "Seedance 2.5", durations: DURATIONS_2_5, resolutions: ["480p", "720p"], ratios: RATIOS, maxReferenceImages: 30, maxReferenceVideos: 10, maxReferenceAudios: 10, pricePerSecond: 0.134, requestProfile: "seedance" },
  { id: "minimax/h3", name: "MiniMax H3", durations: DURATIONS_H3, resolutions: ["768P", "2K"], ratios: RATIOS, maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, pricePerSecond: 0.08, requestProfile: "h3" },
  { id: "minimax/h3-developer", name: "MiniMax H3 Developer", durations: DURATIONS_H3, resolutions: ["768P", "2K"], ratios: RATIOS, maxReferenceImages: 9, maxReferenceVideos: 3, maxReferenceAudios: 3, pricePerSecond: 0.08, requestProfile: "h3" },
];

const ATLAS_FAMILY_IDS = new Set(ATLAS_VIDEO_FAMILIES.map((family) => family.id));
const MODE_SUFFIX = /\/(?:text-to-video|image-to-video|reference-to-video)$/i;

/** Convert a legacy exact Atlas endpoint ID into the user-facing model family ID. */
export function atlasVideoFamilyId(modelId: string | undefined): string | undefined {
  const candidate = modelId?.trim().replace(MODE_SUFFIX, "");
  return candidate && ATLAS_FAMILY_IDS.has(candidate.toLowerCase()) ? candidate.toLowerCase() : undefined;
}

/** Resolve the exact Atlas endpoint used for a specific paid operation. */
export function resolveAtlasVideoModelId(modelId: string, mode: AtlasVideoMode): string {
  const family = atlasVideoFamilyId(modelId);
  return family ? `${family}/${mode}` : modelId;
}

/** Select an Atlas operation from the actual inputs, not from a UI dropdown suffix. */
export function atlasVideoModeForOptions(options: VideoOptions): AtlasVideoMode {
  if (options.workflow === "shot-motion") return "image-to-video";
  if (options.workflow === "storyboard-film" || options.workflow === "reference-replication") return "reference-to-video";
  if (options.workflow === "prompt-video") return "text-to-video";

  const hasReferences = Boolean(
    options.referenceVideoUrl
      || options.referenceVideoUrls?.length
      || options.referenceImageUrls?.length
      || options.referenceAudioUrls?.length,
  );
  if (options.mode === "video-to-video" || hasReferences) return "reference-to-video";
  if (options.mode === "image-to-video" || options.firstFrameUrl || options.lastFrameUrl) return "image-to-video";
  return "text-to-video";
}

export const ATLAS_VIDEO_MODELS: readonly AtlasVideoModelSpec[] = ATLAS_VIDEO_FAMILIES.flatMap((family) =>
  (["reference-to-video", "image-to-video", "text-to-video"] as const).map((mode) => ({
    ...family,
    id: `${family.id}/${mode}`,
    mode,
    supportsLastFrame: mode === "image-to-video",
  })),
);

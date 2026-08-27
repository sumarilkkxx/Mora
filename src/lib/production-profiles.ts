import type { ImageGenParams, VideoGenParams } from "@/lib/gen-params";
import type { MotionIntensity, MotionRealismTier } from "@/lib/motion-prompt";

export const PRODUCTION_PROFILE_IDS = ["rapid", "balanced", "cinematic"] as const;
export type ProductionProfileId = (typeof PRODUCTION_PROFILE_IDS)[number];

export interface ProductionProfile {
  id: ProductionProfileId;
  resolution: "720p" | "1080p";
  duration: number;
  motionStrength: number;
  motionIntensity: MotionIntensity;
  motionRealism: MotionRealismTier;
  chainMode: "pin" | "tail" | "off";
  visualLook: string;
  speed: 1 | 2 | 3;
  quality: 1 | 2 | 3;
  cost: 1 | 2 | 3;
}

/** Creator-facing strategies mapped only to provider-agnostic controls. */
export const PRODUCTION_PROFILES: Record<ProductionProfileId, ProductionProfile> = {
  rapid: {
    id: "rapid",
    resolution: "720p",
    duration: 4,
    motionStrength: 0.35,
    motionIntensity: "subtle",
    motionRealism: "constraints",
    chainMode: "off",
    visualLook: "none",
    speed: 3,
    quality: 1,
    cost: 1,
  },
  balanced: {
    id: "balanced",
    resolution: "1080p",
    duration: 5,
    motionStrength: 0.55,
    motionIntensity: "normal",
    motionRealism: "auto",
    chainMode: "pin",
    visualLook: "daylight_clean",
    speed: 2,
    quality: 2,
    cost: 2,
  },
  cinematic: {
    id: "cinematic",
    resolution: "1080p",
    duration: 8,
    motionStrength: 0.72,
    motionIntensity: "strong",
    motionRealism: "auto",
    chainMode: "tail",
    visualLook: "studio_product",
    speed: 1,
    quality: 3,
    cost: 3,
  },
};

export function isProductionProfileId(value: unknown): value is ProductionProfileId {
  return typeof value === "string" && (PRODUCTION_PROFILE_IDS as readonly string[]).includes(value);
}

interface CurrentProductionSettings {
  imageParams: ImageGenParams;
  videoParams: VideoGenParams;
}

export function productionProfilePatch(id: ProductionProfileId, current: CurrentProductionSettings) {
  const profile = PRODUCTION_PROFILES[id];
  const aspectRatio = current.videoParams.aspectRatio;

  return {
    activeProductionProfile: id,
    defaultResolution: profile.resolution,
    imageParams: { ...current.imageParams, aspectRatio, count: 1 },
    videoParams: {
      ...current.videoParams,
      aspectRatio,
      resolution: profile.resolution,
      duration: profile.duration,
      motionStrength: profile.motionStrength,
    },
    motionIntensity: profile.motionIntensity,
    motionRealism: profile.motionRealism,
    chainMode: profile.chainMode,
    visualLook: profile.visualLook,
  } as const;
}

import { videoSize, type GenAspectRatio, type GenResolution } from "@/lib/gen-params";
import { preflightVideoGeneration, type PreflightAdjustment } from "@/lib/model-capabilities";

function aspectFromDimensions(width: unknown, height: unknown): GenAspectRatio {
  const w = typeof width === "number" ? width : 0;
  const h = typeof height === "number" ? height : 0;
  if (w > 0 && w === h) return "1:1";
  return w > h ? "16:9" : "9:16";
}

function resolutionFromDimensions(width: unknown, height: unknown): GenResolution {
  const longEdge = Math.max(typeof width === "number" ? width : 0, typeof height === "number" ? height : 0);
  return longEdge >= 1900 ? "1080p" : "720p";
}

/**
 * Apply the same capability mapping shown in the UI to the exact options sent to a paid provider.
 * Unknown/custom models stay untouched. Known models use the nearest supported duration and a
 * supported resolution/aspect ratio, so the preflight is executable policy rather than decoration.
 */
export function normalizeVideoOptionsForModel(
  modelId: string,
  rawOptions: unknown,
  hasLastFrame: boolean,
): {
  options: Record<string, unknown>;
  adjustments: PreflightAdjustment[];
  allowLastFrame: boolean;
} {
  const options = rawOptions && typeof rawOptions === "object" ? { ...(rawOptions as Record<string, unknown>) } : {};
  let resolution = resolutionFromDimensions(options.width, options.height);
  let aspectRatio = aspectFromDimensions(options.width, options.height);
  const duration = typeof options.duration === "number" ? options.duration : undefined;
  const preflight = preflightVideoGeneration({
    modelId,
    duration,
    resolution,
    aspectRatio,
    chainMode: hasLastFrame ? "pin" : "off",
  });

  for (const adjustment of preflight.adjustments) {
    if (adjustment.field === "duration" && typeof adjustment.effective === "number") {
      options.duration = adjustment.effective;
    }
    if (adjustment.field === "resolution" && (adjustment.effective === "720p" || adjustment.effective === "1080p")) {
      resolution = adjustment.effective;
    }
    if (adjustment.field === "aspectRatio" && (adjustment.effective === "9:16" || adjustment.effective === "16:9" || adjustment.effective === "1:1")) {
      aspectRatio = adjustment.effective;
    }
  }

  const dimensions = videoSize(resolution, aspectRatio);
  options.width = dimensions.width;
  options.height = dimensions.height;
  return {
    options,
    adjustments: preflight.adjustments,
    allowLastFrame: !preflight.adjustments.some((item) => item.field === "chainMode"),
  };
}

import type { Shot } from "@/lib/domain/script";

/**
 * Asset page view row: derived from "shots of the selected script" + "persisted assets".
 * Pure data, no React dependency — shared between initial asset-page load and post-fill refresh (unit-testable).
 */
export interface AssetItem {
  shotId: number;
  type: Shot["type"];
  duration: number;
  description: string;
  prompt: string;
  /** Script camera movement description — feeds the i2v motion prompt (see motion-prompt.ts) */
  camera?: string;
  /** Speaking cast character bound to this shot (dialogue styles) — triggers the real-face constraint */
  characterId?: string;
  /** The shot's voiceover line — with characterId present it marks a talking shot for the i2v motion prompt */
  voiceover?: string;
  visualSource: Shot["visualSource"];
  status: "pending" | "generating" | "done" | "failed";
  thumbnailUrl?: string;
  error?: string;
  /** Whether the asset is a video (animated shot / image-to-video) */
  isVideo?: boolean;
  /** Actual type of the persisted asset (e.g. stock_footage = automatically matched free-library footage) */
  assetType?: string;
  /**
   * The static keyframe an i2v video was generated FROM (persisted as thumbnailPath). Enables the
   * per-shot fallback loop — re-run just the i2v while keeping the keyframe — and lets a preceding
   * shot chain into this clip's first frame even after the shot has become a video.
   */
  keyframeUrl?: string;
}

/** Video asset file extensions (used to distinguish video vs. static image, determining thumbnail display and the "animate" entry point) */
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

/** Subset of fields from GET /api/project/[id]/assets response rows that this module cares about */
export interface SavedAssetRow {
  shotId: number;
  filePath?: string | null;
  status?: string | null;
  type?: string | null;
  /** Static preview image for video assets (free-library videos populate this column); used as <img> thumbnail to avoid rendering an mp4 as an image */
  thumbnailPath?: string | null;
}

/**
 * Index every ready persisted asset, regardless of how it was created. Asset
 * provenance and final-video rendering are separate concerns: AI-generated
 * images and stock footage are valid inputs to a local FFmpeg composition.
 */
export function readyAssetsByShot(
  savedAssets: SavedAssetRow[],
): Map<number, SavedAssetRow> {
  const savedByShot = new Map<number, SavedAssetRow>();
  for (const asset of savedAssets) {
    if (asset?.filePath && asset.status === "done") {
      savedByShot.set(asset.shotId, asset);
    }
  }
  return savedByShot;
}

/**
 * Combines "shots of the selected script + persisted assets" into asset-page view rows.
 * - Persisted and ready assets (filePath is an accessible /api/files path) → status "done" with thumbnail;
 * - Product-image shots (product_image) → resolved using the first product image;
 * - All other shots → pending generation.
 * Pure function, shared between initial load and post "auto-fill" refresh to guarantee consistent behavior on both paths.
 */
export function buildAssetRows(
  shots: Shot[],
  savedAssets: SavedAssetRow[],
  productImages: string[],
  productionMode: "ai" | "local" = "ai",
): AssetItem[] {
  // Saved assets win regardless of origin; productionMode only controls the
  // fallback for legacy AI-only shots that do not have a saved asset yet.
  const savedByShot = readyAssetsByShot(savedAssets);
  const firstProduct = productImages[0];

  return shots.map((s) => {
    const saved = savedByShot.get(s.shotId);
    if (saved && saved.filePath) {
      // Video asset: use the static preview image as thumbnail (rendering an mp4 as <img> breaks), and mark isVideo to correctly hide the "animate" entry point
      const isVideo = VIDEO_EXT.test(saved.filePath);
      return {
        shotId: s.shotId,
        type: s.type,
        duration: s.duration,
        description: s.description,
        prompt: s.prompt ?? "",
        camera: s.camera || undefined,
        characterId: s.characterId || undefined,
        voiceover: s.voiceover || undefined,
        visualSource: s.visualSource,
        status: "done" as const,
        thumbnailUrl: isVideo && saved.thumbnailPath ? saved.thumbnailPath : saved.filePath,
        isVideo: isVideo || undefined,
        assetType: saved.type ?? undefined,
        keyframeUrl: isVideo && saved.thumbnailPath ? saved.thumbnailPath : undefined,
      };
    }
    // A local product video is a deterministic image-editing workflow. Legacy
    // scripts may still contain AI-only shots; when the original product photo
    // exists, display and process those shots as product-image shots instead of
    // showing a misleading broken upload slot. AI projects keep their source.
    const viewShot =
      productionMode === "local" && firstProduct && s.visualSource === "ai_generate"
        ? { ...s, visualSource: "product_image" as const }
        : s;
    return {
      shotId: viewShot.shotId,
      type: viewShot.type,
      duration: viewShot.duration,
      description: viewShot.description,
      prompt: viewShot.prompt ?? "",
      camera: viewShot.camera || undefined,
      characterId: viewShot.characterId || undefined,
      voiceover: viewShot.voiceover || undefined,
      visualSource: viewShot.visualSource,
      status: viewShot.visualSource === "product_image" ? ("done" as const) : ("pending" as const),
      thumbnailUrl: viewShot.visualSource === "product_image" ? firstProduct : undefined,
    };
  });
}

/**
 * Keyframe chaining (Dreamina-style first/last frame): find the NEXT shot's static keyframe so an
 * image-to-video call can pin its last frame to it — the clip then ends by flowing into the next
 * scene, and the composer's hard concat becomes a seamless AI-generated transition.
 * A next shot that is ALREADY a video still chains via its recorded source keyframe (its first
 * frame). Returns undefined when no usable static frame exists.
 */
export function nextChainKeyframe(rows: AssetItem[], shotId: number): string | undefined {
  const idx = rows.findIndex((r) => r.shotId === shotId);
  if (idx < 0 || idx + 1 >= rows.length) return undefined;
  const next = rows[idx + 1];
  if (next.status !== "done") return undefined;
  if (!next.isVideo && next.thumbnailUrl) return next.thumbnailUrl;
  if (next.isVideo && next.keyframeUrl) return next.keyframeUrl;
  return undefined;
}

/**
 * Shot types whose PATH is the content: the demonstration's own ending is the payload, so
 * chaining (which replaces the clip's ending with a transition into the next scene) eats
 * exactly the frames that sell. These types skip keyframe chaining by default; an explicit
 * lastFrame override still wins (transition-driven shots keep chaining).
 */
const CHAIN_SKIP_TYPES = new Set(["demo"]);

/** Whether a shot type participates in keyframe chaining when no explicit choice was made. */
export function chainByDefault(shotType: string | undefined): boolean {
  return !CHAIN_SKIP_TYPES.has(String(shotType ?? ""));
}

/** Number of shots still awaiting an asset (pending) */
export function pendingShotCount(rows: AssetItem[]): number {
  return rows.filter((r) => r.status === "pending").length;
}

/** Number of shots still pending that are not product-image shots (product-image shots should not be overwritten by free-library assets) */
export function pendingNonProductShotCount(rows: AssetItem[]): number {
  return rows.filter((r) => r.status === "pending" && r.visualSource !== "product_image").length;
}

/**
 * Whether to show the "auto-fill with free stock assets" entry point (free-library = keyless Openverse images, zero image-gen key required):
 * - topic (one-liner video without a product) projects: always show — this is their primary render path;
 * - Other projects (including e-commerce): show when **no image-gen model is configured** yet there are still
 *   pending non-product shots — lets users without an AI key still fill hook / social-proof B-roll shots
 *   (product-image shots are unaffected).
 */
export function shouldOfferStockFill(
  rows: AssetItem[],
  contentType: string | undefined,
  hasImageModel: boolean,
): boolean {
  if (rows.length === 0) return false;
  if (contentType === "topic") return true;
  return !hasImageModel && pendingNonProductShotCount(rows) > 0;
}

/**
 * Whether to display a "no default image-gen model configured" warning:
 * Only shown when no model is configured AND there are still AI-generate shots not yet done;
 * suppressed once all AI shots are done — avoids contradicting the "N/N assets ready" message
 * and confusing beginners into thinking something went wrong.
 */
export function needsImageModelWarning(rows: AssetItem[], hasImageModel: boolean): boolean {
  if (hasImageModel) return false;
  return rows.some((r) => r.visualSource === "ai_generate" && r.status !== "done");
}

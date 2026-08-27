/**
 * Coverr media source — curated free stock videos with less "stocky" feel than mass libraries
 * (one source in the multi-provider media engine).
 *
 * Auth: `Authorization: Bearer <API_KEY>` header. Free key: https://coverr.co/developers
 * (demo apps 50 req/h, production apps 2000 req/h).
 * License: Coverr content is free for commercial use; content fetched via the API requires
 * Coverr attribution, so candidates are marked requiresAttribution and flow into the credits
 * manifest automatically.
 */

import {
  type StockCandidate,
  type StockOrientation,
  fetchWithTimeout,
  filterByDuration,
} from "./stock-types";

const COVERR_API = "https://api.coverr.co";

// ==================== Coverr raw response types ====================

/** Coverr video item (fields used by us; `urls` present only when the request sets urls=true) */
export interface CoverrVideo {
  id: string;
  title?: string;
  description?: string;
  duration?: number; // seconds (fractional)
  aspect_ratio?: string; // "16:9" / "9:16"
  max_width?: number;
  max_height?: number;
  thumbnail?: string;
  poster?: string;
  tags?: string[];
  urls?: {
    mp4?: string;
    mp4_preview?: string;
    mp4_download?: string;
  };
}

// ==================== pure functions (unit-testable) ====================

/** Normalize a Coverr video into a candidate; returns null when no downloadable mp4 URL exists. */
export function toCoverrCandidate(video: CoverrVideo): StockCandidate | null {
  const downloadUrl = video.urls?.mp4_download || video.urls?.mp4;
  if (!downloadUrl) return null;
  return {
    source: "coverr",
    mediaType: "video",
    id: video.id,
    downloadUrl,
    pageUrl: `https://coverr.co/videos/${video.id}`,
    author: "Coverr",
    authorUrl: "https://coverr.co",
    license: "Coverr",
    licenseUrl: "https://coverr.co/license",
    requiresAttribution: true,
    attributionText: `Video: "${video.title || video.id}" by Coverr (coverr.co)`,
    width: video.max_width,
    height: video.max_height,
    durationSec: video.duration,
    previewImage: video.poster || video.thumbnail,
    title: video.title || undefined,
    tags: video.tags,
  };
}

// ==================== network functions ====================

/** Search Coverr videos (orientation is not a server-side filter; the registry ranker prefers matching orientations). */
export async function searchCoverrVideos(
  query: string,
  opts: {
    apiKey: string;
    perPage?: number;
    orientation?: StockOrientation;
    minSec?: number;
    maxSec?: number;
  }
): Promise<StockCandidate[]> {
  const { apiKey, perPage = 10, minSec, maxSec } = opts;
  if (!apiKey) throw new Error("缺少 Coverr API Key");
  if (!query?.trim()) throw new Error("检索词为空");

  const params = new URLSearchParams({ query: query.trim(), page_size: String(perPage), urls: "true" });
  const res = await fetchWithTimeout(`${COVERR_API}/videos?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Coverr 视频检索失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { hits?: CoverrVideo[] };
  const candidates = (data.hits ?? [])
    .map((v) => toCoverrCandidate(v))
    .filter((c): c is StockCandidate => c !== null);
  return filterByDuration(candidates, { minSec, maxSec });
}

/**
 * Freesound source — 500k+ CC sound effects (unboxing rustles, clicks, ambience) for shot SFX
 * and light BGM (one source in the multi-provider media engine, audio only).
 *
 * Auth: `token` query parameter. Free key: https://freesound.org/apiv2/apply/
 *
 * Licensing: the search filter restricts results to CC0 ("Creative Commons 0") and CC-BY
 * ("Attribution") — the two license families that allow commercial adaptation —
 * and `freesoundLicenseInfo` re-checks each sound's license URL client-side (defense in depth).
 * Download uses the public HQ mp3 preview (~128 kbps, no OAuth needed) — original-quality
 * downloads require OAuth2, which is not worth the flow complexity for short-video SFX.
 */

import { type StockCandidate, fetchWithTimeout, filterByDuration } from "./stock-types";

const FREESOUND_API = "https://freesound.org/apiv2";

// ==================== Freesound raw response types ====================

/** Freesound sound item (fields requested via the `fields` parameter) */
export interface FreesoundSound {
  id: number;
  name: string;
  username?: string;
  duration?: number; // seconds (fractional)
  license?: string; // license URL, e.g. "http://creativecommons.org/publicdomain/zero/1.0/"
  url?: string; // sound page (attribution link)
  tags?: string[];
  previews?: Record<string, string>; // "preview-hq-mp3" / "preview-lq-mp3" — public URLs
}

// ==================== pure functions (unit-testable) ====================

/**
 * Classify a Freesound license URL for commercial use.
 * CC0/PD → safe without attribution; CC-BY (not BY-NC) → safe with attribution; anything else → unsafe.
 */
export function freesoundLicenseInfo(licenseUrl?: string): {
  name: string;
  commerceSafe: boolean;
  requiresAttribution: boolean;
} {
  const u = licenseUrl ?? "";
  if (/publicdomain\/zero|\/zero\/|creativecommons\.org\/publicdomain/.test(u)) {
    return { name: "CC0", commerceSafe: true, requiresAttribution: false };
  }
  if (/licenses\/by\/\d/.test(u)) {
    return { name: "CC BY", commerceSafe: true, requiresAttribution: true };
  }
  return { name: "unknown", commerceSafe: false, requiresAttribution: false };
}

/** Normalize a Freesound sound into an audio candidate; returns null when unsafe for commerce or lacking a preview URL. */
export function toFreesoundCandidate(sound: FreesoundSound): StockCandidate | null {
  const lic = freesoundLicenseInfo(sound.license);
  if (!lic.commerceSafe) return null;
  const downloadUrl = sound.previews?.["preview-hq-mp3"] || sound.previews?.["preview-lq-mp3"];
  if (!downloadUrl) return null;
  return {
    source: "freesound",
    mediaType: "audio",
    id: sound.id,
    downloadUrl,
    pageUrl: sound.url || `https://freesound.org/s/${sound.id}/`,
    author: sound.username || "Freesound user",
    authorUrl: sound.username ? `https://freesound.org/people/${sound.username}/` : "https://freesound.org",
    license: lic.name,
    licenseUrl: sound.license,
    requiresAttribution: lic.requiresAttribution,
    attributionText: lic.requiresAttribution
      ? `Sound: "${sound.name}" by ${sound.username || "unknown"} (Freesound, CC BY)`
      : undefined,
    durationSec: sound.duration,
    title: sound.name,
    tags: sound.tags,
  };
}

// ==================== network functions ====================

/** Search Freesound sounds (SFX / short audio). The filter restricts to commercial-safe licenses server-side. */
export async function searchFreesoundSounds(
  query: string,
  opts: { apiKey: string; perPage?: number; minSec?: number; maxSec?: number }
): Promise<StockCandidate[]> {
  const { apiKey, perPage = 10, minSec, maxSec } = opts;
  if (!apiKey) throw new Error("缺少 Freesound API Key");
  if (!query?.trim()) throw new Error("检索词为空");

  const params = new URLSearchParams({
    query: query.trim(),
    token: apiKey,
    page_size: String(perPage),
    fields: "id,name,username,duration,license,previews,url,tags",
    filter: 'license:("Attribution" OR "Creative Commons 0")',
  });
  const res = await fetchWithTimeout(`${FREESOUND_API}/search/text/?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Freesound 音效检索失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { results?: FreesoundSound[] };
  const candidates = (data.results ?? [])
    .map((s) => toFreesoundCandidate(s))
    .filter((c): c is StockCandidate => c !== null);
  return filterByDuration(candidates, { minSec, maxSec });
}

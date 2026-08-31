/**
 * Jamendo music source — Creative-Commons music for video BGM (one source in the multi-provider
 * media engine, audio only).
 *
 * Auth: `client_id` query parameter. Free key: https://devportal.jamendo.com/
 *
 * Licensing note (why the filtering is this strict): syncing music into a video is an
 * *adaptation* under Creative Commons, so for commerce videos we must exclude
 * NC (non-commercial), ND (no-derivatives, forbids syncing) AND SA (share-alike would force the
 * video itself under SA). The request filters ccnc/ccnd/ccsa=false server-side and
 * `isCommerceSafeCcUrl` re-checks each track's license URL client-side (defense in depth),
 * leaving pure CC-BY only — attribution flows into the credits manifest automatically.
 */

import { type StockCandidate, fetchWithTimeout, filterByDuration } from "./stock-types";

const JAMENDO_API = "https://api.jamendo.com/v3.0";

// ==================== Jamendo raw response types ====================

/** Jamendo track item (fields used by us) */
export interface JamendoTrack {
  id: string;
  name: string;
  artist_name?: string;
  artist_id?: string;
  duration?: number; // seconds
  audio?: string; // streaming URL (mp3)
  audiodownload?: string; // download URL
  audiodownload_allowed?: boolean;
  license_ccurl?: string; // e.g. "http://creativecommons.org/licenses/by/3.0/"
  shareurl?: string; // track page (attribution link)
  image?: string; // album art
}

// ==================== pure functions (unit-testable) ====================

/**
 * True only for pure CC-BY license URLs (any version). NC/ND/SA variants and unknown URLs
 * are rejected — see the file-head licensing note for why SA is also excluded.
 */
export function isCommerceSafeCcUrl(ccurl?: string): boolean {
  return /creativecommons\.org\/licenses\/by\/\d/.test(ccurl ?? "");
}

/** Human-readable license name from a CC license URL, e.g. "CC BY 3.0"; returns "unknown" when unparsable. */
export function jamendoLicenseName(ccurl?: string): string {
  const m = (ccurl ?? "").match(/licenses\/([a-z-]+)\/([\d.]+)/);
  if (!m) return "unknown";
  return `CC ${m[1].toUpperCase()} ${m[2]}`;
}

/** Normalize a Jamendo track into an audio candidate; returns null when unsafe for commerce or not downloadable. */
export function toJamendoCandidate(track: JamendoTrack): StockCandidate | null {
  if (!isCommerceSafeCcUrl(track.license_ccurl)) return null;
  const downloadUrl = (track.audiodownload_allowed && track.audiodownload) || track.audio;
  if (!downloadUrl) return null;
  const license = jamendoLicenseName(track.license_ccurl);
  return {
    source: "jamendo",
    mediaType: "audio",
    id: track.id,
    downloadUrl,
    pageUrl: track.shareurl || `https://www.jamendo.com/track/${track.id}`,
    author: track.artist_name || "Jamendo artist",
    authorUrl: track.artist_id ? `https://www.jamendo.com/artist/${track.artist_id}` : "https://www.jamendo.com",
    license,
    licenseUrl: track.license_ccurl,
    requiresAttribution: true,
    attributionText: `Music: "${track.name}" by ${track.artist_name || "unknown"} (Jamendo, ${license})`,
    durationSec: track.duration,
    previewImage: track.image,
    title: track.name,
  };
}

// ==================== network functions ====================

/** Search Jamendo tracks (BGM). Server-side filters exclude NC/ND/SA; results are re-checked client-side. */
export async function searchJamendoTracks(
  query: string,
  opts: { clientId: string; perPage?: number; minSec?: number; maxSec?: number }
): Promise<StockCandidate[]> {
  const { clientId, perPage = 10, minSec, maxSec } = opts;
  if (!clientId) throw new Error("缺少 Jamendo Client ID");
  if (!query?.trim()) throw new Error("检索词为空");

  const params = new URLSearchParams({
    client_id: clientId,
    format: "json",
    limit: String(perPage),
    search: query.trim(),
    audioformat: "mp32", // VBR mp3 — good enough for short-video BGM
    include: "licenses",
    ccnc: "false",
    ccnd: "false",
    ccsa: "false",
  });
  const res = await fetchWithTimeout(`${JAMENDO_API}/tracks/?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jamendo 音乐检索失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { results?: JamendoTrack[] };
  const candidates = (data.results ?? [])
    .map((t) => toJamendoCandidate(t))
    .filter((c): c is StockCandidate => c !== null);
  return filterByDuration(candidates, { minSec, maxSec });
}

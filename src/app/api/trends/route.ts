import { NextRequest, NextResponse } from "next/server";
import { cachedTrends, fetchDomesticTrends, fetchGlobalCreatorTrends, fetchTikTokTrends, fetchTrendingTopics, normalizeGeo } from "@/lib/trends";

/**
 * GET /api/trends —— "what should I post today" trending topics, no API key needed.
 *
 * - `?source=cn` (or no params at all): domestic boards — Douyin hot search with real-time
 *   hot values, Toutiao hot board as fallback. This is the Chinese-first default for the web UI.
 * - `?source=global`: commerce-safe Google Trending Now topics merged from the US, UK,
 *   Australia, and New Zealand. Political and sensitive social/news topics are removed.
 * - `?source=tiktok`: retained for compatible callers, but no longer used by the start page.
 * - `?geo=US`: legacy Google Trends support for existing callers outside the start page.
 *
 * Results go through a 10-minute in-memory cache per source; fetch failure returns an empty
 * list without throwing.
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const source = sp.get("source");
  const geoParam = sp.get("geo");
  const limitRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 50) : 20;

  if (source === "cn" || (!source && !geoParam)) {
    const cn = await cachedTrends("cn", () => fetchDomesticTrends());
    const topics = cn.topics.slice(0, limit);
    return NextResponse.json({ source: cn.source, count: topics.length, topics });
  }

  if (source === "tiktok") {
    const topics = await cachedTrends("tiktok:US:7d", () => fetchTikTokTrends({ limit }));
    return NextResponse.json({ source: "tiktok", geo: "US", count: topics.length, topics });
  }

  if (source === "global") {
    const topics = await cachedTrends("global:google:US-GB-AU-NZ:v4", () => fetchGlobalCreatorTrends({ limit }));
    return NextResponse.json({ source: "google", markets: ["US", "GB", "AU", "NZ"], count: topics.length, topics });
  }

  const geo = normalizeGeo(geoParam);
  const all = await cachedTrends(`geo:${geo}`, () => fetchTrendingTopics(geo));
  const topics = all.slice(0, limit);
  return NextResponse.json({ source: "google", geo, count: topics.length, topics });
}

/**
 * Trending topics — fetches what is trending right now, suggests "what to make a video about",
 * and feeds the result into one-shot video generation.
 *
 * Solves the creator's "I don't know what to make" problem with two keyless source families:
 * - Domestic (Chinese-first default): Douyin hot search + Toutiao hot board JSON endpoints,
 *   with real-time hot values — this is what mass-market Chinese creators actually chase.
 * - Global: Google Trends "Trending now" RSS feeds across several English-speaking
 *   markets. Results are merged, deduplicated, and screened for politics and sensitive
 *   social/news topics before they reach the creator-facing picker.
 * Parsing is pure/unit-testable; network calls have timeout guards; results go through a
 * shared in-memory TTL cache so free endpoints are never hammered per page view.
 */

export type TrendSource = "douyin" | "toutiao" | "google" | "tiktok";

export interface TrendTopic {
  /** Trending keyword, can be used directly as a one-sentence topic */
  title: string;
  /** Human-readable traffic/heat (e.g. "2000+" or "1150万"), optional */
  traffic?: string;
  /** A related news headline providing context for why this term is trending, optional */
  context?: string;
  /** 1-based rank on the source board (domestic boards), optional */
  rank?: number;
  /** Raw hot value from the source board (domestic boards), optional */
  hotValue?: number;
  /** Which board this topic came from, optional */
  source?: TrendSource;
}

function stripCdata(s: string): string {
  const c = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return c ? c[1] : s;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Get the first text content of a tag in an XML fragment (handles CDATA + entities). Tag may contain a colon (e.g. ht:approx_traffic). */
function firstTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m ? decodeXml(stripCdata(m[1])).trim() : null;
}

/** Parse Google Trends daily trending RSS → topic candidates (skip channel header, only process <item> entries). Pure function. */
export function parseTrendsRss(xml: string): TrendTopic[] {
  const blocks = xml.split(/<item>/i).slice(1); // first segment is the channel header, discard it
  const out: TrendTopic[] = [];
  for (const block of blocks) {
    const body = block.split(/<\/item>/i)[0];
    const title = firstTag(body, "title");
    if (!title) continue;
    out.push({
      title,
      traffic: firstTag(body, "ht:approx_traffic") || undefined,
      context: firstTag(body, "ht:news_item_title") || undefined,
    });
  }
  return out;
}

interface TikTokHashtagItem {
  hashtagName?: unknown;
  publishCnt?: unknown;
  rankIndex?: unknown;
  vv?: unknown;
}

/** Compact international counts for TikTok's post volume: 106811 -> "107K posts". */
export function formatTikTokPostCount(value: unknown): string {
  const count = toNumber(value);
  if (!count) return "";
  const compact = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: count >= 1_000_000 ? 1 : 0,
  }).format(count);
  return `${compact} posts`;
}

/** Parse TikTok Creative Center's hashtag board into creator-facing topics. */
export function parseTikTokHashtags(json: unknown): TrendTopic[] {
  const payload = json as { BaseResp?: { StatusCode?: unknown }; items?: unknown };
  if (Number(payload?.BaseResp?.StatusCode ?? 0) !== 0 || !Array.isArray(payload?.items)) return [];
  return payload.items.flatMap((raw, index) => {
    const item = raw as TikTokHashtagItem;
    if (typeof item.hashtagName !== "string" || !item.hashtagName.trim()) return [];
    const posts = toNumber(item.publishCnt);
    const views = toNumber(item.vv);
    return [{
      title: `#${item.hashtagName.trim().replace(/^#+/, "")}`,
      traffic: formatTikTokPostCount(posts),
      context: views ? `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(views)} views` : undefined,
      rank: toNumber(item.rankIndex) ?? index + 1,
      hotValue: posts,
      source: "tiktok" as const,
    }];
  });
}

/**
 * Fetch the US 7-day TikTok hashtag chart exposed by Creative Center itself.
 * No fallback is intentional: an English UI must never label Google or cached demo data
 * as TikTok trends. Network/region/login restrictions therefore resolve to an empty list.
 */
export async function fetchTikTokTrends(opts: { limit?: number } = {}): Promise<TrendTopic[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 50);
    const res = await fetch("https://ads.tiktok.com/CreativeOne/KnowledgeAPI/GetHashtagList", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Referer: "https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en",
      },
      body: JSON.stringify({ timeRange: 7, countryCode: "US", page: 1, limit }),
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    return parseTikTokHashtags(await res.json()).slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch trending topic candidates for a region; falls back to US for invalid regions, returns [] on network failure (non-blocking). */
export async function fetchTrendingTopics(geo = "US", opts: { limit?: number } = {}): Promise<TrendTopic[]> {
  const g = /^[a-z]{2}$/i.test(geo) ? geo.toUpperCase() : "US";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`https://trends.google.com/trending/rss?geo=${g}&hl=en-US`, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; MoraStudio/1.0)",
      },
    });
    if (!res.ok) return [];
    const topics = parseTrendsRss(await res.text());
    return opts.limit ? topics.slice(0, opts.limit) : topics;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a richer English creator board from four public Google Trends markets.
 * Fetches run in parallel; round-robin merging prevents the largest market from
 * crowding out the others. Curation happens before the final limit so filtered
 * politics/news items do not leave the UI with a nearly empty first page.
 */
export async function fetchGlobalCreatorTrends(opts: { limit?: number } = {}): Promise<TrendTopic[]> {
  const regions = ["US", "GB", "AU", "NZ"] as const;
  const boards = await Promise.all(
    regions.map((geo) => fetchTrendingTopics(geo, { limit: 25 }))
  );
  const merged: TrendTopic[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...boards.map((board) => board.length));

  for (let index = 0; index < longest; index++) {
    for (const board of boards) {
      const topic = board[index];
      if (!topic) continue;
      const key = topic.title.trim().toLocaleLowerCase("en-US");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...topic, rank: merged.length + 1, source: "google" });
    }
  }

  const limit = Math.min(Math.max(opts.limit ?? 48, 1), 80);
  return curateCreatorTrends(merged).slice(0, limit);
}

/** Normalize a region code (falls back to US for invalid values). */
export function normalizeGeo(geo: string | null | undefined): string {
  return geo && /^[a-z]{2}$/i.test(geo) ? geo.toUpperCase() : "US";
}

// ---------------------------------------------------------------------------
// Domestic boards (Douyin hot search / Toutiao hot board) — keyless JSON APIs
// ---------------------------------------------------------------------------

/** Format a raw hot value into a compact Chinese reading: 11504605 → "1150万", 170276700 → "1.7亿". */
export function formatHotValue(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1e8) {
    const yi = n / 1e8;
    return `${yi >= 10 ? Math.round(yi) : Math.round(yi * 10) / 10}亿`;
  }
  if (n >= 1e4) return `${Math.round(n / 1e4)}万`;
  return String(Math.round(n));
}

/** Read a numeric field that sources deliver as either number or numeric string. */
function toNumber(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Parse the Douyin hot-search response ({data:{word_list:[{word,hot_value,...}]}}) → topics. Pure function; junk input → []. */
export function parseDouyinHotSearch(json: unknown): TrendTopic[] {
  const data = (json as { data?: { word_list?: unknown } })?.data;
  const list = Array.isArray(data?.word_list) ? data.word_list : [];
  const out: TrendTopic[] = [];
  for (const raw of list) {
    const word = (raw as { word?: unknown })?.word;
    if (typeof word !== "string" || !word.trim()) continue;
    const hotValue = toNumber((raw as { hot_value?: unknown }).hot_value);
    out.push({
      title: word.trim(),
      hotValue,
      traffic: hotValue ? formatHotValue(hotValue) : undefined,
      rank: out.length + 1,
      source: "douyin",
    });
  }
  return out;
}

/** Parse the Toutiao hot-board response ({data:[{Title,HotValue,...}]}) → topics. Pure function; junk input → []. */
export function parseToutiaoHotBoard(json: unknown): TrendTopic[] {
  const list = (json as { data?: unknown })?.data;
  const items = Array.isArray(list) ? list : [];
  const out: TrendTopic[] = [];
  for (const raw of items) {
    const title = (raw as { Title?: unknown })?.Title;
    if (typeof title !== "string" || !title.trim()) continue;
    const hotValue = toNumber((raw as { HotValue?: unknown }).HotValue);
    out.push({
      title: title.trim(),
      hotValue,
      traffic: hotValue ? formatHotValue(hotValue) : undefined,
      rank: out.length + 1,
      source: "toutiao",
    });
  }
  return out;
}

/** Fetch one JSON endpoint with a timeout; returns null on any failure (caller decides the fallback). */
async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch domestic trending topics: Douyin hot search first (what short-video creators actually chase),
 * falling back to the Toutiao hot board when Douyin returns nothing usable. Returns [] only if both fail.
 */
export async function fetchDomesticTrends(): Promise<{ source: TrendSource; topics: TrendTopic[] }> {
  const douyin = await fetchJson(
    "https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383",
    {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Referer: "https://www.douyin.com/",
    }
  );
  const douyinTopics = parseDouyinHotSearch(douyin);
  if (douyinTopics.length >= 5) return { source: "douyin", topics: douyinTopics };

  const toutiao = await fetchJson("https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc", {
    "User-Agent": "Mozilla/5.0",
  });
  const toutiaoTopics = parseToutiaoHotBoard(toutiao);
  if (toutiaoTopics.length > 0) return { source: "toutiao", topics: toutiaoTopics };
  return { source: "douyin", topics: douyinTopics };
}

// ---------------------------------------------------------------------------
// Trend categorization — keyword classifier over titles (works for any source)
// ---------------------------------------------------------------------------
// Douyin's sub-board params are ignored by the keyless endpoint and its
// sentence_tag codes are undocumented numeric buckets — guessing a mapping
// would mislabel topics. A keyword classifier over titles is honest, testable,
// and works across Douyin / Toutiao / Google alike. Unmatched titles stay
// visible under "all" only.

export type TrendCategoryId =
  | "game"
  | "sports"
  | "car"
  | "frontier"
  | "tech"
  | "food"
  | "fashion"
  | "pets"
  | "ent"
  | "life"
  | "society";

/** Category ids in display order (chips render in this order after "all"). */
export const TREND_CATEGORY_IDS: TrendCategoryId[] = [
  "ent",
  "food",
  "frontier",
  "tech",
  "game",
  "sports",
  "fashion",
  "car",
  "pets",
  "life",
  "society",
];

// Match order ≠ display order: specific verticals first so e.g. "CODM联动崩坏3"
// hits game before ent, and generic society verbs ("回应") only catch leftovers.
const CATEGORY_RULES: Array<[TrendCategoryId, RegExp]> = [
  ["game", /游戏|手游|端游|电竞|KPL|LPL|S赛|赛季|皮肤|联动|公测|内测|开服|停服|原神|王者荣耀|和平精英|崩坏|CODM|steam|gaming|gamer|xbox|playstation|nintendo|switch|PS5|fortnite|roblox|minecraft/i],
  ["sports", /比赛|夺冠|冠军|决赛|半决赛|球队|球员|足球|篮球|男篮|女篮|男足|女足|排球|女排|乒乓|羽毛球|网球|游泳|田径|马拉松|奥运|世界杯|亚运|斯诺克|CBA|NBA|健身|瑜伽|骑行|sports?|football|soccer|basketball|baseball|tennis|fitness|workout|NFL|NHL|FIFA/i],
  ["car", /汽车|新车|电车|新能源车|电动车|续航|充电桩|召回|试驾|车展|特斯拉|比亚迪|蔚来|理想汽车|小鹏|问界|驾照|违章|油价/],
  ["frontier", /人工智能|大模型|生成式AI|\bAI\b|AGI|ChatGPT|OpenAI|DeepSeek|Sora|芯片|半导体|先进封装|光刻|量子|脑机|机器人|人形机器人|无人机|卫星|火箭|航天|算力|神经网络|artificialintelligence|machinelearning|robotics|spacex/i],
  ["tech", /手机|发布会|iPhone|苹果|华为|小米|三星|荣耀|OPPO|vivo|操作系统|App|互联网|程序员|数码|technology|technews|android|gadgets?/i],
  ["food", /奶茶|咖啡|美食|好吃|吃播|探店|餐厅|火锅|烧烤|小吃|零食|月饼|粽子|螺蛳粉|预制菜|外卖|食品|饮料|白酒|啤酒|茶饮|food|recipe|cooking|coffee|restaurant|baking/i],
  ["fashion", /穿搭|时尚|时装|秀场|美妆|口红|粉底|护肤|化妆|发型|美甲|香水|包包|球鞋|潮牌|fashion|beauty|makeup|skincare|outfit|style|nails/i],
  ["pets", /小猫|小狗|猫咪|狗狗|宠物|大熊猫|熊猫|动物园|萌宠|pets?|cats?|dogs?|puppy|kitten/i],
  ["ent", /电影|影片|电视剧|综艺|演唱会|音乐节|巡演|官宣|恋情|塌房|番位|主演|票房|首映|开播|收官|大结局|预告|定档|杀青|颁奖|红毯|出道|复出|专辑|新歌|MV|演员|导演|明星|爱豆|粉丝|应援|movie|movies|music|celebrity|netflix|streaming|concert|loveisland/i],
  ["life", /立秋|立春|立夏|立冬|节气|天气|台风|暴雨|降雨|降温|高温|寒潮|旅游|景区|门票|放假|假期|调休|春运|高铁|机票|地铁|lifestyle|travel|home|diy|summer|winter|holiday/i],
  ["society", /警方|通报|调查|事故|遇难|坠|案|判|法院|检方|涉嫌|被拘|被抓|回应|致歉|道歉|辟谣|谣言|作弊|违规|处罚|罚款|地震|洪水|山洪|泥石流|爆炸|火灾|失联|救援|寻人|欠薪|维权|进出口|贸易/],
];

/** Classify a trend title into a creator-facing category; unmatched → null (shown only under "all"). Pure function. */
export function classifyTrendTitle(title: string): TrendCategoryId | null {
  for (const [id, re] of CATEGORY_RULES) {
    if (re.test(title)) return id;
  }
  return null;
}

// The trend picker is a commerce-creation shortcut, not a general news feed.
// Screen both title and related-news context because an innocuous search phrase can
// otherwise inherit political, violent, disaster, health-crisis, or crime context.
const POLITICAL_TREND_RE = /(?:\b(?:election|politics?|president|prime minister|senat(?:e|or)|congress|parliament|democrat|republican|conservative|liberal|left-wing|right-wing|white house|government|federal|supreme court|justice|tariffs?|sanctions?|war|military|nato|royal family|monarch|trump|biden|putin|netanyahu|zelensky|gaza|israel|iran|ukraine|russia)\b|总统|总理|选举|大选|议会|国会|政府|外交|制裁|关税|战争|军事|政治|王室)/i;
const SOCIAL_RISK_TREND_RE = /(?:\b(?:die[ds]?|death|dead|funeral|killed?|murder|shooting|attack|bomb(?:ing)?|explosion|crash|accident|injury|injured|missing|police|arrest(?:ed)?|indictment|lawsuit|trial|court|drugs?|abuse|assault|rape|disaster|flood|earthquake|wildfire|hurricane|tornado|protest|riot|scandal|cancer|diagnosis|outbreak|health battle|condition worsens|hospitali[sz]ed|serious illness)\b|死亡|去世|葬礼|遇难|谋杀|枪击|袭击|爆炸|事故|受伤|失联|警方|逮捕|起诉|法院|毒品|性侵|灾害|洪水|地震|山火|台风|抗议|暴乱|丑闻|癌症|疫情|病危|住院)/i;

/** True when a trend is unsuitable for the commerce-focused creation shortcut. */
export function isSensitiveTrendTopic(topic: Pick<TrendTopic, "title" | "context">): boolean {
  const text = `${topic.title || ""} ${topic.context || ""}`.trim();
  return !text || POLITICAL_TREND_RE.test(text) || SOCIAL_RISK_TREND_RE.test(text);
}

/**
 * Prepare a source board for the creator-facing picker.
 *
 * The source rank remains useful for sorting, but filtering can create visible
 * gaps (2, 12, 17…). The UI therefore assigns its own continuous display
 * position after this function returns. Unclassified topics stay available in
 * “All”; only society/risk headlines are removed from the creation shortcut.
 */
export function curateCreatorTrends(topics: TrendTopic[]): TrendTopic[] {
  const normalized = topics.flatMap((topic, sourceIndex) => {
    if (typeof topic?.title !== "string") return [];
    const title = topic.title.trim();
    if (!title || classifyTrendTitle(title) === "society" || isSensitiveTrendTopic({ ...topic, title })) return [];
    return [{ ...topic, title, sourceIndex }];
  });

  normalized.sort((a, b) => {
    const rankA = typeof a.rank === "number" && a.rank > 0 ? a.rank : Number.POSITIVE_INFINITY;
    const rankB = typeof b.rank === "number" && b.rank > 0 ? b.rank : Number.POSITIVE_INFINITY;
    if (rankA !== rankB) return rankA - rankB;
    const heatA = typeof a.hotValue === "number" ? a.hotValue : 0;
    const heatB = typeof b.hotValue === "number" ? b.hotValue : 0;
    if (heatA !== heatB) return heatB - heatA;
    return a.sourceIndex - b.sourceIndex;
  });

  const seen = new Set<string>();
  return normalized.flatMap(({ sourceIndex: _sourceIndex, ...topic }) => {
    void _sourceIndex;
    const key = topic.title.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [topic];
  });
}

// ---------------------------------------------------------------------------
// Daily-persona topic picking — "one a day" without a scheduler
// ---------------------------------------------------------------------------

export interface DailyPick {
  topic: TrendTopic;
  /** true when the pick actually matched the persona keywords; false = fell back to the top-ranked trend */
  matched: boolean;
}

/**
 * Pick today's topic for a persona: score every trend by how many persona
 * keywords its title contains (whitespace/comma separated), tie-break by board
 * rank. No keyword hits at all → fall back to the top-ranked trend with
 * matched=false so the UI can say so honestly. Pure function.
 */
export function pickDailyTrend(topics: TrendTopic[], personaKeywords: string): DailyPick | null {
  if (topics.length === 0) return null;
  const keywords = personaKeywords
    .split(/[\s,，、;；]+/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  let best: TrendTopic | null = null;
  let bestScore = 0;
  for (const tp of topics) {
    const title = tp.title.toLowerCase();
    const score = keywords.reduce((acc, k) => acc + (title.includes(k) ? 1 : 0), 0);
    if (score > bestScore || (score === bestScore && score > 0 && best && (tp.rank ?? 999) < (best.rank ?? 999))) {
      best = tp;
      bestScore = score;
    }
  }
  if (best && bestScore > 0) return { topic: best, matched: true };
  const top = [...topics].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0];
  return { topic: top, matched: false };
}

// ---------------------------------------------------------------------------
// Shared TTL cache — free endpoints must not be hit once per page view
// ---------------------------------------------------------------------------

export const TRENDS_CACHE_TTL_MS = 10 * 60 * 1000;

const trendsCache = new Map<string, { at: number; value: unknown }>();

/** True when a cached value is "empty" (no topics) — empty results are not cached so transient failures retry quickly. */
function isEmptyResult(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  const topics = (value as { topics?: unknown })?.topics;
  return Array.isArray(topics) && topics.length === 0;
}

/**
 * Memoize a trends fetcher under a key for TRENDS_CACHE_TTL_MS.
 * `now` is injectable for tests; empty results pass through uncached.
 */
export async function cachedTrends<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { ttlMs?: number; now?: () => number } = {}
): Promise<T> {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? TRENDS_CACHE_TTL_MS;
  const hit = trendsCache.get(key);
  if (hit && now() - hit.at < ttl) return hit.value as T;
  const value = await fetcher();
  if (!isEmptyResult(value)) trendsCache.set(key, { at: now(), value });
  return value;
}

/** Test helper: reset the shared cache between cases. */
export function clearTrendsCache(): void {
  trendsCache.clear();
}

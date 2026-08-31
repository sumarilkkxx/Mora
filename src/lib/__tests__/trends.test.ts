import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseTrendsRss,
  normalizeGeo,
  parseDouyinHotSearch,
  parseToutiaoHotBoard,
  fetchDomesticTrends,
  parseTikTokHashtags,
  formatTikTokPostCount,
  formatHotValue,
  cachedTrends,
  clearTrendsCache,
  TRENDS_CACHE_TTL_MS,
  classifyTrendTitle,
  curateCreatorTrends,
  isSensitiveTrendTopic,
  pickDailyTrend,
  TREND_CATEGORY_IDS,
} from "@/lib/trends";
import type { TrendTopic } from "@/lib/trends";

afterEach(() => vi.unstubAllGlobals());

const SAMPLE = `<?xml version="1.0"?><rss><channel>
<title>Daily Search Trends</title>
<item>
  <title>mstr</title>
  <ht:approx_traffic>2000+</ht:approx_traffic>
  <ht:news_item><ht:news_item_title>Strategy Announces &amp; Reserves Plan</ht:news_item_title></ht:news_item>
</item>
<item>
  <title><![CDATA[world cup results]]></title>
  <ht:approx_traffic>5000+</ht:approx_traffic>
</item>
</channel></rss>`;

describe("parseTrendsRss", () => {
  it("只取 <item>，跳过 channel 头部标题；含热度 + 新闻背景 + 实体/CDATA 解码", () => {
    const topics = parseTrendsRss(SAMPLE);
    expect(topics.length).toBe(2); // excludes the channel-level "Daily Search Trends" title
    expect(topics[0]).toEqual({ title: "mstr", traffic: "2000+", context: "Strategy Announces & Reserves Plan" });
    expect(topics[1]).toEqual({ title: "world cup results", traffic: "5000+", context: undefined });
  });
  it("空/无 item → 空数组", () => {
    expect(parseTrendsRss("<rss><channel><title>x</title></channel></rss>")).toEqual([]);
  });
});

describe("normalizeGeo", () => {
  it("合法两字母 → 大写；非法 → US", () => {
    expect(normalizeGeo("jp")).toBe("JP");
    expect(normalizeGeo("US")).toBe("US");
    expect(normalizeGeo("xyz")).toBe("US");
    expect(normalizeGeo(null)).toBe("US");
  });
});

describe("formatHotValue", () => {
  it("万/亿 分档 + 边界", () => {
    expect(formatHotValue(11504605)).toBe("1150万");
    expect(formatHotValue(170276700)).toBe("1.7亿");
    expect(formatHotValue(1_230_000_000)).toBe("12亿");
    expect(formatHotValue(9999)).toBe("9999");
    expect(formatHotValue(0)).toBe("");
    expect(formatHotValue(NaN)).toBe("");
  });
});

describe("parseDouyinHotSearch", () => {
  it("真实结构：word_list → 标题/热度/名次/来源", () => {
    const json = {
      data: {
        word_list: [
          { word: "今日立秋", hot_value: 11359117, video_count: 12000 },
          { word: "  台风白海豚实时路径 ", hot_value: "11504605" },
          { word: 123, hot_value: 1 }, // non-string word dropped
          { hot_value: 999 }, // missing word dropped
          { word: "无热度词条" },
        ],
      },
    };
    const topics = parseDouyinHotSearch(json);
    expect(topics.length).toBe(3);
    expect(topics[0]).toEqual({ title: "今日立秋", hotValue: 11359117, traffic: "1136万", rank: 1, source: "douyin" });
    expect(topics[1].title).toBe("台风白海豚实时路径"); // trimmed; numeric-string hot value accepted
    expect(topics[1].hotValue).toBe(11504605);
    expect(topics[2]).toEqual({ title: "无热度词条", hotValue: undefined, traffic: undefined, rank: 3, source: "douyin" });
  });
  it("畸形输入 → 空数组", () => {
    expect(parseDouyinHotSearch(null)).toEqual([]);
    expect(parseDouyinHotSearch({})).toEqual([]);
    expect(parseDouyinHotSearch({ data: { word_list: "nope" } })).toEqual([]);
  });
});

describe("parseToutiaoHotBoard", () => {
  it("真实结构：data[].Title/HotValue（数字或数字字符串都收）", () => {
    const json = {
      data: [
        { Title: "北京暴雨", HotValue: "17027670" },
        { Title: "进出口超30万亿元", HotValue: 13941077 },
        { NoTitle: true },
      ],
    };
    const topics = parseToutiaoHotBoard(json);
    expect(topics.length).toBe(2);
    expect(topics[0]).toEqual({ title: "北京暴雨", hotValue: 17027670, traffic: "1703万", rank: 1, source: "toutiao" });
    expect(topics[1].source).toBe("toutiao");
  });
  it("畸形输入 → 空数组", () => {
    expect(parseToutiaoHotBoard(undefined)).toEqual([]);
    expect(parseToutiaoHotBoard({ data: {} })).toEqual([]);
  });
});

describe("fetchDomesticTrends", () => {
  it("仅请求抖音；上游失败时不再读取其它平台", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("upstream unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDomesticTrends()).resolves.toEqual({ source: "douyin", topics: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("douyin.com/aweme/v1/web/hot/search/list/");
  });
});

describe("parseTikTokHashtags", () => {
  it("将 Creative Center 的 Hashtag 榜单转为英文选题", () => {
    const topics = parseTikTokHashtags({
      BaseResp: { StatusCode: 0 },
      items: [
        { hashtagName: "dollyparton", publishCnt: 106811, rankIndex: 1, vv: 199988513 },
        { hashtagName: "#cleantok", publishCnt: "32000", rankIndex: 2 },
      ],
    });
    expect(topics[0]).toMatchObject({ title: "#dollyparton", traffic: "107K posts", rank: 1, source: "tiktok" });
    expect(topics[0].context).toBe("200M views");
    expect(topics[1].title).toBe("#cleantok");
    expect(formatTikTokPostCount(1_250_000)).toBe("1.3M posts");
  });
  it("失败响应或畸形数据不会伪造热点", () => {
    expect(parseTikTokHashtags({ BaseResp: { StatusCode: 1 }, items: [{ hashtagName: "fake" }] })).toEqual([]);
    expect(parseTikTokHashtags(null)).toEqual([]);
  });
});

describe("classifyTrendTitle", () => {
  it("真实榜单样本分入正确类目；规则顺序保证垂类优先", () => {
    expect(classifyTrendTitle("CODM联动崩坏3")).toBe("game"); // 联动 also ent-ish → game wins by order
    expect(classifyTrendTitle("秋天的第一杯奶茶我先喝了")).toBe("food");
    expect(classifyTrendTitle("台风白海豚实时路径")).toBe("life");
    expect(classifyTrendTitle("四川宜宾高县发生4.9级地震")).toBe("society");
    expect(classifyTrendTitle("河南三支一扶笔试存在组织作弊")).toBe("society");
    // state TV news is not creator content — must stay unclassified so the curated board drops it
    expect(classifyTrendTitle("新闻联播")).toBe(null);
    expect(classifyTrendTitle("iPhone 17 发布会定档")).toBe("tech");
    expect(classifyTrendTitle("拆解玄戒O100的先进封装")).toBe("frontier");
    expect(classifyTrendTitle("人形机器人进入工厂实训")).toBe("frontier");
    expect(classifyTrendTitle("女排世锦赛决赛")).toBe("sports");
    expect(classifyTrendTitle("大熊猫花花营业")).toBe("pets");
    expect(classifyTrendTitle("明星回应恋情")).toBe("ent"); // 回应 is also society → ent wins by order
  });
  it("未命中 → null（只留在「全部」）；类目 id 集合稳定", () => {
    expect(classifyTrendTitle("海上大风车给油田直供绿电")).toBe(null);
    expect(TREND_CATEGORY_IDS.length).toBe(11);
  });
});

describe("curateCreatorTrends", () => {
  it("按源榜位稳定排序、去重，并保留未分类热点供「全部」展示", () => {
    const board: TrendTopic[] = [
      { title: "  普通生活热点  ", rank: 8, hotValue: 80 },
      { title: "新款口红试色", rank: 3, hotValue: 300 },
      { title: "普通生活热点", rank: 9, hotValue: 70 },
      { title: "CODM联动崩坏3", rank: 5, hotValue: 200 },
    ];
    expect(curateCreatorTrends(board).map((topic) => topic.title)).toEqual([
      "新款口红试色",
      "CODM联动崩坏3",
      "普通生活热点",
    ]);
  });

  it("过滤政治、犯罪、灾难、伤亡与敏感社会新闻，并检查关联新闻语境", () => {
    const board: TrendTopic[] = [
      { title: "new iPhone camera features", rank: 1 },
      { title: "presidential election polls", rank: 2 },
      { title: "celebrity update", context: "Actor receives cancer diagnosis", rank: 3 },
      { title: "earthquake warning", rank: 4 },
      { title: "summer skincare routine", rank: 5 },
    ];
    expect(curateCreatorTrends(board).map((topic) => topic.title)).toEqual([
      "new iPhone camera features",
      "summer skincare routine",
    ]);
    expect(isSensitiveTrendTopic({ title: "White House tariff announcement" })).toBe(true);
    expect(isSensitiveTrendTopic({ title: "Clarence Thomas", context: "A conservative Supreme Court justice" })).toBe(true);
    expect(isSensitiveTrendTopic({ title: "Royal update", context: "Royal family gathers as his condition worsens" })).toBe(true);
    expect(isSensitiveTrendTopic({ title: "theme park brain injury" })).toBe(true);
    expect(isSensitiveTrendTopic({ title: "celebrity update", context: "Funeral details revealed" })).toBe(true);
    expect(isSensitiveTrendTopic({ title: "rugby player", context: "Police investigate drugs purchase" })).toBe(true);
    expect(isSensitiveTrendTopic({ title: "李常官任民政部部长" })).toBe(true);
    expect(isSensitiveTrendTopic({ title: "easy coffee recipes" })).toBe(false);
  });

  it("只移除空标题和社会风险内容；无榜位时按热度降序", () => {
    const board: TrendTopic[] = [
      { title: "城市探店合集", hotValue: 20 },
      { title: "警方通报事故调查", rank: 1, hotValue: 999 },
      { title: "周末露营装备", hotValue: 80 },
      { title: "   ", hotValue: 100 },
    ];
    expect(curateCreatorTrends(board).map((topic) => topic.title)).toEqual([
      "周末露营装备",
      "城市探店合集",
    ]);
  });
});

describe("pickDailyTrend", () => {
  const board: TrendTopic[] = [
    { title: "台风白海豚实时路径", rank: 1 },
    { title: "新款口红试色", rank: 2 },
    { title: "护肤品成分党实测口红", rank: 3 },
    { title: "CODM联动崩坏3", rank: 4 },
  ];
  it("按人设关键词计分选题；多词命中优先，同分取榜位高", () => {
    expect(pickDailyTrend(board, "口红 护肤")).toEqual({ topic: board[2], matched: true }); // 2 hits beats 1 hit
    expect(pickDailyTrend(board, "口红")).toEqual({ topic: board[1], matched: true }); // tie → higher rank
  });
  it("无命中 → 诚实回退榜一 matched=false；空榜 → null", () => {
    expect(pickDailyTrend(board, "钓鱼")).toEqual({ topic: board[0], matched: false });
    expect(pickDailyTrend([], "口红")).toBe(null);
  });
  it("分隔符宽容：逗号/顿号/分号/空格混用", () => {
    expect(pickDailyTrend(board, "钓鱼，口红、露营")?.topic).toBe(board[1]);
  });
});

describe("cachedTrends", () => {
  beforeEach(() => clearTrendsCache());

  it("默认缓存周期严格为 10 分钟", () => {
    expect(TRENDS_CACHE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("TTL 内命中缓存不再打源；不同 key 各自取数", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return { source: "douyin", topics: [{ title: "x" }] };
    };
    let t = 0;
    const now = () => t;
    await cachedTrends("cn", fetcher, { now });
    t = 1000;
    await cachedTrends("cn", fetcher, { now });
    expect(calls).toBe(1);
    await cachedTrends("geo:US", fetcher, { now });
    expect(calls).toBe(2);
  });

  it("TTL 过期后重取；空结果不缓存（瞬时失败可快速重试）", async () => {
    let calls = 0;
    let payload: { topics: { title: string }[] } = { topics: [] };
    const fetcher = async () => {
      calls++;
      return payload;
    };
    let t = 0;
    const now = () => t;
    await cachedTrends("cn", fetcher, { now, ttlMs: 100 });
    await cachedTrends("cn", fetcher, { now, ttlMs: 100 });
    expect(calls).toBe(2); // empty → uncached → refetched
    payload = { topics: [{ title: "ok" }] };
    await cachedTrends("cn", fetcher, { now, ttlMs: 100 });
    expect(calls).toBe(3);
    t = 99;
    await cachedTrends("cn", fetcher, { now, ttlMs: 100 });
    expect(calls).toBe(3); // within TTL → cached
    t = 101;
    await cachedTrends("cn", fetcher, { now, ttlMs: 100 });
    expect(calls).toBe(4); // expired → refetched
  });
});

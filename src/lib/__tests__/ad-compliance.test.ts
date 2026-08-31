import { describe, it, expect } from "vitest";
import { checkAdCompliance, checkScriptCompliance } from "@/lib/ad-compliance";

describe("checkAdCompliance（广告法风险词扫描）", () => {
  it("命中绝对化用语", () => {
    const terms = checkAdCompliance("这是全网第一的最佳好物，100%好评").map((x) => x.term);
    expect(terms).toContain("全网第一");
    expect(terms).toContain("最佳");
    expect(terms).toContain("100%");
  });

  it("命中医疗/虚假功效", () => {
    const terms = checkAdCompliance("三天见效，根治痘痘，疗效显著").map((x) => x.term);
    expect(terms).toContain("三天见效");
    expect(terms).toContain("根治");
    expect(terms).toContain("疗效");
  });

  it("命中需认证宣称（med 级）", () => {
    const v = checkAdCompliance("纯天然无添加配方");
    expect(v.map((x) => x.term)).toEqual(expect.arrayContaining(["纯天然", "无添加"]));
    expect(v.find((x) => x.term === "纯天然")?.severity).toBe("med");
  });

  it("去重 + high 在前", () => {
    const v = checkAdCompliance("最佳最佳，纯天然，全网第一");
    expect(v.filter((x) => x.term === "最佳").length).toBe(1); // 去重
    expect(v[0].severity).toBe("high"); // high 排前
  });

  it("重叠风险词只报更长的那个（100%天然 不再额外报 100%）", () => {
    const terms = checkAdCompliance("100%天然成分").map((x) => x.term);
    expect(terms).toContain("100%天然");
    expect(terms).not.toContain("100%"); // 被更长词覆盖，不重复矛盾提示
  });

  it("合规文案无命中（无误报）", () => {
    expect(checkAdCompliance("这款抽纸柔软亲肤，囤货很划算，回购率高")).toEqual([]);
  });

  it("空 / null 文本", () => {
    expect(checkAdCompliance("")).toEqual([]);
    expect(checkAdCompliance(null as unknown as string)).toEqual([]);
  });

  it("每条都带修改建议", () => {
    for (const v of checkAdCompliance("最佳 根治 纯天然")) expect(v.suggestion.length).toBeGreaterThan(0);
  });
});

describe("checkScriptCompliance（整条脚本扫描）", () => {
  it("扫描旁白 + 贴片并汇总去重", () => {
    const shots = [
      { voiceover: "全网第一好物", textOverlay: { text: "100%好评" } },
      { voiceover: "根治痘痘", textOverlay: null },
    ];
    const terms = checkScriptCompliance(shots).map((x) => x.term);
    expect(terms).toContain("全网第一");
    expect(terms).toContain("100%");
    expect(terms).toContain("根治");
  });

  it("空脚本无命中", () => {
    expect(checkScriptCompliance([])).toEqual([]);
  });
});

describe("2026-07 增补词表（价格绝对化 + 虚假紧迫）", () => {
  it("价格绝对化：全网最低价 只报最长命中一条（不重复报 全网最低/最低价）", () => {
    const hits = checkAdCompliance("今天全网最低价，冲！");
    const terms = hits.map((x) => x.term);
    expect(terms).toEqual(["全网最低价"]);
    expect(hits[0].category).toBe("绝对化用语");
    expect(hits[0].severity).toBe("high");
  });

  it("史上最低/销量冠军 命中绝对化用语", () => {
    const terms = checkAdCompliance("史上最低，销量冠军实至名归").map((x) => x.term);
    expect(terms).toContain("史上最低");
    expect(terms).toContain("销量冠军");
  });

  it("虚假紧迫：最后一天/马上涨价 → med 级警告并给可举证建议", () => {
    const hits = checkAdCompliance("最后一天，明天马上涨价");
    const urgency = hits.filter((x) => x.category === "虚假紧迫");
    expect(urgency.map((x) => x.term)).toEqual(expect.arrayContaining(["最后一天", "马上涨价"]));
    for (const u of urgency) {
      expect(u.severity).toBe("med");
      expect(u.suggestion).toContain("举证");
    }
  });

  it("正常促销文案不误伤（相对表述/真实日期）", () => {
    expect(checkAdCompliance("这款很受欢迎，活动到本周日结束")).toEqual([]);
  });
});

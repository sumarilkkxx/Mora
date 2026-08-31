import { describe, it, expect } from "vitest";
import { keyframeStaticWarnings, keyframeInstantLine } from "@/lib/prompt-lint";
import { clampSellingPoints } from "@/lib/script-engine/generator";
import { chainByDefault } from "@/lib/assets-view";

describe("keyframeStaticWarnings（关键帧静态 lint：时序词=多瞬间，静帧画不出）", () => {
  it("中文时序连接词命中：先…然后 / 逐渐 / 之后", () => {
    expect(keyframeStaticWarnings("她先拧开瓶盖然后涂抹").length).toBeGreaterThan(0);
    expect(keyframeStaticWarnings("笑容逐渐浮现")).toContain("逐渐/渐渐");
    expect(keyframeStaticWarnings("下一秒她惊呆了")).toContain("之后/下一秒");
    expect(keyframeStaticWarnings("她开始涂抹粉底")).toContain("开始做某事");
  });

  it("英文时序词命中：then / starts to / gradually", () => {
    expect(keyframeStaticWarnings("she opens the jar, then applies cream")).toContain("then");
    expect(keyframeStaticWarnings("she starts to smile")).toContain("starts to");
    expect(keyframeStaticWarnings("light gradually warms up")).toContain("gradually");
  });

  it("单瞬间写法不误报：定格/mid-pour/势能句式", () => {
    expect(keyframeStaticWarnings("指尖悬在泵头上方，动作即将开始前一瞬的定格")).toEqual([]);
    expect(keyframeStaticWarnings("hand frozen mid-pour, cream suspended above the jar")).toEqual([]);
    expect(keyframeStaticWarnings("女生举着纸巾对镜头，窗光从左侧来")).toEqual([]);
  });

  it("空/未定义输入返回空数组", () => {
    expect(keyframeStaticWarnings("")).toEqual([]);
    expect(keyframeStaticWarnings(undefined)).toEqual([]);
  });

  it("keyframeInstantLine 语言跟随 prompt：中文/英文/空默认中文", () => {
    expect(keyframeInstantLine("女生特写")).toContain("定格");
    expect(keyframeInstantLine("close-up of a girl")).toContain("freeze the instant");
    expect(keyframeInstantLine("")).toContain("定格");
  });
});

describe("clampSellingPoints（卖点三硬约束的服务端兜底）", () => {
  it("超过 3 条截断为 3 条，超长条截到 15 字", () => {
    const out = clampSellingPoints(["一抽三层加厚不破", "这款产品的性价比在同类目里真的非常非常高了", "母婴可用", "多余的第四条"]);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe("这款产品的性价比在同类目里真的");
    expect(out[1].length).toBe(15);
  });

  it("过滤空串与非字符串；非数组输入返回空数组", () => {
    expect(clampSellingPoints(["  ", "真材实料", 42, null])).toEqual(["真材实料"]);
    expect(clampSellingPoints("not an array")).toEqual([]);
    expect(clampSellingPoints(undefined)).toEqual([]);
  });
});

describe("chainByDefault（demo 镜路径即内容，默认不做尾帧链式）", () => {
  it("demo 默认不链，其余类型默认链", () => {
    expect(chainByDefault("demo")).toBe(false);
    for (const t of ["hook", "pain_point", "product_reveal", "social_proof", "cta"]) {
      expect(chainByDefault(t)).toBe(true);
    }
  });
  it("未知/未定义类型默认链（保持旧行为）", () => {
    expect(chainByDefault(undefined)).toBe(true);
    expect(chainByDefault("whatever")).toBe(true);
  });
});

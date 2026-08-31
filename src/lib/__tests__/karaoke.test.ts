import { describe, it, expect } from "vitest";
import { toAssTime, assEscapeText, splitKaraokeUnits, buildKaraokeAss } from "@/lib/video-composer/karaoke";

describe("toAssTime", () => {
  it("秒 → H:MM:SS.cc", () => {
    expect(toAssTime(0)).toBe("0:00:00.00");
    expect(toAssTime(1.5)).toBe("0:00:01.50");
    expect(toAssTime(65.25)).toBe("0:01:05.25");
  });
  it("负数夹到 0", () => {
    expect(toAssTime(-3)).toBe("0:00:00.00");
  });
  it("厘秒进位正确跨秒/分/时（不再截断成 .99）", () => {
    // 2.999s 四舍五入到 3.00（旧实现错误地截断成 2.99）
    expect(toAssTime(2.999)).toBe("0:00:03.00");
    // 边界进位：秒→分、分→时都要正确进位
    expect(toAssTime(59.996)).toBe("0:01:00.00");
    expect(toAssTime(3599.996)).toBe("1:00:00.00");
    // 不到进位阈值的正常四舍五入不受影响
    expect(toAssTime(2.994)).toBe("0:00:02.99");
  });
});

describe("assEscapeText", () => {
  it("转义 { } \\ 与换行", () => {
    expect(assEscapeText("a{b}c")).toBe("a\\{b\\}c");
    expect(assEscapeText("x\\y")).toBe("x\\\\y");
    expect(assEscapeText("行1\n行2")).toBe("行1\\N行2");
  });
});

describe("splitKaraokeUnits", () => {
  it("CJK 按字切", () => {
    expect(splitKaraokeUnits("立省五折")).toEqual(["立", "省", "五", "折"]);
  });
  it("拉丁按词切（空格并入词尾）", () => {
    expect(splitKaraokeUnits("buy it now")).toEqual(["buy ", "it ", "now"]);
  });
  it("中英混排", () => {
    expect(splitKaraokeUnits("立省50% off")).toEqual(["立", "省", "50% ", "off"]);
  });
  it("空串 → 空数组", () => {
    expect(splitKaraokeUnits("")).toEqual([]);
    expect(splitKaraokeUnits("   ")).toEqual([]);
  });
});

describe("buildKaraokeAss", () => {
  const lines = [{ text: "立省五折闭眼入", startTime: 0, endTime: 3 }];

  it("含 ASS 头/样式/逐字 \\k 事件", () => {
    const ass = buildKaraokeAss(lines);
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("Style: K,");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:03.00,K,");
    expect(ass).toContain("{\\k"); // per-character karaoke tag
    expect(ass).toContain("立");
  });

  it("一行内各 \\k 之和等于行时长（厘秒）", () => {
    const ass = buildKaraokeAss([{ text: "立省五折闭眼入", startTime: 0, endTime: 3 }]);
    const dialogue = ass.split("\n").find((l) => l.startsWith("Dialogue:"))!;
    const ks = [...dialogue.matchAll(/\\k(\d+)/g)].map((m) => Number(m[1]));
    expect(ks.length).toBe(7); // 7 characters
    expect(ks.reduce((a, b) => a + b, 0)).toBe(300); // 3s = 300cs
  });

  it("自定义样式生效", () => {
    const ass = buildKaraokeAss(lines, { fontName: "Noto Sans CJK SC", primaryColour: "&H0000FF00" });
    expect(ass).toContain("Noto Sans CJK SC");
    expect(ass).toContain("&H0000FF00");
  });

  it("默认 MarginV 走安全区（PlayResY 1920 → 326，避开平台底部 UI），可被显式覆盖", () => {
    const f = buildKaraokeAss(lines).split("\n").find((l) => l.startsWith("Style: K,"))!.split(",");
    expect(Number(f[f.length - 2])).toBe(326); // safe-zone marginV (old value 240 fell inside the dead zone)
    const f2 = buildKaraokeAss(lines, { marginV: 100 }).split("\n").find((l) => l.startsWith("Style: K,"))!.split(",");
    expect(Number(f2[f2.length - 2])).toBe(100); // explicit override takes precedence
  });

  it("含数字单位自动强调：放大字号 + 热色 \\1c（价格/折扣突出）", () => {
    const d = buildKaraokeAss([{ text: "立省50%闭眼入", startTime: 0, endTime: 3 }])
      .split("\n")
      .find((l) => l.startsWith("Dialogue:"))!;
    const fsVals = [...d.matchAll(/\\fs(\d+)/g)].map((m) => Number(m[1]));
    expect(new Set(fsVals).size).toBeGreaterThan(1); // emphasis font size differs from normal font size
    expect(Math.max(...fsVals)).toBeGreaterThan(Math.min(...fsVals)); // numeric units are enlarged
    expect(d).toContain("&H0050FF&"); // orange-red emphasis color is present
  });

  it("emphasizeNumbers:false 关闭数字强调", () => {
    const d = buildKaraokeAss([{ text: "立省50%", startTime: 0, endTime: 2 }], { emphasizeNumbers: false })
      .split("\n")
      .find((l) => l.startsWith("Dialogue:"))!;
    const fsVals = [...d.matchAll(/\\fs(\d+)/g)].map((m) => Number(m[1]));
    expect(new Set(fsVals).size).toBe(1); // all characters use the same font size
    expect(d).not.toContain("&H0050FF&"); // no emphasis color
  });

  it("单位数 > 总厘秒数（极短时长+长旁白）不产生负 \\k", () => {
    const d = buildKaraokeAss([{ text: "买它现在马上下单抢购吧", startTime: 0, endTime: 0.05 }])
      .split("\n")
      .find((l) => l.startsWith("Dialogue:"))!;
    const ks = [...d.matchAll(/\\k(-?\d+)/g)].map((m) => Number(m[1]));
    expect(ks.length).toBeGreaterThan(0);
    expect(ks.every((k) => k >= 1)).toBe(true); // no negative \k values
  });

  it("过滤非法行（endTime<=startTime / 空文本）", () => {
    const ass = buildKaraokeAss([
      { text: "好物", startTime: 0, endTime: 2 },
      { text: "", startTime: 2, endTime: 4 },
      { text: "坏行", startTime: 5, endTime: 5 },
    ]);
    expect((ass.match(/Dialogue:/g) || []).length).toBe(1);
  });
});

describe("buildKaraokeLineTextFromWords（真实词时间驱动 \\k）", () => {
  const cfg = { baseFs: 46, primaryC: "&H00F0FF&", accentC: "&H0050FF&", emphasize: true, emphScale: 1.35 };

  it("按词时间出 \\k：逗号停顿并入前词、前导静音出空 \\k 块", async () => {
    const { buildKaraokeLineTextFromWords } = await import("@/lib/video-composer/karaoke");
    // 「早上 好」两词，0.5s 前导静音，词间 0.4s 停顿
    const line = {
      text: "早上好",
      startTime: 10,
      endTime: 13,
      words: [
        { text: "早上", startSec: 10.5, endSec: 11.1 },
        { text: "好", startSec: 11.5, endSec: 11.8 },
      ],
    };
    const body = buildKaraokeLineTextFromWords(line, cfg);
    // 前导静音 0.5s = {\k50}
    expect(body.startsWith("{\\k50}")).toBe(true);
    // 「早」0.3s（词内均分）、「上」到下词起点=0.3+0.4停顿=0.7s、「好」0.3s
    expect(body).toContain("\\k30\\");
    expect(body).toContain("\\k70\\");
    const ks = [...body.matchAll(/\\k(\d+)/g)].map((m) => Number(m[1]));
    expect(ks).toEqual([50, 30, 70, 30]);
  });

  it("词文本与行文本失配超容忍度 → 返回空串（回退估算，不弄脏字幕）", async () => {
    const { buildKaraokeLineTextFromWords } = await import("@/lib/video-composer/karaoke");
    const line = {
      text: "这是一句完全不同的很长很长的台词内容",
      startTime: 0,
      endTime: 3,
      words: [{ text: "短", startSec: 0, endSec: 0.3 }],
    };
    expect(buildKaraokeLineTextFromWords(line, cfg)).toBe("");
  });

  it("无 words → 返回空串", async () => {
    const { buildKaraokeLineTextFromWords } = await import("@/lib/video-composer/karaoke");
    expect(buildKaraokeLineTextFromWords({ text: "你好", startTime: 0, endTime: 2 }, cfg)).toBe("");
  });
});

describe("buildKaraokeAss speechEndTime（估算路径只铺语音窗，不再爬过呼吸间隙）", () => {
  it("有 speechEndTime 时 \\k 总时长≈语音窗而非展示窗", async () => {
    const { buildKaraokeAss } = await import("@/lib/video-composer/karaoke");
    // 展示窗 4s，语音只有 2s
    const ass = buildKaraokeAss([{ text: "你好世界", startTime: 0, endTime: 4, speechEndTime: 2 }]);
    const ks = [...ass.matchAll(/\\k(\d+)/g)].map((m) => Number(m[1]));
    const total = ks.reduce((a, b) => a + b, 0);
    expect(total).toBe(200); // 2s = 200cs（旧行为是 400cs，高亮拖过静音段）
  });
});

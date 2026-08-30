import { describe, it, expect } from "vitest";
import { buildNativeFeelFilter } from "@/lib/video-composer/native-feel";

describe("buildNativeFeelFilter", () => {
  const base = { width: 1080, height: 1920 };

  it("over-scales then crops back to the original size with a labeled output", () => {
    const vf = buildNativeFeelFilter(base);
    expect(vf.startsWith("[0:v]")).toBe(true);
    expect(vf.endsWith("[vout]")).toBe(true);
    // subtle margin = round(1080*0.011)=12 / round(1920*0.011)=21
    expect(vf).toContain("scale=1104:1962");
    expect(vf).toContain("crop=w=1080:h=1920");
  });

  it("keeps the crop window inside the frame (sine amplitudes sum ≤ margin)", () => {
    for (const strength of ["subtle", "medium"] as const) {
      const vf = buildNativeFeelFilter({ ...base, strength });
      const m = vf.match(/scale=(\d+):(\d+)/);
      const mx = (parseInt(m![1], 10) - 1080) / 2;
      const my = (parseInt(m![2], 10) - 1920) / 2;
      // x expression: "<mx>+<a1>*sin(...)+<a2>*sin(...)" — extremes are mx±(a1+a2), must stay in [0, 2mx]
      const xm = vf.match(/x='(\d+)\+(\d+)\*sin\([^)]*\)\+(\d+)\*sin/);
      expect(xm).not.toBeNull();
      expect(parseInt(xm![2], 10) + parseInt(xm![3], 10)).toBeLessThanOrEqual(mx);
      const ym = vf.match(/y='(\d+)\+(\d+)\*cos\([^)]*\)\+(\d+)\*sin/);
      expect(ym).not.toBeNull();
      expect(parseInt(ym![2], 10) + parseInt(ym![3], 10)).toBeLessThanOrEqual(my);
    }
  });

  it("medium is stronger than subtle (bigger margin, more grain, deeper de-polish)", () => {
    const subtle = buildNativeFeelFilter(base);
    const medium = buildNativeFeelFilter({ ...base, strength: "medium" });
    expect(subtle).toContain("noise=alls=5");
    expect(medium).toContain("noise=alls=9");
    expect(medium).toContain("scale=1124:1996"); // round(1080*0.02)=22 / round(1920*0.02)=38
    expect(subtle).toContain("saturation=0.95");
    expect(medium).toContain("saturation=0.92");
  });

  it("seed shifts the sine phases so variants get different motion", () => {
    const a = buildNativeFeelFilter(base);
    const b = buildNativeFeelFilter({ ...base, seed: 7 });
    expect(a).not.toBe(b);
    // structure identical apart from phases
    expect(b).toContain("scale=1104:1962");
    expect(b).toContain("crop=w=1080:h=1920");
  });

  it("grain can be disabled and vignette is opt-in", () => {
    expect(buildNativeFeelFilter({ ...base, grain: false })).not.toContain("noise=");
    expect(buildNativeFeelFilter(base)).not.toContain("vignette");
    expect(buildNativeFeelFilter({ ...base, vignette: true })).toContain("vignette=angle=PI/8");
  });

  it("scaled dimensions stay even for yuv420p (landscape + square too)", () => {
    for (const [w, h] of [[1920, 1080], [720, 720], [720, 1280]] as const) {
      const m = buildNativeFeelFilter({ width: w, height: h }).match(/scale=(\d+):(\d+)/);
      expect(parseInt(m![1], 10) % 2).toBe(0);
      expect(parseInt(m![2], 10) % 2).toBe(0);
    }
  });
});

describe("v0.8.89 扩展：strong 档 / 光晕 / 平台二压感", () => {
  it("strong（边走边拍）：更大裁切余量 + 微旋转呼吸滚动", () => {
    const strong = buildNativeFeelFilter({ width: 1080, height: 1920, strength: "strong" });
    expect(strong).toContain("rotate=");
    // 余量比 medium 更大（3% vs 2%）
    expect(strong).toContain("scale=1144:2036"); // 1080+2*32, 1920+2*58
    const medium = buildNativeFeelFilter({ width: 1080, height: 1920, strength: "medium" });
    expect(medium).not.toContain("rotate=");
  });

  it("halation：提亮部→高斯模糊→暖化→screen 混合，输出仍是 [vout]", () => {
    const f = buildNativeFeelFilter({ width: 1080, height: 1920, halation: true });
    expect(f).toContain("lutyuv=y='if(gt(val,200),val,0)'");
    expect(f).toContain("gblur=");
    expect(f).toContain("blend=all_mode=screen[vout]");
    // 默认关：不出现光晕链
    expect(buildNativeFeelFilter({ width: 1080, height: 1920 })).not.toContain("gblur");
  });

  it("phoneCompress：2/3 降采样再回升（世代损失）+ 过锐 + 手机 HDR 艳丽档替代去精修调色", () => {
    const f = buildNativeFeelFilter({ width: 1080, height: 1920, phoneCompress: true });
    expect(f).toContain("scale=720:1280:flags=bilinear");
    expect(f).toContain("scale=1080:1920,");
    expect(f).toContain("unsharp=");
    expect(f).toContain("eq=saturation=1.12:contrast=1.05");
    // 去精修调色（saturation<1）不应同时出现
    expect(f).not.toContain("eq=saturation=0.9");
  });

  it("三个新选项全关时输出与旧版字节一致（默认行为不变）", () => {
    const legacy = buildNativeFeelFilter({ width: 1080, height: 1920 });
    const explicit = buildNativeFeelFilter({ width: 1080, height: 1920, halation: false, phoneCompress: false });
    expect(explicit).toBe(legacy);
  });
});

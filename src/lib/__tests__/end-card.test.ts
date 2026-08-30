import { describe, it, expect } from "vitest";
import { buildEndCardFilter } from "@/lib/video-composer/end-card";

describe("buildEndCardFilter（片尾扫码购买 QR 叠加）", () => {
  it("无 CTA：缩放 QR + 居中叠加，尾段时间窗，输出 [vout]", () => {
    const vf = buildEndCardFilter({ width: 1080, totalDuration: 20 });
    expect(vf).toContain("[1:v]scale=");
    expect(vf).toContain("[0:v][qr]overlay=");
    expect(vf).toContain("(main_w-overlay_w)/2"); // 水平居中
    expect(vf).toContain("enable='gte(t,17.00)'"); // 最后 3 秒(20-3)
    expect(vf.trim().endsWith("[vout]")).toBe(true);
    expect(vf).not.toContain("drawtext="); // 无 CTA
  });

  it("带 CTA：追加居中盒装文字并串到 [vout]，转义生效", () => {
    const vf = buildEndCardFilter({ width: 1080, totalDuration: 25, ctaText: "扫码购买 ↓" });
    expect(vf).toContain("overlay=");
    expect(vf).toContain("[ov];[ov]"); // overlay → drawtext 链
    expect(vf).toContain("drawtext=");
    expect(vf).toContain("expansion=none");
    expect(vf).toContain("x=(w-text_w)/2"); // CTA 居中
    expect(vf.trim().endsWith("[vout]")).toBe(true);
    // CTA 与 QR 用同一尾段时间窗
    expect((vf.match(/enable='gte\(t,22\.00\)'/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("尾段时长夹到视频长度（短视频不越界）", () => {
    const vf = buildEndCardFilter({ width: 720, totalDuration: 2, seconds: 3 });
    expect(vf).toContain("enable='gte(t,0.00)'"); // show=min(3,2)=2 → start=0
  });

  it("时长缺失（0）时不产生负的 start", () => {
    const vf = buildEndCardFilter({ width: 1080, totalDuration: 0 });
    expect(vf).toContain("enable='gte(t,0.00)'");
  });
});

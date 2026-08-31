import { describe, it, expect } from "vitest";
import { buildComplianceOverlays } from "@/lib/compliance-overlays";

describe("buildComplianceOverlays", () => {
  it("默认全关 → 空数组", () => {
    expect(buildComplianceOverlays({}, 10)).toEqual([]);
  });

  it("ctaText → 片尾最后 2.5s 的 highlight CTA", () => {
    const out = buildComplianceOverlays({ ctaText: "👇 点击下方小黄车" }, 10);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: "👇 点击下方小黄车", style: "highlight", startTime: 7.5, endTime: 10 });
  });

  it("短视频 CTA 尾时长不会为负（夹取到总时长）", () => {
    const out = buildComplianceOverlays({ ctaText: "买它" }, 1.5);
    expect(out[0].startTime).toBe(0);
    expect(out[0].endTime).toBe(1.5);
  });

  it("空 ctaText / 空白 → 不加 CTA", () => {
    expect(buildComplianceOverlays({ ctaText: "   " }, 10)).toEqual([]);
  });

  it("aigcBadge → 片头 badge 角标，默认文案，展示 4s（≥2s 平台合规下限）", () => {
    const out = buildComplianceOverlays({ aigcBadge: true }, 30);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: "内容由 AI 生成", style: "badge", startTime: 0, endTime: 4 });
  });

  it("超短成片：角标夹取到总时长（不超片长）", () => {
    const out = buildComplianceOverlays({ aigcBadge: true }, 1.2);
    expect(out[0].startTime).toBe(0);
    expect(out[0].endTime).toBe(1.2);
  });

  it("aigcBadgeText 覆盖默认文案；空白回退默认", () => {
    expect(buildComplianceOverlays({ aigcBadge: true, aigcBadgeText: "AI 合成内容" }, 30)[0].text).toBe("AI 合成内容");
    expect(buildComplianceOverlays({ aigcBadge: true, aigcBadgeText: "  " }, 30)[0].text).toBe("内容由 AI 生成");
  });

  it("角标 + CTA 同开：badge 在片头、highlight 在片尾，互不重叠", () => {
    const out = buildComplianceOverlays({ aigcBadge: true, ctaText: "买它" }, 30);
    expect(out).toHaveLength(2);
    const badge = out.find((o) => o.style === "badge")!;
    const cta = out.find((o) => o.style === "highlight")!;
    expect(badge.endTime).toBeLessThanOrEqual(cta.startTime);
  });
});

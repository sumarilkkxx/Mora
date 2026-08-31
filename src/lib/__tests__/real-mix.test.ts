import { describe, it, expect } from "vitest";
import { shotReality, computeRealMix, realMixFromRows } from "@/lib/real-mix";
import { gateItemFromRealMix } from "@/lib/release-gate";

describe("shotReality 分类", () => {
  it("已配素材按 assets.type 分类：ai_generated=ai，其余=real", () => {
    expect(shotReality({ assetType: "ai_generated", done: true })).toBe("ai");
    expect(shotReality({ assetType: "stock_footage", done: true })).toBe("real");
    expect(shotReality({ assetType: "user_upload", done: true })).toBe("real");
    expect(shotReality({ assetType: "product_image", done: true })).toBe("real");
  });

  it("商品图分镜无落库行也算 real（直接用用户商品照）", () => {
    expect(shotReality({ visualSource: "product_image", done: false })).toBe("real");
  });

  it("未配画面 → null", () => {
    expect(shotReality({ visualSource: "ai_generate", done: false })).toBe(null);
  });
});

describe("computeRealMix 时长加权", () => {
  it("6s real + 4s ai → 60% 达标", () => {
    const mix = computeRealMix([
      { duration: 6, reality: "real" },
      { duration: 4, reality: "ai" },
    ]);
    expect(mix.realRatio).toBeCloseTo(0.6);
    expect(mix.tiltEligible).toBe(true);
    expect(mix.message.zh).toContain("60%");
    expect(mix.message.zh).toContain("流量倾斜");
  });

  it("3s real + 7s ai → 30% 未达标，给建议且注明非强制", () => {
    const mix = computeRealMix([
      { duration: 3, reality: "real" },
      { duration: 7, reality: "ai" },
    ]);
    expect(mix.tiltEligible).toBe(false);
    expect(mix.message.zh).toContain("30%");
    expect(mix.message.zh).toContain("非强制");
  });

  it("恰好 50% 达标（阈值含等号）", () => {
    expect(computeRealMix([
      { duration: 5, reality: "real" },
      { duration: 5, reality: "ai" },
    ]).tiltEligible).toBe(true);
  });

  it("未配镜头计入 unfilledSec、不进占比，消息注明", () => {
    const mix = computeRealMix([
      { duration: 6, reality: "real" },
      { duration: 4, reality: null },
    ]);
    expect(mix.realRatio).toBe(1);
    expect(mix.unfilledSec).toBe(4);
    expect(mix.message.zh).toContain("未配画面");
  });

  it("全部未配 → ratio null，提示先配素材", () => {
    const mix = computeRealMix([{ duration: 5, reality: null }]);
    expect(mix.realRatio).toBe(null);
    expect(mix.tiltEligible).toBe(false);
  });
});

describe("realMixFromRows（素材页视图行）", () => {
  it("done 的 stock 行 + pending 的 AI 行 → 只算已配的", () => {
    const mix = realMixFromRows([
      { duration: 4, assetType: "stock_footage", status: "done", visualSource: "ai_generate" },
      { duration: 6, visualSource: "ai_generate", status: "pending" },
    ]);
    expect(mix.realRatio).toBe(1);
    expect(mix.unfilledSec).toBe(6);
  });
});

describe("gateItemFromRealMix：纯信息、永远 pass", () => {
  it("null → pass；未达标也 pass（不 nag 纯 AI 管线、不破坏 --strict）", () => {
    expect(gateItemFromRealMix(null).status).toBe("pass");
    const low = computeRealMix([{ duration: 10, reality: "ai" }]);
    const item = gateItemFromRealMix(low);
    expect(item.status).toBe("pass");
    expect(item.id).toBe("realMix");
    expect(item.message.zh).toContain("0%");
    expect(item.problems).toEqual([]);
  });
});

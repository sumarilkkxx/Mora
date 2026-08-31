import { describe, it, expect } from "vitest";
import { applyRetakePatch, RETAKE_SYMPTOMS } from "@/lib/retake-patch";

describe("applyRetakePatch（废片诊断单变量重投）", () => {
  const zhPrompt = "运镜：镜头缓慢推近主体。画面动态：手部演示动作自然连贯。画面稳定流畅。";

  it("六种症状目录齐全且中英标签完整", () => {
    expect(RETAKE_SYMPTOMS.map((s) => s.id)).toEqual([
      "face_broken",
      "skin_waxy",
      "background_dead",
      "light_wrong",
      "blurry",
      "product_warped",
    ]);
    for (const s of RETAKE_SYMPTOMS) {
      expect(s.label.zh.length).toBeGreaterThan(0);
      expect(s.label.en.length).toBeGreaterThan(0);
    }
  });

  it("补丁只追加一条目标从句，原 prompt 内容原样保留", () => {
    const r = applyRetakePatch(zhPrompt, "face_broken");
    expect(r.applied).toBe(true);
    expect(r.prompt.startsWith("运镜：镜头缓慢推近主体")).toBe(true);
    expect(r.prompt).toContain("五官端正对称");
    expect(r.change.zh).toContain("五官对称");
    // 其它症状的从句不掺入（单变量）
    expect(r.prompt).not.toContain("毛孔");
    expect(r.prompt).not.toContain("窗帘");
  });

  it("幂等：已含该从句的 prompt 二次打补丁不重复追加，applied=false", () => {
    const once = applyRetakePatch(zhPrompt, "blurry");
    const twice = applyRetakePatch(once.prompt, "blurry");
    expect(twice.applied).toBe(false);
    expect(twice.prompt).toBe(once.prompt);
  });

  it("英文 prompt 走英文补丁", () => {
    const r = applyRetakePatch("Camera: slow push-in. Motion: hands demonstrate naturally.", "skin_waxy");
    expect(r.prompt).toContain("skin keeps pores and natural texture");
    expect(r.prompt).not.toMatch(/[一-鿿]/);
  });

  it("不同症状可叠加（各改各的维度）", () => {
    const a = applyRetakePatch(zhPrompt, "light_wrong");
    const b = applyRetakePatch(a.prompt, "background_dead");
    expect(b.applied).toBe(true);
    expect(b.prompt).toContain("唯一高光");
    expect(b.prompt).toContain("窗帘轻晃");
  });
});

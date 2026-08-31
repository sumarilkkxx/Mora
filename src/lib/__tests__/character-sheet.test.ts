import { describe, it, expect } from "vitest";
import { buildCharacterSheetPrompt } from "@/lib/character-sheet";

/**
 * Multi-view sheet prompt contract (v0.8.85): one 2x2 generation = one identical
 * person from four angles. The sheet then anchors identity in the grid/film passes.
 */

describe("多视图定妆 prompt", () => {
  it("中文外观：四视图布局 + 同人硬约束 + 无文字 + 真实人脸约束", () => {
    const p = buildCharacterSheetPrompt("32 岁居家女性，松散低马尾，浅色家居服", "小柔");
    expect(p).toContain("2x2 等分四视图");
    expect(p).toContain("（小柔）");
    expect(p).toContain("左上=正面全身");
    expect(p).toContain("右下=正面肩部以上特写");
    expect(p).toContain("完全是同一个人");
    expect(p).toContain("不出现任何文字");
    expect(p).toContain("清爽耐看的普通人长相"); // REAL_FACE_CONSTRAINT.zh rides along
  });

  it("英文外观整体切英文，且不混入中文", () => {
    const p = buildCharacterSheetPrompt("woman in her 30s, loose low ponytail, light loungewear");
    expect(p).toContain("2x2 four-view character reference sheet");
    expect(p).toContain("front shoulders-up close-up");
    expect(p).toContain("exactly identical in all four cells");
    expect(p).not.toMatch(/[一-鿿]/);
  });
});

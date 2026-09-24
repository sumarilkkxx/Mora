import { describe, it, expect } from "vitest";
import { buildStoryboardGridPrompt, computeGridCells, GRID_MAX_SHOTS, neutralizeStoryboardVisual } from "@/lib/storyboard-grid";
import type { Shot, ScriptCharacter } from "@/lib/domain/script";

const shot = (shotId: number, type: string, description: string) =>
  ({ shotId, type, duration: 3, description, voiceover: "词", visualSource: "ai_generate", transition: "cut" }) as unknown as Shot;

describe("buildStoryboardGridPrompt", () => {
  const shots = [shot(1, "hook", "女生对镜头惊讶"), shot(2, "demo", "上手使用产品"), shot(3, "cta", "举起产品推荐")];
  const cast: ScriptCharacter[] = [
    { id: "char_a", name: "小美", gender: "female", persona: "活泼", appearance: "22 岁高马尾白 T 恤" } as ScriptCharacter,
  ];

  it("全局一致性块 + 人物设定 + 逐格行 + 真实感规则 + 无文字硬约束", () => {
    const p = buildStoryboardGridPrompt(shots, cast);
    expect(p).toContain("同一人物、同一发型与同一身衣服、同一房间");
    expect(p).toContain("小美：22 岁高马尾白 T 恤");
    expect(p).toContain("第 1 格（钩子镜）：女生对镜头惊讶");
    expect(p).toContain("第 3 格（转化镜）：举起产品推荐");
    expect(p).toContain("不是精修网红脸"); // REAL_FACE 仍然生效
    expect(p).toContain("光要写满四要素"); // UGC 首帧规则搭车
    expect(p).toContain("不出现任何文字"); // 裁切后当关键帧，文字会毒化画面
  });

  it("超过 9 镜截断到 9 格；无角色时不输出人物设定行", () => {
    const many = Array.from({ length: 12 }, (_, i) => shot(i + 1, "demo", `镜头${i + 1}`));
    const p = buildStoryboardGridPrompt(many);
    expect(p).toContain(`第 ${GRID_MAX_SHOTS} 格`);
    expect(p).not.toContain("第 10 格");
    expect(p).not.toContain("人物设定");
  });

  it("uses the selected video aspect ratio instead of forcing portrait", () => {
    const landscape = buildStoryboardGridPrompt(shots, cast, { aspectRatio: "16:9" });
    expect(landscape).toContain("整图 16:9 横版");
    expect(landscape).toContain("构图按 16:9 设计");
    expect(landscape).not.toContain("整图 9:16 竖版");
  });

  it("参考图约定：定妆照+商品图按序编号；只有商品图时商品是第 1 张", () => {
    const both = buildStoryboardGridPrompt(shots, cast, { characterSheet: true, productImage: true });
    expect(both).toContain("第 1 张参考图是出镜人物的四视图定妆照");
    expect(both).toContain("第 2 张参考图是商品实拍图");
    const productOnly = buildStoryboardGridPrompt(shots, cast, { productImage: true });
    expect(productOnly).toContain("第 1 张参考图是商品实拍图");
    expect(productOnly).not.toContain("定妆照");
    const none = buildStoryboardGridPrompt(shots, cast);
    expect(none).not.toContain("参考图");
  });

  it("纯商品项目优先使用视觉 prompt，不注入人脸规则或营销文字", () => {
    const productShot = {
      ...shot(1, "cta", "双肩包居中，底部大字显示价格，右下角箭头指向下方链接，点击购买"),
      prompt: "Deep navy commuter backpack centered on an ivory background, soft studio light, no people",
    } as Shot;
    const p = buildStoryboardGridPrompt([productShot], null, { productImage: true });
    expect(p).toContain("Deep navy commuter backpack centered");
    expect(p).not.toContain("点击购买");
    expect(p).not.toContain("不是精修网红脸");
    expect(p).not.toContain("光要写满四要素");
    expect(p).toContain("同一商品外观、材质、配色与比例保持一致");
  });

  it("没有专用 prompt 时从描述中移除价格、链接和文字叠加指令", () => {
    const clean = neutralizeStoryboardVisual("双肩包置于桌面中央，底部大字显示价格，右下角箭头指向下方链接，点击购买");
    expect(clean).toContain("双肩包置于桌面中央");
    expect(clean).not.toMatch(/价格|链接|点击|大字|箭头/);
  });
});

describe("computeGridCells", () => {
  it("9 格行主序等分 + inset 内缩几何正确", () => {
    const cells = computeGridCells(900, 1600, { insetRatio: 0 });
    expect(cells.length).toBe(9);
    expect(cells[0]).toEqual({ x: 0, y: 0, w: 300, h: 533 });
    expect(cells[1].x).toBe(300); // 行主序：第二格在右侧
    expect(cells[3].y).toBe(533); // 第四格进入第二行
    expect(cells[8]).toEqual({ x: 600, y: 1067, w: 300, h: 533 });
  });

  it("整图 9:16 时每格也是 9:16（竖屏关键帧免二次裁）", () => {
    const [cell] = computeGridCells(1080, 1920, { insetRatio: 0 });
    expect(cell.w / cell.h).toBeCloseTo(9 / 16, 2);
  });

  it("默认 2% 内缩裁掉格间缝残留", () => {
    const cells = computeGridCells(900, 1600);
    expect(cells[0].x).toBeGreaterThan(0);
    expect(cells[0].w).toBeLessThan(300);
    // 内缩对称：格宽 = 原格宽 - 2*内缩
    expect(cells[0].w).toBe(300 - 2 * Math.round(300 * 0.02));
  });
});

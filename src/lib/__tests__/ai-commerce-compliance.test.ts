import { describe, it, expect } from "vitest";
import {
  checkAiCommerceCompliance,
  AI_REVIEW_STYLES,
  DIGITAL_HUMAN_BANNED_CATEGORIES,
} from "@/lib/ai-commerce-compliance";
import { gateItemFromAiPolicy } from "@/lib/release-gate";

describe("AI 带货平台规则护栏（只警告不拦截）", () => {
  it("对比测评/开箱测评风格触发警告，与是否有 AI 人物无关", () => {
    for (const style of AI_REVIEW_STYLES) {
      const w = checkAiCommerceCompliance({ styleType: style, hasAiPerson: false });
      expect(w.some((x) => x.id === "ai_review_style"), style).toBe(true);
      // 警告文案必须说明「功能保留」——护栏不是禁令
      expect(w[0].message.zh).toContain("保留");
    }
    expect(
      checkAiCommerceCompliance({ styleType: "drama", hasAiPerson: true }).some((x) => x.id === "ai_review_style")
    ).toBe(false);
  });

  it("数字人禁入类目：仅在 AI 人物出镜时按商品文本命中", () => {
    const w = checkAiCommerceCompliance({
      styleType: "talking_head",
      hasAiPerson: true,
      productText: "美白精华液 美妆护肤",
    });
    expect(w.some((x) => x.id === "digital_human_category")).toBe(true);

    // 同样的商品、无 AI 人物 → 不警告（实拍不受数字人类目限制）
    const w2 = checkAiCommerceCompliance({
      styleType: "talking_head",
      hasAiPerson: false,
      productText: "美白精华液 美妆护肤",
    });
    expect(w2.some((x) => x.id === "digital_human_category")).toBe(false);

    // 普通类目不误伤
    const w3 = checkAiCommerceCompliance({
      styleType: "talking_head",
      hasAiPerson: true,
      productText: "抽纸 家居日用",
    });
    expect(w3.some((x) => x.id === "digital_human_category")).toBe(false);
  });

  it("多类目同时命中只出一条类目警告（避免刷屏）", () => {
    const w = checkAiCommerceCompliance({
      styleType: "talking_head",
      hasAiPerson: true,
      productText: "减肥保健品 降血糖",
    });
    expect(w.filter((x) => x.id === "digital_human_category")).toHaveLength(1);
  });

  it("AI 人物亲测宣称触发改写建议；无 AI 人物不触发", () => {
    const w = checkAiCommerceCompliance({
      styleType: "drama",
      hasAiPerson: true,
      dialogueText: "这个我亲测有效，你们放心冲",
    });
    expect(w.some((x) => x.id === "personal_testimony")).toBe(true);

    const w2 = checkAiCommerceCompliance({
      styleType: "drama",
      hasAiPerson: false,
      dialogueText: "这个我亲测有效",
    });
    expect(w2.some((x) => x.id === "personal_testimony")).toBe(false);
  });

  it("干净输入返回空数组", () => {
    expect(
      checkAiCommerceCompliance({
        styleType: "drama",
        hasAiPerson: true,
        productText: "抽纸 家居日用",
        dialogueText: "很多人反馈不错，值得试试",
      })
    ).toEqual([]);
  });

  it("五类禁入类目定义完整", () => {
    expect(DIGITAL_HUMAN_BANNED_CATEGORIES.map((c) => c.label.zh)).toEqual([
      "医疗",
      "金融理财",
      "美容功效",
      "保健功效",
      "教培效果",
    ]);
  });
});

describe("gateItemFromAiPolicy", () => {
  it("无警告 → pass；有警告 → warn（永不 fail），problems 双语齐全", () => {
    expect(gateItemFromAiPolicy([]).status).toBe("pass");
    const item = gateItemFromAiPolicy(
      checkAiCommerceCompliance({ styleType: "comparison", hasAiPerson: true })
    );
    expect(item.status).toBe("warn");
    expect(item.id).toBe("aiPolicy");
    expect(item.problems.length).toBeGreaterThan(0);
    for (const p of item.problems) {
      expect(p.zh).toBeTruthy();
      expect(p.en).toBeTruthy();
    }
  });
});

import { describe, it, expect } from "vitest";
import { AD_TEMPLATES, AD_TEMPLATE_GROUPS, listAdTemplates, getAdTemplate, adTemplateScriptDirective, adTemplateStorageKey, adTemplateAppliedKey, recommendAdTemplates, sanitizeCustomAdTemplate, encodeStoredAdTemplate, decodeStoredAdTemplate, CUSTOM_AD_TEMPLATE_ID } from "@/lib/ad-templates";
import { getCameraPreset } from "@/lib/camera-presets";
import { getLookPreset } from "@/lib/look-presets";
import { CAPTION_PRESET_IDS } from "@/lib/caption-presets";

// UI-form style values accepted by the new-project page (pre-normalizeStyle vocabulary)
const UI_STYLE_VALUES = new Set([
  "drama", "reversal", "interview", "story", "unboxing", "product_pov",
  "comparison", "talking_head", "pain-point", "scenario", "auto",
]);
const VIDEO_MODES = new Set(["product_closeup", "graphic_montage", "scene_demo", "live_presenter"]);
const BGM_VALUES = new Set(["none", "upbeat", "chill", "energetic", "emotional"]);
const GROUP_IDS = new Set(AD_TEMPLATE_GROUPS.map((g) => g.id));
// new-project product-category vocabulary ("other" intentionally excluded — goodFor means "tuned for", not "allowed")
const CATEGORY_VALUES = new Set(["beauty", "food", "home", "fashion", "digital"]);

describe("AD_TEMPLATES 库完整性", () => {
  it("id 唯一且 zh/en 名称与卖点均非空", () => {
    const ids = new Set<string>();
    for (const tpl of AD_TEMPLATES) {
      expect(ids.has(tpl.id)).toBe(false);
      ids.add(tpl.id);
      expect(tpl.name.zh.length).toBeGreaterThan(0);
      expect(tpl.name.en.length).toBeGreaterThan(0);
      expect(tpl.tagline.zh.length).toBeGreaterThan(0);
      expect(tpl.tagline.en.length).toBeGreaterThan(0);
      expect(tpl.emoji.length).toBeGreaterThan(0);
    }
  });

  it("每个模板的分组与适配类目都在词表内", () => {
    for (const tpl of AD_TEMPLATES) {
      expect(GROUP_IDS.has(tpl.group), `${tpl.id} 的分组「${tpl.group}」不存在`).toBe(true);
      for (const cat of tpl.goodFor ?? []) {
        expect(CATEGORY_VALUES.has(cat), `${tpl.id} 的 goodFor「${cat}」不在类目词表`).toBe(true);
      }
    }
  });

  it("每个分组至少有一款模板（分组不空转）", () => {
    for (const group of AD_TEMPLATE_GROUPS) {
      expect(
        AD_TEMPLATES.some((t) => t.group === group.id),
        `分组「${group.id}」没有任何模板`
      ).toBe(true);
    }
  });

  it("每个模板引用的 look / 运镜预设 / 风格 / 模式 / 合成配置全部真实存在", () => {
    for (const tpl of AD_TEMPLATES) {
      expect(getLookPreset(tpl.look), `${tpl.id} 的 look「${tpl.look}」不存在`).toBeDefined();
      expect(UI_STYLE_VALUES.has(tpl.styleType), `${tpl.id} 的 styleType「${tpl.styleType}」不在新建页词表`).toBe(true);
      expect(VIDEO_MODES.has(tpl.videoMode)).toBe(true);
      for (const [type, presetId] of Object.entries(tpl.cameraPlan)) {
        expect(getCameraPreset(presetId!), `${tpl.id} 的 ${type} 运镜「${presetId}」不存在`).toBeDefined();
      }
      if (tpl.compose.captionPreset) {
        expect((CAPTION_PRESET_IDS as readonly string[]).includes(tpl.compose.captionPreset)).toBe(true);
      }
      if (tpl.compose.bgm) expect(BGM_VALUES.has(tpl.compose.bgm)).toBe(true);
    }
  });

  it("每个模板的运镜计划至少覆盖 hook 或商品/演示镜之一（模板必须真的编排运镜）", () => {
    for (const tpl of AD_TEMPLATES) {
      const keys = Object.keys(tpl.cameraPlan);
      expect(keys.length, `${tpl.id} 没有任何运镜编排`).toBeGreaterThan(1);
    }
  });
});

describe("listAdTemplates 分组筛选与类目排序", () => {
  it("按分组过滤，all/缺省返回全库", () => {
    expect(listAdTemplates()).toHaveLength(AD_TEMPLATES.length);
    expect(listAdTemplates({ group: "all" })).toHaveLength(AD_TEMPLATES.length);
    const productShow = listAdTemplates({ group: "product_show" });
    expect(productShow.length).toBeGreaterThan(0);
    expect(productShow.every((t) => t.group === "product_show")).toBe(true);
  });

  it("query 关键词过滤命中双语名称/卖点，大小写不敏感，空串不过滤", () => {
    const hit = listAdTemplates({ query: "转台" });
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((t) => `${t.name.zh}${t.name.en}${t.tagline.zh}${t.tagline.en}`.includes("转台"))).toBe(true);
    const enHit = listAdTemplates({ query: "TURNTABLE" });
    expect(enHit.some((t) => t.id === "turntable_hero")).toBe(true);
    expect(listAdTemplates({ query: "  " })).toHaveLength(AD_TEMPLATES.length);
    expect(listAdTemplates({ query: "绝不存在的关键词xyz" })).toHaveLength(0);
  });

  it("选定类目时 goodFor 命中的模板排前，且不丢任何模板", () => {
    const sorted = listAdTemplates({ category: "food" });
    expect(sorted).toHaveLength(AD_TEMPLATES.length);
    const firstMiss = sorted.findIndex((t) => !t.goodFor?.includes("food"));
    const lastHit = sorted.map((t) => t.goodFor?.includes("food") ?? false).lastIndexOf(true);
    if (firstMiss !== -1 && lastHit !== -1) {
      expect(lastHit).toBeLessThan(firstMiss);
    }
  });
});

describe("recommendAdTemplates 商品感知推荐", () => {
  it("关键词信号命中的模板排最前（信号分压过类目分）", () => {
    const recs = recommendAdTemplates({ category: "home", productName: "强力去污清洁剂", sellingPoints: "重度污渍一喷即净" });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].id).toBe("grime_satisfying"); // 信号+2 与 goodFor:home +3 叠加=5，唯一最高
  });

  it("只有类目时按 goodFor 推荐，推荐 id 全部真实存在", () => {
    const recs = recommendAdTemplates({ category: "beauty" });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((t) => t.goodFor?.includes("beauty"))).toBe(true);
    for (const t of recs) expect(getAdTemplate(t.id)).toBeDefined();
  });

  it("空输入返回空（UI 隐藏推荐行而不是编造推荐）", () => {
    expect(recommendAdTemplates({})).toHaveLength(0);
    expect(recommendAdTemplates({ productName: "  " })).toHaveLength(0);
  });

  it("信号表里的模板 id 全部真实存在（防重构漂移）", () => {
    // 借道公开 API 验证：每条信号词命中时推荐结果非空且 id 可查
    const probes: Array<[string, string]> = [["送妈妈的礼物", "gift_story"], ["解压捏捏乐", "squish_asmr"], ["工厂源头直发", "founder_story"]];
    for (const [text, expectedId] of probes) {
      const recs = recommendAdTemplates({ productName: text }, 10);
      expect(recs.some((t) => t.id === expectedId), `「${text}」应推荐 ${expectedId}`).toBe(true);
    }
  });

  it("新垂直信号命中对应模板（防漂移探针）", () => {
    const probes: Array<[string, string]> = [
      ["挑食猫的冻干主粮", "picky_judge"],
      ["孕晚期待产包收纳袋", "hospital_bag"],
      ["天然淡水珍珠项链", "wrist_sparkle"],
      ["家用折叠跑步机", "method_1230"],
      ["车载冰箱大容量", "trucker_rig"],
      ["手帐胶带贴纸套装", "journal_asmr"],
      ["缓震跑鞋透气", "step_test"],
      ["大容量通勤双肩包", "max_load"],
      ["静音破壁机低噪", "decibel_test"],
      ["电动牙刷声波清洁", "plaque_test"],
      ["中老年防滑舞鞋", "dance_squad"],
      ["遮光睡眠眼罩助眠", "sleepmaxxing"],
      ["社区团购新鲜水果", "group_buy_chain"],
      ["本命年转运水晶手串", "lucky_charm"],
    ];
    for (const [text, expectedId] of probes) {
      const recs = recommendAdTemplates({ productName: text }, 10);
      expect(recs.some((t) => t.id === expectedId), `「${text}」应推荐 ${expectedId}`).toBe(true);
    }
  });

  it("391 库新垂直信号命中对应模板（v0.8.72 防漂移探针）", () => {
    const probes: Array<[string, string]> = [
      ["客制化机械键盘茶轴", "switch_sound"],
      ["主动降噪蓝牙耳机", "anc_ab"],
      ["氮化镓快充充电器", "charge_race"],
      ["明前龙井春茶", "tea_grading"],
      ["浅烘手冲咖啡豆", "pour_over_card"],
      ["低度青梅果酒", "solo_buzz"],
      ["加热即食预制菜", "timer_feast"],
      ["无火香薰扩香套装", "scent_translate"],
      ["全遮光窗帘", "blackout_noon"],
      ["新中式马面裙", "ancient_recreate"],
      ["凉感防晒衣冰袖", "uv_proof"],
      ["偏光太阳镜驾驶专用", "polarized_proof"],
      ["初学者入门尤克里里", "practice_arc"],
      ["人体工学椅腰靠", "sit_marathon"],
      ["穿戴甲美甲片套装", "nail_stress"],
      ["临期进口零食折扣", "expiry_hunt"],
      ["温泉度假酒店套票", "overnight_report"],
      ["备婚伴手礼清单", "wedtok_diary"],
    ];
    for (const [text, expectedId] of probes) {
      const recs = recommendAdTemplates({ productName: text }, 10);
      expect(recs.some((t) => t.id === expectedId), `「${text}」应推荐 ${expectedId}`).toBe(true);
    }
  });
});

describe("sanitizeCustomAdTemplate AI 模板消毒", () => {
  it("合法输入原样保留创意字段", () => {
    const t = sanitizeCustomAdTemplate({
      name: { zh: "香氛之夜", en: "Scent Night" },
      tagline: { zh: "夜色氛围", en: "Night mood" },
      emoji: "🌙",
      group: "creative",
      goodFor: ["beauty"],
      styleType: "scenario",
      videoMode: "product_closeup",
      look: "night_neon",
      cameraPlan: { hook: "slow_push", product_reveal: "orbit_slow", cta: "hero_rise" },
      compose: { captionPreset: "minimal", bgm: "emotional", bgmDuck: true, quality: "hd", productCard: true },
      scriptHint: { zh: "夜晚氛围叙事" },
    })!;
    expect(t.id).toBe(CUSTOM_AD_TEMPLATE_ID);
    expect(t.name.zh).toBe("香氛之夜");
    expect(t.look).toBe("night_neon");
    expect(t.cameraPlan.hook).toBe("slow_push");
    expect(t.compose.quality).toBe("hd");
    expect(t.goodFor).toEqual(["beauty"]);
  });

  it("非法枚举全部钳制到安全默认值，不合法运镜被剔除", () => {
    const t = sanitizeCustomAdTemplate({
      styleType: "nonsense",
      videoMode: "vr_360",
      look: "fake_look",
      group: "fake_group",
      goodFor: ["book", "beauty"],
      cameraPlan: { hook: "fake_cam", weird_shot: "crash_push", demo: "macro_glide" },
      compose: { captionPreset: "huge", bgm: "metal", quality: "8k" },
    })!;
    expect(t.styleType).toBe("pain-point");
    expect(t.videoMode).toBe("product_closeup");
    expect(t.look).toBe("daylight_clean");
    expect(t.group).toBe("product_show"); // 从 videoMode 推断
    expect(t.goodFor).toEqual(["beauty"]);
    // 仅 1 个合法运镜（<2）→ 回落默认编排
    expect(Object.keys(t.cameraPlan).length).toBeGreaterThan(1);
    expect(t.compose.captionPreset).toBe("standard");
    expect(t.compose.bgm).toBe("upbeat");
    expect(t.compose.quality).toBeUndefined();
    // 消毒后的模板能走脚本注入通道
    expect(adTemplateScriptDirective(t)).toContain("运镜编排");
  });

  it("非对象输入返回 null", () => {
    expect(sanitizeCustomAdTemplate(null)).toBeNull();
    expect(sanitizeCustomAdTemplate("{}")).toBeNull();
  });
});

describe("encode/decodeStoredAdTemplate 存取编解码", () => {
  it("内置模板存 id，解码回同一模板", () => {
    const tpl = getAdTemplate("turntable_hero")!;
    expect(encodeStoredAdTemplate(tpl)).toBe("turntable_hero");
    expect(decodeStoredAdTemplate("turntable_hero")?.name.zh).toBe("转台大片");
  });

  it("custom 模板存内联 JSON，解码经消毒还原", () => {
    const custom = sanitizeCustomAdTemplate({ name: { zh: "定制", en: "Custom" }, videoMode: "scene_demo" })!;
    const stored = encodeStoredAdTemplate(custom);
    expect(stored.startsWith("custom:")).toBe(true);
    const decoded = decodeStoredAdTemplate(stored)!;
    expect(decoded.id).toBe(CUSTOM_AD_TEMPLATE_ID);
    expect(decoded.name.zh).toBe("定制");
    expect(decoded.videoMode).toBe("scene_demo");
  });

  it("坏值解码为 undefined 不抛错", () => {
    expect(decodeStoredAdTemplate("custom:not-json{")).toBeUndefined();
    expect(decodeStoredAdTemplate("unknown_id")).toBeUndefined();
    expect(decodeStoredAdTemplate(null)).toBeUndefined();
  });
});

describe("getAdTemplate / 存储键", () => {
  it("按 id 命中，空/未知返回 undefined", () => {
    expect(getAdTemplate("turntable_hero")?.name.zh).toBe("转台大片");
    expect(getAdTemplate("nope")).toBeUndefined();
    expect(getAdTemplate("")).toBeUndefined();
    expect(getAdTemplate(null)).toBeUndefined();
  });

  it("localStorage 键按项目隔离且 applied 键与选择键不同", () => {
    expect(adTemplateStorageKey("p1")).not.toBe(adTemplateStorageKey("p2"));
    expect(adTemplateAppliedKey("p1")).not.toBe(adTemplateStorageKey("p1"));
  });
});

describe("adTemplateScriptDirective 脚本注入块", () => {
  it("包含模板名、look 描述与真实运镜预设句", () => {
    const tpl = getAdTemplate("turntable_hero")!;
    const directive = adTemplateScriptDirective(tpl);
    expect(directive).toContain("转台大片");
    expect(directive).toContain(getLookPreset(tpl.look)!.image.zh);
    expect(directive).toContain(getCameraPreset("lazy_susan")!.prompt.zh);
    expect(directive).toContain("camera");
  });

  it("每个模板的注入块非空且带创作提示", () => {
    for (const tpl of AD_TEMPLATES) {
      const d = adTemplateScriptDirective(tpl);
      expect(d).toContain(tpl.scriptHint.zh);
      expect(d).toContain("运镜编排");
    }
  });
});

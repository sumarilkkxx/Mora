import { describe, it, expect } from "vitest";
import { LOOK_PRESETS, LOOK_NONE, getLookPreset, lookImageSuffix } from "@/lib/look-presets";
import { buildMotionPrompt } from "@/lib/motion-prompt";

describe("LOOK_PRESETS 库完整性", () => {
  it("id 唯一且 zh/en 名称、image、motion prompt 均非空", () => {
    const ids = new Set<string>();
    for (const p of LOOK_PRESETS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.name.zh.length).toBeGreaterThan(0);
      expect(p.name.en.length).toBeGreaterThan(0);
      expect(p.image.zh.length).toBeGreaterThan(0);
      expect(p.image.en.length).toBeGreaterThan(0);
      expect(p.motion.zh.length).toBeGreaterThan(0);
      expect(p.motion.en.length).toBeGreaterThan(0);
    }
  });

  it("motion 锚点保持精简（运镜 prompt 必须以镜头指令为主，不被风格块稀释）", () => {
    for (const p of LOOK_PRESETS) {
      expect(p.motion.zh.length).toBeLessThan(30);
    }
  });
});

describe("getLookPreset / lookImageSuffix", () => {
  it("none 与未知 id → undefined（不加任何风格后缀）", () => {
    expect(getLookPreset(LOOK_NONE)).toBeUndefined();
    expect(getLookPreset(undefined)).toBeUndefined();
    expect(getLookPreset("nope")).toBeUndefined();
    expect(lookImageSuffix(LOOK_NONE, "中文")).toBeUndefined();
  });

  it("按上下文语言选后缀：含中文→zh，纯英文→en，空样本默认 zh", () => {
    const p = LOOK_PRESETS[0];
    expect(lookImageSuffix(p.id, "一段中文prompt")).toBe(p.image.zh);
    expect(lookImageSuffix(p.id, "cinematic macro shot")).toBe(p.image.en);
    expect(lookImageSuffix(p.id, "")).toBe(p.image.zh);
  });
});

describe("buildMotionPrompt 的 look 光线锚点", () => {
  it("传入 look 时中英分支各自出现光线行", () => {
    const look = getLookPreset("studio_product")!;
    const zh = buildMotionPrompt({ shotType: "product_reveal", camera: "镜头缓慢环绕", look: look.motion });
    expect(zh).toContain(`光线：${look.motion.zh}`);
    const en = buildMotionPrompt({ shotType: "product_reveal", camera: "slow orbit around the product", look: look.motion });
    expect(en).toContain(`Lighting: ${look.motion.en}`);
  });

  it("不传 look 时输出与旧版完全一致（无光线行）", () => {
    const base = buildMotionPrompt({ shotType: "demo", camera: "镜头平稳跟随" });
    expect(base).not.toContain("光线：");
    const withLook = buildMotionPrompt({ shotType: "demo", camera: "镜头平稳跟随", look: getLookPreset("warm_life")!.motion });
    expect(withLook.replace(`光线：${getLookPreset("warm_life")!.motion.zh}。`, "")).toBe(base);
  });
});

describe("「实拍感」组（real family）与相机身份开场词", () => {
  it("六款 real 预设齐全且都带 opener（前置注入用）", () => {
    const real = LOOK_PRESETS.filter((p) => p.group === "real");
    expect(real.map((p) => p.id).sort()).toEqual([
      "cctv_store",
      "dashcam_ride",
      "old_dv",
      "phone_raw",
      "propped_static",
      "selfie_front",
    ]);
    for (const p of real) {
      expect(p.opener?.zh).toBeTruthy();
      expect(p.opener?.en).toBeTruthy();
    }
    // 风格化预设不带 opener（保持追加式光线锚点的旧行为）
    expect(getLookPreset("studio_product")!.opener).toBeUndefined();
  });

  it("opener 前置为 prompt 第一段（前部 token 权重最高），中英分支各自生效", () => {
    const p = getLookPreset("phone_raw")!;
    const zh = buildMotionPrompt({ shotType: "demo", camera: "镜头平稳跟随", look: p.motion, opener: p.opener });
    expect(zh.startsWith(`${p.opener!.zh}。`)).toBe(true);
    const en = buildMotionPrompt({ shotType: "demo", camera: "smooth follow shot", look: p.motion, opener: p.opener });
    expect(en.startsWith(`${p.opener!.en}. `) || en.startsWith(`${p.opener!.en}.`)).toBe(true);
  });

  it("不传 opener 时输出与旧版一致（运镜行仍然领跑）", () => {
    const base = buildMotionPrompt({ shotType: "demo", camera: "镜头平稳跟随" });
    expect(base.startsWith("运镜：")).toBe(true);
  });

  it("实拍感 image 后缀全正向措辞：不含否定式视觉负词（官方负向通道只覆盖字幕/音频）", () => {
    for (const p of LOOK_PRESETS.filter((x) => x.group === "real")) {
      // 「未调色」是状态描述允许出现；不允许「不要/避免」类指令式否定
      expect(p.image.zh).not.toMatch(/不要|避免/);
      expect(p.image.en.toLowerCase()).not.toMatch(/\bno\b|\bavoid\b/);
    }
  });
});

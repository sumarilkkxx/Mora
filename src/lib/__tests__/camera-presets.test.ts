import { describe, it, expect } from "vitest";
import {
  CAMERA_PRESETS,
  CAMERA_PRESET_CATEGORIES,
  getCameraPreset,
  cameraPresetPrompt,
  recommendedPresets,
  cameraPresetGuide,
  findPresetByPrompt,
  mixCameraPrompt,
  mixablePresets,
} from "@/lib/camera-presets";
import { hasCameraConflict, buildMotionPrompt } from "@/lib/motion-prompt";

const SHOT_TYPES = ["hook", "pain_point", "product_reveal", "demo", "social_proof", "cta"] as const;

describe("CAMERA_PRESETS 库完整性", () => {
  it("id 唯一且 zh/en 名称与 prompt 均非空", () => {
    const ids = new Set<string>();
    for (const p of CAMERA_PRESETS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.name.zh.length).toBeGreaterThan(0);
      expect(p.name.en.length).toBeGreaterThan(0);
      expect(p.prompt.zh.length).toBeGreaterThan(0);
      expect(p.prompt.en.length).toBeGreaterThan(0);
      expect(CAMERA_PRESET_CATEGORIES[p.category]).toBeDefined();
    }
  });

  it("每条预设句（中英）都必须通过运镜冲突 lint，否则会被 buildMotionPrompt 丢弃回退", () => {
    for (const p of CAMERA_PRESETS) {
      expect(hasCameraConflict(p.prompt.zh), `${p.id} zh 预设句触发冲突 lint`).toBe(false);
      expect(hasCameraConflict(p.prompt.en), `${p.id} en 预设句触发冲突 lint`).toBe(false);
    }
  });

  it("预设句真实流入 motion prompt（不被回退到 shotType 默认句）", () => {
    for (const p of CAMERA_PRESETS) {
      const zh = buildMotionPrompt({ shotType: "demo", camera: p.prompt.zh });
      expect(zh).toContain(`运镜：${p.prompt.zh}`);
    }
  });

  it("六种分镜类型都有推荐预设覆盖", () => {
    for (const type of SHOT_TYPES) {
      expect(recommendedPresets(type).length, `${type} 无推荐预设`).toBeGreaterThan(0);
    }
  });

  it("未知分镜类型返回空推荐而不是报错", () => {
    expect(recommendedPresets("unknown_type")).toEqual([]);
  });
});

describe("查找与语言选择", () => {
  it("getCameraPreset 按 id 命中，未知 id 返回 undefined", () => {
    expect(getCameraPreset("orbit_slow")?.name.zh).toBe("环绕展示");
    expect(getCameraPreset("nope")).toBeUndefined();
  });

  it("cameraPresetPrompt 按上下文语言选句：含中文→zh，纯英文→en，空样本默认 zh", () => {
    const p = getCameraPreset("slow_push")!;
    expect(cameraPresetPrompt(p, "一段中文描述")).toBe(p.prompt.zh);
    expect(cameraPresetPrompt(p, "an english scene description")).toBe(p.prompt.en);
    expect(cameraPresetPrompt(p, "")).toBe(p.prompt.zh);
  });
});

describe("Mix 双预设叠加", () => {
  it("findPresetByPrompt 按 zh/en 预设句精确反查，非预设文本返回 undefined", () => {
    const p = getCameraPreset("orbit_slow")!;
    expect(findPresetByPrompt(p.prompt.zh)?.id).toBe("orbit_slow");
    expect(findPresetByPrompt(p.prompt.en)?.id).toBe("orbit_slow");
    expect(findPresetByPrompt("镜头随便动一动")).toBeUndefined();
    expect(findPresetByPrompt(undefined)).toBeUndefined();
  });

  it("可混组合出「，同时」复合句且过冲突 lint；en 用 while 连接", () => {
    const orbit = getCameraPreset("orbit_slow")!;
    const push = getCameraPreset("slow_push")!;
    const zh = mixCameraPrompt(orbit, push, "中文场景");
    expect(zh).toBe(`${orbit.prompt.zh}，同时${push.prompt.zh}`);
    expect(hasCameraConflict(zh!)).toBe(false);
    const en = mixCameraPrompt(orbit, push, "english scene");
    expect(en).toContain(", while ");
  });

  it("锁定机位类预设（转台/焦点转移）与运动类预设混合会触发冲突 → null", () => {
    const lazy = getCameraPreset("lazy_susan")!;
    const orbit = getCameraPreset("orbit_slow")!;
    expect(mixCameraPrompt(lazy, orbit, "中文")).toBeNull();
    expect(mixCameraPrompt(orbit, lazy, "中文")).toBeNull();
  });

  it("同预设不能与自己混合；mixablePresets 只列 lint 通过的候选", () => {
    const orbit = getCameraPreset("orbit_slow")!;
    expect(mixCameraPrompt(orbit, orbit, "中文")).toBeNull();
    const candidates = mixablePresets(orbit, "中文");
    expect(candidates.some((p) => p.id === "orbit_slow")).toBe(false);
    expect(candidates.some((p) => p.id === "lazy_susan")).toBe(false);
    expect(candidates.length).toBeGreaterThan(0);
    for (const p of candidates) {
      expect(hasCameraConflict(mixCameraPrompt(orbit, p, "中文")!)).toBe(false);
    }
  });

  it("混合句真实流入 motion prompt 不被回退", () => {
    const mixed = mixCameraPrompt(getCameraPreset("orbit_slow")!, getCameraPreset("slow_push")!, "中文")!;
    expect(buildMotionPrompt({ shotType: "product_reveal", camera: mixed })).toContain(`运镜：${mixed}`);
  });
});

describe("cameraPresetGuide 脚本 LLM 词表", () => {
  it("覆盖六类分镜意图标签且包含真实预设句", () => {
    const guide = cameraPresetGuide();
    for (const label of ["开场钩子", "痛点共鸣", "商品展示", "使用演示", "氛围背书", "收尾转化"]) {
      expect(guide).toContain(label);
    }
    expect(guide).toContain("镜头围绕主体缓慢环绕半圈");
    // The guide must carry the conflict rule so the LLM doesn't mix hold + move in one line
    expect(guide).toContain("固定镜头");
  });
});

import { describe, it, expect } from "vitest";
import {
  shotPlanFromCuts,
  replicateReferenceStructure,
  buildReplicatePrompt,
  referenceModelFor,
  REPLICATE_MAX_REF_SEC,
} from "@/lib/replicate-plan";

describe("shotPlanFromCuts 节奏骨架", () => {
  it("切点切出正确分段并保留 0.1s 精度", () => {
    const shots = shotPlanFromCuts([3.2, 5.3, 9.0], 12);
    expect(shots.map((s) => s.duration)).toEqual([3.2, 2.1, 3.7, 3]);
    expect(shots.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    expect(shots[2].start).toBeCloseTo(5.3);
  });

  it("小于 1s 的碎片并入前一镜；首段碎片并入后一镜", () => {
    expect(shotPlanFromCuts([3, 3.4, 8], 10).map((s) => s.duration)).toEqual([3.4, 4.6, 2]);
    expect(shotPlanFromCuts([0.5, 4], 10).map((s) => s.duration)).toEqual([4, 6]);
  });

  it("无切点 → 单镜全片；非法时长 → 空", () => {
    expect(shotPlanFromCuts([], 8)).toEqual([{ index: 1, start: 0, duration: 8 }]);
    expect(shotPlanFromCuts([1, 2], 0)).toEqual([]);
    expect(shotPlanFromCuts([1, 2], NaN)).toEqual([]);
  });

  it("越界/重复切点被清洗", () => {
    const shots = shotPlanFromCuts([-1, 0, 5, 5, 20], 10);
    expect(shots.map((s) => s.duration)).toEqual([5, 5]);
  });

  it("超过上限的镜头数合并到 12 镜以内且总时长守恒", () => {
    const cuts = Array.from({ length: 29 }, (_, i) => (i + 1) * 2); // 30 段每段 2s，共 60s
    const shots = shotPlanFromCuts(cuts, 60);
    expect(shots.length).toBeLessThanOrEqual(12);
    const total = shots.reduce((s, x) => s + x.duration, 0);
    expect(total).toBeCloseTo(60, 0);
  });
});

describe("replicateReferenceStructure 注入块", () => {
  it("含镜头数、逐镜时长与「只复刻节奏」约束", () => {
    const shots = shotPlanFromCuts([3, 7], 10);
    const block = replicateReferenceStructure(shots, 10);
    expect(block).toContain("共 3 镜");
    expect(block).toContain("第1镜 3s");
    expect(block).toContain("不要照搬参考内容");
  });

  it("空骨架返回空串", () => {
    expect(replicateReferenceStructure([], 10)).toBe("");
  });
});

describe("buildReplicatePrompt 模型级提示词", () => {
  it("引用 视频1 与 图1，带商品保真约束与无人声指令", () => {
    const p = buildReplicatePrompt({ productName: "云柔抽纸", sellingPoints: "加厚不破", imageCount: 3 });
    expect(p).toContain("视频1");
    expect(p).toContain("图1~图3");
    expect(p).toContain("云柔抽纸");
    expect(p).toContain("完全一致");
    expect(p).toContain("无人声");
    expect(p).toContain("加厚不破");
  });

  it("无商品图时不引用图片序号", () => {
    const p = buildReplicatePrompt({ productName: "抽纸", imageCount: 0 });
    expect(p).not.toContain("图1");
    expect(p).toContain("抽纸");
  });
});

describe("referenceModelFor 模型映射", () => {
  it("Seedance 2.0 家族 i2v/t2v → reference 兄弟；reference 自身直通", () => {
    expect(referenceModelFor("bytedance/seedance-2.0/image-to-video")).toBe("bytedance/seedance-2.0/reference-to-video");
    expect(referenceModelFor("bytedance/seedance-2.0-fast/text-to-video")).toBe("bytedance/seedance-2.0-fast/reference-to-video");
    expect(referenceModelFor("bytedance/seedance-2.0/reference-to-video")).toBe("bytedance/seedance-2.0/reference-to-video");
  });

  it("v0.8.76 新增家族：MiniMax H3 / 万相 2.7 / Kling O3 也能映射 reference 兄弟", () => {
    expect(referenceModelFor("minimax/h3/image-to-video")).toBe("minimax/h3/reference-to-video");
    expect(referenceModelFor("minimax/h3/text-to-video")).toBe("minimax/h3/reference-to-video");
    expect(referenceModelFor("alibaba/wan-2.7/image-to-video")).toBe("alibaba/wan-2.7/reference-to-video");
    expect(referenceModelFor("kwaivgi/kling-video-o3-std/text-to-video")).toBe("kwaivgi/kling-video-o3-std/reference-to-video");
    expect(referenceModelFor("minimax/h3/reference-to-video")).toBe("minimax/h3/reference-to-video");
  });

  it("无 reference 变体的家族 → undefined（UI 据此禁用按钮）", () => {
    expect(referenceModelFor("kwaivgi/kling-v3.0-pro/image-to-video")).toBeUndefined();
    expect(referenceModelFor("bytedance/seedance-v1.5-pro/image-to-video")).toBeUndefined();
    expect(referenceModelFor("minimax/hailuo-2.3/i2v-standard")).toBeUndefined();
    expect(referenceModelFor(undefined)).toBeUndefined();
  });

  it("参考时长上限常量为 15s（Seedance 协议）", () => {
    expect(REPLICATE_MAX_REF_SEC).toBe(15);
  });
});

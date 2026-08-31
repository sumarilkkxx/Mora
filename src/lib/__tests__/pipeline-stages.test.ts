import { describe, it, expect } from "vitest";
import { PIPELINE_STAGES, isPipelineStage, stagesFrom, STAGE_LABEL_KEYS } from "../pipeline-stages";

describe("pipeline stages（服务端全托管链阶段模型）", () => {
  it("阶段顺序固定：判官 → 配画面 → 合成", () => {
    expect(PIPELINE_STAGES).toEqual(["judge", "stock_fill", "compose"]);
  });

  it("stagesFrom 从断点切片：已完成的阶段不再重跑", () => {
    expect(stagesFrom("judge")).toEqual(["judge", "stock_fill", "compose"]);
    expect(stagesFrom("stock_fill")).toEqual(["stock_fill", "compose"]);
    expect(stagesFrom("compose")).toEqual(["compose"]);
  });

  it("未知断点回退整链：宁可多跑（阶段可重入），不可漏跑", () => {
    expect(stagesFrom(undefined)).toEqual(["judge", "stock_fill", "compose"]);
    expect(stagesFrom("bogus")).toEqual(["judge", "stock_fill", "compose"]);
    expect(stagesFrom(42)).toEqual(["judge", "stock_fill", "compose"]);
  });

  it("isPipelineStage 只认合法阶段名", () => {
    expect(isPipelineStage("judge")).toBe(true);
    expect(isPipelineStage("done")).toBe(false);
    expect(isPipelineStage(null)).toBe(false);
  });

  it("每个阶段都有进度文案 key（script 命名空间）", () => {
    for (const s of PIPELINE_STAGES) {
      expect(STAGE_LABEL_KEYS[s]).toBeTruthy();
    }
  });
});

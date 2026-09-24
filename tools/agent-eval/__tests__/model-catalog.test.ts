// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadEvaluationModelCatalog, selectedEvaluationPrices } from "../model-catalog";
import { deriveEvaluationWorkflow } from "../workflow";

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

describe("agent evaluation model catalog", () => {
  it("separates tool-capable text models from image-input models and snapshots prices", async () => {
    const catalog = await loadEvaluationModelCatalog("secret", async (_input, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
      return response({ data: [
        { id: "vendor/text", name: "Text", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["tools"], pricing: { prompt: "0.000001", completion: "0.000002", input_cache_read: "0.0000002" } },
        { id: "vendor/vision", name: "Vision", architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, supported_parameters: ["tools"], pricing: { prompt: "0.000003", completion: "0.000004" } },
        { id: "vendor/no-tools", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: [], pricing: { prompt: "0.000001", completion: "0.000001" } },
        { id: "vendor/unpriced", architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, supported_parameters: ["tools"], pricing: {} },
      ] });
    });
    expect(catalog.text.map(model => model.id)).toEqual(["vendor/text", "vendor/vision"]);
    expect(catalog.vision.map(model => model.id)).toEqual(["vendor/vision"]);
    expect(selectedEvaluationPrices(catalog, "vendor/text", "vendor/vision")).toMatchObject({
      "vendor/text": { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2, cachedInputUsdPerMillionTokens: 0.2 },
      "vendor/vision": { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 4 },
    });
  });

  it("does not expose arbitrary unpriced model ids to paid evaluation", async () => {
    const catalog = await loadEvaluationModelCatalog("secret", async () => response({ data: [
      { id: "vendor/text", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["tools"], pricing: { prompt: "0", completion: "0" } },
      { id: "vendor/vision", architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }, supported_parameters: ["tools"], pricing: { prompt: "0", completion: "0" } },
    ] }));
    expect(() => selectedEvaluationPrices(catalog, "unknown", "vendor/vision")).toThrow(/不在当前可评测目录/);
  });
});

describe("agent evaluation workflow gate", () => {
  it("keeps the baseline action visible but disabled until review and calibration both pass", () => {
    expect(deriveEvaluationWorkflow({ reviewed: 8, total: 8, calibration: "idle", baseline: "idle", baselineDatasetEligible: true })).toMatchObject({ calibrationEnabled: true, baselineEnabled: false, baselineReason: "请先完成开发集校准" });
    expect(deriveEvaluationWorkflow({ reviewed: 8, total: 8, calibration: "passed", baseline: "idle", baselineDatasetEligible: true })).toMatchObject({ baselineEnabled: true });
    expect(deriveEvaluationWorkflow({ reviewed: 7, total: 8, calibration: "passed", baseline: "idle", baselineDatasetEligible: true })).toMatchObject({ baselineEnabled: false, baselineReason: "还有 1 个正式评测案例尚未确认" });
    expect(deriveEvaluationWorkflow({ reviewed: 8, total: 8, calibration: "passed", baseline: "idle", baselineDatasetEligible: false })).toMatchObject({ baselineEnabled: false, baselineReason: expect.stringContaining("sealed Holdout") });
  });

  it("allows another calibration after a finished attempt but not while one is running", () => {
    expect(deriveEvaluationWorkflow({ reviewed: 8, total: 8, calibration: "running", baseline: "idle", baselineDatasetEligible: true })).toMatchObject({ calibrationEnabled: false });
    expect(deriveEvaluationWorkflow({ reviewed: 8, total: 8, calibration: "failed", baseline: "idle", baselineDatasetEligible: true })).toMatchObject({ calibrationEnabled: true });
    expect(deriveEvaluationWorkflow({ reviewed: 8, total: 8, calibration: "passed", baseline: "idle", baselineDatasetEligible: true })).toMatchObject({ calibrationEnabled: true });
    expect(deriveEvaluationWorkflow({ reviewed: 8, total: 8, calibration: "failed", calibrationPassedCases: 1, calibrationCaseCount: 8, baseline: "idle", baselineDatasetEligible: true })).toMatchObject({ baselineReason: "本轮校准通过 1/8；需全部通过后才能开始正式评测，请重新校准或更换模型" });
  });
});

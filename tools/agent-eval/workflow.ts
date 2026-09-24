export type CalibrationGate = "idle" | "running" | "passed" | "failed";
export type BaselineGate = "idle" | "running" | "passed" | "failed" | "stopped";

export interface EvaluationWorkflowInput {
  reviewed: number;
  total: number;
  calibration: CalibrationGate;
  calibrationPassedCases?: number;
  calibrationCaseCount?: number;
  baseline: BaselineGate;
  baselineDatasetEligible?: boolean;
}

export function deriveEvaluationWorkflow(input: EvaluationWorkflowInput) {
  const reviewReady = input.total > 0 && input.reviewed === input.total;
  const calibrationReady = input.calibration === "passed";
  const calibrationEnabled = input.calibration !== "running";
  const baselineRunning = input.baseline === "running";
  const baselineDatasetEligible = input.baselineDatasetEligible === true;
  const baselineEnabled = baselineDatasetEligible && reviewReady && calibrationReady && !baselineRunning;
  let baselineReason = "已满足全部前置门禁";
  if (!baselineDatasetEligible) baselineReason = "当前 Holdout 已暴露给开发流程，请准备新的 sealed Holdout 后再运行正式盲测";
  else if (!reviewReady) baselineReason = `还有 ${Math.max(0, input.total - input.reviewed)} 个正式评测案例尚未确认`;
  else if (input.calibration === "idle") baselineReason = "请先完成开发集校准";
  else if (input.calibration === "running") baselineReason = "开发集校准正在进行";
  else if (input.calibration === "failed") {
    const passed = input.calibrationPassedCases ?? 0;
    const total = input.calibrationCaseCount ?? 8;
    baselineReason = `本轮校准通过 ${passed}/${total}；需全部通过后才能开始正式评测，请重新校准或更换模型`;
  }
  else if (baselineRunning) baselineReason = "正式评测正在运行";
  return { reviewReady, calibrationReady, calibrationEnabled, baselineEnabled, baselineReason };
}

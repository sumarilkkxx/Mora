import type { Credentials } from "../../src/lib/auto-edit/runner";
import { getEvaluationStatus, startEvaluation } from "./evaluation-session";

export function startCalibration(credentials: Credentials) {
  return startEvaluation("calibration", credentials);
}

export function calibrationStatus(sessionId: string) {
  return getEvaluationStatus(sessionId);
}

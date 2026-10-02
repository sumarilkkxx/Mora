import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ffmpegBin } from "../../../src/lib/ffmpeg-path";
import { runMediaProcess } from "../../../src/lib/media-runtime";
import type { StoredEvaluationSession } from "../evaluation-session";
import { evaluateStoredSession, writeStoredSessionReport } from "../session-results";
import { parseEvaluationDataset } from "../core/dataset";
import { AgentEvaluationRecorder } from "../core/trace";
import type { EvaluationTrace } from "../core/types";

const fake = vi.hoisted(() => ({ responses: [] as unknown[][] }));
vi.mock("../../../src/lib/db", () => ({ getDb: () => ({ select: () => ({ from: () => ({ where: async () => fake.responses.shift() ?? [] }) }) }) }));
let directory: string, output: string, session: StoredEvaluationSession;
async function persist(trace: EvaluationTrace, status = "done", composition = true) {
  await writeFile(session.tracePath, JSON.stringify(trace) + "\n");
  fake.responses.push([{ id: "run", status, stage: "complete", error: null, compositionId: composition ? "comp" : null, checkpoint: { checks: { technical: composition }, history: [], repairs: 0 } }]);
  if (composition) fake.responses.push([{ id: "comp", status: "done", outputPath: output }]);
}
function receipt() {
  const recorder = new AgentEvaluationRecorder({ runId: "run", caseId: session.cases[0].caseId, datasetVersion: "v1", prices: {}, maxRequestCostUsd: 1 });
  for (const tool of ["validate_edit_plan", "render_edit", "inspect_output", "finish"]) {
    const id = recorder.beginToolExecution({ stage: "editing", tool, arguments: {} });
    recorder.completeToolExecution(id, { outputId: output });
  }
  return recorder.snapshot(true);
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "mora-eval-results-")); output = join(directory, "output.mp4");
  await runMediaProcess(ffmpegBin(), ["-v", "error", "-f", "lavfi", "-i", "color=red:s=160x120:r=10:d=1", "-c:v", "libx264", output]);
});
beforeEach(async () => {
  fake.responses = [];
  const dataset = parseEvaluationDataset(JSON.parse(await readFile("tools/agent-eval/datasets/smoke.json", "utf8")));
  session = { schemaVersion: 1, sessionId: "session", kind: "calibration", startedAt: "2026-10-02", datasetId: dataset.datasetId, datasetVersion: dataset.version, evaluatorVersion: "3", textModel: "fixed", visionModel: "fixed", prices: {}, stopLimitUsd: 1, absoluteLimitUsd: 1, maxRequestCostUsd: .1, runIds: ["run"], cases: [dataset.cases[0]], outputDirectory: directory, tracePath: join(directory, "trace.jsonl") };
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
describe("stored session evidence integration", () => {
  it("scores actual receipts and persisted full-decode checks together", async () => {
    await persist(receipt());
    const results = await evaluateStoredSession(session);
    expect(results[0].scores.find(s => s.name === "task_success")?.score).toBe(1);
    const evidence = JSON.parse(await readFile(join(directory, results[0].mediaEvidencePath), "utf8"));
    expect(evidence).toMatchObject({ passed: true, decodes: true });
    expect(evidence.outputSha256).toHaveLength(64);
    session.cases[0].checks = [{ id: "size", kind: "dimensions", width: 120, height: 160, rationale: "wrong orientation" }];
    await persist(receipt());
    expect((await evaluateStoredSession(session))[0].scores.find(s => s.name === "task_success")?.score).toBe(0);
  });
  it("keeps legacy missing receipts unknown and preserves the original report", async () => {
    session.evaluatorVersion = "2";
    const trace = receipt(); delete trace.toolExecutions;
    await persist(trace);
    const results = await evaluateStoredSession(session);
    expect(results[0].scores.find(s => s.name === "task_success")?.score).toBeNull();
    const original = join(directory, "summary.md"); await writeFile(original, "historical evidence");
    const report = await writeStoredSessionReport(session, results);
    expect(await readFile(original, "utf8")).toBe("historical evidence");
    expect(report).toContain("summary-rechecked-v3.md");
    expect(await readFile(report, "utf8")).toContain("未评价");
  });
  it("does not require a video for an evidenced expected stop", async () => {
    session.cases[0].expected = { ...session.cases[0].expected, behavior: "stop", reasonCodes: ["invalid_media"], terminalStates: ["failed"], requiredTools: [], mustDecode: false, mustHaveVideo: false };
    const trace = receipt(); trace.toolExecutions = []; trace.outcome = { state: "failed", reasonCode: "invalid_media" };
    await persist(trace, "failed", false);
    const result = (await evaluateStoredSession(session))[0];
    expect(result.output.exists).toBe(false);
    expect(result.scores.find(s => s.name === "task_success")?.score).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { deriveProductionOverview } from "@/lib/production-overview";

const base = {
  project: { id: "p", name: "Fixture", productionWorkflow: [{ id: "motion", enabled: false }] },
  scripts: [], assets: [], tasks: [], compositions: [], operations: [], snapshots: [],
};

describe("production overview", () => {
  it("derives an empty project and explains the first available action", () => {
    const overview = deriveProductionOverview(base);
    expect(overview.summary).toMatchObject({ state: "empty", progress: 0, nextAction: { id: "script", href: "/project/p/script", enabled: true } });
    expect(overview.stages.map(stage => [stage.id, stage.state])).toEqual([
      ["script", "empty"], ["assets", "blocked"], ["operation", "idle"],
      ["composition", "blocked"], ["qc", "blocked"], ["release", "blocked"],
    ]);
    expect(overview.stages.find(stage => stage.id === "composition")?.action).toMatchObject({ enabled: false, href: null, reason: "script_required" });
    expect(overview.stages.find(stage => stage.id === "qc")?.action).toMatchObject({ enabled: false, href: null, reason: "composition_required" });
  });

  it("derives running work from OperationRun instead of a stored workflow plan", () => {
    const overview = deriveProductionOverview({
      ...base,
      scripts: [{ id: "s", selected: true, shots: [{ shotId: 1 }, { shotId: 2 }] }],
      assets: [{ id: "a", shotId: 1, status: "done" }],
      operations: [{ id: "run", kind: "pipeline", status: "running", stage: "stock_fill", checkpoint: null, error: null }],
    });
    expect(overview.summary).toMatchObject({ state: "running", progress: 33 });
    expect(overview.stages.find(stage => stage.id === "operation")).toMatchObject({ state: "running", detail: "stock_fill" });
    expect(overview.stages.find(stage => stage.id === "composition")?.action).toMatchObject({ enabled: false, href: null, reason: "assets_required" });
    expect(overview.legacyWorkflowIgnored).toBe(true);
  });

  it("surfaces unknown paid work and interrupted operations as attention", () => {
    const overview = deriveProductionOverview({
      ...base,
      tasks: [{ id: "paid", status: "unknown", mediaType: "video", error: null }],
      operations: [{ id: "run", kind: "compose", status: "interrupted", stage: "render", checkpoint: null, error: "interrupted" }],
    });
    expect(overview.summary.state).toBe("attention");
    expect(overview.failure).toMatchObject({ source: "operation", id: "run", recoverable: true });
    expect(overview.cost).toEqual({ submittedCalls: 1, activeCalls: 1, completedCalls: 0, failedCalls: 0, currency: null, amount: null });
  });

  it("uses a paid task as the background-work source when no OperationRun exists", () => {
    const overview = deriveProductionOverview({
      ...base,
      tasks: [{ id: "paid", status: "processing", mediaType: "video", error: null }],
    });
    expect(overview.summary).toMatchObject({ state: "running", nextAction: { id: "operation", href: "/tasks", enabled: true } });
    expect(overview.stages.find(stage => stage.id === "operation")).toMatchObject({ state: "running", detail: "video", action: { enabled: true, href: "/tasks" } });
  });

  it("derives a recoverable failed project and routes to the failed stage", () => {
    const overview = deriveProductionOverview({
      ...base,
      scripts: [{ id: "s", selected: true, shots: [{ shotId: 1 }] }],
      assets: [{ id: "a", shotId: 1, status: "failed" }],
      tasks: [{ id: "failed-task", status: "failed", mediaType: "image", error: "provider failed" }],
    });
    expect(overview.summary).toMatchObject({ state: "failed", nextAction: { id: "assets", href: "/project/p/assets", enabled: true } });
    expect(overview.failure).toMatchObject({ source: "task", error: "provider failed", recoverable: true });
  });

  it("derives completion, QC availability, release and durable version counts", () => {
    const overview = deriveProductionOverview({
      ...base,
      scripts: [{ id: "s", selected: true, shots: [{ shotId: 1 }] }],
      assets: [{ id: "a", shotId: 1, status: "done" }],
      tasks: [{ id: "paid", status: "completed", mediaType: "video", error: null }],
      compositions: [{ id: "c", status: "done", outputPath: "/output.mp4", label: "Final" }],
      operations: [{ id: "c", kind: "compose", status: "done", stage: "render", checkpoint: null, error: null }],
      snapshots: [{ id: "v", label: "V1", createdAt: "2026-01-01", assetIds: ["a"], compositionId: "c" }],
    });
    expect(overview.summary).toMatchObject({ state: "complete", progress: 100, nextAction: { id: "release", href: "/project/p/export", enabled: true } });
    expect(overview.stages.find(stage => stage.id === "qc")).toMatchObject({ state: "ready", action: { enabled: true } });
    expect(overview.stages.find(stage => stage.id === "release")).toMatchObject({ state: "ready", action: { enabled: true } });
    expect(overview.stages.find(stage => stage.id === "qc")?.action.reason).toBeUndefined();
    expect(overview.stages.find(stage => stage.id === "release")?.action.reason).toBeUndefined();
    expect(overview.versions).toEqual({ scripts: 1, assets: 1, compositions: 1, snapshots: 1 });
    expect(overview.cost).toMatchObject({ submittedCalls: 1, completedCalls: 1, currency: null, amount: null });
  });

  it("does not let superseded failures override newer successful facts", () => {
    const overview = deriveProductionOverview({
      ...base,
      scripts: [{ id: "s", selected: true, shots: [{ shotId: 1 }] }],
      assets: [
        { id: "new-asset", shotId: 1, status: "done" },
        { id: "old-asset", shotId: 1, status: "failed" },
      ],
      tasks: [
        { id: "new-task", status: "completed", mediaType: "video", error: null },
        { id: "old-task", status: "failed", mediaType: "video", error: "old failure" },
      ],
      compositions: [{ id: "c", status: "done", outputPath: "/output.mp4" }],
      operations: [
        { id: "new-run", kind: "compose", status: "done", stage: "render", checkpoint: null, error: null },
        { id: "old-run", kind: "compose", status: "failed", stage: "render", checkpoint: null, error: "old failure" },
      ],
    });
    expect(overview.summary.state).toBe("complete");
    expect(overview.failure).toBeNull();
    expect(overview.stages.find(stage => stage.id === "assets")).toMatchObject({ state: "done", current: 1, total: 1 });
  });
});
